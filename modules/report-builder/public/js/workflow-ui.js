// واجهات سير الاعتماد المشتركة: المشاركة مع المدير، الاعتماد/الإعادة، سجل الإجراءات
import { el, btn, modal, toast } from './ui.js';

export const STATUS = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد', returned: 'معاد للتعديل' };
const ACTIONS = { create: 'إنشاء التقرير', share: 'إرسال للاعتماد', withdraw: 'سحب من الاعتماد', approve: 'اعتماد', return: 'إعادة للتعديل', reopen: 'إعادة فتح', reassign: 'نقل الملكية', archive: 'أرشفة', unarchive: 'إلغاء الأرشفة', snapshot: 'حفظ نسخة', restore: 'استعادة نسخة' };

export const baseOf = (kind) => (kind === 'deck' ? '/report-builder/api/decks/' : '/report-builder/api/reports/');
// مكوّن حالة الاعتماد المشترك (التقارير والعروض)
export const statusChip = (status) => el('span', { class: 'chip-status ' + status }, STATUS[status] || '');

export async function call(id, act, body, kind) {
  const res = await fetch(baseOf(kind) + encodeURIComponent(id) + '/' + act, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'تعذر تنفيذ الإجراء');
  return out;
}

function form(title, fields, okLabel, run, danger) {
  return new Promise((resolve) => {
    let finished = false;
    const msg = el('p', { class: 'dlg-err', role: 'alert', style: 'color:var(--danger);min-height:1.2em;margin:8px 0 0' });
    const ok = btn(okLabel, { cls: danger ? 'danger' : 'primary' });
    const body = el('div', {}, fields, msg, el('div', { class: 'dlg-actions' }, ok, btn('إلغاء', { cls: 'ghost', onclick: () => m.close() })));
    const m = modal(title, body, { onclose: () => { if (!finished) resolve(false); } });
    ok.onclick = async () => {
      ok.disabled = true; msg.textContent = '';
      try { await run(); finished = true; m.close(); resolve(true); } catch (e) { msg.textContent = e.message; ok.disabled = false; }
    };
  });
}

export async function shareDialog(reportId, kind) {
  const res = await fetch('/report-builder/api/managers'); const data = res.ok ? await res.json() : { list: [], restricted: false }; const list = data.list;
  if (!list.length) { toast(data.restricted ? 'المعتمِد المحدد لك غير متاح حالياً. تواصل مع مسؤول النظام.' : 'لا يوجد مدراء مسجّلون. اطلب من مسؤول النظام إضافة مدير.', { tone: 'err', ms: 5000 }); return false; }
  const sel = el('select', { id: 'sh-mgr', 'aria-label': 'المدير' }, list.map((m) => el('option', { value: m.username, selected: m.isMine }, m.name + (m.department ? ' — ' + m.department : ''))));
  if (!list.some((m) => m.isMine)) sel.selectedIndex = 0;
  const note = el('textarea', { rows: 3, id: 'sh-note', placeholder: 'ملاحظة للمدير (اختياري)' });
  return form('إرسال التقرير للاعتماد', [
    el('p', { class: 'muted' }, (data.restricted ? 'المعتمِد المحدد لك من مسؤول النظام. ' : '') + 'بعد الإرسال يصل التقرير للمدير فقط ولا يمكنك تعديله حتى يعيده أو تسحبه. بدون الإرسال لا يوجد اعتماد.'),
    el('div', { class: 'fld' }, el('label', { for: 'sh-mgr' }, 'المدير المعتمِد'), sel), el('div', { class: 'fld' }, el('label', { for: 'sh-note' }, 'ملاحظة'), note)],
  'إرسال للاعتماد', async () => { await call(reportId, 'share', { manager: sel.value, note: note.value }, kind); });
}

export function decideDialog(reportId, decision, kind) {
  const approve = decision === 'approve';
  const note = el('textarea', { rows: 3, id: 'dc-note', placeholder: approve ? 'ملاحظة (اختياري)' : 'اكتب ما المطلوب تعديله' });
  return form(approve ? 'اعتماد التقرير' : 'إعادة التقرير للتعديل', [
    el('p', { class: 'muted' }, approve ? 'سيُختم التقرير بالاعتماد باسمك وتاريخ اليوم، ولن يمكن تعديله بعدها.' : 'سيعود التقرير لصاحبه مع ملاحظتك.'),
    el('div', { class: 'fld' }, el('label', { for: 'dc-note' }, approve ? 'ملاحظة' : 'سبب الإعادة *'), note)],
  approve ? 'اعتماد' : 'إعادة للتعديل', async () => { await call(reportId, approve ? 'approve' : 'return', { note: note.value }, kind); }, !approve);
}

export async function simple(reportId, act, title, text, ok, kind) {
  return form(title, [el('p', { class: 'muted' }, text)], ok, async () => { await call(reportId, act, {}, kind); });
}

