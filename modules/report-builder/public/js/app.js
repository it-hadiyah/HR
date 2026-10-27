// منشئ التقارير: التنسيق بين المعرض والمحرر ولوحاته
import { $, $$, el, btn, iconBtn, toast, confirmDialog, modal, debounce, popupMenu } from './ui.js';
import { icon } from './icons.js';
import * as T from './templates.js';
import * as S from './store.js';
import { store, on, edit, select } from './store.js';
import { sectionEditor, metaEditor, segmented, field, textInput } from './editors.js';
import * as P from './preview.js';
import { buildGallery } from './gallery.js';
import { iconButton } from './iconpicker.js';
import { mountUserChip } from './userchip.js';
import { shareDialog, STATUS } from './workflow-ui.js';

let navTab = 'sections';
let secFilter = '';

/* ---------- تهيئة الأيقونات الثابتة ---------- */
const setIcon = (id, name, label, size = 18) => { const e = $(id); e.innerHTML = icon(name, size) + (label ? `<span>${label}</span>` : ''); };
setIcon('#b-share', 'link', 'إرسال للاعتماد', 16); setIcon('#b-undo', 'undo'); setIcon('#b-redo', 'redo'); setIcon('#b-export', 'download', 'تصدير', 16); setIcon('#b-save', 'save', 'حفظ', 16);
setIcon('#b-help', 'keyboard'); setIcon('#v-prev', 'up'); setIcon('#v-next', 'down'); setIcon('#v-zo', 'zoomout'); setIcon('#v-zi', 'zoomin'); setIcon('#v-focus', 'panel');
$('#nav-tabs [data-tab=sections]').innerHTML = icon('list', 15) + '<span>الأقسام</span>';
$('#nav-tabs [data-tab=library]').innerHTML = icon('plus', 15) + '<span>العناصر</span>';
$('#nav-tabs [data-tab=design]').innerHTML = icon('palette', 15) + '<span>التصميم</span>';

/* ---------- الوضع الفاتح/الداكن ---------- */
function paintTheme() { const dark = document.documentElement.getAttribute('data-theme') === 'dark'; $('#b-theme').innerHTML = icon(dark ? 'sun' : 'moon', 18); }
$('#b-theme').onclick = () => { const dark = document.documentElement.getAttribute('data-theme') === 'dark'; const n = dark ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('rb-theme', n); } catch (e) { /* ignore */ } paintTheme(); };
paintTheme();

/* ---------- الشاشات ---------- */
function showView(name) {
  $('#view-gallery').hidden = name !== 'gallery'; $('#view-editor').hidden = name !== 'editor';
  $('#editor-actions').hidden = name !== 'editor'; $('#top-mid').hidden = name !== 'editor';
  $('#lnk-new').classList.toggle('on', name === 'gallery');
  document.title = name === 'gallery' ? 'منشئ التقارير' : docTitle();
}
const docTitle = () => (store.report && store.report.title ? store.report.title + ' — ' : 'تقرير جديد — ') + 'منشئ التقارير';

function enterEditor(report, o = {}) {
  S.load(report, o);
  renderWf();
  showView('editor');
  $('#panes').dataset.m = 'edit'; $$('.tabs-m button').forEach((b) => b.classList.toggle('on', b.dataset.pane === 'edit'));
  renderAll();
  if (o.focusTitle) setTimeout(() => { const i = $('#editor-body input'); if (i) i.focus(); }, 80);
}

/* ---------- المعرض ---------- */
function startFromTemplate(tpl, sample) {
  const r = T.createReport(tpl.id, { sample });
  enterEditor(r, { dirty: true, focusTitle: true });
  history.replaceState(null, '', '/');
}

async function startFromCustom(t) {
  try {
    const r = await fetch('/report-builder/api/custom-templates/' + t.id); const o = await r.json(); if (!r.ok) throw new Error(o.error || 'تعذر تحميل القالب');
    const rep = o.payload; rep.id = null; rep.date = new Date().toISOString().slice(0, 10);
    enterEditor(rep, { dirty: true, focusTitle: true }); history.replaceState(null, '', '/');
  } catch (e) { toast(e.message, { tone: 'err' }); }
}

