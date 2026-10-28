// متابعة أرصدة الإجازات: حقول يعبّئها المسؤول لكل موظف وسنة، وتُحسب منها التكلفة المالية والمؤشرات.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q, pool } from '../db/pool.js';
import { requirePerm, audit, wrap, canSeeFinancials, can } from '../lib/auth.js';
import { resolveScope } from '../lib/rbac.js';
import { loadPolicy } from '../lib/context.js';
import { httpError, isDate } from '../lib/util.js';
import { resetOrgGraph } from '../lib/orggraph.js';

const r = Router();
const round2 = x => Math.round(x * 100) / 100;
const numOrNull = (v, label, { min = 0 } = {}) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || (min !== null && n < min)) throw httpError(400, `قيمة غير صالحة: ${label}`);
  return round2(n);
};

/** يحسب المؤشرات المشتقة لصف واحد؛ الحقول المالية تُعاد فقط لمن يملك صلاحية الاطلاع المالي */
export function derive(row, policy, fin) {
  const divisor = policy.day_divisor || 30;
  const total = row.total_balance, target = row.target_days, used = row.used_days ?? 0;
  const rate = fin && row.gross_salary !== null ? row.gross_salary / divisor : null;
  const remaining = target !== null ? Math.max(0, target - used) : null;       // المتبقي لتحقيق المستهدف
  const expected = total !== null && remaining !== null ? total - remaining : null;   // الرصيد المتوقع نهاية السنة إن تحقق المستهدف
  const pos = x => (x > 0 ? x : 0);
  const missing = [];
  if (!row.emp_no) missing.push('الرقم الوظيفي');
  if (!row.hire_date) missing.push('تاريخ التعيين');
  if (row.annual_balance === null) missing.push('الرصيد السنوي');
  if (total === null) missing.push('الرصيد الكلي');
  if (target === null) missing.push('المستهدف');
  if (fin && row.gross_salary === null) missing.push('الراتب الإجمالي');
  const out = {
    remaining_to_target: remaining === null ? null : round2(remaining),
    expected_balance: expected === null ? null : round2(expected),
    progress_pct: target > 0 ? Math.min(100, round2(used / target * 100)) : null,
    target_met: target !== null && target > 0 ? used >= target : null,
    high_balance: total !== null && total > policy.max_balance_cap,
    service_years: row.hire_date ? Math.max(0, round2((Date.now() - new Date(row.hire_date).getTime()) / (365.25 * 864e5))) : null,
    missing,
    complete: missing.length === 0,
  };
  if (fin) {
    out.day_rate = rate === null ? null : round2(rate);
    out.cost_now = rate !== null && total !== null ? round2(pos(total) * rate) : null;               // تكلفة الرصيد الحالي
    out.cost_after_target = rate !== null && expected !== null ? round2(pos(expected) * rate) : null;  // التكلفة إن تحقق المستهدف
    out.saving = out.cost_now !== null && out.cost_after_target !== null ? round2(out.cost_now - out.cost_after_target) : null;
  }
  return out;
}

const SELECT = `SELECT e.id AS employee_id, e.emp_no, e.full_name, e.job_title, e.hire_date::text AS hire_date, e.status, e.org_unit_id, e.version,
    t.annual_balance::float8 AS annual_balance, t.total_balance::float8 AS total_balance, t.target_days::float8 AS target_days, t.used_days::float8 AS used_days,
    t.gross_salary::float8 AS gross_salary, t.notes, t.updated_by, t.updated_at
  FROM employees e LEFT JOIN leave_tracking t ON t.employee_id = e.id AND t.year = $1`;

async function unitPaths() {
  const units = (await q('SELECT id, name, unit_type, parent_id FROM org_units')).rows;
  const by = new Map(units.map(u => [u.id, u]));
  return id => {
    const p = { sector: null, department: null, section: null };
    for (let u = by.get(id); u; u = by.get(u.parent_id)) if (u.unit_type in p) p[u.unit_type] = u.name;
    return p;
  };
}

