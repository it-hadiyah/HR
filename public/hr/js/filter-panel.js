// لوحة فلترة متقدمة: بحث، شرائح ذكية بعدّادات حيّة، قوائم متعددة الاختيار، نطاقات رقمية وتواريخ،
// شارات للفلاتر الفعّالة، وعروض محفوظة ورابط مشاركة. تُنتج مواصفة JSON واحدة يفهمها الخادم.
import { h } from './core.js';

export const emptySpec = () => ({ sector: [], department: [], section: [], job: [], q: '', hire_from: '', hire_to: '', ranges: {}, segments: [], segMode: 'all', missing: [] });
export const normalizeSpec = raw => {
  const e = emptySpec(); if (!raw || typeof raw !== 'object') return e;
  for (const k of ['sector', 'department', 'section', 'job', 'segments', 'missing']) if (Array.isArray(raw[k])) e[k] = raw[k].map(String);
  e.q = String(raw.q || ''); e.hire_from = raw.hire_from || ''; e.hire_to = raw.hire_to || ''; e.segMode = raw.segMode === 'any' ? 'any' : 'all';
  if (raw.ranges && typeof raw.ranges === 'object') for (const [k, v] of Object.entries(raw.ranges)) if (Array.isArray(v) && (v[0] !== null && v[0] !== '' || v[1] !== null && v[1] !== '')) e.ranges[k] = [v[0] ?? null, v[1] ?? null];
  return e;
};
export const specCount = s => ['sector', 'department', 'section', 'job', 'segments', 'missing'].reduce((a, k) => a + s[k].length, 0) + Object.keys(s.ranges).length + (s.q ? 1 : 0) + (s.hire_from || s.hire_to ? 1 : 0);

const RANGE_LABEL = { total: 'الرصيد الكلي (يوم)', annual: 'الرصيد السنوي (يوم)', used: 'المستخدم (يوم)', target: 'المستهدف (يوم)', remaining: 'المتبقي للمستهدف (يوم)', progress: 'نسبة التقدم نحو المستهدف %', service: 'سنوات الخدمة',
  salary: 'الراتب الإجمالي (ر.س)', cost: 'التكلفة المالية للرصيد (ر.س)' };
const MULTI = [['sector', 'القطاع'], ['department', 'الإدارة'], ['section', 'القسم'], ['job', 'المسمى الوظيفي']];

/** قائمة منسدلة متعددة الاختيار مع بحث وعدّادات */
function multiSelect(label, options, selected, onChange) {
  const btn = h('button', { type: 'button', class: 'ms-btn' }), pop = h('div', { class: 'ms-pop', hidden: true }), list = h('div', { class: 'ms-list' });
  const search = h('input', { type: 'search', placeholder: 'بحث…', 'aria-label': 'بحث في ' + label });
  const sel = new Set(selected);
  const paint = () => { btn.replaceChildren(label, sel.size ? h('b', { class: 'ms-n' }, String(sel.size)) : '', h('span', { class: 'ms-caret' }, '▾')); btn.classList.toggle('on', sel.size > 0); };
  const draw = () => {
    const t = search.value.trim();
    list.replaceChildren(...options.filter(o => !t || String(o.value).includes(t)).map(o => h('label', { class: 'ms-opt' },
      h('input', { type: 'checkbox', checked: sel.has(o.value), onchange: e => { e.target.checked ? sel.add(o.value) : sel.delete(o.value); paint(); onChange([...sel]); } }),
      h('span', null, String(o.value)), h('small', null, String(o.count)))));
    if (!list.children.length) list.append(h('div', { class: 'ms-empty' }, 'لا نتائج'));
  };
  search.addEventListener('input', draw);
  pop.append(search, h('div', { class: 'ms-acts' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { sel.clear(); paint(); draw(); onChange([]); } }, 'مسح')), list);
  btn.addEventListener('click', () => { pop.hidden = !pop.hidden; if (!pop.hidden) { draw(); search.focus(); } });
  document.addEventListener('click', e => { if (!pop.hidden && !wrap.contains(e.target)) pop.hidden = true; });
  const wrap = h('div', { class: 'ms' }, btn, pop); paint();
  return wrap;
}

