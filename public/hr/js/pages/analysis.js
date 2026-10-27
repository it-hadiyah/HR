import { h, api, qs, state, fmt, num, field, select, table, toast, guard, statusBadge } from '../core.js';
import { filterBar, filterQuery } from '../filters.js';
import { chart, dataset, palette, destroyCharts } from '../charts.js';

export default async function analysis(args) {
  const root = h('div');
  const holder = h('div');
  const body = h('div');
  const mkBar = async () => holder.replaceChildren(await filterBar(r => show(r), { status: false }));
  await mkBar();
  let tab = args[0] || 'alerts';
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['alerts', 'التنبيهات والتوصيات'], ['simulate', 'محاكاة سيناريو التخفيض'], ['forecast', 'التنبؤ بنهاية السنة']].map(([k, t]) =>
    h('button', { role: 'tab', class: tab === k ? 'active' : '', onclick: () => { tab = k; location.hash = '#/analysis/' + k; } }, t)));
  root.append(holder, tabs, body);

  async function show(reset) {
    if (reset === true) await mkBar();
    destroyCharts();
    body.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحليل…'));
    try { body.replaceChildren(await ({ alerts, simulate, forecast }[tab] || alerts)()); } catch (e) { body.replaceChildren(h('div', { class: 'card err' }, e.message)); }
  }

  async function alerts() {
    const d = await api('/dashboard/alerts' + qs(filterQuery()));
    const out = h('div');
    out.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', null, 'توصيات قابلة للتنفيذ'), h('div', { class: 'sub' }, 'مبنية على الأرقام الفعلية الحالية فقط، وليست تقديرات منفصلة عن البيانات'),
      d.recommendations.length ? h('ul', { class: 'reco' }, d.recommendations.map(r => h('li', null, r))) : h('div', { class: 'empty' }, 'لا توجد توصيات: لا فجوات ظاهرة في البيانات الحالية')));
    if (!d.alerts.length) out.append(h('div', { class: 'card empty' }, '✓ لا توجد تنبيهات حالياً'));
    for (const a of d.alerts) {
      const cols = a.items[0] ? Object.keys(a.items[0]).filter(k => k !== 'id') : [];
      const LABEL = { name: 'الاسم', unit: 'الوحدة', balance: 'الرصيد', projected: 'المتوقع نهاية السنة', target: 'المستهدف', value: 'القيمة (ر.س)', share: 'النسبة %', achievement: 'الإنجاز %', progress: 'التقدم %', reduction: 'التخفيض المطلوب' };
      out.append(h('div', { class: `card alert-card ${a.level}`, style: { marginBottom: '14px' } },
        h('div', { class: 'row center' }, h('h3', { style: { margin: 0 } }, a.title), h('span', { class: 'badge ' + (a.level === 'high' ? 'bad' : a.level === 'medium' ? 'warn' : 'info') }, `${a.items.length} عنصر`)),
        h('p', { style: { color: 'var(--muted)' } }, a.text),
        table(cols.map(k => ({ key: k, label: LABEL[k] || k, num: k !== 'name' && k !== 'unit', render: r => (k === 'name' ? (a.key === 'lagging' || a.key === 'high_liability' ? r.name : h('a', { href: '#/employee/' + r.id }, r.name)) : k === 'unit' ? r.unit : num(k === 'value' ? fmt.sar(r[k]) : fmt.days(r[k]))) })), a.items.slice(0, 15))));
    }
    return out;
  }

  async function simulate() {
    const cap = h('input', { type: 'number', min: 0, step: '1', value: sessionStorage.getItem('simCap') || '20', style: { width: '110px' } });
    const level = select([['sector', 'القطاعات'], ['department', 'الإدارات'], ['section', 'الأقسام']], 'sector');
    const res = h('div');
    const fin = state.user.role !== 'sector_manager' && state.user.role !== 'department_manager' && state.user.role !== 'section_manager';
    const run = guard(async () => {
      sessionStorage.setItem('simCap', cap.value);
      destroyCharts();
      const d = await api('/dashboard/simulate' + qs(filterQuery({ cap: cap.value, level: level.value })));
      const t = d.totals, P = palette();
      res.replaceChildren(
        h('div', { class: 'grid kpis', style: { margin: '14px 0' } },
          kpi('الأيام المطلوب استخدامها', fmt.days(t.days_to_use), 'يوم'), kpi('موظفون متأثرون', `${fmt.int(t.affected_employees)} من ${fmt.int(t.headcount)}`),
          fin ? kpi('القيمة المالية المتوقع تخفيضها', fmt.sar(t.value_reduction), 'ر.س') : null, fin ? kpi('الالتزام بعد التخفيض', fmt.sar(t.value_after), 'ر.س') : null),
        h('div', { class: 'grid charts' }, chart('الأيام المطلوب استخدامها حسب الوحدة', 'bar', { labels: d.rows.map(r => r.name), datasets: [dataset('أيام مطلوبة', d.rows.map(r => r.days_to_use), P[2])] }, { options: { plugins: { legend: { display: false } } } }),
          fin ? chart('الالتزام قبل التخفيض وبعده (ر.س)', 'bar', { labels: d.rows.map(r => r.name), datasets: [dataset('قبل', d.rows.map(r => r.value_before), P[5]), dataset('بعد', d.rows.map(r => r.value_after), P[0])] }) : null),
        h('div', { style: { height: '14px' } }),
        table([{ key: 'name', label: 'الوحدة' }, { key: 'headcount', label: 'الموظفون', num: true, render: r => num(r.headcount) }, { key: 'affected', label: 'المتأثرون', num: true, render: r => num(r.affected) },
          { key: 'projected_days', label: 'المتوقع نهاية السنة', num: true, render: r => num(fmt.days(r.projected_days)) }, { key: 'days_to_use', label: 'أيام مطلوبة', num: true, render: r => num(fmt.days(r.days_to_use)) },
          ...(fin ? [{ key: 'value_reduction', label: 'قيمة التخفيض (ر.س)', num: true, render: r => num(fmt.sar(r.value_reduction)) }, { key: 'value_after', label: 'الالتزام بعد (ر.س)', num: true, render: r => num(fmt.sar(r.value_after)) }] : [])], d.rows,
        { totals: { days_to_use: t.days_to_use, headcount: t.headcount, affected: t.affected_employees, value_reduction: t.value_reduction, value_after: t.value_after } }),
        h('ul', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, d.assumptions.map(a => h('li', null, a))));
    });
    cap.addEventListener('change', run); level.addEventListener('change', run);
    const out = h('div', null, h('div', { class: 'card' }, h('h3', null, 'ماذا لو خفضنا رصيد كل موظف إلى …؟'), h('div', { class: 'row' }, field('الرصيد المستهدف لكل موظف (يوم)', cap), field('التجميع حسب', level),
      h('button', { class: 'btn primary', onclick: run }, 'احتساب السيناريو'))), res);
    await run();
    return out;
  }

  async function forecast() {
    const d = await api('/reports/forecast' + qs(filterQuery()));
    return h('div', null, h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', null, 'التنبؤ بالرصيد والتكلفة في 31 ديسمبر (نهاية السنة المالية)'),
      h('ul', { style: { color: 'var(--muted)' } }, (d.notes || []).map(n => h('li', null, n)))),
    table(d.columns.map(c => ({ key: c.key, label: c.label, num: c.fmt !== 'text' && c.fmt !== undefined, render: r => (c.fmt === 'text' || r[c.key] === null || r[c.key] === undefined ? (r[c.key] ?? '—') : num(c.fmt === 'sar' ? fmt.sar(r[c.key]) : c.fmt === 'int' ? fmt.int(r[c.key]) : fmt.days(r[c.key]))) })), d.rows));
  }

  function kpi(label, value, unit) { return h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, num(value), unit && h('span', { class: 'unit' }, unit))); }
  await show();
  return root;
}
