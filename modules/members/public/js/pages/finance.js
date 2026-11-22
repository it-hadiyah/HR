import { h, mount, clear, btn, api, can, state, fmtMoney, fmtInt, dateCell, moneyEl, paymentBadge, badge, fld, pager, skeleton, empty, errorBox, debounce, labelOptions, qs } from '../lib.js';

export default async function render(root, { query }) {
  let tab = query.tab === 'payments' ? 'payments' : 'subs';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const ctrl = { c: null };
  const setTab = (t) => { tab = t; history.replaceState(null, '', `#/finance${t === 'payments' ? '?tab=payments' : ''}`); draw(); };
  function drawTabs() {
    mount(tabs, [['subs', 'الاشتراكات'], ['payments', 'المدفوعات']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), type: 'button', onClick: () => setTab(k) }, l)));
  }
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'الاشتراكات والمدفوعات'), h('p', {}, 'الوحدة المالية: الالتزامات المستحقة وسجل التحصيل. تسجيل السداد يتم من ملف العضو.'))), tabs, body);

  function draw() { drawTabs(); tab === 'payments' ? paymentsView() : subsView(); }

  function listView({ path, filters, columns, row, totalsRow, emptyText }) {
    const st = { page: 1 };
    const f = {};
    const bar = h('div', { class: 'toolbar' });
    const table = h('div', { class: 'tablewrap' }), pg = h('div');
    const panel = h('div', { class: 'panel' }, bar, table, pg);
    const inputs = filters.map((x) => { const i = fld(x); if (x.grow) i.root.classList.add('grow'); if (query[x.name]) { i.input.value = query[x.name]; } return i; });
    inputs.forEach((i) => bar.append(i.root));
    async function load() {
      ctrl.c?.abort(); ctrl.c = new AbortController();
      inputs.forEach((i) => { if (i.input.type === 'checkbox') f[i.input.name] = i.input.checked ? '1' : ''; else f[i.input.name] = i.input.value.trim(); });
      mount(table, skeleton(6)); clear(pg);
      let r; try { r = await api(path, { params: { ...f, page: st.page, pageSize: 25 }, signal: ctrl.c.signal }); } catch (e) { if (e.name === 'AbortError') return; return mount(table, errorBox(e, load)); }
      if (!r.rows.length) return mount(table, empty('لا توجد نتائج', emptyText));
      mount(table, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.n ? 'n' : '' }, c.label)))), h('tbody', {}, r.rows.map(row)), totalsRow ? h('tfoot', {}, totalsRow(r)) : null));
      mount(pg, pager({ page: r.page, pageSize: r.pageSize, total: r.total, onPage: (p) => { st.page = p; load(); } }));
    }
    const d = debounce(() => { st.page = 1; load(); }, 280);
    inputs.forEach((i) => i.input.addEventListener(i.input.type === 'search' ? 'input' : 'change', d));
    queueMicrotask(load);
    return panel;
  }

  function subsView() {
    mount(body, listView({
      path: '/subscriptions', emptyText: 'لا توجد اشتراكات مطابقة للمرشحات.',
      filters: [{ label: 'بحث', name: 'q', type: 'search', placeholder: 'اسم العضو أو رقم العضوية', grow: true },
        { label: 'حالة السداد', name: 'payment_status', type: 'select', options: labelOptions(state.meta.labels.payment_status, 'الكل') },
        { label: 'الاستحقاق من', name: 'due_from', type: 'date' }, { label: 'الاستحقاق إلى', name: 'due_to', type: 'date' }],
      columns: [{ label: 'العضو' }, { label: 'الدورة' }, { label: 'الاستحقاق' }, { label: 'المستحق', n: true }, { label: 'المسدد', n: true }, { label: 'المتبقي', n: true }, { label: 'حالة السداد' }],
      row: (s) => h('tr', {}, h('td', { 'data-label': 'العضو' }, h('a', { class: 'name', href: `#/members/${s.member_id}` }, s.full_name), h('div', { class: 'small muted num' }, s.member_no)),
        h('td', { 'data-label': 'الدورة' }, h('span', { class: 'ltr' }, `${s.start_date} – ${s.end_date}`)), h('td', { 'data-label': 'الاستحقاق' }, dateCell(s.due_date)),
        h('td', { class: 'n', 'data-label': 'المستحق' }, s.is_exempt ? 'معفى' : moneyEl(s.amount_due)), h('td', { class: 'n', 'data-label': 'المسدد' }, moneyEl(s.paid)), h('td', { class: 'n', 'data-label': 'المتبقي' }, moneyEl(s.remaining)), h('td', { 'data-label': 'حالة السداد' }, paymentBadge(s.payment_status))),
      totalsRow: (r) => h('tr', {}, h('td', { colspan: 3 }, `الإجمالي (${fmtInt(r.total)} اشتراك)`), h('td', { class: 'n' }, moneyEl(r.totals.due)), h('td', { class: 'n' }, moneyEl(r.totals.paid)), h('td', { class: 'n' }, moneyEl(r.totals.remaining)), h('td')),
    }));
  }
  function paymentsView() {
    mount(body, listView({
      path: '/payments', emptyText: 'لا توجد مدفوعات في هذه الفترة.',
      filters: [{ label: 'بحث', name: 'q', type: 'search', placeholder: 'اسم العضو أو رقم العضوية أو المرجع', grow: true },
        { label: 'من تاريخ', name: 'from', type: 'date' }, { label: 'إلى تاريخ', name: 'to', type: 'date' },
        { label: 'الطريقة', name: 'method', type: 'select', options: labelOptions(state.meta.payment_methods, 'الكل') },
        { label: 'الحالة', name: 'status', type: 'select', options: [{ value: '', label: 'المؤكدة' }, { value: 'voided', label: 'الملغاة' }] }],
      columns: [{ label: 'التاريخ' }, { label: 'العضو' }, { label: 'المبلغ', n: true }, { label: 'الطريقة' }, { label: 'المرجع' }, { label: 'الحالة' }],
      row: (p) => h('tr', {}, h('td', { 'data-label': 'التاريخ' }, dateCell(p.paid_at)), h('td', { 'data-label': 'العضو' }, h('a', { class: 'name', href: `#/members/${p.member_id}` }, p.full_name), h('div', { class: 'small muted num' }, p.member_no)),
        h('td', { class: 'n', 'data-label': 'المبلغ' }, moneyEl(p.amount)), h('td', { 'data-label': 'الطريقة' }, state.meta.payment_methods[p.method]), h('td', { 'data-label': 'المرجع' }, p.reference ? h('span', { class: 'ltr' }, p.reference) : '—'),
        h('td', { 'data-label': 'الحالة' }, p.status === 'voided' ? badge('ملغاة', 'bad') : badge('مؤكدة', 'ok'))),
      totalsRow: (r) => h('tr', {}, h('td', { colspan: 2 }, `إجمالي المدفوعات المؤكدة (${fmtInt(r.total)} عملية)`), h('td', { class: 'n' }, moneyEl(r.sum)), h('td', { colspan: 3 })),
    }));
  }
  draw();
  return () => ctrl.c?.abort();
}
