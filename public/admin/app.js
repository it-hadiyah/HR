// لوحة الإدارة المركزية: موظفون، هيكل، مستخدمون، أدوار وصلاحيات، منصات، جلسات، سجل العمليات، إعدادات
import { h, ico, api, qs, toast, guard, fmtDate, fmtDay, modal, confirmBox, field, textInput, select, badge, pager, table, debounce,
  STATUS_LABEL, UNIT_TYPE, SCOPE_LABEL, ACTION_LABEL, PLATFORM_LABEL } from '/admin/ui.js';

let me = null;
const can = action => me.is_super || me.grants.some(g => g.app === 'admin' && g.action === action);
const $ = id => document.getElementById(id);
const view = () => $('view');

// ───────────── عناصر مشتركة ─────────────
let unitCache = null;
async function units(force = false) {
  if (!unitCache || force) {
    const { tree, types } = await api('/org/tree');
    const flat = [];
    const walk = (n, d) => { flat.push({ id: n.id, name: n.name, type: n.unit_type, parent_id: n.parent_id, active: n.active, depth: d }); n.children.forEach(c => walk(c, d + 1)); };
    if (tree) walk(tree, 0);
    unitCache = { tree, flat, types };
  }
  return unitCache;
}
const unitOptions = (flat, { blank = '— بلا وحدة —', onlyActive = true } = {}) =>
  [['', blank], ...flat.filter(u => !onlyActive || u.active).map(u => [u.id, `${'— '.repeat(u.depth)}${u.name}`])];

// ───────────── لوحة المعلومات ─────────────
async function dashboard() {
  const d = await api('/dashboard');
  const stat = (icon, n, label, sub) => h('div', { class: 'card stat' }, h('div', { class: 'ic' }, ico(icon, 22)), h('div', {}, h('b', {}, n), h('span', {}, label), sub ? h('div', { class: 'hint' }, sub) : null));
  const out = [h('div', { class: 'grid stats' },
    stat('users', d.employees.total, 'موظف في السجل المركزي', `${d.employees.in_directory} في الدليل · ${d.employees.leave_enabled} في نظام الإجازات`),
    stat('user-cog', d.users.active, 'مستخدم فعّال', `من ${d.users.total}${d.users.locked ? ` · ${d.users.locked} مقفل` : ''}`),
    stat('activity', d.active_sessions, 'جلسة نشطة الآن'),
    stat('monitor', d.platforms.active, 'منصة مفعّلة', `من ${d.platforms.total}`),
    d.open_conflicts ? stat('triangle-alert', d.open_conflicts, 'تعارض ترحيل مفتوح', 'راجعها من صفحة الموظفين') : null)];
  if (d.security) {
    out.push(h('div', { class: 'grid stats', style: 'margin-top:16px' },
      stat('circle-check', d.security.logins, 'تسجيل دخول (24 ساعة)'),
      stat('ban', d.security.failed_logins, 'محاولة دخول فاشلة (24 ساعة)'),
      stat('shield-alert', d.security.denied, 'محاولة وصول مرفوضة (24 ساعة)'),
      stat('database', d.security.direct_db_changes, 'تغيير مباشر في القاعدة (7 أيام)', 'من خارج التطبيق')));
    const row = r => h('tr', {}, h('td', {}, fmtDate(r.at)), h('td', {}, r.username || '—'), h('td', {}, PLATFORM_LABEL[r.platform] || r.platform || '—'), h('td', {}, ACTION_LABEL[r.action] || r.action),
      h('td', {}, r.result === 'success' ? badge('نجاح', 'ok') : badge(r.result === 'denied' ? 'مرفوض' : 'فشل', 'bad')));
    const tbl = rows => h('div', { class: 'tbl-wrap compact' }, h('table', {}, h('tbody', {}, rows.map(row))));
    out.push(h('div', { class: 'grid two', style: 'margin-top:16px' },
      h('div', { class: 'card' }, h('h2', {}, 'آخر العمليات'), tbl(d.recent)),
      h('div', { class: 'card' }, h('h2', {}, 'أحداث أمنية ومهمة'), d.security_events.length ? tbl(d.security_events) : h('div', { class: 'empty' }, 'لا أحداث'))));
  }
  view().replaceChildren(...out);
}

