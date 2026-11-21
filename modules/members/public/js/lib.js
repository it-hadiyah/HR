// مكتبة الواجهة: إنشاء عناصر آمن (بلا innerHTML)، تنسيق، طلبات API، نوافذ، نماذج.
export const state = { user: null, perms: new Set(), csrf: '', meta: null, hijri: false };
export const can = (...p) => p.every((x) => state.perms.has(x));
export const canAny = (...p) => p.some((x) => state.perms.has(x));

// ───────── DOM ─────────
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); // CSSOM مسموح بـ CSP
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { el.replaceChildren(); return el; };
export const mount = (el, ...children) => { clear(el); return append(el, children); };

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  users: 'M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a4 4 0 100-8 4 4 0 000 8zM21 20v-2a4 4 0 00-3-3.9M16 2.1a4 4 0 010 7.8',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15a1 1 0 001-1v-4M3 7h16a2 2 0 012 2v3M17 14h4',
  bell: 'M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  refresh: 'M21 12a9 9 0 01-15.5 6.2L3 16M3 12A9 9 0 0118.5 5.8L21 8M21 3v5h-5M3 21v-5h5',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  clip: 'M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  more: 'M12 12h.01M19 12h.01M5 12h.01',
  calendar: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM16 2v4M8 2v4M3 10h18',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h6',
  ban: 'M12 22a10 10 0 100-20 10 10 0 000 20zM4.9 4.9l14.2 14.2',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
};
export function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] || ICONS.file); s.append(p);
  return s;
}
export const btn = (label, { cls = '', ic, onClick, type = 'button', title, disabled } = {}) =>
  h('button', { class: `btn ${cls}`, type, title, 'aria-label': title && !label ? title : null, onClick, disabled }, ic ? icon(ic) : null, label);

// ───────── التنسيق ─────────
const nfMoney = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('en-US');
export const fmtMoney = (v) => (v === null || v === undefined || v === '' ? '—' : nfMoney.format(Number(v)));
export const fmtInt = (v) => (v === null || v === undefined ? '—' : nfInt.format(Number(v)));
const dfLong = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dfHijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dfTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDate = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—');
export const fmtDateLong = (iso) => (iso ? dfLong.format(new Date(iso + 'T00:00:00Z')) : '—');
export const fmtHijri = (iso) => (iso ? dfHijri.format(new Date(iso + 'T00:00:00Z')) : '');
export const fmtDateTime = (ts) => { if (!ts) return '—'; const p = dfTime.formatToParts(new Date(ts)).reduce((a, x) => ({ ...a, [x.type]: x.value }), {}); return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`; };
/** تاريخ في جدول: يعرض الهجري كسطر ثانٍ عند تفعيله */
export const dateCell = (iso) => (iso ? h('span', { class: 'ltr' }, fmtDate(iso), state.hijri ? h('span', { class: 'small muted', style: { display: 'block' } }, fmtHijri(iso)) : null) : '—');
export const num = (v) => h('span', { class: 'num' }, v);
export const moneyEl = (v) => h('span', { class: 'num' }, fmtMoney(v));
export const phoneEl = (v) => (v ? h('span', { class: 'ltr' }, v) : '—');
export const money0 = (v) => Number(v || 0) === 0;
export const today = () => state.meta?.today || new Date().toISOString().slice(0, 10);

const MS_TONE = { active: 'ok', near_expiry: 'warn', expired: 'bad', suspended: 'mute', cancelled: 'bad', pending: 'info' };
const PS_TONE = { paid: 'ok', partial: 'warn', unpaid: 'bad', overdue: 'bad', not_yet_due: 'info', exempt: 'mute' };
export const badge = (text, tone = 'mute') => h('span', { class: `badge ${tone === 'mute' ? '' : tone}` }, text);
export const membershipBadge = (s) => (s ? badge(state.meta.labels.membership_status[s] || s, MS_TONE[s]) : '—');
export const paymentBadge = (s) => (s ? badge(state.meta.labels.payment_status[s] || s, PS_TONE[s]) : '—');

// ───────── API ─────────
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || 'تعذّر تنفيذ الطلب'); this.status = status; this.code = body?.code; this.details = body?.details; }
}
export function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== '' && v !== null && v !== undefined && v !== false) u.set(k, v);
  const s = u.toString(); return s ? `?${s}` : '';
}
export async function api(path, { method = 'GET', body, params, form, signal } = {}) {
  const headers = {};
  if (state.csrf) headers['x-csrf-token'] = state.csrf;
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/members/api${path}${qs(params)}`, { method, headers, body: payload, signal, credentials: 'same-origin' }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, { error: 'تعذّر الاتصال بالخادم. تحقق من الاتصال بالشبكة', code: 'network' }); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('session-expired'));
    throw new ApiError(res.status, data);
  }
  return data;
}
export async function download(path, params, fallbackName = 'file') {
  const res = await fetch(`/members/api${path}${qs(params)}`, { credentials: 'same-origin' });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d); }
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const errMsg = (e) => (e?.message || 'حدث خطأ غير متوقع');

