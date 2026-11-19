// الرواتب والإضافي: رواتب الموظفين الإجمالية وتجميعها حسب القطاع/الإدارة/القسم، وحساب الإضافي (ساعات) والانتداب (أيام) تلقائياً من نسب الإعدادات.
// الصلاحيات (منصة payroll): access · view · edit_salaries · entries · settings
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { q, pool } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { requireGrant, hasGrant } from '../lib/rbac.js';
import { httpError, isDate } from '../lib/util.js';
import { normalizeName } from '../lib/text.js';
import { unitPaths } from './tracking.js';
import { DEFAULT_SETTINGS, round2, grossOf, baseOf, entryAmount, groupRows, withAllowances, basicFromGross, findRate, assignmentByRate, normTitle } from '../../public/payroll/calc.js';

const r = Router();
const G = action => requireGrant('payroll', action);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('file');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (v, label, { max = 10_000_000 } = {}) => {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const x = Number(String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[,٬،\s]/g, ''));
  if (!Number.isFinite(x) || x < 0 || x > max) throw httpError(400, `قيمة غير صالحة: ${label}`);
  return round2(x);
};
const monthOf = (v, def) => { const m = String(v || def || ''); if (!MONTH_RE.test(m)) throw httpError(400, 'شهر غير صالح (YYYY-MM)'); return m; };
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// ---------- الإعدادات ----------
export async function loadSettings() {
  const row = (await q("SELECT value FROM payroll_settings WHERE key = 'config'")).rows[0];
  return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
}
function cleanRates(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw httpError(400, 'أجور الانتداب يجب أن تكون قائمة');
  if (list.length > 200) throw httpError(400, 'الحد الأقصى 200 مسمى وظيفي');
  const seen = new Set();
  return list.map(t => {
    const title = String(t?.title ?? '').trim().slice(0, 100);
    if (!title) throw httpError(400, 'المسمى الوظيفي مطلوب في أجور الانتداب');
    const k = normTitle(title); if (seen.has(k)) throw httpError(400, `المسمى «${title}» مكرر`); seen.add(k);
    return { title, living: money(t.living, `أجر المعيشة (${title})`, { max: 100000 }), assignment: money(t.assignment, `أجر الانتداب (${title})`, { max: 100000 }), transport: money(t.transport, `أجر النقل (${title})`, { max: 100000 }) };
  });
}
function cleanTypes(list, label) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, `أضف نوعاً واحداً على الأقل: ${label}`);
  if (list.length > 20) throw httpError(400, `الحد الأقصى 20 نوعاً: ${label}`);
  const seen = new Set();
  return list.map(t => {
    const name = String(t?.name ?? '').trim().slice(0, 60);
    if (!name) throw httpError(400, `اسم النوع مطلوب (${label})`);
    const percent = Number(t?.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 1000) throw httpError(400, `نسبة غير صالحة للنوع «${name}» (0 إلى 1000)`);
    let id = /^[a-z0-9-]{3,40}$/.test(String(t?.id || '')) ? t.id : 'tp-' + crypto.randomBytes(4).toString('hex');
    if (seen.has(id)) id = 'tp-' + crypto.randomBytes(4).toString('hex');
    seen.add(id);
    return { id, name, percent: round2(percent) };
  });
}
function cleanSettings(b) {
  const days = Number(b.days_per_month), hours = Number(b.hours_per_day), cap = Number(b.overtime_monthly_cap_hours ?? 0);
  if (!(days >= 20 && days <= 31)) throw httpError(400, 'أيام الشهر بين 20 و31');
  if (!(hours >= 1 && hours <= 24)) throw httpError(400, 'ساعات اليوم بين 1 و24');
  if (!(cap >= 0 && cap <= 744)) throw httpError(400, 'الحد الأقصى لساعات الإضافي بين 0 و744 (0 = بلا حد)');
  const hp = Number(b.housing_percent ?? 0), tp = Number(b.transport_percent ?? 0);
  if (!(hp >= 0 && hp <= 100)) throw httpError(400, 'نسبة بدل السكن بين 0 و100');
  if (!(tp >= 0 && tp <= 100)) throw httpError(400, 'نسبة بدل النقل بين 0 و100');
  const rates = cleanRates(b.assignment_rates);
  return { assignment_rates: rates, salary_basis: b.salary_basis === 'basic' ? 'basic' : 'gross', allowances_auto: b.allowances_auto !== false && b.allowances_auto !== 'false', housing_percent: hp, transport_percent: tp, days_per_month: days, hours_per_day: hours, overtime_monthly_cap_hours: cap,
    overtime_types: cleanTypes(b.overtime_types, 'الإضافي'), assignment_types: cleanTypes(b.assignment_types, 'الانتداب') };
}

r.get('/meta', G('access'), wrap(async (req, res) => {
  const units = (await q('SELECT id, name, unit_type, parent_id FROM org_units WHERE active ORDER BY id')).rows;
  const can = a => hasGrant(req.user, 'payroll', a);
  res.json({ settings: await loadSettings(), units, can: { view: can('view'), edit_salaries: can('edit_salaries'), entries: can('entries'), settings: can('settings') }, month: currentMonth() });
}));

r.put('/settings', G('settings'), wrap(async (req, res) => {
  const old = await loadSettings();
  const v = cleanSettings(req.body || {});
  await q("INSERT INTO payroll_settings(key, value, updated_by) VALUES ('config', $1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()", [JSON.stringify(v), req.user.username]);
  await audit(req, 'update', 'payroll_settings', 'config', old, v);
  res.json({ settings: v });
}));

