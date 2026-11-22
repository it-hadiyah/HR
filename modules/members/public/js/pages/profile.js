import { h, mount, icon, btn, api, can, canAny, state, fmtMoney, fmtDate, fmtDateLong, fmtHijri, fmtDateTime, dateCell, moneyEl, phoneEl, membershipBadge, paymentBadge, badge, skeleton, empty, errorBox, menuButton, toast, errMsg, download, confirmDialog, fmtInt } from '../lib.js';
import { memberFormModal, paymentModal, renewModal, statusModal } from './dialogs.js';

const ACTIONS = { 'member.create': 'إنشاء العضو', 'member.update': 'تعديل البيانات', 'member.renew': 'تجديد العضوية', 'member.status': 'تغيير الحالة الإدارية', 'member.archive': 'أرشفة', 'member.restore': 'استعادة من الأرشيف',
  'period.update': 'تعديل دورة الاشتراك', 'payment.create': 'تسجيل سداد', 'payment.update': 'تعديل سداد', 'payment.void': 'إلغاء سداد', 'attachment.upload': 'رفع مرفق', 'attachment.delete': 'حذف مرفق' };
const FIELD_NAMES = { full_name: 'الاسم', phone: 'الجوال', email: 'البريد', joined_at: 'تاريخ الانضمام', notes: 'الملاحظات', amount: 'المبلغ', paid_at: 'تاريخ السداد', method: 'الطريقة', reference: 'المرجع', amount_due: 'قيمة الاشتراك', due_date: 'الاستحقاق', start_date: 'البداية', end_date: 'النهاية', membership_type_id: 'نوع العضوية', is_exempt: 'الإعفاء', admin_status: 'الحالة الإدارية', status: 'الحالة', reason: 'السبب' };

function diffView(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !['member_id', 'member_no', 'subscription_id'].includes(k));
  const rows = keys.filter((k) => typeof (after || {})[k] !== 'object' || (after || {})[k] === null).map((k) => {
    const b = before?.[k], a = after?.[k];
    const val = (x) => (x === null || x === undefined || x === '' ? '—' : (state.meta.payment_methods[x] || String(x)));
    return h('div', {}, h('span', { class: 'muted' }, `${FIELD_NAMES[k] || k}: `), b !== undefined ? [h('del', {}, val(b)), ' ← '] : null, h('ins', {}, val(a)));
  });
  return rows.length ? h('div', { class: 'diff' }, rows) : null;
}

