import { Router } from 'express';
import { wrap } from '../lib/auth.js';
import { buildContext, unitRollups } from '../lib/context.js';
import { kpis, charts, alerts, recommendations, simulate } from '../lib/analytics.js';
import { publicEmployee, httpError } from '../lib/util.js';
import { canSeeFinancials } from '../lib/auth.js';
import { q } from '../db/pool.js';

const r = Router();

const slimUnit = (u, fin) => {
  const o = { ...u };
  if (!fin) for (const k of ['value_now', 'value_year_end', 'target_sar', 'reduction_needed_sar']) delete o[k];
  return o;
};

r.get('/', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, req.query);
  const fin = canSeeFinancials(req.user);
  const roll = unitRollups(ctx);
  let node = req.query.unit ? ctx.tree.byId.get(+req.query.unit) : null;
  if (!node) node = ctx.allowedUnits ? ctx.tree.byId.get(req.user.org_unit_id) : ctx.tree.root;
  if (!node || (ctx.allowedUnits && !ctx.allowedUnits.has(node.id))) throw httpError(403, 'خارج نطاق صلاحياتك');
  const crumbs = [];
  for (let n = node; n; n = n.parent_id ? ctx.tree.byId.get(n.parent_id) : null) {
    if (ctx.allowedUnits && !ctx.allowedUnits.has(n.id)) break;
    crumbs.unshift({ id: n.id, name: n.name, unit_type: n.unit_type });
  }
  // جدول التفصيل: الوحدات الأدنى، وإلا الموظفون (وإن كان في الوحدة موظفون مباشرون فيُضافون)
  const children = node.children.map(c => ({ kind: 'unit', ...slimUnit(roll.get(c.id), fin) }));
  const direct = ctx.list.filter(e => e.org_unit_id === node.id).map(e => ({ kind: 'employee', ...publicEmployee(e, req.user) }));
  const rows = [...children, ...direct];

  res.json({
    meta: { year: ctx.year, asOf: ctx.asOf, period: ctx.period, fy: ctx.fy, elapsed_pct: Math.round(ctx.elapsedPct), cap: ctx.policy.max_balance_cap,
      financial: fin, demo: (await q('SELECT 1 FROM employees WHERE is_demo LIMIT 1')).rows.length > 0 },
    node: { id: node.id, name: node.name, unit_type: node.unit_type },
    breadcrumb: crumbs,
    kpis: (() => { const k = kpis(ctx); if (!fin) for (const x of ['liability_sar', 'projected_liability_sar', 'target_liability_sar', 'reduction_needed_sar']) delete k[x]; return k; })(),
    charts: charts(ctx, req.user, node),
    rows,
    alerts_count: alerts(ctx, req.user).length,
  });
}));

r.get('/alerts', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, req.query);
  res.json({ alerts: alerts(ctx, req.user), recommendations: recommendations(ctx, req.user), year: ctx.year, asOf: ctx.asOf });
}));

r.get('/simulate', wrap(async (req, res) => {
  const cap = Number(req.query.cap);
  if (!(cap >= 0)) throw httpError(400, 'حدد الرصيد المستهدف لكل موظف (cap)');
  const ctx = await buildContext(req.user, req.query);
  res.json(simulate(ctx, req.user, cap, req.query.level || 'sector'));
}));

export default r;
