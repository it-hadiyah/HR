// إدارة الموظفين (بوابة الموارد البشرية): سجل واحد (leave_staff) تشترك فيه الأرصدة والنماذج والرواتب.
// الصلاحيات (منصة hr-employees): access · view · edit · archive · delete · sensitive. النطاق التنظيمي يُطبَّق على view.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { requireGrant, hasGrant, resolveScope } from '../lib/rbac.js';
import { httpError, isDate } from '../lib/util.js';
import { unitPaths } from './tracking.js';
import { assignCodes } from '../lib/poscode.js';

const r = Router();
const G = action => requireGrant('hr-employees', action);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const digits = v => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s-]/g, '');

/** يتحقق من الحقول المرسلة ويُرجع الأعمدة المراد كتابتها (الحساسة تتطلب sensitive) */
async function cleanFields(req, b, { creating = false, selfId = 0 } = {}) {
  const out = {};
  if (creating || 'full_name' in b) { const v = str(b.full_name, 160); if (v.length < 2) throw httpError(400, 'الاسم مطلوب'); out.full_name = v; }
  if ('emp_no' in b) out.emp_no = str(b.emp_no, 40) || null;
  if ('job_title' in b) out.job_title = str(b.job_title, 160) || null;
  if ('hire_date' in b) { const v = str(b.hire_date, 10); if (v && !isDate(v)) throw httpError(400, 'تاريخ التعيين غير صالح'); out.hire_date = v || null; }
  if ('nationality' in b) out.nationality = str(b.nationality, 60) || null;
  if ('phone' in b) { const v = digits(b.phone); if (v && !/^\+?\d{7,15}$/.test(v)) throw httpError(400, 'رقم الجوال غير صالح'); out.phone = v || null; }
  if ('org_unit_id' in b) {
    const u = b.org_unit_id === '' || b.org_unit_id === null ? null : +b.org_unit_id;
    if (u !== null && !(await q('SELECT 1 FROM org_units WHERE id = $1', [u])).rows.length) throw httpError(400, 'الوحدة غير موجودة');
    const sc = await resolveScope(req.user, 'hr-employees', 'edit');
    if (!sc.all && (u === null || !sc.unitIds?.has(u))) throw httpError(403, 'الوحدة خارج نطاقك');
    out.org_unit_id = u;
  }
  if ('position_id' in b) {   // الإسكان في الهيكل الوظيفي: المسمى والوحدة يُشتقان من الوظيفة
    if (b.position_id === '' || b.position_id === null) out.position_id = null;
    else {
      const pos = (await q('SELECT id, title, org_unit_id, headcount, active FROM hr_positions WHERE id = $1', [+b.position_id])).rows[0];
      if (!pos || !pos.active) throw httpError(400, 'الوظيفة غير موجودة أو موقوفة');
      const sc = await resolveScope(req.user, 'hr-employees', 'edit');
      if (!sc.all && !sc.unitIds?.has(pos.org_unit_id)) throw httpError(403, 'الوظيفة خارج نطاقك');
      const occ = (await q("SELECT count(*)::int AS n FROM leave_staff WHERE position_id = $1 AND status = 'active' AND id <> $2", [pos.id, selfId])).rows[0].n;
      if (occ >= pos.headcount) throw httpError(409, `لا توجد مقاعد شاغرة في الوظيفة «${pos.title}» (${occ}/${pos.headcount})`);
      out.position_id = pos.id; out.job_title = pos.title; out.org_unit_id = pos.org_unit_id;
    }
  }
  if (creating && !out.position_id && (await q('SELECT 1 FROM hr_positions WHERE active LIMIT 1')).rows.length) throw httpError(400, 'اختر المسمى الوظيفي من الهيكل الوظيفي أولاً');
  if ('national_id' in b || 'iban' in b) {
    if (!hasGrant(req.user, 'hr-employees', 'sensitive')) throw httpError(403, 'لا تملك صلاحية تعديل رقم الهوية والآيبان');
    if ('national_id' in b) { const v = digits(b.national_id); if (v && !/^\d{10}$/.test(v)) throw httpError(400, 'رقم الهوية 10 أرقام'); out.national_id = v || null; }
    if ('iban' in b) { const v = String(b.iban ?? '').replace(/\s/g, '').toUpperCase(); if (v && !/^SA\d{22}$/.test(v)) throw httpError(400, 'الآيبان يبدأ بـ SA ويتبعه 22 رقماً'); out.iban = v || null; }
  }
  return out;
}