export default async function render(root, { params, setTitle }) {
  const id = Number(params[0]);
  const fin = can('payments.view');
  async function load() {
    mount(root, skeleton(10));
    let p;
    try { p = await api(`/members/${id}`); } catch (e) { return mount(root, h('div', { class: 'panel' }, e.status === 404 ? empty('العضو غير موجود', null, btn('العودة للأعضاء', { onClick: () => { location.hash = '#/members'; } })) : errorBox(e, load))); }
    const m = p.member;
    setTitle(m.full_name);
    const openSubs = p.periods.filter((x) => x.subscription_id && !x.is_exempt && Number(x.remaining) > 0);
    const pctPaid = Number(m.total_due) > 0 ? Math.min(100, Math.round((Number(m.total_paid) / Number(m.total_due)) * 100)) : 0;
    const reload = () => load();

    const moreItems = [
      can('members.status') && { label: 'الحالة الإدارية (تعليق/إلغاء)', icon: 'ban', onClick: () => statusModal({ member: m, onSaved: reload }) },
      can('members.archive') && (m.archived_at ? { label: 'استعادة من الأرشيف', icon: 'archive', onClick: async () => { await api(`/members/${id}/restore`, { method: 'POST' }); toast('تمت الاستعادة', 'ok'); reload(); } }
        : { label: 'أرشفة العضو', icon: 'archive', onClick: async () => { if (await confirmDialog({ title: 'أرشفة العضو', message: 'تُخفى سجلات العضو من القوائم والمؤشرات، ويُحتفظ بكل بياناته المالية. يمكن استعادته لاحقًا.', confirmLabel: 'أرشفة', danger: true })) { try { await api(`/members/${id}/archive`, { method: 'POST' }); toast('تمت الأرشفة', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } } } }),
    ].filter(Boolean);

    const head = h('div', { class: 'profile-head' },
      h('div', { class: 'pid' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, m.full_name.trim().slice(0, 1)),
        h('div', {}, h('h2', {}, m.full_name), h('div', { class: 'meta' }, h('span', { class: 'num' }, m.member_no), m.type_name ? h('span', {}, `عضوية ${m.type_name}`) : null, membershipBadge(m.membership_status), fin ? paymentBadge(m.payment_status) : null, m.archived_at ? badge('مؤرشف', 'mute') : null))),
      h('div', { class: 'actions no-print' },
        can('members.edit') ? btn('تعديل البيانات', { ic: 'edit', onClick: () => memberFormModal({ member: m, onSaved: reload }) }) : null,
        can('payments.create') && openSubs.length ? btn('تسجيل سداد', { ic: 'wallet', cls: 'primary', onClick: () => paymentModal({ member: m, subscriptions: openSubs, onSaved: reload }) }) : null,
        can('members.renew') && m.admin_status !== 'cancelled' ? btn('تجديد العضوية', { ic: 'refresh', onClick: () => renewModal({ member: m, onSaved: reload }) }) : null,
        btn('طباعة ملخص العضوية', { ic: 'print', onClick: async () => { try { await download(`/members/${id}/summary.pdf`, {}, `member-${m.member_no}.pdf`); } catch (e) { toast(errMsg(e), 'bad'); } } }),
        moreItems.length ? menuButton('المزيد', moreItems) : null));

    const alerts = [];
    if (m.admin_status !== 'normal') alerts.push(h('div', { class: 'alert warn', style: { marginBlockEnd: '16px' } }, icon('alert'), h('div', {}, h('b', {}, m.admin_status === 'suspended' ? 'العضوية معلّقة إداريًا' : 'العضوية ملغاة رسميًا'), m.admin_status_reason ? h('div', {}, `السبب: ${m.admin_status_reason}`) : null)));
    if (fin && m.any_overdue) alerts.push(h('div', { class: 'alert bad', style: { marginBlockEnd: '16px' } }, icon('alert'), `يوجد اشتراك متأخر عن السداد منذ ${fmtInt(m.max_overdue_days)} يومًا.`));

    const facts = fin ? h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { class: 'k-l' }, 'إجمالي المستحق'), h('div', { class: 'k-v' }, fmtMoney(m.total_due), h('small', {}, 'ر.س'))),
      h('div', { class: 'fact' }, h('span', { class: 'k-l' }, 'المسدد'), h('div', { class: 'k-v ok' }, fmtMoney(m.total_paid), h('small', {}, 'ر.س')), h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pctPaid), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'نسبة المسدد' }, h('i', { style: { inlineSize: `${pctPaid}%` } }))),
      h('div', { class: 'fact' }, h('span', { class: 'k-l' }, 'المتبقي'), h('div', { class: `k-v ${Number(m.total_remaining) > 0 ? 'bad' : ''}` }, fmtMoney(m.total_remaining), h('small', {}, 'ر.س'))),
      h('div', { class: 'fact' }, h('span', { class: 'k-l' }, 'ينتهي في'), h('div', { class: 'k-v', style: { fontSize: '1.2rem' } }, m.period_end ? fmtDateLong(m.period_end) : '—'), h('span', { class: 'k-s' }, m.days_to_expiry === null ? '' : m.days_to_expiry >= 0 ? `بعد ${fmtInt(m.days_to_expiry)} يومًا` : `منذ ${fmtInt(-m.days_to_expiry)} يومًا`))) : null;

    const info = h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'المعلومات الأساسية')),
      h('div', { class: 'panel-b' }, h('dl', { class: 'dl' },
        h('dt', {}, 'رقم العضوية'), h('dd', {}, h('span', { class: 'num' }, m.member_no)),
        h('dt', {}, 'الجوال'), h('dd', {}, phoneEl(m.phone)), h('dt', {}, 'البريد الإلكتروني'), h('dd', {}, m.email ? h('span', { class: 'ltr' }, m.email) : '—'),
        h('dt', {}, 'نوع العضوية'), h('dd', {}, m.type_name || '—'),
        h('dt', {}, 'تاريخ الانضمام'), h('dd', {}, fmtDateLong(m.joined_at), state.hijri ? h('div', { class: 'small muted' }, fmtHijri(m.joined_at)) : null),
        h('dt', {}, 'بداية الدورة الحالية'), h('dd', {}, m.period_start ? fmtDateLong(m.period_start) : '—', state.hijri && m.period_start ? h('div', { class: 'small muted' }, fmtHijri(m.period_start)) : null),
        h('dt', {}, 'نهاية الدورة الحالية'), h('dd', {}, m.period_end ? fmtDateLong(m.period_end) : '—', state.hijri && m.period_end ? h('div', { class: 'small muted' }, fmtHijri(m.period_end)) : null),
        fin ? [h('dt', {}, 'قيمة الاشتراك الحالي'), h('dd', {}, m.is_exempt ? 'معفى من الرسوم' : [moneyEl(m.amount_due), ' ر.س']), h('dt', {}, 'تاريخ الاستحقاق'), h('dd', {}, dateCell(m.due_date)),
          h('dt', {}, 'آخر سداد فعلي'), h('dd', {}, m.last_paid_at ? dateCell(m.last_paid_at) : 'لا يوجد')] : null,
        h('dt', {}, 'ملاحظات إدارية'), h('dd', {}, m.notes || '—'))));

    const cycles = fin ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'دورات الاشتراك والتجديدات'), h('span', { class: 'muted small' }, `${fmtInt(p.periods.length)} دورة`)),
      p.periods.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['الدورة', 'النوع', 'من', 'إلى', 'المستحق', 'المسدد', 'المتبقي', 'الاستحقاق', 'حالة السداد'].map((x, i) => h('th', { class: [4, 5, 6].includes(i) ? 'n' : '' }, x)))),
        h('tbody', {}, p.periods.map((x) => h('tr', {}, h('td', { 'data-label': 'الدورة' }, x.kind === 'renewal' ? 'تجديد' : 'اشتراك أولي', x.id === m.period_id ? [' ', badge('الحالية', 'info')] : null, x.status === 'cancelled' ? [' ', badge('ملغاة', 'bad')] : null),
          h('td', { 'data-label': 'النوع' }, x.type_name), h('td', { 'data-label': 'من' }, dateCell(x.start_date)), h('td', { 'data-label': 'إلى' }, dateCell(x.end_date)),
          h('td', { class: 'n', 'data-label': 'المستحق' }, x.is_exempt ? 'معفى' : moneyEl(x.amount_due)), h('td', { class: 'n', 'data-label': 'المسدد' }, moneyEl(x.paid)), h('td', { class: 'n', 'data-label': 'المتبقي' }, moneyEl(x.remaining)),
          h('td', { 'data-label': 'الاستحقاق' }, dateCell(x.due_date)), h('td', { 'data-label': 'حالة السداد' }, paymentBadge(x.payment_status))))))) : empty('لا توجد دورات')) : null;

    const uploadReceipt = (pay) => {
      const inp = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg', hidden: true });
      inp.addEventListener('change', async () => { const f = inp.files[0]; if (!f) return; try { const fd = new FormData(); fd.append('file', f); await api(`/payments/${pay.id}/receipts`, { method: 'POST', form: fd }); toast('تم رفع الإيصال', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } });
      document.body.append(inp); inp.click(); inp.addEventListener('change', () => inp.remove(), { once: true });
    };
    const attFor = (payId) => p.attachments.filter((a) => a.payment_id === payId);
    const payRows = p.payments.map((x) => {
      const sub = p.periods.find((pp) => pp.subscription_id === x.subscription_id);
      const voided = x.status === 'voided';
      return h('tr', { class: voided ? 'muted' : '' },
        h('td', { 'data-label': 'التاريخ' }, dateCell(x.paid_at)), h('td', { class: 'n', 'data-label': 'المبلغ' }, voided ? h('del', {}, moneyEl(x.amount)) : moneyEl(x.amount)),
        h('td', { 'data-label': 'الطريقة' }, state.meta.payment_methods[x.method] || x.method), h('td', { 'data-label': 'المرجع' }, x.reference ? h('span', { class: 'ltr' }, x.reference) : '—'),
        h('td', { 'data-label': 'الدورة' }, sub ? h('span', { class: 'ltr' }, `${fmtDate(sub.start_date)} – ${fmtDate(sub.end_date)}`) : '—'),
        h('td', { 'data-label': 'الحالة' }, voided ? [badge('ملغاة', 'bad'), h('div', { class: 'small' }, x.void_reason)] : badge('مؤكدة', 'ok')),
        h('td', { 'data-label': 'الإيصال' }, can('receipts.view') ? attFor(x.id).map((a) => h('a', { href: '#', class: 'small', style: { display: 'block' }, onClick: async (e) => { e.preventDefault(); try { await download(`/attachments/${a.id}`, {}, a.original_name); } catch (er) { toast(errMsg(er), 'bad'); } } }, icon('clip'), ' ', a.original_name)) : null, !voided && can('payments.create') ? btn('رفع إيصال', { cls: 'sm ghost', onClick: () => uploadReceipt(x) }) : null),
        h('td', { 'data-label': '', class: 'no-print' }, voided ? null : h('div', { class: 'actions' },
          can('payments.edit') && x.method !== 'opening_balance' ? btn('تعديل', { cls: 'sm', onClick: () => paymentModal({ member: m, subscriptions: p.periods, payment: x, onSaved: reload }) }) : null,
          can('payments.void') ? btn('إلغاء', { cls: 'sm danger', onClick: async () => { const reason = await confirmDialog({ title: 'إلغاء عملية السداد', message: `سيُلغى سداد ${fmtMoney(x.amount)} ر.س ويُعاد احتساب المتبقي. تبقى العملية ظاهرة في السجل.`, confirmLabel: 'إلغاء السداد', danger: true, reason: { label: 'سبب الإلغاء' } }); if (reason) { try { await api(`/payments/${x.id}/void`, { method: 'POST', body: { reason } }); toast('تم إلغاء السداد', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } } } }) : null)));
    });
    const payments = fin ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'عمليات السداد'),
      can('payments.create') && openSubs.length ? btn('تسجيل سداد', { cls: 'sm primary', ic: 'plus', onClick: () => paymentModal({ member: m, subscriptions: openSubs, onSaved: reload }) }) : null),
      p.payments.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't cards' }, h('thead', {}, h('tr', {}, ['التاريخ', 'المبلغ', 'الطريقة', 'المرجع', 'الدورة', 'الحالة', 'الإيصال', ''].map((x, i) => h('th', { class: i === 1 ? 'n' : '' }, x)))), h('tbody', {}, payRows))) : empty('لا توجد عمليات سداد بعد', 'سجّل أول دفعة لتظهر هنا مع المتبقي.')) : null;

    const docs = p.attachments.filter((a) => a.kind === 'document');
    const docsPanel = canAny('documents.view', 'documents.manage') ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'مستندات العضوية'),
      can('documents.manage') ? btn('رفع مستند', { cls: 'sm', ic: 'upload', onClick: () => {
        const inp = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg', hidden: true }); document.body.append(inp);
        inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); if (!f) return; try { const fd = new FormData(); fd.append('file', f); await api(`/members/${id}/documents`, { method: 'POST', form: fd }); toast('تم رفع المستند', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } });
        inp.click(); } }) : null),
      docs.length ? h('ul', { class: 'timeline' }, docs.map((a) => h('li', {}, h('div', { class: 'actions' }, h('a', { href: '#', onClick: async (e) => { e.preventDefault(); try { await download(`/attachments/${a.id}`, {}, a.original_name); } catch (er) { toast(errMsg(er), 'bad'); } } }, icon('clip'), ' ', a.original_name),
        can('documents.manage') ? btn('حذف', { cls: 'sm danger ghost', onClick: async () => { if (await confirmDialog({ title: 'حذف المستند', message: `حذف «${a.original_name}»؟ يُحفظ الحذف في سجل التدقيق.`, confirmLabel: 'حذف', danger: true })) { try { await api(`/attachments/${a.id}`, { method: 'DELETE' }); toast('تم الحذف', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } } } }) : null),
        h('span', { class: 'when' }, `${fmtDateTime(a.uploaded_at)} · ${fmtInt(Math.ceil(a.size_bytes / 1024))} ك.ب`))) ) : empty('لا توجد مستندات', 'يمكن رفع صور الهوية أو خطابات الانضمام (PDF/PNG/JPG).')) : null;

    const notif = canAny('notifications.view') ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'الإشعارات المرتبطة بالعضو')),
      p.notifications.length ? h('ul', { class: 'timeline' }, p.notifications.map((n) => h('li', {}, h('div', {}, h('b', {}, n.title), ' ', n.status === 'unread' ? badge('جديد', 'info') : null), h('span', {}, n.body), h('span', { class: 'when' }, fmtDateTime(n.created_at))))) : empty('لا توجد إشعارات')) : null;

    const hist = p.history.length || canAny('audit.view', 'members.edit') ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h3', {}, 'سجل التعديلات الإدارية')),
      p.history.length ? h('ul', { class: 'timeline' }, p.history.map((x) => h('li', {}, h('div', {}, h('b', {}, ACTIONS[x.action] || x.action), h('span', { class: 'muted' }, ` · ${x.username || 'النظام'}`)), diffView(x.before, x.after), h('span', { class: 'when' }, fmtDateTime(x.created_at))))) : empty('لا توجد تعديلات مسجّلة')) : null;

    mount(root, head, ...alerts, facts, h('div', { class: 'cols-2', style: { marginBlockStart: 0 } }, info, h('div', {}, docsPanel, notif && h('div', { style: { marginBlockStart: '24px' } }, notif))), cycles && h('div', { style: { marginBlockStart: '24px' } }, cycles), payments && h('div', { style: { marginBlockStart: '24px' } }, payments), hist && h('div', { style: { marginBlockStart: '24px' } }, hist));
  }
  await load();
}