// ───────────── الموظفون ─────────────
const empState = { q: '', status: '', unit: '', leave: '', page: 1 };
async function employees() {
  const { flat } = await units();
  const box = h('div', {});
  const load = async () => {
    const d = await api('/employees' + qs({ ...empState, pageSize: 25 }));
    box.replaceChildren(
      table([
        { label: 'الاسم', wrap: true, render: e => h('div', {}, h('b', {}, e.full_name), (e.name_en || e.emp_no) ? h('div', { class: 'hint' }, [e.name_en, e.emp_no ? `رقم وظيفي ${e.emp_no}` : ''].filter(Boolean).join(' · ')) : null) },
        { label: 'التحويلة', render: e => e.extension ?? '—' },
        { label: 'المسمى', wrap: true, render: e => e.job_title || '—' },
        { label: 'الوحدة', wrap: true, render: e => e.unit_name || '—' },
        { label: 'الحالة', render: e => h('div', { class: 'chips' }, badge(STATUS_LABEL[e.status] || e.status, e.status === 'active' ? 'ok' : e.status === 'terminated' ? 'bad' : 'warn'), e.leave_enabled ? badge('إجازات', 'info') : null) },
        { label: '', render: e => (can('employees_edit') ? h('div', { class: 'row-actions' }, h('button', { class: 'btn sm', type: 'button', onClick: () => editEmployee(e.id, load) }, ico('pencil', 15), 'تعديل'),
        e.status === 'terminated' ? null : h('button', { class: 'btn sm ' + (e.status === 'active' ? 'danger' : 'primary'), type: 'button', onClick: () => guard(async () => {
          const off = e.status === 'active';
          if (off && !(await confirmBox(`تعطيل «${e.full_name}»؟ سيُخفى من قوائم الموظفين ودليل البوابة حتى يُنشَّط من جديد.`, 'تعطيل', true))) return;
          await api('/employees/' + e.id, { method: 'PUT', body: { status: off ? 'suspended' : 'active', version: e.version } });
          toast(off ? 'تم التعطيل' : 'تم التنشيط'); load();
        })() }, e.status === 'active' ? 'تعطيل' : 'تنشيط')) : '') },
      ], d.employees, 'لا يوجد موظفون مطابقون'),
      pager(d.total, d.page, d.pageSize, p => { empState.page = p; load(); }));
  };
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو البريد أو التحويلة…', value: empState.q, 'aria-label': 'بحث', style: 'min-width:260px' });
  search.addEventListener('input', debounce(() => { empState.q = search.value; empState.page = 1; guard(load); }));
  const mk = (key, opts) => { const s = select(opts, empState[key], { 'aria-label': key }); s.addEventListener('change', () => { empState[key] = s.value; empState.page = 1; guard(load); }); return s; };
  view().replaceChildren(
    h('div', { class: 'toolbar' }, search,
      mk('status', [['', 'كل الحالات'], ...Object.entries(STATUS_LABEL)]),
      mk('unit', unitOptions(flat, { blank: 'كل الوحدات' })),
      mk('leave', [['', 'الإجازات: الكل'], ['true', 'مفعّل لهم'], ['false', 'غير مفعّل']]),
      h('span', { class: 'grow' }),
      can('employees_edit') ? [h('button', { class: 'btn', type: 'button', onClick: () => duplicatesDialog(load) }, ico('git-merge', 16), 'فحص التكرارات'),
        h('button', { class: 'btn', type: 'button', onClick: conflictsDialog }, ico('triangle-alert', 16), 'تعارضات الترحيل'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => editEmployee(null, load) }, ico('user-plus', 16), 'إضافة موظف')] : null),
    box);
  await load();
}