async function rowsFor(req, { q: term = '', status = 'active', unit = null, missing = '', ids, position = '' } = {}) {
  const sc = await resolveScope(req.user, 'hr-employees', 'view');
  const sens = hasGrant(req.user, 'hr-employees', 'sensitive');
  const p = []; const where = [];
  if (status !== 'all') { p.push(status); where.push(`s.status = $${p.length}`); }
  if (term) { p.push(`%${term}%`); where.push(`(s.full_name ILIKE $${p.length} OR s.emp_no ILIKE $${p.length} OR s.job_title ILIKE $${p.length} OR s.national_id ILIKE $${p.length})`); }
  if (ids) { p.push(ids); where.push(`s.id = ANY($${p.length}::int[])`); }
  if (!sc.all) { if (!sc.unitIds) return []; p.push([...sc.unitIds]); where.push(`s.org_unit_id = ANY($${p.length}::int[])`); }
  const rows = (await q(`SELECT s.id, s.emp_no, s.full_name, s.job_title, s.hire_date, s.nationality, s.national_id, s.iban, s.phone, s.org_unit_id, s.status, s.version, s.position_id, hp.code AS position_code, hp.title AS position_title,
      (SELECT count(*) FROM payroll_salaries ps WHERE ps.employee_id = s.id AND (ps.basic + ps.housing + ps.transport + ps.other) > 0) > 0 AS has_salary,
      (SELECT count(*) FROM leave_tracking lt WHERE lt.employee_id = s.id) > 0 AS has_leave
    FROM leave_staff s LEFT JOIN hr_positions hp ON hp.id = s.position_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.full_name, s.id`, p)).rows;
  const pathOf = await unitPaths();
  let out = rows.map(x => {
    const u = pathOf(x.org_unit_id);
    const lacking = [!x.emp_no && 'الرقم الوظيفي', !x.org_unit_id && 'الوحدة', !x.hire_date && 'تاريخ التعيين', !x.nationality && 'الجنسية', !x.national_id && 'رقم الهوية', !x.iban && 'الآيبان'].filter(Boolean);
    const row = { ...x, hire_date: x.hire_date ? new Date(x.hire_date).toISOString().slice(0, 10) : null, sector: u.sector, department: u.department, section: u.section, lacking };
    if (!sens) { row.national_id = row.national_id ? '••••••' + String(row.national_id).slice(-4) : null; row.iban = row.iban ? 'SA••' + '•'.repeat(14) + String(row.iban).slice(-4) : null; row.masked = true; }
    return row;
  });
  if (unit) { const k = +unit; const g = (await q('SELECT id, parent_id FROM org_units')).rows; const kids = new Map(); for (const u of g) (kids.get(u.parent_id) ?? kids.set(u.parent_id, []).get(u.parent_id)).push(u.id); const set = new Set([k]); for (const id of set) for (const c of kids.get(id) || []) set.add(c); out = out.filter(x => set.has(x.org_unit_id)); }
  if (missing === 'any') out = out.filter(x => x.lacking.length);
  if (position === 'none') out = out.filter(x => !x.position_id);
  return out;
}

