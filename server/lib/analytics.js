import { addDays, fiscalYear, round2 } from './engine.js';
import { summarize } from './targets.js';
import { computeAt, unitRollups, today } from './context.js';
import { canSeeFinancials } from './auth.js';

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

export function kpis(ctx) {
  const s = summarize(ctx.list, ctx.elapsedPct);
  return {
    headcount: s.headcount,
    total_balance_days: s.balance_now,
    used_days: s.used,
    used_period_days: s.used_period,
    entitled_days: round2(sum(ctx.list, e => e.m.baseline + e.m.accrued_to_date)),
    entitled_full_year: s.accrued_full_year,
    scheduled_days: s.scheduled,
    pending_days: s.pending,
    projected_year_end_days: s.projected,
    liability_sar: s.value_now,
    projected_liability_sar: s.value_year_end,
    target_liability_sar: s.has_target ? s.target_sar : null,
    target_days: s.has_target ? s.target_days : null,
    reduction_needed_days: s.reduction_needed,
    reduction_needed_sar: s.reduction_needed_sar,
    achievement_pct: s.achievement,
    progress_now_pct: s.progress_now,
    target_status: s.target_status,
    met_count: s.met, not_met_count: s.not_met, targeted_count: s.targeted_headcount,
    high_balance_count: s.high_balance,
    avg_balance_days: s.headcount ? round2(s.balance_now / s.headcount) : 0,
    negative_balance_count: ctx.list.filter(e => e.m.negative_balance).length,
  };
}

const BUCKETS = [
  { label: 'سالب', test: v => v < 0 }, { label: '0–5', test: v => v >= 0 && v < 5 }, { label: '5–10', test: v => v >= 5 && v < 10 },
  { label: '10–20', test: v => v >= 10 && v < 20 }, { label: '20–30', test: v => v >= 20 && v < 30 },
  { label: '30–45', test: v => v >= 30 && v < 45 }, { label: '45+', test: v => v >= 45 },
];

export function monthEnds(fy, cutoff) {
  const out = [];
  let d = fy.start;
  while (d <= fy.end && d <= cutoff) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const end = addDays(next, -1);
    out.push(end > cutoff ? cutoff : end > fy.end ? fy.end : end);
    d = next;
  }
  return [...new Set(out)];
}

export function monthlyTrend(ctx) {
  const dates = monthEnds(ctx.fy, ctx.asOf);
  return dates.map(d => {
    let bal = 0, val = 0, used = 0;
    for (const e of ctx.list) {
      const m = computeAt(ctx, e, ctx.year, d);
      bal += m.available_now; val += m.value_now; used += m.used;
    }
    return { date: d, balance_days: round2(bal), liability_sar: round2(val), used_cum: round2(used) };
  }).map((p, i, arr) => ({ ...p, liability_change: i ? round2(p.liability_sar - arr[i - 1].liability_sar) : null }));
}

export function yearlyTrend(ctx, years = 4) {
  const t = today();
  const out = [];
  for (let y = ctx.year - years + 1; y <= ctx.year; y++) {
    const fy = fiscalYear(y, ctx.policy);
    const asOf = fy.end < t ? fy.end : (t < fy.start ? fy.start : t);
    let bal = 0, val = 0, used = 0;
    for (const e of ctx.list) {
      if (e.hire_date > fy.end) continue;
      const m = computeAt(ctx, e, y, asOf);
      bal += m.available_now; val += m.value_now; used += m.used;
    }
    out.push({ year: y, balance_days: round2(bal), liability_sar: round2(val), used_days: round2(used) });
  }
  return out;
}