export function historyDialog(history) {
  const rows = (history || []).slice().reverse().map((h) => el('li', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' }, el('b', {}, ACTIONS[h.action] || h.action), ' · ', h.byName || h.by, el('small', { class: 'muted', style: 'display:block' }, (h.at || '').replace('T', ' ').slice(0, 16) + (h.note ? ' — ' + h.note : ''))));
  modal('سجل التقرير', el('ul', { style: 'list-style:none;margin:0;padding:0;max-height:55vh;overflow:auto' }, rows.length ? rows : el('li', { class: 'muted' }, 'لا يوجد سجل.')));
}

const fmtT = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const jget = async (u) => { const r = await fetch(u); const o = await r.json().catch(() => ({})); if (!r.ok) throw new Error(o.error || 'تعذر التنفيذ'); return o; };

/* التعليقات: أي شخص يملك صلاحية قراءة التقرير */
export function commentsDialog(reportId, comments, onChange, kind) {
  const list = el('div', { style: 'display:grid;gap:8px;max-height:45vh;overflow:auto;margin-bottom:10px' });
  const draw = (rows) => list.replaceChildren(...(rows.length ? rows.map((c) => el('div', { style: 'border:1px solid var(--border);border-radius:10px;padding:8px 12px' }, el('b', {}, c.byName || c.by), el('small', { class: 'muted', style: 'margin-inline-start:8px' }, fmtT(c.at)), el('p', { style: 'margin:4px 0 0;white-space:pre-wrap' }, c.text))) : [el('p', { class: 'muted' }, 'لا توجد تعليقات بعد.')]));
  draw(comments || []);
  const ta = el('textarea', { rows: 3, placeholder: 'اكتب تعليقاً أو ملاحظة…', 'aria-label': 'تعليق جديد', style: 'width:100%' });
  const send = btn('إضافة تعليق', { cls: 'primary', onclick: async () => {
    try { const o = await call(reportId, 'comment', { text: ta.value }, kind); ta.value = ''; draw(o.comments || []); if (onChange) onChange(o.comments || []); } catch (e) { toast(e.message, { tone: 'err' }); }
  } });
  modal('التعليقات', el('div', {}, list, ta, el('div', { class: 'dlg-actions' }, send)));
}

/* النسخ: عرض الفروق عن الحالي واستعادة نسخة */
export async function versionsDialog(reportId, canRestore, onRestored, kind) {
  const box = el('div', { style: 'display:grid;gap:8px;max-height:55vh;overflow:auto' });
  const CH = { added: 'أُضيف', changed: 'تغيّر', removed: 'حُذف' };
  const META = { title: 'العنوان', subtitle: 'العنوان الفرعي', period: 'الفترة', employee: 'المُعِدّ', department: 'الإدارة', date: 'التاريخ', palette: 'الألوان', template: 'القالب' };
  async function show(v) {
    try {
      const d = (await jget(baseOf(kind) + reportId + '/versions/' + v.n)).diff;
      const items = [...d.meta.map((k) => 'تغيّر: ' + META[k]), ...d.sections.map((x) => CH[x.change] + ': ' + (x.title || x.type))];
      modal('الفروق بين النسخة ' + v.n + ' والحالي', el('div', {}, d.same ? el('p', {}, 'لا توجد فروق: النسخة مطابقة للحالي.') : el('ul', {}, items.map((t) => el('li', {}, t)))));
    } catch (e) { toast(e.message, { tone: 'err' }); }
  }
  let rows = []; try { rows = await jget(baseOf(kind) + reportId + '/versions'); } catch (e) { toast(e.message, { tone: 'err' }); return; }
  const m = modal('نسخ التقرير', el('div', {}, el('p', { class: 'muted' }, 'تُحفظ نسخة تلقائياً عند الإرسال للاعتماد وعند الاعتماد وعند الإعادة. النسخة المعتمدة لا تُحذف تلقائياً.'),
    box, el('div', { class: 'dlg-actions' }, btn('إغلاق', { cls: 'ghost', onclick: () => m.close() }))));
  box.replaceChildren(...(rows.length ? rows.map((v) => el('div', { style: 'border:1px solid var(--border);border-radius:10px;padding:8px 12px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap' },
    el('div', {}, el('b', {}, 'النسخة ' + v.n + ' — ' + v.label), el('div', { class: 'muted', style: 'font-size:13px' }, fmtT(v.at) + ' · ' + (v.byName || '') + ' · ' + (STATUS[v.status] || '') + ' · ' + v.sections + ' قسم')),
    el('div', { class: 'ra' }, btn('الفروق', { cls: 'sm ghost', onclick: () => show(v) }), canRestore ? btn('استعادة', { cls: 'sm', onclick: async () => { try { await call(reportId, 'restore', { n: v.n }, kind); m.close(); toast('تمت استعادة النسخة', { tone: 'ok' }); if (onRestored) onRestored(); } catch (e) { toast(e.message, { tone: 'err' }); } } }) : null))) : [el('p', { class: 'muted' }, 'لا توجد نسخ بعد.')]));
}
