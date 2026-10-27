// محررات الأقسام: لكل نوع قسم واجهة تعبئة مناسبة له
import { el, btn, iconBtn, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { edit, store, emit } from './store.js';
import * as T from './templates.js';
import { iconButton, pickIcon, iconSrc } from './iconpicker.js';
import { importButton } from './importer.js';
import { getIndicators, getIndicatorMap } from './indicators-cache.js';
let aiSt = null;
const aiStatus = () => (aiSt || (aiSt = fetch('/report-builder/api/ai/status').then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }))));

const RBR = window.RBR;
let uidn = 0;
const fid = () => 'f' + (++uidn);

const sec = (r, id) => r.sections.find((s) => s.id === id);
export const upd = (id, key, fn, kind = 'content') => edit((r) => { const s = sec(r, id); if (s) fn(s); }, key ? key + ':' + id : null, kind);

export function field(label, input, hint) {
  const id = input.id || (input.id = fid());
  return el('div', { class: 'fld' }, el('label', { for: id }, label), input, hint ? el('small', { class: 'fld-hint' }, hint) : null);
}
export const textInput = (value, onInput, o = {}) => el('input', { type: o.type || 'text', value: value || '', placeholder: o.ph || '', inputmode: o.inputmode, dir: o.dir, 'aria-invalid': o.invalid ? 'true' : null, autocomplete: 'off', oninput: (e) => onInput(e.target.value), id: o.id });

export function segmented(options, value, onChange, label) {
  const wrap = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  options.forEach(([v, text]) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => { onChange(v); wrap.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); } }, text);
    wrap.append(b);
  });
  return wrap;
}

/* ---------- محرر النص الغني (WYSIWYG) ---------- */
function richText(s) {
  const area = el('div', { class: 'rte', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': s.title || 'نص القسم', dir: 'rtl', spellcheck: 'true' });
  area.innerHTML = RBR.sanitize(s.content || '');
  const sync = () => upd(s.id, 't', (x) => { x.content = RBR.sanitize(area.innerHTML); });
  area.addEventListener('input', sync);
  area.addEventListener('focus', () => { if (!area.innerHTML.trim()) { area.innerHTML = '<p><br></p>'; } try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* ok */ } });
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const html = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => '<p>' + l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</p>').join('');
    document.execCommand('insertHTML', false, html || '');
  });
  const cmd = (name, arg) => () => { area.focus(); document.execCommand(name, false, arg); sync(); };
  const tools = [
    ['heading', 'عنوان فرعي', cmd('formatBlock', 'h3')], ['bold', 'غامق (Ctrl+B)', cmd('bold')], ['italic', 'مائل (Ctrl+I)', cmd('italic')], ['underline', 'تسطير (Ctrl+U)', cmd('underline')],
    ['list', 'قائمة نقطية', cmd('insertUnorderedList')], ['ol', 'قائمة مرقمة', cmd('insertOrderedList')], ['quote', 'اقتباس', cmd('formatBlock', 'blockquote')],
    ['type', 'فقرة عادية', cmd('formatBlock', 'p')], ['eraser', 'إزالة التنسيق', cmd('removeFormat')],
  ];
  const bar = el('div', { class: 'rte-bar', role: 'toolbar', 'aria-label': 'تنسيق النص' }, tools.map(([ic, t, fn]) => { const b = iconBtn(ic, t, fn); b.addEventListener('mousedown', (e) => e.preventDefault()); return b; }));
  const aiRow = el('div', { class: 'btns', style: 'margin-top:8px' });
  aiStatus().then((st) => { if (st.enabled && store.report && store.report.sections) aiRow.append(btn('اقتراح بالذكاء الاصطناعي', { icon: 'sparkle', cls: 'sm ghost', title: 'يكتب مسودة من بيانات قسم تختاره، دون اختلاق أرقام', onclick: async () => { const m = await import('./ai-ui.js'); m.aiDialog(s); } })); });
  return el('div', { class: 'rte-wrap' }, bar, area, aiRow);
}

