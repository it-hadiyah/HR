import { h, mount, clear, icon, btn, api, can, state, fmtInt, fmtDateTime, badge, fld, pager, skeleton, empty, errorBox, toast, errMsg, formModal, labelOptions } from '../lib.js';

export default async function render(root, { query, refreshBell }) {
  let tab = query.tab === 'templates' ? 'templates' : 'inbox';
  const body = h('div'); const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const setTab = (t) => { tab = t; history.replaceState(null, '', `#/notifications${t === 'templates' ? '?tab=templates' : ''}`); draw(); };
  const gen = can('notifications.manage') ? btn('تحديث التنبيهات الآن', { ic: 'refresh', onClick: async () => { try { const r = await api('/notifications/generate', { method: 'POST' }); toast(r.created ? `أُنشئ ${fmtInt(r.created)} تنبيه جديد` : 'لا توجد تنبيهات جديدة', 'ok'); refreshBell(); draw(); } catch (e) { toast(errMsg(e), 'bad'); } } }) : null;
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'مركز التنبيهات'), h('p', {}, 'تذكيرات داخلية بمواعيد السداد والتجديد. لا تُرسل رسائل خارجية قبل تفعيل الخدمة واعتماد القوالب واختبارها.')), h('div', { class: 'actions' }, gen)), tabs, body);
  const draw = () => { mount(tabs, [['inbox', 'التنبيهات'], ['templates', 'القوالب والإعدادات']].map(([k, l]) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(tab === k), onClick: () => setTab(k) }, l))); tab === 'inbox' ? inbox() : templates(); };

  function inbox() {
    const st = { page: 1 };
    const status = fld({ label: 'الحالة', name: 'status', type: 'select', options: [{ value: '', label: 'غير المعالجة' }, { value: 'unread', label: 'غير مقروءة' }, { value: 'read', label: 'مقروءة' }, { value: 'dismissed', label: 'المستبعدة' }, { value: 'all', label: 'الكل' }] });
    const type = fld({ label: 'النوع', name: 'type', type: 'select', options: labelOptions(state.meta.notification_types, 'كل الأنواع') });
    const selected = new Set(); const table = h('div', { class: 'tablewrap' }), pg = h('div');
    const bulk = (s) => async () => { if (!selected.size) return toast('حدد تنبيهًا واحدًا على الأقل'); try { await api('/notifications/status', { method: 'POST', body: { ids: [...selected], status: s } }); selected.clear(); refreshBell(); load(); } catch (e) { toast(errMsg(e), 'bad'); } };
    mount(body, h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, status.root, type.root, h('div', { class: 'actions', style: { marginInlineStart: 'auto' } }, btn('تعليم كمقروء', { cls: 'sm', onClick: bulk('read') }), btn('استبعاد', { cls: 'sm', onClick: bulk('dismissed') }))), table, pg));
    async function load() {
      mount(table, skeleton(5)); clear(pg);
      let r; try { r = await api('/notifications', { params: { status: status.value, type: type.value, page: st.page, pageSize: 25 } }); } catch (e) { return mount(table, errorBox(e, load)); }
      if (!r.rows.length) return mount(table, empty('لا توجد تنبيهات', 'ستظهر هنا تنبيهات الاستحقاق والتأخر وانتهاء العضوية تلقائيًا.'));
      const all = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل', onChange: (e) => { r.rows.forEach((n) => (e.target.checked ? selected.add(n.id) : selected.delete(n.id))); table.querySelectorAll('tbody input').forEach((c) => { c.checked = e.target.checked; }); } });
      mount(table, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'التنبيه'), h('th', {}, 'العضو'), h('th', {}, 'التاريخ'), h('th', {}, 'الحالة'))),
        h('tbody', {}, r.rows.map((n) => h('tr', {}, h('td', { 'data-label': '' }, h('input', { type: 'checkbox', 'aria-label': 'تحديد', checked: selected.has(n.id), onChange: (e) => (e.target.checked ? selected.add(n.id) : selected.delete(n.id)) })),
          h('td', { 'data-label': 'التنبيه' }, h('b', {}, n.title), h('div', {}, n.body)), h('td', { 'data-label': 'العضو' }, h('a', { class: 'name', href: `#/members/${n.member_id}` }, n.full_name)),
          h('td', { 'data-label': 'التاريخ' }, h('span', { class: 'ltr' }, fmtDateTime(n.created_at))), h('td', { 'data-label': 'الحالة' }, n.status === 'unread' ? badge('جديد', 'info') : n.status === 'read' ? badge('مقروء') : badge('مستبعد')))))));
      mount(pg, pager({ page: r.page, pageSize: r.pageSize, total: r.total, onPage: (p) => { st.page = p; load(); } }));
    }
    [status, type].forEach((x) => x.input.addEventListener('change', () => { st.page = 1; load(); }));
    load();
  }

  async function templates() {
    mount(body, skeleton(6));
    let list, s = null;
    try { list = await api('/notification-templates'); if (can('settings.view')) s = (await api('/settings')).settings; } catch (e) { return mount(body, h('div', { class: 'panel' }, errorBox(e, templates))); }
    const CH = { internal: 'داخلي', email: 'بريد إلكتروني', sms: 'رسائل SMS' };
    const manage = can('notifications.manage');
    const edit = (t) => formModal({ title: `تعديل القالب: ${t.name_ar}`, size: 'lg', submitLabel: 'حفظ القالب',
      intro: `المتغيرات المتاحة: ${state.meta.placeholders.map((p) => `{{${p}}}`).join('  ')}. أي تعديل على النص يُسقط اعتماد القالب واختباره.`,
      fields: [...(t.channel === 'email' ? [{ label: 'عنوان الرسالة', name: 'subject', value: t.subject || '', wide: true }] : []), { label: 'نص القالب', name: 'body', type: 'textarea', rows: 6, value: t.body, required: true, wide: true, maxlength: 1000 }, { label: 'مفعّل', name: 'enabled', type: 'checkbox', value: t.enabled }],
      onSubmit: async (v, m) => { await api(`/notification-templates/${t.id}`, { method: 'PUT', body: { body: v.body, subject: v.subject, enabled: v.enabled } }); m.close(); toast('تم حفظ القالب', 'ok'); templates(); } });
    const toggle = async (t, enabled) => { try { await api(`/notification-templates/${t.id}`, { method: 'PUT', body: { enabled } }); toast(enabled ? 'تم التفعيل' : 'تم التعطيل', 'ok'); templates(); } catch (e) { toast(errMsg(e), 'bad'); } };
    const approve = async (t, ok) => { try { await api(`/notification-templates/${t.id}/approve`, { method: 'POST', body: { approved: ok } }); toast(ok ? 'تم اعتماد القالب' : 'أُلغي الاعتماد', 'ok'); templates(); } catch (e) { toast(errMsg(e), 'bad'); } };
    mount(body,
      h('div', { class: 'alert info', style: { marginBlockEnd: '16px' } }, icon('alert'), h('div', {}, h('b', {}, 'الإرسال الخارجي (بريد / SMS) غير مفعّل'), h('div', {}, 'التنبيهات الداخلية تعمل الآن. لإرسال رسائل خارجية يلزم ربط مزود خدمة، ثم اعتماد كل قالب واختباره قبل التفعيل. راجع docs/members/NOTIFICATIONS.md.'))),
      h('div', { class: 'panel' }, h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['القالب', 'القناة', 'النص', 'مفعّل', 'الاعتماد', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.map((t) => h('tr', {}, h('td', { 'data-label': 'القالب' }, h('b', {}, t.name_ar)), h('td', { 'data-label': 'القناة' }, CH[t.channel]),
          h('td', { 'data-label': 'النص', style: { maxInlineSize: '420px' } }, t.subject ? h('div', { class: 'small muted' }, t.subject) : null, h('div', { class: 'small' }, t.body)),
          h('td', { 'data-label': 'مفعّل' }, manage ? h('input', { type: 'checkbox', checked: t.enabled, 'aria-label': `تفعيل ${t.name_ar}`, onChange: (e) => toggle(t, e.target.checked) }) : (t.enabled ? 'نعم' : 'لا')),
          h('td', { 'data-label': 'الاعتماد' }, t.channel === 'internal' ? '—' : [t.approved_at ? badge('معتمد', 'ok') : badge('غير معتمد', 'warn'), ' ', t.tested_at ? badge('مُختبر', 'ok') : badge('غير مُختبر', 'warn'), manage ? h('div', {}, btn(t.approved_at ? 'إلغاء الاعتماد' : 'اعتماد', { cls: 'sm ghost', onClick: () => approve(t, !t.approved_at) })) : null]),
          h('td', { 'data-label': '' }, manage ? btn('تعديل', { cls: 'sm', onClick: () => edit(t) }) : null))))))),
      s ? h('p', { class: 'muted small', style: { marginBlockStart: '12px' } }, `أيام التنبيه قبل انتهاء العضوية: ${s['rules.expiry_warning_days']} (تُعدَّل من الإعدادات).`) : null);
  }
  draw();
}
