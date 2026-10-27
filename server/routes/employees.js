import { Router } from 'express';
import { q, pool } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { buildContext } from '../lib/context.js';
import { httpError, isDate, num, publicEmployee } from '../lib/util.js';
import { canSeeFinancials } from '../lib/auth.js';
import { leaveSalaryAt } from '../lib/engine.js';

const r = Router();

function ensureInScope(ctx, id) {
  const e = ctx.all.find(x => x.id === id);
  if (!e || (ctx.allowedUnits && !ctx.allowedUnits.has(e.org_unit_id))) throw httpError(404, 'الموظف غير موجود');
  return e;
}

r.get('/', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, req.query);
  let list = ctx.list;
  const s = (req.query.search || '').trim();
  if (s) list = list.filter(e => e.full_name.includes(s) || e.emp_no.includes(s) || (e.job_title || '').includes(s));
  if (req.query.high === '1') list = list.filter(e => e.high_balance);
  if (req.query.met === 'no') list = list.filter(e => e.target_days !== null && e.m.projected_year_end > e.target_days);
  if (req.query.met === 'yes') list = list.filter(e => e.target_days !== null && e.m.projected_year_end <= e.target_days);
  res.json({ year: ctx.year, asOf: ctx.asOf, rows: list.map(e => publicEmployee(e, req.user)) });
}));

r.get('/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const ctx = await buildContext(req.user, { year: req.query.year, asOf: req.query.asOf });
  const e = ensureInScope(ctx, id);
  const [allow, hist, tx, orgh, tgt] = await Promise.all([
    q('SELECT * FROM employee_allowances WHERE employee_id = $1 ORDER BY id', [id]),
    q('SELECT * FROM salary_history WHERE employee_id = $1 ORDER BY effective_date DESC', [id]),
    q('SELECT * FROM leave_transactions WHERE employee_id = $1 ORDER BY start_date DESC, id DESC', [id]),
    q(`SELECT h.*, f.name AS from_name, t.name AS to_name FROM org_history h LEFT JOIN org_units f ON f.id = h.from_unit_id
       JOIN org_units t ON t.id = h.to_unit_id WHERE employee_id = $1 ORDER BY moved_on DESC, h.id DESC`, [id]),
    q("SELECT * FROM targets WHERE scope_type = 'employee' AND scope_id = $1 ORDER BY year DESC", [id]),
  ]);
  const fin = canSeeFinancials(req.user);
  res.json({
    employee: publicEmployee(e, req.user),
    allowances: fin ? allow.rows : [],
    salary_history: fin ? hist.rows : [],
    transactions: tx.rows,
    org_history: orgh.rows,
    targets: tgt.rows,
  });
}));

function readBody(b, partial = false) {
  const need = ['emp_no', 'full_name', 'org_unit_id', 'hire_date'];
  if (!partial) for (const k of need) if (!b[k]) throw httpError(400, `الحقل مطلوب: ${k}`);
  if (b.hire_date && !isDate(b.hire_date)) throw httpError(400, 'تاريخ التعيين غير صالح');
  if (b.termination_date && !isDate(b.termination_date)) throw httpError(400, 'تاريخ نهاية الخدمة غير صالح');
  if (b.termination_date && b.hire_date && b.termination_date < b.hire_date) throw httpError(400, 'نهاية الخدمة قبل التعيين');
  if (b.opening_date && !isDate(b.opening_date)) throw httpError(400, 'تاريخ الرصيد الافتتاحي غير صالح');
  for (const k of ['basic_salary', 'leave_salary_override', 'annual_entitlement_days']) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== '' && !(Number(b[k]) >= 0)) throw httpError(400, `قيمة غير صالحة: ${k}`);
  }
}

async function saveAllowances(client, empId, list) {
  if (!Array.isArray(list)) return;
  await client.query('DELETE FROM employee_allowances WHERE employee_id = $1', [empId]);
  for (const a of list) {
    if (!a.name || !(Number(a.amount) >= 0)) continue;
    await client.query('INSERT INTO employee_allowances(employee_id, name, amount, include_in_leave) VALUES ($1,$2,$3,$4)', [empId, a.name, Number(a.amount), !!a.include_in_leave]);
  }
}