// ---------- الرواتب ----------
async function staffRows({ status = 'active', term = '', ids } = {}) {
  const p = [];
  const where = [];
  if (status !== 'all') { p.push(status); where.push(`s.status = $${p.length}`); }
  if (term) { p.push(`%${term}%`); where.push(`(s.full_name ILIKE $${p.length} OR s.emp_no ILIKE $${p.length} OR s.job_title ILIKE $${p.length})`); }
  if (ids) { p.push(ids); where.push(`s.id = ANY($${p.length}::int[])`); }
  const rows = (await q(`SELECT s.id AS employee_id, s.emp_no, s.full_name, s.job_title, s.org_unit_id, s.status,
      p.basic::float8 AS basic, p.housing::float8 AS housing, p.transport::float8 AS transport, p.other::float8 AS other, p.insurance_percent::float8 AS insurance_percent, p.assignment_title, p.notes, (p.employee_id IS NOT NULL) AS has_salary
    FROM leave_staff s LEFT JOIN payroll_salaries p ON p.employee_id = s.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.full_name, s.id`, p)).rows;
  const pathOf = await unitPaths(); const st = await loadSettings();
  return rows.map(x => { const u = pathOf(x.org_unit_id); const y = withAllowances({ ...x, basic: x.basic ?? 0, housing: x.housing ?? 0, transport: x.transport ?? 0, other: x.other ?? 0 }, st); const gross = grossOf(y), ip = x.insurance_percent ?? 0; return { ...x, ...y, has_salary: !!x.has_salary && gross > 0, insurance_percent: ip, gross, insurance_amount: round2(gross * ip / 100), sector: u.sector, department: u.department, section: u.section }; });
}

r.get('/salaries', G('view'), wrap(async (req, res) => {
  const rows = await staffRows({ status: req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? 'all' : 'active', term: String(req.query.q || '').trim().slice(0, 60) });
  const sum = k => round2(rows.reduce((a, x) => a + x[k], 0));
  res.json({ rows, totals: { employees: rows.length, with_salary: rows.filter(x => x.has_salary).length, basic: sum('basic'), housing: sum('housing'), transport: sum('transport'), other: sum('other'), gross: sum('gross'), insurance: sum('insurance_amount') } });
}));

