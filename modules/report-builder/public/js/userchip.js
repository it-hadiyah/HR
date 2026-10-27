// شارة المستخدم في الشريط العلوي: الاسم والدور وقائمة (تغيير كلمة المرور، خروج)
import { el, btn, modal, toast } from './ui.js';

const ROLE = { admin: 'مسؤول', manager: 'مدير', employee: 'موظف' };

export function mountUserChip(host, me) {
  const b = el('button', { type: 'button', class: 'btn ghost sm', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'حسابي' }, me.name + ' · ' + (ROLE[me.role] || ''));
  b.onclick = (e) => {
    const root = document.getElementById('menu-root') || document.body.appendChild(el('div', { id: 'menu-root' }));
    if (root.firstChild) { root.replaceChildren(); return; }
    const r = b.getBoundingClientRect();
    const item = (label, fn) => el('button', { type: 'button', role: 'menuitem', onclick: () => { root.replaceChildren(); fn(); } }, el('span', {}, label));
    const menu = el('div', { class: 'menu', role: 'menu', style: `top:${r.bottom + 6}px;left:${Math.max(8, r.left)}px` },
      el('div', { style: 'padding:8px 12px;color:var(--muted);font-size:var(--fs-1)' }, '@' + me.username + (me.department ? ' · ' + me.department : '')),
      me.canChangePassword ? item('تغيير كلمة المرور', () => changePassword()) : null,
      item('تسجيل الخروج', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/login/'; }));
    root.replaceChildren(menu);
    const close = (ev) => { if (!menu.contains(ev.target) && ev.target !== b) { root.replaceChildren(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };
  host.replaceChildren(b);
}

function changePassword() {
  const cur = el('input', { type: 'password', id: 'cp-c', autocomplete: 'current-password' }), nw = el('input', { type: 'password', id: 'cp-n', autocomplete: 'new-password' });
  const msg = el('p', { role: 'alert', style: 'color:var(--danger);min-height:1.2em' });
  const m = modal('تغيير كلمة المرور', el('div', {}, el('div', { class: 'fld' }, el('label', { for: 'cp-c' }, 'كلمة المرور الحالية'), cur), el('div', { class: 'fld' }, el('label', { for: 'cp-n' }, 'كلمة المرور الجديدة (8 أحرف فأكثر)'), nw), msg,
    el('div', { class: 'dlg-actions' }, btn('حفظ', { cls: 'primary', onclick: async () => {
      const res = await fetch('/report-builder/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: cur.value, next: nw.value }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { msg.textContent = out.error || 'تعذر التغيير'; return; }
      m.close(); toast('تم تغيير كلمة المرور. سجّل الدخول من جديد.', { tone: 'ok' }); setTimeout(() => { location.href = '/login/'; }, 1200);
    } }), btn('إلغاء', { cls: 'ghost', onclick: () => m.close() }))));
  cur.focus();
}