async function loadRows(req, year, { search = '', unit, status = 'active', incomplete = false, ids } = {}) {
  const sc = await resolveScope(req.user, 'hr', 'view');
  const fin = canSeeFinancials(req.user);
  const [policy, pathOf] = await Promise.all([loadPolicy(), unitPaths()]);
  const where = ['TRUE']; const p = [year];
  if (status && status !== 'all') { p.push(status); where.push(`e.status = $${p.length}`); }
  if (ids) { p.push(ids); where.push(`e.id = ANY($${p.length}::int[])`); }
  if (search) { p.push(`%${search}%`); where.push(`(e.full_name ILIKE $${p.length} OR e.emp_no ILIKE $${p.length} OR e.job_title ILIKE $${p.length})`); }
  if (unit) { p.push(+unit); where.push(`e.org_unit_id IN (WITH RECURSIVE t AS (SELECT id FROM org_units WHERE id = $${p.length} UNION ALL SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT id FROM t)`); }
  if (!sc.all) {
    const parts = [];
    if (sc.unitIds?.size) { p.push([...sc.unitIds]); parts.push(`e.org_unit_id = ANY($${p.length}::int[])`); }
    if (sc.employeeIds?.size) { p.push([...sc.employeeIds]); parts.push(`e.id = ANY($${p.length}::int[])`); }
    where.push(parts.length ? `(${parts.join(' OR ')})` : 'FALSE');
  }
  const rows = (await q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.full_name, e.id`, p)).rows;
  let out = rows.map(x => {
    const path = pathOf(x.org_unit_id);
    const base = { ...x, sector: path.sector, department: path.department, section: path.section };
    if (!fin) delete base.gross_salary;
    return { ...base, ...derive({ ...x, gross_salary: fin ? x.gross_salary : null }, policy, fin) };
  });
  if (incomplete) out = out.filter(x => !x.complete);
  return { rows: out, fin, policy };
}

function summarize(rows, fin) {
  const s = (k) => round2(rows.reduce((a, x) => a + (x[k] ?? 0), 0));
  const out = { employees: rows.length, complete: rows.filter(x => x.complete).length, incomplete: rows.filter(x => !x.complete).length,
    annual_balance: s('annual_balance'), total_balance: s('total_balance'), target_days: s('target_days'), used_days: s('used_days'),
    remaining_to_target: s('remaining_to_target'), high_balance: rows.filter(x => x.high_balance).length, target_met: rows.filter(x => x.target_met).length };
  if (fin) Object.assign(out, { cost_now: s('cost_now'), cost_after_target: s('cost_after_target'), saving: s('saving') });
  return out;
}

const yearOf = req => { const y = +req.query.year || new Date().getFullYear(); if (!(y >= 2000 && y <= 2100)) throw httpError(400, 'سنة غير صالحة'); return y; };

r.get('/', wrap(async (req, res) => {
  const year = yearOf(req);
  const { rows, fin, policy } = await loadRows(req, year, { search: (req.query.search || '').trim(), unit: req.query.unit, status: req.query.status || 'active', incomplete: req.query.incomplete === '1' });
  res.json({ year, fin, max_balance_cap: policy.max_balance_cap, can_edit: can(req.user, 'employees'), rows, summary: summarize(rows, fin) });
}));

// تعديل حقول المتابعة لموظف وسنة (وتاريخ التعيين/الرقم الوظيفي في السجل المركزي)
r.put('/:employeeId', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.employeeId; const b = req.body || {};
  const year = +b.year || new Date().getFullYear();
  const fin = canSeeFinancials(req.user);
  const emp = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!emp) throw httpError(404, 'الموظف غير موجود');
  const sc = await resolveScope(req.user, 'hr', 'view');
  if (!sc.all && !(sc.unitIds?.has(emp.org_unit_id) || sc.employeeIds?.has(id))) throw httpError(404, 'الموظف غير موجود');

  const trackCols = {};
  if ('annual_balance' in b) trackCols.annual_balance = numOrNull(b.annual_balance, 'الرصيد السنوي');
  if ('total_balance' in b) trackCols.total_balance = numOrNull(b.total_balance, 'الرصيد الكلي', { min: null });
  if ('target_days' in b) trackCols.target_days = numOrNull(b.target_days, 'المستهدف');
  if ('used_days' in b) trackCols.used_days = numOrNull(b.used_days, 'المستخدم');
  if ('notes' in b) trackCols.notes = String(b.notes ?? '').trim().slice(0, 500) || null;
  if ('gross_salary' in b) {
    if (!fin) throw httpError(403, 'لا تملك صلاحية تعديل الراتب');
    trackCols.gross_salary = numOrNull(b.gross_salary, 'الراتب الإجمالي');
  }
  const empCols = {};
  if ('emp_no' in b) { const v = String(b.emp_no ?? '').trim(); if (!v) throw httpError(400, 'لا يمكن تفريغ الرقم الوظيفي'); empCols.emp_no = v; }
  if ('hire_date' in b) { const v = String(b.hire_date ?? '').trim(); if (!isDate(v)) throw httpError(400, 'تاريخ التعيين غير صالح'); empCols.hire_date = v; }

  const old = (await loadRows(req, year, { status: 'all', ids: [id] })).rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Object.keys(empCols).length) {
      const ks = Object.keys(empCols);
      await client.query(`UPDATE employees SET ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, [id, ...ks.map(k => empCols[k])]);
    }
    const ks = Object.keys(trackCols);
    if (ks.length) {
      await client.query(`INSERT INTO leave_tracking(employee_id, year, ${ks.join(', ')}, updated_by) VALUES ($1, $2, ${ks.map((_, i) => `$${i + 3}`).join(', ')}, $${ks.length + 3})
        ON CONFLICT (employee_id, year) DO UPDATE SET ${ks.map(k => `${k} = EXCLUDED.${k}`).join(', ')}, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, year, ...ks.map(k => trackCols[k]), req.user.username]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') throw httpError(409, 'الرقم الوظيفي مستخدم لموظف آخر');
    throw e;
  } finally { client.release(); }
  resetOrgGraph();
  const fresh = (await loadRows(req, year, { status: 'all', ids: [id] })).rows[0];
  await audit(req, 'update', 'leave_tracking', id, old, fresh);
  res.json({ row: fresh });
}));

// نسخ بيانات السنة السابقة (الراتب الإجمالي والرصيد السنوي) إلى سنة جديدة لمن ليس لهم صف فيها
r.post('/copy-year', requirePerm('employees'), wrap(async (req, res) => {
  const from = +req.body?.from, to = +req.body?.to;
  if (!(from >= 2000 && to >= 2000 && from !== to)) throw httpError(400, 'سنتان غير صالحتين');
  const sc = await resolveScope(req.user, 'hr', 'view');
  if (!sc.all) throw httpError(403, 'النسخ الجماعي لمن يملك نطاق كل المنشأة');
  const fin = canSeeFinancials(req.user);
  const { rowCount } = await q(`INSERT INTO leave_tracking(employee_id, year, annual_balance, gross_salary, updated_by)
    SELECT employee_id, $2, annual_balance, ${fin ? 'gross_salary' : 'NULL'}, $3 FROM leave_tracking WHERE year = $1
    ON CONFLICT (employee_id, year) DO NOTHING`, [from, to, req.user.username]);
  await audit(req, 'copy', 'leave_tracking', `${from}->${to}`, null, { copied: rowCount });
  res.json({ copied: rowCount });
}));

r.get('/export', wrap(async (req, res) => {
  const year = yearOf(req);
  const { rows, fin } = await loadRows(req, year, { search: (req.query.search || '').trim(), unit: req.query.unit, status: req.query.status || 'active', incomplete: req.query.incomplete === '1' });
  const cols = [['الرقم الوظيفي', 'emp_no'], ['الاسم', 'full_name'], ['المسمى', 'job_title'], ['القطاع', 'sector'], ['الإدارة', 'department'], ['القسم', 'section'], ['تاريخ التعيين', 'hire_date'],
    ...(fin ? [['الراتب الإجمالي', 'gross_salary']] : []), ['الرصيد السنوي', 'annual_balance'], ['الرصيد الكلي', 'total_balance'], ['المستهدف', 'target_days'], ['المستخدم', 'used_days'], ['المتبقي للمستهدف', 'remaining_to_target'],
    ...(fin ? [['أجر اليوم', 'day_rate'], ['التكلفة المالية للرصيد الحالي', 'cost_now'], ['التكلفة بعد تحقق المستهدف', 'cost_after_target'], ['التوفير المتوقع', 'saving']] : []), ['ملاحظات', 'notes']];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`متابعة ${year}`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }] });
  ws.addRow([`متابعة أرصدة الإجازات — ${year}`]).font = { bold: true, size: 14 };
  const head = ws.addRow(cols.map(c => c[0]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  for (const x of rows) ws.addRow(cols.map(([, k]) => x[k] ?? ''));
  const sum = summarize(rows, fin);
  const tot = ws.addRow(cols.map(([, k]) => (k === 'full_name' ? 'الإجمالي' : sum[k] ?? '')));
  tot.font = { bold: true };
  ws.columns.forEach(c => { c.width = 18; });
  await audit(req, 'export', 'leave_tracking', year, null, { rows: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="leave-tracking-${year}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

export default r;