r.put('/salaries/:id', G('edit_salaries'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body || {};
  const staff = (await q('SELECT id, org_unit_id FROM leave_staff WHERE id = $1', [id])).rows[0];
  if (!staff) throw httpError(404, 'الموظف غير موجود');
  const before = (await staffRows({ status: 'all', ids: [id] }))[0];
  const cur = { basic: before.basic, housing: before.housing, transport: before.transport, other: before.other };
  const next = { ...cur };
  for (const [k, label] of [['basic', 'الراتب الأساسي'], ['housing', 'بدل السكن'], ['transport', 'بدل النقل'], ['other', 'بدلات أخرى']]) if (k in b) next[k] = money(b[k], label);
  let ins = before.insurance_percent ?? 0;
  if ('insurance_percent' in b) {
    const v = Number(String(b.insurance_percent ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/[%\s]/g, '') || 0);
    if (!(v >= 0 && v <= 100)) throw httpError(400, 'نسبة الاستقطاع بين 0 و100');
    ins = Math.round(v * 100) / 100;
  }
  let atitle = before.assignment_title ?? null;
  if ('assignment_title' in b) {
    const t = String(b.assignment_title ?? '').trim();
    if (!t) atitle = null;
    else { const rate = findRate((await loadSettings()).assignment_rates, t); if (!rate) throw httpError(400, 'مسمى الانتداب غير موجود في الإعدادات'); atitle = rate.title; }
  }
  const notes = 'notes' in b ? (String(b.notes ?? '').trim().slice(0, 300) || null) : before.notes;
  await q(`INSERT INTO payroll_salaries(employee_id, basic, housing, transport, other, notes, updated_by, insurance_percent, assignment_title) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (employee_id) DO UPDATE SET basic = EXCLUDED.basic, housing = EXCLUDED.housing, transport = EXCLUDED.transport, other = EXCLUDED.other, notes = EXCLUDED.notes, insurance_percent = EXCLUDED.insurance_percent, assignment_title = EXCLUDED.assignment_title, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [id, next.basic, next.housing, next.transport, next.other, notes, req.user.username, ins, atitle]);
  if ('org_unit_id' in b) {
    const u = b.org_unit_id === '' || b.org_unit_id === null ? null : +b.org_unit_id;
    if (u !== null && !(await q('SELECT 1 FROM org_units WHERE id = $1', [u])).rows.length) throw httpError(400, 'الوحدة غير موجودة');
    if (u !== staff.org_unit_id) { await q('UPDATE leave_staff SET org_unit_id = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, u]); await audit(req, 'update', 'leave_staff', id, { org_unit_id: staff.org_unit_id }, { org_unit_id: u }); }
  }
  const row = (await staffRows({ status: 'all', ids: [id] }))[0];
  await audit(req, 'update', 'payroll_salary', id, { gross_salary: before.gross }, { gross_salary: row.gross, changed: Object.keys(next).filter(k => next[k] !== cur[k]) });   // المبالغ تُحجب تلقائياً في السجل
  res.json({ row });
}));

r.post('/salaries/pull-from-tracking', G('edit_salaries'), wrap(async (req, res) => {
  const year = +req.body?.year || new Date().getFullYear();
  const st = await loadSettings(); const div = st.allowances_auto ? 1 + (Number(st.housing_percent) + Number(st.transport_percent)) / 100 : 1;
  const { rowCount } = await q(`INSERT INTO payroll_salaries(employee_id, basic, notes, updated_by)
    SELECT t.employee_id, round(t.gross_salary / $3::numeric, 2), 'من متابعة الأرصدة ' || $1 || ' (إجمالي)', $2 FROM leave_tracking t JOIN leave_staff s ON s.id = t.employee_id
    WHERE t.year = $1 AND t.gross_salary IS NOT NULL AND t.gross_salary > 0 AND s.status = 'active' ON CONFLICT (employee_id) DO NOTHING`, [year, req.user.username, div]);
  await audit(req, 'import', 'payroll_salary', `tracking-${year}`, null, { imported: rowCount });
  res.json({ imported: rowCount });
}));

// ---------- استيراد الرواتب من Excel ----------
const IMPORT_COLS = [['emp_no', 'الرقم الوظيفي'], ['full_name', 'الاسم'], ['basic', 'الراتب الأساسي'], ['housing', 'بدل السكن'], ['transport', 'بدل النقل'], ['other', 'بدلات أخرى']];
r.get('/salaries/template', G('edit_salaries'), wrap(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الرواتب', { views: [{ rightToLeft: true }] });
  const head = ws.addRow(IMPORT_COLS.map(c => c[1]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center' }; });
  ws.addRow(['1001', 'محمد أحمد العتيبي', 8000, 2000, 500, 0]).font = { italic: true, color: { argb: 'FF888888' } };
  ws.addRow(['↑ صف مثال: احذفه قبل الرفع']).font = { color: { argb: 'FFC00000' } };
  ws.columns.forEach(c => { c.width = 22; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="payroll-salaries-template.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

const cellText = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') { if (v.result !== undefined) return cellText(v.result); if (v.text) return String(v.text).trim(); if (v.richText) return v.richText.map(x => x.text).join('').trim(); if (v instanceof Date) return v.toISOString().slice(0, 10); }
  return String(v).trim();
};
async function readSalaryRows(file) {
  const wb = new ExcelJS.Workbook();
  try { if ((file.originalname || '').toLowerCase().endsWith('.csv')) await wb.csv.read((await import('node:stream')).Readable.from(file.buffer)); else await wb.xlsx.load(file.buffer); }
  catch { throw httpError(400, 'تعذّرت قراءة الملف؛ استخدم نموذج Excel'); }
  const ws = wb.worksheets[0];
  if (!ws) throw httpError(400, 'الملف فارغ');
  const labels = new Map(IMPORT_COLS.flatMap(c => [[c[1], c[0]], [c[0], c[0]]]));
  const headersOf = row => { const h = []; row.eachCell((c, i) => { h[i] = labels.get(cellText(c.value).replace(/\s+/g, ' ')) || null; }); return h; };
  let headers = headersOf(ws.getRow(1)), best = headers.filter(Boolean).length, hr = 1;
  for (let n = 2; n <= Math.min(10, ws.rowCount); n++) { const h = headersOf(ws.getRow(n)); const c = h.filter(Boolean).length; if (c > best) { best = c; headers = h; hr = n; } }
  if (!headers.includes('basic') || !(headers.includes('emp_no') || headers.includes('full_name'))) throw httpError(400, 'لم تُطابق أعمدة الملف النموذج: يلزم «الرقم الوظيفي» أو «الاسم» مع «الراتب الأساسي»');
  const out = [];
  ws.eachRow((row, n) => {
    if (n <= hr) return;
    const o = { _row: n }; let any = false;
    row.eachCell({ includeEmpty: false }, (c, i) => { if (headers[i]) { o[headers[i]] = cellText(c.value); if (o[headers[i]] !== '') any = true; } });
    if (String(o.emp_no || o.full_name || '').startsWith('↑')) return;
    if (any) out.push(o);
  });
  if (!out.length) throw httpError(400, 'لا توجد صفوف بيانات');
  if (out.length > 5000) throw httpError(400, 'الحد الأقصى 5000 صف');
  return out;
}

r.post('/salaries/import', G('edit_salaries'), upload, wrap(async (req, res) => {
  if (!req.file) throw httpError(400, 'لم يُرفع ملف');
  const commit = req.query.mode === 'commit', createMissing = req.query.create_missing === '1', skipInvalid = req.query.skip_invalid === '1';
  const rows = await readSalaryRows(req.file);
  const staff = (await q('SELECT id, emp_no, full_name FROM leave_staff')).rows.map(s => ({ ...s, norm: normalizeName(s.full_name), tokens: new Set(normalizeName(s.full_name).split(' ').filter(Boolean)) }));
  const byNo = new Map(staff.filter(s => s.emp_no).map(s => [String(s.emp_no), s]));
  const usedNo = new Set(byNo.keys());
  const seen = new Set(); const results = [];
  const matchName = name => {
    const norm = normalizeName(name); if (!norm) return { none: true };
    const toks = new Set(norm.split(' ').filter(Boolean));
    const exact = staff.filter(s => s.norm === norm); if (exact.length === 1) return { s: exact[0] }; if (exact.length > 1) return { many: exact.length };
    const sub = staff.filter(s => s.tokens.size >= 2 && toks.size >= 2 && ([...s.tokens].every(t => toks.has(t)) || [...toks].every(t => s.tokens.has(t))));
    return sub.length === 1 ? { s: sub[0] } : sub.length > 1 ? { many: sub.length } : { none: true };
  };
  const plan = []; const cfg = await loadSettings();
  for (const r0 of rows) {
    const errs = []; const warn = []; const no = String(r0.emp_no || '').trim(); const name = String(r0.full_name || '').trim();
    let s = no ? byNo.get(no) : null; let action = 'تحديث'; let create = false;
    if (!s && name) {
      const m = matchName(name);
      if (m.s) { s = m.s; action = `ربط بالاسم بـ «${s.full_name}»`; } else if (m.many) errs.push(`الاسم يطابق ${m.many} موظفين؛ استخدم الرقم الوظيفي`);
      else if (createMissing && no && !usedNo.has(no)) { create = true; action = 'إنشاء موظف جديد'; } else errs.push('الموظف غير موجود (فعّل «إنشاء الموظفين غير الموجودين» أو أضفه من متابعة الأرصدة)');
    } else if (!s) errs.push(no ? 'الرقم الوظيفي غير موجود' : 'الرقم الوظيفي والاسم فارغان');
    const vals = {};
    for (const [k, label] of [['basic', 'الراتب الأساسي'], ['housing', 'بدل السكن'], ['transport', 'بدل النقل'], ['other', 'بدلات أخرى']]) { try { vals[k] = money(r0[k], label); } catch (e) { errs.push(e.message); } }
    const key = s ? `s${s.id}` : `n${no || name}`;
    if (seen.has(key)) errs.push('مكرر داخل الملف'); seen.add(key);
    if (create) warn.push('سيُنشأ في موظفي المتابعة بلا وحدة (عيّنها من جدول الرواتب)');
    plan.push({ r0, s, create, no, name, vals, errs });
    results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: warn, action, label: `${no || '—'}${name ? ' · ' + name : ''}`, gross: grossOf(withAllowances(vals, cfg)) });
  }
  const bad = results.filter(x => !x.ok);
  const out = { mode: commit ? 'commit' : 'preview', total: rows.length, valid: results.length - bad.length, invalid: bad.length, rows: results };
  if (commit) {
    if (bad.length && !skipInvalid) throw httpError(400, `يوجد ${bad.length} صفاً غير صالح؛ صحّحها أو اختر تجاهل الصفوف الخاطئة`);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const p of plan.filter(x => !x.errs.length)) {
        let id = p.s?.id;
        if (p.create) id = (await c.query("INSERT INTO leave_staff(emp_no, full_name, status, created_by) VALUES ($1,$2,'active',$3) RETURNING id", [p.no, p.name, req.user.username])).rows[0].id;
        await c.query(`INSERT INTO payroll_salaries(employee_id, basic, housing, transport, other, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (employee_id) DO UPDATE SET basic = EXCLUDED.basic, housing = EXCLUDED.housing, transport = EXCLUDED.transport, other = EXCLUDED.other, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [id, p.vals.basic, p.vals.housing, p.vals.transport, p.vals.other, req.user.username]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    out.applied = out.valid;
    await audit(req, 'import', 'payroll_salary', 'excel', null, { applied: out.valid, created: plan.filter(x => x.create && !x.errs.length).length });
  }
  res.json(out);
}));

