import { h, mount, icon, btn, api, can, state, fmtMoney, fmtInt, fmtDate, fld, errMsg, errorBox, skeleton, empty, badge, qs } from '../lib.js';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function kpi({ label, value, sub, href, tone, unit }) {
  return h('a', { class: 'kpi', href }, h('span', { class: 'k-l' }, label),
    h('span', { class: `k-v ${tone || ''}` }, value, unit ? h('small', {}, unit) : null),
    h('span', { class: 'k-s' }, sub || ' '));
}
function srTable(caption, rows) {
  return h('table', { class: 'sr-only' }, h('caption', {}, caption), h('tbody', {}, rows.map(([a, b]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, b)))));
}

export default async function render(root, { query }) {
  const charts = [];
  const range = { from: query.from || '', to: query.to || '' };
  const body = h('div');
  const from = fld({ label: 'من تاريخ', name: 'from', type: 'date', value: range.from });
  const to = fld({ label: 'إلى تاريخ', name: 'to', type: 'date', value: range.to });
  const apply = () => { location.hash = `#/${qs({ from: from.input.value, to: to.input.value })}`; };
  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'نظرة عامة'), h('p', {}, 'مؤشرات مباشرة من قاعدة البيانات. اضغط أي مؤشر لعرض الأعضاء المرتبطين به.')),
      h('div', { class: 'range' }, from.root, to.root, btn('تطبيق', { cls: 'primary', onClick: apply }), btn('', { ic: 'refresh', title: 'تحديث', onClick: () => route() }))),
    body);
  const route = () => load();
  async function load() {
    mount(body, skeleton(8));
    charts.splice(0).forEach((c) => c.destroy());
    let d;
    try { d = await api('/dashboard', { params: range }); } catch (e) { return mount(body, h('div', { class: 'panel' }, errorBox(e, load))); }
    const k = d.kpis, fin = can('payments.view');
    const r = d.range;
    const items = [
      kpi({ label: 'إجمالي الأعضاء', value: fmtInt(k.total_members), sub: `${fmtInt(k.suspended)} معلّقة · ${fmtInt(k.cancelled)} ملغاة`, href: '#/members' }),
      kpi({ label: 'عضويات سارية', value: fmtInt(k.valid_members), sub: 'تشمل القريبة من الانتهاء', href: '#/members?membership_status=active,near_expiry', tone: 'ok' }),
      kpi({ label: 'عضويات قريبة من الانتهاء', value: fmtInt(k.near_expiry), sub: `خلال ${fmtInt(state.meta.defaults.expiry_warning_days)} يومًا`, href: '#/members?membership_status=near_expiry' }),
      kpi({ label: 'عضويات منتهية', value: fmtInt(k.expired), sub: 'تجاوزت تاريخ الانتهاء', href: '#/members?membership_status=expired', tone: k.expired ? 'bad' : '' }),
      kpi({ label: 'أعضاء جدد', value: fmtInt(k.new_members), sub: h('span', { class: 'ltr' }, `${fmtDate(r.from)} – ${fmtDate(r.to)}`), href: `#/members?joined_from=${r.from}&joined_to=${r.to}` }),
      fin ? kpi({ label: 'إجمالي الاشتراكات المستحقة', value: fmtMoney(k.total_due), unit: 'ر.س', sub: 'كل الدورات، دون المعفيّة', href: '#/finance' }) : null,
      fin ? kpi({ label: 'إجمالي المبالغ المحصّلة', value: fmtMoney(k.total_collected), unit: 'ر.س', sub: 'مدفوعات مؤكدة', href: '#/finance?tab=payments', tone: 'ok' }) : null,
      fin ? kpi({ label: 'إجمالي المبالغ المتبقية', value: fmtMoney(k.total_remaining), unit: 'ر.س', sub: 'مستحق غير محصّل', href: '#/members?has_balance=1' }) : null,
      kpi({ label: 'الاشتراكات المتأخرة', value: fmtInt(k.overdue_subscriptions), sub: fin ? `${fmtMoney(k.overdue_amount)} ر.س · ${fmtInt(k.overdue_members)} عضو` : `${fmtInt(k.overdue_members)} عضو`, href: '#/members?payment_status=overdue', tone: k.overdue_subscriptions ? 'bad' : '' }),
      kpi({ label: 'اشتراكات جرى تجديدها', value: fmtInt(k.renewed_members), sub: h('span', { class: 'ltr' }, `${fmtDate(r.from)} – ${fmtDate(r.to)}`), href: `#/members?renewed_from=${r.from}&renewed_to=${r.to}` }),
    ].filter(Boolean);

    const cvs = () => h('canvas', { role: 'img' });
    const c1 = cvs(), c2 = cvs(), c3 = cvs();
    const typeColors = [css('--brand-text'), '#A9741F', '#3E7CB1', '#8C5A9E', '#C2503F', '#5E8C61', '#7A7F3A'];
    const total = d.charts.by_type.reduce((a, b) => a + b.count, 0);
    mount(body,
      h('div', { class: 'ledger' }, items),
      h('div', { class: 'charts' },
        fin ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'تطوّر تحصيل الاشتراكات'), h('span', { class: 'muted small' }, 'آخر 12 شهرًا · ر.س')),
          h('div', { class: 'panel-b' }, h('div', { class: 'chart-box' }, c1), srTable('التحصيل الشهري', d.charts.collections.map((x) => [monthLabel(x.month), fmtMoney(x.amount)])))) : null,
        h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'الأعضاء حسب نوع العضوية')),
          h('div', { class: 'panel-b' }, total ? [h('div', { class: 'chart-box', style: { blockSize: '200px' } }, c2),
            h('div', { class: 'legend' }, d.charts.by_type.map((t, i) => h('a', { href: `#/members${t.type_id ? `?type_id=${t.type_id}` : ''}` }, h('i', { style: { background: typeColors[i % typeColors.length] } }), t.name, h('b', {}, fmtInt(t.count)))))] : empty('لا يوجد أعضاء بعد', 'أضف عضوًا أو استورد قائمة الأعضاء لتظهر التوزيعات.')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'عضويات ستنتهي خلال الأشهر القادمة'), h('span', { class: 'muted small' }, '6 أشهر · عضويات سارية')),
        h('div', { class: 'panel-b' }, h('div', { class: 'chart-box tall' }, c3), srTable('انتهاء العضويات', d.charts.expiring.map((x) => [monthLabel(x.month), fmtInt(x.count)])))));

    if (!window.Chart) return;
    const Chart = window.Chart;
    Chart.defaults.font.family = 'Plex, system-ui, sans-serif'; Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--ink-2'); Chart.defaults.borderColor = css('--line');
    const common = { responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl', callbacks: {} } } };
    if (fin && d.charts.collections) {
      c1.setAttribute('aria-label', `تحصيل شهري، الإجمالي ${fmtMoney(d.charts.collections.reduce((a, x) => a + Number(x.amount), 0))} ريال`);
      charts.push(new Chart(c1, { type: 'bar', data: { labels: d.charts.collections.map((x) => monthLabel(x.month)), datasets: [{ data: d.charts.collections.map((x) => Number(x.amount)), backgroundColor: css('--brand-text'), borderRadius: 4, maxBarThickness: 34 }] },
        options: { ...common, scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', beginAtZero: true, ticks: { callback: (v) => fmtInt(v) } } },
          plugins: { ...common.plugins, tooltip: { rtl: true, callbacks: { label: (c) => `${fmtMoney(c.parsed.y)} ر.س` } } },
          onClick: (e, els) => { if (els[0]) { const m = d.charts.collections[els[0].index].month; location.hash = `#/finance?tab=payments&from=${m}-01&to=${m}-31`; } } } }));
    }
    if (total) {
      c2.setAttribute('aria-label', `توزيع الأعضاء حسب النوع، الإجمالي ${total}`);
      charts.push(new Chart(c2, { type: 'doughnut', data: { labels: d.charts.by_type.map((t) => t.name), datasets: [{ data: d.charts.by_type.map((t) => t.count), backgroundColor: d.charts.by_type.map((_, i) => typeColors[i % typeColors.length]), borderColor: css('--surface'), borderWidth: 2 }] },
        options: { ...common, cutout: '64%', onClick: (e, els) => { if (els[0]) { const t = d.charts.by_type[els[0].index]; location.hash = `#/members${t.type_id ? `?type_id=${t.type_id}` : ''}`; } } } }));
    }
    c3.setAttribute('aria-label', 'عدد العضويات المنتهية شهريًا خلال 6 أشهر');
    charts.push(new Chart(c3, { type: 'bar', data: { labels: d.charts.expiring.map((x) => monthLabel(x.month)), datasets: [{ data: d.charts.expiring.map((x) => x.count), backgroundColor: css('--accent'), borderRadius: 4, maxBarThickness: 40 }] },
      options: { ...common, scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', beginAtZero: true, ticks: { precision: 0, callback: (v) => fmtInt(v) } } },
        plugins: { ...common.plugins, tooltip: { rtl: true, callbacks: { label: (c) => `${c.parsed.y} عضوية` } } },
        onClick: (e, els) => { if (els[0]) { const x = d.charts.expiring[els[0].index]; location.hash = `#/members?membership_status=active,near_expiry&end_from=${x.first_day}&end_to=${x.last_day}`; } } } }));
  }
  await load();
  return () => charts.splice(0).forEach((c) => c.destroy());
}
