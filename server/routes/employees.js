import { Router } from 'express';
import { q, pool } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { buildContext } from '../lib/context.js';
import { httpError, isDate, num, publicEmployee } from '../lib/util.js';
import { canSeeFinancials } from '../lib/auth.js';
import { leaveSalaryAt } from '../lib/engine.js';
import { normalizeName } from '../lib/text.js';
import { resetOrgGraph } from '../lib/orggraph.js';

const r = Router();

// تكرار الرقم الوظيفي برسالة واضحة
const dupErr = e => (e.code === '23505' && /emp_no/.test(e.constraint || e.detail || '') ? httpError(409, 'الرقم الوظيفي مستخدم لموظف آخر') : e);

function ensureInScope(ctx, id) {
  const e = ctx.all.find(x => x.id === id);
  const inScope = !ctx.allowedUnits && !ctx.allowedEmployees ? true : (ctx.allowedUnits?.has(e?.org_unit_id) || ctx.allowedEmployees?.has(e?.id));
  if (!e || !inScope) throw httpError(404, 'الموظف غير موجود');
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

// موظفو سجل الموظفين المركزي (دليل البوابة) الذين لم يُفعَّل لهم ملف الإجازات بعد
r.get('/pending/leave-profile', requirePerm('employees'), wrap(async (req, res) => {
  const { rows } = await q(`SELECT e.id, e.full_name, e.emp_no, e.job_title, e.org_unit_id, e.hire_date, e.status, u.name AS unit_name
    FROM employees e LEFT JOIN org_units u ON u.id = e.org_unit_id
    WHERE NOT e.leave_enabled AND e.status = 'active' ORDER BY e.full_name, e.id`);
  res.json({ rows });
}));

// تفعيل نظام الإجازات لموظف موجود أصلاً في السجل المركزي (نفس السجل، بلا تكرار)
r.post('/:id/enable-leave', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body; readBody(b);
  const old = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'الموظف غير موجود');
  if (old.leave_enabled) throw httpError(409, 'ملف الإجازات مفعّل لهذا الموظف مسبقاً');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`UPDATE employees SET emp_no=$2, full_name=$3, job_title=$4, org_unit_id=$5, hire_date=$6, termination_date=$7, status=$8, basic_salary=$9,
        leave_salary_override=$10, annual_entitlement_days=$11, opening_balance=$12, opening_date=$13, leave_enabled=TRUE, version=version+1, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, b.emp_no.trim(), b.full_name.trim(), b.job_title || null, b.org_unit_id, b.hire_date, b.termination_date || null, b.status || 'active',
      num(b.basic_salary, 0), num(b.leave_salary_override), num(b.annual_entitlement_days), num(b.opening_balance, 0), b.opening_date || b.hire_date])).rows[0];
    await saveAllowances(client, id, b.allowances);
    if (old.org_unit_id !== row.org_unit_id) {
      await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, old.org_unit_id, row.org_unit_id, b.hire_date, req.user.username, 'تفعيل نظام الإجازات']);
    }
    await client.query('COMMIT');
    resetOrgGraph();
    await audit(req, 'adopt', 'employee', id, old, row);
    res.status(201).json(row);
  } catch (e) { await client.query('ROLLBACK'); throw dupErr(e); } finally { client.release(); }
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
  if (b.opening_date && b.hire_date && b.opening_date < b.hire_date) throw httpError(400, 'تاريخ الرصيد الافتتاحي قبل تاريخ التعيين');
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
    const vals = [b.emp_no.trim(), b.full_name.trim(), b.job_title || null, b.org_unit_id, b.hire_date, b.termination_date || null, b.status || 'active',
      num(b.basic_salary, 0), num(b.leave_salary_override), num(b.annual_entitlement_days), num(b.opening_balance, 0), b.opening_date || b.hire_date];
    // السجل المركزي واحد: إن وُجد في دليل الموظفين موظف بالاسم نفسه ولا ملف إجازات له فنفعّل له الإجازات بدل إنشاء سجل مكرر
    const cands = (await client.query('SELECT id, full_name FROM employees WHERE NOT leave_enabled AND emp_no IS NULL')).rows
      .filter(c => normalizeName(c.full_name) === normalizeName(b.full_name));
    let row, adopted = false;
    if (cands.length === 1) {
      adopted = true;
      row = (await client.query(`UPDATE employees SET emp_no=$2, full_name=coalesce(nullif(full_name, ''), $3), job_title=coalesce(job_title, $4), org_unit_id=$5, hire_date=$6, termination_date=$7, status=$8, basic_salary=$9,
          leave_salary_override=$10, annual_entitlement_days=$11, opening_balance=$12, opening_date=$13, leave_enabled=TRUE, version=version+1, updated_at=now() WHERE id=$1 RETURNING *`,
      [cands[0].id, vals[0], vals[1], vals[2], ...vals.slice(3)])).rows[0];
    } else {
      row = (await client.query(
        `INSERT INTO employees(emp_no, full_name, job_title, org_unit_id, hire_date, termination_date, status, basic_salary,
           leave_salary_override, annual_entitlement_days, opening_balance, opening_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, vals)).rows[0];
    }
    await saveAllowances(client, row.id, b.allowances);
    await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,NULL,$2,$3,$4,$5)',
      [row.id, b.org_unit_id, b.hire_date, req.user.username, adopted ? 'تفعيل نظام الإجازات لموظف موجود في الدليل' : 'إضافة موظف']);
    await client.query('COMMIT');
    resetOrgGraph();
    await audit(req, adopted ? 'adopt' : 'create', 'employee', row.id, null, row);
    res.status(201).json(row);
  } catch (e) { await client.query('ROLLBACK'); throw dupErr(e); } finally { client.release(); }
}));

