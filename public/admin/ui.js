// أدوات واجهة مشتركة للوحة الإدارة: بناء DOM آمن، نداءات API، نوافذ، إشعارات، ترقيم
import { icon } from '/shared/icons.js';

export { icon };
/** h('div', {class:'x', onClick}, ...children) — النصوص تُدرج كنص (آمنة من XSS) */
export function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;                      // للأيقونات الموثوقة فقط
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export const ico = (name, size = 18) => h('span', { html: icon(name, size), style: 'display:inline-grid;place-items:center' });

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body } = {}) {
  const override = ['PUT', 'DELETE', 'PATCH'].includes(method);   // يتجاوز حجب IIS/WebDAV لهذه الأفعال
  const res = await fetch('/api/core' + path, { method: override ? 'POST' : method, credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(override ? { 'X-HTTP-Method-Override': method } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new ApiError('انتهت الجلسة', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'حدث خطأ', res.status);
  return data;
}
export const qs = obj => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

export function toast(msg, isErr = false) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}
/** يشغّل fn ويعرض أي خطأ كإشعار */
export async function guard(fn) { try { return await fn(); } catch (e) { if (e.status !== 401) toast(e.message || 'حدث خطأ', true); return undefined; } }

export const fmtDate = v => (v ? new Date(v).toLocaleString('ar-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtDay = v => (v ? new Date(v).toLocaleDateString('ar-u-ca-gregory-nu-latn', { dateStyle: 'medium' }) : '—');

/** نافذة منبثقة: modal({title, body, footer:[buttons], wide}) تعيد { close, el } */
export function modal({ title, body, footer = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay', onClick: e => { if (e.target === ov) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h3', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onClick: close, html: icon('x', 18) })),
      h('div', { class: 'body' }, body), footer.length ? h('footer', {}, footer) : null));
  document.body.append(ov);
  document.addEventListener('keydown', onKey);
  (ov.querySelector('input,select,textarea,button.primary') || ov.querySelector('button'))?.focus();
  return { close, el: ov };
}
export function confirmBox(message, okLabel = 'تأكيد', danger = false) {
  return new Promise(resolve => {
    const m = modal({ title: 'تأكيد الإجراء', body: h('p', {}, message),
      footer: [h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onClick: () => { m.close(); resolve(true); } }, okLabel),
        h('button', { class: 'btn', type: 'button', onClick: () => { m.close(); resolve(false); } }, 'إلغاء')], onClose: () => resolve(false) });
  });
}

export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { class: 'f', for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
}
export const textInput = (v = '', attrs = {}) => h('input', { type: 'text', value: v ?? '', ...attrs });
export function select(options, value, attrs = {}) {
  const s = h('select', attrs, options.map(([v, l]) => h('option', { value: v ?? '' }, l)));
  s.value = value ?? '';
  return s;
}
export const badge = (text, kind = '') => h('span', { class: 'badge ' + kind }, text);

export function pager(total, page, pageSize, onPage) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return h('div', { class: 'pager' },
    h('button', { class: 'btn sm', type: 'button', disabled: page <= 1, onClick: () => onPage(page - 1) }, 'السابق'),
    h('span', {}, `صفحة ${page} من ${pages} — ${total} سجل`),
    h('button', { class: 'btn sm', type: 'button', disabled: page >= pages, onClick: () => onPage(page + 1) }, 'التالي'));
}
export function table(cols, rows, empty = 'لا توجد بيانات') {
  if (!rows.length) return h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, empty));
  return h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', {}, c.label)))),
    h('tbody', {}, rows.map(r => h('tr', {}, cols.map(c => h('td', { class: c.wrap ? 'wrap' : '' }, c.render(r))))))));
}
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export const STATUS_LABEL = { active: 'نشط', suspended: 'معطّل', terminated: 'منتهي الخدمة' };
export const UNIT_TYPE = { org: 'المنشأة', sector: 'قطاع', department: 'إدارة', section: 'قسم' };
export const SCOPE_LABEL = { self: 'بياناته فقط', reports: 'التابعون له', section: 'قسمه', department: 'إدارته', sector: 'قطاعه', all: 'كل الجهة' };
export const ACTION_LABEL = { login: 'دخول', login_failed: 'دخول فاشل', logout: 'خروج', create: 'إضافة', update: 'تعديل', delete: 'حذف', move: 'نقل', merge: 'دمج', export: 'تصدير',
  denied: 'رفض صلاحية', disable: 'تعطيل', update_grants: 'تغيير صلاحيات', revoke_session: 'إنهاء جلسة', revoke_sessions: 'إنهاء جلسات', adopt: 'ربط بسجل موجود', import: 'استيراد',
  upload: 'رفع ملف', update_photo: 'تغيير صورة', save: 'حفظ', restore: 'استعادة', resolve_conflict: 'حل تعارض' };
export const PLATFORM_LABEL = { platform: 'تسجيل الدخول', portal: 'بوابة الموظفين', hr: 'أرصدة الإجازات', card: 'بطاقة الموظف', 'report-builder': 'منشئ التقارير', 'portal-admin': 'لوحة البوابة', admin: 'الإدارة المركزية' };
