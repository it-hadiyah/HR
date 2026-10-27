import { h, api, qs, state, fmt, num, field, select, table, modal, confirmBox, toast, guard, TARGET_TYPES, UNIT_TYPE } from '../core.js';
import { getUnits } from '../filters.js';

const HELP = {
  max_year_end_balance: 'أقصى رصيد (أيام) مسموح به بنهاية السنة. للوحدة: إجمالي أيام الوحدة؛ للموظف: رصيده الأقصى.',
  days_to_use: 'عدد الأيام التي يجب استخدامها خلال السنة؛ يُحوَّل إلى رصيد مستهدف = رصيد البداية + الاستحقاق − الأيام المطلوبة.',
  reduction_pct: 'نسبة التخفيض من رصيد بداية السنة؛ الرصيد المستهدف = الرصيد × (1 − النسبة).',
  financial_target: 'سقف مالي (ر.س) للالتزام؛ يُحوَّل إلى أيام بمتوسط أجر اليوم لنطاقه.',
  usage_plan_pct: 'نسبة من الاستحقاق السنوي يجب استخدامها؛ الرصيد المستهدف = البداية + الاستحقاق × (1 − النسبة).',
};

export default async function targets() {
  const canEdit = state.user.perms.includes('targets');
  const root = h('div');
  const year = select([2025, 2026, 2027].map(y => [y, y]), state.filters.year);
  const body = h('div');
  const units = await getUnits();
  year.addEventListener('change', () => load());
  root.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'row center' }, field('السنة', year), h('div', { class: 'spacer' }),
    canEdit && h('button', { class: 'btn primary', onclick: () => edit() }, '+ مستهدف جديد'),
    canEdit && h('button', { class: 'btn', onclick: () => distribute() }, 'توزيع مستهدف على الأدنى')),
  h('p', { style: { color: 'var(--muted)', marginBottom: 0 } }, 'يُدخَل المستهدف يدوياً على أي مستوى أو يُوزَّع من الأعلى إلى الأدنى. تُحسب المستهدفات على الموظفين دون جمع أو تكرار: مستهدف الوحدة يُوزَّع على من ليس لهم مستهدف صريح بعد خصم المستهدفات الصريحة للأبناء، وإذا تجاوزت مستهدفات الأبناء مستهدف الأب يظهر الفرق بوضوح.')), body);

  async function load() {
    const d = await api('/targets' + qs({ year: year.value }));
    body.replaceChildren(table([
      { key: 'scope_name', label: 'النطاق', render: r => h('span', null, r.scope_name, ' ', h('span', { class: 'badge' }, r.scope_kind === 'employee' ? 'موظف' : UNIT_TYPE[r.scope_kind])) },
      { key: 'target_type', label: 'نوع المستهدف', render: r => TARGET_TYPES[r.target_type], sortValue: r => TARGET_TYPES[r.target_type] },
      { key: 'value', label: 'القيمة', num: true, render: r => num(fmt.days(r.value)) },
      { key: 'stated_days', label: 'المعتمد بالأيام', num: true, render: r => num(fmt.days(r.stated_days)) },
      { key: 'allocated_days', label: 'الموزَّع فعلياً على الموظفين', num: true, render: r => num(fmt.days(r.allocated_days)) },
      { key: 'conflict_days', label: 'الفرق', render: r => (r.conflict_days ? h('span', { class: 'badge bad', title: 'مجموع مستهدفات الأبناء الصريحة يتجاوز مستهدف الوحدة' }, `تعارض ${fmt.days(r.conflict_days)} يوم`) : '—'), sortable: false },
      { key: 'notes', label: 'ملاحظات' },
      ...(canEdit ? [{ key: 'act', label: '', sortable: false, render: r => h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
        h('button', { class: 'btn sm', onclick: () => edit(r) }, 'تعديل'),
        h('button', { class: 'btn sm danger', onclick: () => confirmBox('حذف هذا المستهدف؟', async () => { await api('/targets/' + r.id, { method: 'DELETE' }); toast('تم الحذف'); load(); }) }, 'حذف')) }] : []),
    ], d.rows, { empty: 'لا توجد مستهدفات لهذه السنة' }));
  }

  async function edit(t) {
    const scopeType = select([['unit', 'وحدة تنظيمية (أو المنشأة كلها)'], ['employee', 'موظف']], t?.scope_type || 'unit', { disabled: !!t });
    const unitSel = select(units.map(u => [u.id, `${UNIT_TYPE[u.unit_type]}: ${u.name}`]), t?.scope_id);
    const emps = (await api('/employees' + qs({ status: 'all' }))).rows;
    const empSel = select(emps.map(e => [e.id, `${e.emp_no} — ${e.full_name}`]), t?.scope_id);
    const holder = h('div');
    const type = select(Object.entries(TARGET_TYPES), t?.target_type || 'max_year_end_balance');
    const value = h('input', { type: 'number', min: 0, step: '0.5', value: t?.value ?? '', required: true });
    const notes = h('input', { value: t?.notes || '' });
    const help = h('div', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, HELP[type.value]);
    const syncScope = () => holder.replaceChildren(field('النطاق', scopeType.value === 'unit' ? unitSel : empSel)); syncScope();
    scopeType.addEventListener('change', syncScope);
    type.addEventListener('change', () => { help.textContent = HELP[type.value]; });
    modal(t ? 'تعديل مستهدف' : 'مستهدف جديد', h('div', { class: 'form-grid' }, field('نوع النطاق', scopeType), holder, field('نوع المستهدف', type), field('القيمة', value), field('ملاحظات', notes), h('div', { class: 'wide' }, help)), {
      onSave: async () => { await api('/targets', { method: 'POST', body: { scope_type: scopeType.value, scope_id: +(scopeType.value === 'unit' ? unitSel.value : empSel.value), year: +year.value, target_type: type.value, value: value.value, notes: notes.value } }); toast('تم الحفظ'); load(); },
    });
  }

  function distribute() {
    const unitSel = select(units.filter(u => u.unit_type !== 'section').map(u => [u.id, `${UNIT_TYPE[u.unit_type]}: ${u.name}`]), units.find(u => u.unit_type === 'org')?.id);
    const method = select([['equal', 'بالتساوي حسب عدد الموظفين'], ['proportional', 'بالتناسب مع الرصيد الحالي']], 'equal');
    const total = h('input', { type: 'number', min: 0, step: '0.5', placeholder: 'اتركه فارغاً لاستخدام مستهدف الوحدة' });
    modal('توزيع مستهدف على المستويات الأدنى', h('div', { class: 'form-grid' }, field('الوحدة المصدر', unitSel), field('طريقة التوزيع', method), field('إجمالي المستهدف بالأيام (اختياري)', total),
      h('div', { class: 'wide', style: { color: 'var(--muted)', fontSize: '12.5px' } }, 'يُنشأ لكل وحدة تحتها (أو لكل موظف إن لم تكن لها وحدات فرعية) مستهدف صريح بأقصى رصيد؛ ومجموعها يساوي إجمالي المستهدف، فلا يحدث تضخيم في الأرقام.')), {
      onSave: async () => { const r = await api('/targets/distribute', { method: 'POST', body: { unit_id: +unitSel.value, year: +year.value, method: method.value, total_days: total.value } }); toast(`تم التوزيع على ${r.distributed} عنصراً`); load(); },
    });
  }
  await load();
  return root;
}