/* ---------- محرر الصفوف العام (مؤشرات، رسوم، تقدم، خط زمني) ---------- */
function rows(s, { get, cols, make, addLabel, min = 1 }) {
  const box = el('div', { class: 'grid-ed' });
  const draw = (focusRow, focusCol) => {
    box.replaceChildren();
    const items = get(s);
    box.append(el('div', { class: 'grow ghead', style: `--cols:${cols.map((c) => c.w || '1fr').join(' ')} 84px` }, cols.map((c) => el('span', {}, c.label)), el('span')));
    items.forEach((it, i) => {
      const row = el('div', { class: 'grow', style: `--cols:${cols.map((c) => c.w || '1fr').join(' ')} 84px` });
      cols.forEach((c, ci) => {
        let inp;
        if (c.type === 'icon') {
          inp = iconButton(it[c.key] || '', (v) => upd(s.id, null, (x) => { get(x)[i][c.key] = v; }), { title: 'أيقونة المؤشر' });
        } else if (c.type === 'select') {
          inp = el('select', { 'aria-label': c.label, onchange: (e) => upd(s.id, null, (x) => { get(x)[i][c.key] = e.target.value; }) }, c.options.map(([v, t]) => el('option', { value: v, selected: it[c.key] === v }, t)));
        } else {
          inp = el('input', { type: c.type === 'date' ? 'date' : 'text', value: it[c.key] || '', placeholder: c.ph || '', inputmode: c.inputmode, 'aria-label': c.label + ' ' + (i + 1), autocomplete: 'off',
            oninput: (e) => upd(s.id, 'r' + i + c.key, (x) => { get(x)[i][c.key] = e.target.value; }),
            onkeydown: (e) => { if (e.key === 'Enter' && ci === cols.length - 1) { e.preventDefault(); upd(s.id, null, (x) => get(x).splice(i + 1, 0, make()), 'structure'); draw(i + 1, 0); } },
            onpaste: (e) => {
              const t = (e.clipboardData || window.clipboardData).getData('text/plain');
              if (!/[\n\t]/.test(t.trim())) return;
              e.preventDefault();
              const lines = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/\t|\|/).map((x) => x.trim()));
              upd(s.id, null, (x) => { const arr = get(x); lines.forEach((cells, li) => { const target = arr[i + li] || (arr[i + li] = make()); cells.forEach((v, cj) => { const col = cols[ci + cj]; if (col && col.type !== 'select') target[col.key] = v; }); }); }, 'structure');
              draw();
            } });
        }
        row.append(inp);
      });
      row.append(el('div', { class: 'gact' },
        iconBtn('up', 'تحريك لأعلى', () => { if (i > 0) { upd(s.id, null, (x) => { const a = get(x); a.splice(i - 1, 0, a.splice(i, 1)[0]); }, 'structure'); draw(i - 1); } }),
        iconBtn('down', 'تحريك لأسفل', () => { if (i < items.length - 1) { upd(s.id, null, (x) => { const a = get(x); a.splice(i + 1, 0, a.splice(i, 1)[0]); }, 'structure'); draw(i + 1); } }),
        iconBtn('x', 'حذف الصف', () => { if (items.length <= min) { upd(s.id, null, (x) => { get(x)[i] = make(); }, 'structure'); } else upd(s.id, null, (x) => get(x).splice(i, 1), 'structure'); draw(); }, 'danger')));
      box.append(row);
    });
    box.append(btn(addLabel, { icon: 'plus', cls: 'sm ghost', onclick: () => { upd(s.id, null, (x) => get(x).push(make()), 'structure'); draw(get(s).length - 1, 0); } }));
    if (focusRow != null) { const r = box.querySelectorAll('.grow:not(.ghead)')[focusRow]; if (r) { const f = r.querySelectorAll('input,select')[focusCol || 0]; if (f) f.focus(); } }
  };
  draw();
  return box;
}

/* ---------- محررات الأنواع ---------- */
function listEditor(s) {
  const wrap = el('div', {});
  const items = el('div', { class: 'list-ed' });
  const draw = (focus) => {
    items.replaceChildren();
    s.content.items.forEach((v, i) => {
      const inp = el('input', { type: 'text', value: v, placeholder: 'النقطة ' + (i + 1), 'aria-label': 'النقطة ' + (i + 1), autocomplete: 'off',
        oninput: (e) => upd(s.id, 'l' + i, (x) => { x.content.items[i] = e.target.value; }),
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); upd(s.id, null, (x) => x.content.items.splice(i + 1, 0, ''), 'structure'); draw(i + 1); } else if (e.key === 'Backspace' && !inp.value && s.content.items.length > 1) { e.preventDefault(); upd(s.id, null, (x) => x.content.items.splice(i, 1), 'structure'); draw(Math.max(0, i - 1)); } },
        onpaste: (e) => { const t = (e.clipboardData || window.clipboardData).getData('text/plain'); if (!/\n/.test(t.trim())) return; e.preventDefault(); const ls = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); upd(s.id, null, (x) => x.content.items.splice(i, 1, ...ls), 'structure'); draw(); } });
      items.append(el('div', { class: 'lrow' }, el('span', { class: 'lnum', 'aria-hidden': 'true' }, s.content.ordered ? String(i + 1) : '•'), inp,
        iconBtn('x', 'حذف النقطة', () => { upd(s.id, null, (x) => { x.content.items.splice(i, 1); if (!x.content.items.length) x.content.items.push(''); }, 'structure'); draw(); }, 'danger')));
    });
    items.append(btn('إضافة نقطة', { icon: 'plus', cls: 'sm ghost', onclick: () => { upd(s.id, null, (x) => x.content.items.push(''), 'structure'); draw(s.content.items.length - 1); } }));
    if (focus != null) items.querySelectorAll('input')[focus].focus();
  };
  draw();
  wrap.append(field('نوع القائمة', segmented([[false, 'نقطية'], [true, 'مرقمة']], !!s.content.ordered, (v) => { upd(s.id, null, (x) => { x.content.ordered = v; }); s.content.ordered = v; draw(); }, 'نوع القائمة')), items,
    el('p', { class: 'tip' }, 'اضغط Enter لإضافة نقطة جديدة. يمكنك لصق عدة أسطر دفعة واحدة.'));
  return wrap;
}

