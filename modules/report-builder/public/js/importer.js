// استيراد البيانات من Excel (.xlsx) أو CSV أو اللصق، مع معاينة وتحقق قبل التطبيق
import { el, btn, modal, toast } from './ui.js';
import { upd } from './editors.js';
import { emit } from './store.js';

const MAX_ROWS = 200, MAX_COLS = 12;

/* ---------- CSV / نص ملصوق ---------- */
export function parseDelimited(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const d = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const delim = counts[d] ? d : ',';
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; }
    else if (ch === '"') inq = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/* ---------- XLSX (zip + xml) بلا مكتبات ---------- */
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('الملف ليس بصيغة xlsx صحيحة');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { method, csize, off };
    p += 46 + nl + xl + cl;
  }
  const read = async (name) => {
    const f = files[name]; if (!f) return null;
    const ln = dv.getUint16(f.off + 26, true), lx = dv.getUint16(f.off + 28, true), st = f.off + 30 + ln + lx;
    const raw = u8.subarray(st, st + f.csize);
    const out = f.method === 0 ? raw : await inflate(raw);
    return new TextDecoder().decode(out);
  };
  return { names: Object.keys(files), read };
}
const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export async function parseXlsx(buf) {
  const z = await unzip(buf);
  const dom = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const ss = [];
  const sstXml = await z.read('xl/sharedStrings.xml');
  if (sstXml) dom(sstXml).querySelectorAll('si').forEach((si) => ss.push(Array.from(si.querySelectorAll('t')).map((t) => t.textContent).join('')));
  const sheetName = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))[0];
  if (!sheetName) throw new Error('لا توجد ورقة بيانات في الملف');
  const doc = dom(await z.read(sheetName));
  const rows = [];
  doc.querySelectorAll('sheetData > row').forEach((r) => {
    const out = [];
    r.querySelectorAll('c').forEach((c) => {
      const t = c.getAttribute('t'), v = c.querySelector('v'), is = c.querySelector('is');
      let val = '';
      if (t === 's' && v) val = ss[parseInt(v.textContent, 10)] || '';
      else if (t === 'inlineStr' && is) val = Array.from(is.querySelectorAll('t')).map((x) => x.textContent).join('');
      else if (t === 'b' && v) val = v.textContent === '1' ? 'نعم' : 'لا';
      else if (v) { const num = parseFloat(v.textContent); val = Number.isFinite(num) ? String(Math.round(num * 1e6) / 1e6) : v.textContent; }
      out[colIdx(c.getAttribute('r') || 'A1')] = String(val).trim();
    });
    for (let i = 0; i < out.length; i++) if (out[i] == null) out[i] = '';
    rows.push(out);
  });
  return rows.filter((r) => r.some((c) => c !== ''));
}

/* ---------- تنظيف وتحقق ---------- */
const AR = '٠١٢٣٤٥٦٧٨٩', toEn = (s) => String(s).replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/٫/g, '.').replace(/٬/g, ',');
const isNum = (v) => { const t = toEn(v).replace(/[,\s٬]/g, '').replace(/%$/, ''); return t !== '' && Number.isFinite(Number(t)); };
const cleanNum = (v) => { if (!isNum(v)) return String(v); return toEn(v).replace(/[,\s]/g, '').replace(/%$/, ''); };
export function analyze(rows, hasHeader, maxRows = MAX_ROWS) {
  const body = hasHeader ? rows.slice(1) : rows, w = Math.max(0, ...rows.map((r) => r.length));
  const cols = Array.from({ length: w }, (_, c) => {
    const vals = body.map((r) => r[c] || '').filter((x) => x !== '');
    const nums = vals.filter(isNum).length;
    return { numeric: vals.length > 0 && nums / vals.length >= 0.8, filled: vals.length, bad: vals.length - nums };
  });
  const issues = [];
  if (body.length > maxRows) issues.push(`الصفوف أكثر من ${maxRows}: سيُستورد أول ${maxRows} فقط.`);
  if (w > MAX_COLS) issues.push(`الأعمدة أكثر من ${MAX_COLS}: سيُستورد أول ${MAX_COLS} فقط.`);
  return { body, cols, issues, w };
}