async function editEmployee(id, reload) {
  const { flat } = await units();
  const all = (await api('/employees?pageSize=1000')).employees;
  const e = id ? await api('/employees/' + id) : { status: 'active', show_in_directory: true };
  const F = {
    full_name: textInput(e.full_name, { required: true }), name_en: textInput(e.name_en, { dir: 'ltr' }), job_title: textInput(e.job_title), job_title_en: textInput(e.job_title_en, { dir: 'ltr' }),
    email: textInput(e.email, { type: 'email', dir: 'ltr' }), mobile: textInput(e.mobile, { dir: 'ltr' }), extension: textInput(e.extension, { inputmode: 'numeric' }), emp_no: textInput(e.emp_no),
    section: textInput(e.section), org_unit_id: select(unitOptions(flat), e.org_unit_id), unit_role: select([['', '—'], ['head', 'رئيس الوحدة'], ['member', 'عضو']], e.unit_role),
    manager_id: select([['', '— (يُستنتج من الهيكل) —'], ...all.filter(x => x.id !== id).map(x => [x.id, x.full_name])], e.manager_id),
    status: select(Object.entries(STATUS_LABEL), e.status), hire_date: textInput(e.hire_date, { type: 'date' }),
    move_reason: textInput('', { placeholder: 'اختياري: سبب النقل بين الوحدات' }),
  };
  const dirChk = h('input', { type: 'checkbox' }); dirChk.checked = e.show_in_directory !== false;
  const photoPrev = h('img', { src: e.photo ? '/portal/' + e.photo : '', alt: '', style: 'width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--hover);display:' + (e.photo ? 'block' : 'none') });
  const photoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const body = h('div', {},
    h('div', { class: 'form-grid' },
      field('الاسم (عربي) *', F.full_name), field('الاسم (إنجليزي)', F.name_en), field('المسمى الوظيفي', F.job_title), field('المسمى (إنجليزي)', F.job_title_en),
      field('البريد الإلكتروني', F.email), field('الجوال', F.mobile), field('رقم التحويلة', F.extension, 'فريد؛ يظهر في دليل البوابة'), field('الرقم الوظيفي', F.emp_no),
      field('الوحدة التنظيمية', F.org_unit_id), field('دور الوحدة', F.unit_role), field('المدير المباشر', F.manager_id), field('الحالة الوظيفية', F.status),
      field('تاريخ الالتحاق', F.hire_date), field('تسمية القسم في الدليل', F.section),
      id ? field('سبب النقل', F.move_reason) : null));
  body.append(h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center;margin-top:6px' }, dirChk, 'يظهر في دليل الموظفين بالبوابة'));
  if (id) body.append(h('div', { class: 'field', style: 'margin-top:12px' }, h('label', { class: 'f' }, 'الصورة الشخصية (تُستخدم في البوابة وبطاقة الموظف)'),
    h('div', { style: 'display:flex;gap:12px;align-items:center' }, photoPrev, photoIn), h('p', { class: 'hint' }, 'PNG أو JPG أو WebP حتى 5 ميجابايت؛ يُفضّل PNG بخلفية شفافة للبطاقة.')));
  if (id && e.history?.length) body.append(h('details', { style: 'margin-top:12px' }, h('summary', {}, `سجل النقل (${e.history.length})`),
    table([{ label: 'التاريخ', render: r => fmtDay(r.moved_on) }, { label: 'من', render: r => r.from_unit || '—' }, { label: 'إلى', render: r => r.to_unit || '—' }, { label: 'بواسطة', render: r => r.moved_by || '—' }, { label: 'السبب', render: r => r.reason || '—' }], e.history)));
  const save = h('button', { class: 'btn primary', type: 'button' }, 'حفظ');
  const m = modal({ title: id ? `تعديل: ${e.full_name}` : 'إضافة موظف', body, wide: true, footer: [save, h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'إلغاء'),
    id && can('employees_edit') ? h('button', { class: 'btn danger', type: 'button', style: 'margin-inline-start:auto', onClick: async () => {
      if (await confirmBox(`حذف «${e.full_name}» نهائياً؟ (لا يمكن إن كانت له حركات إجازات أو حساب دخول)`, 'حذف', true)) { await guard(async () => { await api('/employees/' + id, { method: 'DELETE' }); toast('تم الحذف'); m.close(); reload(); }); }
    } }, ico('trash-2', 15), 'حذف') : null] });
  save.addEventListener('click', () => guard(async () => {
    const payload = Object.fromEntries(Object.entries(F).map(([k, c]) => [k, c.value]));
    payload.show_in_directory = dirChk.checked;
    if (id) payload.version = e.version;
    const out = id ? await api('/employees/' + id, { method: 'PUT', body: payload }) : await api('/employees', { method: 'POST', body: payload });
    if (id && photoIn.files[0]) {
      const fd = new FormData(); fd.append('file', photoIn.files[0]);
      const r = await fetch(`/api/core/employees/${id}/photo`, { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذّر رفع الصورة');
    }
    toast(id ? 'تم حفظ التعديلات' : 'تمت الإضافة'); m.close(); reload(); return out;
  }));
}

async function duplicatesDialog(reload) {
  const { groups } = await api('/employees/duplicates');
  const body = groups.length ? h('div', {}, groups.map(g => h('div', { class: 'card', style: 'margin-bottom:12px' }, h('h2', {}, `${g.reason}`),
    table([{ label: '#', render: x => x.id }, { label: 'الاسم', render: x => x.full_name }, { label: 'الرقم الوظيفي', render: x => x.emp_no || '—' }, { label: 'التحويلة', render: x => x.extension ?? '—' },
      { label: 'ملف إجازات', render: x => (x.leave_enabled ? 'نعم' : 'لا') },
      { label: 'دمج', render: x => h('button', { class: 'btn sm', type: 'button', onClick: async () => {
        const keep = g.employees.find(y => y.id !== x.id);
        if (!keep || !(await confirmBox(`دمج السجل #${x.id} في #${keep.id}؟ تُنقل كل بياناته المرتبطة ثم يُحذف المكرر.`, 'دمج'))) return;
        await guard(async () => { await api('/employees/merge', { method: 'POST', body: { keep: keep.id, drop: x.id } }); toast('تم الدمج'); m.close(); reload(); });
      } }, `ادمجه في #${g.employees.find(y => y.id !== x.id)?.id}`) }], g.employees)))) : h('div', { class: 'empty' }, 'لا توجد سجلات مكررة');
  const m = modal({ title: 'فحص التكرارات', body, wide: true });
}

async function conflictsDialog() {
  const { conflicts } = await api('/conflicts');
  const KIND = { name_mismatch: 'اختلاف الاسم', job_title_mismatch: 'اختلاف المسمى الوظيفي', unit_mismatch: 'اختلاف الوحدة', duplicate_name: 'اسم مكرر' };
  const body = conflicts.length ? table([{ label: 'النوع', render: c => KIND[c.kind] || c.kind }, { label: 'الموظف', render: c => c.full_name || '—' },
    { label: 'التفاصيل', wrap: true, render: c => h('code', { dir: 'ltr' }, JSON.stringify(c.details)) },
    { label: 'الحالة', render: c => (c.resolved ? badge('محلول', 'ok') : badge('مفتوح', 'warn')) },
    { label: '', render: c => (can('employees_edit') ? h('button', { class: 'btn sm', type: 'button', onClick: () => guard(async () => { await api(`/conflicts/${c.id}/resolve`, { method: 'PUT', body: { resolved: !c.resolved } }); m.close(); conflictsDialog(); }) }, c.resolved ? 'إعادة فتح' : 'تم الحل') : '') }], conflicts)
    : h('div', { class: 'empty' }, 'لا تعارضات');
  const m = modal({ title: 'تعارضات ترحيل البيانات', body, wide: true });
}

// ───────────── الهيكل التنظيمي ─────────────
async function org() {
  const draw = async () => {
    const { tree, types } = await units(true);
    const node = n => {
      const actions = can('org_edit') ? h('div', { class: 'row-actions' },
        n.unit_type !== 'section' ? h('button', { class: 'btn sm', type: 'button', onClick: () => editUnit(null, n, draw) }, ico('plus', 14), 'وحدة فرعية') : null,
        h('button', { class: 'btn sm', type: 'button', onClick: () => editUnit(n, null, draw) }, ico('pencil', 14)),
        h('button', { class: 'btn sm', type: 'button', title: 'السجل', onClick: () => unitHistory(n) }, ico('history', 14))) : null;
      return h('li', {}, h('div', { class: 'tnode' + (n.active ? '' : ' off') },
        h('div', { class: 'grow' }, h('span', { class: 'nm' }, n.name), ' ', badge(types[n.unit_type] || n.unit_type), n.active ? null : badge('معطّلة', 'warn'),
          h('div', { class: 'meta' }, `${n.headcount} موظف${n.heads.length ? ' · رئيس الوحدة: ' + n.heads.map(x => x.name).join('، ') : ''}`)), actions),
      n.children.length ? h('ul', {}, n.children.map(node)) : null);
    };
    view().replaceChildren(h('div', { class: 'card tree' }, h('ul', {}, tree ? node(tree) : null)));
  };
  await draw();
}
async function editUnit(unit, parent, reload) {
  const { flat } = await units();
  const name = textInput(unit?.name || ''), code = textInput(unit?.code || '');
  const active = h('input', { type: 'checkbox' }); active.checked = unit ? unit.active : true;
  let parentSel = null;
  if (unit && unit.parent_id) {
    const cur = flat.find(u => u.id === unit.parent_id);
    parentSel = select(flat.filter(u => u.type === cur.type && u.active).map(u => [u.id, u.name]), unit.parent_id);
  }
  const body = h('div', {}, field('اسم الوحدة', name), field('الرمز (اختياري)', code), parentSel ? field('الوحدة الأم (للنقل)', parentSel, 'يمكن النقل تحت وحدة من المستوى نفسه فقط') : null,
    unit ? h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, active, 'الوحدة فعّالة') : null);
  const save = h('button', { class: 'btn primary', type: 'button' }, 'حفظ');
  const m = modal({ title: unit ? `تعديل: ${unit.name}` : `وحدة جديدة تحت «${parent.name}»`, body, footer: [save, h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'إلغاء'),
    unit && unit.parent_id ? h('button', { class: 'btn danger', type: 'button', style: 'margin-inline-start:auto', onClick: async () => {
      if (await confirmBox(`حذف الوحدة «${unit.name}»؟ (لا تُحذف إن كان فيها موظفون أو وحدات)`, 'حذف', true)) await guard(async () => { await api('/org/units/' + unit.id, { method: 'DELETE' }); toast('تم الحذف'); m.close(); reload(); });
    } }, ico('trash-2', 15), 'حذف') : null] });
  save.addEventListener('click', () => guard(async () => {
    if (unit) await api('/org/units/' + unit.id, { method: 'PUT', body: { name: name.value, code: code.value, active: active.checked, parent_id: parentSel ? +parentSel.value : undefined } });
    else await api('/org/units', { method: 'POST', body: { parent_id: parent.id, name: name.value, code: code.value } });
    toast('تم الحفظ'); m.close(); reload();
  }));
}
async function unitHistory(n) {
  const h2 = await api(`/org/units/${n.id}/history`);
  modal({ title: `سجل: ${n.name}`, wide: true, body: h('div', {},
    h('h2', {}, 'تنقلات الموظفين'), table([{ label: 'التاريخ', render: r => fmtDay(r.moved_on) }, { label: 'الموظف', render: r => r.full_name }, { label: 'من', render: r => r.from_unit || '—' }, { label: 'إلى', render: r => r.to_unit || '—' }, { label: 'بواسطة', render: r => r.moved_by || '—' }], h2.moves, 'لا تنقلات'),
    h('h2', { style: 'margin-top:18px' }, 'تغييرات الوحدة'), table([{ label: 'الوقت', render: r => fmtDate(r.at) }, { label: 'العملية', render: r => r.op }, { label: 'الحقول', render: r => (r.changed_cols || []).join('، ') || '—' },
      { label: 'المصدر', render: r => (r.direct ? badge('مباشر على القاعدة', 'bad') : badge('التطبيق')) }], h2.changes, 'لا تغييرات')) });
}

