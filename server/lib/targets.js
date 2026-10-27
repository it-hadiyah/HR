// منطق المستهدفات: تحويل أنواع المستهدفات إلى رصيد مستهدف بالأيام، وتوزيعه من الأعلى إلى الأدنى
// دون جمع أو تكرار، ثم تجميع المؤشرات من الموظف إلى القسم فالإدارة فالقطاع فالمنشأة.

import { round2 } from './engine.js';

export function buildTree(units) {
  const byId = new Map(units.map(u => [u.id, { ...u, children: [], employees: [] }]));
  let root = null;
  for (const u of byId.values()) {
    if (u.parent_id && byId.has(u.parent_id)) byId.get(u.parent_id).children.push(u);
    else if (!u.parent_id) root = u;
  }
  return { byId, root };
}

export function subtreeEmployees(node) {
  const out = [...node.employees];
  for (const c of node.children) out.push(...subtreeEmployees(c));
  return out;
}

function scopeStats(emps) {
  const baseline = emps.reduce((s, e) => s + e.m.baseline, 0);
  const accrued = emps.reduce((s, e) => s + e.m.accrued_full_year, 0);
  const days = emps.reduce((s, e) => s + Math.max(0, e.m.projected_year_end), 0);
  const wRate = emps.reduce((s, e) => s + Math.max(0, e.m.projected_year_end) * e.m.day_rate, 0);
  const avgRate = days > 0 ? wRate / days : (emps.length ? emps.reduce((s, e) => s + e.m.day_rate, 0) / emps.length : 0);
  return { baseline, accrued, avgRate };
}

/** تحويل مستهدف مُدخل إلى رصيد نهاية السنة المستهدف بالأيام */
export function normalizeTarget(t, stats) {
  const v = t.value;
  switch (t.target_type) {
    case 'max_year_end_balance': return v;
    case 'reduction_pct': return Math.max(0, stats.baseline * (1 - v / 100));
    case 'days_to_use': return Math.max(0, stats.baseline + stats.accrued - v);
    case 'usage_plan_pct': return Math.max(0, stats.baseline + stats.accrued - stats.accrued * v / 100);
    case 'financial_target': return stats.avgRate > 0 ? v / stats.avgRate : 0;
    default: return v;
  }
}

/**
 * يحدد مستهدف كل موظف (بالأيام):
 *  - المستهدف الصريح للموظف يُعتمد كما هو.
 *  - مستهدف الوحدة يُوزَّع على من ليس لهم مستهدف صريح بعد خصم المستهدفات الصريحة للأبناء، بالتناسب مع عدد الموظفين.
 * لذلك لا يتضاعف المستهدف عند التجميع. وتُسجَّل الفروقات عندما تتجاوز المستهدفات الصريحة للأبناء مستهدف الأب.
 */
