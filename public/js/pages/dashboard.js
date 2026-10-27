import { h, api, qs, state, fmt, num, table, statusBadge, progressBar, setFilters, EMP_STATUS, UNIT_TYPE } from '../core.js';
import { filterBar, filterQuery } from '../filters.js';
import { chart, dataset, palette, destroyCharts } from '../charts.js';

function kpi(label, value, unit, { hint, tone } = {}) {
  return h('div', { class: 'card kpi ' + (tone || '') }, h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, num(value), unit && h('span', { class: 'unit' }, unit)), hint && h('div', { class: 'hint' }, hint));
}

export default async function dashboard() {
  const root = h('div');
  const holder = h('div');
  const mkBar = async () => holder.replaceChildren(await filterBar(reset => load(reset), { period: true }));
  await mkBar();
  const body = h('div');
  root.append(holder, body);

  async function load(resetBar) {
    if (resetBar === true) await mkBar();
    body.replaceChildren(h('div', { class: 'loading' }, 'جارٍ احتساب المؤشرات…'));
    destroyCharts();
    let d;
    try { d = await api('/dashboard' + qs(filterQuery({ status: state.filters.status }))); } catch (e) { body.replaceChildren(h('div', { class: 'card err' }, e.message)); return; }
    body.replaceChildren(render(d));
  }

  function drill(unitId) { setFilters({ unit: unitId || '' }); load(true); }

  function render(d) {
    const k = d.kpis, fin = d.meta.financial, P = palette();
    const out = h('div');
    if (d.meta.demo) out.append(h('div', { class: 'demo-banner' }, '⚠ بيانات توضيحية: الأرقام المعروضة تجريبية لعرض إمكانات النظام وليست بيانات فعلية. يمكن للمدير حذفها من «الإدارة والإعدادات».'));
    out.append(h('div', { class: 'crumbs' },
      h('span', null, `السنة المالية ${d.meta.year} — حتى ${fmt.date(d.meta.asOf)} (انقضى ${d.meta.elapsed_pct}% من السنة) — الحد المعتمد للرصيد ${d.meta.cap} يوماً`),
      d.alerts_count ? h('a', { href: '#/analysis', class: 'badge bad' }, `${d.alerts_count} تنبيهات`) : null));
    out.append(h('div', { class: 'crumbs' }, d.breadcrumb.map((c, i) => [i ? '‹' : null, i === d.breadcrumb.length - 1 ? h('b', null, c.name) : h('a', { onclick: () => drill(c.id) }, c.name)])));

    out.append(h('div', { class: 'section-title' }, 'الموظفون والأرصدة'));
    out.append(h('div', { class: 'grid kpis' },
      kpi('إجمالي عدد الموظفين', fmt.int(k.headcount), 'موظف'),
      kpi('إجمالي رصيد أيام الإجازات', fmt.days(k.total_balance_days), 'يوم', { hint: `المتوسط ${fmt.days(k.avg_balance_days)} يوم للموظف` }),
      kpi('أيام الإجازات المستحقة', fmt.days(k.entitled_days), 'يوم', { hint: 'رصيد بداية السنة + المستحق حتى تاريخه' }),
      kpi('أيام الإجازات المستخدمة', fmt.days(k.used_days), 'يوم', { hint: state.filters.from ? `خلال الفترة المحددة: ${fmt.days(k.used_period_days)} يوم` : null }),
      kpi('الأيام المجدولة مستقبلاً', fmt.days(k.scheduled_days), 'يوم', { hint: k.pending_days ? `+ ${fmt.days(k.pending_days)} يوم بانتظار الاعتماد` : null }),
      kpi('المتوقع بنهاية السنة', fmt.days(k.projected_year_end_days), 'يوم'),
      kpi('موظفون بأرصدة مرتفعة', fmt.int(k.high_balance_count), 'موظف', { tone: k.high_balance_count ? 'warn' : 'ok', hint: `أكثر من ${d.meta.cap} يوماً` })));

    if (fin) {
      out.append(h('div', { class: 'section-title' }, 'الالتزام المالي (ريال سعودي)'));
      out.append(h('div', { class: 'grid kpis' },
        kpi('الالتزام المالي الحالي', fmt.sar(k.liability_sar), 'ر.س', { hint: 'تقديري = الرصيد × أجر اليوم' }),
        kpi('الالتزام المتوقع بنهاية السنة', fmt.sar(k.projected_liability_sar), 'ر.س'),
        kpi('الالتزام المالي المستهدف', k.target_liability_sar === undefined || k.target_liability_sar === null ? '—' : fmt.sar(k.target_liability_sar), k.target_liability_sar ? 'ر.س' : null),
        kpi('مقدار التخفيض المالي المطلوب', k.reduction_needed_sar === null || k.reduction_needed_sar === undefined ? '—' : fmt.sar(k.reduction_needed_sar), k.reduction_needed_sar ? 'ر.س' : null, { tone: k.reduction_needed_sar > 0 ? 'bad' : 'ok' })));
    }

    out.append(h('div', { class: 'section-title' }, 'المستهدفات'));
    out.append(h('div', { class: 'grid kpis' },
      kpi('المستهدف (أيام نهاية السنة)', k.target_days === null ? '—' : fmt.days(k.target_days), k.target_days === null ? null : 'يوم', { hint: k.targeted_count ? `${k.targeted_count} موظفاً لهم مستهدف` : 'لم تُحدَّد مستهدفات' }),
      kpi('التخفيض المطلوب (أيام)', k.reduction_needed_days === null ? '—' : fmt.days(k.reduction_needed_days), k.reduction_needed_days === null ? null : 'يوم'),
      kpi('نسبة تحقيق المستهدف', k.achievement_pct === null ? '—' : fmt.pct(k.achievement_pct), null, { hint: k.target_status === 'none' ? '' : h('span', null, statusBadge(k.target_status), ' التقدم الحالي ', fmt.pct(k.progress_now_pct)) }),
      kpi('موظفون حقّقوا المستهدف', fmt.int(k.met_count), 'موظف', { tone: 'ok', hint: 'المتوقع ≤ المستهدف' }),
      kpi('موظفون لم يحققوه', fmt.int(k.not_met_count), 'موظف', { tone: k.not_met_count ? 'bad' : 'ok' })));

    const c = d.charts;
    const yearly = c.yearly.filter(y => y.balance_days || y.used_days);
    const go = (arr, idx) => { const it = arr[idx]; if (it?.id) drill(it.id); };
    out.append(h('div', { class: 'section-title' }, 'الرسوم البيانية والتحليلات'));
    out.append(h('div', { class: 'grid charts' },
      chart('مقارنة أرصدة الإجازات بين القطاعات (يوم)', 'bar', { labels: c.sector_balances.map(x => x.name), datasets: [dataset('الرصيد', c.sector_balances.map(x => x.value), P[0])] },
        { options: { onClick: (e, els) => els[0] && go(c.sector_balances, els[0].index), plugins: { legend: { display: false } } }, sub: 'اضغط على عمود للتعمّق' }),
      fin && chart('مقارنة الالتزامات المالية بين الإدارات (ر.س)', 'bar', { labels: c.department_liabilities.map(x => x.name), datasets: [dataset('الالتزام', c.department_liabilities.map(x => x.value), P[1])] },
        { height: 'tall', options: { indexAxis: 'y', onClick: (e, els) => els[0] && go(c.department_liabilities, els[0].index), plugins: { legend: { display: false } } } }),
      chart('المستهدف مقابل المتوقع الفعلي (يوم)', 'bar', { labels: c.target_vs_actual.map(x => x.name), datasets: [dataset('المستهدف', c.target_vs_actual.map(x => x.target), P[2]), dataset('المتوقع نهاية السنة', c.target_vs_actual.map(x => x.projected), P[0])] },
        { options: { onClick: (e, els) => els[0] && go(c.target_vs_actual, els[0].index) }, sub: 'للوحدات الأدنى مباشرة من الوحدة الحالية' }),
      chart('نسب تحقيق المستهدفات حسب الهيكل التنظيمي (%)', 'bar', { labels: c.achievement_by_unit.map(x => x.name), datasets: [dataset('نسبة الإنجاز', c.achievement_by_unit.map(x => x.pct),
        c.achievement_by_unit.map(x => (x.status === 'achieved' ? P[0] : x.status === 'lagging' ? P[4] : P[2])))] }, { options: { plugins: { legend: { display: false } }, scales: { y: { max: 100 } } } }),
      chart('تطور إجمالي الأرصدة شهرياً (يوم)', 'line', { labels: c.monthly.map(x => x.date.slice(0, 7)), datasets: [dataset('إجمالي الرصيد', c.monthly.map(x => x.balance_days), P[0], { tension: .3, fill: false, pointRadius: 3 })] }, { options: { plugins: { legend: { display: false } } } }),
      fin && chart('تغيّر الالتزام المالي خلال السنة (ر.س)', 'bar', { labels: c.monthly.map(x => x.date.slice(0, 7)), datasets: [dataset('الالتزام الشهري', c.monthly.map(x => x.liability_sar), P[1]), dataset('تغيّر عن الشهر السابق', c.monthly.map(x => x.liability_change), P[2], { type: 'line', tension: .3, yAxisID: 'y' })] }),
      chart('أكثر 10 موظفين امتلاكاً لأرصدة الإجازات', 'bar', { labels: c.top_balance.map(x => x.name), datasets: [dataset('الرصيد (يوم)', c.top_balance.map(x => x.balance), P[3])] },
        { height: 'tall', options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (e, els) => els[0] && (location.hash = '#/employee/' + c.top_balance[els[0].index].id) } }),
      fin && chart('أعلى 10 موظفين من حيث القيمة المالية (ر.س)', 'bar', { labels: c.top_value.map(x => x.name), datasets: [dataset('القيمة', c.top_value.map(x => x.value), P[4])] },
        { height: 'tall', options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (e, els) => els[0] && (location.hash = '#/employee/' + c.top_value[els[0].index].id) } }),
      chart('توزيع الموظفين حسب شرائح رصيد الإجازات', 'doughnut', { labels: c.buckets.map(x => x.label), datasets: [{ data: c.buckets.map(x => x.count), backgroundColor: [P[4], ...P, P[0]].slice(0, c.buckets.length), borderWidth: 0 }] }, { options: { cutout: '58%' } }),
      chart('اتجاهات الإجازات خلال السنوات المختلفة', 'bar', { labels: yearly.map(x => String(x.year)), datasets: [dataset('رصيد نهاية السنة (يوم)', yearly.map(x => x.balance_days), P[0]), dataset('المستخدم (يوم)', yearly.map(x => x.used_days), P[2])] },
        { sub: 'تبدأ البيانات من تاريخ أول رصيد افتتاحي في النظام' })));

    out.append(h('div', { class: 'section-title' }, `التفصيل — ${d.node.name}`));
    const cols = [
      { key: 'name', label: 'الوحدة / الموظف', render: r => r.kind === 'unit' ? h('a', { onclick: () => drill(r.id) }, r.name, ' ', h('span', { class: 'badge' }, UNIT_TYPE[r.unit_type])) : h('a', { href: '#/employee/' + r.id }, r.full_name), sortValue: r => r.name || r.full_name },
      { key: 'headcount', label: 'الموظفون', num: true, render: r => num(r.kind === 'unit' ? fmt.int(r.headcount) : EMP_STATUS[r.status]) , sortValue: r => r.headcount ?? 0 },
      { key: 'bal', label: 'الرصيد (يوم)', num: true, render: r => num(fmt.days(r.kind === 'unit' ? r.balance_now : r.m.available_now)), sortValue: r => (r.kind === 'unit' ? r.balance_now : r.m.available_now) },
      { key: 'used', label: 'المستخدم', num: true, render: r => num(fmt.days(r.kind === 'unit' ? r.used : r.m.used)), sortValue: r => (r.kind === 'unit' ? r.used : r.m.used) },
      { key: 'proj', label: 'المتوقع نهاية السنة', num: true, render: r => num(fmt.days(r.kind === 'unit' ? r.projected : r.m.projected_year_end)), sortValue: r => (r.kind === 'unit' ? r.projected : r.m.projected_year_end) },
      ...(fin ? [{ key: 'val', label: 'الالتزام (ر.س)', num: true, render: r => num(fmt.sar(r.kind === 'unit' ? r.value_now : r.m.value_now)), sortValue: r => (r.kind === 'unit' ? r.value_now : r.m.value_now) }] : []),
      { key: 'tgt', label: 'المستهدف', num: true, render: r => num(fmt.days(r.kind === 'unit' ? (r.has_target ? r.target_days : null) : r.target_days)), sortValue: r => (r.kind === 'unit' ? r.target_days : r.target_days) },
      { key: 'ach', label: 'نسبة الإنجاز', render: r => r.kind === 'unit' ? (r.has_target ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, progressBar(r.achievement, r.target_status), num(fmt.pct(r.achievement))) : '—')
        : (r.target_days === null ? '—' : statusBadge(r.m.projected_year_end <= r.target_days ? 'achieved' : 'at_risk')), sortable: false },
    ];
    out.append(table(cols, d.rows, { empty: 'لا توجد وحدات أو موظفون ضمن هذا النطاق' }));
    return out;
  }

  await load();
  return root;
}