// ================= الهيكل الوظيفي =================
const posScope = async (req, action) => resolveScope(req.user, 'hr-employees', action);
async function positionsList(req, { unit = null, vacant = false, term = '' } = {}) {
  const sc = await posScope(req, 'view');
  const p = []; const where = [];
  if (!sc.all) { if (!sc.unitIds) return []; p.push([...sc.unitIds]); where.push(`p.org_unit_id = ANY($${p.length}::int[])`); }
  if (term) { p.push(`%${term}%`); where.push(`(p.title ILIKE $${p.length} OR p.code ILIKE $${p.length} OR p.grade ILIKE $${p.length})`); }
  const rows = (await q(`SELECT p.*, par.title AS parent_title, par.code AS parent_code FROM hr_positions p LEFT JOIN hr_positions par ON par.id = p.parent_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.org_unit_id, p.sort_order, p.title, p.id`, p)).rows;
  const occ = (await q("SELECT position_id, id, full_name, emp_no FROM leave_staff WHERE position_id = ANY($1::int[]) AND status = 'active' ORDER BY full_name", [rows.map(x => x.id)])).rows;
  const by = new Map(); for (const o of occ) (by.get(o.position_id) ?? by.set(o.position_id, []).get(o.position_id)).push({ id: o.id, full_name: o.full_name, emp_no: o.emp_no });
  const pathOf = await unitPaths(); const units = new Map((await q('SELECT id, name, unit_type, parent_id FROM org_units')).rows.map(u => [u.id, u]));
  const fullPath = id => { const a = []; for (let u = units.get(id); u; u = units.get(u.parent_id)) a.unshift(u.name); return a.join(' › '); };
  let out = rows.map(x => { const o = by.get(x.id) || []; return { id: x.id, code: x.code, title: x.title, org_unit_id: x.org_unit_id, unit_path: fullPath(x.org_unit_id), parent_id: x.parent_id, parent_title: x.parent_title, parent_code: x.parent_code, grade: x.grade, headcount: x.headcount, active: x.active, notes: x.notes, version: x.version,
    occupied: o.length, vacant: Math.max(0, x.headcount - o.length), occupants: o }; });
  if (unit) { const k = +unit; const kids = new Map(); for (const u of units.values()) (kids.get(u.parent_id) ?? kids.set(u.parent_id, []).get(u.parent_id)).push(u.id); const set = new Set([k]); for (const id of set) for (const c of kids.get(id) || []) set.add(c); out = out.filter(x => set.has(x.org_unit_id)); }
  if (vacant) out = out.filter(x => x.active && x.vacant > 0);
  void pathOf;
  return out;
}
async function cleanPosition(req, b, { id = 0, creating = false } = {}) {
  const out = {};
  if (creating || 'title' in b) { const v = str(b.title, 160); if (v.length < 2) throw httpError(400, 'مسمى الوظيفة مطلوب'); out.title = v; }
  if ('code' in b) out.code = str(b.code, 30) || null;
  if (creating || 'org_unit_id' in b) {
    const u = +b.org_unit_id;
    if (!Number.isInteger(u) || !(await q('SELECT 1 FROM org_units WHERE id = $1', [u])).rows.length) throw httpError(400, 'اختر الوحدة التنظيمية للوظيفة');
    const sc = await posScope(req, 'structure');
    if (!sc.all && !sc.unitIds?.has(u)) throw httpError(403, 'الوحدة خارج نطاقك');
    out.org_unit_id = u;
  }
  if ('parent_id' in b) {
    const pid = b.parent_id === '' || b.parent_id === null ? null : +b.parent_id;
    if (pid !== null) {
      if (pid === id) throw httpError(400, 'لا يمكن أن ترفع الوظيفة إلى نفسها');
      if (!(await q('SELECT 1 FROM hr_positions WHERE id = $1', [pid])).rows.length) throw httpError(400, 'الوظيفة المرفوع إليها غير موجودة');
      // منع الحلقات: لا يكون الأب من فروع هذه الوظيفة
      if (id) { const all = (await q('SELECT id, parent_id FROM hr_positions')).rows; const par = new Map(all.map(x => [x.id, x.parent_id])); for (let c = pid, n = 0; c && n < 1000; c = par.get(c), n++) if (c === id) throw httpError(400, 'هذا الربط يُنشئ حلقة في التسلسل الإداري'); }
    }
    out.parent_id = pid;
  }
  if ('grade' in b) out.grade = str(b.grade, 60) || null;
  if ('notes' in b) out.notes = str(b.notes, 300) || null;
  if (creating || 'headcount' in b) { const n = Number(b.headcount ?? 1); if (!Number.isInteger(n) || n < 1 || n > 500) throw httpError(400, 'عدد المقاعد بين 1 و500'); out.headcount = n; }
  if ('active' in b) out.active = b.active !== false && b.active !== 'false';
  return out;
}
r.get('/positions', G('view'), wrap(async (req, res) => {
  const rows = await positionsList(req, { unit: Number.isInteger(+req.query.unit) && +req.query.unit > 0 ? req.query.unit : null, vacant: req.query.vacant === '1', term: str(req.query.q, 60) });
  res.json({ positions: rows, totals: { positions: rows.length, seats: rows.reduce((a, x) => a + (x.active ? x.headcount : 0), 0), occupied: rows.reduce((a, x) => a + x.occupied, 0), vacant: rows.reduce((a, x) => a + (x.active ? x.vacant : 0), 0) } });
}));
r.post('/positions', G('structure'), wrap(async (req, res) => {
  const f = await cleanPosition(req, req.body || {}, { creating: true });
  const keys = Object.keys(f); let row;
  try { row = (await q(`INSERT INTO hr_positions(${keys.join(', ')}, created_by) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) RETURNING id`, [...keys.map(k => f[k]), req.user.username])).rows[0]; }
  catch (e) { if (e.code === '23505') throw httpError(409, 'رمز الوظيفة مستخدم لوظيفة أخرى'); throw e; }
  if (!f.code) await assignCodes([row.id]);   // بلا رمز يدوي: يُولَّد تلقائياً بصيغة H-Sec-0001
  await audit(req, 'create', 'hr_position', row.id, null, f);
  res.status(201).json({ position: (await positionsList(req)).find(x => x.id === row.id) });
}));
r.put('/positions/:id', G('structure'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body || {};
  const cur = (await positionsList(req)).find(x => x.id === id);
  if (!cur) throw httpError(404, 'الوظيفة غير موجودة');
  if (b.version !== undefined && +b.version !== cur.version) throw httpError(409, 'عُدِّلت هذه الوظيفة من مستخدم آخر؛ أعد تحميل الصفحة');
  const f = await cleanPosition(req, b, { id });
  if ('headcount' in f && f.headcount < cur.occupied) throw httpError(409, `يشغل الوظيفة ${cur.occupied} موظفاً؛ لا يمكن تقليل المقاعد عن ذلك`);
  if (f.active === false && cur.occupied) throw httpError(409, 'يشغل الوظيفة موظفون؛ انقلهم أولاً قبل إيقافها');
  const keys = Object.keys(f);
  if (!keys.length) return res.json({ position: cur });
  try { await q(`UPDATE hr_positions SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, [id, ...keys.map(k => f[k])]); }
  catch (e) { if (e.code === '23505') throw httpError(409, 'رمز الوظيفة مستخدم لوظيفة أخرى'); throw e; }
  // الموظفون الشاغلون يتبعون الوظيفة: تنتقل بياناتهم (المسمى والوحدة) معها
  if ('title' in f || 'org_unit_id' in f) await q('UPDATE leave_staff SET job_title = COALESCE($2, job_title), org_unit_id = COALESCE($3, org_unit_id), version = version + 1, updated_at = now() WHERE position_id = $1', [id, f.title ?? null, f.org_unit_id ?? null]);
  await audit(req, 'update', 'hr_position', id, { title: cur.title, org_unit_id: cur.org_unit_id, headcount: cur.headcount }, f);
  res.json({ position: (await positionsList(req)).find(x => x.id === id) });
}));
r.delete('/positions/:id', G('structure'), wrap(async (req, res) => {
  const id = +req.params.id;
  const cur = (await positionsList(req)).find(x => x.id === id);
  if (!cur) throw httpError(404, 'الوظيفة غير موجودة');
  if (cur.occupied) throw httpError(409, `يشغل الوظيفة ${cur.occupied} موظفاً؛ انقلهم أولاً`);
  await q('DELETE FROM hr_positions WHERE id = $1', [id]);
  await audit(req, 'delete', 'hr_position', id, { title: cur.title, code: cur.code }, null);
  res.json({ ok: true });
}));
// توليد الهيكل من الموظفين الحاليين: وظيفة لكل (وحدة، مسمى) ويُربط بها موظفوه
r.post('/positions/generate-codes', G('structure'), wrap(async (req, res) => {
  const n = await assignCodes();
  await audit(req, 'update', 'hr_position', 'codes', null, { generated: n });
  res.json({ generated: n });
}));
r.post('/positions/seed-from-employees', G('structure'), wrap(async (req, res) => {
  const sc = await posScope(req, 'structure');
  if (!sc.all) throw httpError(403, 'التوليد التلقائي لصاحب نطاق شامل فقط');
  const groups = (await q(`SELECT org_unit_id, job_title, array_agg(id ORDER BY id) AS ids FROM leave_staff
    WHERE status = 'active' AND position_id IS NULL AND org_unit_id IS NOT NULL AND job_title IS NOT NULL AND btrim(job_title) <> '' GROUP BY org_unit_id, job_title`)).rows;
  let created = 0, linked = 0;
  for (const g of groups) {
    let pos = (await q('SELECT id, headcount, (SELECT count(*) FROM leave_staff s WHERE s.position_id = hp.id AND s.status = \'active\')::int AS occ FROM hr_positions hp WHERE active AND org_unit_id = $1 AND title = $2 ORDER BY id LIMIT 1', [g.org_unit_id, g.job_title.trim()])).rows[0];
    if (!pos) { pos = (await q('INSERT INTO hr_positions(title, org_unit_id, headcount, created_by) VALUES ($1,$2,$3,$4) RETURNING id, headcount', [g.job_title.trim(), g.org_unit_id, Math.min(500, g.ids.length), req.user.username])).rows[0]; pos.occ = 0; created++; }
    else if (pos.occ + g.ids.length > pos.headcount) await q('UPDATE hr_positions SET headcount = LEAST(500, $2), version = version + 1, updated_at = now() WHERE id = $1', [pos.id, pos.occ + g.ids.length]);
    await q('UPDATE leave_staff SET position_id = $1, version = version + 1, updated_at = now() WHERE id = ANY($2::int[])', [pos.id, g.ids]); linked += g.ids.length;
  }
  await assignCodes();
  await audit(req, 'create', 'hr_position', 'seed', null, { created, linked });
  res.json({ created, linked });
}));

r.get('/meta', G('access'), wrap(async (req, res) => {
  const can = a => hasGrant(req.user, 'hr-employees', a);
  const units = (await q('SELECT id, name, unit_type, parent_id, slug FROM org_units WHERE active ORDER BY id')).rows;
  const titles = (await q("SELECT DISTINCT job_title FROM leave_staff WHERE job_title IS NOT NULL AND btrim(job_title) <> '' ORDER BY job_title")).rows.map(x => x.job_title);
  const positions = can('view') ? (await positionsList(req)).filter(x => x.active).map(x => ({ id: x.id, code: x.code, title: x.title, unit_path: x.unit_path, org_unit_id: x.org_unit_id, headcount: x.headcount, occupied: x.occupied, vacant: x.vacant })) : [];
  res.json({ units, positions, job_titles: titles, can: { view: can('view'), edit: can('edit'), archive: can('archive'), delete: can('delete'), sensitive: can('sensitive'), structure: can('structure') } });
}));

r.get('/', G('view'), wrap(async (req, res) => {
  const status = ['active', 'archived', 'all'].includes(req.query.status) ? req.query.status : 'active';
  const rows = await rowsFor(req, { q: str(req.query.q, 60), status, unit: Number.isInteger(+req.query.unit) && +req.query.unit > 0 ? req.query.unit : null, missing: req.query.missing, position: req.query.position });
  res.json({ rows, totals: { count: rows.length, incomplete: rows.filter(x => x.lacking.length).length, no_position: rows.filter(x => !x.position_id).length } });
}));

r.get('/export', G('view'), wrap(async (req, res) => {
  const rows = await rowsFor(req, { status: req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? 'all' : 'active' });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الموظفون', { views: [{ rightToLeft: true }] });
  const head = ws.addRow(['الرقم الوظيفي', 'الاسم', 'المسمى الوظيفي', 'القطاع', 'الإدارة', 'القسم', 'تاريخ التعيين', 'الجنسية', 'رقم الهوية', 'الآيبان', 'الجوال', 'الحالة']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; });
  for (const x of rows) ws.addRow([x.emp_no, x.full_name, x.job_title, x.sector, x.department, x.section, x.hire_date, x.nationality, x.national_id, x.iban, x.phone, x.status === 'active' ? 'نشط' : 'مؤرشف']);
  ws.columns.forEach(c => { c.width = 22; });
  await audit(req, 'export', 'leave_staff', 'excel', null, { count: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

r.post('/', G('edit'), wrap(async (req, res) => {
  const f = await cleanFields(req, req.body || {}, { creating: true });
  const sc = await resolveScope(req.user, 'hr-employees', 'edit');
  if (!sc.all && !f.org_unit_id) throw httpError(400, 'حدد الوحدة التنظيمية');
  const keys = Object.keys(f);
  let row;
  try {
    row = (await q(`INSERT INTO leave_staff(${keys.join(', ')}, created_by) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) RETURNING id`, [...keys.map(k => f[k]), req.user.username])).rows[0];
  } catch (e) { if (e.code === '23505') throw httpError(409, e.constraint?.includes('national') ? 'رقم الهوية مستخدم لموظف آخر' : 'الرقم الوظيفي مستخدم لموظف آخر'); throw e; }
  await audit(req, 'create', 'leave_staff', row.id, null, f);
  res.status(201).json({ row: (await rowsFor(req, { status: 'all', ids: [row.id] }))[0] });
}));

r.put('/:id', G('edit'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body || {};
  const cur = (await rowsFor(req, { status: 'all', ids: [id] }))[0];
  if (!cur) throw httpError(404, 'الموظف غير موجود');
  if (b.version !== undefined && +b.version !== cur.version) throw httpError(409, 'عُدِّل هذا الموظف من مستخدم آخر؛ أعد تحميل الصفحة');
  const f = await cleanFields(req, b, { selfId: id });
  const keys = Object.keys(f);
  if (!keys.length) return res.json({ row: cur });
  try {
    await q(`UPDATE leave_staff SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, [id, ...keys.map(k => f[k])]);
  } catch (e) { if (e.code === '23505') throw httpError(409, e.constraint?.includes('national') ? 'رقم الهوية مستخدم لموظف آخر' : 'الرقم الوظيفي مستخدم لموظف آخر'); throw e; }
  await audit(req, 'update', 'leave_staff', id, Object.fromEntries(keys.map(k => [k, cur[k]])), f);
  res.json({ row: (await rowsFor(req, { status: 'all', ids: [id] }))[0] });
}));

