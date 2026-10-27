import { Router } from 'express';
import { q } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { buildContext, unitRollups } from '../lib/context.js';
import { httpError } from '../lib/util.js';

const r = Router();
const CHILD_TYPE = { org: 'sector', sector: 'department', department: 'section' };

// شجرة الهيكل التنظيمي مع مؤشرات كل وحدة
r.get('/tree', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, { ...req.query, unit: undefined, employee: undefined });
  const roll = unitRollups(ctx);
  const build = n => ({ ...roll.get(n.id), children: n.children.map(build) });
  let root = ctx.tree.root;
  if (ctx.allowedUnits) {
    // مدير: تظهر وحدته فقط كجذر
    root = ctx.tree.byId.get(req.user.org_unit_id) || root;
  }
  res.json({ tree: build(root), year: ctx.year, asOf: ctx.asOf });
}));

r.get('/units', wrap(async (req, res) => {
  const { rows } = await q('SELECT id, parent_id, unit_type, name, code FROM org_units WHERE active ORDER BY unit_type, name');
  res.json(rows);
}));

r.post('/units', requirePerm('org'), wrap(async (req, res) => {
  const { parent_id, name, code } = req.body;
  if (!name?.trim()) throw httpError(400, 'اسم الوحدة مطلوب');
  const p = await q('SELECT unit_type FROM org_units WHERE id = $1', [parent_id]);
  if (!p.rows[0]) throw httpError(400, 'الوحدة الأم غير موجودة');
  const type = CHILD_TYPE[p.rows[0].unit_type];
  if (!type) throw httpError(400, 'لا يمكن إضافة وحدة تحت القسم');
  const { rows } = await q('INSERT INTO org_units(parent_id, unit_type, name, code) VALUES ($1,$2,$3,$4) RETURNING *', [parent_id, type, name.trim(), code || null]);
  await audit(req, 'create', 'org_unit', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

r.put('/units/:id', requirePerm('org'), wrap(async (req, res) => {
  const old = (await q('SELECT * FROM org_units WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  const { name, code, active } = req.body;
  const { rows } = await q('UPDATE org_units SET name = COALESCE($2, name), code = COALESCE($3, code), active = COALESCE($4, active) WHERE id = $1 RETURNING *',
    [req.params.id, name?.trim() || null, code ?? null, active ?? null]);
  await audit(req, 'update', 'org_unit', old.id, old, rows[0]);
  res.json(rows[0]);
}));

r.delete('/units/:id', requirePerm('org'), wrap(async (req, res) => {
  const old = (await q('SELECT * FROM org_units WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  if (!old.parent_id) throw httpError(400, 'لا يمكن حذف جذر المنشأة');
  const kids = await q('SELECT 1 FROM org_units WHERE parent_id = $1 LIMIT 1', [old.id]);
  const emps = await q('SELECT 1 FROM employees WHERE org_unit_id = $1 LIMIT 1', [old.id]);
  if (kids.rows.length || emps.rows.length) throw httpError(409, 'الوحدة تحتوي وحدات أو موظفين؛ انقلهم أولاً');
  await q('DELETE FROM targets WHERE scope_type = $1 AND scope_id = $2', ['unit', old.id]);
  await q('DELETE FROM org_units WHERE id = $1', [old.id]);
  await audit(req, 'delete', 'org_unit', old.id, old, null);
  res.json({ ok: true });
}));

export default r;
