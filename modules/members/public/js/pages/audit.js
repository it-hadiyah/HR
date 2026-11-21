import { h, mount, clear, btn, api, state, fmtDateTime, fmtInt, fld, pager, skeleton, empty, errorBox, debounce } from '../lib.js';

const ENTITY = { member: 'عضو', period: 'دورة اشتراك', payment: 'سداد', attachment: 'مرفق', user: 'مستخدم', role: 'دور', settings: 'إعدادات', template: 'قالب', membership_type: 'نوع عضوية', import: 'استيراد', export: 'تصدير', notification: 'تنبيه' };

export default async function render(root) {
  const st = { page: 1 };
  const entity = fld({ label: 'الكيان', name: 'entity', type: 'select', options: [{ value: '', label: 'الكل' }, ...Object.entries(ENTITY).map(([value, label]) => ({ value, label }))] });
  const action = fld({ label: 'العملية تبدأ بـ', name: 'action', placeholder: 'payment. / member.' , ltr: true });
  const user = fld({ label: 'المستخدم', name: 'user' });
  const from = fld({ label: 'من', name: 'from', type: 'date' }), to = fld({ label: 'إلى', name: 'to', type: 'date' });
  const table = h('div', { class: 'tablewrap' }), pg = h('div');
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'سجل التدقيق'), h('p', {}, 'سجل للقراءة فقط: لا يمكن تعديل أو حذف أي قيد (يمنع ذلك مشغّل في قاعدة البيانات). الجوال والبريد مقنَّعان.'))),
    h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, entity.root, action.root, user.root, from.root, to.root), table, pg));
  const detail = (x) => h('details', {}, h('summary', {}, 'عرض التغييرات'), h('div', { class: 'diff' }, [...new Set([...Object.keys(x.before || {}), ...Object.keys(x.after || {})])].map((k) => h('div', {}, h('span', { class: 'muted' }, k + ': '), x.before && k in x.before ? [h('del', {}, show(x.before[k])), ' ← '] : null, h('ins', {}, show(x.after?.[k]))))));
  const show = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  async function load() {
    mount(table, skeleton(8)); clear(pg);
    let r; try { r = await api('/audit', { params: { entity: entity.value, action: action.value.trim(), user: user.value.trim(), from: from.value, to: to.value, page: st.page, pageSize: 50 } }); } catch (e) { return mount(table, errorBox(e, load)); }
    if (!r.rows.length) return mount(table, empty('لا توجد قيود مطابقة'));
    mount(table, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['الوقت', 'المستخدم', 'العملية', 'الكيان', 'التفاصيل'].map((x) => h('th', {}, x)))),
      h('tbody', {}, r.rows.map((x) => h('tr', {}, h('td', { 'data-label': 'الوقت' }, h('span', { class: 'ltr' }, fmtDateTime(x.created_at))), h('td', { 'data-label': 'المستخدم' }, x.username || 'النظام'),
        h('td', { 'data-label': 'العملية' }, h('span', { class: 'ltr' }, x.action)), h('td', { 'data-label': 'الكيان' }, `${ENTITY[x.entity] || x.entity} #${x.entity_id ?? ''}`),
        h('td', { 'data-label': 'التفاصيل', style: { maxInlineSize: '460px' } }, (x.before || x.after) ? detail(x) : '—'))))));
    mount(pg, pager({ page: r.page, pageSize: r.pageSize, total: r.total, onPage: (p) => { st.page = p; load(); } }));
  }
  const d = debounce(() => { st.page = 1; load(); }, 300);
  [entity, from, to].forEach((x) => x.input.addEventListener('change', d)); [action, user].forEach((x) => x.input.addEventListener('input', d));
  await load();
}