// ---------- الإضافي والانتدابات ----------
const KINDS = { overtime: { list: 'overtime_types', unit: 'ساعة', max: 744 }, assignment: { list: 'assignment_types', unit: 'يوم', max: 366 } };

function entryRow(x) { return { ...x, fixed_amount: Number(x.fixed_amount ?? 0), quantity: Number(x.quantity), percent: Number(x.percent), base_salary: Number(x.base_salary), unit_wage: Number(x.unit_wage), amount: Number(x.amount) }; }

async function computeEntry(kind, b, st) {
  const K = KINDS[kind];
  const emp = (await q('SELECT id, full_name, job_title FROM leave_staff WHERE id = $1', [+b.employee_id])).rows[0];
  if (!emp) throw httpError(400, 'الموظف غير موجود');
  if (!isDate(String(b.entry_date))) throw httpError(400, 'التاريخ غير صالح');
  const type = st[K.list].find(t => t.id === b.type_id);
  if (!type) throw httpError(400, 'النوع غير موجود في الإعدادات');
  const qty = Number(String(b.quantity ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.'));
  if (!(qty > 0 && qty <= K.max)) throw httpError(400, `${kind === 'overtime' ? 'عدد الساعات' : 'عدد الأيام'} غير صالح (أكبر من 0 وحتى ${K.max})`);
  const percent = b.percent === undefined || b.percent === null || b.percent === '' ? type.percent : Number(b.percent);
  if (!(percent >= 0 && percent <= 1000)) throw httpError(400, 'النسبة غير صالحة');
  const common = { emp, entry_date: String(b.entry_date), pay_month: monthOf(b.pay_month, String(b.entry_date).slice(0, 7)), type, quantity: round2(qty), notes: String(b.notes ?? '').trim().slice(0, 300) || null };
  if (kind === 'assignment') {
    const grade = String(b.assignment_title ?? '').trim() || (await q('SELECT assignment_title FROM payroll_salaries WHERE employee_id = $1', [emp.id])).rows[0]?.assignment_title;
    if (String(b.assignment_title ?? '').trim() && !findRate(st.assignment_rates, grade)) throw httpError(400, 'مسمى الانتداب غير موجود في الإعدادات');
    const rate = findRate(st.assignment_rates, grade);
    if (rate) { const a = assignmentByRate(qty, rate); return { ...common, percent: 100, base: a.unit_wage, unit_wage: a.unit_wage, fixed: a.fixed, amount: a.amount, breakdown: { title: rate.title, grade: rate.title, living: rate.living, assignment: rate.assignment, transport: rate.transport } }; }
  }
  const sal = (await staffRows({ status: 'all', ids: [emp.id] }))[0];
  const base = baseOf(sal, st);
  if (!(base > 0)) throw httpError(400, `لا يوجد راتب مسجّل لـ «${emp.full_name}» (أدخله من تبويب الرواتب)`);
  const { unit_wage, amount } = entryAmount(kind, qty, percent, base, st);
  return { emp, entry_date: String(b.entry_date), pay_month: monthOf(b.pay_month, String(b.entry_date).slice(0, 7)), type, quantity: round2(qty), percent: round2(percent), base, unit_wage, fixed: 0, breakdown: null, amount, notes: String(b.notes ?? '').trim().slice(0, 300) || null };
}
async function capWarning(kind, employeeId, month, st, excludeId = 0) {
  if (kind !== 'overtime' || !(st.overtime_monthly_cap_hours > 0)) return null;
  const hours = Number((await q("SELECT COALESCE(sum(quantity),0) AS h FROM payroll_entries WHERE kind = 'overtime' AND employee_id = $1 AND pay_month = $2 AND id <> $3", [employeeId, month, excludeId])).rows[0].h);
  return { hours, cap: st.overtime_monthly_cap_hours };
}

r.get('/entries', G('view'), wrap(async (req, res) => {
  const kind = KINDS[req.query.kind] ? req.query.kind : 'overtime';
  const month = monthOf(req.query.month, currentMonth());
  const p = [kind, month];
  const where = ['e.kind = $1', 'e.pay_month = $2'];
  if (Number.isInteger(+req.query.employee_id) && +req.query.employee_id > 0) { p.push(+req.query.employee_id); where.push(`e.employee_id = $${p.length}`); }
  const rows = (await q(`SELECT e.*, s.full_name, s.emp_no FROM payroll_entries e JOIN leave_staff s ON s.id = e.employee_id WHERE ${where.join(' AND ')} ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000`, p)).rows.map(entryRow);
  res.json({ kind, month, rows, totals: { count: rows.length, quantity: round2(rows.reduce((a, x) => a + x.quantity, 0)), amount: round2(rows.reduce((a, x) => a + x.amount, 0)) } });
}));

r.post('/entries', G('entries'), wrap(async (req, res) => {
  const kind = KINDS[req.body?.kind] ? req.body.kind : null;
  if (!kind) throw httpError(400, 'النوع غير صالح');
  const st = await loadSettings();
  const c = await computeEntry(kind, req.body, st);
  const warn = await capWarning(kind, c.emp.id, c.pay_month, st);
  const row = (await q(`INSERT INTO payroll_entries(kind, employee_id, entry_date, pay_month, type_id, type_name, quantity, percent, base_salary, unit_wage, amount, notes, created_by, fixed_amount, breakdown)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [kind, c.emp.id, c.entry_date, c.pay_month, c.type.id, c.type.name, c.quantity, c.percent, c.base, c.unit_wage, c.amount, c.notes, req.user.username, c.fixed, c.breakdown ? JSON.stringify(c.breakdown) : null])).rows[0];
  await audit(req, 'create', `payroll_${kind}`, row.id, null, { employee: c.emp.full_name, quantity: c.quantity, percent: c.percent, amount: c.amount, pay_month: c.pay_month });
  const over = warn && warn.hours + c.quantity > warn.cap ? { hours: round2(warn.hours + c.quantity), cap: warn.cap } : null;
  res.status(201).json({ row: entryRow(row), warning: over });
}));

r.put('/entries/:id', G('entries'), wrap(async (req, res) => {
  const old = (await q('SELECT * FROM payroll_entries WHERE id = $1', [+req.params.id])).rows[0];
  if (!old) throw httpError(404, 'البند غير موجود');
  const st = await loadSettings();
  const merged = { employee_id: old.employee_id, entry_date: old.entry_date instanceof Date ? old.entry_date.toISOString().slice(0, 10) : String(old.entry_date).slice(0, 10), type_id: old.type_id, quantity: old.quantity, pay_month: old.pay_month, notes: old.notes, assignment_title: old.breakdown?.title, ...req.body };
  if ('entry_date' in (req.body || {}) && !('pay_month' in req.body)) merged.pay_month = String(req.body.entry_date).slice(0, 7);
  const c = await computeEntry(old.kind, merged, st);
  const warn = await capWarning(old.kind, c.emp.id, c.pay_month, st, old.id);
  const row = (await q(`UPDATE payroll_entries SET employee_id=$2, entry_date=$3, pay_month=$4, type_id=$5, type_name=$6, quantity=$7, percent=$8, base_salary=$9, unit_wage=$10, amount=$11, notes=$12, fixed_amount=$13, breakdown=$14, updated_at=now() WHERE id=$1 RETURNING *`,
    [old.id, c.emp.id, c.entry_date, c.pay_month, c.type.id, c.type.name, c.quantity, c.percent, c.base, c.unit_wage, c.amount, c.notes, c.fixed, c.breakdown ? JSON.stringify(c.breakdown) : null])).rows[0];
  await audit(req, 'update', `payroll_${old.kind}`, old.id, { quantity: Number(old.quantity), amount: Number(old.amount) }, { quantity: c.quantity, amount: c.amount, pay_month: c.pay_month });
  const over = warn && warn.hours + c.quantity > warn.cap ? { hours: round2(warn.hours + c.quantity), cap: warn.cap } : null;
  res.json({ row: entryRow(row), warning: over });
}));

r.delete('/entries/:id', G('entries'), wrap(async (req, res) => {
  const old = (await q('DELETE FROM payroll_entries WHERE id = $1 RETURNING kind, employee_id, quantity, amount, pay_month', [+req.params.id])).rows[0];
  if (!old) throw httpError(404, 'البند غير موجود');
  await audit(req, 'delete', `payroll_${old.kind}`, req.params.id, { employee_id: old.employee_id, quantity: Number(old.quantity), amount: Number(old.amount), pay_month: old.pay_month }, null);
  res.json({ ok: true });
}));

// ---------- التقرير والتصدير ----------
async function monthReport(month) {
  const rows = await staffRows({ status: 'active' });
  const ent = (await q(`SELECT employee_id, kind, sum(quantity)::float8 AS qty, sum(amount)::float8 AS amount FROM payroll_entries WHERE pay_month = $1 GROUP BY employee_id, kind`, [month])).rows;
  const by = new Map();
  for (const e of ent) by.set(`${e.employee_id}|${e.kind}`, e);
  const out = rows.map(x => {
    const ot = by.get(`${x.employee_id}|overtime`), as = by.get(`${x.employee_id}|assignment`);
    const row = { ...x, overtime_hours: ot ? round2(ot.qty) : 0, overtime_amount: ot ? round2(ot.amount) : 0, assignment_days: as ? round2(as.qty) : 0, assignment_amount: as ? round2(as.amount) : 0 };
    row.total = round2(row.gross + row.overtime_amount + row.assignment_amount);
    return row;
  });
  return out;
}

// ---------- استيراد الإضافي والانتدابات من Excel ----------
const arDigits = v => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const ENTRY_COLS = (kind) => [['emp_no', 'الرقم الوظيفي'], ['full_name', 'الاسم'], ['entry_date', 'التاريخ'], ['type', 'النوع'], ['quantity', kind === 'overtime' ? 'الساعات' : 'الأيام'], ['pay_month', 'شهر الصرف'], ['notes', 'ملاحظات']];
const ENTRY_ALIASES = { 'الكمية': 'quantity', 'عدد الساعات': 'quantity', 'عدد الأيام': 'quantity', 'الساعات': 'quantity', 'الأيام': 'quantity', 'اليوم': 'entry_date', 'تاريخ': 'entry_date', 'نوع الإضافي': 'type', 'نوع الانتداب': 'type', 'الشهر': 'pay_month' };
function parseEntryDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const t = arDigits(cellText(v)).replace(/\s+/g, '');
  let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(t);
  if (!m) { const d = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(t); if (d) m = [0, d[3], d[2], d[1]]; }
  if (!m) return '';
  const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return isDate(iso) ? iso : '';
}
function parsePayMonth(v) {
  const t = arDigits(cellText(v instanceof Date ? v.toISOString().slice(0, 7) : v)).replace(/\s+/g, '');
  if (!t) return '';
  let m = /^(\d{4})[-\/.](\d{1,2})/.exec(t);
  if (!m) { const d = /^(\d{1,2})[-\/.](\d{4})$/.exec(t); if (d) m = [0, d[2], d[1]]; }
  if (!m) return null;
  const mm = `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  return MONTH_RE.test(mm) ? mm : null;
}
async function readEntryRows(file, kind) {
  const wb = new ExcelJS.Workbook();
  try { if ((file.originalname || '').toLowerCase().endsWith('.csv')) await wb.csv.read((await import('node:stream')).Readable.from(file.buffer)); else await wb.xlsx.load(file.buffer); }
  catch { throw httpError(400, 'تعذّرت قراءة الملف؛ استخدم نموذج Excel'); }
  const ws = wb.worksheets[0];
  if (!ws) throw httpError(400, 'الملف فارغ');
  const labels = new Map([...ENTRY_COLS(kind).flatMap(c => [[c[1], c[0]], [c[0], c[0]]]), ...Object.entries(ENTRY_ALIASES)]);
  const headersOf = row => { const h = []; row.eachCell((c, i) => { h[i] = labels.get(cellText(c.value).replace(/\s+/g, ' ')) || null; }); return h; };
  let headers = headersOf(ws.getRow(1)), best = headers.filter(Boolean).length, hr = 1;
  for (let n = 2; n <= Math.min(10, ws.rowCount); n++) { const h = headersOf(ws.getRow(n)); const c = h.filter(Boolean).length; if (c > best) { best = c; headers = h; hr = n; } }
  if (!headers.includes('quantity') || !headers.includes('entry_date') || !headers.includes('type') || !(headers.includes('emp_no') || headers.includes('full_name'))) throw httpError(400, 'لم تُطابق أعمدة الملف النموذج: يلزم «الرقم الوظيفي» أو «الاسم» مع «التاريخ» و«النوع» و«' + (kind === 'overtime' ? 'الساعات' : 'الأيام') + '». حمّل النموذج من زر «تنزيل النموذج».');
  const out = [];
  ws.eachRow((row, n) => {
    if (n <= hr) return;
    const o = { _row: n }; let any = false;
    row.eachCell({ includeEmpty: false }, (c, i) => { const k = headers[i]; if (!k) return; o[k] = k === 'entry_date' || k === 'pay_month' ? c.value : cellText(c.value); if (cellText(c.value) !== '' || c.value instanceof Date) any = true; });
    if (String(o.emp_no || o.full_name || '').startsWith('↑')) return;
    if (any) out.push(o);
  });
  if (!out.length) throw httpError(400, 'لا توجد صفوف بيانات');
  if (out.length > 2000) throw httpError(400, 'الحد الأقصى 2000 صف في المرة الواحدة');
  return out;
}

r.get('/entries/template', G('entries'), wrap(async (req, res) => {
  const kind = KINDS[req.query.kind] ? req.query.kind : 'overtime';
  const st = await loadSettings();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'overtime' ? 'الإضافي' : 'الانتدابات', { views: [{ rightToLeft: true }] });
  const head = ws.addRow(ENTRY_COLS(kind).map(c => c[1]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center' }; });
  const first = st[KINDS[kind].list][0];
  ws.addRow(['1001', 'محمد أحمد العتيبي', '2026-11-05', first.name, kind === 'overtime' ? 3.5 : 2, '', 'مثال']).font = { italic: true, color: { argb: 'FF888888' } };
  ws.addRow(['↑ صف مثال: احذفه قبل الرفع. «النوع» أحد: ' + st[KINDS[kind].list].map(t => t.name).join(' / ') + ' · «شهر الصرف» اختياري (YYYY-MM) وإن تُرك فيُؤخذ الشهر المختار في الصفحة']).font = { color: { argb: 'FFC00000' } };
  ws.columns.forEach(c => { c.width = 24; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${kind}-template.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

r.post('/entries/import', G('entries'), upload, wrap(async (req, res) => {
  if (!req.file) throw httpError(400, 'لم يُرفع ملف');
  const kind = KINDS[req.query.kind] ? req.query.kind : 'overtime';
  const commit = req.query.mode === 'commit', skipInvalid = req.query.skip_invalid === '1';
  const defMonth = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const st = await loadSettings();
  const types = st[KINDS[kind].list];
  const rows = await readEntryRows(req.file, kind);
  const staff = (await q('SELECT id, emp_no, full_name FROM leave_staff')).rows.map(x => ({ ...x, norm: normalizeName(x.full_name), tokens: new Set(normalizeName(x.full_name).split(' ').filter(Boolean)) }));
  const byNo = new Map(staff.filter(x => x.emp_no).map(x => [String(x.emp_no), x]));
  const matchName = name => {
    const norm = normalizeName(name); if (!norm) return { none: true };
    const toks = new Set(norm.split(' ').filter(Boolean));
    const exact = staff.filter(x => x.norm === norm); if (exact.length === 1) return { s: exact[0] }; if (exact.length > 1) return { many: exact.length };
    const sub = staff.filter(x => x.tokens.size >= 2 && toks.size >= 2 && ([...x.tokens].every(t => toks.has(t)) || [...toks].every(t => x.tokens.has(t))));
    return sub.length === 1 ? { s: sub[0] } : sub.length > 1 ? { many: sub.length } : { none: true };
  };
  const matchType = text => {
    const n = normalizeName(text); if (!n) return null;
    const exact = types.filter(t => normalizeName(t.name) === n || t.id === text.trim()); if (exact.length === 1) return exact[0];
    const part = types.filter(t => normalizeName(t.name).includes(n) || n.includes(normalizeName(t.name))); return part.length === 1 ? part[0] : null;
  };
  const plan = [], results = [], seen = new Set();
  for (const r0 of rows) {
    const errs = [], warn = []; const no = String(r0.emp_no || '').trim(), name = String(r0.full_name || '').trim();
    let s = no ? byNo.get(no) : null, action = 'إضافة';
    if (!s && name) { const m = matchName(name); if (m.s) { s = m.s; action = `ربط بالاسم بـ «${s.full_name}»`; } else if (m.many) errs.push(`الاسم يطابق ${m.many} موظفين؛ استخدم الرقم الوظيفي`); else errs.push('الموظف غير موجود'); }
    else if (!s) errs.push(no ? 'الرقم الوظيفي غير موجود' : 'الرقم الوظيفي والاسم فارغان');
    const date = parseEntryDate(r0.entry_date); if (!date) errs.push('تاريخ غير صالح (استخدم YYYY-MM-DD)');
    const type = matchType(String(r0.type || '')); if (!type) errs.push(`النوع «${r0.type || ''}» غير موجود في الإعدادات`);
    let pm = parsePayMonth(r0.pay_month); if (pm === null) { errs.push('شهر الصرف غير صالح (YYYY-MM)'); pm = ''; }
    pm = pm || defMonth || (date ? date.slice(0, 7) : '');
    let c = null;
    if (!errs.length) {
      try { c = await computeEntry(kind, { employee_id: s.id, entry_date: date, pay_month: pm, type_id: type.id, quantity: arDigits(r0.quantity).replace(/٫/g, '.').replace(/[,٬،\s]/g, ''), notes: r0.notes }, st); }
      catch (e) { errs.push(e.message); }
    }
    if (c) {
      const key = `${s.id}|${c.entry_date}|${c.type.id}|${c.quantity}|${c.pay_month}`;
      if (seen.has(key)) errs.push('مكرر داخل الملف'); seen.add(key);
      const dup = (await q('SELECT 1 FROM payroll_entries WHERE kind = $1 AND employee_id = $2 AND entry_date = $3 AND type_id = $4 AND quantity = $5 AND pay_month = $6 LIMIT 1', [kind, s.id, c.entry_date, c.type.id, c.quantity, c.pay_month])).rows.length;
      if (dup) errs.push('بند مطابق مسجّل مسبقاً');
    }
    plan.push({ c, errs });
    results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: warn, action, label: `${no || '—'}${name ? ' · ' + name : ''}`, date, type_name: type?.name || '', quantity: c?.quantity ?? null, amount: c?.amount ?? 0, pay_month: pm });
  }
  const bad = results.filter(x => !x.ok);
  const out = { mode: commit ? 'commit' : 'preview', total: rows.length, valid: results.length - bad.length, invalid: bad.length, amount: round2(results.filter(x => x.ok).reduce((a, x) => a + x.amount, 0)), rows: results };
  if (commit) {
    if (bad.length && !skipInvalid) throw httpError(400, `يوجد ${bad.length} صفاً غير صالح؛ صحّحها أو اختر تجاهل الصفوف الخاطئة`);
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      for (const p of plan.filter(x => !x.errs.length)) {
        const c = p.c;
        await cx.query(`INSERT INTO payroll_entries(kind, employee_id, entry_date, pay_month, type_id, type_name, quantity, percent, base_salary, unit_wage, amount, notes, created_by, fixed_amount, breakdown) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [kind, c.emp.id, c.entry_date, c.pay_month, c.type.id, c.type.name, c.quantity, c.percent, c.base, c.unit_wage, c.amount, c.notes, req.user.username, c.fixed, c.breakdown ? JSON.stringify(c.breakdown) : null]);
      }
      await cx.query('COMMIT');
    } catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
    out.applied = out.valid;
    await audit(req, 'import', `payroll_${kind}`, 'excel', null, { applied: out.valid, amount: out.amount });
  }
  res.json(out);
}));

r.get('/report', G('view'), wrap(async (req, res) => {
  const month = monthOf(req.query.month, currentMonth());
  const rows = await monthReport(month);
  const sum = k => round2(rows.reduce((a, x) => a + x[k], 0));
  res.json({ month, rows, totals: { employees: rows.length, without_salary: rows.filter(x => !x.has_salary).length, salaries: sum('gross'), overtime_hours: sum('overtime_hours'), overtime_amount: sum('overtime_amount'),
    assignment_days: sum('assignment_days'), assignment_amount: sum('assignment_amount'), total: sum('total') } });
}));

// بحث موظفين لإدخال الإضافي والانتدابات (مع مكوّنات الراتب للحساب الفوري)
r.get('/staff', G('entries'), wrap(async (req, res) => {
  const rows = await staffRows({ status: 'active', term: String(req.query.q || '').trim().slice(0, 60) });
  res.json({ employees: rows.slice(0, 40).map(x => ({ id: x.employee_id, emp_no: x.emp_no, full_name: x.full_name, job_title: x.job_title, assignment_title: x.assignment_title, sector: x.sector, department: x.department, section: x.section, basic: x.basic, housing: x.housing, transport: x.transport, other: x.other, has_salary: x.has_salary })) });
}));

r.get('/export', G('view'), wrap(async (req, res) => {
  const month = monthOf(req.query.month, currentMonth());
  const rows = await monthReport(month);
  const wb = new ExcelJS.Workbook();
  const COLS = [['الموظفون', 'employees'], ['إجمالي الرواتب', 'salaries'], ['ساعات الإضافي', 'overtime_hours'], ['مبلغ الإضافي', 'overtime_amount'], ['أيام الانتداب', 'assignment_days'], ['مبلغ الانتداب', 'assignment_amount'], ['الإجمالي المستحق', 'total']];
  const sheet = (name, head, data) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }] });
    ws.addRow([`الرواتب والإضافي — ${month}`]).font = { bold: true, size: 14 };
    const hr = ws.addRow(head); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center', wrapText: true }; });
    for (const d of data) ws.addRow(d);
    ws.columns.forEach(c => { c.width = 20; });
    return ws;
  };
  for (const [lvl, label] of [['sector', 'القطاع'], ['department', 'الإدارة'], ['section', 'القسم']]) {
    const g = groupRows(rows, lvl);
    const ws = sheet(`حسب ${label}`, [label, ...COLS.map(c => c[0])], g.map(x => [x.name, ...COLS.map(c => x[c[1]])]));
    const tot = ws.addRow(['الإجمالي', ...COLS.map(c => round2(g.reduce((a, x) => a + x[c[1]], 0)))]); tot.font = { bold: true };
  }
  sheet('حسب الموظف', ['الرقم الوظيفي', 'الاسم', 'القطاع', 'الإدارة', 'القسم', 'الأساسي', 'السكن', 'النقل', 'أخرى', 'الراتب الإجمالي', 'ساعات الإضافي', 'مبلغ الإضافي', 'أيام الانتداب', 'مبلغ الانتداب', 'الإجمالي المستحق'],
    rows.map(x => [x.emp_no, x.full_name, x.sector || '', x.department || '', x.section || '', x.basic, x.housing, x.transport, x.other, x.gross, x.overtime_hours, x.overtime_amount, x.assignment_days, x.assignment_amount, x.total]));
  await audit(req, 'export', 'payroll_report', month, null, { rows: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${month}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

export default r;
