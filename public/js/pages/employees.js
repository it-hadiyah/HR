import { h, api, qs, state, fmt, num, field, select, table, modal, confirmBox, toast, guard, statusBadge, EMP_STATUS, TARGET_TYPES, download } from '../core.js';
import { filterBar, filterQuery, getUnits } from '../filters.js';

const unitName = e => [e.sector, e.department, e.section].filter(Boolean).join(' ‹ ');

export default async function employees() {
  const root = h('div');
  const holder = h('div');
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم الوظيفي أو المسمى', value: '', style: { minWidth: '280px' }, 'aria-label': 'بحث' });
  const quick = select([['', 'كل الموظفين'], ['high', 'أرصدة مرتفعة'], ['no', 'لم يحققوا المستهدف'], ['yes', 'حققوا المستهدف']], '');
  const body = h('div');
  const fin = state.user.role !== 'sector_manager' && state.user.role !== 'department_manager' && state.user.role !== 'section_manager';
  const canEdit = state.user.perms.includes('employees');
  const mkBar = async () => holder.replaceChildren(await filterBar(r => load(r), { period: true }));
  await mkBar();
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
  quick.addEventListener('change', () => load());
  root.append(holder, h('div', { class: 'row center', style: { marginBottom: '12px' } }, search, quick, h('div', { class: 'spacer' }),
    canEdit && h('button', { class: 'btn primary', onclick: () => editEmployee() }, '+ إضافة موظف')), body);

  async function load(reset) {
    if (reset === true) await mkBar();
    const p = { ...filterQuery(), search: search.value.trim(), high: quick.value === 'high' ? 1 : '', met: quick.value === 'no' || quick.value === 'yes' ? quick.value : '' };
    const d = await api('/employees' + qs(p));
    const cols = [
      { key: 'emp_no', label: 'الرقم', render: e => h('a', { href: '#/employee/' + e.id }, e.emp_no) },
      { key: 'full_name', label: 'الاسم', render: e => h('a', { href: '#/employee/' + e.id }, e.full_name) },
      { key: 'job_title', label: 'المسمى' },
      { key: 'unit', label: 'الوحدة', render: e => unitName(e), sortValue: e => unitName(e) },
      { key: 'status', label: 'الحالة', render: e => h('span', { class: 'badge ' + (e.status === 'active' ? 'ok' : e.status === 'terminated' ? 'bad' : 'warn') }, EMP_STATUS[e.status]) },
      { key: 'baseline', label: 'رصيد بداية السنة', num: true, render: e => num(fmt.days(e.m.baseline)), sortValue: e => e.m.baseline },
      { key: 'used', label: 'المستخدم', num: true, render: e => num(fmt.days(e.m.used)), sortValue: e => e.m.used },
      { key: 'avail', label: 'الرصيد المتاح', num: true, render: e => h('span', { class: e.high_balance ? 'err' : '' }, num(fmt.days(e.m.available_now))), sortValue: e => e.m.available_now },
      { key: 'sched', label: 'المجدول', num: true, render: e => num(fmt.days(e.m.scheduled)), sortValue: e => e.m.scheduled },
      { key: 'proj', label: 'المتوقع نهاية السنة', num: true, render: e => num(fmt.days(e.m.projected_year_end)), sortValue: e => e.m.projected_year_end },
      ...(fin ? [{ key: 'val', label: 'القيمة (ر.س)', num: true, render: e => num(fmt.sar(e.m.value_now)), sortValue: e => e.m.value_now }] : []),
      { key: 'target', label: 'المستهدف', num: true, render: e => num(fmt.days(e.target_days)), sortValue: e => e.target_days },
      { key: 'met', label: 'التحقق', render: e => (e.target_days === null ? '—' : statusBadge(e.m.projected_year_end <= e.target_days ? 'achieved' : 'at_risk')), sortable: false },
    ];
    body.replaceChildren(h('div', { class: 'row center', style: { marginBottom: '6px', color: 'var(--muted)' } }, `${d.rows.length} موظف — السنة ${d.year} حتى ${fmt.date(d.asOf)}`,
      h('button', { class: 'btn sm', onclick: () => download('/reports/balances?format=xlsx' + qs(filterQuery()).replace('?', '&')) }, 'تصدير Excel')),
    table(cols, d.rows, { empty: 'لا يوجد موظفون مطابقون' }));
  }
  await load();
  return root;
}

