// أدوات واجهة مشتركة: بناء العناصر، الإشعارات، نوافذ التأكيد
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

export function btn(label, o = {}) {
  const b = el('button', { type: 'button', class: 'btn ' + (o.cls || ''), title: o.title, 'aria-label': o.aria || o.title || label, onclick: o.onclick, disabled: o.disabled });
  if (o.icon) b.insertAdjacentHTML('beforeend', icon(o.icon, o.size || 16));
  if (label) b.append(el('span', {}, label));
  return b;
}
export const iconBtn = (name, title, onclick, cls = '') => {
  const b = el('button', { type: 'button', class: 'ibtn ' + cls, title, 'aria-label': title, onclick });
  b.innerHTML = icon(name, 16);
  return b;
};

/* ---------- إشعارات غير مزعجة ---------- */
let toastBox;
export function toast(msg, o = {}) {
  if (!toastBox) toastBox = $('#toasts');
  const t = el('div', { class: 'toast ' + (o.tone || ''), role: 'status' }, el('span', {}, msg));
  if (o.action) t.append(btn(o.action.label, { cls: 'sm ghost', onclick: () => { o.action.run(); t.remove(); } }));
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), o.ms || 3200);
  setTimeout(() => t.remove(), (o.ms || 3200) + 400);
}

/* ---------- نافذة تأكيد ---------- */
export function confirmDialog({ title, text, ok = 'تأكيد', cancel = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-t' });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(el('h3', { id: 'dlg-t' }, title), text ? el('p', {}, text) : null,
      el('div', { class: 'dlg-actions' }, btn(cancel, { cls: 'ghost', onclick: () => done(false) }), btn(ok, { cls: danger ? 'danger' : 'primary', onclick: () => done(true) })));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.primary, .danger').focus();
  });
}

export function modal(title, content, o = {}) {
  const dlg = el('dialog', { class: 'dlg wide', 'aria-labelledby': 'dlg-t' });
  const close = () => { dlg.close(); dlg.remove(); if (o.onclose) o.onclose(); };
  dlg.append(el('div', { class: 'dlg-head' }, el('h3', { id: 'dlg-t' }, title), iconBtn('x', 'إغلاق', close)), content);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, dlg };
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- قائمة منبثقة مشتركة (تُستعمل في محرر التقارير ومحرر العروض) ---------- */
export function popupMenu(anchor, items, o = {}) {
  const root = document.getElementById('menu-root') || document.body.appendChild(el('div', { id: 'menu-root' }));
  if (root.firstChild) { root.replaceChildren(); return null; }
  const r = anchor.getBoundingClientRect();
  const close = () => { root.replaceChildren(); document.removeEventListener('click', away, true); };
  const away = (ev) => { if (!m.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) close(); };
  const m = el('div', { class: 'menu', role: 'menu', style: `top:${r.bottom + 6}px;${o.side === 'right' ? `right:${Math.max(8, innerWidth - r.right)}px` : `left:${Math.max(8, r.left)}px`}` });
  items.filter(Boolean).forEach((it) => {
    if (it === 'hr') m.append(el('hr'));
    else if (it.heading) m.append(el('div', { class: 'menu-h', style: 'padding:4px 12px;font-size:12px;color:var(--muted)' }, it.heading));
    else m.append(el('button', { type: 'button', role: 'menuitem', onclick: async () => { close(); try { await it.run(); } catch (e) { toast(e.message || 'تعذر التنفيذ', { tone: 'err' }); } } }, it.icon ? el('span', { html: icon(it.icon, 18) }) : null, el('span', {}, it.label, it.sub ? el('small', {}, it.sub) : null)));
  });
  root.replaceChildren(m);
  requestAnimationFrame(() => { const b = m.getBoundingClientRect(); if (b.bottom > innerHeight - 8) m.style.top = Math.max(8, innerHeight - b.height - 8) + 'px'; m.style.maxHeight = innerHeight - 16 + 'px'; m.style.overflow = 'auto'; });
  setTimeout(() => document.addEventListener('click', away, true), 0);
  return { close };
}
