import { h, api, qs, state, num, field, select, table, download, toast, guard, confirmBox } from '../core.js';

const KINDS = [
  ['tracking', 'متابعة أرصدة الإجازات (الراتب والأرصدة والمستهدف)', 'تحديث حقول المتابعة لكل موظف وسنة بمطابقة الرقم الوظيفي؛ الخلايا الفارغة لا تغيّر القيم الحالية.'],
  ['employees', 'بيانات الموظفين', 'ينشئ الوحدات الناقصة تلقائياً ويحدّث الموظف إن وُجد رقمه الوظيفي.'],
  ['opening_balances', 'الأرصدة الافتتاحية', 'تحديث الرصيد الافتتاحي وتاريخه لموظفين موجودين.'],
  ['transactions', 'حركات الإجازات', 'إجازات وتسويات؛ تُتجاهل الحركات المكررة وتُرفض المتداخلة.'],
  ['targets', 'المستهدفات', 'مستهدفات للوحدات أو الموظفين حسب السنة.'],
];

export default async function importPage() {
  const root = h('div');
  const kind = select(KINDS.map(k => [k[0], k[1]]), 'tracking');
  const help = h('div', { style: { color: 'var(--muted)' } });
  const file = h('input', { type: 'file', accept: '.xlsx,.csv', 'aria-label': 'ملف Excel أو CSV' });
  const result = h('div');
  let lastFile = null;
  const sync = () => { help.textContent = KINDS.find(k => k[0] === kind.value)[2]; result.replaceChildren(); };
  kind.addEventListener('change', sync); sync();

  const send = async mode => {
    const f = file.files[0];
    if (!f) throw new Error('اختر ملفاً أولاً');
    const form = new FormData(); form.append('file', f);
    return api(`/import/${kind.value}?mode=${mode}${mode === 'commit' && skip.checked ? '&skip_invalid=1' : ''}`, { method: 'POST', form });
  };
  const skip = h('input', { type: 'checkbox' });
  const preview = guard(async () => {
    const d = await send('preview');
    lastFile = file.files[0];
    result.replaceChildren(
      h('div', { class: 'card', style: { margin: '14px 0' } }, h('div', { class: 'row center' },
        h('span', { class: 'badge info' }, `${d.total} صف`), h('span', { class: 'badge ok' }, `${d.valid} صالح`), d.invalid ? h('span', { class: 'badge bad' }, `${d.invalid} به أخطاء`) : null, h('div', { class: 'spacer' }),
        d.invalid ? h('label', { class: 'row center', style: { gap: '6px' } }, skip, 'تجاهل الصفوف الخاطئة واعتماد الصالحة') : null,
        h('button', { class: 'btn primary', disabled: d.valid === 0, onclick: () => confirmBox(`اعتماد ${d.invalid && skip.checked ? d.valid : d.total} صفاً وكتابتها في قاعدة البيانات؟`, async () => {
          const r = await send('commit'); toast(`تم اعتماد ${r.applied} صفاً`); result.replaceChildren(h('div', { class: 'card' }, `✓ اكتمل الاستيراد: ${r.applied} صفاً${r.invalid ? `، وتم تجاهل ${r.invalid}` : ''}.`));
        }, false) }, 'اعتماد الاستيراد'))),
      table([{ key: 'row', label: 'الصف', num: true, render: r => num(r.row) }, { key: 'label', label: 'السجل' }, { key: 'action', label: 'الإجراء' },
        { key: 'ok', label: 'النتيجة', render: r => (r.ok ? h('span', { class: 'badge ok' }, 'صالح') : h('span', { class: 'badge bad' }, 'خطأ')), sortValue: r => (r.ok ? 1 : 0) },
        { key: 'errors', label: 'التفاصيل', render: r => h('span', { class: r.ok ? '' : 'err' }, [...r.errors, ...r.warnings].join('؛ ') || '—'), sortable: false }], d.rows, { initialSort: { key: 'ok', dir: 1 } }));
  });

  root.append(
    h('div', { class: 'card' }, h('h3', null, '١) حمّل النموذج الموحّد'), h('div', { class: 'row center' }, field('نوع البيانات', kind), h('button', { class: 'btn', onclick: () => download(`/import/template/${kind.value}`) }, 'تحميل نموذج Excel')), help,
      h('h3', { style: { marginTop: '16px' } }, '٢) ارفع الملف وراجع المعاينة'), h('div', { class: 'row center' }, file, h('button', { class: 'btn primary', onclick: preview }, 'معاينة والتحقق')),
      h('p', { style: { color: 'var(--muted)', fontSize: '12.5px', marginBottom: 0 } }, 'لا يُكتب أي شيء في قاعدة البيانات قبل الاعتماد. يكشف التحقق الأخطاء والسجلات المكررة والمتداخلة. الحد الأقصى 5000 صف.')),
    result,
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('h3', null, 'التصدير'), h('p', { style: { color: 'var(--muted)' } }, 'تُصدَّر التقارير إلى Excel أو PDF (طباعة) من صفحة «التقارير» ومن قائمة الموظفين، بحسب المرشحات المحددة.'), h('a', { class: 'btn', href: '#/reports' }, 'الذهاب إلى التقارير')));
  return root;
}