function saveAsTemplate() {
  const name = el('input', { type: 'text', value: store.report.title || '', placeholder: 'اسم القالب', 'aria-label': 'اسم القالب' }), desc = el('input', { type: 'text', placeholder: 'وصف مختصر (اختياري)', 'aria-label': 'الوصف' });
  const keep = el('input', { type: 'checkbox' }), shared = el('input', { type: 'checkbox' }), me = store.role;
  const m = modal('حفظ كقالب مخصص', el('div', { class: 'imp' },
    el('p', { class: 'muted' }, 'يُحفظ هيكل التقرير وتصميمه كقالب تعيد استخدامه لاحقاً. تُفرَّغ الأرقام والنصوص افتراضياً وتبقى العناوين والأعمدة.'),
    el('label', { class: 'imp-map' }, el('span', {}, 'اسم القالب *'), name), el('label', { class: 'imp-map' }, el('span', {}, 'الوصف'), desc),
    el('label', { class: 'chk' }, keep, 'الاحتفاظ بالبيانات الحالية كأمثلة'),
    me === 'employee' ? null : el('label', { class: 'chk' }, shared, me === 'admin' ? 'اعتماده كقالب رسمي يراه الجميع' : 'مشاركته مع الجميع'),
    el('div', { class: 'dlg-actions' }, btn('إلغاء', { cls: 'ghost', onclick: () => m.close() }), btn('حفظ القالب', { cls: 'primary', onclick: async () => {
      try {
        const res = await fetch('/report-builder/api/custom-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value, desc: desc.value, keepData: keep.checked, shared: shared.checked, report: store.report }) });
        const o = await res.json().catch(() => ({})); if (!res.ok) throw new Error(o.error || 'تعذر الحفظ');
        m.close(); toast('تم حفظ القالب، ستجده في معرض القوالب', { tone: 'ok' });
      } catch (e) { toast(e.message, { tone: 'err' }); }
    } }))));
}

function draftBanner() {
  const d = S.readDraft(null); const box = $('#draft-banner');
  if (!d || !d.report) { box.hidden = true; return; }
  box.hidden = false; box.replaceChildren(el('span', {}, 'لديك مسودة غير محفوظة: ' + (d.report.title || 'بدون عنوان')),
    btn('متابعة المسودة', { cls: 'sm primary', onclick: () => enterEditor(d.report, { dirty: true }) }),
    btn('تجاهل', { cls: 'sm ghost', onclick: () => { S.clearDraft(null); box.hidden = true; } }));
}

/* ---------- لوحة اليمين: الأقسام / العناصر / التصميم ---------- */
function renderNav() {
  $$('#nav-tabs button').forEach((b) => { const on = b.dataset.tab === navTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  const body = $('#nav-body');
  const scroll = body.scrollTop;
  body.replaceChildren(navTab === 'sections' ? sectionsPanel() : navTab === 'library' ? libraryPanel() : designPanel());
  body.scrollTop = scroll;
}
$$('#nav-tabs button').forEach((b) => (b.onclick = () => { navTab = b.dataset.tab; renderNav(); }));

function sectionsPanel() {
  const r = store.report;
  const wrap = el('div', {});
  wrap.append(el('button', { type: 'button', class: 'meta-item' + (store.sel.kind === 'meta' ? ' on' : ''), onclick: () => select('meta') }, el('span', { class: 'sec-ic', html: icon('file', 16) }), el('span', { class: 'sec-title' }, 'معلومات التقرير'), el('span', { class: 'st ' + (r.title && r.employee ? 'ok' : ''), html: r.title && r.employee ? icon('check', 14) : '' })));
  if (r.sections.length > 6) wrap.append(el('div', { class: 'nav-search' }, el('input', { type: 'search', placeholder: 'ابحث في الأقسام...', value: secFilter, 'aria-label': 'ابحث في الأقسام', oninput: (e) => { secFilter = e.target.value.trim(); renderNav(); const i = $('#nav-body .nav-search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } })));
  const list = el('ul', { class: 'sec-list', role: 'list' });
  const shown = r.sections.map((s, i) => [s, i]).filter(([s]) => !secFilter || (s.title || T.BLOCKS[s.type].name).includes(secFilter));
  shown.forEach(([s, i]) => list.append(secItem(s, i)));
  list.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-rb-type') && !e.target.closest('.sec-item')) e.preventDefault(); });
  list.addEventListener('drop', (e) => { const t = e.dataTransfer.getData('text/x-rb-type'); if (t && !e.target.closest('.sec-item')) { e.preventDefault(); const s = S.addSection(t, r.sections.length ? r.sections[r.sections.length - 1].id : null); toast('تمت إضافة القسم'); } });
  wrap.append(list);
  if (!r.sections.length) wrap.append(el('div', { class: 'empty-state' }, el('span', { html: icon('layout', 30) }), el('b', {}, 'لا توجد أقسام بعد'), el('small', {}, 'أضف أول قسم لتبدأ بناء التقرير.')));
  wrap.append(el('div', { class: 'add-row' }, btn('إضافة قسم', { icon: 'plus', cls: 'primary', onclick: () => { navTab = 'library'; renderNav(); } })));
  return wrap;
}

function secItem(s, i) {
  const info = T.BLOCKS[s.type];
  const empty = S.isEmpty(s) && s.type !== 'pagebreak';
  const li = el('li', { class: 'sec-item' + (store.sel.id === s.id ? ' on' : '') + (s.visible === false ? ' hidden-s' : ''), draggable: 'true', 'data-id': s.id, tabindex: '0', role: 'button', 'aria-label': (s.title || info.name) + (empty ? ' (فارغ)' : '') + (store.sel.id === s.id ? '، محدد' : ''),
    onclick: (e) => { if (!e.target.closest('.sec-actions')) select('section', s.id); },
    onkeydown: (e) => { if (e.target !== li) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select('section', s.id); } else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); S.moveSection(s.id, i - 1); } else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); S.moveSection(s.id, i + 1); } } });
  li.append(el('span', { class: 'grip', html: icon('grip', 14), 'aria-hidden': 'true' }), el('span', { class: 'sec-ic', html: icon(info.icon, 16) }),
    el('span', { class: 'sec-title' }, s.title || info.name),
    el('span', { class: 'st ' + (empty ? '' : 'ok'), html: s.type === 'pagebreak' ? '' : empty ? '○' : icon('check', 14), title: empty ? 'فارغ' : 'مكتمل' }),
    el('span', { class: 'sec-actions' },
      iconBtn('up', 'تحريك لأعلى', () => S.moveSection(s.id, i - 1)), iconBtn('down', 'تحريك لأسفل', () => S.moveSection(s.id, i + 1)),
      iconBtn(s.visible === false ? 'eyeoff' : 'eye', s.visible === false ? 'إظهار القسم' : 'إخفاء القسم', () => S.toggleSection(s.id)),
      iconBtn('copy', 'تكرار القسم', () => { S.duplicateSection(s.id); toast('تم تكرار القسم'); }),
      iconBtn('trash', 'حذف القسم', async () => { if (await confirmDialog({ title: 'حذف القسم؟', text: `سيتم حذف «${s.title || info.name}» مع محتواه. يمكنك التراجع بعدها بـ Ctrl+Z.`, ok: 'حذف', danger: true })) { S.removeSection(s.id); toast('تم حذف القسم', { action: { label: 'تراجع', run: S.undo } }); } }, 'danger')));
  li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-rb-id', s.id); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
  li.addEventListener('dragend', () => { li.classList.remove('dragging'); $$('.drag-over-top,.drag-over-bottom').forEach((x) => x.classList.remove('drag-over-top', 'drag-over-bottom')); });
  li.addEventListener('dragover', (e) => { e.preventDefault(); const r = li.getBoundingClientRect(); const top = e.clientY < r.top + r.height / 2; li.classList.toggle('drag-over-top', top); li.classList.toggle('drag-over-bottom', !top); });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over-top', 'drag-over-bottom'));
  li.addEventListener('drop', (e) => {
    e.preventDefault(); const r = li.getBoundingClientRect(); const top = e.clientY < r.top + r.height / 2; li.classList.remove('drag-over-top', 'drag-over-bottom');
    const ids = store.report.sections.map((x) => x.id); let to = ids.indexOf(s.id) + (top ? 0 : 1);
    const type = e.dataTransfer.getData('text/x-rb-type'), mid = e.dataTransfer.getData('text/x-rb-id');
    if (type) { const n = S.addSection(type, null); S.moveSection(n.id, to); toast('تمت إضافة القسم'); }
    else if (mid) { const from = ids.indexOf(mid); if (from < 0) return; if (from < to) to--; if (from !== to) S.moveSection(mid, to); }
  });
  return li;
}

function libraryPanel() {
  const grid = el('div', { class: 'lib-grid' });
  T.TYPES.forEach((t) => {
    const b = T.BLOCKS[t];
    const it = el('button', { type: 'button', class: 'lib-item', title: 'اضغط لإضافة العنصر', onclick: () => { S.addSection(t, store.sel.kind === 'section' ? store.sel.id : null); toast('تمت إضافة «' + b.name + '»'); navTab = 'sections'; renderNav(); $('#panes').dataset.m = 'edit'; $$('.tabs-m button').forEach((x) => x.classList.toggle('on', x.dataset.pane === 'edit')); } }, el('span', { html: icon(b.icon, 22) }), el('b', {}, b.name), el('small', {}, b.desc));
        grid.append(it);
  });
  return el('div', {}, el('p', { class: 'nav-h' }, 'اختر عنصراً لإضافته بعد القسم الحالي'), grid,
    el('p', { class: 'tip', style: 'margin-top:12px' }, 'سيُضاف العنصر بعد القسم المحدد حالياً، ويمكنك إعادة ترتيبه بالسحب من تبويب «الأقسام».'));
}

function designPanel() {
  const r = store.report, o = r.options;
  const opt = (k, v) => edit((rep) => { rep.options[k] = v; }, 'opt:' + k, 'design');
  const toggle = (label, key, def) => el('label', { class: 'toggle' }, el('span', {}, label), el('input', { type: 'checkbox', checked: o[key] !== undefined ? o[key] : def, onchange: (e) => opt(key, e.target.checked) }));
  const wrap = el('div', {});
  wrap.append(
    el('div', { class: 'dsec' }, el('p', { class: 'nav-h' }, 'القالب'), el('div', { class: 'tpl-list' }, T.TEMPLATES.filter((t) => !store.allowed || store.allowed.includes(t.id) || t.id === r.template).map((t) => el('button', { type: 'button', class: 'tpl-opt' + (t.id === r.template ? ' on' : ''), onclick: async () => { if (t.id === r.template) return; S.applyTemplate(t.id); toast('تم تغيير الشكل مع الاحتفاظ بمحتواك'); } }, el('span', {}, t.name), el('small', {}, t.cover === 'hero' ? 'غلاف كامل' : t.cover === 'band' ? 'غلاف بشريط' : t.cover === 'side' ? 'غلاف جانبي' : t.cover === 'split' ? 'غلاف مائل' : 'غلاف بسيط'))))),
    el('div', { class: 'dsec' }, el('p', { class: 'nav-h' }, 'ألوان التقرير'), el('div', { class: 'swatches' }, Object.entries(T.PALETTES).map(([k, p]) => el('button', { type: 'button', class: 'swb' + (r.palette === k ? ' on' : ''), style: `background:linear-gradient(135deg,${p.a} 55%,${p.x} 55%)`, title: p.name, 'aria-label': p.name, 'aria-pressed': String(r.palette === k), onclick: () => edit((rep) => { rep.palette = k; }, null, 'design') })))),
    el('div', { class: 'dsec' }, el('p', { class: 'nav-h' }, 'الصفحات'), toggle('غلاف', 'cover', true), toggle('فهرس المحتويات', 'toc', false), toggle('صفحة ختامية', 'closing', false), toggle('ترويسة الصفحات', 'header', true), toggle('ترقيم الصفحات', 'pageNumbers', true), toggle('أرقام عربية (٠١٢)', 'arabicDigits', false)),
    el('div', { class: 'dsec' }, el('p', { class: 'nav-h' }, 'أيقونة الغلاف'), el('div', { class: 'cover-icon-row' }, iconButton(o.coverIcon || '', (v) => opt('coverIcon', v), { variant: 'plain', title: 'اختيار أيقونة الغلاف', dialogTitle: 'أيقونة الغلاف' }), el('small', { class: 'muted' }, 'رمز زخرفي كبير على الغلاف'))),
    el('div', { class: 'dsec' }, el('p', { class: 'nav-h' }, 'هوامش الصفحة'), segmented([['narrow', 'ضيقة'], ['normal', 'عادية'], ['wide', 'واسعة']], o.margins || 'normal', (v) => opt('margins', v), 'هوامش الصفحة')),
    el('div', { class: 'dsec' }, field('نص التذييل', textInput(o.footerText || '', (v) => opt('footerText', v), { ph: 'يظهر أسفل كل صفحة' }))));
  return wrap;
}

/* ---------- محرر المحتوى (الوسط) ---------- */
function renderEditor(invalid) {
  const body = $('#editor-body');
  body.replaceChildren();
  const rb = returnedBanner(); if (rb) body.append(rb);
  if (store.sel.kind === 'section') { const s = S.current(); if (s) { body.append(sectionEditor(s), editorFooter(s)); return; } }
  body.append(metaEditor(invalid));
}
function returnedBanner() {
  const w = store.workflow;
  return w && w.status === 'returned' ? el('div', { class: 'hint', role: 'alert', style: 'margin-bottom:12px;border-inline-start-color:var(--danger)' }, el('span', {}, `أعاد ${w.decidedByName || 'المدير'} التقرير للتعديل: ${w.decisionNote || ''}`)) : null;
}
function editorFooter(s) {
  const i = store.report.sections.findIndex((x) => x.id === s.id), secs = store.report.sections;
  return el('div', { class: 'btns', style: 'margin-top:12px;justify-content:space-between' },
    btn('القسم السابق', { icon: 'up', cls: 'ghost sm', disabled: i <= 0, onclick: () => i > 0 ? select(secs[i - 1].type === 'pagebreak' && i > 1 ? 'section' : 'section', secs[i - 1].id) : select('meta') }),
    btn(i >= secs.length - 1 ? 'إضافة قسم جديد' : 'القسم التالي', { icon: i >= secs.length - 1 ? 'plus' : 'down', cls: 'primary sm', onclick: () => { if (i >= secs.length - 1) { navTab = 'library'; renderNav(); } else select('section', secs[i + 1].id); } }));
}

/* ---------- الشريط العلوي ---------- */
function renderStatus() {
  const st = $('#status');
  if (!store.report) return;
  if (store.dirty) { st.className = 'status dirty'; st.textContent = store.draftAt ? 'مسودة محفوظة تلقائياً · لم تُحفظ بعد' : 'تغييرات غير محفوظة'; }
  else { st.className = 'status saved'; st.textContent = 'تم الحفظ' + (store.savedAt ? ' ' + new Date(store.savedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : ''); }
  $('#b-undo').disabled = !S.canUndo(); $('#b-redo').disabled = !S.canRedo();
  const c = S.completion(); $('#pbar').style.width = c + '%'; $('#ptxt').textContent = c + '%';
  document.title = docTitle();
}
function renderWf() {
  const w = store.workflow || { status: 'draft' }, chip = $('#wf-chip');
  chip.textContent = store.serverId ? STATUS[w.status] || '' : ''; chip.className = 'chip-status ' + (w.status || 'draft');
  $('#b-share').hidden = !!(store.access && !store.access.share);
}
function renderAll() { renderNav(); renderEditor(); renderStatus(); P.push(); }

const rerenderNav = debounce(() => { const a = document.activeElement; if (a && a.closest && a.closest('#nav-body')) return; renderNav(); }, 250);
on((kind) => {
  if (!store.report || $('#view-editor').hidden) return;
  if (kind === 'all') renderAll();
  else if (kind === 'select') { renderNav(); renderEditor(); P.highlight(); const a = $('#panes'); if (matchMedia('(max-width: 820px)').matches) { a.dataset.m = 'edit'; $$('.tabs-m button').forEach((x) => x.classList.toggle('on', x.dataset.pane === 'edit')); } }
  else if (kind === 'structure') { renderNav(); renderStatus(); }
  else if (kind === 'design') { renderNav(); renderStatus(); }
  else if (kind === 'titles') { renderStatus(); rerenderNav(); }
  else renderStatus();
  if (kind === 'content') rerenderNav();
});

/* ---------- أزرار الشريط ---------- */
$('#b-undo').onclick = () => S.undo(); $('#b-redo').onclick = () => S.redo();
$('#b-save').onclick = doSave;
$('#b-share').onclick = async () => {
  if (!String(store.report.title || '').trim()) { select('meta'); renderEditor(true); toast('أدخل عنوان التقرير أولاً', { tone: 'err' }); return; }
  if (store.dirty || !store.serverId) { try { const out = await S.save(); history.replaceState(null, '', '/report-builder/?edit=' + out.id); } catch (e) { toast(e.message || 'تعذر الحفظ', { tone: 'err' }); return; } }
  if (await shareDialog(store.serverId)) { S.clearDraft(store.serverId); store.dirty = false; location.href = '/report-builder/reports/' + store.serverId + '.html'; }
};
async function doSave() {
  const b = $('#b-save'); b.disabled = true;
  try {
    const out = await S.save();
    history.replaceState(null, '', '/report-builder/?edit=' + out.id); renderWf();
    toast('تم حفظ التقرير', { tone: 'ok', action: { label: 'فتح', run: () => window.open(out.url, '_blank') } });
  } catch (e) {
    if (e.code === 'title') { select('meta'); renderEditor(true); const i = $('#editor-body input'); if (i) i.focus(); }
    toast(e.message || 'تعذر الحفظ', { tone: 'err' });
  } finally { b.disabled = false; }
}
const fileBase = () => ((store.report.title || 'تقرير').replace(/[\\/:*?"<>|]+/g, ' ').trim() + ' - ' + (store.report.date || new Date().toISOString().slice(0, 10)));

$('#b-export').onclick = (e) => {
  const item = (ic, label, sub, fn) => ({ icon: ic, label, sub, run: fn });
  popupMenu(e.currentTarget, [    item('print', 'طباعة / حفظ PDF', 'بجودة عالية وبصيغة A4، وتُحفظ الألوان والخطوط', () => { const t = document.title; document.title = fileBase(); P.printPreview(); setTimeout(() => { document.title = t; }, 1500); }),
    item('file', 'تنزيل ملف Word ‏(DOCX)', 'ملف قابل للتحرير: عناوين وجداول وصور للرسوم', async () => { try { const m = await import('./docx.js'); await m.exportDocx(store.report, P.config, fileBase(), store.workflow); toast('تم تجهيز ملف Word', { tone: 'ok' }); } catch (err) { toast('تعذر إنشاء ملف Word: ' + err.message, { tone: 'err' }); } }),
    item('layout', 'حفظ كقالب مخصص', 'يعيد استخدام الهيكل والتصميم، ويمكن اعتماده كقالب رسمي', saveAsTemplate),
    'hr',
    item('download', 'نسخة البيانات (JSON)', 'للنسخ الاحتياطي، والمحتوى منفصل عن الشكل', () => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(store.report, null, 2)], { type: 'application/json' })), download: fileBase() + '.json' }); document.body.append(a); a.click(); a.remove(); }),
    store.serverId ? item('link', 'رابط مشاركة', 'رابط بعد الدخول أو بكلمة مرور أو لمستخدمين محددين، مع انتهاء وسجل وصول', async () => { const m = await import('./share-ui.js'); m.openShareDialog({ type: 'report', id: store.serverId, title: store.report.title, warn: store.workflow && store.workflow.status !== 'approved' ? 'هذا التقرير غير معتمد بعد؛ سيرى المستلم ما هو محفوظ حالياً.' : '' }); }) : null,
    store.serverId ? item('link', 'فتح الصفحة النهائية', 'الصفحة المحفوظة على الخادم', () => window.open('/report-builder/reports/' + store.serverId + '.html', '_blank')) : null], { side: 'left' });
};

$('#b-help').onclick = () => {
  const dl = el('dl', { class: 'kbd-list' });
  [['Ctrl + S', 'حفظ التقرير'], ['Ctrl + Z', 'تراجع'], ['Ctrl + Y', 'إعادة'], ['Alt + ↑ / ↓', 'تحريك القسم المحدد (من القائمة)'], ['Ctrl + B / I / U', 'غامق / مائل / تسطير في النصوص'], ['Enter', 'إضافة صف أو نقطة جديدة في آخر خلية'], ['Esc', 'الخروج من وضع المعاينة الكامل']].forEach(([k, v]) => dl.append(el('dt', {}, k), el('dd', {}, v)));
  modal('اختصارات لوحة المفاتيح', dl);
};

/* وحدات التحكم بالمعاينة وأقسام اللوحات */
P.init($('#frame'), { zoomLabel: $('#v-fit'), pageLabel: $('#v-page'), prev: $('#v-prev'), next: $('#v-next') });
$('#v-prev').onclick = () => P.gotoPage(P.pageNow() - 1); $('#v-next').onclick = () => P.gotoPage(P.pageNow() + 1);
$('#v-zi').onclick = () => P.zoomBy(0.1); $('#v-zo').onclick = () => P.zoomBy(-0.1); $('#v-fit').onclick = () => P.zoomFit();
$('#v-focus').onclick = () => { const p = $('#panes'); const on_ = p.dataset.view !== 'focus'; p.dataset.view = on_ ? 'focus' : 'open'; $('#v-focus').setAttribute('aria-pressed', String(on_)); P.zoomFit(); };
$$('.tabs-m button').forEach((b) => (b.onclick = () => { $('#panes').dataset.m = b.dataset.pane; $$('.tabs-m button').forEach((x) => x.classList.toggle('on', x === b)); if (b.dataset.pane === 'view') { setTimeout(() => { P.push(); P.zoomFit(); }, 50); } }));

// أزرار إظهار/إخفاء اللوحات
const navT = iconBtn('panel', 'إظهار/إخفاء لوحة الأقسام', () => { const p = $('#panes'); p.dataset.nav = p.dataset.nav === 'closed' ? 'open' : 'closed'; navT.setAttribute('aria-pressed', String(p.dataset.nav === 'closed')); setTimeout(P.zoomFit, 50); });
const viewT = iconBtn('eye', 'إظهار/إخفاء المعاينة', () => { const p = $('#panes'); p.dataset.view = p.dataset.view === 'closed' ? 'open' : 'closed'; viewT.setAttribute('aria-pressed', String(p.dataset.view === 'closed')); setTimeout(P.zoomFit, 50); });
navT.classList.add('pane-toggle'); viewT.classList.add('pane-toggle');
$('#editor-actions').prepend(navT, viewT);

/* ---------- اختصارات لوحة المفاتيح ---------- */
// حرف المفتاح الفعلي بغضّ النظر عن لغة لوحة المفاتيح (عربي/إنجليزي)
const kc = (e) => (/^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase());
document.addEventListener('keydown', (e) => {
  if ($('#view-editor').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && kc(e) === 's') { e.preventDefault(); doSave(); }
  else if (mod && kc(e) === 'z' && !e.shiftKey) { if (document.activeElement && document.activeElement.closest('.rte')) return; e.preventDefault(); S.undo(); }
  else if (mod && (kc(e) === 'y' || (kc(e) === 'z' && e.shiftKey))) { if (document.activeElement && document.activeElement.closest('.rte')) return; e.preventDefault(); S.redo(); }
  else if (e.key === 'Escape' && $('#panes').dataset.view === 'focus') { $('#v-focus').click(); }
});
window.addEventListener('beforeunload', (e) => { if (store.report && store.dirty && !$('#view-editor').hidden) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- البدء ---------- */
(async function boot() {
  const meRes = await fetch('/report-builder/api/me'); if (!meRes.ok) return;
  const me = await meRes.json(); store.user = me.username; store.role = me.role; store.allowed = me.allowedTemplates;
  mountUserChip($('#user-chip'), me);
  if (me.role === 'admin') $('#admin-link').hidden = false;
  if (me.inbox) { const l = $('#lnk-list'); l.textContent = `التقارير (${me.inbox})`; l.title = 'لديك تقارير بانتظار الاعتماد'; l.href = '/report-builder/list.html?scope=inbox'; }
  await P.loadConfig();
  $('#orgname').textContent = P.config.orgName || '';
  buildGallery($('#gallery-root'), startFromTemplate, me.allowedTemplates, startFromCustom);
  draftBanner();
  const id = new URLSearchParams(location.search).get('edit');
  if (id) {
    showView('editor'); $('#editor-body').replaceChildren(el('div', { class: 'skel', style: 'height:300px;border-radius:14px;position:relative' }));
    try {
      const res = await fetch('/report-builder/api/reports/' + encodeURIComponent(id)); if (!res.ok) throw new Error('التقرير غير موجود');
      const r = await res.json();
      if (!r.access || !r.access.edit) { location.replace('/report-builder/reports/' + encodeURIComponent(id) + '.html'); return; }
      let report = T.migrate(r); report.id = id;
      const d = S.readDraft(id);
      let dirty = false;
      if (d && d.report && d.at > Date.parse(r.updatedAt || 0) && await confirmDialog({ title: 'استعادة المسودة؟', text: 'وجدنا تعديلات غير محفوظة أحدث من النسخة المحفوظة على الخادم.', ok: 'استعادة المسودة', cancel: 'استخدام المحفوظ' })) { report = d.report; dirty = true; }
      enterEditor(report, { serverId: id, dirty, workflow: r.workflow, access: r.access, savedAt: Date.parse(r.updatedAt || 0) || null });
    } catch (e) { showView('gallery'); toast(e.message || 'تعذر فتح التقرير', { tone: 'err' }); history.replaceState(null, '', '/'); }
  } else showView('gallery');
})();
