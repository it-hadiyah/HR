import { Router } from 'express';
import { q } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { buildContext, unitRollups } from '../lib/context.js';
import { httpError } from '../lib/util.js';
import { round2 } from '../lib/engine.js';

const r = Router();
const TYPES = ['max_year_end_balance', 'days_to_use', 'reduction_pct', 'financial_target', 'usage_plan_pct'];

r.get('/', wrap(async (req, res) => {
  const ctx = await buildContext(req.user, { year: req.query.year, status: 'all' });
  const roll = unitRollups(ctx, ctx.all.filter(e => e.status !== 'terminated'));
  const unitsById = new Map(ctx.units.map(u => [u.id, u]));
  const empById = new Map(ctx.all.map(e => [e.id, e]));
  const rows = ctx.targets
    .filter(t => t.scope_type === 'unit' ? (!ctx.allowedUnits || ctx.allowedUnits.has(t.scope_id)) : (empById.has(t.scope_id) && (!ctx.allowedUnits || ctx.allowedUnits.has(empById.get(t.scope_id).org_unit_id))))
    .map(t => {
      const unit = t.scope_type === 'unit' ? unitsById.get(t.scope_id) : null;
      const emp = t.scope_type === 'employee' ? empById.get(t.scope_id) : null;
      const ro = t.scope_type === 'unit' ? roll.get(t.scope_id) : null;
      return { ...t, scope_name: unit ? unit.name : emp?.full_name, scope_kind: unit ? unit.unit_type : 'employee',
        stated_days: ro?.stated?.stated_days ?? null, allocated_days: ro?.target_days ?? null, conflict_days: ro?.stated?.conflict_days ?? 0 };
    });
  res.json({ year: ctx.year, rows });
}));

r.post('/', requirePerm('targets'), wrap(async (req, res) => {
  const { scope_type, scope_id, year, target_type, value, notes } = req.body;
  if (!['unit', 'employee'].includes(scope_type)) throw httpError(400, 'نطاق غير صالح');
  if (!TYPES.includes(target_type)) throw httpError(400, 'نوع المستهدف غير صالح');
  if (!(Number(value) >= 0)) throw httpError(400, 'قيمة المستهدف غير صالحة');
  if (target_type === 'reduction_pct' || target_type === 'usage_plan_pct') if (Number(value) > 100) throw httpError(400, 'النسبة لا تزيد عن 100');
  const tbl = scope_type === 'unit' ? 'org_units' : 'employees';
  if (!(await q(`SELECT 1 FROM ${tbl} WHERE id = $1`, [scope_id])).rows.length) throw httpError(400, 'النطاق غير موجود');
  const old = (await q('SELECT * FROM targets WHERE scope_type=$1 AND scope_id=$2 AND year=$3', [scope_type, scope_id, year])).rows[0];
  const { rows } = await q(
    `INSERT INTO targets(scope_type, scope_id, year, target_type, value, notes) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (scope_type, scope_id, year) DO UPDATE SET target_type = EXCLUDED.target_type, value = EXCLUDED.value, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`, [scope_type, scope_id, year, target_type, Number(value), notes || null]);
  await audit(req, old ? 'update' : 'create', 'target', rows[0].id, old, rows[0]);
  res.status(201).json(rows[0]);
}));

r.delete('/:id', requirePerm('targets'), wrap(async (req, res) => {
  const old = (await q('SELECT * FROM targets WHERE id = $1', [req.params.id])).rows[0];
  if (!old) throw httpError(404, 'غير موجود');
  await q('DELETE FROM targets WHERE id = $1', [old.id]);
  await audit(req, 'delete', 'target', old.id, old, null);
  res.json({ ok: true });
}));

/**
 * توزيع مستهدف وحدة على الوحدات الأدنى مباشرة (أو على موظفيها إن لم تكن لها وحدات فرعية).
 * method: equal (بالتساوي بحسب العدد) | proportional (بحسب الرصيد الحالي).
 * الناتج مستهدفات صريحة لكل ابن (نوع max_year_end_balance بالأيام) مع بقاء مستهدف الأب كما هو؛ المجموع = مستهدف الأب.
 */
r.post('/distribute', requirePerm('targets'), wrap(async (req, res) => {
  const { unit_id, year, method = 'equal', total_days } = req.body;
  const ctx = await buildContext(req.user, { year, status: 'all' });
  const node = ctx.tree.byId.get(+unit_id);
  if (!node) throw httpError(400, 'وحدة غير صالحة');
  const roll = unitRollups(ctx, ctx.all.filter(e => e.status !== 'terminated'));
  let total = total_days !== undefined && total_days !== '' ? Number(total_days) : roll.get(node.id).target_days;
  if (!(total >= 0) || (total_days === undefined && !roll.get(node.id).has_target)) throw httpError(400, 'حدد إجمالي المستهدف بالأيام أو أضف مستهدفاً للوحدة أولاً');
  const kids = node.children.length
    ? node.children.map(c => ({ scope_type: 'unit', id: c.id, w: method === 'proportional' ? roll.get(c.id).balance_now : roll.get(c.id).headcount }))
    : ctx.all.filter(e => e.org_unit_id === node.id && e.status !== 'terminated').map(e => ({ scope_type: 'employee', id: e.id, w: method === 'proportional' ? e.m.available_now : 1 }));
  if (!kids.length) throw httpError(400, 'لا توجد وحدات أو موظفون للتوزيع عليهم');
  const sumW = kids.reduce((s, k) => s + Math.max(0, k.w), 0) || kids.length;
  let allocated = 0;
  const out = [];
  kids.forEach((k, i) => {
    const w = sumW === kids.length && kids.every(x => x.w <= 0) ? 1 : Math.max(0, k.w);
    let v = i === kids.length - 1 ? round2(total - allocated) : round2(total * w / sumW);
    allocated += v; if (v < 0) v = 0;
    out.push({ ...k, value: v });
  });
  for (const k of out) {
    await q(`INSERT INTO targets(scope_type, scope_id, year, target_type, value, notes) VALUES ($1,$2,$3,'max_year_end_balance',$4,$5)
             ON CONFLICT (scope_type, scope_id, year) DO UPDATE SET target_type='max_year_end_balance', value=EXCLUDED.value, notes=EXCLUDED.notes, updated_at=now()`,
      [k.scope_type, k.id, ctx.year, k.value, `موزَّع من ${node.name}`]);
  }
  await audit(req, 'distribute', 'target', node.id, null, { total, method, count: out.length });
  res.json({ ok: true, distributed: out.length, total: round2(total) });
}));

export default r;
