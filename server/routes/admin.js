import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, pool } from '../db/pool.js';
import { requirePerm, audit, wrap, ROLE_LABELS, canSeeFinancials } from '../lib/auth.js';
import { loadPolicy, buildContext } from '../lib/context.js';
import { DEFAULT_POLICY } from '../lib/engine.js';
import { httpError, isDate } from '../lib/util.js';

const r = Router();
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'للمدير فقط' }));

// ---- الإعدادات والسياسات ----
r.get('/settings', wrap(async (req, res) => {
  const policy = await loadPolicy();
  const holidays = (await q('SELECT * FROM holidays ORDER BY day')).rows;
  res.json({ policy, holidays, defaults: DEFAULT_POLICY });
}));

r.put('/settings', requirePerm('settings'), wrap(async (req, res) => {
  const before = await loadPolicy();
  const b = req.body || {};
  const v = {};
  const numKeys = ['day_divisor', 'entitlement_base', 'entitlement_senior', 'senior_after_years', 'max_balance_cap', 'year_start_month', 'concentration_top_n'];
  for (const k of numKeys) if (b[k] !== undefined) { const n = Number(b[k]); if (!(n > 0)) throw httpError(400, `قيمة غير صالحة: ${k}`); v[k] = n; }
  if (v.year_start_month && (v.year_start_month > 12 || !Number.isInteger(v.year_start_month))) throw httpError(400, 'شهر بداية السنة من 1 إلى 12');
  if (b.accrual_method !== undefined) { if (!['daily', 'upfront'].includes(b.accrual_method)) throw httpError(400, 'طريقة استحقاق غير صالحة'); v.accrual_method = b.accrual_method; }
  if (b.day_basis !== undefined) { if (!['calendar', 'working'].includes(b.day_basis)) throw httpError(400, 'أساس الأيام غير صالح'); v.day_basis = b.day_basis; }
  if (b.max_carryover_days !== undefined) { v.max_carryover_days = b.max_carryover_days === null || b.max_carryover_days === '' ? null : Number(b.max_carryover_days); if (v.max_carryover_days !== null && !(v.max_carryover_days >= 0)) throw httpError(400, 'حد الترحيل غير صالح'); }
  if (b.allow_partial_days !== undefined) v.allow_partial_days = !!b.allow_partial_days;
  if (b.weekend_days !== undefined) { if (!Array.isArray(b.weekend_days) || b.weekend_days.some(x => !(x >= 0 && x <= 6))) throw httpError(400, 'أيام نهاية الأسبوع غير صالحة'); v.weekend_days = b.weekend_days.map(Number); }
  for (const [k, val] of Object.entries(v)) await q('INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(val)]);
  await audit(req, 'update', 'settings', '', before, { ...before, ...v });
  res.json({ policy: await loadPolicy() });
}));

r.post('/holidays', requirePerm('settings'), wrap(async (req, res) => {
  const { day, name } = req.body;
  if (!isDate(day) || !name) throw httpError(400, 'التاريخ والاسم مطلوبان');
  const { rows } = await q('INSERT INTO holidays(day, name) VALUES ($1,$2) ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name RETURNING *', [day, name]);
  await audit(req, 'create', 'holiday', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));
r.delete('/holidays/:id', requirePerm('settings'), wrap(async (req, res) => {
  await q('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  await audit(req, 'delete', 'holiday', req.params.id, null, null);
  res.json({ ok: true });
}));

// ---- المستخدمون والأدوار ----
r.get('/users', adminOnly, wrap(async (req, res) => {
  const { rows } = await q('SELECT u.id, u.username, u.full_name, u.role, u.org_unit_id, u.active, o.name AS unit_name FROM users u LEFT JOIN org_units o ON o.id = u.org_unit_id ORDER BY u.id');
  res.json({ users: rows, roles: ROLE_LABELS });
}));

function checkUser(b, isNew) {
  if (isNew && (!b.username || !b.password)) throw httpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
  if (b.password && String(b.password).length < 8) throw httpError(400, 'كلمة المرور 8 أحرف على الأقل');
  if (b.role && !ROLE_LABELS[b.role]) throw httpError(400, 'دور غير صالح');
  if (['sector_manager', 'department_manager', 'section_manager'].includes(b.role) && !b.org_unit_id) throw httpError(400, 'حدد الوحدة التي يديرها');
}
r.post('/users', adminOnly, wrap(async (req, res) => {
  const b = req.body; checkUser(b, true);
  const { rows } = await q('INSERT INTO users(username, full_name, password_hash, role, org_unit_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, role, org_unit_id, active',
    [String(b.username).trim().toLowerCase(), b.full_name || b.username, await bcrypt.hash(b.password, 10), b.role, b.org_unit_id || null]);
  await audit(req, 'create', 'user', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));
r.put('/users/:id', adminOnly, wrap(async (req, res) => {
  const b = req.body; checkUser(b, false);
  const old = (await q('SELECT id, username, full_name, role, org_unit_id, active FROM users WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  if (old.id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw httpError(400, 'لا يمكنك تعطيل حسابك أو تغيير دورك');
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const { rows } = await q(`UPDATE users SET full_name = COALESCE($2, full_name), role = COALESCE($3, role), org_unit_id = $4, active = COALESCE($5, active),
    password_hash = COALESCE($6, password_hash) WHERE id = $1 RETURNING id, username, full_name, role, org_unit_id, active`,
    [old.id, b.full_name || null, b.role || null, b.org_unit_id === undefined ? old.org_unit_id : (b.org_unit_id || null), b.active ?? null, hash]);
  await audit(req, 'update', 'user', old.id, old, { ...rows[0], password_changed: !!b.password });
  res.json(rows[0]);
}));

// ---- سجل التدقيق ----
r.get('/audit', wrap(async (req, res) => {
  if (!['admin', 'finance', 'hr', 'executive'].includes(req.user.role)) throw httpError(403, 'غير مسموح');
  const params = []; let sql = 'SELECT * FROM audit_log WHERE TRUE';
  if (req.query.entity) { params.push(req.query.entity); sql += ` AND entity = $${params.length}`; }
  if (req.query.user) { params.push(req.query.user); sql += ` AND username = $${params.length}`; }
  sql += ' ORDER BY id DESC LIMIT 300';
  res.json((await q(sql, params)).rows);
}));

// ---- اللقطات الشهرية للالتزام المالي ----
r.get('/snapshots', wrap(async (req, res) => {
  if (!canSeeFinancials(req.user)) throw httpError(403, 'غير مسموح');
  const { rows } = await q(`SELECT s.*, COALESCE(SUM(r.est_value),0)::float AS est_total, COALESCE(SUM(r.balance_days),0)::float AS days_total, COUNT(r.*)::int AS rows
    FROM snapshots s LEFT JOIN snapshot_rows r ON r.snapshot_id = s.id GROUP BY s.id ORDER BY s.snap_date DESC`);
  res.json(rows.map(s => ({ ...s, est_total: Number(s.est_total), days_total: Number(s.days_total) })));
}));

r.post('/snapshots', requirePerm('snapshots'), wrap(async (req, res) => {
  const ctx = await buildContext({ ...req.user, role: 'admin', org_unit_id: null }, { status: 'live', asOf: req.body.date });
  const date = ctx.asOf;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = (await client.query('SELECT id FROM snapshots WHERE snap_date = $1', [date])).rows[0];
    if (ex) { await client.query('DELETE FROM snapshots WHERE id = $1', [ex.id]); }
    const s = (await client.query('INSERT INTO snapshots(snap_date, created_by, official_total, notes) VALUES ($1,$2,$3,$4) RETURNING *',
      [date, req.user.id, req.body.official_total === '' || req.body.official_total === undefined ? null : Number(req.body.official_total), req.body.notes || null])).rows[0];
    for (const e of ctx.list) {
      await client.query('INSERT INTO snapshot_rows(snapshot_id, employee_id, org_unit_id, balance_days, day_rate, est_value) VALUES ($1,$2,$3,$4,$5,$6)',
        [s.id, e.id, e.org_unit_id, e.m.available_now, e.m.day_rate, e.m.value_now]);
    }
    await client.query('COMMIT');
    await audit(req, ex ? 'replace' : 'create', 'snapshot', s.id, null, { date, employees: ctx.list.length });
    res.status(201).json(s);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

r.put('/snapshots/:id', requirePerm('snapshots'), wrap(async (req, res) => {
  const old = (await q('SELECT * FROM snapshots WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const { rows } = await q('UPDATE snapshots SET official_total = $2, notes = $3 WHERE id = $1 RETURNING *',
    [old.id, req.body.official_total === '' || req.body.official_total == null ? null : Number(req.body.official_total), req.body.notes ?? old.notes]);
  await audit(req, 'update', 'snapshot', old.id, old, rows[0]);
  res.json(rows[0]);
}));

// ---- حذف البيانات التوضيحية ----
r.delete('/demo', adminOnly, wrap(async (req, res) => {
  const ids = (await q('SELECT id FROM employees WHERE is_demo')).rows.map(x => x.id);
  if (ids.length) {
    await q("DELETE FROM targets WHERE scope_type = 'employee' AND scope_id = ANY($1)", [ids]);
    await q('DELETE FROM employees WHERE id = ANY($1)', [ids]);
    // حذف الوحدات التوضيحية الفارغة (من الأدنى إلى الأعلى) مع مستهدفاتها
    for (let i = 0; i < 4; i++) {
      await q(`DELETE FROM targets WHERE scope_type = 'unit' AND scope_id IN (SELECT id FROM org_units o WHERE parent_id IS NOT NULL AND code = 'DEMO'
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.org_unit_id = o.id) AND NOT EXISTS (SELECT 1 FROM org_units c WHERE c.parent_id = o.id))`);
      await q(`DELETE FROM users WHERE org_unit_id IN (SELECT id FROM org_units o WHERE code = 'DEMO' AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.org_unit_id = o.id) AND NOT EXISTS (SELECT 1 FROM org_units c WHERE c.parent_id = o.id))`);
      await q(`DELETE FROM org_units o WHERE parent_id IS NOT NULL AND code = 'DEMO' AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.org_unit_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM org_units c WHERE c.parent_id = o.id)`);
    }
  }
  await audit(req, 'delete', 'demo_data', '', null, { employees: ids.length });
  res.json({ removed: ids.length });
}));


export default r;