// ---------- إضافة / تعديل موظف ----------
export async function editEmployee(emp, allowances = [], after) {
  const units = await getUnits();
  const f = (k, type = 'text', extra = {}) => h('input', { type, value: emp?.[k] ?? '', ...extra });
  const inp = {
    emp_no: f('emp_no', 'text', { required: true }), full_name: f('full_name', 'text', { required: true }), job_title: f('job_title'),
    hire_date: f('hire_date', 'date', { required: true }), termination_date: f('termination_date', 'date'),
    basic_salary: f('basic_salary', 'number', { min: 0, step: '0.01' }), leave_salary_override: f('leave_salary_override', 'number', { min: 0, step: '0.01' }),
    annual_entitlement_days: f('annual_entitlement_days', 'number', { min: 0, step: '0.5' }), opening_balance: f('opening_balance', 'number', { step: '0.5' }),
    opening_date: f('opening_date', 'date'), salary_effective_date: h('input', { type: 'date' }),
  };
  const unitSel = select(units.filter(u => u.unit_type !== 'org').map(u => [u.id, `${{ sector: 'قطاع', department: 'إدارة', section: 'قسم' }[u.unit_type]}: ${u.name}`]), emp?.org_unit_id);
  const status = select(Object.entries(EMP_STATUS), emp?.status || 'active');
  const rows = [...allowances.map(a => ({ ...a }))];
  const list = h('div', { class: 'grid' });
  const draw = () => list.replaceChildren(...rows.map((a, i) => h('div', { class: 'row center' },
    h('input', { value: a.name, placeholder: 'اسم البدل', oninput: e => { a.name = e.target.value; } }),
    h('input', { type: 'number', min: 0, step: '0.01', value: a.amount, style: { width: '120px' }, oninput: e => { a.amount = e.target.value; } }),
    h('label', { class: 'row center', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: a.include_in_leave, onchange: e => { a.include_in_leave = e.target.checked; } }), 'يدخل في احتساب الإجازة'),
    h('button', { class: 'btn sm danger', type: 'button', onclick: () => { rows.splice(i, 1); draw(); } }, 'حذف'))));
  draw();
  const form = h('div', null,
    h('div', { class: 'form-grid' },
      field('الرقم الوظيفي', inp.emp_no), field('الاسم الكامل', inp.full_name), field('المسمى الوظيفي', inp.job_title),
      field('الوحدة (قطاع/إدارة/قسم)', unitSel), field('تاريخ التعيين', inp.hire_date), field('الحالة الوظيفية', status),
      field('تاريخ نهاية الخدمة', inp.termination_date), field('الراتب الأساسي', inp.basic_salary),
      field('الراتب المعتمد للإجازات (اختياري)', inp.leave_salary_override), field('الاستحقاق السنوي بالأيام (فارغ = حسب سياسة الجهة)', inp.annual_entitlement_days),
      field('الرصيد الافتتاحي', inp.opening_balance), field('تاريخ الرصيد الافتتاحي', inp.opening_date),
      emp && field('سريان تغيّر الراتب من (إن تغيّر)', inp.salary_effective_date)),
    h('h3', { style: { margin: '16px 0 6px' } }, 'البدلات'), list,
    h('button', { class: 'btn sm', type: 'button', onclick: () => { rows.push({ name: '', amount: 0, include_in_leave: false }); draw(); } }, '+ إضافة بدل'),
    h('p', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, 'الراتب المعتمد لاحتساب الإجازات = الأساسي + البدلات المشمولة، ما لم يُحدَّد راتب معتمد يدوياً. أجر اليوم = الراتب المعتمد ÷ قاسم اليوم في السياسة.'));
  modal(emp ? `تعديل ${emp.full_name}` : 'إضافة موظف', form, { wide: true, onSave: async () => {
    const body = Object.fromEntries(Object.entries(inp).map(([k, el]) => [k, el.value]));
    Object.assign(body, { org_unit_id: +unitSel.value, status: status.value, allowances: rows.filter(a => a.name) });
    if (!body.opening_date) delete body.opening_date;
    if (emp) await api('/employees/' + emp.id, { method: 'PUT', body }); else await api('/employees', { method: 'POST', body });
    toast('تم الحفظ'); if (after) await after(); else location.reload();
  } });
}