for (const [action, status] of [['archive', 'archived'], ['restore', 'active']]) {
  r.post(`/:id/${action}`, G('archive'), wrap(async (req, res) => {
    const id = +req.params.id;
    const cur = (await rowsFor(req, { status: 'all', ids: [id] }))[0];
    if (!cur) throw httpError(404, 'الموظف غير موجود');
    await q('UPDATE leave_staff SET status = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, status]);
    if (status === 'active' && cur.position_id) {   // الاستعادة لا تتجاوز مقاعد الوظيفة: إن امتلأت يُفكّ ربطه بها
      const pos = (await q("SELECT headcount, (SELECT count(*) FROM leave_staff s WHERE s.position_id = $1 AND s.status = 'active' AND s.id <> $2)::int AS occ FROM hr_positions WHERE id = $1", [cur.position_id, id])).rows[0];
      if (!pos || pos.occ >= pos.headcount) await q('UPDATE leave_staff SET position_id = NULL WHERE id = $1', [id]);
    }
    await audit(req, action, 'leave_staff', id, { status: cur.status }, { status });
    res.json({ row: (await rowsFor(req, { status: 'all', ids: [id] }))[0] });
  }));
}

r.delete('/:id', G('delete'), wrap(async (req, res) => {
  const id = +req.params.id;
  const cur = (await rowsFor(req, { status: 'all', ids: [id] }))[0];
  if (!cur) throw httpError(404, 'الموظف غير موجود');
  const used = (await q(`SELECT (SELECT count(*) FROM payroll_entries WHERE employee_id = $1)::int AS entries,
    (SELECT count(*) FROM leave_tracking WHERE employee_id = $1)::int AS leave, (SELECT count(*) FROM payroll_salaries WHERE employee_id = $1)::int AS salary`, [id])).rows[0];
  if (used.entries || used.leave || used.salary) throw httpError(409, 'للموظف بيانات مرتبطة (أرصدة أو رواتب أو إضافي)؛ أرشفه بدل الحذف');
  await q('DELETE FROM leave_staff WHERE id = $1', [id]);
  await audit(req, 'delete', 'leave_staff', id, { emp_no: cur.emp_no, full_name: cur.full_name }, null);
  res.json({ ok: true });
}));

export default r;