/* ---------- نافذة الاستيراد ---------- */
const TARGETS = {
  table: { title: 'استيراد إلى الجدول', max: 200, roles: [] },
  chart: { title: 'استيراد إلى الرسم', max: 60, roles: [['label', 'عمود التسمية'], ['value', 'عمود القيمة (رقم)', true]] },
  kpi: { title: 'استيراد المؤشرات', max: 24, roles: [['label', 'عمود التسمية'], ['value', 'عمود القيمة'], ['trend', 'عمود التغيّر (اختياري)', false, true]] },
  compare: { title: 'استيراد المقارنة', max: 12, roles: [['label', 'عمود البند'], ['prev', 'عمود الفترة السابقة (رقم)', true], ['curr', 'عمود الفترة الحالية (رقم)', true]] },
};

export function importDialog(s, onDone) {
  const T = TARGETS[s.type]; if (!T) return;
  let rows = [], hasHeader = true, map = {};
  const status = el('p', { class: 'tip' }, 'ارفع ملف Excel (xlsx) أو CSV، أو الصق جدولاً منسوخاً من Excel.');
  const prev = el('div', { class: 'imp-prev' }), maps = el('div', { class: 'imp-maps' }), issuesBox = el('div', { class: 'imp-issues' });
  const ta = el('textarea', { rows: 4, placeholder: 'الصق هنا بيانات منسوخة من Excel أو CSV…', 'aria-label': 'لصق البيانات', dir: 'auto' });
  const file = el('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt', 'aria-label': 'اختيار ملف' });
  const hdr = el('input', { type: 'checkbox', checked: true });
  const okBtn = btn('استيراد', { cls: 'primary', onclick: apply, disabled: true });
  let m;

  function refresh() {
    const a = analyze(rows, hasHeader, T.max);
    prev.replaceChildren(); maps.replaceChildren(); issuesBox.replaceChildren();
    okBtn.disabled = !rows.length;
    if (!rows.length) return;
    const t = el('table', { class: 'grid' });
    rows.slice(0, 7).forEach((r, i) => t.append(el('tr', {}, Array.from({ length: Math.min(a.w, MAX_COLS) }, (_, c) => el(i === 0 && hasHeader ? 'th' : 'td', {}, r[c] || '')))));
    prev.append(el('div', { class: 'tscroll' }, t), el('p', { class: 'tip' }, `${a.body.length} صفاً × ${a.w} أعمدة${rows.length > 7 ? ' (معاينة أول 6 صفوف)' : ''}`));
    const opts = (needNum) => Array.from({ length: Math.min(a.w, MAX_COLS) }, (_, c) => [String(c), (hasHeader && rows[0][c] ? rows[0][c] : 'عمود ' + (c + 1)) + (needNum && !a.cols[c].numeric ? ' ⚠' : '')]);
    T.roles.forEach(([key, label, needNum, optional], k) => {
      if (map[key] == null || map[key] >= a.w) map[key] = optional ? '' : String(Math.min(k === 0 ? 0 : (needNum ? Math.max(1, a.cols.findIndex((c, ci) => ci > 0 && c.numeric)) : k), a.w - 1));
      const sel = el('select', { 'aria-label': label, onchange: (e) => { map[key] = e.target.value; refresh(); } }, optional ? el('option', { value: '' }, '— بدون —') : null, opts(needNum).map(([v, tx]) => el('option', { value: v, selected: map[key] === v }, tx)));
      maps.append(el('label', { class: 'imp-map' }, el('span', {}, label), sel));
      if (needNum && map[key] !== '' && !a.cols[+map[key]].numeric) a.issues.push(`«${label}» يحتوي قيماً غير رقمية (${a.cols[+map[key]].bad}) وستُهمل أو تبقى فارغة.`);
    });
    const dups = new Set(); if (T.roles.length) { const seen = new Set(); a.body.forEach((r) => { const l = r[+map.label]; if (l && seen.has(l)) dups.add(l); seen.add(l); }); }
    if (dups.size) a.issues.push('تسميات مكررة: ' + Array.from(dups).slice(0, 4).join('، '));
    a.issues.forEach((x) => issuesBox.append(el('p', { class: 'imp-warn' }, '⚠ ' + x)));
    if (!a.issues.length) issuesBox.append(el('p', { class: 'imp-ok' }, '✓ البيانات سليمة وجاهزة للاستيراد'));
  }
  const load = (r, msg) => { rows = r; map = {}; status.textContent = msg; refresh(); };
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      if (/\.xlsx$/i.test(f.name)) load(await parseXlsx(await f.arrayBuffer()), `تمت قراءة «${f.name}» (الورقة الأولى).`);
      else load(parseDelimited(await f.text()), `تمت قراءة «${f.name}».`);
    } catch (e) { rows = []; status.textContent = 'تعذّرت قراءة الملف: ' + (e.message || e); refresh(); }
  });
  ta.addEventListener('input', () => load(parseDelimited(ta.value), 'تمت قراءة النص الملصوق.'));
  hdr.addEventListener('change', () => { hasHeader = hdr.checked; map = {}; refresh(); });

  function apply() {
    const a = analyze(rows, hasHeader, T.max);
    const body = a.body.slice(0, T.max).map((r) => r.slice(0, MAX_COLS));
    const g = (r, k) => (map[k] === '' || map[k] == null ? '' : r[+map[k]] || '');
    upd(s.id, null, (x) => {
      if (x.type === 'table') {
        const w = Math.min(a.w, MAX_COLS);
        x.content.headers = hasHeader ? Array.from({ length: w }, (_, c) => rows[0][c] || '') : Array(w).fill('');
        x.content.rows = body.map((r) => Array.from({ length: w }, (_, c) => (r[c] || '')));
        if (!x.content.rows.length) x.content.rows = [Array(w).fill('')];
      } else if (x.type === 'chart') {
        x.content.data = body.filter((r) => g(r, 'label') || g(r, 'value')).map((r) => ({ label: g(r, 'label'), value: cleanNum(g(r, 'value')) }));
      } else if (x.type === 'kpi') {
        x.content.items = body.filter((r) => g(r, 'label') || g(r, 'value')).map((r) => ({ icon: '', label: g(r, 'label'), value: g(r, 'value'), trend: g(r, 'trend') }));
      } else if (x.type === 'compare') {
        x.content.rows = body.filter((r) => g(r, 'label')).map((r) => ({ label: g(r, 'label'), prev: cleanNum(g(r, 'prev')), curr: cleanNum(g(r, 'curr')), unit: '', better: 'up' }));
        if (hasHeader) x.content.labels = { prev: rows[0][+map.prev] || x.content.labels.prev, curr: rows[0][+map.curr] || x.content.labels.curr };
      }
    }, 'structure');
    m.close(); toast('تم استيراد البيانات'); if (onDone) onDone(); emit('select');
  }

  const body = el('div', { class: 'imp' }, status, el('div', { class: 'imp-src' }, file, ta),
    el('label', { class: 'chk' }, hdr, 'الصف الأول عناوين'), prev, maps, issuesBox,
    el('div', { class: 'dlg-actions' }, btn('إلغاء', { cls: 'ghost', onclick: () => m.close() }), okBtn));
  m = modal(T.title, body);
}

export const importButton = (s) => btn('استيراد من Excel / CSV', { icon: 'plus', cls: 'sm ghost', onclick: () => importDialog(s) });
