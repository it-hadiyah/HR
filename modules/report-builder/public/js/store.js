// حالة المحرر: التقرير الحالي + التراجع/الإعادة + الحفظ التلقائي للمسودة + الحفظ على الخادم
import * as T from './templates.js';

const HIST_MAX = 120;
const listeners = new Set();
let past = [], future = [], lastKey = '', lastAt = 0;

export const store = {
  report: null,
  sel: { kind: 'meta', id: null },
  allowed: null,        // أنواع التقارير المسموحة (null = الكل)
  user: '',             // المستخدم الحالي (تُفصل المسودات بين المستخدمين)
  workflow: { status: 'draft' }, access: null,
  serverId: null,       // معرّف التقرير المحفوظ على الخادم
  dirty: false,         // تغييرات لم تُحفظ على الخادم
  savedAt: null,
  draftAt: null,
};

export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (kind = 'content') => listeners.forEach((fn) => fn(kind));
const snap = () => JSON.stringify(store.report);

export function load(report, o = {}) {
  store.report = report;
  store.serverId = o.serverId || null;
  store.workflow = o.workflow || { status: 'draft' }; store.access = o.access || null;
  store.dirty = !!o.dirty;
  store.savedAt = o.savedAt || null;
  store.sel = { kind: 'meta', id: null };
  past = []; future = []; lastKey = '';
  emit('all');
}

/* تعديل التقرير: يحفظ لقطة للتراجع، وتُدمج التعديلات المتتالية بنفس المفتاح (مثل الكتابة) في خطوة واحدة */
export function edit(fn, key, kind = 'content') {
  const now = Date.now();
  if (!key || key !== lastKey || now - lastAt > 900) {
    past.push(snap()); if (past.length > HIST_MAX) past.shift();
    future = [];
  }
  lastKey = key || ''; lastAt = now;
  fn(store.report);
  store.dirty = true;
  scheduleDraft();
  emit(kind);
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export function undo() {
  if (!past.length) return;
  future.push(snap());
  store.report = JSON.parse(past.pop());
  fixSelection(); store.dirty = true; lastKey = ''; scheduleDraft(); emit('all');
}
export function redo() {
  if (!future.length) return;
  past.push(snap());
  store.report = JSON.parse(future.pop());
  fixSelection(); store.dirty = true; lastKey = ''; scheduleDraft(); emit('all');
}
function fixSelection() {
  if (store.sel.kind === 'section' && !store.report.sections.some((s) => s.id === store.sel.id)) store.sel = { kind: 'meta', id: null };
}

export function select(kind, id = null) { store.sel = { kind, id }; emit('select'); }
export const current = () => (store.sel.kind === 'section' ? store.report.sections.find((s) => s.id === store.sel.id) : null);

/* ---------- العمليات على الأقسام ---------- */
export function addSection(type, afterId, title) {
  const s = T.makeSection(type, title || '', { hint: T.BLOCKS[type].desc });
  edit((r) => {
    const i = afterId ? r.sections.findIndex((x) => x.id === afterId) : -1;
    r.sections.splice(i < 0 ? r.sections.length : i + 1, 0, s);
  }, null, 'structure');
  select('section', s.id);
  return s;
}
export function removeSection(id) { edit((r) => { r.sections = r.sections.filter((s) => s.id !== id); }, null, 'structure'); fixSelection(); emit('select'); }
export function duplicateSection(id) {
  let copy;
  edit((r) => {
    const i = r.sections.findIndex((s) => s.id === id); if (i < 0) return;
    copy = JSON.parse(JSON.stringify(r.sections[i])); copy.id = T.uid(); copy.title = copy.title ? copy.title + ' (نسخة)' : '';
    r.sections.splice(i + 1, 0, copy);
  }, null, 'structure');
  if (copy) select('section', copy.id);
}
export function moveSection(id, toIndex) {
  edit((r) => {
    const i = r.sections.findIndex((s) => s.id === id); if (i < 0) return;
    const [s] = r.sections.splice(i, 1);
    r.sections.splice(Math.max(0, Math.min(toIndex, r.sections.length)), 0, s);
  }, null, 'structure');
}
export function toggleSection(id) { edit((r) => { const s = r.sections.find((x) => x.id === id); if (s) s.visible = s.visible === false; }, null, 'structure'); }

/* تغيير القالب مع الاحتفاظ بالمحتوى الحالي */
export function applyTemplate(id) {
  const t = T.byId(id);
  edit((r) => {
    r.template = t.id; r.palette = t.palette;
    r.options.toc = !!t.toc; r.options.closing = !!t.closing; r.options.coverIcon = t.coverIcon || '';
  }, null, 'design');
}

/* ---------- المسودة (localStorage) والحفظ ---------- */
const dk = (id) => 'rb-draft:' + (store.user || '') + ':' + (id || 'new');
const draftKey = () => dk(store.serverId);
let draftTimer;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), report: store.report })); store.draftAt = Date.now(); emit('status'); } catch (e) { /* التخزين غير متاح */ }
  }, 700);
}
export function readDraft(id) { try { return JSON.parse(localStorage.getItem(dk(id))); } catch (e) { return null; } }
export function clearDraft(id) { try { localStorage.removeItem(dk(id)); } catch (e) { /* ignore */ } }

export async function save() {
  const r = store.report;
  if (!String(r.title || '').trim()) { const e = new Error('أدخل عنوان التقرير أولاً'); e.code = 'title'; throw e; }
  const wasNew = !store.serverId;
  const res = await fetch(wasNew ? '/report-builder/api/reports' : '/report-builder/api/reports/' + store.serverId, { method: wasNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'تعذر الحفظ');
  if (wasNew) clearDraft(null);
  store.serverId = out.id; store.report.id = out.id; store.dirty = false; store.savedAt = Date.now(); if (!store.access) store.access = { edit: true, share: true };
  clearDraft(out.id);
  emit('status');
  return out;
}

/* نسبة اكتمال التقرير لعرضها في شريط التقدم */
export function completion() {
  const r = store.report; if (!r) return 0;
  const secs = r.sections.filter((s) => s.type !== 'pagebreak' && s.visible !== false);
  const total = secs.length + 2; // + العنوان + اسم الموظف
  let done = (r.title && r.title.trim() ? 1 : 0) + (r.employee && r.employee.trim() ? 1 : 0);
  done += secs.filter((s) => !isEmpty(s)).length;
  return Math.round((done / total) * 100);
}
export function isEmpty(s) {
  const c = s.content;
  switch (s.type) {
    case 'text': return !String(c || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    case 'list': return !c.items.some((i) => i.trim());
    case 'table': return !c.rows.some((r) => r.some((x) => String(x).trim()));
    case 'kpi': return !c.items.some((k) => k.label || k.value);
    case 'chart': return !c.data.some((d) => d.label || d.value);
    case 'progress': return !c.items.some((i) => i.label || i.value);
    case 'timeline': return !c.items.some((i) => i.title || i.date);
    case 'image': return !c.src;
    case 'gantt': return !c.items.some((i) => i.name && /^\d{4}-\d{2}-\d{2}$/.test(i.start) && /^\d{4}-\d{2}-\d{2}$/.test(i.end));
    case 'calc': return !window.RBC.calcHasInput(c);
    case 'compare': return !window.RBC.compareHasData(c);
    case 'callout': return !String(c.text || '').trim();
    default: return false;
  }
}