export function charts(ctx, user, rootNode) {
  const fin = canSeeFinancials(user);
  const roll = unitRollups(ctx);
  const kids = (rootNode.children.length ? rootNode.children : []).map(c => roll.get(c.id)).filter(r => r.headcount > 0 || true);
  const sectors = [];
  for (const n of ctx.tree.byId.values()) if (n.unit_type === 'sector') sectors.push(roll.get(n.id));
  const depts = [];
  for (const n of ctx.tree.byId.values()) if (n.unit_type === 'department') depts.push(roll.get(n.id));
  const byUnit = (arr, f) => arr.map(r => ({ id: r.id, name: r.name, value: f(r) }));
  const top = (arr, f, n = 10) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const live = ctx.list;
  const slim = e => ({ id: e.id, name: e.full_name, unit: e.section || e.department || e.sector, balance: e.m.available_now, value: fin ? e.m.value_now : null });
  return {
    sector_balances: byUnit(sectors, r => r.balance_now),
    department_liabilities: fin ? byUnit(depts.filter(d => d.headcount), r => r.value_now).sort((a, b) => b.value - a.value) : [],
    target_vs_actual: kids.map(r => ({ id: r.id, name: r.name, target: r.has_target ? r.target_days : null, projected: r.projected, balance: r.balance_now })),
    achievement_by_unit: kids.map(r => ({ id: r.id, name: r.name, pct: r.achievement, status: r.target_status })),
    top_balance: top(live, e => e.m.available_now).map(slim),
    top_value: fin ? top(live, e => e.m.value_now).map(slim) : [],
    buckets: BUCKETS.map(b => ({ label: b.label, count: live.filter(e => b.test(e.m.available_now)).length })),
    monthly: monthlyTrend(ctx),
    yearly: yearlyTrend(ctx),
  };
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

export function alerts(ctx, user) {
  const fin = canSeeFinancials(user);
  const roll = unitRollups(ctx);
  const A = [];
  const cap = ctx.policy.max_balance_cap;
  const over = ctx.list.filter(e => e.m.available_now > cap).sort((a, b) => b.m.available_now - a.m.available_now);
  const row = e => ({ id: e.id, name: e.full_name, unit: e.section || e.department || e.sector, balance: e.m.available_now, projected: e.m.projected_year_end, target: e.target_days });
  if (over.length) A.push({ key: 'over_cap', level: 'high', title: 'موظفون تجاوزوا الحد المعتمد للرصيد', text: `${over.length} موظفاً يزيد رصيدهم عن ${cap} يوماً.`, items: over.slice(0, 50).map(row) });

  if (fin) {
    const depts = [...ctx.tree.byId.values()].filter(n => n.unit_type === 'department').map(n => roll.get(n.id)).filter(d => d.headcount);
    const total = sum(depts, d => d.value_now) || 1;
    const mean = total / (depts.length || 1);
    const hi = depts.filter(d => d.value_now >= mean * 1.5 && d.value_now / total >= 0.1).sort((a, b) => b.value_now - a.value_now);
    if (hi.length) A.push({ key: 'high_liability', level: 'medium', title: 'إدارات ذات التزامات مالية مرتفعة', text: 'التزام الإدارة يعادل 1.5 ضعف متوسط الإدارات فأكثر.', items: hi.map(d => ({ id: d.id, name: d.name, value: d.value_now, share: pct(d.value_now, total) })) });
  }

  const units = [...roll.values()].filter(u => u.unit_type !== 'org' && u.has_target);
  const behind = units.filter(u => u.target_status === 'lagging').sort((a, b) => a.achievement - b.achievement);
  if (behind.length) A.push({ key: 'lagging', level: 'high', title: 'أقسام وإدارات متأخرة عن تحقيق المستهدف', text: 'تقدّمها الحالي أقل من الزمن المنقضي من السنة.', items: behind.map(u => ({ id: u.id, name: u.name, achievement: u.achievement, progress: u.progress_now, reduction: u.reduction_needed })) });

  const withT = ctx.list.filter(e => e.target_days !== null);
  const risk = withT.filter(e => e.m.projected_year_end > e.target_days).sort((a, b) => (b.m.projected_year_end - b.target_days) - (a.m.projected_year_end - a.target_days));
  if (risk.length) A.push({ key: 'risk', level: 'medium', title: 'احتمال عدم تحقيق المستهدف بنهاية السنة', text: `${risk.length} من ${withT.length} موظفاً (${pct(risk.length, withT.length)}%) متوقع أن يتجاوزوا مستهدفهم بنهاية السنة بحسب الإجازات المجدولة.`, items: risk.slice(0, 50).map(row) });

  const noplan = risk.filter(e => e.m.used + e.m.scheduled === 0 && ctx.elapsedPct >= 25);
  if (noplan.length) A.push({ key: 'no_plan', level: 'medium', title: 'موظفون لم يستخدموا إجازاتهم ولا توجد إجازة مجدولة', text: 'لا استخدام ولا جدولة رغم وجود فجوة عن المستهدف.', items: noplan.slice(0, 50).map(row) });

  const neg = ctx.list.filter(e => e.m.negative_balance);
  if (neg.length) A.push({ key: 'negative', level: 'low', title: 'أرصدة سالبة (تحتاج مراجعة بيانات)', text: 'الرصيد السالب لا يخفض الالتزام المالي في الحسابات.', items: neg.map(row) });
  return A;
}

export function recommendations(ctx, user) {
  const fin = canSeeFinancials(user);
  const roll = unitRollups(ctx);
  const R = [];
  const units = [...roll.values()].filter(u => u.unit_type !== 'org' && u.has_target && u.reduction_needed > 0)
    .sort((a, b) => b.reduction_needed - a.reduction_needed);
  for (const u of units.slice(0, 3)) {
    R.push(`تحتاج «${u.name}» إلى تخفيض رصيد الإجازات بمقدار ${Math.ceil(u.reduction_needed)} يوماً للوصول إلى المستهدف السنوي${fin ? ` (أثر مالي تقريبي ${Math.round(u.reduction_needed_sar).toLocaleString('en-US')} ر.س)` : ''}.`);
  }
  if (fin) {
    const topN = ctx.policy.concentration_top_n;
    const byVal = [...ctx.list].sort((a, b) => b.m.value_now - a.m.value_now);
    const total = sum(ctx.list, e => e.m.value_now);
    if (total > 0 && byVal.length > topN) {
      const share = sum(byVal.slice(0, topN), e => e.m.value_now) / total;
      R.push(`يتركز ${Math.round(share * 100)}% من الالتزام المالي في ${topN} موظفين.`);
    }
  }
  const noplan = ctx.list.filter(e => e.target_days !== null && e.m.projected_year_end > e.target_days && e.m.used + e.m.scheduled === 0);
  if (noplan.length) R.push(`${noplan.length} موظفاً لديهم فجوة عن المستهدف ولم يستخدموا ولم يجدولوا أي إجازة؛ يُنصح بالتنسيق معهم لجدولة إجازاتهم.`);
  const over = ctx.list.filter(e => e.m.available_now > ctx.policy.max_balance_cap);
  if (over.length) R.push(`${over.length} موظفاً تجاوز رصيدهم الحد المعتمد (${ctx.policy.max_balance_cap} يوماً).`);
  return R;
}

/** محاكاة سيناريو التخفيض: ماذا لو خفضنا رصيد كل موظف إلى cap يوماً؟ */
export function simulate(ctx, user, cap, level = 'sector') {
  const fin = canSeeFinancials(user);
  const groups = new Map();
  const unitOf = e => (level === 'department' ? (e.path_ids.department || e.path_ids.sector) : level === 'section' ? (e.path_ids.section || e.path_ids.department || e.path_ids.sector) : e.path_ids.sector);
  let tDays = 0, tVal = 0, tAfter = 0, tAfterVal = 0, affected = 0;
  for (const e of ctx.list) {
    const proj = Math.max(0, e.m.projected_year_end);
    const need = Math.max(0, proj - cap);
    const rate = e.m.day_rate;
    const id = unitOf(e) ?? 0;
    const name = (level === 'department' ? (e.department || e.sector) : level === 'section' ? (e.section || e.department || e.sector) : e.sector) || 'بدون وحدة';
    const g = groups.get(id) || { id, name, headcount: 0, affected: 0, days_to_use: 0, projected_days: 0, value_reduction: 0, value_before: 0, value_after: 0 };
    g.headcount++; g.projected_days += proj; g.days_to_use += need; if (need > 0) { g.affected++; affected++; }
    g.value_reduction += need * rate; g.value_before += proj * rate; g.value_after += Math.min(proj, cap) * rate;
    groups.set(id, g);
    tDays += need; tVal += need * rate; tAfter += Math.min(proj, cap); tAfterVal += Math.min(proj, cap) * rate;
  }
  const rows = [...groups.values()].map(g => {
    const o = {}; for (const k of Object.keys(g)) o[k] = typeof g[k] === 'number' ? round2(g[k]) : g[k];
    if (!fin) { delete o.value_reduction; delete o.value_before; delete o.value_after; }
    return o;
  }).sort((a, b) => b.days_to_use - a.days_to_use);
  return {
    cap, level,
    totals: { days_to_use: round2(tDays), affected_employees: affected, headcount: ctx.list.length, remaining_days: round2(tAfter),
      ...(fin ? { value_reduction: round2(tVal), value_after: round2(tAfterVal) } : {}) },
    rows,
    assumptions: ['الأساس هو الرصيد المتوقع بنهاية السنة (بعد الاستحقاق المتبقي والإجازات المجدولة المعتمدة).',
      'القيمة المالية = الأيام × أجر اليوم المعتمد لكل موظف؛ وهي قيمة تقديرية وليست قيداً محاسبياً.',
      'استخدام الإجازة لا يُعد صرفاً نقدياً تلقائياً.'],
  };
}