// ───────────── المستخدمون ─────────────
async function usersPage() {
  const [{ users }, { roles }, emps] = await Promise.all([api('/users'), api('/roles/brief'), api('/employees?pageSize=1000').catch(() => ({ employees: [] }))]);
  const redraw = () => usersPage();
  view().replaceChildren(
    h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', type: 'button', onClick: () => editUser(null, roles, emps.employees, redraw) }, ico('user-plus', 16), 'مستخدم جديد')),
    table([
      { label: 'المستخدم', render: u => h('div', {}, h('b', {}, u.username), h('div', { class: 'hint' }, u.full_name)) },
      { label: 'الموظف المرتبط', render: u => u.employee_name || '—' },
      { label: 'الأدوار', render: u => h('div', { class: 'chips' }, u.roles.map(r => badge(roles.find(x => x.key === r)?.name || r, 'info'))) },
      { label: 'الحالة', render: u => (u.locked_until && new Date(u.locked_until) > new Date() ? badge('مقفل', 'bad') : u.active ? badge('فعّال', 'ok') : badge('معطّل', 'warn')) },
      { label: 'آخر دخول', render: u => fmtDate(u.last_login_at) },
      { label: 'جلسات', render: u => u.active_sessions },
      { label: '', render: u => h('div', { class: 'row-actions' },
        h('button', { class: 'btn sm', type: 'button', onClick: () => editUser(u, roles, emps.employees, redraw) }, ico('pencil', 14), 'تعديل'),
        can('roles_manage') ? h('button', { class: 'btn sm', type: 'button', onClick: () => userPerms(u) }, ico('key-round', 14), 'الصلاحيات') : null,
        can('sessions_manage') && u.active_sessions ? h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { if (await confirmBox(`إنهاء كل جلسات ${u.username}؟`, 'إنهاء', true)) { await guard(async () => { const r = await api(`/users/${u.id}/revoke-sessions`, { method: 'POST' }); toast(`أُنهيت ${r.revoked} جلسة`); redraw(); }); } } }, ico('power', 14)) : null) },
    ], users));
}
function editUser(u, roles, emps, reload) {
  const F = { username: textInput(u?.username || '', { dir: 'ltr', disabled: !!u, autocomplete: 'off' }), full_name: textInput(u?.full_name || ''),
    password: h('input', { type: 'password', autocomplete: 'new-password', placeholder: u ? 'اتركها فارغة لعدم التغيير' : '' }),
    employee_id: select([['', '— بلا ربط —'], ...emps.map(e => [e.id, `${e.full_name}${e.extension ? ' — ' + e.extension : ''}`])], u?.employee_id) };
  const boxes = roles.map(r => { const c = h('input', { type: 'checkbox', value: r.key }); c.checked = u ? u.roles.includes(r.key) : r.key === 'employee'; return [r, c]; });
  const active = h('input', { type: 'checkbox' }); active.checked = u ? u.active : true;
  const must = h('input', { type: 'checkbox' }); must.checked = !!u?.must_change_password;
  const unlock = h('input', { type: 'checkbox' });
  const body = h('div', {}, h('div', { class: 'form-grid' }, field('اسم المستخدم', F.username, u ? null : 'حروف إنجليزية صغيرة وأرقام و . _ -'), field('الاسم الظاهر', F.full_name), field(u ? 'كلمة مرور جديدة' : 'كلمة المرور', F.password), field('الموظف المرتبط', F.employee_id, 'الحساب منفصل عن الموظف؛ الربط اختياري')),
    h('div', { class: 'field' }, h('label', { class: 'f' }, 'الأدوار'), h('div', { class: 'chips' }, boxes.map(([r, c]) => h('label', { class: 'badge info', style: 'cursor:pointer;gap:6px' }, c, r.name)))),
    h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, active, 'الحساب فعّال'),
    u ? h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, unlock, 'فتح القفل وتصفير المحاولات الفاشلة') : null);
  const save = h('button', { class: 'btn primary', type: 'button' }, 'حفظ');
  const m = modal({ title: u ? `تعديل: ${u.username}` : 'مستخدم جديد', body, wide: true, footer: [save, h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'إلغاء')] });
  save.addEventListener('click', () => guard(async () => {
    const payload = { full_name: F.full_name.value, employee_id: F.employee_id.value ? +F.employee_id.value : null, roles: boxes.filter(([, c]) => c.checked).map(([r]) => r.key), active: active.checked };
    if (F.password.value) payload.password = F.password.value;
    if (u) { payload.unlock = unlock.checked; await api('/users/' + u.id, { method: 'PUT', body: payload }); } else { payload.username = F.username.value; await api('/users', { method: 'POST', body: payload }); }
    toast('تم الحفظ'); m.close(); reload();
  }));
}
async function userPerms(u) {
  const [{ grants }, eff, { catalog }] = await Promise.all([api(`/users/${u.id}/grants`), api(`/users/${u.id}/effective`), api('/roles')]);
  const key = (a, b) => `${a}:${b}`;
  const ov = new Map(grants.map(g => [key(g.app, g.action), g.effect]));
  const effSet = new Map(eff.grants.map(g => [key(g.app, g.action), g.scope]));
  const sel = new Map();
  const blocks = catalog.apps.map(a => h('div', { class: 'appblock' }, h('h4', {}, ico(a.icon, 16), a.title),
    table([{ label: 'العملية', render: x => x.label }, { label: 'الفعلية الآن', render: x => (eff.isSuper ? badge('كل الصلاحيات', 'ok') : effSet.has(key(a.slug, x.action)) ? badge(SCOPE_LABEL[effSet.get(key(a.slug, x.action))], 'ok') : badge('ممنوعة', 'bad')) },
      { label: 'استثناء فردي', render: x => { const s = select([['', 'حسب الأدوار'], ['allow', 'السماح'], ['deny', 'المنع']], ov.get(key(a.slug, x.action)) || ''); sel.set(key(a.slug, x.action), s); return s; } }], a.actions)));
  const save = h('button', { class: 'btn primary', type: 'button' }, 'حفظ الاستثناءات');
  const m = modal({ title: `صلاحيات: ${u.username}`, wide: true, body: h('div', {}, h('p', { class: 'hint' }, `الأدوار: ${eff.roles.join('، ') || '—'}. الاستثناء «المنع» يغلب الأدوار، و«السماح» يضيف صلاحية فوقها. تسري التغييرات فوراً.`), blocks),
    footer: [save, h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'إغلاق')] });
  save.addEventListener('click', () => guard(async () => {
    const list = []; for (const [k, s] of sel) if (s.value) { const [app, action] = k.split(':'); list.push({ app, action, effect: s.value, scope: 'all' }); }
    await api(`/users/${u.id}/grants`, { method: 'PUT', body: { grants: list } }); toast('تم الحفظ'); m.close();
  }));
}

