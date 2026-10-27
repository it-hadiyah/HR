// نافذة المساعد الذكي: اختيار قسم بيانات + نوع الاقتراح، مراجعة النتيجة مع تحذير الأرقام غير الموجودة في البيانات، ثم الإدراج
import { el, btn, modal, toast } from './ui.js';
import { store, emit } from './store.js';
import { upd } from './editors.js';
import * as T from './templates.js';

const DATA_TYPES = ['kpi', 'chart', 'table', 'compare', 'calc', 'progress', 'timeline', 'gantt', 'list'];
const ACTIONS = [['summarize', 'ملخص تنفيذي'], ['analyze', 'تحليل موجز'], ['recommend', 'توصيات']];
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function toHtml(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push('<ul>' + list.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>'); list = []; } };
  lines.forEach((l) => { const m = l.match(/^[-•*]\s+(.*)$/); if (m) list.push(m[1]); else { flush(); out.push(`<p>${esc(l)}</p>`); } });
  flush(); return out.join('');
}

export function aiDialog(target) {
  const secs = store.report.sections.filter((x) => DATA_TYPES.includes(x.type) && x.visible !== false);
  if (!secs.length) { toast('أضف أولاً قسماً يحتوي بيانات (جدول، رسم، مؤشرات...)', { tone: 'err' }); return; }
  const src = el('select', { 'aria-label': 'قسم البيانات' }, secs.map((x) => el('option', { value: x.id }, (x.title || T.BLOCKS[x.type].name) + ' — ' + T.BLOCKS[x.type].name)));
  const act = el('select', { 'aria-label': 'نوع الاقتراح' }, ACTIONS.map(([v, t]) => el('option', { value: v }, t)));
  const out = el('div', { class: 'ai-out' }), warn = el('div', {});
  let last = null;
  const gen = btn('اقتراح', { cls: 'primary', onclick: async () => {
    gen.disabled = true; out.replaceChildren(el('p', { class: 'muted' }, 'جارٍ إعداد المسودة…')); warn.replaceChildren(); ins.disabled = true;
    try {
      const section = store.report.sections.find((x) => x.id === src.value);
      const res = await fetch('/report-builder/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: act.value, title: store.report.title, section }) });
      const o = await res.json().catch(() => ({})); if (!res.ok) throw new Error(o.error || 'تعذر الاقتراح');
      last = o; out.replaceChildren(el('div', { class: 'rt', html: toHtml(o.text) })); ins.disabled = false;
      if (o.unverified.length) warn.replaceChildren(el('p', { class: 'imp-warn' }, '⚠ تحتوي المسودة أرقاماً غير موجودة في بيانات القسم: ' + o.unverified.join('، ') + '. راجعها أو احذفها قبل الاعتماد.'));
      else warn.replaceChildren(el('p', { class: 'imp-ok' }, '✓ كل الأرقام الواردة موجودة في بيانات القسم.'));
    } catch (e) { out.replaceChildren(el('p', { class: 'imp-warn' }, e.message)); } finally { gen.disabled = false; }
  } });
  const ins = btn('إدراج في النص', { cls: 'primary', disabled: true, onclick: () => { if (!last) return; upd(target.id, null, (x) => { x.content = String(x.content || '') + toHtml(last.text); }, 'structure'); m.close(); toast('أُدرجت المسودة، راجعها وعدّلها', { tone: 'ok' }); emit('select'); } });
  const m = modal('اقتراح بالذكاء الاصطناعي', el('div', { class: 'imp' },
    el('p', { class: 'muted' }, 'يُكتب الاقتراح من بيانات القسم المختار فقط، ولا يُضاف شيء من خارجها. هو مسودة تحتاج مراجعتك.'),
    el('div', { class: 'imp-maps' }, el('label', { class: 'imp-map' }, el('span', {}, 'قسم البيانات'), src), el('label', { class: 'imp-map' }, el('span', {}, 'المطلوب'), act)),
    out, warn, el('div', { class: 'dlg-actions' }, btn('إغلاق', { cls: 'ghost', onclick: () => m.close() }), gen, ins)));
}
