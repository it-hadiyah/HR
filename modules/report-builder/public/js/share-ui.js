// نافذة روابط المشاركة: إنشاء رابط (بعد الدخول / مستخدمون محددون / كلمة مرور)، انتهاء، منع الطباعة، إلغاء، سجل الوصول
import { el, btn, modal, toast } from './ui.js';

const MODE_NAMES = { login: 'لأي مستخدم مسجّل الدخول', users: 'لمستخدمين محددين', password: 'بكلمة مرور' };
const STATE = { active: 'فعّال', expired: 'منتهي', revoked: 'ملغى' };
const fmt = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const j = async (url, opt) => { const r = await fetch(url, opt); const o = await r.json().catch(() => ({})); if (!r.ok) throw new Error(o.error || 'تعذر التنفيذ'); return o; };
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

export function openShareDialog({ type, id, title, warn }) {
  const list = el('div', { class: 'sh-list' });
  const full = (u) => location.origin + u;
  const copy = async (u) => { try { await navigator.clipboard.writeText(full(u)); toast('تم نسخ الرابط', { tone: 'ok' }); } catch (e) { prompt('انسخ الرابط:', full(u)); } };

  async function refresh() {
    let rows = []; try { rows = await j(`/report-builder/api/shares?type=${type}&id=${encodeURIComponent(id)}`); } catch (e) { list.replaceChildren(el('p', { class: 'muted' }, e.message)); return; }
    list.replaceChildren(rows.length ? el('h4', {}, 'الروابط الحالية') : el('p', { class: 'muted' }, 'لا توجد روابط بعد.'),
      ...rows.map((s) => el('div', { class: 'sh-row ' + s.state },
        el('div', {}, el('b', {}, MODE_NAMES[s.mode]), el('span', { class: 'chip-status ' + (s.state === 'active' ? 'approved' : 'returned'), style: 'margin-inline-start:8px' }, STATE[s.state]),
          el('div', { class: 'muted', style: 'font-size:13px' }, `أُنشئ ${fmt(s.createdAt)} · المشاهدات ${s.views}` + (s.expiresAt ? ` · ينتهي ${fmt(s.expiresAt)}` : ' · بلا انتهاء') + (s.noPrint ? ' · بلا طباعة' : '') + (s.mode === 'users' ? ` · ${s.users.length} مستخدم` : '')),
          el('code', { dir: 'ltr', style: 'font-size:12px;word-break:break-all' }, full(s.url))),
        el('div', { class: 'ra' }, btn('نسخ', { cls: 'sm', onclick: () => copy(s.url) }), btn('السجل', { cls: 'sm ghost', onclick: () => logDialog(s) }),
          s.state === 'active' ? btn('إلغاء', { cls: 'sm ghost', onclick: async () => { await post('/report-builder/api/shares/' + s.token + '/revoke'); toast('تم إلغاء الرابط'); refresh(); } }) : null,
          btn('حذف', { cls: 'sm ghost', onclick: async () => { await j('/report-builder/api/shares/' + s.token, { method: 'DELETE' }); refresh(); } })))));
  }

  async function logDialog(s) {
    const rows = await j('/report-builder/api/shares/' + s.token + '/log').catch(() => []);
    modal('سجل الوصول', el('div', {}, rows.length ? el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, ['الوقت', 'المستخدم', 'العنوان', 'النتيجة'].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, el('td', {}, fmt(r.at)), el('td', {}, r.user), el('td', { dir: 'ltr' }, r.ip || ''), el('td', {}, (r.ok ? '✓ ' : '✗ ') + (r.note || '')))))) : el('p', { class: 'muted' }, 'لا توجد زيارات بعد.')));
  }

  const mode = el('select', { 'aria-label': 'نوع الرابط' }, Object.entries(MODE_NAMES).map(([k, v]) => el('option', { value: k }, v)));
  const pw = el('input', { type: 'text', placeholder: 'كلمة المرور (4 أحرف فأكثر)', autocomplete: 'off', 'aria-label': 'كلمة المرور' });
  const usersBox = el('div', { class: 'sh-users', hidden: true });
  const exp = el('select', { 'aria-label': 'مدة الصلاحية' }, [['0', 'بلا انتهاء'], ['1', 'يوم واحد'], ['7', '7 أيام'], ['30', '30 يوماً'], ['90', '90 يوماً']].map(([v, t]) => el('option', { value: v }, t)));
  const noPrint = el('input', { type: 'checkbox' });
  let users = null;
  const sync = async () => {
    pw.hidden = mode.value !== 'password'; usersBox.hidden = mode.value !== 'users';
    if (mode.value === 'users' && !users) {
      users = await j('/report-builder/api/users-lite').catch(() => []);
      usersBox.replaceChildren(el('input', { type: 'search', placeholder: 'ابحث عن مستخدم…', 'aria-label': 'بحث', oninput: (e) => usersBox.querySelectorAll('label').forEach((l) => { l.hidden = !l.textContent.includes(e.target.value); }) }),
        ...users.map((u) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', value: u.username }), u.name + (u.department ? ' · ' + u.department : ''))));
    }
  };
  mode.onchange = sync; sync();
  const create = btn('إنشاء رابط', { cls: 'primary', onclick: async () => {
    try {
      const body = { type, id, mode: mode.value, expiresDays: exp.value, noPrint: noPrint.checked, password: pw.value, users: Array.from(usersBox.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value) };
      const s = await post('/report-builder/api/shares', body); await copy(s.url); pw.value = ''; refresh();
    } catch (e) { toast(e.message, { tone: 'err' }); }
  } });
  modal('مشاركة: ' + (title || ''), el('div', { class: 'sh' },
    warn ? el('p', { class: 'imp-warn' }, '⚠ ' + warn) : null,
    el('div', { class: 'fld' }, el('label', {}, 'من يستطيع الفتح؟'), mode), pw, usersBox,
    el('div', { class: 'fld' }, el('label', {}, 'مدة صلاحية الرابط'), exp),
    el('label', { class: 'chk' }, noPrint, 'منع الطباعة وحفظ PDF من صفحة الرابط'),
    el('p', { class: 'muted', style: 'font-size:12px' }, 'منع الطباعة يقلل النسخ العفوي فقط ولا يمنع لقطة الشاشة. تُسجَّل كل زيارة في سجل الوصول.'),
    el('div', { class: 'dlg-actions' }, create), list));
  refresh();
}
