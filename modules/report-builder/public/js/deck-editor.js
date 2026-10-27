// محرر العروض التقديمية: شرائح مصغّرة + لوحة معاينة + خصائص الشريحة، مع تراجع/إعادة وحفظ تلقائي
import { el, btn, toast, confirmDialog, modal, popupMenu } from './ui.js';
import { store, load, edit, on, undo, redo, canUndo, canRedo } from './store.js';
import { sectionEditor, field, textInput, segmented, fileToDataUrl } from './editors.js';
import { initCanvas, getPath, setPath } from './deck-canvas.js';
import { mountUserChip } from './userchip.js';
import { loadIndicators, getIndicatorMap } from './indicators-cache.js';
import { shareDialog } from './workflow-ui.js';

const D = window.RBD, T = window.RBT, S = window.RBS;
const $ = (id) => document.getElementById(id);
let cfg = {}, cur = 0, serverId = null, saveTimer = null, saving = false, selEid = null, zoomF = 1, curScale = 1, canvas = null;
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; };

const deck = () => store.report;
const slideAt = (r, i) => r.slides[i];
const curSlide = () => deck().slides[cur];
const BLOCK_NAMES = { kpi: 'مؤشرات رئيسية', chart: 'رسم بياني', table: 'جدول', compare: 'مقارنة بين فترتين', calc: 'عملية حسابية', progress: 'نسب إنجاز', timeline: 'خط زمني', gantt: 'مخطط جانت', image: 'صورة', callout: 'ملاحظة', list: 'قائمة', text: 'نص' };

/* ---------- العرض ---------- */
// ذاكرة مؤقتة للرسم: مفتاح مختصر (الصور الكبيرة تُختزل إلى طولها وذيلها) فلا يُعاد رسم الشرائح غير المتغيّرة
const memo = new Map();
const sigRep = (k, v) => (typeof v === 'string' && v.length > 2000 ? v.length + ':' + v.slice(-20) : v);
function slideHtml(i, thumb) {
  const d = deck(), s = d.slides[i];
  const key = JSON.stringify([s, D.blocksOf(d, s), (s.extra || []).map((x) => x.blockId && (d.sections.find((b) => b.id === x.blockId) || null)), d.ratio, d.palette, d.options, d.presenter, d.date, d.sample, d.slides.length, i, !!thumb, thumb ? 0 : 1], sigRep);
  let h = memo.get(key);
  if (h == null) { h = D.renderSlide(d, s, { config: cfg, preview: true, thumb: !!thumb, index: i, total: d.slides.length, indicators: getIndicatorMap() }); if (memo.size > 400) memo.clear(); memo.set(key, h); }
  return h;
}

const ctxOf = () => ({ config: cfg, preview: true, indicators: getIndicatorMap() });
function renderStage() {
  const d = deck(), rt = D.RATIOS[d.ratio] || D.RATIOS['16:9'], host = $('dk-canvas');
  const avail = Math.max(300, host.clientWidth - 36), availH = Math.max(240, host.clientHeight - 150);
  const k = Math.min(avail / rt.w, availH / rt.h, 1.3) * zoomF; curScale = k;
  const st = $('dk-stage');
  st.setAttribute('style', `${D.rootStyle(d)};width:${rt.w * k}px;height:${rt.h * k}px`);
  st.innerHTML = slideHtml(cur);
  const s = st.querySelector('.slide'); if (s) s.style.transform = `scale(${k})`;
  $('zoom-pct').textContent = Math.round(k * 100) + '%';
  if (canvas) canvas.drawSel();
}

function renderThumbs() {
  const d = deck(), rt = D.RATIOS[d.ratio] || D.RATIOS['16:9'], W = 180, k = W / rt.w, box = $('dk-thumbs');
  const keep = box.scrollTop;
  box.replaceChildren(el('div', { class: 'dk-tools' },
    btn('+ شريحة', { cls: 'sm primary', onclick: addMenu }), btn('نسخ', { cls: 'sm ghost', onclick: dupSlide }), btn('حذف', { cls: 'sm ghost', onclick: delSlide }),
    btn('▲', { cls: 'sm ghost', title: 'تحريك لأعلى', onclick: () => moveSlide(cur, cur - 1) }), btn('▼', { cls: 'sm ghost', title: 'تحريك لأسفل', onclick: () => moveSlide(cur, cur + 1) })));
  d.slides.forEach((s, i) => {
    const t = el('div', { class: 'dk-th' + (i === cur ? ' on' : ''), draggable: 'true', tabindex: '0', role: 'button', 'aria-label': 'الشريحة ' + (i + 1) + ': ' + (s.title || D.layoutName(s.layout)), style: `${D.rootStyle(d)};width:${W}px;height:${rt.h * k}px`,
      onclick: () => select(i),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } },
      ondragstart: (e) => { e.dataTransfer.setData('text/x-dk', String(i)); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-dk')) { e.preventDefault(); t.classList.add('over'); } },
      ondragleave: () => t.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); t.classList.remove('over'); const from = parseInt(e.dataTransfer.getData('text/x-dk'), 10); if (!isNaN(from)) moveSlide(from, i); } });
    t.append(el('span', { class: 'n' }, String(i + 1)));
    const inner = el('div', { class: 'in' });
    const fill = () => { inner.innerHTML = slideHtml(i, true); const sl = inner.firstElementChild; if (sl) { sl.style.transform = `scale(${k})`; sl.style.position = 'absolute'; sl.style.top = '0'; sl.style.right = '0'; } };
    if (i === cur || d.slides.length <= 8) fill(); else { const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { io.disconnect(); fill(); } }, { root: box, rootMargin: '300px' }); io.observe(t); }
    t.append(inner); box.append(t);
  });
  box.scrollTop = keep;
}