function tableEditor(s) {
  const wrap = el('div', { class: 'tbl-ed' });
  const draw = () => {
    const c = s.content;
    const t = el('table', { class: 'grid', 'aria-label': 'جدول البيانات' });
    t.append(el('thead', {}, el('tr', {}, c.headers.map((h, j) => el('th', {},
      el('input', { type: 'text', value: h, placeholder: 'العمود ' + (j + 1), 'aria-label': 'عنوان العمود ' + (j + 1), oninput: (e) => upd(s.id, 'h' + j, (x) => { x.content.headers[j] = e.target.value; }) }),
      c.headers.length > 1 ? iconBtn('x', 'حذف العمود', () => { upd(s.id, null, (x) => { x.content.headers.splice(j, 1); x.content.rows.forEach((r) => r.splice(j, 1)); }, 'structure'); draw(); }, 'danger tiny') : null)), el('th', {}))));
    const tb = el('tbody', {});
    c.rows.forEach((r, i) => tb.append(el('tr', {}, r.map((v, j) => el('td', {}, el('input', { type: 'text', value: v, 'aria-label': `الصف ${i + 1} العمود ${j + 1}`, autocomplete: 'off',
      oninput: (e) => upd(s.id, 'c' + i + '_' + j, (x) => { x.content.rows[i][j] = e.target.value; }),
      onkeydown: (e) => { if (e.key === 'Enter' && j === r.length - 1 && i === c.rows.length - 1) { e.preventDefault(); upd(s.id, null, (x) => x.content.rows.push(Array(x.content.headers.length).fill('')), 'structure'); draw(); const last = wrap.querySelectorAll('tbody tr'); last[last.length - 1].querySelector('input').focus(); } },
      onpaste: (e) => {
        const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (!/\t|\n/.test(txt.trim())) return; e.preventDefault();
        const lines = txt.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/\t/).map((x) => x.trim()));
        upd(s.id, null, (x) => { const w = Math.max(x.content.headers.length, j + Math.max(...lines.map((l) => l.length))); while (x.content.headers.length < w) { x.content.headers.push(''); x.content.rows.forEach((rr) => rr.push('')); } lines.forEach((cells, li) => { const row = x.content.rows[i + li] || (x.content.rows[i + li] = Array(w).fill('')); cells.forEach((cv, cj) => { row[j + cj] = cv; }); }); }, 'structure');
        draw();
      } }))),
      el('td', { class: 'ract' }, iconBtn('x', 'حذف الصف', () => { upd(s.id, null, (x) => { if (x.content.rows.length > 1) x.content.rows.splice(i, 1); else x.content.rows[0] = Array(x.content.headers.length).fill(''); }, 'structure'); draw(); }, 'danger tiny')))));
    t.append(tb);
    wrap.replaceChildren(el('div', { class: 'tscroll' }, t),
      el('div', { class: 'btns' }, importButton(s), btn('إضافة صف', { icon: 'plus', cls: 'sm ghost', onclick: () => { upd(s.id, null, (x) => x.content.rows.push(Array(x.content.headers.length).fill('')), 'structure'); draw(); } }),
        btn('إضافة عمود', { icon: 'plus', cls: 'sm ghost', onclick: () => { upd(s.id, null, (x) => { x.content.headers.push(''); x.content.rows.forEach((r) => r.push('')); }, 'structure'); draw(); } }),
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: c.zebra !== false, onchange: (e) => upd(s.id, null, (x) => { x.content.zebra = e.target.checked; }) }), 'تظليل الصفوف بالتناوب'),
        el('label', { class: 'chk', title: 'يلوّن الخلايا الرقمية حسب قيمتها (الأعلى أغمق)' }, el('input', { type: 'checkbox', checked: !!c.heat, onchange: (e) => upd(s.id, null, (x) => { x.content.heat = e.target.checked; }) }), 'خريطة حرارية (تلوين الأرقام)')),
      el('p', { class: 'tip' }, 'انسخ جدولاً من Excel والصقه في أي خلية وسيتوزع تلقائياً.'));
  };
  draw();
  return wrap;
}

function kpiEditor(s) {
  return el('div', {}, el('div', { class: 'btns' }, importButton(s)), field('شكل العرض', segmented([['cards', 'بطاقات'], ['highlights', 'أرقام بارزة']], s.content.style, (v) => upd(s.id, null, (x) => { x.content.style = v; }), 'شكل العرض')),
    rows(s, { get: (x) => x.content.items, make: () => ({ icon: '', label: '', value: '', trend: '' }), addLabel: 'إضافة مؤشر', min: 1,
      cols: [{ key: 'icon', label: 'أيقونة', type: 'icon', w: '46px' }, { key: 'label', label: 'التسمية', ph: 'عدد المستفيدين', w: '1.5fr' }, { key: 'value', label: 'القيمة', ph: '3,123', w: '1fr' }, { key: 'trend', label: 'التغيّر', ph: '+4% أو -7%', w: '1fr' }] }),
    el('p', { class: 'tip' }, 'التغيّر اختياري: ابدأه بعلامة - لإظهار سهم هابط.'));
}

const KINDS = [['bar', 'أعمدة'], ['line', 'خط'], ['area', 'مساحة'], ['donut', 'حلقة'], ['pie', 'دائرة'], ['hbar', 'أفقي'], ['waterfall', 'شلال'], ['gauge', 'مقياس'], ['radar', 'رادار'], ['funnel', 'قمع']];
const KIND_TIPS = { waterfall: 'الشلال: أول صف = الرصيد الافتتاحي، والصفوف التالية قيم التغيّر (موجبة أو سالبة بعلامة -)، ويُضاف عمود «الإجمالي» تلقائياً.', gauge: 'المقياس: يستخدم أول صف فقط (القيمة)، وحدد القيمة القصوى بالأسفل.', radar: 'الرادار: أدخل 3 محاور أو أكثر بنفس المقياس.', funnel: 'القمع: رتّب المراحل من الأكبر إلى الأصغر (مثل: المتقدمون ← المقبولون ← المستفيدون).', pie: 'الدائرة: تُحسب النسبة تلقائياً من مجموع القيم.' };
function indicatorLink(s) {
  const list = getIndicators(), linked = s.content.ref && getIndicatorMap()[s.content.ref];
  if (linked) return el('div', { class: 'hint', role: 'note' }, el('span', {}, 'مرتبط بالمؤشر المركزي «' + linked.name + '»: تتحدّث الأرقام تلقائياً عند تعديل المؤشر. '), btn('فك الربط', { cls: 'sm ghost', onclick: () => { upd(s.id, null, (x) => { x.content.data = linked.series.map((p) => ({ label: p.label, value: p.value })); x.content.ref = ''; }, 'structure'); emit('select'); } }));
  if (!list.length) return null;
  return field('ربط بمؤشر مركزي (اختياري)', el('select', { 'aria-label': 'مؤشر مركزي', onchange: (e) => { const ind = list.find((i) => i.id === e.target.value); if (!ind) return; upd(s.id, null, (x) => { x.content.ref = ind.id; x.content.data = ind.series.map((p) => ({ label: p.label, value: p.value })); if (!x.content.unit) x.content.unit = ind.unit; if (!x.source) x.source = ind.source; if (!x.asOf) x.asOf = ind.asOf; }, 'structure'); emit('select'); } }, el('option', { value: '' }, 'بدون ربط'), list.map((i) => el('option', { value: i.id }, i.name + (i.unit ? ' (' + i.unit + ')' : '')))), 'القيم تُقرأ من «مركز المؤشرات» وتتحدّث في كل التقارير والعروض المرتبطة.');
}
function chartEditor(s) {
  const linked = s.content.ref && getIndicatorMap()[s.content.ref];
  return el('div', {}, indicatorLink(s), linked ? null : el('div', { class: 'btns' }, importButton(s)), field('نوع الرسم', segmented(KINDS, s.content.kind, (v) => upd(s.id, null, (x) => { x.content.kind = v; }), 'نوع الرسم')),
    linked ? null : rows(s, { get: (x) => x.content.data, make: () => ({ label: '', value: '' }), addLabel: 'إضافة نقطة', min: 1,
      cols: [{ key: 'label', label: 'التسمية', ph: 'يناير', w: '1.5fr' }, { key: 'value', label: 'القيمة (رقم)', ph: '120', w: '1fr', inputmode: 'decimal' }] }),
    s.content.kind === 'gauge' ? field('القيمة القصوى للمقياس', textInput(s.content.max || '100', (v) => upd(s.id, 'mx', (x) => { x.content.max = v; }), { ph: '100', inputmode: 'decimal' })) : null,
    field('الوحدة (اختياري)', textInput(s.content.unit, (v) => upd(s.id, 'u', (x) => { x.content.unit = v; }), { ph: 'مثال: %' })),
    KIND_TIPS[s.content.kind] ? el('p', { class: 'tip' }, KIND_TIPS[s.content.kind]) : null,
    el('p', { class: 'tip' }, 'الصق عمودين من Excel (التسمية ثم القيمة) في أول خلية وسيتم تعبئة الجدول.'));
}

