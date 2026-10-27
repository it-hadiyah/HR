import { Router } from 'express';
import { q } from '../db/pool.js';
import { requirePerm, wrap } from '../lib/auth.js';
import { buildContext, unitRollups } from '../lib/context.js';
import { httpError } from '../lib/util.js';
import * as orgService from '../services/org.js';

const r = Router();

// شجرة الهيكل التنظيمي مع مؤشرات كل وحدة
r.get('/tree', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, { ...req.query, unit: undefined, employee: undefined });
  const roll = unitRollups(ctx);
  const build = n => ({ ...roll.get(n.id), children: n.children.map(build) });
  let root = ctx.tree.root;
  if (ctx.allowedUnits || ctx.allowedEmployees) {
    // من نطاقه محدود: تظهر وحدته فقط كجذر
    root = ctx.tree.byId.get(ctx.scopeRoot ?? req.user.org_unit_id) || root;
  }
  res.json({ tree: build(root), year: ctx.year, asOf: ctx.asOf });
}));

r.get('/units', wrap(async (req, res) => {
  const { rows } = await q('SELECT id, parent_id, unit_type, name, code FROM org_units WHERE active ORDER BY unit_type, name');
  res.json(rows);
}));

// الإضافة والتعديل والحذف عبر خدمة الهيكل المركزية (نفس المنطق المستخدم في لوحة الإدارة)
r.post('/units', requirePerm('org'), wrap(async (req, res) => res.status(201).json(await orgService.createUnit(req.body, req))));
r.put('/units/:id', requirePerm('org'), wrap(async (req, res) => res.json(await orgService.updateUnit(+req.params.id, req.body, req))));
r.delete('/units/:id', requirePerm('org'), wrap(async (req, res) => { await orgService.deleteUnit(+req.params.id, req); res.json({ ok: true }); }));

export default r;
