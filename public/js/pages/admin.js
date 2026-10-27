import { h, api, qs, state, fmt, num, field, select, table, modal, confirmBox, toast, guard, download } from '../core.js';
import { getUnits } from '../filters.js';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export default async function admin(args) {
  const u = state.user;
  const isAdmin = u.role === 'admin';
  const tabsDef = [['settings', 'السياسات والإعدادات'], ['snapshots', 'اللقطات الشهرية'], ['audit', 'سجل التدقيق'], ...(isAdmin ? [['users', 'المستخدمون والأدوار'], ['data', 'البيانات']] : [])];
  let tab = args[0] || 'settings';
  const root = h('div');
  const body = h('div');
  root.append(h('div', { class: 'tabs' }, tabsDef.map(([k, t]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { location.hash = '#/admin/' + k; } }, t))), body);
  const views = { settings, snapshots, audit, users, data };
  body.append(await (views[tab] || settings)());
  return root;

  async function settings() {
    const d = await api('/admin/settings');
    const p = d.policy;
    const canEdit = u.perms.includes('settings');
    const I = (k, type = 'number', extra = {}) => h('input', { type, value: p[k] ?? '', disabled: !canEdit, step: 'any', ...extra });
    const f = {
      day_divisor: I('day_divisor'), entitlement_base: I('entitlement_base'), entitlement_senior: I('entitlement_senior'), senior_after_years: I('senior_after_years'),
      max_balance_cap: I('max_balance_cap'), max_carryover_days: I('max_carryover_days', 'number', { placeholder: 'بلا حد' }), year_start_month: I('year_start_month', 'number', { min: 1, max: 12 }), concentration_top_n: I('concentration_top_n'),
      accrual_method: select([['daily', 'استحقاق يومي تناسبي'], ['upfront', 'كامل الاستحقاق في بداية السنة']], p.accrual_method, { disabled: !canEdit }),
      day_basis: select([['calendar', 'أيام تقويمية'], ['working', 'أيام عمل (دون العطلات)']], p.day_basis, { disabled: !canEdit }),
      allow_partial_days: select([['1', 'نعم'], ['0', 'لا']], p.allow_partial_days ? '1' : '0', { disabled: !canEdit }),
    };
    const weekend = DAYS.map((n, i) => h('label', { class: 'row center', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: p.weekend_days.includes(i), disabled: !canEdit, 'data-d': i }), n));
    const hol = h('div');
    const drawHol = () => hol.replaceChildren(table([{ key: 'day', label: 'التاريخ', render: r => fmt.date(r.day) }, { key: 'name', label: 'العطلة' },
      ...(canEdit ? [{ key: 'x', label: '', sortable: false, render: r => h('button', { class: 'btn sm danger', onclick: guard(async () => { await api('/admin/holidays/' + r.id, { method: 'DELETE' }); d.holidays = d.holidays.filter(x => x.id !== r.id); drawHol(); }) }, 'حذف') }] : [])], d.holidays, { empty: 'لا عطلات مسجّلة' }));
    drawHol();
    const hDay = h('input', { type: 'date' }), hName = h('input', { placeholder: 'اسم العطلة' });
    return h('div', null,
      h('div', { class: 'card' }, h('h3', null, 'سياسات احتساب الإجازات والتقييم المالي'),
        h('p', { class: 'sub' }, 'جميع معادلات التقييم والاستحقاق قابلة للتهيئة وفق لوائح الجهة؛ ولا تُفترض مساواة الاستحقاق بين الموظفين (يمكن تحديد استحقاق خاص لكل موظف).'),
        h('div', { class: 'form-grid' },
          field('طريقة الاستحقاق', f.accrual_method), field('أساس عدّ أيام الإجازة', f.day_basis), field('قاسم أجر اليوم (الراتب المعتمد ÷ القاسم)', f.day_divisor),
          field('الاستحقاق السنوي الأساسي (يوم)', f.entitlement_base), field('الاستحقاق بعد سنوات الخدمة (يوم)', f.entitlement_senior), field('عدد سنوات الخدمة للاستحقاق الأعلى', f.senior_after_years),
          field('الحد المعتمد للرصيد (للتنبيهات)', f.max_balance_cap), field('الحد الأقصى للترحيل بين السنوات (يوم)', f.max_carryover_days), field('شهر بداية السنة المالية (1–12)', f.year_start_month),
          field('عدد كبار الأرصدة لقياس التركّز', f.concentration_top_n), field('السماح بأجزاء الأيام', f.allow_partial_days),
          h('div', { class: 'wide' }, h('span', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, 'أيام نهاية الأسبوع'), h('div', { class: 'row center' }, weekend))),
        canEdit && h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: guard(async () => {
          const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
          body.allow_partial_days = body.allow_partial_days === '1';
          body.weekend_days = weekend.map(l => l.querySelector('input')).filter(i => i.checked).map(i => +i.dataset.d);
          await api('/admin/settings', { method: 'PUT', body }); toast('تم حفظ السياسات؛ سيُعاد احتساب جميع المؤشرات تلقائياً');
        }) }, 'حفظ السياسات'))),
      h('div', { class: 'section-title' }, 'العطلات الرسمية (تُستثنى عند العدّ بأيام العمل)'), hol,
      canEdit && h('div', { class: 'row center', style: { marginTop: '10px' } }, hDay, hName, h('button', { class: 'btn', onclick: guard(async () => {
        const r = await api('/admin/holidays', { method: 'POST', body: { day: hDay.value, name: hName.value } }); d.holidays = [...d.holidays.filter(x => x.day !== r.day), r].sort((a, b) => (a.day < b.day ? -1 : 1)); drawHol();
      }) }, '+ إضافة عطلة')));
  }

  async function snapshots() {
    if (['sector_manager', 'department_manager', 'section_manager'].includes(u.role)) return h('div', { class: 'card empty' }, 'هذه الصفحة مخصصة للإدارة المالية والموارد البشرية والإدارة العليا');
    const rows = await api('/admin/snapshots');
    const canSnap = u.perms.includes('snapshots');
    const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    return h('div', null,
      h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', null, 'لقطة مالية شهرية'),
        h('p', { class: 'sub' }, 'تحفظ قيمة الأرصدة والالتزام المقدّر في تاريخ معين، لمعرفة هل ينخفض الالتزام فعلاً أم يرتفع، دون أن تتأثر التقارير التاريخية بتعديلات الرواتب اللاحقة. يمكن للمالية إدخال القيمة المحاسبية الرسمية بجانب القيمة التقديرية.'),
        canSnap && h('div', { class: 'row center' }, h('label', { class: 'f' }, 'تاريخ اللقطة', date), h('button', { class: 'btn primary', onclick: guard(async () => { await api('/admin/snapshots', { method: 'POST', body: { date: date.value } }); toast('تم حفظ اللقطة'); location.reload(); }) }, 'حفظ لقطة الآن'))),
      table([{ key: 'snap_date', label: 'التاريخ', render: r => fmt.date(r.snap_date) }, { key: 'rows', label: 'الموظفون', num: true, render: r => num(r.rows) }, { key: 'days_total', label: 'إجمالي الأيام', num: true, render: r => num(fmt.days(r.days_total)) },
        { key: 'est_total', label: 'القيمة التقديرية (ر.س)', num: true, render: r => num(fmt.sar(r.est_total)) },
        { key: 'official_total', label: 'القيمة المحاسبية الرسمية (ر.س)', num: true, render: r => (r.official_total === null ? '—' : num(fmt.sar(r.official_total))) },
        { key: 'diff', label: 'الفرق', num: true, render: r => (r.official_total === null ? '—' : num(fmt.sar(r.est_total - r.official_total))), sortValue: r => (r.official_total === null ? null : r.est_total - r.official_total) },
        ...(canSnap ? [{ key: 'x', label: '', sortable: false, render: r => h('button', { class: 'btn sm', onclick: () => {
          const v = h('input', { type: 'number', step: '0.01', value: r.official_total ?? '' }); const n = h('input', { value: r.notes || '' });
          modal('القيمة المحاسبية الرسمية', h('div', { class: 'form-grid' }, field('الإجمالي الرسمي (ر.س)', v), field('ملاحظات', n)), { onSave: async () => { await api('/admin/snapshots/' + r.id, { method: 'PUT', body: { official_total: v.value, notes: n.value } }); toast('تم الحفظ'); location.reload(); } });
        } }, 'إدخال الرسمي') }] : [])], rows, { initialSort: { key: 'snap_date', dir: -1 }, empty: 'لا توجد لقطات بعد' }));
  }

  async function audit() {
    const rows = await api('/admin/audit');
    const ent = select([['', 'كل الكيانات'], ...[...new Set(rows.map(r => r.entity))].map(e => [e, e])], '');
    const wrap = h('div');
    const draw = () => wrap.replaceChildren(table([{ key: 'at', label: 'الوقت', render: r => new Date(r.at).toLocaleString('ar-SA-u-nu-latn') }, { key: 'username', label: 'المستخدم' }, { key: 'action', label: 'الإجراء' }, { key: 'entity', label: 'الكيان' }, { key: 'entity_id', label: 'المعرّف' },
      { key: 'chg', label: 'التغيير', sortable: false, render: r => h('details', null, h('summary', null, 'عرض'), h('pre', { style: { direction: 'ltr', textAlign: 'left', maxWidth: '520px', overflow: 'auto', margin: 0, fontSize: '12px' } }, JSON.stringify({ before: r.before, after: r.after }, null, 1))) }],
    rows.filter(r => !ent.value || r.entity === ent.value), { empty: 'لا توجد سجلات' }));
    ent.addEventListener('change', draw); draw();
    return h('div', null, h('p', { class: 'sub' }, 'تُسجَّل جميع التعديلات المهمة على الرواتب والأرصدة والمستهدفات والسياسات والمستخدمين (آخر 300 عملية).'), h('div', { style: { marginBottom: '10px' } }, ent), wrap);
  }

  async function users() {
    const d = await api('/admin/users');
    const units = await getUnits();
    const mgr = r => r.endsWith('manager');
    const edit = usr => {
      const f = { username: h('input', { value: usr?.username || '', disabled: !!usr }), full_name: h('input', { value: usr?.full_name || '' }), password: h('input', { type: 'password', placeholder: usr ? 'اتركها فارغة بلا تغيير' : '8 أحرف على الأقل', autocomplete: 'new-password' }) };
      const role = select(Object.entries(d.roles), usr?.role || 'hr');
      const unit = select([['', '—'], ...units.filter(x => x.unit_type !== 'org').map(x => [x.id, x.name])], usr?.org_unit_id ?? '');
      const active = select([['1', 'نشط'], ['0', 'معطّل']], usr?.active === false ? '0' : '1');
      modal(usr ? 'تعديل مستخدم' : 'مستخدم جديد', h('div', { class: 'form-grid' }, field('اسم المستخدم', f.username), field('الاسم الكامل', f.full_name), field('كلمة المرور', f.password), field('الدور', role),
        field('الوحدة التي يديرها (للمديرين)', unit), usr && field('الحالة', active)), { onSave: async () => {
        const body = { full_name: f.full_name.value, role: role.value, org_unit_id: unit.value ? +unit.value : null, password: f.password.value || undefined };
        if (usr) { body.active = active.value === '1'; await api('/admin/users/' + usr.id, { method: 'PUT', body }); } else { body.username = f.username.value; await api('/admin/users', { method: 'POST', body }); }
        toast('تم الحفظ'); location.reload();
      } });
    };
    return h('div', null, h('div', { class: 'row center', style: { marginBottom: '10px' } }, h('p', { class: 'sub', style: { margin: 0 } }, 'الصلاحيات تُطبَّق على مستوى الخادم والبيانات: يرى المدير بيانات وحدته فقط، ولا يرى الرواتب الفردية.'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => edit() }, '+ مستخدم')),
      table([{ key: 'username', label: 'المستخدم' }, { key: 'full_name', label: 'الاسم' }, { key: 'role', label: 'الدور', render: r => d.roles[r.role], sortValue: r => d.roles[r.role] }, { key: 'unit_name', label: 'النطاق', render: r => r.unit_name || (mgr(r.role) ? '—' : 'كل المنشأة') },
        { key: 'active', label: 'الحالة', render: r => h('span', { class: 'badge ' + (r.active ? 'ok' : 'bad') }, r.active ? 'نشط' : 'معطّل') }, { key: 'x', label: '', sortable: false, render: r => h('button', { class: 'btn sm', onclick: () => edit(r) }, 'تعديل') }], d.users));
  }

  async function data() {
    return h('div', { class: 'card' }, h('h3', null, 'البيانات التوضيحية'), h('p', null, 'تُميَّز البيانات التوضيحية بوضوح عن البيانات الفعلية (شارة في لوحة المعلومات وصفحة الموظف). عند البدء بالتشغيل الفعلي احذفها نهائياً مع حساباتها التجريبية.'),
      h('button', { class: 'btn danger', onclick: () => confirmBox('حذف جميع الموظفين والوحدات التوضيحية وحركاتهم نهائياً؟ لا يمكن التراجع.', async () => { const r = await api('/admin/demo', { method: 'DELETE' }); toast(`تم حذف ${r.removed} موظفاً توضيحياً`); }) }, 'حذف البيانات التوضيحية'));
  }
}