function ganttEditor(s) {
  return el('div', {}, rows(s, { get: (x) => x.content.items, make: () => ({ name: '', start: '', end: '', progress: '', owner: '' }), addLabel: 'إضافة مهمة', min: 1,
    cols: [{ key: 'name', label: 'المهمة', ph: 'التصميم', w: '1.6fr' }, { key: 'start', label: 'البداية', type: 'date', w: '1.1fr' }, { key: 'end', label: 'النهاية', type: 'date', w: '1.1fr' }, { key: 'progress', label: 'الإنجاز %', ph: '60', w: '.7fr', inputmode: 'numeric' }, { key: 'owner', label: 'المسؤول', ph: 'اختياري', w: '1fr' }] }),
  el('p', { class: 'tip' }, 'يُرسم شريط لكل مهمة على محور زمني بالأشهر، مع نسبة الإنجاز داخل الشريط وخط «اليوم».'));
}

function progressEditor(s) {
  return rows(s, { get: (x) => x.content.items, make: () => ({ label: '', value: '' }), addLabel: 'إضافة مؤشر', min: 1,
    cols: [{ key: 'label', label: 'التسمية', ph: 'المحور الأول', w: '1.6fr' }, { key: 'value', label: 'النسبة %', ph: '75', w: '.8fr', inputmode: 'numeric' }] });
}

function timelineEditor(s) {
  return rows(s, { get: (x) => x.content.items, make: () => ({ date: '', title: '', desc: '', status: 'todo' }), addLabel: 'إضافة محطة', min: 1,
    cols: [{ key: 'date', label: 'التاريخ', ph: 'يناير', w: '.8fr' }, { key: 'title', label: 'العنوان', ph: 'إطلاق المشروع', w: '1.4fr' }, { key: 'desc', label: 'وصف مختصر', ph: 'اختياري', w: '1.4fr' },
      { key: 'status', label: 'الحالة', type: 'select', w: '.9fr', options: [['done', 'مكتملة'], ['active', 'جارية'], ['todo', 'قادمة']] }] });
}

export async function fileToDataUrl(file, maxW = 1600, quality = 0.86) {
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('الصيغة غير مدعومة. استخدم PNG أو JPG أو WEBP أو SVG.');
  const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') { if (raw.length > 2.4e6) throw new Error('حجم الصورة كبير (الحد 1.8MB).'); return raw; }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
  const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
  if (out.length > 3.9e6) throw new Error('حجم الصورة كبير. جرّب صورة أصغر.');
  return out;
}

function imageEditor(s) {
  const wrap = el('div', { class: 'img-ed' });
  const draw = () => {
    const c = s.content;
    const drop = el('label', { class: 'drop', tabindex: '0' },
      c.src ? el('img', { src: c.src, alt: 'معاينة الصورة' }) : el('div', { class: 'drop-empty', html: icon('upload', 28) + '<b>اسحب صورة هنا أو اضغط للاختيار</b><small>PNG أو JPG أو WEBP أو SVG</small>' }),
      el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif', class: 'sr', onchange: (e) => pick(e.target.files[0]) }));
    const pick = async (f) => { if (!f) return; try { const url = await fileToDataUrl(f); upd(s.id, null, (x) => { x.content.src = url; }, 'structure'); draw(); } catch (err) { toast(err.message, { tone: 'err' }); } };
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.querySelector('input').click(); } });
    wrap.replaceChildren(drop,
      btn('اختيار من أيقونات الهوية', { icon: 'sparkle', cls: 'sm ghost', onclick: async () => { const v = await pickIcon({ variant: 'plain', title: 'أيقونات الهوية', allowNone: false }); if (v) { upd(s.id, null, (x) => { x.content.src = iconSrc(v, 'plain'); }, 'structure'); draw(); } } }),
      c.src ? btn('إزالة الصورة', { icon: 'trash', cls: 'sm ghost danger-text', onclick: () => { upd(s.id, null, (x) => { x.content.src = ''; }, 'structure'); draw(); } }) : null,
      field('تعليق على الصورة', textInput(c.caption, (v) => upd(s.id, 'cap', (x) => { x.content.caption = v; }), { ph: 'اختياري' })),
      field('أسلوب العرض', segmented([['contain', 'احتواء كامل'], ['cover', 'ملء الإطار']], c.fit, (v) => upd(s.id, null, (x) => { x.content.fit = v; }), 'أسلوب العرض')),
      field('ارتفاع الصورة: ' + c.height + 'px', el('input', { type: 'range', min: 80, max: 520, step: 10, value: c.height, 'aria-label': 'ارتفاع الصورة', oninput: (e) => { e.target.parentNode.querySelector('label').textContent = 'ارتفاع الصورة: ' + e.target.value + 'px'; upd(s.id, 'hh', (x) => { x.content.height = +e.target.value; }); } })));
  };
  draw();
  return wrap;
}

