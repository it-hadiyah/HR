// أدوات مشتركة: بناء DOM آمن، استدعاء الـ API، التنسيق، النوافذ، الجداول.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const state = { user: null, filters: loadFilters(), hijri: localStorage.getItem('hijri') === '1' };

function loadFilters() {
  const y = new Date().getFullYear();
  try { return { year: y, ...JSON.parse(sessionStorage.getItem('filters') || '{}') }; } catch { return { year: y }; }
}
export function setFilters(f) {
  state.filters = { ...state.filters, ...f };
  for (const k of Object.keys(state.filters)) if (state.filters[k] === '' || state.filters[k] === null || state.filters[k] === undefined) delete state.filters[k];
  sessionStorage.setItem('filters', JSON.stringify(state.filters));
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opt);
  if (res.status === 401 && !path.startsWith('/auth/')) { state.user = null; location.hash = '#/login'; throw new Error('انتهت الجلسة'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || 'حدث خطأ');
  return data;
}

export const qs = obj => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

// ---- التنسيق ----
const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
const nfDays = nf(0, 1), nfSar = nf(0, 0), nfPct = nf(0, 1), nfInt = nf(0, 0);
export const fmt = {
  days: v => (v === null || v === undefined ? '—' : nfDays.format(v)),
  sar: v => (v === null || v === undefined ? '—' : nfSar.format(v)),
  pct: v => (v === null || v === undefined ? '—' : nfPct.format(v) + '%'),
  int: v => (v === null || v === undefined ? '—' : nfInt.format(v)),
  date(s) {
    if (!s) return '—';
    if (!state.hijri) return s;
    try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(s + 'T12:00:00Z')); } catch { return s; }
  },
};
export const num = text => h('span', { class: 'num' }, text);

export function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}
export const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

export function modal(title, body, { onSave, saveText = 'حفظ', wide } = {}) {
  const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } });
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const err = h('div', { class: 'err', role: 'alert' });
  const save = onSave && h('button', { class: 'btn primary', onclick: async () => {
    err.textContent = '';
    save.disabled = true;
    try { const r = await onSave(); if (r !== false) close(); } catch (e) { err.textContent = e.message; } finally { save.disabled = false; }
  } }, saveText);
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: wide ? { width: 'min(1000px,100%)' } : null },
    h('h2', null, title), body, err, h('div', { class: 'foot' }, save, h('button', { class: 'btn', onclick: close }, onSave ? 'إلغاء' : 'إغلاق')));
  bg.append(box);
  document.body.append(bg);
  const first = box.querySelector('input,select,textarea');
  if (first) first.focus();
  return close;
}
export const confirmBox = (msg, onYes, danger = true) => modal('تأكيد', h('p', null, msg), { onSave: onYes, saveText: danger ? 'تأكيد' : 'موافق' });

export function field(label, input, cls) { return h('label', { class: 'f ' + (cls || '') }, label, input); }
export function select(options, value, attrs = {}) {
  const s = h('select', attrs, options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, t); }));
  return s;
}

// ---- جدول عام قابل للفرز ----
// columns: [{key,label,fmt?,render?(row),num?,sortable?}]
export function table(columns, rows, { onRow, totals, empty = 'لا توجد بيانات', sortKey, initialSort } = {}) {
  let sort = initialSort || null;
  const wrap = h('div', { class: 'tbl-wrap' });
  const draw = () => {
    let data = [...rows];
    if (sort) {
      const { key, dir } = sort;
      data.sort((a, b) => {
        const x = valueOf(a, key), y = valueOf(b, key);
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * dir;
      });
    }
    if (rows.length === 0) { wrap.replaceChildren(h('div', { class: 'empty' }, empty)); return; }
    const head = h('tr', null, columns.map(c => h('th', {
      class: (c.num ? 'numc ' : '') + (c.sortable === false ? '' : 'sortable'),
      onclick: c.sortable === false ? null : () => { sort = sort && sort.key === c.key ? { key: c.key, dir: -sort.dir } : { key: c.key, dir: 1 }; draw(); },
      'aria-sort': sort && sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : null,
    }, c.label, sort && sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')));
    const bodyRows = data.map(r => h('tr', {
      class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null, tabindex: onRow ? 0 : null,
      onkeydown: onRow ? e => { if (e.key === 'Enter') onRow(r); } : null,
    }, columns.map(c => h('td', { class: c.num ? 'numc' : '' }, cell(c, r)))));
    const foot = totals && h('tfoot', null, h('tr', null, columns.map((c, i) =>
      h('td', { class: c.num ? 'numc' : '' }, i === 0 ? 'الإجمالي' : (totals[c.key] !== undefined ? cell(c, totals) : '')))));
    wrap.replaceChildren(h('table', null, h('thead', null, head), h('tbody', null, bodyRows), foot));
  };
  const valueOf = (r, key) => { const c = columns.find(x => x.key === key); return c && c.sortValue ? c.sortValue(r) : r[key]; };
  const cell = (c, r) => {
    if (c.render) return c.render(r);
    const v = r[c.key];
    if (c.fmt) return num(fmt[c.fmt](v));
    return v ?? '—';
  };
  draw();
  return wrap;
}

export function progressBar(pct, status) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const cls = status === 'achieved' ? '' : status === 'lagging' ? 'bad' : 'warn';
  return h('div', { class: 'progress ' + cls, title: fmt.pct(pct) }, h('i', { style: { width: p + '%' } }));
}

export const STATUS_LABEL = { achieved: ['محقق', 'ok'], lagging: ['متأخر', 'bad'], at_risk: ['معرّض للخطر', 'warn'], none: ['بلا مستهدف', ''] };
export const statusBadge = s => { const [t, c] = STATUS_LABEL[s] || STATUS_LABEL.none; return h('span', { class: 'badge ' + c }, t); };
export const EMP_STATUS = { active: 'نشط', suspended: 'موقوف', terminated: 'منتهي الخدمة' };
export const UNIT_TYPE = { org: 'المنشأة', sector: 'قطاع', department: 'إدارة', section: 'قسم' };
export const TARGET_TYPES = {
  max_year_end_balance: 'أقصى رصيد بنهاية السنة (أيام)',
  days_to_use: 'عدد الأيام المطلوب استخدامها خلال الفترة',
  reduction_pct: 'نسبة تخفيض من الرصيد (%)',
  financial_target: 'قيمة مالية مستهدفة (ر.س)',
  usage_plan_pct: 'نسبة الالتزام بخطة الاستخدام من الاستحقاق السنوي (%)',
};

export function download(path) { window.location.href = '/api' + path; }