r.put('/:id', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.id; const b = req.body; readBody(b, true);
  const old = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const n = { ...old, ...b };
  if (n.termination_date && n.termination_date < n.hire_date) throw httpError(400, 'نهاية الخدمة قبل التعيين');
  if (n.opening_date && n.hire_date && n.opening_date < n.hire_date) throw httpError(400, 'تاريخ الرصيد الافتتاحي قبل تاريخ التعيين');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE employees SET emp_no=$2, full_name=$3, job_title=$4, org_unit_id=$5, hire_date=$6, termination_date=$7, status=$8,
         basic_salary=$9, leave_salary_override=$10, annual_entitlement_days=$11, opening_balance=$12, opening_date=$13, version=version+1, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, n.emp_no, n.full_name, n.job_title || null, n.org_unit_id, n.hire_date, n.termination_date || null, n.status,
        num(n.basic_salary, 0), num(n.leave_salary_override), num(n.annual_entitlement_days), num(n.opening_balance, 0), n.opening_date]);
    if (old.org_unit_id !== rows[0].org_unit_id) {
      await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_by, reason) VALUES ($1,$2,$3,$4,$5)', [id, old.org_unit_id, rows[0].org_unit_id, req.user.username, 'تعديل من نظام الإجازات']);
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
    resetOrgGraph();
    await audit(req, 'update', 'employee', id, old, rows[0]);
    res.json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw dupErr(e); } finally { client.release(); }
}));

r.delete('/:id', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.id;
  const old = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const used = await q('SELECT 1 FROM leave_transactions WHERE employee_id = $1 LIMIT 1', [id]);
  if (used.rows.length) throw httpError(409, 'للموظف حركات إجازات؛ غيّر حالته إلى "معطّل" أو "منتهي الخدمة" بدل الحذف');
  await q('DELETE FROM targets WHERE scope_type = $1 AND scope_id = $2', ['employee', id]);
  await q('DELETE FROM employees WHERE id = $1', [id]);
  await audit(req, 'delete', 'employee', id, old, null);
  res.json({ ok: true });
}));

export default r;
