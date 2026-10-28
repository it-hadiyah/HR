// لوحة مؤشرات أرصدة الإجازات: النتائج والأداء والخطة والإحصاءات (للعرض فقط، مبنية على بيانات المتابعة)
import { h, api, qs, fmt, num, select } from '../core.js';
import { getUnits } from '../filters.js';
import { chart, dataset, palette, destroyCharts } from '../charts.js';

const LEVEL = [['sector', 'حسب القطاع'], ['department', 'حسب الإدارة'], ['section', 'حسب القسم']];
const UNIT_LABEL = { sector: 'قطاع', department: 'إدارة', section: 'قسم' };

function kpi(label, value, unit, { hint, tone } = {}) {
  return h('div', { class: 'card kpi ' + (tone || '') }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, num(value), unit && h('span', { class: 'unit' }, unit)), hint && h('div', { class: 'hint' }, hint));
}
const title = t => h('div', { class: 'section-title' }, t);

function bar(pct, tone = '') {
  return h('div', { class: 'ibar ' + tone, title: fmt.pct(pct) }, h('i', { style: { width: Math.max(0, Math.min(100, pct ?? 0)) + '%' } }));
}

export default async function indicators() {
  const root = h('div');
  const thisYear = new Date().getFullYear();
  const yearSel = select([thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(y => [y, y]), thisYear, { 'aria-label': 'السنة' });
  const levelSel = select(LEVEL, 'sector', { 'aria-label': 'التجميع' });
  const units = await getUnits();
  const unitSel = select([['', 'كل الوحدات'], ...units.filter(u => u.unit_type !== 'org').map(u => [u.id, `${UNIT_LABEL[u.unit_type] || ''}: ${u.name}`])], '', { 'aria-label': 'الوحدة' });
  const body = h('div');
  root.append(h('div', { class: 'card filters no-print' }, h('div', { class: 'row center' },
    h('label', { class: 'f' }, 'السنة', yearSel), h('label', { class: 'f' }, 'التجميع', levelSel), h('label', { class: 'f' }, 'الوحدة', unitSel), h('div', { class: 'spacer' }),
    h('a', { class: 'btn', href: '#/' }, 'فتح جدول المتابعة'), h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة'))), body);

  async function load() {
    body.replaceChildren(h('div', { class: 'loading' }, 'جارٍ احتساب المؤشرات…'));
    destroyCharts();
    let d;
    try { d = await api('/tracking/indicators' + qs({ year: yearSel.value, level: levelSel.value, unit: unitSel.value })); } catch (e) { body.replaceChildren(h('div', { class: 'card err' }, e.message)); return; }
    body.replaceChildren(render(d));
  }
  for (const el of [yearSel, levelSel, unitSel]) el.addEventListener('change', load);

  function render(d) {
    const k = d.kpis, fin = d.fin, P = palette(), out = h('div');
    const money = v => fmt.sar(v);
    const lvl = LEVEL.find(l => l[0] === d.level)[1].replace('حسب ', '');
    if (!k.employees) { out.append(h('div', { class: 'card', style: { textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد بيانات لهذه السنة. عبّئ جدول المتابعة أو استورد ملف Excel.')); return out; }

    // ---- النتائج ----
    out.append(title('النتائج'), h('div', { class: 'grid kpis' },
      kpi('الموظفون', fmt.int(k.employees), 'موظف', { hint: `اكتمال البيانات ${fmt.pct(k.completion_pct)}`, tone: k.completion_pct < 100 ? 'warn' : 'ok' }),
      kpi('إجمالي الرصيد الكلي', fmt.days(k.total_balance), 'يوم', { hint: `المتوسط ${fmt.days(k.avg_balance)} يوم للموظف` }),
      kpi('إجمالي الرصيد السنوي', fmt.days(k.annual_balance), 'يوم'),
      kpi('أرصدة مرتفعة', fmt.int(k.high_balance), 'موظف', { tone: k.high_balance ? 'bad' : 'ok', hint: `أكثر من ${fmt.days(d.max_balance_cap)} يوماً` }),
      ...(fin ? [kpi('التكلفة المالية للأرصدة', money(k.cost_now), 'ر.س', { tone: 'bad', hint: 'الرصيد الكلي × أجر اليوم' }), kpi('التكلفة بعد تحقق المستهدف', money(k.cost_after_target), 'ر.س'),
        kpi('التوفير المتوقع', money(k.saving), 'ر.س', { tone: 'ok' })] : [])));

    // ---- الأداء ----
    const ach = k.achievement_pct, time = d.elapsed_pct;
    const ahead = ach !== null && ach >= time - 5;
    out.append(title('الأداء'), h('div', { class: 'grid kpis' },
      kpi('المستهدف لهذه السنة', fmt.days(k.target_days), 'يوم'), kpi('المستخدم حتى الآن', fmt.days(k.used_days), 'يوم'),
      kpi('نسبة الإنجاز', ach === null ? '—' : fmt.pct(ach), '', { tone: ach === null ? '' : ahead ? 'ok' : 'warn', hint: `الوقت المنقضي من السنة ${fmt.pct(time)}` }),
      kpi('حققوا المستهدف', fmt.int(d.distribution.achieved), 'موظف', { tone: 'ok' }), kpi('متأخرون عن الخطة', fmt.int(d.distribution.lagging), 'موظف', { tone: d.distribution.lagging ? 'bad' : '' })),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('h3', null, 'الإنجاز مقابل الوقت المنقضي'),
      h('div', { class: 'cmp' }, h('span', null, 'الإنجاز'), bar(ach ?? 0, ahead ? 'ok' : 'warn'), h('b', null, ach === null ? '—' : fmt.pct(ach))),
      h('div', { class: 'cmp' }, h('span', null, 'الوقت المنقضي'), bar(time, 'muted'), h('b', null, fmt.pct(time))),
      h('p', { class: 'sub', style: { margin: '8px 0 0' } }, ach === null ? 'لا يوجد مستهدف مُدخل.' : ahead ? 'الأداء مطابق للخطة أو متقدم عنها.' : 'الإنجاز متأخر عن الوقت المنقضي؛ راجع قائمة المتأخرين أدناه.')),
    h('div', { class: 'grid charts', style: { marginTop: '14px' } },
      chart('حالة الموظفين من المستهدف', 'doughnut', { labels: ['حققوا المستهدف', 'يسيرون وفق الخطة', 'متأخرون', 'بلا مستهدف'],
        datasets: [{ data: [d.distribution.achieved, d.distribution.on_track, d.distribution.lagging, d.distribution.no_target], backgroundColor: [P[1], P[0], '#d64545', '#9aa4ab'] }] }, { options: { cutout: '58%' } }),
      chart(`المستخدم مقابل المستهدف (${lvl})`, 'bar', { labels: d.groups.map(g => g.name), datasets: [dataset('المستهدف', d.groups.map(g => g.target_days), P[3]), dataset('المستخدم', d.groups.map(g => g.used_days), P[0])] })));

    // ---- الخطة ----
    out.append(title('الخطة'), h('div', { class: 'grid kpis' },
      kpi('المتبقي لتحقيق المستهدف', fmt.days(k.remaining_to_target), 'يوم'),
      kpi('الأشهر المتبقية', fmt.days(d.months_left), 'شهر'),
      kpi('المطلوب استخدامه شهرياً', k.required_per_month === null ? '—' : fmt.days(k.required_per_month), 'يوم/شهر', { tone: 'warn', hint: 'لتحقيق المستهدف قبل نهاية السنة' }),
      kpi('الرصيد المتوقع نهاية السنة', fmt.days(k.total_balance - k.remaining_to_target), 'يوم', { hint: 'إن تحقق المستهدف' })),
    h('div', { class: 'tbl-wrap', style: { marginTop: '14px' } }, h('table', null,
      h('thead', null, h('tr', null, ['الوحدة', 'الموظفون', 'الرصيد الكلي', 'المستهدف', 'المستخدم', 'المتبقي', 'المطلوب شهرياً', 'الإنجاز', 'الرصيد المتوقع', ...(fin ? ['التكلفة الحالية', 'التكلفة بعد المستهدف', 'التوفير'] : [])].map(t => h('th', null, t)))),
      h('tbody', null, d.groups.map(g => h('tr', null, h('td', null, g.name), h('td', { class: 'n' }, fmt.int(g.employees)), h('td', { class: 'n' }, fmt.days(g.total_balance)), h('td', { class: 'n' }, fmt.days(g.target_days)),
        h('td', { class: 'n' }, fmt.days(g.used_days)), h('td', { class: 'n' }, fmt.days(g.remaining)), h('td', { class: 'n' }, g.required_per_month === null ? '—' : fmt.days(g.required_per_month)),
        h('td', null, g.achievement_pct === null ? '—' : h('div', { class: 'row center', style: { gap: '6px', flexWrap: 'nowrap' } }, bar(g.achievement_pct), h('span', { class: 'n' }, fmt.pct(g.achievement_pct)))),
        h('td', { class: 'n' }, fmt.days(g.expected_balance)), ...(fin ? [h('td', { class: 'n' }, money(g.cost_now)), h('td', { class: 'n' }, money(g.cost_after_target)), h('td', { class: 'n' }, money(g.saving))] : []))))))); 

    // ---- الإحصاءات ----
    out.append(title('الإحصاءات'), h('div', { class: 'grid charts' },
      chart('توزيع الموظفين حسب شرائح الرصيد (يوم)', 'bar', { labels: d.bands.map(b => b.label), datasets: [dataset('عدد الموظفين', d.bands.map(b => b.count), P[0])] }),
      chart(`الرصيد الكلي (${lvl})`, 'bar', { labels: d.groups.map(g => g.name), datasets: [dataset('الرصيد الكلي', d.groups.map(g => g.total_balance), P[0]), dataset('الرصيد السنوي', d.groups.map(g => g.annual_balance), P[4])] }),
      ...(fin ? [chart(`التكلفة المالية (${lvl}) — ر.س`, 'bar', { labels: d.groups.map(g => g.name), datasets: [dataset('التكلفة الحالية', d.groups.map(g => g.cost_now), '#d64545'), dataset('بعد تحقق المستهدف', d.groups.map(g => g.cost_after_target), P[1])] }, { options: { indexAxis: 'y' } })] : []),
      chart('اتجاه السنوات', 'bar', { labels: d.yearly.map(y => String(y.year)), datasets: [dataset('الرصيد الكلي', d.yearly.map(y => y.total_balance), P[0]), dataset('المستهدف', d.yearly.map(y => y.target_days), P[3]), dataset('المستخدم', d.yearly.map(y => y.used_days), P[4])] })));

    const empTable = (t, rows, valueLabel) => h('div', { class: 'card' }, h('h3', null, t), h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['الموظف', 'الوحدة', 'الرصيد', 'المستهدف', 'المستخدم', valueLabel].map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map(e => h('tr', null, h('td', null, h('a', { href: '#/employee/' + e.employee_id }, e.full_name)), h('td', { class: 'sub' }, e.unit || '—'), h('td', { class: 'n' }, fmt.days(e.total_balance)),
        h('td', { class: 'n' }, fmt.days(e.target_days)), h('td', { class: 'n' }, fmt.days(e.used_days)), h('td', { class: 'n' }, valueLabel === 'التكلفة (ر.س)' ? money(e.cost_now) : fmt.days(e.remaining_to_target)))) : h('tr', null, h('td', { colspan: 6, class: 'sub' }, 'لا يوجد'))))));
    out.append(h('div', { class: 'grid charts', style: { marginTop: '14px' } },
      empTable(fin ? 'أعلى 10 موظفين من حيث التكلفة' : 'أعلى 10 موظفين من حيث الرصيد', d.top, fin ? 'التكلفة (ر.س)' : 'المتبقي للمستهدف'),
      empTable('أكثر المتأخرين عن الخطة (المتبقي للمستهدف)', d.lagging, 'المتبقي للمستهدف')));
    return out;
  }

  await load();
  return root;
}