/* ---------- حسابات تلقائية ---------- */
function calcEditor(s) {
  const RBC = window.RBC;
  const wrap = el('div', { class: 'calc-ed' });
  let live = {};
  const rowOf = (x, key) => x.content.rows.find((r) => r.key === key);
  const refreshLive = () => {
    const ev = RBC.evalCalc(s.content);
    s.content.rows.forEach((row) => {
      const sp = live[row.key]; if (!sp) return;
      const err = ev.errors[row.key];
      sp.textContent = err ? '⚠ ' + err : '= ' + RBC.fmtRow(ev.values[row.key], row); sp.classList.toggle('bad', !!err);
    });
  };
  const optText = (r) => `${r.key} — ${r.label || 'بدون اسم'}`;

  function rowCard(row) {
    const others = () => s.content.rows.filter((r) => r.key !== row.key);
    const card = el('div', { class: 'crow ' + (row.kind === 'calc' ? 'is-calc' : 'is-input') });
    const idx = s.content.rows.indexOf(row), last = s.content.rows.length - 1;
    card.append(el('div', { class: 'crow-head' },
      el('span', { class: 'ckey', title: 'رمز البند يُستخدم في العمليات' }, row.key),
      el('input', { type: 'text', value: row.label, placeholder: row.kind === 'calc' ? 'اسم النتيجة، مثل: المتبقي' : 'اسم البند، مثل: التبرعات', 'aria-label': 'اسم البند ' + row.key, oninput: (e) => { upd(s.id, 'cl' + row.key, (x) => { rowOf(x, row.key).label = e.target.value; }); } }),
      segmented([['input', 'مُدخل'], ['calc', 'محسوب']], row.kind, (v) => { upd(s.id, null, (x) => { const r = rowOf(x, row.key); r.kind = v; if (v === 'calc' && !(r.args || []).length) { r.op = 'sub'; r.args = x.content.rows.filter((q) => q.key !== r.key).slice(0, 2).map((q) => q.key); } }, 'structure'); draw(); }, 'نوع البند'),
      el('div', { class: 'gact' },
        iconBtn('up', 'تحريك لأعلى', () => { if (idx > 0) { upd(s.id, null, (x) => { const a = x.content.rows; a.splice(idx - 1, 0, a.splice(idx, 1)[0]); }, 'structure'); draw(); } }),
        iconBtn('down', 'تحريك لأسفل', () => { if (idx < last) { upd(s.id, null, (x) => { const a = x.content.rows; a.splice(idx + 1, 0, a.splice(idx, 1)[0]); }, 'structure'); draw(); } }),
        iconBtn('x', 'حذف البند', () => { upd(s.id, null, (x) => { x.content.rows = x.content.rows.filter((r) => r.key !== row.key); x.content.rows.forEach((r) => { r.args = (r.args || []).filter((a) => a !== row.key); }); }, 'structure'); draw(); }, 'danger'))));

    const unitFmt = () => el('div', { class: 'crow-opts' },
      el('input', { type: 'text', value: row.unit || '', placeholder: 'الوحدة (مثل: ريال)', 'aria-label': 'الوحدة', oninput: (e) => { upd(s.id, 'cu' + row.key, (x) => { rowOf(x, row.key).unit = e.target.value; }); refreshLive(); } }),
      el('select', { 'aria-label': 'طريقة العرض', onchange: (e) => { upd(s.id, null, (x) => { rowOf(x, row.key).fmt = e.target.value; }); refreshLive(); } }, el('option', { value: 'number', selected: row.fmt !== 'percent' }, 'رقم'), el('option', { value: 'percent', selected: row.fmt === 'percent' }, 'نسبة %')));

    if (row.kind !== 'calc') {
      card.append(el('div', { class: 'crow-body' },
        el('input', { type: 'text', inputmode: 'decimal', value: row.value || '', placeholder: 'القيمة، مثل: 500000', 'aria-label': 'قيمة ' + (row.label || row.key), class: 'cval', oninput: (e) => { upd(s.id, 'cv' + row.key, (x) => { rowOf(x, row.key).value = e.target.value; }); refreshLive(); } }), unitFmt()));
    } else {
      const body = el('div', { class: 'crow-body col' });
      const opSel = el('select', { 'aria-label': 'نوع العملية', onchange: (e) => {
        const op = e.target.value, prevOp = row.op;
        upd(s.id, null, (x) => {
          const r = rowOf(x, row.key); r.op = op; const o = x.content.rows.filter((q) => q.key !== r.key).map((q) => q.key);
          if (op === 'formula') { if (!r.formula) r.formula = (r.args || []).length ? r.args.join(RBC.OPS[prevOp] && prevOp === 'sub' ? ' - ' : prevOp === 'mul' ? ' * ' : prevOp === 'div' || prevOp === 'pct' ? ' / ' : ' + ') : (o.slice(0, 2).join(' - ')); }
          else {
            const need = RBC.OPS[op].min; r.args = (r.args || []).filter((a) => o.includes(a));
            if (RBC.OPS[op].max) r.args = r.args.slice(0, RBC.OPS[op].max);
            while (r.args.length < need && o.length) { const nxt = o.find((k) => !r.args.includes(k)); if (!nxt) break; r.args.push(nxt); }
          }
          if (op === 'pct') r.fmt = 'percent'; else if (prevOp === 'pct' && r.fmt === 'percent') r.fmt = 'number';
        }, 'structure'); draw();
      } }, Object.entries(RBC.OPS).map(([k, v]) => el('option', { value: k, selected: row.op === k }, v.name)));
      body.append(opSel);
      const argsBox = el('div', { class: 'cargs' });
      const sel = (i, label) => el('label', { class: 'carg' }, el('span', {}, label), el('select', { 'aria-label': label, onchange: (e) => { upd(s.id, null, (x) => { rowOf(x, row.key).args[i] = e.target.value; }); refreshLive(); } },
        el('option', { value: '' }, 'اختر بنداً...'), others().map((r) => el('option', { value: r.key, selected: (row.args || [])[i] === r.key }, optText(r)))));
      if (row.op === 'formula') {
        const f = el('input', { type: 'text', dir: 'ltr', style: 'text-align:left', value: row.formula || '', placeholder: 'مثال: (A - B) * 15%', 'aria-label': 'الصيغة', oninput: (e) => { upd(s.id, 'cf' + row.key, (x) => { rowOf(x, row.key).formula = e.target.value; }); refreshLive(); } });
        argsBox.append(f, el('p', { class: 'tip' }, 'استخدم رموز البنود: ' + others().map((r) => `${r.key} = ${r.label || 'بدون اسم'}`).join('  ·  ') + '. العمليات: + − × ÷ % وأقواس ( ).'));
      } else if (RBC.OPS[row.op] && RBC.OPS[row.op].max) {
        const lab = row.op === 'pct' ? ['الجزء (البسط)', 'الكل (المقام)'] : ['المقسوم', 'المقسوم عليه'];
        argsBox.append(sel(0, lab[0]), sel(1, lab[1]));
      } else {
        (row.args || []).forEach((a, i) => {
          const n = (row.args || []).length, min = RBC.OPS[row.op].min;
          argsBox.append(el('div', { class: 'carg-row' }, sel(i, row.op === 'sub' ? (i === 0 ? 'من' : 'ناقص') : row.op === 'mul' ? (i === 0 ? 'البند' : 'ضرب') : row.op === 'avg' ? 'بند' : (i === 0 ? 'البند' : 'زائد')),
            n > min ? iconBtn('x', 'إزالة البند من العملية', () => { upd(s.id, null, (x) => { rowOf(x, row.key).args.splice(i, 1); }, 'structure'); draw(); }, 'danger') : null));
        });
        argsBox.append(btn('إضافة بند للعملية', { icon: 'plus', cls: 'sm ghost', onclick: () => { const o = others().map((r) => r.key).find((k) => !(row.args || []).includes(k)); if (!o) { toast('لا توجد بنود أخرى لإضافتها', { tone: 'err' }); return; } upd(s.id, null, (x) => { rowOf(x, row.key).args.push(o); }, 'structure'); draw(); } }));
      }
      body.append(argsBox, unitFmt());
      card.append(body);
    }
    const sp = el('div', { class: 'calc-res', 'aria-live': 'polite' }); live[row.key] = sp; card.append(sp);
    return card;
  }

  function draw() {
    live = {};
    const rows = s.content.rows;
    const recipe = el('select', { 'aria-label': 'ابدأ من مثال جاهز', class: 'recipe', onchange: async (e) => {
      const id = e.target.value; e.target.value = ''; if (!id) return;
      if (rows.some((r) => r.kind !== 'calc' && String(r.value || '').trim()) && !(await confirmDialog({ title: 'استبدال البنود؟', text: 'سيتم استبدال البنود الحالية بالمثال المختار.', ok: 'استبدال' }))) return;
      upd(s.id, null, (x) => { x.content.rows = window.RBT.CALC_RECIPES[id].rows(); }, 'structure'); draw();
    } }, el('option', { value: '' }, 'ابدأ من مثال جاهز...'), Object.entries(window.RBT.CALC_RECIPES).map(([k, v]) => el('option', { value: k }, v.name)));
    wrap.replaceChildren(
      el('div', { class: 'hint', role: 'note' }, el('span', { html: icon('calculator', 16) }), el('span', {}, 'أضف بنوداً «مُدخلة» (أرقامك)، وبنوداً «محسوبة» تُحسب تلقائياً منها: المتبقي، النسبة، المجموع... وتتحدث النتيجة فور تغيير أي رقم.')),
      field('شكل العرض في التقرير', segmented([['table', 'جدول'], ['cards', 'بطاقات']], s.content.style || 'table', (v) => upd(s.id, null, (x) => { x.content.style = v; }), 'شكل العرض')),
      recipe,
      ...rows.map(rowCard),
      el('div', { class: 'btns' },
        btn('إضافة بند مُدخل', { icon: 'plus', cls: 'sm ghost', onclick: () => { const k = RBC.nextKey(rows); if (!k) { toast('الحد الأقصى 26 بنداً', { tone: 'err' }); return; } upd(s.id, null, (x) => x.content.rows.push({ key: k, label: '', kind: 'input', value: '', unit: '', fmt: 'number' }), 'structure'); draw(); } }),
        btn('إضافة نتيجة محسوبة', { icon: 'calculator', cls: 'sm', onclick: () => { const k = RBC.nextKey(rows); if (!k) { toast('الحد الأقصى 26 بنداً', { tone: 'err' }); return; } upd(s.id, null, (x) => { const o = x.content.rows.map((r) => r.key); x.content.rows.push({ key: k, label: '', kind: 'calc', op: 'sub', args: o.slice(0, 2), formula: '', unit: '', fmt: 'number' }); }, 'structure'); draw(); } })));
    refreshLive();
  }
  draw();
  return wrap;
}

