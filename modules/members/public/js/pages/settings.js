import { h, mount, icon, btn, api, can, state, fmtMoney, fmtDateTime, badge, fld, formModal, skeleton, empty, errorBox, toast, errMsg } from '../lib.js';

export default async function render(root, { query }) {
  const tabsDef = [
    can('settings.view') && ['general', 'الهوية والجمعية'], can('settings.view') && ['rules', 'العضوية والرسوم والقواعد'], can('settings.view') && ['types', 'أنواع العضويات'], can('settings.view') && ['messaging', 'البريد والرسائل'],
    can('users.manage') && ['roles', 'الأدوار والصلاحيات'],
  ].filter(Boolean);
  let tab = tabsDef.find(([k]) => k === query.tab)?.[0] || tabsDef[0]?.[0];
  const body = h('div'), tabs = h('div', { class: 'tabs', role: 'tablist' });
  const draw = () => { mount(tabs, tabsDef.map(([k, l]) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(k === tab), onClick: () => { tab = k; history.replaceState(null, '', `#/settings?tab=${k}`); draw(); } }, l))); ({ general, rules, types, messaging, roles })[tab](); };
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'الإعدادات'), h('p', {}, 'تُحفظ القيم في قاعدة البيانات دون تغيير الكود، وتُسجَّل تغييرات الإعدادات المهمة في سجل التدقيق.')), h('div', { class: 'actions' }, can('audit.view') ? btn('سجل التدقيق', { ic: 'shield', onClick: () => { location.hash = '#/audit'; } }) : null)), tabs, body);
  const manage = can('settings.manage');
  const load = async () => (await api('/settings')).settings;

  async function settingsForm(title, intro, defs, extra) {
    mount(body, skeleton(6));
    let s; try { s = await load(); } catch (e) { return mount(body, h('div', { class: 'panel' }, errorBox(e, draw))); }
    const fields = defs.map((d) => ({ d, f: fld({ ...d.fld, value: d.get ? d.get(s) : s[d.key], disabled: !manage }) }));
    const err = h('div');
    const form = h('form', { novalidate: true, class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, title)), h('div', { class: 'panel-b' }, intro ? h('p', { class: 'muted', style: { marginBlockEnd: '16px' } }, intro) : null, err, h('div', { class: 'grid g2' }, fields.map(({ f, d }) => { if (d.wide) f.root.style.gridColumn = '1 / -1'; return f.root; })), extra ? extra(s) : null),
      manage ? h('div', { class: 'modal-f', style: { borderRadius: '0 0 14px 14px' } }, h('button', { class: 'btn primary', type: 'submit' }, 'حفظ الإعدادات')) : null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); mount(err); fields.forEach(({ f }) => f.setError(''));
      const changes = {};
      for (const { d, f } of fields) { const v = d.set ? d.set(f) : f.value; if (JSON.stringify(v) !== JSON.stringify(d.get ? d.get(s) : s[d.key])) changes[d.key] = v; }
      if (!Object.keys(changes).length) return toast('لا توجد تغييرات');
      try { await api('/settings', { method: 'PUT', body: changes }); toast('تم حفظ الإعدادات', 'ok'); state.meta = await api('/meta'); document.documentElement.style.setProperty('--brand', state.meta.org.brand); draw(); }
      catch (ex) { mount(err, h('div', { class: 'alert bad', style: { marginBlockEnd: '12px' } }, icon('alert'), errMsg(ex))); }
    });
    mount(body, form);
    return { s, fields };
  }
  const numF = (v) => (v === '' ? NaN : Number(v));

  async function general() {
    const r = await settingsForm('هوية الجمعية', 'يظهر الاسم والشعار ولون الهوية في الواجهة والتقارير. لا يتوفر دليل هوية رسمي بعد؛ اللون الافتراضي مؤقت ويمكن تغييره.', [
      { key: 'org.name', fld: { label: 'اسم الجمعية', name: 'org.name', required: true } },
      { key: 'brand.primary', fld: { label: 'لون الهوية الأساسي', name: 'brand.primary', type: 'color', hint: 'يُستخدم في الأزرار والقوائم والتقارير' } },
    ], (s) => h('div', { style: { marginBlockStart: '20px' } }, h('h4', { style: { marginBlockEnd: '8px' } }, 'الشعار'),
      h('div', { class: 'actions' }, s['org.logo'] ? h('img', { src: `branding/logo?v=${encodeURIComponent(s['org.logo'])}`, alt: 'شعار الجمعية', style: { blockSize: '56px', borderRadius: '8px', border: '1px solid var(--line)', background: '#fff' } }) : h('span', { class: 'muted' }, 'لم يُرفع شعار بعد'),
        manage ? btn('رفع شعار (PNG/JPG حتى 1 ميغابايت)', { ic: 'upload', onClick: () => { const i = h('input', { type: 'file', accept: '.png,.jpg,.jpeg', hidden: true }); document.body.append(i); i.addEventListener('change', async () => { const f = i.files[0]; i.remove(); if (!f) return; try { const fd = new FormData(); fd.append('file', f); await api('/settings/logo', { method: 'POST', form: fd }); toast('تم رفع الشعار', 'ok'); state.meta = await api('/meta'); draw(); } catch (e) { toast(errMsg(e), 'bad'); } }); i.click(); } }) : null)));
    void r;
  }
  function rules() {
    settingsForm('العضوية والرسوم وقواعد الحالة', 'القواعد التالية تُحتسب في قاعدة البيانات وتنعكس فورًا على الحالات والمؤشرات. افتراضات: لا يُشترط سداد لتفعيل العضوية، ولا تُنهى العضوية بسبب التأخر في السداد، ما لم تضبطها وفق النظام الأساسي واللائحة.', [
      { key: 'fees.default_amount', fld: { label: 'قيمة الاشتراك الافتراضية (ر.س)', name: 'a', ltr: true, hint: 'تُستخدم عندما لا تحدد قيمة للنوع' }, get: (s) => String(s['fees.default_amount']), set: (f) => numF(f.value) },
      { key: 'membership.default_duration_months', fld: { label: 'مدة العضوية الافتراضية (أشهر)', name: 'b', type: 'number', min: 1, max: 120 }, get: (s) => String(s['membership.default_duration_months']), set: (f) => numF(f.value) },
      { key: 'rules.expiry_warning_days', fld: { label: 'عدد أيام «قريبة الانتهاء»', name: 'c', type: 'number', min: 1, max: 365, hint: 'العضوية التي يتبقى لانتهائها هذا العدد أو أقل' }, get: (s) => String(s['rules.expiry_warning_days']), set: (f) => numF(f.value) },
      { key: 'rules.grace_days', fld: { label: 'فترة السماح بعد الانتهاء (أيام)', name: 'd', type: 'number', min: 0, max: 365, hint: '0 = تُعدّ منتهية مباشرة بعد تاريخ الانتهاء' }, get: (s) => String(s['rules.grace_days']), set: (f) => numF(f.value) },
      { key: 'rules.activation_min_paid_percent', fld: { label: 'الحد الأدنى للسداد لتفعيل العضوية (%)', name: 'e', type: 'number', min: 0, max: 100, hint: '0 = لا يُشترط سداد. إن حُدّد، تظهر «لم تُفعَّل بعد» لمن لم يبلغه' }, get: (s) => String(s['rules.activation_min_paid_percent']), set: (f) => numF(f.value) },
      { key: 'rules.expire_overdue_days', fld: { label: 'إنهاء العضوية عند التأخر عن السداد أكثر من (يوم)', name: 'f', type: 'number', min: 0, max: 3650, hint: '0 = لا تُنهى العضوية بسبب التأخر المالي' }, get: (s) => String(s['rules.expire_overdue_days']), set: (f) => numF(f.value) },
    ], () => null);
  }
  async function messaging() {
    await settingsForm('البريد الإلكتروني والرسائل', 'مزود الخدمة الخارجي غير مرتبط. لا يُرسل النظام أي بريد أو رسالة قصيرة حاليًا، والتنبيهات داخلية فقط. هذه الحقول تُحفظ لاستخدامها عند الربط المستقبلي.', [
      { key: 'email.from_name', fld: { label: 'اسم المرسِل في البريد', name: 'a' } },
      { key: 'email.from_address', fld: { label: 'عنوان بريد المرسِل', name: 'b', type: 'email', ltr: true } },
      { key: 'sms.sender_id', fld: { label: 'معرّف مرسل SMS', name: 'c', ltr: true, maxlength: 20 } },
    ], () => h('div', { class: 'alert info', style: { marginBlockStart: '16px' } }, icon('alert'), 'مفاتيح مزود الخدمة (API keys) وكلمات مرور SMTP تُضبط عبر متغيرات البيئة على الخادم ولا تُخزَّن في قاعدة البيانات.'));
  }

  async function types() {
    mount(body, skeleton(5));
    let list; try { list = await api('/membership-types'); await 0; } catch (e) { return mount(body, h('div', { class: 'panel' }, errorBox(e, types))); }
    const edit = (t) => formModal({ title: t ? `تعديل نوع العضوية: ${t.name_ar}` : 'إضافة نوع عضوية', submitLabel: 'حفظ',
      fields: [{ label: 'اسم النوع', name: 'name_ar', required: true, value: t?.name_ar || '', wide: true }, { label: 'قيمة الاشتراك الافتراضية (ر.س)', name: 'default_fee', ltr: true, value: t?.default_fee ?? '0.00' },
        { label: 'المدة الافتراضية (أشهر)', name: 'default_duration_months', type: 'number', min: 1, max: 120, value: t?.default_duration_months ?? 12 }, { label: 'يسمح بالإعفاء من الرسوم', name: 'fee_exempt', type: 'checkbox', value: t?.fee_exempt }, { label: 'مفعّل (يظهر عند إضافة الأعضاء)', name: 'is_active', type: 'checkbox', value: t ? t.is_active : true }],
      onSubmit: async (v, m) => { await api(t ? `/membership-types/${t.id}` : '/membership-types', { method: t ? 'PUT' : 'POST', body: { ...v, default_duration_months: Number(v.default_duration_months) } }); m.close(); toast('تم الحفظ', 'ok'); state.meta = await api('/meta'); types(); } });
    mount(body, h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'أنواع العضويات'), manage ? btn('إضافة نوع', { ic: 'plus', cls: 'primary sm', onClick: () => edit(null) }) : null),
      h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['النوع', 'قيمة الاشتراك', 'المدة (أشهر)', 'الإعفاء', 'الحالة', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.map((t) => h('tr', {}, h('td', { 'data-label': 'النوع' }, h('b', {}, t.name_ar)), h('td', { 'data-label': 'قيمة الاشتراك' }, h('span', { class: 'num' }, `${fmtMoney(t.default_fee)} ر.س`)), h('td', { 'data-label': 'المدة' }, h('span', { class: 'num' }, t.default_duration_months)), h('td', { 'data-label': 'الإعفاء' }, t.fee_exempt ? 'مسموح' : '—'), h('td', { 'data-label': 'الحالة' }, t.is_active ? badge('مفعّل', 'ok') : badge('معطّل')), h('td', { 'data-label': '' }, manage ? btn('تعديل', { cls: 'sm', onClick: () => edit(t) }) : null))))))));
  }

  async function roles() {
    mount(body, skeleton(6));
    let rl; try { rl = await api('/roles'); } catch (e) { return mount(body, h('div', { class: 'panel' }, errorBox(e, roles))); }
    const groups = [...new Set(rl.permissions.map((p) => p.grp))];
    const sel = new Map(rl.roles.map((r) => [r.id, new Set(r.permission_ids)]));
    const boxes = [];
    const head = h('tr', {}, h('th', {}, 'الصلاحية'), rl.roles.map((r) => h('th', {}, r.name_ar)));
    const rowsEl = [];
    for (const g of groups) {
      rowsEl.push(h('tr', {}, h('td', { colspan: rl.roles.length + 1, style: { background: 'var(--surface-3)', fontWeight: 700 } }, g)));
      for (const p of rl.permissions.filter((x) => x.grp === g)) rowsEl.push(h('tr', {}, h('td', {}, p.name_ar, h('div', { class: 'small muted ltr' }, p.code)), rl.roles.map((r) => {
        const locked = r.code === 'admin';
        const c = h('input', { type: 'checkbox', checked: sel.get(r.id).has(p.id), disabled: locked, 'aria-label': `${p.name_ar} – ${r.name_ar}`, onChange: (e) => (e.target.checked ? sel.get(r.id).add(p.id) : sel.get(r.id).delete(p.id)) });
        boxes.push(c); return h('td', { class: 'c' }, c);
      })));
    }
    const saveRole = async (r) => { try { await api(`/roles/${r.id}/permissions`, { method: 'PUT', body: { permission_ids: [...sel.get(r.id)] } }); toast(`تم حفظ صلاحيات «${r.name_ar}»`, 'ok'); } catch (e) { toast(errMsg(e), 'bad'); } };
    const roleOpts = [{ value: '', label: '— لا وصول —' }, ...rl.roles.map((r) => ({ value: r.id, label: r.name_ar }))];
    const mapPanel = h('div', { class: 'panel', style: { marginBlockEnd: '24px' } }, h('div', { class: 'panel-h' }, h('h3', {}, 'ربط أدوار المنصة بأدوار هذا النظام'), h('span', { class: 'muted small' }, 'الحسابات تُدار من المنصة الموحّدة (الإعدادات › المستخدمون)')),
      h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['دور المنصة', 'الدور في هذا النظام'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rl.hr_roles.map((x) => { const sel = fld({ label: x.name_ar, name: x.code, type: 'select', options: roleOpts, value: x.role_id ?? '', disabled: x.code === 'admin' }); sel.root.querySelector('label').classList.add('sr-only');
          sel.input.addEventListener('change', async () => { try { await api(`/role-map/${x.code}`, { method: 'PUT', body: { role_id: sel.input.value === '' ? null : Number(sel.input.value) } }); toast('تم تحديث الربط', 'ok'); } catch (e) { toast(errMsg(e), 'bad'); roles(); } });
          return h('tr', {}, h('td', { 'data-label': 'دور المنصة' }, h('b', {}, x.name_ar), h('div', { class: 'small muted ltr' }, x.code)), h('td', { 'data-label': 'الدور في هذا النظام' }, sel.root)); })))));
    mount(body, mapPanel, h('div', { class: 'alert info', style: { marginBlockEnd: '16px' } }, icon('alert'), 'تُطبَّق الصلاحيات من جهة الخادم على كل طلب. صلاحيات مدير النظام ثابتة. التغيير يسري فورًا ويُسجَّل في التدقيق.'),
      h('div', { class: 'panel' }, h('div', { class: 'tablewrap' }, h('table', { class: 't matrix' }, h('thead', {}, head), h('tbody', {}, rowsEl), h('tfoot', {}, h('tr', {}, h('td', {}, 'حفظ'), rl.roles.map((r) => h('td', { class: 'c' }, r.code === 'admin' ? '—' : btn('حفظ', { cls: 'sm primary', onClick: () => saveRole(r) }))))))))); 
  }
  draw();
}