export function resolveTargets(tree, employees, targets) {
  for (const n of tree.byId.values()) { n.employees = []; }
  for (const e of employees) tree.byId.get(e.org_unit_id)?.employees.push(e);

  const unitT = new Map(targets.filter(t => t.scope_type === 'unit').map(t => [t.scope_id, t]));
  const empT = new Map(targets.filter(t => t.scope_type === 'employee').map(t => [t.scope_id, t]));
  const empTarget = new Map();   // empId -> { days, source }
  const unitInfo = new Map();    // unitId -> { stated_days, stated_type, stated_value, conflict_days }

  const count = n => n.employees.length + n.children.reduce((s, c) => s + count(c), 0);
  const explicitDays = n => { // مجموع المستهدفات الصريحة الظاهرة تحت العقدة (للأبناء الصريحين فقط)
    if (unitT.has(n.id)) return normalizeTarget(unitT.get(n.id), scopeStats(subtreeEmployees(n)));
    let s = 0;
    for (const c of n.children) s += explicitDays(c);
    for (const e of n.employees) if (empT.has(e.id)) s += normalizeTarget(empT.get(e.id), scopeStats([e]));
    return s;
  };

  function allocate(node, inherited) {
    let budget = inherited;
    if (unitT.has(node.id)) {
      const t = unitT.get(node.id);
      budget = normalizeTarget(t, scopeStats(subtreeEmployees(node)));
      unitInfo.set(node.id, { stated_days: budget, stated_type: t.target_type, stated_value: t.value, id: t.id });
    }
    const kids = [
      ...node.children.map(c => ({ kind: 'unit', node: c, w: count(c) })),
      ...node.employees.map(e => ({ kind: 'emp', e, w: 1 })),
    ];
    const fixed = k => (k.kind === 'unit' ? unitT.has(k.node.id) : empT.has(k.e.id));
    const fixedDays = k => (k.kind === 'unit'
      ? normalizeTarget(unitT.get(k.node.id), scopeStats(subtreeEmployees(k.node)))
      : normalizeTarget(empT.get(k.e.id), scopeStats([k.e])));
    const floating = kids.filter(k => !fixed(k));
    let remaining = null;
    if (budget !== null && budget !== undefined) {
      // الأبناء غير الصريحين الذين تحتهم مستهدفات صريحة يحتسبون ضمن المحجوز
      const reserved = kids.reduce((s, k) => s + (fixed(k) ? fixedDays(k) : (k.kind === 'unit' ? explicitDays(k.node) : 0)), 0);
      remaining = budget - reserved;
      if (remaining < 0) {
        const info = unitInfo.get(node.id) || { stated_days: budget };
        info.conflict_days = round2(-remaining);
        unitInfo.set(node.id, info);
        remaining = 0;
      }
      // ما حُجز تحت الأبناء غير الصريحين لا يُوزَّع عليهم مرة أخرى
    }
    const totalW = floating.reduce((s, k) => s + k.w, 0) || 1;
    for (const k of kids) {
      let childBudget = null;
      if (fixed(k)) childBudget = fixedDays(k);
      else if (remaining !== null) childBudget = remaining * k.w / totalW + (k.kind === 'unit' ? explicitDays(k.node) : 0);
      if (k.kind === 'unit') allocate(k.node, childBudget);
      else {
        empTarget.set(k.e.id, childBudget === null
          ? { days: null, source: null }
          : { days: round2(childBudget), source: empT.has(k.e.id) ? 'employee' : 'inherited' });
      }
    }
  }
  allocate(tree.root, null);
  return { empTarget, unitInfo };
}

/** تجميع مؤشرات مجموعة موظفين (كل موظف مرفق به m و target_days) */
export function summarize(emps, elapsedPct = 100) {
  const s = {
    headcount: emps.length, balance_now: 0, projected: 0, used: 0, used_period: 0, scheduled: 0, pending: 0,
    value_now: 0, value_year_end: 0, accrued_full_year: 0,
    target_days: 0, target_sar: 0, targeted_headcount: 0, targeted_baseline: 0, targeted_projected: 0, targeted_now: 0,
    met: 0, not_met: 0, high_balance: 0,
  };
  for (const e of emps) {
    const m = e.m;
    s.balance_now += m.available_now; s.projected += m.projected_year_end; s.used += m.used; s.used_period += m.used_period;
    s.scheduled += m.scheduled; s.pending += m.pending; s.value_now += m.value_now; s.value_year_end += m.value_year_end;
    s.accrued_full_year += m.accrued_full_year;
    if (e.target_days !== null && e.target_days !== undefined) {
      s.targeted_headcount++;
      s.target_days += e.target_days; s.target_sar += e.target_days * m.day_rate;
      s.targeted_baseline += m.baseline; s.targeted_projected += m.projected_year_end; s.targeted_now += m.available_now;
      if (m.projected_year_end <= e.target_days + 1e-9) s.met++; else s.not_met++;
    }
    if (e.high_balance) s.high_balance++;
  }
  for (const k of Object.keys(s)) s[k] = round2(s[k]);
  const hasT = s.targeted_headcount > 0;
  s.has_target = hasT;
  s.reduction_needed = hasT ? round2(Math.max(0, s.targeted_projected - s.target_days)) : null;
  s.reduction_needed_sar = hasT ? round2(Math.max(0, s.value_year_end - s.target_sar)) : null;
  const gap = s.targeted_baseline - s.target_days;
  const ach = (cur) => (gap <= 0 ? (cur <= s.target_days ? 100 : 0) : Math.max(0, Math.min(100, (s.targeted_baseline - cur) / gap * 100)));
  s.achievement = hasT ? round2(ach(s.targeted_projected)) : null;
  s.progress_now = hasT ? round2(ach(s.targeted_now)) : null;
  s.target_status = !hasT ? 'none'
    : s.targeted_projected <= s.target_days + 1e-9 ? 'achieved'
      : (s.progress_now < elapsedPct - 10 ? 'lagging' : 'at_risk');
  return s;
}