/* ---------- مقارنة بين فترتين ---------- */
function compareEditor(s) {
  const RBC = window.RBC;
  const wrap = el('div', { class: 'cmp-ed' });
  let live = [], heads = {};
  const rowAt = (x, i) => x.content.rows[i];
  const refreshLive = () => s.content.rows.forEach((row, i) => {
    const sp = live[i]; if (!sp) return;
    const r = RBC.compareRows({ rows: [row] })[0], d = s.content.decimals == null ? 1 : s.content.decimals;
    if (!r || r.dir === 'na') { sp.textContent = 'أدخل القيمتين'; sp.className = 'cmp-res muted'; return; }
    const arrow = r.dir === 'up' ? '▲' : r.dir === 'down' ? '▼' : '■';
    sp.textContent = r.dir === 'flat' ? '■ لا تغيّر' : `${arrow} ${r.pct === null ? 'جديد (السابق صفر)' : RBC.fmtNum(Math.abs(r.pct), d) + '%'}  ·  ${r.change > 0 ? '+' : '−'}${RBC.fmtNum(Math.abs(r.change))}`;
    sp.className = 'cmp-res ' + (r.good === true ? 'good' : r.good === false ? 'bad' : 'flat');
  });
  function draw() {
    live = []; const L = s.content.labels, rows = s.content.rows;
    const lab = (k, ph) => el('input', { type: 'text', value: L[k], placeholder: ph, 'aria-label': ph, oninput: (e) => { upd(s.id, 'cl' + k, (x) => { x.content.labels[k] = e.target.value; }); if (heads[k]) heads[k].textContent = e.target.value || ph; } });
    heads = { prev: el('span', {}, L.prev || 'الفترة السابقة'), curr: el('span', {}, L.curr || 'الفترة الحالية') };
    wrap.replaceChildren(
      el('div', { class: 'hint', role: 'note' }, el('span', { html: icon('compare', 16) }), el('span', {}, 'أدخل قيمة كل بند في الفترتين، وتظهر نسبة الارتفاع أو الانخفاض والفرق تلقائياً. إذا كان الانخفاض هو الأفضل (كالمصروفات) اختر ذلك للبند ليُلوَّن بشكل صحيح.')),
      el('div', { class: 'two' }, field('اسم الفترة السابقة', lab('prev', 'السنة الماضية')), field('اسم الفترة الحالية', lab('curr', 'السنة الحالية'))),
      el('div', { class: 'btns' }, importButton(s)),
      el('div', { class: 'cmp-grid cmp-head' }, el('span', {}, 'البند'), heads.prev, heads.curr, el('span', {}, 'الوحدة'), el('span')),
      ...rows.map((row, i) => el('div', { class: 'cmp-card' },
        el('div', { class: 'cmp-grid' },
          el('input', { type: 'text', value: row.label, placeholder: 'اسم البند، مثل: التبرعات', 'aria-label': 'اسم البند ' + (i + 1), oninput: (e) => upd(s.id, 'cml' + i, (x) => { rowAt(x, i).label = e.target.value; }) }),
          el('input', { type: 'text', inputmode: 'decimal', value: row.prev, placeholder: '0', 'aria-label': 'قيمة ' + (L.prev || 'السابقة'), oninput: (e) => { upd(s.id, 'cmp' + i, (x) => { rowAt(x, i).prev = e.target.value; }); refreshLive(); } }),
          el('input', { type: 'text', inputmode: 'decimal', value: row.curr, placeholder: '0', 'aria-label': 'قيمة ' + (L.curr || 'الحالية'), oninput: (e) => { upd(s.id, 'cmc' + i, (x) => { rowAt(x, i).curr = e.target.value; }); refreshLive(); } }),
          el('input', { type: 'text', value: row.unit || '', placeholder: 'ريال', 'aria-label': 'الوحدة', oninput: (e) => upd(s.id, 'cmu' + i, (x) => { rowAt(x, i).unit = e.target.value; }) }),
          el('div', { class: 'gact' },
            iconBtn('up', 'تحريك لأعلى', () => { if (i > 0) { upd(s.id, null, (x) => { const a = x.content.rows; a.splice(i - 1, 0, a.splice(i, 1)[0]); }, 'structure'); draw(); } }),
            iconBtn('down', 'تحريك لأسفل', () => { if (i < rows.length - 1) { upd(s.id, null, (x) => { const a = x.content.rows; a.splice(i + 1, 0, a.splice(i, 1)[0]); }, 'structure'); draw(); } }),
            iconBtn('x', 'حذف البند', () => { upd(s.id, null, (x) => { if (x.content.rows.length > 1) x.content.rows.splice(i, 1); else x.content.rows[0] = { label: '', prev: '', curr: '', unit: '', better: 'up' }; }, 'structure'); draw(); }, 'danger'))),
        el('div', { class: 'cmp-sub' },
          el('select', { 'aria-label': 'الاتجاه الأفضل', onchange: (e) => { upd(s.id, null, (x) => { rowAt(x, i).better = e.target.value; }); refreshLive(); } }, el('option', { value: 'up', selected: row.better !== 'down' }, 'الارتفاع أفضل'), el('option', { value: 'down', selected: row.better === 'down' }, 'الانخفاض أفضل')),
          (live[i] = el('span', { class: 'cmp-res', 'aria-live': 'polite' }))))),
      btn('إضافة بند', { icon: 'plus', cls: 'sm ghost', onclick: () => { if (rows.length >= 12) { toast('الحد الأقصى 12 بنداً', { tone: 'err' }); return; } upd(s.id, null, (x) => x.content.rows.push({ label: '', prev: '', curr: '', unit: '', better: 'up' }), 'structure'); draw(); } }),
      el('div', { class: 'cmp-opts' },
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.content.chart !== false, onchange: (e) => upd(s.id, null, (x) => { x.content.chart = e.target.checked; }) }), 'رسم بياني للمقارنة'),
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.content.summary !== false, onchange: (e) => upd(s.id, null, (x) => { x.content.summary = e.target.checked; }) }), 'جُمل تلخيصية تلقائية'),
        el('label', { class: 'chk' }, 'عدد المنازل العشرية للنسبة: ', segmented([[0, '0'], [1, '1'], [2, '2']], s.content.decimals == null ? 1 : s.content.decimals, (v) => { upd(s.id, null, (x) => { x.content.decimals = v; }); refreshLive(); }, 'المنازل العشرية'))));
    refreshLive();
  }
  draw();
  return wrap;
}