/* ---------- لوحة الخصائص ---------- */
function slideField(id, fn, key) { edit((r) => { const s = r.slides.find((x) => x.id === id); if (s) fn(s); }, key + id, 'content'); }

/* ---------- أدوات مساعدة للعناصر ---------- */
const elementsNow = () => D.elementsOf(deck(), curSlide(), ctxOf());
const findEl = (id) => elementsNow().find((e) => e.id === id);
const numField = (label, value, onChange, o = {}) => el('label', { class: 'f' }, el('span', {}, label), el('input', { type: 'number', value: Math.round(value), min: o.min, max: o.max, step: o.step || 1, onchange: (e) => onChange(+e.target.value) }));
const rangeField = (label, value, min, max, step, onInput) => el('label', { class: 'f' }, el('span', {}, label + ': ' + value), el('input', { type: 'range', min, max, step, value, oninput: (e) => { e.target.previousSibling.textContent = label + ': ' + e.target.value; onInput(+e.target.value); } }));
function elementLabel(e) {
  if (e.type === 'photo') return e.extra ? 'صورة حرة' : 'صورة ' + ((e.pi || 0) + 1);
  if (e.type === 'text') return 'نص: ' + (String(e.text || e.ph || '').slice(0, 18) || 'فارغ');
  if (e.type === 'rect') return e.shape === 'ellipse' ? 'دائرة' : 'شكل';
  if (e.type === 'img') return /logo/i.test(e.kind) ? 'الشعار' : 'زخرفة';
  if (e.type === 'block') return 'قسم بيانات';
  return e.type;
}
const slideCommit = (fn, key) => edit((r) => { const s = r.slides[cur]; if (s) fn(s); }, key, 'content');
function setRect(id, patch) { slideCommit((sl) => { const ex = (sl.extra || []).find((x) => x.id === id), e = findEl(id), base = { x: e.x, y: e.y, w: e.w, h: e.h }; if (ex) Object.assign(ex, patch); else { sl.ov = sl.ov || {}; sl.ov[id] = Object.assign(base, sl.ov[id] || {}, patch); } }, 'rc' + id); }
function setSty(id, patch) { slideCommit((sl) => { sl.sty = sl.sty || {}; sl.sty[id] = Object.assign({}, sl.sty[id] || {}, patch); }, 'sty' + id); }
function resetElement(id) { slideCommit((sl) => { if (sl.ov) delete sl.ov[id]; if (sl.sty) delete sl.sty[id]; }, null); renderProps(); }
function resetFormatting() {
  edit((r) => { const s = r.slides[cur]; s.ov = {}; s.sty = {}; (s.photos || []).forEach((p, i) => { if (p) { Object.assign(p, { x: 50, y: 40, scale: 1 }); delete p.ov; } }); (s.extra || []).forEach((e) => { if (e.photo) { Object.assign(e.photo, { x: 50, y: 40, scale: 1 }); } }); }, null, 'structure');
  toast('استُعيد التنسيق الأصلي للشريحة', { tone: 'ok' }); renderProps();
}
function changeLayout(l) {
  edit((r) => {
    const s = r.slides[cur], def = S.LAYOUTS[l] || D.LAYOUTS[l];
    if (S.LAYOUTS[l] && def.items && !(s.items || []).length && (s.bullets || []).length) s.items = s.bullets.map((t) => ({ t, d: '', v: '' }));
    s.layout = l; s.bg = def.bg; s.ov = {}; s.sty = {};
  }, null, 'structure');
  select(cur);
}
function removeExtra(id) { slideCommit((sl) => { sl.extra = (sl.extra || []).filter((x) => x.id !== id); }, null); selEid = null; renderProps(); renderStage(); renderThumbs(); }
function moveExtra(id, d) { slideCommit((sl) => { const a = sl.extra || [], i = a.findIndex((x) => x.id === id), j = i + d; if (i >= 0 && j >= 0 && j < a.length) a.splice(j, 0, a.splice(i, 1)[0]); }, null); renderProps(); }
function addExtra(type, blockType) {
  const rt = D.RATIOS[deck().ratio] || D.RATIOS['16:9']; let nid = '';
  edit((r) => {
    const s = r.slides[cur]; const opt = {};
    if (type === 'block') { const b = T.makeSection(blockType, '', {}); b.hint = ''; r.sections.push(b); opt.blockId = b.id; }
    const e = S.newExtra(type, rt.w, rt.h, opt); nid = e.id; s.extra = (s.extra || []).concat([e]);
  }, null, 'structure');
  select(cur); canvas.select(nid); selEid = nid; renderProps();
  if (type === 'photo') pickPhoto(nid);
}

