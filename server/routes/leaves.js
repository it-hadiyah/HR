import { Router } from 'express';
import { q } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { loadPolicy, loadHolidays, buildContext } from '../lib/context.js';
import { countLeaveDays, overlaps } from '../lib/engine.js';
import { httpError, isDate } from '../lib/util.js';

const r = Router();

r.get('/', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, { year: req.query.year, status: 'all' });
  const allowed = new Set(ctx.list.map(e => e.id));
  const byId = new Map(ctx.all.map(e => [e.id, e]));
  const params = [];
  let sql = `SELECT t.*, e.full_name, e.emp_no FROM leave_transactions t JOIN employees e ON e.id = t.employee_id WHERE TRUE`;
  if (req.query.employee) { params.push(+req.query.employee); sql += ` AND t.employee_id = $${params.length}`; }
  if (req.query.status) { params.push(req.query.status); sql += ` AND t.status = $${params.length}`; }
  if (req.query.type) { params.push(req.query.type); sql += ` AND t.tx_type = $${params.length}`; }
  if (req.query.year) { params.push(`${+req.query.year}-01-01`, `${+req.query.year}-12-31`); sql += ` AND t.start_date BETWEEN $${params.length - 1} AND $${params.length}`; }
  sql += ' ORDER BY t.start_date DESC, t.id DESC LIMIT 1000';
  const { rows } = await q(sql, params);
  res.json(rows.filter(t => allowed.has(t.employee_id)).map(t => ({ ...t, unit: byId.get(t.employee_id)?.section || byId.get(t.employee_id)?.department || byId.get(t.employee_id)?.sector })));
}));

// معاينة عدد الأيام وفق سياسة الجهة قبل الحفظ
r.get('/preview-days', wrap(async (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end)) throw httpError(400, 'تاريخ غير صالح');
  const [policy, hol] = await Promise.all([loadPolicy(), loadHolidays()]);
  res.json({ days: countLeaveDays(start, end, policy, hol), basis: policy.day_basis });
}));

r.post('/', requirePerm('leaves'), wrap(async (req, res) => {
  const b = req.body;
  const emp = (await q('SELECT * FROM employees WHERE id = $1', [b.employee_id])).rows[0];
  if (!emp) throw httpError(400, 'الموظف غير موجود');
  const type = b.tx_type || 'leave';
  if (!['leave', 'adjustment', 'settlement'].includes(type)) throw httpError(400, 'نوع الحركة غير صالح');
  if (!isDate(b.start_date)) throw httpError(400, 'تاريخ البداية غير صالح');
  const end = b.end_date || b.start_date;
  if (!isDate(end) || end < b.start_date) throw httpError(400, 'تاريخ النهاية غير صالح');
  const policy = await loadPolicy();
  let days = Number(b.days);
  if (type === 'leave' && (b.days === undefined || b.days === null || b.days === '')) {
    days = countLeaveDays(b.start_date, end, policy, await loadHolidays());
  }
  if (!Number.isFinite(days) || days === 0 && type !== 'adjustment') throw httpError(400, 'عدد الأيام غير صالح');
  if (type !== 'adjustment' && days <= 0) throw httpError(400, 'عدد الأيام يجب أن يكون موجباً');
  if (!policy.allow_partial_days && !Number.isInteger(days)) throw httpError(400, 'السياسة لا تسمح بأجزاء الأيام');
  if (type === 'leave') {
    const ex = (await q('SELECT * FROM leave_transactions WHERE employee_id = $1', [emp.id])).rows;
    if (overlaps(ex, b.start_date, end)) throw httpError(409, 'تتداخل هذه الإجازة مع إجازة أخرى للموظف');
  }
  const status = ['pending', 'approved'].includes(b.status) ? b.status : 'approved';
  const { rows } = await q(
    `INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [emp.id, type, b.start_date, end, days, status, b.notes || null, req.user.id]);
  await audit(req, 'create', 'leave_tx', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

r.put('/:id/status', requirePerm('leaves'), wrap(async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) throw httpError(400, 'حالة غير صالحة');
  const old = (await q('SELECT * FROM leave_transactions WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  if (status === 'approved' && old.tx_type === 'leave') {
    const ex = (await q('SELECT * FROM leave_transactions WHERE employee_id = $1', [old.employee_id])).rows;
    if (overlaps(ex, old.start_date, old.end_date, old.id)) throw httpError(409, 'تتداخل مع إجازة أخرى');
  }
  const { rows } = await q('UPDATE leave_transactions SET status = $2 WHERE id = $1 RETURNING *', [old.id, status]);
  await audit(req, 'status', 'leave_tx', old.id, old, rows[0]);
  res.json(rows[0]);
}));

export default r;