function calloutEditor(s) {
  return el('div', {}, field('نوع الملاحظة', segmented([['info', 'معلومة'], ['success', 'إيجابية'], ['warn', 'تنبيه']], s.content.tone, (v) => upd(s.id, null, (x) => { x.content.tone = v; }), 'نوع الملاحظة')),
    field('النص', el('textarea', { rows: 4, oninput: (e) => upd(s.id, 'co', (x) => { x.content.text = e.target.value; }), 'aria-label': 'نص الملاحظة' }, s.content.text || '')));
}

/* ---------- المحرر الكامل لقسم ---------- */
export function sectionEditor(s) {
  const body = {
    text: () => richText(s), list: () => listEditor(s), table: () => tableEditor(s), kpi: () => kpiEditor(s), chart: () => chartEditor(s),
    progress: () => progressEditor(s), gantt: () => ganttEditor(s), calc: () => calcEditor(s), compare: () => compareEditor(s), timeline: () => timelineEditor(s), image: () => imageEditor(s), callout: () => calloutEditor(s),
    pagebreak: () => el('div', { class: 'empty-note' }, 'سيبدأ المحتوى بعد هذا الفاصل في صفحة جديدة.'),
  }[s.type]();
  const info = T.BLOCKS[s.type];
  return el('div', { class: 'sec-ed' },
    el('div', { class: 'ed-head' }, el('span', { class: 'ed-ic', html: icon(info.icon, 20) }), el('div', {}, el('h2', {}, s.title || info.name), el('p', { class: 'muted' }, info.name))),
    s.hint ? el('div', { class: 'hint', role: 'note' }, el('span', { html: icon('sparkle', 16) }), el('span', {}, s.hint)) : null,
    s.type === 'pagebreak' ? null : field('عنوان القسم', textInput(s.title, (v) => { upd(s.id, 'title', (x) => { x.title = v; }, 'titles'); const h = document.querySelector('.ed-head h2'); if (h) h.textContent = v || info.name; }, { ph: 'مثال: ' + info.name })),
    body,
    ['pagebreak', 'text', 'callout'].includes(s.type) ? null : el('div', { class: 'two' }, field('مصدر البيانات (اختياري)', textInput(s.source || '', (v) => upd(s.id, 'src', (x) => { x.source = v; }), { ph: 'مثال: النظام المالي' })), field('آخر تحديث للأرقام', textInput(s.asOf || '', (v) => upd(s.id, 'asof', (x) => { x.asOf = v; }), { type: 'date' }))),
    s.type === 'pagebreak' ? null : field('أيقونة بجانب العنوان (اختياري)', iconButton(s.icon || '', (v) => upd(s.id, null, (x) => { x.icon = v; }), { title: 'اختيار أيقونة للقسم', dialogTitle: 'أيقونة القسم' }), 'تظهر بجوار عنوان القسم في التقرير.'),
    s.type === 'pagebreak' ? null : field('عرض القسم في الصفحة', segmented([['full', 'عرض كامل'], ['half', 'نصف العرض']], s.width, (v) => upd(s.id, null, (x) => { x.width = v; }, 'structure'), 'عرض القسم'), 'القسمان المتجاوران بنصف العرض يُعرضان جنباً إلى جنب.'));
}