/* ---------- الصور: رفع واستبدال وتعديل بلا إتلاف الأصل ---------- */
// نسخة مصغّرة خفيفة للشرائح المصغّرة حتى لا تُفكّ الصور الكبيرة عشرات المرات
async function makeThumb(url) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 360 / img.naturalWidth), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', 0.68); return out.length < 90000 ? out : '';
  } catch (e) { return ''; }
}
function pickPhoto(eid) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const url = await fileToDataUrl(f, 1400, 0.78);
      const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ nw: i.naturalWidth, nh: i.naturalHeight }); i.onerror = () => res({ nw: 0, nh: 0 }); i.src = url; });
      const th = await makeThumb(url);
      canvas.patchPhoto(eid, Object.assign({ src: url, th, x: 50, y: 40, scale: 1 }, dim)); // عند الاستبدال يبقى التدرج والإعدادات كما هي
      toast('تم تطبيق الصورة مع التدرج الرسمي', { tone: 'ok' }); renderProps();
    } catch (err) { toast(err.message || 'تعذّر رفع الصورة', { tone: 'err' }); }
  };
  inp.click();
}
const photoPatch = (eid, patch, key) => canvas.patchPhoto(eid, patch);
function ovPatch(eid, patch) { const e = findEl(eid); photoPatch(eid, { ov: Object.assign({}, e.photo.ov, patch) }); }
function photoCard(e) {
  const p = e.photo, ov = p.ov, def = e.extra ? { dir: 'right' } : (S.LAYOUTS[curSlide().layout].photos || [])[e.pi] || {};
  const sel = selEid === e.id;
  const card = el('div', { class: 'dk-card' + (sel ? ' sel' : '') },
    el('div', { class: 'dk-photo-row' }, el('div', { class: 'th', style: p.src ? `background-image:url(${p.th || p.src})` : '' }), el('div', {}, el('b', {}, elementLabel(e)), el('div', { class: 'btns' }, btn(p.src ? 'استبدال الصورة' : 'رفع صورة', { cls: 'sm primary', onclick: () => pickPhoto(e.id) }), p.src ? btn('إزالة', { cls: 'sm ghost', onclick: () => { photoPatch(e.id, { src: '', th: '', nw: 0, nh: 0 }); renderProps(); } }) : null, !sel ? btn('تحديد', { cls: 'sm ghost', onclick: () => { canvas.select(e.id); } }) : null))));
  if (sel || p.src) {
    const body = el('div', { style: 'margin-top:8px;display:grid;gap:8px' },
      btn('تطبيق التدرج الرسمي لهدية', { cls: 'sm dk-offbtn', onclick: () => { photoPatch(e.id, { ov: S.officialOverlay(def.dir) }); renderProps(); } }),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: ov.on !== false, onchange: (x) => { ovPatch(e.id, { on: x.target.checked }); renderProps(); } }), 'إظهار التدرج فوق الصورة'));
    if (ov.on !== false) {
      body.append(
        el('div', { class: 'dk-grid2' }, el('label', { class: 'f' }, el('span', {}, 'لون التدرج'), el('input', { type: 'color', value: ov.color || '#005a52', onchange: (x) => ovPatch(e.id, { color: x.target.value }) })),
          el('label', { class: 'f' }, el('span', {}, 'الاتجاه (الجهة الكثيفة)'), el('select', { onchange: (x) => ovPatch(e.id, { dir: x.target.value }) }, Object.entries(S.DIRS).map(([k, v]) => el('option', { value: k, selected: ov.dir === k }, v))))),
        rangeField('الشفافية (الكثافة)', Math.round(ov.from * 100), 0, 100, 1, (v) => ovPatch(e.id, { from: v / 100 })),
        rangeField('منتصف التدرج', Math.round(ov.mid * 100), 0, 100, 1, (v) => ovPatch(e.id, { mid: v / 100 })),
        rangeField('نهاية التدرج', Math.round(ov.to * 100), 0, 100, 1, (v) => ovPatch(e.id, { to: v / 100 })));
    }
    if (p.src) body.append(
      el('div', { class: 'dk-grid2' }, rangeField('نقطة التركيز أفقياً', p.x, 0, 100, 1, (v) => photoPatch(e.id, { x: v })), rangeField('نقطة التركيز رأسياً', p.y, 0, 100, 1, (v) => photoPatch(e.id, { y: v }))),
      rangeField('تكبير الصورة', p.scale, 1, 4, 0.05, (v) => photoPatch(e.id, { scale: v })),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: p.fit === 'contain', onchange: (x) => { photoPatch(e.id, { fit: x.target.checked ? 'contain' : 'cover' }); } }), 'احتواء كامل الصورة (للشعارات) بدل التغطية'),
      btn('استعادة إعدادات الصورة', { cls: 'sm ghost', onclick: () => { photoPatch(e.id, { x: 50, y: 40, scale: 1, ov: Object.assign(S.officialOverlay(def.dir), def.ov || {}) }); renderProps(); } }));
    card.append(body);
  }
  return card;
}
function itemsEditor(s, L) {
  const wrap = el('div', {}); const fields = L.items.fields, names = { t: 'العنوان', d: 'الوصف', v: 'القيمة' };
  (s.items || []).forEach((it, i) => wrap.append(el('div', { class: 'dk-items-row' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, el('b', {}, '#' + (i + 1)), btn('✕', { cls: 'sm ghost', onclick: () => { slideCommit((sl) => sl.items.splice(i, 1), null); renderProps(); renderStage(); renderThumbs(); } })),
    ...fields.map((f) => el('label', { class: 'f' }, el('span', {}, names[f]), f === 'd' ? el('textarea', { rows: 2, dir: 'auto', oninput: (e) => slideCommit((sl) => { sl.items[i][f] = e.target.value; }, 'it' + i + f) }, it[f] || '') : el('input', { type: 'text', dir: 'auto', value: it[f] || '', oninput: (e) => slideCommit((sl) => { sl.items[i][f] = e.target.value; }, 'it' + i + f) }))))));
  if ((s.items || []).length < L.items.max) wrap.append(btn('+ إضافة عنصر', { cls: 'sm ghost', onclick: () => { slideCommit((sl) => { sl.items = sl.items || []; sl.items.push({ t: '', d: '', v: '' }); }, null); renderProps(); renderStage(); renderThumbs(); } }));
  return wrap;
}
function selectionPanel(e) {
  const rc = el('div', { class: 'dk-grid2' }, numField('س (X)', e.x, (v) => setRect(e.id, { x: v })), numField('ص (Y)', e.y, (v) => setRect(e.id, { y: v })), numField('العرض', e.w, (v) => setRect(e.id, { w: Math.max(10, v) })), numField('الارتفاع', e.h, (v) => setRect(e.id, { h: Math.max(10, v) })));
  const card = el('div', { class: 'dk-card sel' }, el('b', {}, 'العنصر المحدد: ' + elementLabel(e)), rc);
  if (e.type === 'text') {
    const COL = { 'أبيض': '#ffffff', 'ذهبي': S.GOLD, 'أخضر': '#005a52', 'داكن': '#17302c' };
    card.append(
      e.field ? el('label', { class: 'f' }, el('span', {}, 'النص'), el('textarea', { rows: 3, dir: 'auto', oninput: (x) => slideCommit((sl) => setPath(sl, e.field, x.target.value), 'tx' + e.id) }, getPath(curSlide(), e.field))) : null,
      el('div', { class: 'dk-grid2' }, el('label', { class: 'f' }, el('span', {}, 'لون النص (تباين)'), el('select', { onchange: (x) => setSty(e.id, { color: x.target.value }) }, el('option', { value: '' }, 'تلقائي'), Object.entries(COL).map(([k, v]) => el('option', { value: v, selected: e.color === v }, k)))),
        numField('حجم الخط (٠ = تلقائي)', (curSlide().sty && curSlide().sty[e.id] && curSlide().sty[e.id].size) || 0, (v) => setSty(e.id, { size: v }), { min: 0, max: 200 })),
      el('label', { class: 'f' }, el('span', {}, 'المحاذاة'), el('select', { onchange: (x) => setSty(e.id, { align: x.target.value }) }, [['', 'تلقائي'], ['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([v, t]) => el('option', { value: v }, t)))));
  }
  if (e.type === 'rect') card.append(el('label', { class: 'f' }, el('span', {}, 'اللون'), el('input', { type: 'color', value: /^#/.test(e.fill) ? e.fill : '#007f73', onchange: (x) => (e.extra ? slideCommit((sl) => { (sl.extra.find((q) => q.id === e.id) || {}).fill = x.target.value; }, 'fl' + e.id) : setSty(e.id, { fill: x.target.value })) })));
  if (e.type === 'block') { const b = (deck().sections || []).find((q) => q.id === e.blockId); if (b) card.append(sectionEditor(b)); }
  card.append(el('div', { class: 'btns' }, btn('إعادة الموضع والتنسيق', { cls: 'sm ghost', onclick: () => resetElement(e.id) }), e.extra ? btn('حذف العنصر', { cls: 'sm ghost', onclick: () => removeExtra(e.id) }) : null));
  return card;
}

function renderProps() {
  const d = deck(), s = curSlide(), box = $('dk-props');
  if (!s) { box.replaceChildren(); return; }
  const official = S.isOfficial(s.layout), L = S.LAYOUTS[s.layout], blks = D.blocksOf(d, s);
  const els = elementsNow(), fields = new Set(els.map((e) => e.field).filter(Boolean));
  const layoutSel = el('select', { 'aria-label': 'تخطيط الشريحة', onchange: (e) => changeLayout(e.target.value) },
    el('optgroup', { label: 'شرائح هدية الرسمية' }, Object.entries(S.LAYOUTS).map(([k, v]) => el('option', { value: k, selected: s.layout === k }, v.name))),
    el('optgroup', { label: 'تخطيطات عامة' }, Object.entries(D.LAYOUTS).map(([k, v]) => el('option', { value: k, selected: s.layout === k }, v.name))));
  const parts = [
    el('h3', {}, 'الشريحة ' + (cur + 1) + ' من ' + d.slides.length),
    s.hint ? el('div', { class: 'hint', role: 'note' }, el('span', {}, s.hint)) : null,
    field('التخطيط (تُحفظ النصوص والصور عند التبديل)', layoutSel),
  ];
  if (!official) parts.push(field('الخلفية', el('select', { 'aria-label': 'الخلفية', onchange: (e) => slideField(s.id, (x) => { x.bg = e.target.value; }, 'bg') }, Object.entries(D.BGS).map(([k, v]) => el('option', { value: k, selected: s.bg === k }, v)))));
  if (!official || fields.has('title')) parts.push(field(s.layout === 'cover' || s.layout === 'o-cover' ? 'عنوان العرض' : 'عنوان الشريحة', textInput(s.title, (v) => slideField(s.id, (x) => { x.title = v; }, 't'), { ph: 'اكتب العنوان' })));
  if (!official || fields.has('subtitle')) parts.push(field('عنوان فرعي (اختياري)', textInput(s.subtitle, (v) => slideField(s.id, (x) => { x.subtitle = v; }, 'sb'))));
  if (official && fields.has('bullets.0')) parts.push(field('عبارة قصيرة تحت العنوان', textInput((s.bullets || [])[0] || '', (v) => slideField(s.id, (x) => { x.bullets = x.bullets || []; x.bullets[0] = v; }, 'tg'))));
  if (official && fields.has('bullets')) parts.push(field('نص الشريحة (فقرة لكل سطر فارغ)', el('textarea', { rows: 6, dir: 'auto', oninput: (e) => slideField(s.id, (x) => setPath(x, 'bullets', e.target.value), 'pr') }, getPath(s, 'bullets'))));
  if (official && L.items) { parts.push(el('div', { class: 'dk-block-h' }, el('h3', {}, 'عناصر الشريحة'))); parts.push(itemsEditor(s, L)); }
  if (!official && s.layout === 'content') {
    parts.push(field('نقاط الشريحة (كل سطر نقطة)', el('textarea', { rows: 5, dir: 'auto', placeholder: 'اكتب نقطة في كل سطر', oninput: (e) => slideField(s.id, (x) => { x.bullets = e.target.value.split('\n').filter((l) => l.trim()); }, 'bl') }, (s.bullets || []).join('\n'))));
    parts.push(el('h3', {}, 'أقسام الشريحة'));
    if (!blks.length) parts.push(el('p', { class: 'muted' }, 'لا توجد أقسام بعد. أضف قسماً (مؤشرات، رسم، جدول...) كما في التقرير.'));
    blks.forEach((b, i) => parts.push(sectionCard(s, b, i, blks.length)));
    parts.push(el('div', { class: 'btns' }, btn('+ إضافة قسم', { cls: 'sm primary', onclick: addSectionMenu })));
  }
  // الصور ذات الإطارات الثابتة في التخطيط
  const photoEls = els.filter((e) => e.type === 'photo' && (!e.tile || e.photo.src) );
  const slots = els.filter((e) => e.type === 'photo' && !e.extra);
  if (slots.length) { parts.push(el('div', { class: 'dk-block-h' }, el('h3', {}, 'الصور'))); slots.slice(0, official && s.layout === 'o-partners' ? 8 : 4).forEach((e) => parts.push(photoCard(e))); }
  const extraPhotos = els.filter((e) => e.type === 'photo' && e.extra); extraPhotos.forEach((e) => parts.push(photoCard(e)));
  // العنصر المحدد
  const selE = selEid && els.find((e) => e.id === selEid);
  if (selE && selE.type !== 'photo') { parts.push(el('div', { class: 'dk-block-h' }, el('h3', {}, 'خصائص العنصر'))); parts.push(selectionPanel(selE)); }
  else if (selE && selE.type === 'photo') parts.push(el('div', { class: 'dk-card' }, el('b', {}, 'موضع الصورة'), el('div', { class: 'dk-grid2' }, numField('س (X)', selE.x, (v) => setRect(selE.id, { x: v })), numField('ص (Y)', selE.y, (v) => setRect(selE.id, { y: v })), numField('العرض', selE.w, (v) => setRect(selE.id, { w: Math.max(10, v) })), numField('الارتفاع', selE.h, (v) => setRect(selE.id, { h: Math.max(10, v) }))), selE.extra ? btn('حذف الصورة', { cls: 'sm ghost', onclick: () => removeExtra(selE.id) }) : btn('إعادة الموضع', { cls: 'sm ghost', onclick: () => resetElement(selE.id) })));
  // الطبقات
  parts.push(el('details', { class: 'dk-meta' }, el('summary', {}, 'الطبقات (' + els.length + ')'), ...els.slice().reverse().map((e) => el('div', { class: 'dk-layer' + (selEid === e.id ? ' on' : ''), onclick: () => canvas.select(e.id) }, el('span', {}, elementLabel(e)), e.extra ? el('span', {}, btn('▲', { cls: 'sm ghost', onclick: (ev) => { ev.stopPropagation(); moveExtra(e.id, 1); } }), btn('▼', { cls: 'sm ghost', onclick: (ev) => { ev.stopPropagation(); moveExtra(e.id, -1); } }), btn('✕', { cls: 'sm ghost', onclick: (ev) => { ev.stopPropagation(); removeExtra(e.id); } })) : el('small', { class: 'muted' }, 'من التخطيط')))));
  parts.push(el('div', { class: 'btns' }, btn('استعادة التنسيق الأصلي للشريحة', { cls: 'sm ghost', onclick: resetFormatting })));
  parts.push(field('ملاحظات المقدّم (لا تظهر في الشريحة)', el('textarea', { rows: 3, dir: 'auto', oninput: (e) => slideField(s.id, (x) => { x.notes = e.target.value; }, 'nt') }, s.notes || '')));
  parts.push(el('div', { class: 'btns' }, btn('→ الشريحة التالية', { cls: 'primary', onclick: () => select(cur + 1), disabled: cur >= d.slides.length - 1 })));
  parts.push(el('details', { class: 'dk-meta' }, el('summary', {}, 'إعدادات العرض كله'),
    field('عنوان العرض', textInput(d.title, (v) => edit((r) => { r.title = v; }, 'dt', 'content'))),
    field('عنوان فرعي', textInput(d.subtitle, (v) => edit((r) => { r.subtitle = v; }, 'ds', 'content'))),
    field('المقدّم', textInput(d.presenter, (v) => edit((r) => { r.presenter = v; }, 'dp', 'content'))),
    field('التاريخ', textInput(d.date, (v) => edit((r) => { r.date = v; }, 'dd', 'content'), { type: 'date' })),
    field('مقاس الشرائح', segmented(Object.entries(D.RATIOS).map(([k, v]) => [k, v.name]), d.ratio, (v) => { edit((r) => { r.ratio = v; }, null, 'structure'); }, 'مقاس الشرائح')),
    field('لوحة الألوان', el('select', { 'aria-label': 'لوحة الألوان', onchange: (e) => edit((r) => { r.palette = e.target.value; }, null, 'structure') }, Object.entries(T.PALETTES).map(([k, v]) => el('option', { value: k, selected: d.palette === k }, v.name)))),
    field('نص التذييل', textInput(d.options.footerText, (v) => edit((r) => { r.options.footerText = v; }, 'df', 'content'))),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: d.options.pageNumbers !== false, onchange: (e) => edit((r) => { r.options.pageNumbers = e.target.checked; }, null, 'structure') }), 'إظهار رقم الشريحة'),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!d.options.arabicDigits, onchange: (e) => edit((r) => { r.options.arabicDigits = e.target.checked; }, null, 'structure') }), 'استخدام الأرقام العربية ٠١٢')));
  box.replaceChildren(...parts.filter(Boolean));
}

function sectionCard(s, b, i, n) {
  const open = openBlock === b.id;
  const head = el('div', { class: 'dk-sec-h' },
    el('button', { type: 'button', class: 'dk-sec-t', 'aria-expanded': String(open), onclick: () => { openBlock = open ? null : b.id; renderProps(); } }, el('b', {}, b.title || BLOCK_NAMES[b.type]), el('small', { class: 'muted' }, ' · ' + BLOCK_NAMES[b.type])),
    el('span', { class: 'dk-sec-a' },
      btn(b.width === 'half' ? 'نصف' : 'كامل', { cls: 'sm ghost', title: 'عرض القسم في الشريحة', onclick: () => { edit((r) => { const x = r.sections.find((q) => q.id === b.id); x.width = x.width === 'half' ? 'full' : 'half'; }, null, 'structure'); renderProps(); } }),
      btn('▲', { cls: 'sm ghost', disabled: i === 0, onclick: () => moveBlock(s.id, i, i - 1) }), btn('▼', { cls: 'sm ghost', disabled: i === n - 1, onclick: () => moveBlock(s.id, i, i + 1) }),
      btn('✕', { cls: 'sm ghost', title: 'حذف القسم', onclick: () => removeBlock(s.id, b.id) })));
  const card = el('div', { class: 'dk-sec' + (open ? ' open' : '') }, head);
  if (open) card.append(el('div', { class: 'dk-sec-b' }, field('عنوان القسم (يظهر فوقه في الشريحة)', textInput(b.title || '', (v) => { edit((r) => { const x = r.sections.find((q) => q.id === b.id); if (x) x.title = v; }, 'bt' + b.id, 'content'); })), sectionEditor(b)));
  return card;
}
function addBlock(type) {
  const id = curSlide().id; let nid = '';
  edit((r) => {
    const s = r.slides.find((x) => x.id === id), b = T.makeSection(type, '', {}); b.hint = ''; r.sections.push(b);
    s.blockIds = (s.blockIds || []).concat([b.id]); nid = b.id;
  }, null, 'structure');
  openBlock = nid; renderProps();
}
function removeBlock(slideId, bid) {
  edit((r) => { const s = r.slides.find((x) => x.id === slideId); s.blockIds = (s.blockIds || []).filter((x) => x !== bid); r.sections = r.sections.filter((x) => x.id !== bid); }, null, 'structure'); renderProps();
}
function moveBlock(slideId, from, to) {
  edit((r) => { const s = r.slides.find((x) => x.id === slideId); s.blockIds.splice(to, 0, s.blockIds.splice(from, 1)[0]); }, null, 'structure'); renderProps();
}
function addSectionMenu(e) { popupMenu(e.currentTarget, Object.keys(BLOCK_NAMES).map((t) => ({ label: BLOCK_NAMES[t], run: () => addBlock(t) }))); }
let openBlock = null;

function setBlock(type) {
  const id = curSlide().id;
  edit((r) => {
    const s = r.slides.find((x) => x.id === id);
    if (s.blockId) r.sections = r.sections.filter((b) => b.id !== s.blockId);
    s.blockId = '';
    if (type) { const b = T.makeSection(type, '', {}); b.hint = ''; r.sections.push(b); s.blockId = b.id; }
  }, null, 'structure');
  renderProps();
}

/* ---------- عمليات الشرائح ---------- */
function select(i) { cur = Math.max(0, Math.min(deck().slides.length - 1, i)); selEid = null; if (canvas) canvas.clear(); renderThumbs(); renderStage(); renderProps(); }
function addSlide(layout) {
  edit((r) => {
    const sl = S.isOfficial(layout) ? D.makeOfficialSlide(r, layout, false) : D.newSlide(layout, { title: layout === 'closing' ? 'شكراً لكم' : '' });
    r.slides.splice(cur + 1, 0, sl);
  }, null, 'structure');
  select(cur + 1);
}
function addMenu(e) {
  popupMenu(e.currentTarget, [{ heading: 'شرائح هدية الرسمية' }].concat(Object.entries(S.LAYOUTS).map(([k, v]) => ({ label: v.name, run: () => addSlide(k) })),
    ['hr', { heading: 'شرائح عامة' }], Object.entries(D.LAYOUTS).map(([k, v]) => ({ label: 'شريحة ' + v.name, run: () => addSlide(k) })),
    ['kpi', 'chart', 'table', 'compare'].map((t) => ({ label: 'شريحة: ' + BLOCK_NAMES[t], run: () => { addSlide('content'); addBlock(t); } }))), { side: 'right' });
}
function dupSlide() {
  edit((r) => {
    const s = r.slides[cur], c = JSON.parse(JSON.stringify(s)); c.id = T.uid();
    c.blockIds = D.blocksOf(r, s).map((b) => { const nb = JSON.parse(JSON.stringify(b)); nb.id = T.uid(); r.sections.push(nb); return nb.id; }); delete c.blockId;
    (c.extra || []).forEach((x) => { if (x.type === 'block' && x.blockId) { const b = r.sections.find((q) => q.id === x.blockId); if (b) { const nb = JSON.parse(JSON.stringify(b)); nb.id = T.uid(); r.sections.push(nb); x.blockId = nb.id; } } });
    r.slides.splice(cur + 1, 0, c);
  }, null, 'structure');
  select(cur + 1);
}
async function delSlide() {
  if (deck().slides.length <= 1) { toast('يجب أن يبقى شريحة واحدة على الأقل', { tone: 'err' }); return; }
  if (!(await confirmDialog({ title: 'حذف الشريحة', text: 'سيتم حذف الشريحة ' + (cur + 1) + '. يمكنك التراجع بـ Ctrl+Z.', ok: 'حذف', danger: true }))) return;
  edit((r) => { const s = r.slides[cur], ids = D.idsOf(s).concat((s.extra || []).map((x) => x.blockId).filter(Boolean)); r.sections = r.sections.filter((b) => !ids.includes(b.id)); r.slides.splice(cur, 1); }, null, 'structure');
  select(Math.min(cur, deck().slides.length - 1));
}
function moveSlide(from, to) {
  const n = deck().slides.length; if (to < 0 || to >= n || from === to) return;
  edit((r) => { r.slides.splice(to, 0, r.slides.splice(from, 1)[0]); }, null, 'structure');
  select(to);
}

/* ---------- الحفظ ---------- */
function status(t) { $('dk-status').textContent = t; }
let lastSaved = '';
async function save(quiet) {
  const d = deck();
  if (!String(d.title || '').trim()) { if (!quiet) toast('أدخل عنوان العرض من «إعدادات العرض كله»', { tone: 'err' }); return false; }
  const body = JSON.stringify(d);
  if (body.length > 20 * 1024 * 1024) { status('العرض كبير جداً'); if (!quiet) toast('حجم العرض يتجاوز 20 ميغابايت. قلّل عدد الصور أو أبعادها ثم احفظ.', { tone: 'err', ms: 7000 }); return false; }
  if (saving) return false; saving = true; status('جارٍ الحفظ…');
  try {
    const res = await fetch('/report-builder/api/decks/' + serverId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'تعذر الحفظ');
    store.dirty = false; status('تم الحفظ ' + new Date().toLocaleTimeString('ar-SA-u-ca-gregory', { hour: '2-digit', minute: '2-digit' }));
    if (!quiet) toast('تم حفظ العرض', { tone: 'ok' });
    return true;
  } catch (e) { status('تعذر الحفظ'); if (!quiet) toast(e.message, { tone: 'err' }); return false; } finally { saving = false; }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(true), 2500); status('تغييرات غير محفوظة…'); }

/* ---------- التصدير والمشاركة ---------- */
async function ensureSaved() { if (store.dirty) return save(false); return true; }
function exportMenu(e) {
  popupMenu(e.currentTarget, [
    { label: 'عرض بملء الشاشة', run: async () => { if (await ensureSaved()) window.open('/report-builder/decks/' + serverId + '.html#present', '_blank'); } },
    { label: 'PDF / طباعة', run: async () => { if (await ensureSaved()) window.open('/report-builder/decks/' + serverId + '.html#print', '_blank'); } },
    { label: 'صفحة ويب HTML (تنزيل)', run: async () => { if (await ensureSaved()) location.href = '/report-builder/api/decks/' + serverId + '/export.html'; } },
    { label: 'PowerPoint ‏(PPTX)', run: async () => { const m = await import('./pptx.js'); await m.exportPptx(deck(), cfg); } },
    { label: 'صور PNG لكل الشرائح', run: async () => { const m = await import('./pptx.js'); await m.exportPng(deck(), cfg, cur); } },
    { label: 'رابط مشاركة', run: async () => { if (await ensureSaved()) { const m = await import('./share-ui.js'); m.openShareDialog({ type: 'deck', id: serverId, title: deck().title }); } } },
    { label: 'تحويل إلى تقرير', run: async () => {
      const rep = D.toReport(deck());
      const res = await fetch('/report-builder/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rep) });
      const out = await res.json().catch(() => ({})); if (!res.ok) throw new Error(out.error || 'تعذر الإنشاء');
      location.href = '/report-builder/?edit=' + out.id;
    } },
  ], { side: 'left' });
}

/* ---------- التشغيل ---------- */
function filled(d, s) { const b = D.blocksOf(d, s).find((x) => !window.RBR.isEmptySection(x)); return s.layout !== 'content' ? !!String(s.title || '').trim() : (s.bullets || []).some((x) => x.trim()) || !!b; }
function progress() { const d = deck(), n = d.slides.filter((s) => filled(d, s)).length; $('dk-prog').textContent = 'اكتمل ' + n + ' من ' + d.slides.length + ' شريحة'; }
function full() { progress(); cur = Math.min(cur, deck().slides.length - 1); renderThumbs(); renderStage(); renderProps(); $('dk-name').textContent = deck().title || 'عرض بلا عنوان'; }
on((kind) => {
  $('b-undo').disabled = !canUndo(); $('b-redo').disabled = !canRedo();
  if (kind === 'all' || kind === 'select') { full(); }
  else { renderStage(); if (kind === 'structure') renderThumbs(); else { const t = $('dk-thumbs').querySelectorAll('.dk-th')[cur]; if (t) { const k = 180 / (D.RATIOS[deck().ratio] || D.RATIOS['16:9']).w, inner = t.querySelector('.in'); inner.innerHTML = slideHtml(cur, true); const sl = inner.firstElementChild; sl.style.transform = `scale(${k})`; sl.style.position = 'absolute'; sl.style.top = '0'; sl.style.right = '0'; } } $('dk-name').textContent = deck().title || 'عرض بلا عنوان'; }
  progress();
  if (kind !== 'status' && store.dirty) scheduleSave();
});

$('b-undo').onclick = () => undo(); $('b-redo').onclick = () => redo();
$('b-save').onclick = () => save(false);
$('b-share').onclick = async () => { if (!(await ensureSaved())) return; if (await shareDialog(serverId, 'deck')) location.href = '/report-builder/decks/' + serverId + '.html'; };
$('b-export').onclick = exportMenu;
$('b-present').onclick = async () => { if (await ensureSaved()) window.open('/report-builder/decks/' + serverId + '.html#present', '_blank'); };
// حرف المفتاح الفعلي بغضّ النظر عن لغة لوحة المفاتيح (عربي/إنجليزي)
const kc = (e) => (/^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase());
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && kc(e) === 's') { e.preventDefault(); save(false); }
  else if (!typing && (e.ctrlKey || e.metaKey) && kc(e) === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (!typing && (e.ctrlKey || e.metaKey) && kc(e) === 'y') { e.preventDefault(); redo(); }
  else if (!typing && !selEid && e.key === 'ArrowDown') { e.preventDefault(); select(cur + 1); }
  else if (!typing && !selEid && e.key === 'ArrowUp') { e.preventDefault(); select(cur - 1); }
  else if (!typing && (e.ctrlKey || e.metaKey) && kc(e) === 'd') { e.preventDefault(); dupSlide(); }
});
addEventListener('resize', () => renderStage());
addEventListener('beforeunload', (e) => { if (store.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- شريط الأدوات: إضافة عناصر، تكبير/تصغير، طي اللوحات ---------- */
function buildToolbar() {
  const tb = $('dk-toolbar'), wrap = document.querySelector('.dk-wrap');
  const add = (label, fn, title) => btn(label, { cls: 'sm ghost', title: title || label, onclick: fn });
  const secMenu = (e) => popupMenu(e.currentTarget, ['table', 'chart', 'kpi', 'compare', 'calc', 'progress', 'timeline'].map((t) => ({ label: BLOCK_NAMES[t], run: () => addExtra('block', t) })));
  const setZoom = (f) => { zoomF = Math.max(0.4, Math.min(3, f)); renderStage(); };
  tb.append(add('＋ نص', () => addExtra('text'), 'إضافة صندوق نص'), add('🖼 صورة', () => addExtra('photo'), 'إضافة صورة مع التدرج الرسمي'), add('▦ جدول/رسم/مؤشرات', secMenu, 'إضافة قسم بيانات'), add('▭ شكل', () => addExtra('rect'), 'مستطيل'), add('● دائرة', () => addExtra('ellipse'), 'دائرة'), add('⬢ سداسي', () => addExtra('hex'), 'شكل سداسي (هوية هدية)'),
    el('span', { class: 'sep' }), add('−', () => setZoom(zoomF - 0.2), 'تصغير'), el('span', { class: 'zoom', id: 'zoom-pct' }, '100%'), add('+', () => setZoom(zoomF + 0.2), 'تكبير'), add('ملاءمة', () => setZoom(1), 'ملاءمة الشاشة'),
    el('span', { class: 'sep' }),
    add('☰ الشرائح', () => { wrap.classList.toggle('no-l'); LS('dk-nol', wrap.classList.contains('no-l') ? '1' : '0'); setTimeout(renderStage, 220); }, 'طي/إظهار قائمة الشرائح'),
    add('⚙ الخصائص', () => { wrap.classList.toggle('no-r'); LS('dk-nor', wrap.classList.contains('no-r') ? '1' : '0'); setTimeout(renderStage, 220); }, 'طي/إظهار لوحة الخصائص'));
  if (LS('dk-nol') === '1') wrap.classList.add('no-l'); if (LS('dk-nor') === '1') wrap.classList.add('no-r');
}
buildToolbar();
canvas = initCanvas({
  stage: () => $('dk-stage'), scale: () => curScale, deck, slide: curSlide, ctx: ctxOf,
  commit: (fn, key) => slideCommit(fn, key), onSelect: (id) => { selEid = id; renderProps(); }, pickPhoto, removeExtra,
});

(async () => {
  const me = await (await fetch('/report-builder/api/me')).json();
  store.user = me.username; mountUserChip($('user-chip'), me);
  cfg = await (await fetch('/report-builder/api/config')).json(); await loadIndicators();
  serverId = new URLSearchParams(location.search).get('id');
  if (!serverId) { location.href = '/report-builder/decks.html'; return; }
  const res = await fetch('/report-builder/api/decks/' + serverId);
  if (!res.ok) { toast('تعذر فتح العرض', { tone: 'err' }); setTimeout(() => (location.href = '/report-builder/decks.html'), 1200); return; }
  const d = await res.json(); const acc = d.access || {}; delete d.access;
  if (!acc.edit) { toast('لا يمكن تعديل هذا العرض في حالته الحالية (' + (d.statusLabel || '') + ')', { tone: 'err' }); setTimeout(() => (location.href = '/report-builder/decks/' + serverId + '.html'), 1500); return; }
  if (!acc.share) $('b-share').hidden = true;
  if (d.workflow && d.workflow.status === 'returned') toast('أعاد ' + (d.workflow.decidedByName || 'المدير') + ' العرض للتعديل: ' + (d.workflow.decisionNote || ''), { tone: 'err', ms: 9000 });
  load(d, { serverId });
  store.dirty = false; status('');
})();