// ---------- صفحة الموظف ----------
export async function employeeDetail(id) {
  const q = state.filters;
  const d = await api(`/employees/${id}${qs({ year: q.year, asOf: q.asOf })}`);
  const e = d.employee, m = e.m;
  const fin = e.basic_salary !== undefined;
  const canEdit = state.user.perms.includes('employees');
  const canLeave = state.user.perms.includes('leaves');
  const canTarget = state.user.perms.includes('targets');
  const root = h('div');
  const refresh = async () => { const n = await employeeDetail(id); document.getElementById('page').replaceChildren(n); };

  const kv = (l, v, unit) => h('div', null, h('span', null, l), h('b', null, num(v), unit ? ` ${unit}` : ''));
  root.append(
    h('div', { class: 'row center', style: { marginBottom: '14px' } },
      h('a', { href: '#/employees' }, '‹ كل الموظفين'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => download(`/reports/employee?employee=${id}&format=xlsx&year=${q.year}`) }, 'تقرير Excel'),
      h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة'),
      canLeave && h('button', { class: 'btn', onclick: () => addTx(e, refresh) }, '+ حركة إجازة'),
      canTarget && h('button', { class: 'btn', onclick: () => editTarget(e, d.targets, refresh) }, 'مستهدف الموظف'),
      canEdit && h('button', { class: 'btn primary', onclick: () => editEmployee(e, d.allowances, refresh) }, 'تعديل البيانات')),
    h('div', { class: 'card' },
      h('div', { class: 'row center' }, h('h2', null, e.full_name), h('span', { class: 'badge ' + (e.status === 'active' ? 'ok' : 'warn') }, EMP_STATUS[e.status]), e.is_demo && h('span', { class: 'badge warn' }, 'بيانات توضيحية')),
      h('div', { class: 'kv', style: { marginTop: '10px' } },
        h('div', null, h('span', null, 'الرقم الوظيفي'), h('b', null, e.emp_no)), h('div', null, h('span', null, 'المسمى'), h('b', null, e.job_title || '—')),
        h('div', null, h('span', null, 'الوحدة'), h('b', null, unitName(e))), h('div', null, h('span', null, 'تاريخ التعيين'), h('b', null, fmt.date(e.hire_date))),
        e.termination_date && h('div', null, h('span', null, 'نهاية الخدمة'), h('b', null, fmt.date(e.termination_date))))),
    h('div', { class: 'section-title' }, `مؤشرات السنة ${m.year}`),
    h('div', { class: 'card' }, h('div', { class: 'kv' },
      kv('رصيد بداية السنة', fmt.days(m.baseline), 'يوم'), kv('المستحق حتى تاريخه', fmt.days(m.accrued_to_date), 'يوم'), kv('المستحق للسنة كاملة', fmt.days(m.accrued_full_year), 'يوم'),
      kv('المستخدم', fmt.days(m.used), 'يوم'), kv('التسويات', fmt.days(m.adjustments), 'يوم'), m.settlements ? kv('التسوية النقدية', fmt.days(m.settlements), 'يوم') : null, m.forfeited ? kv('المسقط بسبب حد الترحيل', fmt.days(m.forfeited), 'يوم') : null,
      kv('الرصيد المتاح حالياً', fmt.days(m.available_now), 'يوم'), kv('المجدول مستقبلاً', fmt.days(m.scheduled), 'يوم'), m.pending ? kv('بانتظار الاعتماد', fmt.days(m.pending), 'يوم') : null,
      kv('المتوقع نهاية السنة', fmt.days(m.projected_year_end), 'يوم'),
      kv('المستهدف', e.target_days === null ? '—' : fmt.days(e.target_days), e.target_days === null ? '' : 'يوم'),
      e.target_days !== null ? kv('الأيام المطلوب تخفيضها', fmt.days(Math.max(0, m.projected_year_end - e.target_days)), 'يوم') : null,
      fin ? kv('الراتب المعتمد للإجازات', fmt.sar(m.leave_salary), 'ر.س') : null, fin ? kv('أجر اليوم', fmt.sar(m.day_rate), 'ر.س') : null,
      fin ? kv('القيمة المالية الحالية', fmt.sar(m.value_now), 'ر.س') : null, fin ? kv('القيمة المتوقعة نهاية السنة', fmt.sar(m.value_year_end), 'ر.س') : null,
      fin && e.target_days !== null ? kv('قيمة الرصيد عند تحقق المستهدف', fmt.sar(e.target_days * m.day_rate), 'ر.س') : null),
    m.negative_balance ? h('p', { class: 'err' }, '⚠ الرصيد سالب: يحتاج إلى مراجعة بيانات؛ ولا يخفض الالتزام المالي.') : null),
    h('div', { class: 'section-title' }, 'سجل حركات الإجازات'),
    table([
      { key: 'tx_type', label: 'النوع', render: t => ({ leave: 'إجازة', adjustment: 'تسوية', settlement: 'تسوية نقدية' })[t.tx_type] },
      { key: 'start_date', label: 'من', render: t => fmt.date(t.start_date) }, { key: 'end_date', label: 'إلى', render: t => fmt.date(t.end_date) },
      { key: 'days', label: 'الأيام', num: true, render: t => num(fmt.days(t.days)) },
      { key: 'status', label: 'الحالة', render: t => h('span', { class: 'badge ' + ({ approved: 'ok', pending: 'warn', rejected: 'bad', cancelled: '' })[t.status] }, ({ approved: 'معتمدة', pending: 'معلّقة', rejected: 'مرفوضة', cancelled: 'ملغاة' })[t.status]) },
      { key: 'notes', label: 'ملاحظات' },
      ...(canLeave ? [{ key: 'act', label: '', sortable: false, render: t => (t.status === 'approved' || t.status === 'pending') ? h('button', { class: 'btn sm danger', onclick: () => confirmBox('إلغاء هذه الحركة؟ ستُستبعد من الأرصدة.', async () => { await api(`/leaves/${t.id}/status`, { method: 'PUT', body: { status: 'cancelled' } }); toast('تم الإلغاء'); refresh(); }) }, 'إلغاء') : '' }] : []),
    ], d.transactions, { empty: 'لا توجد حركات', initialSort: { key: 'start_date', dir: -1 } }));
  if (d.org_history.length > 1) root.append(h('div', { class: 'section-title' }, 'سجل النقل بين الوحدات'),
    table([{ key: 'moved_on', label: 'التاريخ', render: r => fmt.date(r.moved_on) }, { key: 'from_name', label: 'من', render: r => r.from_name || '— (تعيين)' }, { key: 'to_name', label: 'إلى' }], d.org_history));
  if (fin && d.salary_history.length) root.append(h('div', { class: 'section-title' }, 'سجل تغيّر الراتب المعتمد للإجازات'),
    table([{ key: 'effective_date', label: 'سريان من', render: r => fmt.date(r.effective_date) }, { key: 'leave_salary', label: 'الراتب المعتمد (ر.س)', num: true, render: r => num(fmt.sar(r.leave_salary)) }], d.salary_history));
  return root;
}