/**
 * createFilterPanel({ facets, spec, fin, viewsKey, onChange(spec) , shareUrl() })
 * يعيد { el, getSpec, setSpec }
 */
export function createFilterPanel({ facets, spec: initial, fin, viewsKey = 'hr.views', onChange, shareUrl }) {
  let spec = normalizeSpec(initial);
  const el = h('div', { class: 'card fpanel no-print' });
  let timer;
  const emit = () => { clearTimeout(timer); timer = setTimeout(() => onChange(spec), 300); };
  const set = (mut, redraw = true) => { mut(spec); if (redraw) draw(); emit(); };
  const loadViews = () => { try { return JSON.parse(localStorage.getItem(viewsKey) || '[]'); } catch { return []; } };
  const saveViews = v => { try { localStorage.setItem(viewsKey, JSON.stringify(v.slice(0, 30))); } catch { /* التخزين غير متاح */ } };

  function chips() {
    const out = [];
    const chip = (text, clear) => out.push(h('span', { class: 'fchip' }, text, h('button', { type: 'button', 'aria-label': 'إزالة', onclick: () => set(clear) }, '×')));
    for (const [k, lbl] of MULTI) if (spec[k].length) chip(`${lbl}: ${spec[k].slice(0, 2).join('، ')}${spec[k].length > 2 ? ` +${spec[k].length - 2}` : ''}`, s => { s[k] = []; });
    for (const id of spec.segments) chip(facets.segments.find(s => s.id === id)?.label || id, s => { s.segments = s.segments.filter(x => x !== id); });
    for (const [k, [lo, hi]] of Object.entries(spec.ranges)) chip(`${RANGE_LABEL[k]?.replace(/ \(.*\)| %/g, '') || k}: ${lo ?? '…'} – ${hi ?? '…'}`, s => { delete s.ranges[k]; });
    if (spec.q) chip(`بحث: ${spec.q}`, s => { s.q = ''; });
    if (spec.hire_from || spec.hire_to) chip(`تاريخ التعيين: ${spec.hire_from || '…'} → ${spec.hire_to || '…'}`, s => { s.hire_from = s.hire_to = ''; });
    if (spec.missing.length) chip('ناقص: ' + spec.missing.map(v => facets.missing.find(m => m.value === v)?.label || v).join('، '), s => { s.missing = []; });
    return out;
  }

  function draw() {
    const views = loadViews();
    const q = h('input', { type: 'search', value: spec.q, placeholder: 'بحث بالاسم أو الرقم الوظيفي أو المسمى…', 'aria-label': 'بحث', class: 'fq' });
    q.addEventListener('input', () => { spec.q = q.value; emit(); });
    const viewSel = h('select', { 'aria-label': 'عروض محفوظة', onchange: e => { const v = views.find(x => x.name === e.target.value); if (v) { spec = normalizeSpec(v.spec); draw(); onChange(spec); } } },
      h('option', { value: '' }, views.length ? 'العروض المحفوظة…' : 'لا عروض محفوظة'), ...views.map(v => h('option', { value: v.name }, v.name)));
    const segChips = facets.segments.filter(s => fin || !s.fin).map(s => h('button', { type: 'button', class: 'seg' + (spec.segments.includes(s.id) ? ' on' : '') + (s.count === 0 ? ' zero' : ''), title: s.count + ' موظف',
      onclick: () => set(x => { x.segments = x.segments.includes(s.id) ? x.segments.filter(i => i !== s.id) : [...x.segments, s.id]; }) }, s.label, h('b', null, String(s.count))));
    const modeSw = spec.segments.length > 1 ? h('div', { class: 'seg-mode' }, 'المطابقة:', ...[['all', 'كل الشرائح معاً'], ['any', 'أيٌّ منها']].map(([v, t]) => h('button', { type: 'button', class: spec.segMode === v ? 'on' : '', onclick: () => set(x => { x.segMode = v; }) }, t))) : null;

    const rangeInput = (k, idx) => h('input', { type: 'text', inputmode: 'decimal', value: spec.ranges[k]?.[idx] ?? '', placeholder: idx ? 'إلى' : 'من', class: 'rin', 'aria-label': `${RANGE_LABEL[k]} ${idx ? 'إلى' : 'من'}`,
      oninput: e => { const v = e.target.value.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').trim(); const cur = spec.ranges[k] || [null, null]; cur[idx] = v === '' || Number.isNaN(Number(v)) ? null : Number(v);
        if (cur[0] === null && cur[1] === null) delete spec.ranges[k]; else spec.ranges[k] = cur; emit(); }, onchange: () => draw() });
    const rangeFields = Object.keys(RANGE_LABEL).filter(k => facets.ranges?.[k] && (fin || !['salary', 'cost'].includes(k)));
    const adv = h('details', { class: 'fadv', open: specCount({ ...emptySpec(), ...spec, segments: [], q: '' }) > 0 },
      h('summary', null, 'فلاتر متقدمة', specCount({ ...spec, segments: [], q: '' }) ? h('b', { class: 'ms-n' }, String(specCount({ ...spec, segments: [], q: '' }))) : ''),
      h('div', { class: 'fgrid' },
        h('div', { class: 'fgroup' }, h('h4', null, 'الهيكل والوظيفة'), h('div', { class: 'fms' }, ...MULTI.map(([k, lbl]) => multiSelect(lbl, facets[k] || [], spec[k], v => { spec[k] = v; chipsBox.replaceChildren(...chips()); emit(); })))),
        h('div', { class: 'fgroup' }, h('h4', null, 'تاريخ التعيين'), h('div', { class: 'row center' },
          h('input', { type: 'date', value: spec.hire_from, min: facets.hire?.min, max: facets.hire?.max, 'aria-label': 'من تاريخ', onchange: e => set(x => { x.hire_from = e.target.value; }) }), '←',
          h('input', { type: 'date', value: spec.hire_to, min: facets.hire?.min, max: facets.hire?.max, 'aria-label': 'إلى تاريخ', onchange: e => set(x => { x.hire_to = e.target.value; }) }))),
        h('div', { class: 'fgroup wide' }, h('h4', null, 'نطاقات رقمية'), h('div', { class: 'franges' }, ...rangeFields.map(k => h('div', { class: 'frange' }, h('span', null, RANGE_LABEL[k]), rangeInput(k, 0), rangeInput(k, 1),
          h('small', null, `${facets.ranges[k].min} – ${facets.ranges[k].max}`))))),
        h('div', { class: 'fgroup' }, h('h4', null, 'بيانات ناقصة في'), h('div', { class: 'row', style: { gap: '6px' } }, ...facets.missing.map(m => h('button', { type: 'button', class: 'seg' + (spec.missing.includes(m.value) ? ' on' : ''),
          onclick: () => set(x => { x.missing = x.missing.includes(m.value) ? x.missing.filter(i => i !== m.value) : [...x.missing, m.value]; }) }, m.label, h('b', null, String(m.count))))))));
    const chipsBox = h('div', { class: 'fchips' }, ...chips());
    const n = specCount(spec);
    el.replaceChildren(
      h('div', { class: 'row center fbar' }, q, viewSel,
        h('button', { type: 'button', class: 'btn sm', onclick: () => { const name = prompt('اسم العرض المحفوظ:'); if (!name) return; const v = loadViews().filter(x => x.name !== name); v.unshift({ name: name.trim().slice(0, 40), spec }); saveViews(v); draw(); } }, 'حفظ العرض'),
        views.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => { const name = viewSel.value; if (!name) return; saveViews(loadViews().filter(x => x.name !== name)); draw(); } }, 'حذف المحدد') : null,
        shareUrl ? h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(shareUrl(spec)); alert('تم نسخ رابط العرض بالمرشحات الحالية'); } catch { prompt('انسخ الرابط:', shareUrl(spec)); } } }, 'نسخ الرابط') : null,
        h('div', { class: 'spacer' }), h('button', { type: 'button', class: 'btn sm danger', onclick: () => { spec = emptySpec(); draw(); onChange(spec); } }, n ? `مسح كل الفلاتر (${n})` : 'مسح الفلاتر')),
      h('div', { class: 'fsegs' }, h('span', { class: 'flabel' }, 'شرائح ذكية'), ...segChips, modeSw),
      adv, chipsBox);
  }
  draw();
  return { el, getSpec: () => spec, setSpec: s => { spec = normalizeSpec(s); draw(); } };
}
