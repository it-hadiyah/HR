// إدارة الموظفين (بوابة الموارد البشرية): سجل واحد (leave_staff) تشترك فيه الأرصدة والنماذج والرواتب.
// الصلاحيات (منصة hr-employees): access · view · edit · archive · delete · sensitive. النطاق التنظيمي يُطبَّق على view.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { requireGrant, hasGrant, resolveScope } from '../lib/rbac.js';
import { httpError, isDate } from '../lib/util.js';
import { unitPaths } from './tracking.js';

const r = Router();
const G = action => requireGrant('hr-employees', action);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const digits = v => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s-]/g, '');

/** يتحقق من الحقول المرسلة ويُرجع الأعمدة المراد كتابتها (الحساسة تتطلب sensitive) */
async function cleanFields(req, b, { creating = false } = {}) {
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
  if ('national_id' in b || 'iban' in b) {
    if (!hasGrant(req.user, 'hr-employees', 'sensitive')) throw httpError(403, 'لا تملك صلاحية تعديل رقم الهوية والآيبان');
    if ('national_id' in b) { const v = digits(b.national_id); if (v && !/^\d{10}$/.test(v)) throw httpError(400, 'رقم الهوية 10 أرقام'); out.national_id = v || null; }
    if ('iban' in b) { const v = String(b.iban ?? '').replace(/\s/g, '').toUpperCase(); if (v && !/^SA\d{22}$/.test(v)) throw httpError(400, 'الآيبان يبدأ بـ SA ويتبعه 22 رقماً'); out.iban = v || null; }
  }
  return out;
}

async function rowsFor(req, { q: term = '', status = 'active', unit = null, missing = '', ids } = {}) {
  const sc = await resolveScope(req.user, 'hr-employees', 'view');
  const sens = hasGrant(req.user, 'hr-employees', 'sensitive');
  const p = []; const where = [];
  if (status !== 'all') { p.push(status); where.push(`s.status = $${p.length}`); }
  if (term) { p.push(`%${term}%`); where.push(`(s.full_name ILIKE $${p.length} OR s.emp_no ILIKE $${p.length} OR s.job_title ILIKE $${p.length} OR s.national_id ILIKE $${p.length})`); }
  if (ids) { p.push(ids); where.push(`s.id = ANY($${p.length}::int[])`); }
  if (!sc.all) { if (!sc.unitIds) return []; p.push([...sc.unitIds]); where.push(`s.org_unit_id = ANY($${p.length}::int[])`); }
  const rows = (await q(`SELECT s.id, s.emp_no, s.full_name, s.job_title, s.hire_date, s.nationality, s.national_id, s.iban, s.phone, s.org_unit_id, s.status, s.version,
      (SELECT count(*) FROM payroll_salaries ps WHERE ps.employee_id = s.id AND (ps.basic + ps.housing + ps.transport + ps.other) > 0) > 0 AS has_salary,
      (SELECT count(*) FROM leave_tracking lt WHERE lt.employee_id = s.id) > 0 AS has_leave
    FROM leave_staff s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.full_name, s.id`, p)).rows;
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
  return out;
}

r.get('/meta', G('access'), wrap(async (req, res) => {
  const can = a => hasGrant(req.user, 'hr-employees', a);
  const units = (await q('SELECT id, name, unit_type, parent_id FROM org_units WHERE active ORDER BY id')).rows;
  const titles = (await q("SELECT DISTINCT job_title FROM leave_staff WHERE job_title IS NOT NULL AND btrim(job_title) <> '' ORDER BY job_title")).rows.map(x => x.job_title);
  res.json({ units, job_titles: titles, can: { view: can('view'), edit: can('edit'), archive: can('archive'), delete: can('delete'), sensitive: can('sensitive') } });
}));

r.get('/', G('view'), wrap(async (req, res) => {
  const status = ['active', 'archived', 'all'].includes(req.query.status) ? req.query.status : 'active';
  const rows = await rowsFor(req, { q: str(req.query.q, 60), status, unit: Number.isInteger(+req.query.unit) && +req.query.unit > 0 ? req.query.unit : null, missing: req.query.missing });
  res.json({ rows, totals: { count: rows.length, incomplete: rows.filter(x => x.lacking.length).length } });
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
  const f = await cleanFields(req, b);
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