// ───────── إشعارات عابرة ─────────
let toastBox;
export function toast(msg, type = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${type}` }, icon(type === 'bad' ? 'alert' : 'check'), h('span', {}, msg));
  toastBox.append(t);
  setTimeout(() => t.remove(), type === 'bad' ? 8000 : 4500);
}

// ───────── نوافذ ─────────
export function modal({ title, body, footer, size = '' , onClose }) {
  const prevFocus = document.activeElement;
  const titleId = 'm' + Math.random().toString(36).slice(2);
  const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-h' }, h('h3', { id: titleId }, title), h('button', { class: 'btn ghost iconbtn', type: 'button', 'aria-label': 'إغلاق', onClick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b' }, body),
    footer ? h('div', { class: 'modal-f' }, footer) : null);
  const overlay = h('div', { class: 'overlay' }, box);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  function close(v) { document.removeEventListener('keydown', onKey, true); overlay.remove(); document.body.style.overflow = ''; prevFocus?.focus?.(); onClose?.(v); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay); document.body.style.overflow = 'hidden';
  (box.querySelector('[autofocus],input:not([type=hidden]),select,textarea') || box.querySelector('.modal-h button')).focus();
  return { close, el: box };
}

export function confirmDialog({ title, message, confirmLabel = 'تأكيد', danger = false, reason = null }) {
  return new Promise((resolve) => {
    let inputEl;
    const f = reason ? fld({ label: reason.label || 'السبب', name: 'reason', type: 'textarea', required: true }) : null;
    const submit = btn(confirmLabel, { cls: danger ? 'danger' : 'primary', onClick: () => {
      if (f) { const v = f.input.value.trim(); if (!v) { f.setError('هذا الحقل مطلوب'); f.input.focus(); return; } m.close(); resolve(v); } else { m.close(); resolve(true); }
    } });
    const m = modal({ title, size: 'sm', body: [h('p', {}, message), f ? h('div', { style: { marginBlockStart: '12px' } }, f.root) : null],
      footer: [submit, btn('إلغاء', { onClick: () => m.close() })], onClose: (v) => { if (v === undefined) resolve(null); } });
    void inputEl;
  });
}

// ───────── الحقول والنماذج ─────────
let fid = 0;
export function fld({ label, name, type = 'text', value = '', options, required, hint, ltr, placeholder, min, max, step, rows, autocomplete, maxlength, disabled }) {
  const id = `f${++fid}`;
  let input;
  if (type === 'select') {
    input = h('select', { class: 'input', id, name, required, disabled }, (options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  } else if (type === 'textarea') {
    input = h('textarea', { class: 'input', id, name, rows: rows || 3, required, maxlength, disabled, placeholder }, value ?? '');
  } else if (type === 'checkbox') {
    input = h('input', { type: 'checkbox', id, name, checked: !!value, disabled });
    const root = h('div', { class: 'field' }, h('label', { class: 'check', for: id }, input, h('span', {}, label)), hint ? h('span', { class: 'hint' }, hint) : null);
    return { root, input, setError: () => {}, get value() { return input.checked; } };
  } else {
    input = h('input', { class: `input ${ltr ? 'ltr-in' : ''}`, id, name, type, value: value ?? '', required, placeholder, min, max, step, autocomplete: autocomplete || 'off', maxlength, disabled, inputmode: type === 'number' ? 'decimal' : null });
  }
  const err = h('span', { class: 'err', id: id + 'e', role: 'alert' });
  const root = h('div', { class: 'field' }, h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), input, hint ? h('span', { class: 'hint', id: id + 'h' }, hint) : null, err);
  const setError = (msg) => { err.textContent = msg || ''; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (msg) input.setAttribute('aria-describedby', id + 'e'); };
  input.addEventListener('input', () => setError(''));
  return { root, input, setError, get value() { return type === 'checkbox' ? input.checked : input.value; } };
}

/** نافذة نموذج: تعرض أخطاء الخادم تحت الحقول المطابقة بالاسم */
export function formModal({ title, fields, submitLabel = 'حفظ', size = '', intro, onSubmit, extra }) {
  const map = {};
  const formId = 'fm' + Math.random().toString(36).slice(2);
  const form = h('form', { novalidate: true, class: 'grid', id: formId });
  const alertBox = h('div');
  const body = [];
  if (intro) body.push(h('p', { class: 'muted', style: { marginBlockEnd: '12px' } }, intro));
  const submit = h('button', { class: 'btn primary', type: 'submit', form: formId }, submitLabel);
  const render = (items, into) => {
    for (const it of items) {
      if (it instanceof Node) { into.append(it); continue; }
      if (it.group) { const fs = h('fieldset', { class: 'fieldset' }, h('legend', {}, it.group)); const g = h('div', { class: `grid ${it.cols === 1 ? '' : 'g2'}` }); render(it.fields, g); fs.append(g); into.append(fs); continue; }
      const f = fld(it); map[it.name] = f; if (it.wide) f.root.style.gridColumn = '1 / -1'; into.append(f.root);
    }
  };
  render(fields, form);
  if (extra) form.append(extra);
  body.push(alertBox, form);
  const m = modal({ title, size, body, footer: [submit, btn('إلغاء', { onClick: () => m.close() })] });
  const values = () => Object.fromEntries(Object.entries(map).map(([k, f]) => [k, f.value]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.values(map).forEach((f) => f.setError(''));
    clear(alertBox);
    submit.setAttribute('aria-busy', 'true');
    try { await onSubmit(values(), m, map); }
    catch (err) {
      if (err.details && typeof err.details === 'object') {
        let first = null;
        for (const [k, msg] of Object.entries(err.details)) if (map[k]) { map[k].setError(msg); first ||= map[k]; }
        first?.input.focus();
        if (!first) alertBox.append(h('div', { class: 'alert bad', role: 'alert', style: { marginBlockEnd: '12px' } }, icon('alert'), errMsg(err)));
        else alertBox.append(h('div', { class: 'alert bad', role: 'alert', style: { marginBlockEnd: '12px' } }, icon('alert'), errMsg(err)));
      } else alertBox.append(h('div', { class: 'alert bad', role: 'alert', style: { marginBlockEnd: '12px' } }, icon('alert'), errMsg(err)));
    } finally { submit.removeAttribute('aria-busy'); }
  });
  return { m, map, form, values };
}

// ───────── عناصر مشتركة ─────────
export const skeleton = (n = 5) => h('div', { 'aria-busy': 'true', 'aria-label': 'جارٍ التحميل' }, Array.from({ length: n }, (_, i) => h('div', { class: 'skeleton', style: { inlineSize: `${90 - (i % 3) * 18}%` } })));
export const empty = (title, text, action) => h('div', { class: 'empty' }, h('b', {}, title), text ? h('p', {}, text) : null, action ? h('div', { style: { marginBlockStart: '12px' } }, action) : null);
export const errorBox = (e, retry) => h('div', { class: 'panel-b' }, h('div', { class: 'alert bad', role: 'alert' }, icon('alert'), h('div', {}, h('b', {}, 'تعذّر تحميل البيانات'), h('p', {}, errMsg(e)), retry ? h('div', { style: { marginBlockStart: '8px' } }, btn('إعادة المحاولة', { ic: 'refresh', cls: 'sm', onClick: retry })) : null)));

export function pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0, to = Math.min(total, page * pageSize);
  return h('div', { class: 'pager' },
    h('span', {}, `عرض ${fmtInt(from)}–${fmtInt(to)} من ${fmtInt(total)}`),
    h('div', { class: 'actions' },
      btn('السابق', { cls: 'sm', disabled: page <= 1, onClick: () => onPage(page - 1) }),
      h('span', { class: 'num' }, `${page} / ${pages}`),
      btn('التالي', { cls: 'sm', disabled: page >= pages, onClick: () => onPage(page + 1) })));
}

export function sortHeader(label, key, sort, dir, onSort, cls = '') {
  const active = sort === key;
  return h('th', { class: cls, 'aria-sort': active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none' },
    h('button', { type: 'button', onClick: () => onSort(key, active && dir !== 'desc' ? 'desc' : 'asc') }, label));
}

export function menuButton(label, items, { ic = 'more', cls = '' } = {}) {
  const wrap = h('div', { class: 'rel' });
  const pop = h('div', { class: 'menu-pop', role: 'menu', hidden: true });
  const b = h('button', { class: `btn ${cls}`, type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (e) => { e.stopPropagation(); toggle(); } }, icon(ic), label);
  const close = () => { pop.hidden = true; b.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', close); };
  const toggle = () => { if (pop.hidden) { pop.hidden = false; b.setAttribute('aria-expanded', 'true'); document.addEventListener('click', close); pop.querySelector('button')?.focus(); } else close(); };
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); b.focus(); } });
  for (const it of items.filter(Boolean)) pop.append(h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); it.onClick(); } }, it.icon ? icon(it.icon) : null, it.label));
  wrap.append(b, pop);
  return wrap;
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const typeOptions = (all = false, selected) => [{ value: '', label: all ? 'كل الأنواع' : 'اختر النوع' }, ...state.meta.membership_types.filter((t) => t.is_active || String(t.id) === String(selected)).map((t) => ({ value: t.id, label: t.name_ar }))];
export const labelOptions = (map, first) => [{ value: '', label: first }, ...Object.entries(map).map(([value, label]) => ({ value, label }))];