// ───────────── الأدوار والصلاحيات ─────────────
const SCOPED = new Set(['view', 'export', 'reports', 'employees_view']);
async function rolesPage() {
  const { roles, catalog } = await api('/roles');
  let cur = roles.find(r => r.id === Number(sessionStorage.getItem('roleId'))) || roles[0];
  const detail = h('div', { class: 'card' });
  const list = h('div', { class: 'rolelist' });
  const drawList = () => list.replaceChildren(...roles.map(r => h('button', { type: 'button', class: r.id === cur.id ? 'on' : '', onClick: () => { cur = r; sessionStorage.setItem('roleId', r.id); drawList(); drawDetail(); } },
    h('span', {}, r.name), h('span', { class: 'muted' }, r.users))));
  const drawDetail = () => {
    const state = new Map(cur.grants.map(g => [`${g.app}:${g.action}`, g.scope]));
    const name = textInput(cur.name), desc = textInput(cur.description || '');
    const rows = [];
    const blocks = catalog.apps.map(a => h('div', { class: 'appblock' }, h('h4', {}, ico(a.icon, 16), a.title, a.active ? null : badge('معطّلة', 'warn')),
      table([{ label: '', render: x => { const c = h('input', { type: 'checkbox', disabled: cur.is_super || !can('roles_manage') }); c.checked = cur.is_super || state.has(`${a.slug}:${x.action}`);
        c.addEventListener('change', () => { if (c.checked) state.set(`${a.slug}:${x.action}`, state.get(`${a.slug}:${x.action}`) || 'all'); else state.delete(`${a.slug}:${x.action}`); }); return c; } },
      { label: 'العملية', render: x => x.label },
      { label: 'نطاق البيانات', render: x => { if (!SCOPED.has(x.action)) return h('span', { class: 'muted' }, '—');
        const s = select(catalog.scopes.map(k => [k, SCOPE_LABEL[k]]), state.get(`${a.slug}:${x.action}`) || 'all', { disabled: cur.is_super || !can('roles_manage') });
        s.addEventListener('change', () => { if (state.has(`${a.slug}:${x.action}`)) state.set(`${a.slug}:${x.action}`, s.value); }); return s; } }], a.actions)));
    const save = h('button', { class: 'btn primary', type: 'button', onClick: () => guard(async () => {
      await api('/roles/' + cur.id, { method: 'PUT', body: { name: name.value, description: desc.value, grants: cur.is_super ? undefined : [...state].map(([k, scope]) => { const [app, action] = k.split(':'); return { app, action, scope }; }) } });
      toast('تم حفظ الدور — تسري الصلاحيات فوراً'); rolesPage();
    }) }, 'حفظ الدور');
    detail.replaceChildren(h('div', {}, h('div', { class: 'form-grid' }, field('اسم الدور', name, cur.is_system ? 'دور نظامي (لا يُحذف)' : null), field('الوصف', desc)),
      cur.is_super ? h('p', { class: 'badge ok' }, 'مدير النظام: كل الصلاحيات على كل المنصات (بما يُضاف مستقبلاً)') : null, blocks,
      can('roles_manage') ? h('div', { class: 'toolbar' }, save, cur.is_system ? null : h('button', { class: 'btn danger', type: 'button', onClick: async () => { if (await confirmBox(`حذف الدور «${cur.name}»؟`, 'حذف', true)) await guard(async () => { await api('/roles/' + cur.id, { method: 'DELETE' }); toast('تم الحذف'); rolesPage(); }); } }, 'حذف الدور')) : null));
  };
  view().replaceChildren(h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), can('roles_manage') ? h('button', { class: 'btn primary', type: 'button', onClick: () => newRole() }, ico('plus', 16), 'دور جديد') : null),
    h('div', { class: 'split' }, h('div', { class: 'card' }, h('h2', {}, 'الأدوار'), list), detail));
  drawList(); drawDetail();
}
function newRole() {
  const key = textInput('', { dir: 'ltr', placeholder: 'مثال: hr_viewer' }), name = textInput(''), desc = textInput('');
  const save = h('button', { class: 'btn primary', type: 'button' }, 'إنشاء');
  const m = modal({ title: 'دور جديد', body: h('div', {}, field('المفتاح (إنجليزي)', key, 'حروف صغيرة وأرقام و _'), field('الاسم', name), field('الوصف', desc), h('p', { class: 'hint' }, 'بعد الإنشاء حدّد صلاحياته من اللوحة.')), footer: [save, h('button', { class: 'btn', type: 'button', onClick: () => m.close() }, 'إلغاء')] });
  save.addEventListener('click', () => guard(async () => { const r = await api('/roles', { method: 'POST', body: { key: key.value, name: name.value, description: desc.value } }); sessionStorage.setItem('roleId', r.id); toast('تم الإنشاء'); m.close(); rolesPage(); }));
}

