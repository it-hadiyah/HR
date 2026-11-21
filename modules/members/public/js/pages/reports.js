import { h, mount, icon, btn, api, can, state, fmtMoney, fmtInt, fmtDateTime, dateCell, phoneEl, membershipBadge, paymentBadge, fld, skeleton, empty, errorBox, toast, errMsg, download, typeOptions, labelOptions, qs } from '../lib.js';

const cell = (c, v) => {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.type) {
    case 'money': return h('span', { class: 'num' }, fmtMoney(v));
    case 'date': return dateCell(v);
    case 'phone': return phoneEl(v);
    case 'int': return h('span', { class: 'num' }, fmtInt(v));
    case 'membership_status': return membershipBadge(v);
    case 'payment_status': return paymentBadge(v);
    case 'payment_method': return state.meta.payment_methods[v] || v;
    default: return String(v);
  }
};

export default async function render(root, { query }) {
  let cat;
  try { cat = await api('/reports'); } catch (e) { return mount(root, h('div', { class: 'panel' }, errorBox(e))); }
  let current = cat.find((r) => r.id === query.r) || cat[0];
  const listBox = h('div', { class: 'report-list panel', role: 'listbox', 'aria-label': 'قائمة التقارير' });
  const main = h('div');
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'التقارير'), h('p', {}, 'تقارير قابلة للتصفية والتصدير إلى Excel وPDF بتنسيق عربي.'))), h('div', { class: 'report-layout' }, listBox, main));

  function drawList() {
    mount(listBox, cat.map((r) => h('button', { type: 'button', role: 'option', 'aria-current': String(r.id === current.id), 'aria-selected': String(r.id === current.id), onClick: () => { current = r; history.replaceState(null, '', `#/reports?r=${r.id}`); drawList(); drawReport(); } }, h('span', {}, r.title), r.financial ? h('span', { class: 'badge plain' }, 'مالي') : null)));
  }
  function drawReport() {
    const r = current;
    const from = fld({ label: `${r.dateLabel} – من`, name: 'from', type: 'date' }), to = fld({ label: `${r.dateLabel} – إلى`, name: 'to', type: 'date' });
    const ty = fld({ label: 'نوع العضوية', name: 'type_id', type: 'select', options: typeOptions(true) });
    const ms = r.statusFilter ? fld({ label: 'حالة العضوية', name: 'membership_status', type: 'select', options: [{ value: '', label: 'الكل' }, ...Object.entries(state.meta.labels.membership_status).map(([v, l]) => ({ value: v, label: l }))] }) : null;
    const ps = r.statusFilter && can('reports.financial') ? fld({ label: 'حالة السداد', name: 'payment_status', type: 'select', options: labelOptions(state.meta.labels.payment_status, 'الكل') }) : null;
    const out = h('div', { 'aria-live': 'polite' });
    const params = () => Object.fromEntries([from, to, ty, ms, ps].filter(Boolean).map((x) => [x.input.name, x.input.value]).filter(([, v]) => v));
    let last = null;
    const run = async () => {
      mount(out, skeleton(6));
      try { last = await api(`/reports/${r.id}`, { params: params() }); } catch (e) { return mount(out, errorBox(e, run)); }
      draw(last);
    };
    const exp = (fmt) => async (ev) => { const b = ev.currentTarget; b.setAttribute('aria-busy', 'true'); try { await download(`/reports/${r.id}`, { ...params(), format: fmt }, `${r.id}.${fmt}`); toast('تم تجهيز الملف', 'ok'); } catch (e) { toast(errMsg(e), 'bad'); } finally { b.removeAttribute('aria-busy'); } };
    function draw(d) {
      const filt = [d.filters.from && `من ${d.filters.from}`, d.filters.to && `إلى ${d.filters.to}`].filter(Boolean).join(' ');
      const rows = d.rows.slice(0, 500);
      mount(out,
        h('div', { class: 'print-only', style: { marginBlockEnd: '12px' } }, h('h2', {}, state.meta.org.name), h('h3', {}, d.title), h('p', {}, `${filt ? filt + ' — ' : ''}${fmtDateTime(d.generated_at)}`)),
        h('div', { class: 'panel-h', style: { borderBlockStart: '1px solid var(--line)' } }, h('div', {}, h('h3', {}, d.title), h('span', { class: 'muted small' }, `${fmtInt(d.count)} سجل${filt ? ' · ' + filt : ''}`)),
          h('div', { class: 'actions no-print' }, can('reports.view') ? [btn('Excel', { ic: 'download', onClick: exp('xlsx') }), btn('PDF', { ic: 'file', onClick: exp('pdf') }), btn('طباعة', { ic: 'print', onClick: () => window.print() })] : null)),
        d.rows.length ? [h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, d.columns.map((c) => h('th', { class: c.type === 'money' || c.type === 'int' ? 'n' : '' }, c.label)))),
          h('tbody', {}, rows.map((row) => h('tr', {}, d.columns.map((c) => h('td', { class: c.type === 'money' || c.type === 'int' ? 'n' : '', 'data-label': c.label }, cell(c, row[c.key])))))),
          Object.keys(d.totals).length ? h('tfoot', {}, h('tr', {}, d.columns.map((c, i) => h('td', { class: c.type === 'money' ? 'n' : '' }, i === 0 ? 'الإجمالي' : d.totals[c.key] !== undefined ? h('span', { class: 'num' }, fmtMoney(d.totals[c.key])) : '')))) : null)),
          d.rows.length > 500 ? h('p', { class: 'muted small', style: { padding: '12px 20px' } }, `تُعرض أول 500 صف من ${fmtInt(d.rows.length)}. التصدير يشمل كل السجلات.`) : null]
          : empty('لا توجد بيانات مطابقة', 'غيّر الفترة أو المرشحات ثم أعد تشغيل التقرير.'));
    }
    mount(main, h('div', { class: 'panel' }, h('div', { class: 'toolbar no-print' }, from.root, to.root, ty.root, ms?.root, ps?.root, btn('عرض التقرير', { cls: 'primary', ic: 'chart', onClick: run })), out));
    run();
  }
  drawList(); drawReport();
}