r.post('/', requirePerm('employees'), wrap(async (req, res) => {
  const b = req.body; readBody(b);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO employees(emp_no, full_name, job_title, org_unit_id, hire_date, termination_date, status, basic_salary,
         leave_salary_override, annual_entitlement_days, opening_balance, opening_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.emp_no.trim(), b.full_name.trim(), b.job_title || null, b.org_unit_id, b.hire_date, b.termination_date || null, b.status || 'active',
        num(b.basic_salary, 0), num(b.leave_salary_override), num(b.annual_entitlement_days), num(b.opening_balance, 0), b.opening_date || b.hire_date]);
    await saveAllowances(client, rows[0].id, b.allowances);
    await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on) VALUES ($1,NULL,$2,$3)', [rows[0].id, b.org_unit_id, b.hire_date]);
    await client.query('COMMIT');
    await audit(req, 'create', 'employee', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

r.put('/:id', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body; readBody(b, true);
  const old = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const n = { ...old, ...b };
  if (n.termination_date && n.termination_date < n.hire_date) throw httpError(400, 'نهاية الخدمة قبل التعيين');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE employees SET emp_no=$2, full_name=$3, job_title=$4, org_unit_id=$5, hire_date=$6, termination_date=$7, status=$8,
         basic_salary=$9, leave_salary_override=$10, annual_entitlement_days=$11, opening_balance=$12, opening_date=$13, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, n.emp_no, n.full_name, n.job_title || null, n.org_unit_id, n.hire_date, n.termination_date || null, n.status,
        num(n.basic_salary, 0), num(n.leave_salary_override), num(n.annual_entitlement_days), num(n.opening_balance, 0), n.opening_date]);
    if (old.org_unit_id !== rows[0].org_unit_id) {
      await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id) VALUES ($1,$2,$3)', [id, old.org_unit_id, rows[0].org_unit_id]);
    }
    const oldAllow = (await client.query('SELECT * FROM employee_allowances WHERE employee_id = $1', [id])).rows;
    if (Array.isArray(b.allowances)) await saveAllowances(client, id, b.allowances);
    const allow = (await client.query('SELECT * FROM employee_allowances WHERE employee_id = $1', [id])).rows;
    // حفظ تاريخ تغيّر الراتب المعتمد للإجازات حتى تبقى التقييمات التاريخية سليمة
    const before = leaveSalaryAt(old, oldAllow, [], '9999-12-31');
    const after = leaveSalaryAt(rows[0], allow, [], '9999-12-31');
    if (Math.abs(before - after) > 0.001) {
      const eff = isDate(b.salary_effective_date) ? b.salary_effective_date : new Date().toISOString().slice(0, 10);
      const has = (await client.query('SELECT 1 FROM salary_history WHERE employee_id = $1 LIMIT 1', [id])).rows.length;
      if (!has) await client.query("INSERT INTO salary_history(employee_id, effective_date, leave_salary) VALUES ($1,'1900-01-01',$2)", [id, before]);
      await client.query('INSERT INTO salary_history(employee_id, effective_date, leave_salary) VALUES ($1,$2,$3)', [id, eff, after]);
    }
    await client.query('COMMIT');
    await audit(req, 'update', 'employee', id, old, rows[0]);
    res.json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

r.delete('/:id', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.id;
  const old = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const used = await q('SELECT 1 FROM leave_transactions WHERE employee_id = $1 LIMIT 1', [id]);
  if (used.rows.length) throw httpError(409, 'للموظف حركات إجازات؛ غيّر حالته إلى "منتهي الخدمة" بدل الحذف');
  await q('DELETE FROM targets WHERE scope_type = $1 AND scope_id = $2', ['employee', id]);
  await q('DELETE FROM employees WHERE id = $1', [id]);
  await audit(req, 'delete', 'employee', id, old, null);
  res.json({ ok: true });
}));

export default r;