// ───────────── المنصات والجلسات ─────────────
async function platformsPage() {
  const { platforms } = await api('/platforms');
  view().replaceChildren(table([
    { label: 'المنصة', render: p => h('div', { style: 'display:flex;gap:10px;align-items:center' }, ico(p.icon, 20), h('div', {}, h('b', {}, p.title), h('div', { class: 'hint' }, p.description || ''))) },
    { label: 'المسار', render: p => h('code', { dir: 'ltr' }, p.path) },
    { label: 'نشاط 30 يوماً', render: p => (p.activity_30d ? `${p.activity_30d.n} عملية` : '—') },
    { label: 'الحالة', render: p => (p.active ? badge('مفعّلة', 'ok') : badge('معطّلة', 'warn')) },
    { label: '', render: p => (p.slug === 'admin' ? h('span', { class: 'muted' }, 'أساسية') : h('button', { class: 'btn sm', type: 'button', onClick: async () => {
      if (!p.active || await confirmBox(`تعطيل «${p.title}»؟ لن يستطيع أي مستخدم الدخول إليها.`, 'تعطيل', true)) await guard(async () => { await api('/platforms/' + p.slug, { method: 'PUT', body: { active: !p.active } }); toast('تم التحديث'); platformsPage(); });
    } }, p.active ? 'تعطيل' : 'تفعيل')) },
  ], platforms));
}
async function sessionsPage() {
  const { sessions, current } = await api('/sessions');
  view().replaceChildren(table([
    { label: 'المستخدم', render: s => h('div', {}, h('b', {}, s.username), h('div', { class: 'hint' }, s.full_name)) },
    { label: 'بدأت', render: s => fmtDate(s.created_at) }, { label: 'آخر نشاط', render: s => fmtDate(s.last_seen_at) }, { label: 'تنتهي', render: s => fmtDate(s.expires_at) },
    { label: 'العنوان', render: s => h('code', { dir: 'ltr' }, s.ip || '—') }, { label: 'المتصفح', render: s => (s.user_agent || '—').slice(0, 40) },
    { label: '', render: s => (s.id === current ? badge('جلستك', 'info') : h('button', { class: 'btn sm danger', type: 'button', onClick: async () => { await guard(async () => { await api(`/sessions/${s.id}/revoke`, { method: 'POST' }); toast('أُنهيت الجلسة'); sessionsPage(); }); } }, ico('power', 14), 'إنهاء')) },
  ], sessions, 'لا جلسات نشطة'));
}

