import { h, api, qs, state, fmt, num, field, select, table, toast, guard, confirmBox } from '../core.js';
import { addTx } from './employees.js';

const TYPE = { leave: 'إجازة', adjustment: 'تسوية', settlement: 'تسوية نقدية' };
const STATUS = { approved: ['معتمدة', 'ok'], pending: ['بانتظار الاعتماد', 'warn'], rejected: ['مرفوضة', 'bad'], cancelled: ['ملغاة', ''] };

export default async function leaves() {
  const canEdit = state.user.perms.includes('leaves');
  const root = h('div');
  const year = select([2024, 2025, 2026, 2027].map(y => [y, y]), state.filters.year, { 'aria-label': 'السنة' });
  const status = select([['', 'كل الحالات'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])], '');
  const type = select([['', 'كل الأنواع'], ...Object.entries(TYPE)], '');
  const empInput = h('input', { list: 'emp-list', placeholder: 'اسم/رقم الموظف', 'aria-label': 'الموظف' });
  const dl = h('datalist', { id: 'emp-list' });
  const body = h('div');
  let empMap = new Map();
  const emps = await api('/employees' + qs({ status: 'all', year: state.filters.year }));
  emps.rows.forEach(e => { const key = `${e.emp_no} — ${e.full_name}`; empMap.set(key, e); dl.append(h('option', { value: key })); });
  const load = guard(async () => {
    const emp = empMap.get(empInput.value);
    const rows = await api('/leaves' + qs({ year: year.value, status: status.value, type: type.value, employee: emp?.id }));
    body.replaceChildren(h('div', { style: { marginBottom: '6px', color: 'var(--muted)' } }, `${rows.length} حركة`), table([
      { key: 'emp_no', label: 'الرقم' }, { key: 'full_name', label: 'الموظف', render: r => h('a', { href: '#/employee/' + r.employee_id }, r.full_name) }, { key: 'unit', label: 'الوحدة' },
      { key: 'tx_type', label: 'النوع', render: r => TYPE[r.tx_type], sortValue: r => TYPE[r.tx_type] },
      { key: 'start_date', label: 'من', render: r => fmt.date(r.start_date) }, { key: 'end_date', label: 'إلى', render: r => fmt.date(r.end_date) },
      { key: 'days', label: 'الأيام', num: true, render: r => num(fmt.days(r.days)) },
      { key: 'status', label: 'الحالة', render: r => h('span', { class: 'badge ' + STATUS[r.status][1] }, STATUS[r.status][0]), sortValue: r => STATUS[r.status][0] },
      { key: 'notes', label: 'ملاحظات' },
      ...(canEdit ? [{ key: 'act', label: 'إجراء', sortable: false, render: r => h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
        r.status === 'pending' && h('button', { class: 'btn sm primary', onclick: guard(async () => { await api(`/leaves/${r.id}/status`, { method: 'PUT', body: { status: 'approved' } }); toast('تم الاعتماد'); load(); }) }, 'اعتماد'),
        r.status === 'pending' && h('button', { class: 'btn sm', onclick: guard(async () => { await api(`/leaves/${r.id}/status`, { method: 'PUT', body: { status: 'rejected' } }); toast('تم الرفض'); load(); }) }, 'رفض'),
        (r.status === 'approved' || r.status === 'pending') && h('button', { class: 'btn sm danger', onclick: () => confirmBox('إلغاء هذه الحركة؟', async () => { await api(`/leaves/${r.id}/status`, { method: 'PUT', body: { status: 'cancelled' } }); toast('تم الإلغاء'); load(); }) }, 'إلغاء')) }] : []),
    ], rows, { initialSort: { key: 'start_date', dir: -1 }, empty: 'لا توجد حركات' }));
  });
  for (const el of [year, status, type, empInput]) el.addEventListener('change', load);
  root.append(h('div', { class: 'card filters' }, h('div', { class: 'row' }, field('السنة', year), field('الحالة', status), field('النوع', type), field('الموظف', empInput), dl, h('div', { class: 'spacer' }),
    canEdit && h('button', { class: 'btn primary', onclick: () => {
      const e = empMap.get(empInput.value);
      if (!e) { toast('اختر الموظف من القائمة أولاً', true); return; }
      addTx(e, load);
    } }, '+ تسجيل حركة للموظف المحدد'))), body);
  await load();
  return root;
}
