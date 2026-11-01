// مقارنة بين سنوات: الفرق والأداء للموظفين أنفسهم عبر السنوات، مع نفس نظام الفلترة المتقدمة.
import { h, api, qs, fmt, num, select, table } from '../core.js';
import { createFilterPanel, emptySpec, normalizeSpec, specCount } from '../filter-panel.js';
import { chart, dataset, palette, destroyCharts } from '../charts.js';

const LEVEL = [['sector', 'حسب القطاع'], ['department', 'حسب الإدارة'], ['section', 'حسب القسم']];
const TREND = { improved: ['تحسّن', 'ok'], steady: ['مستقر', 'info'], declined: ['تراجع', 'bad'], new: ['جديد', 'warn'], none: ['—', ''] };

const arrow = (d, goodUp = true, f = fmt.days) => {
  if (d === null || d === undefined) return '—';
  if (d === 0) return h('span', { class: 'delta flat' }, '＝ 0');
  return h('span', { class: 'delta ' + ((d > 0) === goodUp ? 'up' : 'down') }, (d > 0 ? '▲ ' : '▼ ') + f(Math.abs(d)));
};

export default async function compare() {
  const root = h('div');
  const q0 = new URLSearchParams((location.hash.split('?')[1]) || '');
  const { years: avail } = await api('/tracking/years');
  const withData = avail.filter(y => y.employees > 0).map(y => y.year);
  let picked = (q0.get('years') || '').split(',').map(Number).filter(y => avail.some(a => a.year === y));
  if (picked.length < 2) picked = (withData.length >= 2 ? withData : avail.map(a => a.year)).slice(-2);
  let spec = emptySpec(); try { spec = normalizeSpec(JSON.parse(q0.get('f') || '{}')); } catch { /* رابط تالف */ }
  const levelSel = select(LEVEL, LEVEL.some(l => l[0] === q0.get('level')) ? q0.get('level') : 'sector', { 'aria-label': 'التجميع' });
  const chipsBox = h('div', { class: 'fsegs' }), panelBox = h('div'), body = h('div');
  let panel = null, seq = 0;
  const shareUrl = sp => `${location.origin}${location.pathname}#/compare?${new URLSearchParams({ years: picked.join(','), level: levelSel.value, f: JSON.stringify(sp) })}`;
  const syncUrl = () => history.replaceState(null, '', shareUrl(spec).slice(location.origin.length));

  function drawYears() {
    chipsBox.replaceChildren(h('span', { class: 'flabel' }, 'السنوات المقارَنة (2–4)'), ...avail.map(a => h('button', { type: 'button', class: 'seg' + (picked.includes(a.year) ? ' on' : '') + (a.employees ? '' : ' zero'), title: a.employees ? `${a.employees} موظف · مستهدف ${a.target_days}` : 'لا بيانات',
      onclick: async () => { const s = new Set(picked); s.has(a.year) ? s.delete(a.year) : s.add(a.year); if (s.size < 2 || s.size > 4) return; picked = [...s].sort(); drawYears(); await buildPanel(); load(); } }, String(a.year), h('b', null, String(a.employees)))));
  }
  async function buildPanel() {
    const latest = picked[picked.length - 1];
    const facets = await api('/tracking/facets' + qs({ year: latest }));
    panel = createFilterPanel({ facets, spec, fin: facets.fin, viewsKey: 'hr.compare.views', shareUrl, onChange: sp => { spec = sp; load(); } });
    panelBox.replaceChildren(panel.el);
  }
  async function load() {
    const my = ++seq; syncUrl(); destroyCharts();
    body.replaceChildren(h('div', { class: 'loading' }, 'جارٍ المقارنة…'));
    let d; try { d = await api('/tracking/compare' + qs({ years: picked.join(','), level: levelSel.value, f: specCount(spec) ? JSON.stringify(spec) : '' })); } catch (e) { if (my === seq) body.replaceChildren(h('div', { class: 'card err' }, e.message)); return; }
    if (my === seq) body.replaceChildren(render(d));
  }
  levelSel.addEventListener('change', load);

  function render(d) {
    const out = h('div'), P = palette(), fin = d.fin, ys = d.years, K = d.kpis, D = d.delta;
    const money = v => fmt.sar(v);
    out.append(h('div', { class: 'match-bar' }, h('b', { style: { color: 'var(--text)' } }, `${fmt.int(d.set_size)} موظف`), `من ${fmt.int(d.base_total)} · الفلاتر تُطبَّق على ${d.latest} ويُقارَن الموظفون أنفسهم عبر ${ys.join(' ← ')}`));
    if (!d.set_size) { out.append(h('div', { class: 'card', style: { textAlign: 'center', color: 'var(--muted)' } }, 'لا يوجد موظفون مطابقون للفلاتر.')); return out; }

    // ملخص الأداء
    const a0 = K[d.first].achievement_pct, a1 = K[d.latest].achievement_pct;
    out.append(h('div', { class: 'section-title' }, 'ملخص الأداء'), h('div', { class: 'grid kpis' },
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, `نسبة الإنجاز ${d.latest}`), h('div', { class: 'value' }, num(a1 === null ? '—' : fmt.pct(a1)), a0 !== null && a1 !== null ? arrow(Math.round((a1 - a0) * 100) / 100, true, fmt.pct) : null), h('div', { class: 'hint' }, `مقابل ${a0 === null ? '—' : fmt.pct(a0)} في ${d.first}`)),
      h('div', { class: 'card kpi ok' }, h('div', { class: 'label' }, 'تحسّنوا'), h('div', { class: 'value' }, num(fmt.int(d.trends.improved)), h('span', { class: 'unit' }, 'موظف')), h('div', { class: 'hint' }, 'ارتفعت نسبة إنجازهم أكثر من 5 نقاط')),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'مستقرون'), h('div', { class: 'value' }, num(fmt.int(d.trends.steady)), h('span', { class: 'unit' }, 'موظف'))),
      h('div', { class: 'card kpi bad' }, h('div', { class: 'label' }, 'تراجعوا'), h('div', { class: 'value' }, num(fmt.int(d.trends.declined)), h('span', { class: 'unit' }, 'موظف')), h('div', { class: 'hint' }, 'انخفضت نسبة إنجازهم أكثر من 5 نقاط')),
      h('div', { class: 'card kpi warn' }, h('div', { class: 'label' }, `جدد في ${d.latest}`), h('div', { class: 'value' }, num(fmt.int(d.trends.new)), h('span', { class: 'unit' }, 'موظف')), h('div', { class: 'hint' }, `بلا مستهدف في ${d.first}`))));

    // جدول المؤشرات عبر السنوات
    const METRICS = [['with_data', 'موظفون لديهم بيانات', true, fmt.int], ['total_balance', 'إجمالي الأرصدة الموجبة (يوم)', false, fmt.days], ['annual_balance', 'إجمالي الرصيد السنوي (يوم)', true, fmt.days],
      ['owed_days', 'مستحق على الموظفين (يوم)', false, fmt.days], ['target_days', 'المستهدف (يوم)', true, fmt.days], ['used_days', 'المستخدم (يوم)', true, fmt.days], ['remaining_to_target', 'المتبقي للمستهدف (يوم)', false, fmt.days],
      ['achievement_pct', 'نسبة الإنجاز %', true, fmt.pct], ['achieved', 'حققوا المستهدف (موظف)', true, fmt.int], ['high_balance', 'أرصدة مرتفعة (موظف)', false, fmt.int],
      ...(fin ? [['cost_now', 'تكلفة الإجازة الكلية (ر.س)', false, money], ['cost_target', 'تكلفة المستهدف (ر.س)', true, money], ['cost_remaining_target', 'تكلفة المتبقي من المستهدف (ر.س)', false, money], ['owed_cost', 'مبلغ مستحق على الموظفين (ر.س)', false, money], ['saving', 'التوفير المتوقع (ر.س)', true, money]] : [])];
    out.append(h('div', { class: 'section-title' }, 'المؤشرات عبر السنوات'), h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, [h('th', null, 'المؤشر'), ...ys.map(y => h('th', null, String(y))), h('th', null, `الفرق (${d.latest} − ${d.first})`), h('th', null, 'التغيّر %')])),
      h('tbody', null, METRICS.map(([k, label, goodUp, f]) => h('tr', null, h('td', null, label), ...ys.map(y => h('td', { class: 'n' }, K[y][k] === null || K[y][k] === undefined ? '—' : f(K[y][k]))),
        h('td', { class: 'n' }, D[k] ? arrow(D[k].abs, goodUp, f) : '—'), h('td', { class: 'n' }, D[k]?.pct === null || !D[k] ? '—' : arrow(D[k].pct, goodUp, v => fmt.pct(v)))))))));

    // الرسوم
    out.append(h('div', { class: 'section-title' }, 'الرسوم'), h('div', { class: 'grid charts' },
      chart('المستهدف والمستخدم والرصيد عبر السنوات', 'bar', { labels: ys.map(String), datasets: [dataset('المستهدف', ys.map(y => K[y].target_days), P[3]), dataset('المستخدم', ys.map(y => K[y].used_days), P[0]), dataset('الرصيد الموجب', ys.map(y => K[y].total_balance), P[4])] }),
      chart('نسبة الإنجاز % عبر السنوات', 'bar', { labels: ys.map(String), datasets: [dataset('نسبة الإنجاز', ys.map(y => K[y].achievement_pct ?? 0), P[1])] }, { options: { scales: { y: { max: 100 } } } }),
      chart(`نسبة الإنجاز % لكل وحدة`, 'bar', { labels: d.groups.map(g => g.name), datasets: ys.map((y, i) => dataset(String(y), d.groups.map(g => g.per_year[y].achievement_pct ?? 0), P[i % P.length])) }),
      chart(`الفرق في المستخدم (${d.latest} − ${d.first}) لكل وحدة`, 'bar', { labels: d.groups.map(g => g.name), datasets: [dataset('الفرق بالأيام', d.groups.map(g => g.d_used), d.groups.map(g => (g.d_used >= 0 ? P[1] : '#d64545')))] }),
      chart('تغيّر أداء الموظفين', 'doughnut', { labels: ['تحسّنوا', 'مستقرون', 'تراجعوا', 'جدد'], datasets: [{ data: [d.trends.improved, d.trends.steady, d.trends.declined, d.trends.new], backgroundColor: [P[1], P[0], '#d64545', '#9aa4ab'] }] }, { options: { cutout: '58%' } }),
      ...(fin ? [chart('تكلفة الإجازة الكلية والمستهدفة عبر السنوات (ر.س)', 'bar', { labels: ys.map(String), datasets: [dataset('تكلفة الإجازة الكلية', ys.map(y => K[y].cost_now), '#d64545'), dataset('تكلفة المستهدف', ys.map(y => K[y].cost_target), P[3]), dataset('المتبقي من المستهدف', ys.map(y => K[y].cost_remaining_target), P[4])] })] : [])));

    // جدول الوحدات
    out.append(h('div', { class: 'section-title' }, `المقارنة ${LEVEL.find(l => l[0] === d.level)[1]}`), h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, [h('th', null, 'الوحدة'), h('th', null, 'الموظفون'), ...ys.flatMap(y => [h('th', null, `${y} مستهدف`), h('th', null, `${y} مستخدم`), h('th', null, `${y} إنجاز`)]), h('th', null, 'فرق المستخدم'), h('th', null, 'فرق الإنجاز'), ...(fin ? [h('th', null, 'فرق التكلفة')] : [])])),
      h('tbody', null, d.groups.map(g => h('tr', null, h('td', null, g.name), h('td', { class: 'n' }, fmt.int(g.employees)),
        ...ys.flatMap(y => [h('td', { class: 'n' }, fmt.days(g.per_year[y].target_days)), h('td', { class: 'n' }, fmt.days(g.per_year[y].used_days)), h('td', { class: 'n' }, g.per_year[y].achievement_pct === null ? '—' : fmt.pct(g.per_year[y].achievement_pct))]),
        h('td', { class: 'n' }, arrow(g.d_used, true)), h('td', { class: 'n' }, g.d_achievement === null ? '—' : arrow(g.d_achievement, true, fmt.pct)), ...(fin ? [h('td', { class: 'n' }, arrow(g.d_cost, false, money))] : [])))))));

    // جدول الموظفين
    out.append(h('div', { class: 'section-title' }, `الموظفون (${fmt.int(d.set_size)}${d.set_size > d.employees.length ? ` — عرض أول ${d.employees.length}` : ''})`),
      table([
        { key: 'full_name', label: 'الموظف', render: e => h('a', { href: '#/employee/' + e.employee_id }, e.full_name) }, { key: 'unit', label: 'الوحدة' },
        ...ys.map(y => ({ key: 'y' + y, label: String(y) + ' (مستخدم/مستهدف)', render: e => { const v = e.per_year[y]; return v ? num(`${fmt.days(v.used_days)} / ${fmt.days(v.target_days)}`) : '—'; }, sortValue: e => e.per_year[y]?.used_days ?? -1e9, sortable: true })),
        { key: 'd_used', label: 'فرق المستخدم', num: true, render: e => arrow(e.d_used, true), sortValue: e => e.d_used ?? -1e9 },
        { key: 'd_progress', label: 'فرق الإنجاز (نقاط)', num: true, render: e => arrow(e.d_progress, true, fmt.pct), sortValue: e => e.d_progress ?? -1e9 },
        { key: 'trend', label: 'الأداء', render: e => h('span', { class: 'badge ' + TREND[e.trend][1] }, TREND[e.trend][0]), sortValue: e => TREND[e.trend][0] },
      ], d.employees, { empty: 'لا يوجد' }));
    return out;
  }

  root.append(h('div', { class: 'card filters no-print', style: { marginBottom: '10px' } }, h('div', { class: 'row center' }, chipsBox, h('label', { class: 'f' }, 'التجميع', levelSel), h('div', { class: 'spacer' }),
    h('a', { class: 'btn', href: '#/' }, 'جدول المتابعة'), h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة'))), panelBox, body);
  drawYears(); await buildPanel(); await load();
  return root;
}
