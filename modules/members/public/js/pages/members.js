import { h, mount, clear, icon, btn, api, can, state, fmtMoney, fmtInt, dateCell, moneyEl, phoneEl, membershipBadge, paymentBadge, fld, pager, sortHeader, skeleton, empty, errorBox, menuButton, toast, errMsg, download, debounce, typeOptions, labelOptions, qs } from '../lib.js';
import { memberFormModal } from './dialogs.js';

const FILTER_KEYS = ['q', 'membership_status', 'payment_status', 'type_id', 'joined_from', 'joined_to', 'end_from', 'end_to', 'due_from', 'due_to', 'renewed_from', 'renewed_to', 'has_balance', 'partial', 'archived'];
const CHIP_LABELS = { q: 'بحث', membership_status: 'حالة العضوية', payment_status: 'حالة السداد', type_id: 'النوع', joined_from: 'انضم من', joined_to: 'انضم إلى', end_from: 'ينتهي من', end_to: 'ينتهي إلى', due_from: 'استحقاق من', due_to: 'استحقاق إلى', renewed_from: 'جُدّد من', renewed_to: 'جُدّد إلى', has_balance: 'عليه متبقٍ', partial: 'مسدد جزئيًا', archived: 'المؤرشفون' };

export default async function render(root, { query }) {
  const fin = can('payments.view');
  const f = {}; for (const k of FILTER_KEYS) if (query[k]) f[k] = query[k];
  const st = { page: Number(query.page) || 1, pageSize: 25, sort: query.sort || 'member_no', dir: query.dir || 'asc' };
  let ctrl;
  const adv = ['joined_from', 'joined_to', 'end_from', 'end_to', 'due_from', 'due_to', 'archived', 'has_balance', 'renewed_from', 'renewed_to', 'partial'].some((k) => f[k]);

  const q = fld({ label: 'بحث فوري', name: 'q', type: 'search', value: f.q || '', placeholder: 'الاسم أو رقم العضوية أو الجوال أو البريد' });
  q.root.classList.add('grow');
  const ms = fld({ label: 'حالة العضوية', name: 'membership_status', type: 'select', options: [{ value: '', label: 'الكل' }, ...Object.entries(state.meta.labels.membership_status).map(([value, label]) => ({ value, label })), { value: 'active,near_expiry', label: 'سارية (تشمل القريبة)' }], value: f.membership_status || '' });
  const ps = fin ? fld({ label: 'حالة السداد', name: 'payment_status', type: 'select', options: labelOptions(state.meta.labels.payment_status, 'الكل'), value: f.payment_status || '' }) : null;
  const ty = fld({ label: 'نوع العضوية', name: 'type_id', type: 'select', options: typeOptions(true), value: f.type_id || '' });
  const dates = [['joined_from', 'الانضمام من'], ['joined_to', 'الانضمام إلى'], ['end_from', 'الانتهاء من'], ['end_to', 'الانتهاء إلى'], ...(fin ? [['due_from', 'الاستحقاق من'], ['due_to', 'الاستحقاق إلى']] : [])].map(([name, label]) => fld({ label, name, type: 'date', value: f[name] || '' }));
  const arch = fld({ label: 'عرض الأعضاء المؤرشفين فقط', name: 'archived', type: 'checkbox', value: f.archived === '1' });
  const bal = fin ? fld({ label: 'عليهم متبقٍ فقط', name: 'has_balance', type: 'checkbox', value: f.has_balance === '1' }) : null;
  const advBox = h('div', { class: 'toolbar', hidden: !adv }, ...dates.map((d) => d.root), arch.root, bal?.root);
  const chips = h('div', { class: 'chips' });
  const tableBox = h('div', { class: 'tablewrap' });
  const pagerBox = h('div');
  const countEl = h('span', { class: 'muted small', 'aria-live': 'polite' });

  const advToggle = btn('تصفية متقدمة', { cls: 'sm', onClick: () => { advBox.hidden = !advBox.hidden; advToggle.setAttribute('aria-expanded', String(!advBox.hidden)); } });
  advToggle.setAttribute('aria-expanded', String(adv));
  const exp = (fmt) => async () => { try { await download('/members/export', { ...f, format: fmt, sort: st.sort, dir: st.dir }); } catch (e) { toast(errMsg(e), 'bad'); } };
  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'الأعضاء'), h('p', {}, 'قاعدة بيانات أعضاء الجمعية العمومية'), countEl),
      h('div', { class: 'actions' },
        can('members.export') ? menuButton('تصدير', [{ label: 'Excel (xlsx)', icon: 'download', onClick: exp('xlsx') }, { label: 'PDF', icon: 'file', onClick: exp('pdf') }], { ic: 'download' }) : null,
        can('members.import') ? btn('استيراد', { ic: 'upload', onClick: () => { location.hash = '#/import'; } }) : null,
        can('members.create') ? btn('إضافة عضو', { ic: 'plus', cls: 'primary', onClick: () => memberFormModal({ onSaved: (id) => { location.hash = `#/members/${id}`; } }) }) : null)),
    h('div', { class: 'panel' },
      h('div', { class: 'toolbar' }, q.root, ms.root, ps?.root, ty.root, advToggle, btn('مسح', { cls: 'ghost sm', onClick: () => { for (const k of FILTER_KEYS) delete f[k]; syncInputs(); st.page = 1; load(); } })),
      advBox, chips, tableBox, pagerBox));

  const readInputs = () => {
    const set = (k, v) => { if (v) f[k] = v; else delete f[k]; };
    set('q', q.input.value.trim()); set('membership_status', ms.input.value); if (ps) set('payment_status', ps.input.value); set('type_id', ty.input.value);
    dates.forEach((d) => set(d.input.name, d.input.value)); set('archived', arch.input.checked ? '1' : ''); if (bal) set('has_balance', bal.input.checked ? '1' : '');
  };
  const syncInputs = () => {
    q.input.value = f.q || ''; ms.input.value = f.membership_status || ''; if (ps) ps.input.value = f.payment_status || ''; ty.input.value = f.type_id || '';
    dates.forEach((d) => { d.input.value = f[d.input.name] || ''; }); arch.input.checked = f.archived === '1'; if (bal) bal.input.checked = f.has_balance === '1';
  };
  const fmtChip = (k, v) => {
    if (k === 'membership_status') return v.split(',').map((x) => state.meta.labels.membership_status[x] || x).join(' / ');
    if (k === 'payment_status') return v.split(',').map((x) => state.meta.labels.payment_status[x] || x).join(' / ');
    if (k === 'type_id') return state.meta.membership_types.find((t) => String(t.id) === v)?.name_ar || v;
    return ['has_balance', 'partial', 'archived'].includes(k) ? 'نعم' : v;
  };
  const renderChips = () => {
    const act = Object.entries(f).filter(([k]) => k !== 'q' || f.q);
    mount(chips, act.map(([k, v]) => h('span', { class: 'chip' }, `${CHIP_LABELS[k]}: ${fmtChip(k, v)}`, h('button', { type: 'button', 'aria-label': `إزالة ${CHIP_LABELS[k]}`, onClick: () => { delete f[k]; syncInputs(); st.page = 1; load(); } }, icon('x')))));
    chips.hidden = !act.length;
  };
  const urlSync = () => history.replaceState(null, '', `#/members${qs({ ...f, sort: st.sort !== 'member_no' ? st.sort : '', dir: st.dir !== 'asc' ? st.dir : '', page: st.page > 1 ? st.page : '' })}`);

  async function load() {
    ctrl?.abort(); ctrl = new AbortController();
    renderChips(); urlSync();
    mount(tableBox, skeleton(6)); clear(pagerBox);
    let r;
    try { r = await api('/members', { params: { ...f, ...st }, signal: ctrl.signal }); } catch (e) { if (e.name === 'AbortError') return; return mount(tableBox, errorBox(e, load)); }
    countEl.textContent = `${fmtInt(r.total)} عضو مطابق`;
    if (!r.rows.length) {
      return mount(tableBox, empty(Object.keys(f).length ? 'لا توجد نتائج مطابقة' : 'لا يوجد أعضاء بعد', Object.keys(f).length ? 'جرّب تعديل البحث أو إزالة بعض المرشحات.' : 'أضف أول عضو أو استورد قائمة الأعضاء من ملف Excel.',
        !Object.keys(f).length && can('members.create') ? btn('إضافة عضو', { cls: 'primary', ic: 'plus', onClick: () => memberFormModal({ onSaved: (id) => { location.hash = `#/members/${id}`; } }) }) : null));
    }
    const onSort = (k, d) => { st.sort = k; st.dir = d; st.page = 1; load(); };
    const sh = (label, key, cls) => sortHeader(label, key, st.sort, st.dir, onSort, cls);
    mount(tableBox, h('table', { class: 't cards' },
      h('thead', {}, h('tr', {}, sh('رقم العضوية', 'member_no'), sh('الاسم', 'full_name'), sh('الجوال', 'phone'), sh('النوع', 'type_name'), sh('البداية', 'period_start'), sh('الانتهاء', 'period_end'),
        ...(fin ? [sh('المستحق', 'amount_due', 'n'), sh('المسدد', 'paid', 'n'), sh('المتبقي', 'remaining', 'n'), sh('الاستحقاق', 'due_date')] : []), sh('حالة العضوية', 'membership_status'), ...(fin ? [sh('حالة السداد', 'payment_status')] : []))),
      h('tbody', {}, r.rows.map((m) => h('tr', {},
        h('td', { 'data-label': 'رقم العضوية' }, h('span', { class: 'num' }, m.member_no)),
        h('td', { 'data-label': 'الاسم' }, h('a', { class: 'name', href: `#/members/${m.id}` }, m.full_name), m.archived_at ? [' ', h('span', { class: 'badge plain' }, 'مؤرشف')] : null, m.email ? h('div', { class: 'small muted ltr' }, m.email) : null),
        h('td', { 'data-label': 'الجوال' }, phoneEl(m.phone)),
        h('td', { 'data-label': 'النوع' }, m.type_name || '—'),
        h('td', { 'data-label': 'البداية' }, dateCell(m.period_start)),
        h('td', { 'data-label': 'الانتهاء' }, dateCell(m.period_end)),
        ...(fin ? [h('td', { class: 'n', 'data-label': 'المستحق' }, m.is_exempt ? 'معفى' : moneyEl(m.amount_due)), h('td', { class: 'n', 'data-label': 'المسدد' }, moneyEl(m.paid)),
          h('td', { class: 'n', 'data-label': 'المتبقي' }, moneyEl(m.remaining)), h('td', { 'data-label': 'الاستحقاق' }, dateCell(m.due_date))] : []),
        h('td', { 'data-label': 'حالة العضوية' }, membershipBadge(m.membership_status)),
        ...(fin ? [h('td', { 'data-label': 'حالة السداد' }, paymentBadge(m.payment_status))] : []))))));
    mount(pagerBox, pager({ page: r.page, pageSize: r.pageSize, total: r.total, onPage: (p) => { st.page = p; load(); window.scrollTo({ top: 0 }); } }));
  }
  const reload = () => { readInputs(); st.page = 1; load(); };
  const debounced = debounce(reload, 280);
  q.input.addEventListener('input', debounced);
  [ms, ps, ty, arch, bal, ...dates].filter(Boolean).forEach((x) => x.input.addEventListener('change', reload));
  await load();
  return () => ctrl?.abort();
}