// ───────────── سجل العمليات ─────────────
const audSt = { q: '', platform: '', action: '', result: '', from: '', to: '', page: 1, tab: 'app', direct: '' };
async function auditPage() {
  const box = h('div', {});
  const load = async () => {
    if (audSt.tab === 'db') {
      const d = await api('/db-changes' + qs({ direct: audSt.direct, page: audSt.page, pageSize: 50 }));
      box.replaceChildren(table([{ label: 'الوقت', render: r => fmtDate(r.at) }, { label: 'الجدول', render: r => r.table_name }, { label: 'العملية', render: r => r.op }, { label: 'السجل', render: r => r.row_id || '—' },
        { label: 'الحقول', render: r => (r.changed_cols || []).join('، ') || '—' }, { label: 'مستخدم القاعدة', render: r => r.db_user }, { label: 'التطبيق', render: r => r.app_name || '—' }, { label: 'العنوان', render: r => r.client_addr || '—' },
        { label: 'المصدر', render: r => (r.direct ? badge('مباشر على القاعدة', 'bad') : badge('التطبيق')) },
        { label: '', render: r => h('button', { class: 'btn sm', type: 'button', onClick: () => diffDialog(`${r.table_name} #${r.row_id}`, r.old_row, r.new_row) }, ico('eye', 14)) }], d.rows),
      pager(d.total, d.page, d.pageSize, p => { audSt.page = p; load(); }));
      return;
    }
    const d = await api('/audit' + qs({ ...audSt, tab: undefined, direct: undefined, pageSize: 50 }));
    box.replaceChildren(table([
      { label: 'الوقت', render: r => fmtDate(r.at) }, { label: 'المستخدم', render: r => r.username || '—' }, { label: 'المنصة', render: r => PLATFORM_LABEL[r.platform] || r.platform || '—' },
      { label: 'العملية', render: r => ACTION_LABEL[r.action] || r.action }, { label: 'الكيان', render: r => (r.entity ? `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` : '—') },
      { label: 'النتيجة', render: r => (r.result === 'success' ? badge('نجاح', 'ok') : badge(r.result === 'denied' ? 'مرفوض' : 'فشل', 'bad')) },
      { label: 'العنوان', render: r => h('code', { dir: 'ltr' }, r.ip || '—') },
      { label: '', render: r => h('button', { class: 'btn sm', type: 'button', onClick: async () => guard(async () => { const x = await api('/audit/' + r.id); diffDialog(`${ACTION_LABEL[x.action] || x.action} — ${x.entity || ''} ${x.entity_id || ''}`, x.before, x.after, x); }) }, ico('eye', 14), 'تفاصيل') },
    ], d.rows), pager(d.total, d.page, d.pageSize, p => { audSt.page = p; load(); }));
    facets = d.facets;
  };
  let facets = null;
  const tabs = h('div', { class: 'toolbar' },
    h('button', { class: 'btn' + (audSt.tab === 'app' ? ' primary' : ''), type: 'button', onClick: () => { audSt.tab = 'app'; audSt.page = 1; auditPage(); } }, 'عمليات المنصات'),
    h('button', { class: 'btn' + (audSt.tab === 'db' ? ' primary' : ''), type: 'button', onClick: () => { audSt.tab = 'db'; audSt.page = 1; auditPage(); } }, 'تغييرات قاعدة البيانات'));
  const bar = h('div', { class: 'toolbar' });
  if (audSt.tab === 'app') {
    const inp = (k, ph, type = 'search') => { const i = h('input', { type, placeholder: ph, value: audSt[k], 'aria-label': ph }); i.addEventListener('input', debounce(() => { audSt[k] = i.value; audSt.page = 1; guard(load); })); return i; };
    const sel = (k, opts) => { const s = select(opts, audSt[k], { 'aria-label': k }); s.addEventListener('change', () => { audSt[k] = s.value; audSt.page = 1; guard(load); }); return s; };
    bar.append(inp('q', 'بحث: مستخدم أو معرّف…'),
      sel('platform', [['', 'كل المنصات'], ['platform', 'الدخول'], ['portal', 'البوابة'], ['hr', 'الإجازات'], ['card', 'البطاقة'], ['report-builder', 'منشئ التقارير'], ['portal-admin', 'لوحة البوابة'], ['admin', 'الإدارة']]),
      sel('action', [['', 'كل العمليات'], ...Object.entries(ACTION_LABEL)]), sel('result', [['', 'كل النتائج'], ['success', 'نجاح'], ['failure', 'فشل'], ['denied', 'مرفوض']]),
      inp('from', 'من تاريخ', 'date'), inp('to', 'إلى تاريخ', 'date'), h('span', { class: 'grow' }),
      can('audit_export') ? h('a', { class: 'btn', href: '/api/core/audit/export.csv' + qs({ ...audSt, tab: undefined, direct: undefined, page: undefined }), onClick: e => { e.currentTarget.href = '/api/core/audit/export.csv' + qs({ ...audSt, tab: undefined, direct: undefined, page: undefined }); } }, ico('file-down', 16), 'تصدير CSV') : null);
  } else {
    const s = select([['', 'كل التغييرات'], ['true', 'المباشرة على القاعدة فقط']], audSt.direct); s.addEventListener('change', () => { audSt.direct = s.value; audSt.page = 1; guard(load); });
    bar.append(s, h('span', { class: 'hint' }, 'تُسجَّل التغييرات على مستوى الصف عبر مشغّلات PostgreSQL؛ «المباشرة» تعني عملية من خارج التطبيق (psql / pgAdmin) لا تُنسب لمستخدم التطبيق، فيُسجَّل مستخدم القاعدة وعنوان الاتصال.'));
  }
  view().replaceChildren(tabs, bar, box);
  await load();
}
function diffDialog(title, before, after, meta) {
  const pre = v => h('pre', {}, v ? JSON.stringify(v, null, 2) : '—');
  modal({ title, wide: true, body: h('div', {},
    meta ? h('dl', { class: 'kv', style: 'margin-bottom:14px' }, [['الوقت', fmtDate(meta.at)], ['المستخدم', meta.username || '—'], ['المنصة', PLATFORM_LABEL[meta.platform] || meta.platform || '—'], ['العنوان', meta.ip || '—'], ['الجلسة', meta.session_id || '—'], ['معرّف الطلب', meta.request_id || '—'], ['النتيجة', meta.result + (meta.reason ? ` — ${meta.reason}` : '')]]
      .flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    h('div', { class: 'diff' }, h('div', {}, h('h2', {}, 'قبل'), pre(before)), h('div', {}, h('h2', {}, 'بعد'), pre(after)))) });
}

// ───────────── الإعدادات ─────────────
const SETTINGS = [['portal_public', 'بوابة الموظفين مفتوحة بلا تسجيل دخول', 'bool'], ['session_hours', 'مدة الجلسة القصوى (ساعات)', 'int'], ['idle_minutes', 'مهلة الخمول (دقائق)', 'int'],
  ['password_min_length', 'الحد الأدنى لطول كلمة المرور', 'int'], ['max_failed_logins', 'محاولات الدخول الفاشلة قبل القفل', 'int'], ['lockout_minutes', 'مدة القفل (دقائق)', 'int']];
async function settingsPage() {
  const { settings } = await api('/settings');
  const inputs = SETTINGS.map(([k, label, type]) => {
    let c;
    if (type === 'bool') { c = h('input', { type: 'checkbox' }); c.checked = !!settings[k]; } else c = h('input', { type: 'number', value: settings[k] ?? '' });
    return [k, type, c, label];
  });
  view().replaceChildren(h('div', { class: 'card', style: 'max-width:640px' }, h('h2', {}, 'إعدادات المنصة'),
    inputs.map(([, type, c, label]) => type === 'bool' ? h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center;margin-bottom:14px' }, c, label) : field(label, c)),
    h('p', { class: 'hint' }, 'تسري تغييرات الجلسات على الجلسات الجديدة. إنهاء الجلسات الحالية من صفحة «الجلسات».'),
    can('settings_edit') ? h('button', { class: 'btn primary', type: 'button', onClick: () => guard(async () => {
      const body = {}; for (const [k, type, c] of inputs) body[k] = type === 'bool' ? c.checked : Number(c.value);
      await api('/settings', { method: 'PUT', body }); toast('تم حفظ الإعدادات');
    }) }, 'حفظ') : null));
}

// ───────────── التوجيه ─────────────
const PAGES = {
  dashboard: { title: 'لوحة المعلومات', icon: 'layout-dashboard', need: 'access', render: dashboard },
  employees: { title: 'الموظفون', icon: 'users', need: 'employees_view', render: employees },
  org: { title: 'الهيكل التنظيمي', icon: 'network', need: 'access', render: org },
  users: { title: 'المستخدمون', icon: 'user-cog', need: 'users_manage', render: usersPage },
  roles: { title: 'الأدوار والصلاحيات', icon: 'key-round', need: 'roles_manage', render: rolesPage },
  platforms: { title: 'المنصات', icon: 'monitor', need: 'platforms_manage', render: platformsPage },
  sessions: { title: 'الجلسات النشطة', icon: 'activity', need: 'sessions_manage', render: sessionsPage },
  audit: { title: 'سجل العمليات', icon: 'scroll-text', need: 'audit_view', render: auditPage },
  settings: { title: 'الإعدادات', icon: 'sliders-horizontal', need: 'settings_edit', render: settingsPage },
};
async function route() {
  const key = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const page = PAGES[key] && can(PAGES[key].need) ? PAGES[key] : PAGES.dashboard;
  const name = Object.keys(PAGES).find(k => PAGES[k] === page);
  $('pageTitle').textContent = page.title; document.title = `${page.title} | الإدارة المركزية`;
  for (const a of $('nav').children) a.classList.toggle('on', a.dataset.k === name);
  $('side').classList.remove('open');
  view().replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  await guard(() => page.render());
  view().focus({ preventScroll: true });
}

async function boot() {
  const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/login/?next=/admin/'; return; }
  me = await r.json();
  me.is_super = me.grants.some(g => g.app === '*');
  if (!can('access')) { $('boot').textContent = 'لا تملك صلاحية الوصول إلى لوحة الإدارة.'; return; }
  const nav = $('nav');
  for (const [k, p] of Object.entries(PAGES)) if (can(p.need)) nav.append(h('a', { href: '#/' + k, 'data-k': k }, ico(p.icon, 18), p.title));
  $('toLauncher').replaceChildren(ico('layout-grid', 16), 'كل المنصات');
  $('menuBtn').replaceChildren(ico('menu', 20));
  $('menuBtn').addEventListener('click', () => $('side').classList.toggle('open'));
  $('boot').hidden = true; $('shell').hidden = false;
  window.addEventListener('hashchange', route);
  await route();
}
boot();