/* ---------- معلومات التقرير ---------- */
export function metaEditor(invalid) {
  const r = store.report;
  const m = (k, v, kind) => edit((rep) => { rep[k] = v; }, 'm:' + k, kind || 'content');
  const title = textInput(r.title, (v) => { m('title', v, 'titles'); title.removeAttribute('aria-invalid'); }, { ph: 'مثال: التقرير الشهري لإدارة تقنية المعلومات', invalid });
  return el('div', { class: 'sec-ed' },
    el('div', { class: 'ed-head' }, el('span', { class: 'ed-ic', html: icon('file', 20) }), el('div', {}, el('h2', {}, 'معلومات التقرير'), el('p', { class: 'muted' }, 'تظهر في الغلاف وترويسة الصفحات'))),
    el('div', { class: 'hint', role: 'note' }, el('span', { html: icon('sparkle', 16) }), el('span', {}, 'ابدأ بالعنوان واسم المُعِدّ، ثم انتقل لتعبئة الأقسام من لوحة «الأقسام».')),
    field('عنوان التقرير *', title),
    field('عنوان فرعي', textInput(r.subtitle, (v) => m('subtitle', v), { ph: 'اختياري' })),
    el('div', { class: 'two' },
      field('الفترة', textInput(r.period, (v) => m('period', v), { ph: 'مثال: الربع الأول 2026' })),
      field('التاريخ', textInput(r.date, (v) => m('date', v), { type: 'date' }))),
    el('div', { class: 'two' },
      field('اسم الموظف / المُعِدّ *', textInput(r.employee, (v) => m('employee', v))),
      field('الإدارة / القسم', textInput(r.department, (v) => m('department', v)))));
}