export function addTx(e, after) {
  const type = select([['leave', 'إجازة'], ['adjustment', 'تسوية رصيد (+/−)'], ['settlement', 'تسوية نقدية للرصيد']], 'leave');
  const start = h('input', { type: 'date', required: true }), end = h('input', { type: 'date' });
  const days = h('input', { type: 'number', step: '0.5' });
  const status = select([['approved', 'معتمدة'], ['pending', 'بانتظار الاعتماد']], 'approved');
  const notes = h('input');
  const hint = h('div', { style: { color: 'var(--muted)', fontSize: '12.5px' } });
  const calc = guard(async () => {
    if (type.value === 'leave' && start.value && (end.value || start.value)) {
      const r = await api(`/leaves/preview-days?start=${start.value}&end=${end.value || start.value}`);
      hint.textContent = `عدد الأيام حسب السياسة (${r.basis === 'working' ? 'أيام عمل' : 'أيام تقويمية'}): ${r.days}. اتركه فارغاً لاعتماده.`;
    } else hint.textContent = '';
  });
  for (const el of [type, start, end]) el.addEventListener('change', calc);
  modal(`حركة جديدة — ${e.full_name}`, h('div', { class: 'form-grid' }, field('النوع', type), field('من تاريخ', start), field('إلى تاريخ', end), field('عدد الأيام (اختياري للإجازة؛ سالب للخصم في التسوية)', days),
    field('الحالة', status), field('ملاحظات', notes), h('div', { class: 'wide' }, hint),
    h('div', { class: 'wide', style: { color: 'var(--muted)', fontSize: '12.5px' } }, 'استخدام الإجازة لا يُعد صرفاً نقدياً تلقائياً؛ التسوية النقدية حركة مستقلة تُسجَّل صراحةً.')), {
    onSave: async () => {
      await api('/leaves', { method: 'POST', body: { employee_id: e.id, tx_type: type.value, start_date: start.value, end_date: end.value || start.value, days: days.value, status: status.value, notes: notes.value } });
      toast('تم تسجيل الحركة'); if (after) await after();
    } });
}

function editTarget(e, targets, after) {
  const year = state.filters.year;
  const cur = targets.find(t => t.year === year);
  const type = select(Object.entries(TARGET_TYPES), cur?.target_type || 'max_year_end_balance');
  const value = h('input', { type: 'number', min: 0, step: '0.5', value: cur?.value ?? '', required: true });
  const notes = h('input', { value: cur?.notes || '' });
  modal(`مستهدف ${e.full_name} — ${year}`, h('div', { class: 'form-grid' }, field('نوع المستهدف', type), field('القيمة', value), field('ملاحظات', notes)), {
    onSave: async () => { await api('/targets', { method: 'POST', body: { scope_type: 'employee', scope_id: e.id, year, target_type: type.value, value: value.value, notes: notes.value } }); toast('تم الحفظ'); if (after) await after(); },
  });
}
