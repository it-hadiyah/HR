/* محرّك الحسابات والمقارنات للتقارير (يعمل في المتصفح والخادم).
   لا يستخدم eval نهائياً: الصيغ الحرة تُحلَّل بمحلّل رياضي صغير يقبل الأرقام والأحرف A-Z وعمليات + - * / % والأقواس فقط. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RBC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AR = '٠١٢٣٤٥٦٧٨٩';
  const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const OPS = {
    add: { name: 'الجمع (أ + ب + ...)', multi: true, min: 1 },
    sub: { name: 'الطرح (الأول − الباقي)', multi: true, min: 2 },
    mul: { name: 'الضرب', multi: true, min: 1 },
    div: { name: 'القسمة (أ ÷ ب)', max: 2, min: 2 },
    pct: { name: 'النسبة المئوية (أ من ب)', max: 2, min: 2 },
    avg: { name: 'المتوسط', multi: true, min: 1 },
    formula: { name: 'صيغة حرة', min: 0 },
  };

  // يحوّل نصاً إلى رقم (يقبل الأرقام العربية والفواصل وعلامة %). فارغ/غير صالح → null
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[٬,\s‎‏]/g, '').replace('٫', '.').replace(/%$/, '');
    if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  function fmtNum(n, decimals) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const d = decimals == null ? 2 : decimals;
    const f = Math.pow(10, d), r = Math.round((n + Number.EPSILON) * f) / f;
    return (Object.is(r, -0) ? 0 : r).toLocaleString('en-US', { maximumFractionDigits: d });
  }
  const fmtRow = (v, row) => (v === null || v === undefined ? '—' : fmtNum(v) + (row && row.fmt === 'percent' ? '%' : '') + (row && row.unit ? ' ' + row.unit : ''));

  /* ---------- محلّل الصيغ الحرة ---------- */
  function tokenize(src) {
    const s = String(src || '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/×/g, '*').replace(/÷/g, '/').replace(/٫/g, '.').replace(/٪/g, '%');
    if (s.length > 200) throw new Error('الصيغة طويلة جداً');
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const t = s.slice(i, j); if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) throw new Error('رقم غير صالح: ' + t); out.push({ t: 'n', v: parseFloat(t) }); i = j; continue; }
      if (/[A-Za-z]/.test(c)) { if (/[A-Za-z]/.test(s[i + 1] || '')) throw new Error('استخدم حرفاً واحداً لكل بند (A, B, C...)'); out.push({ t: 'v', v: c.toUpperCase() }); i++; continue; }
      if ('+-*/%()'.includes(c)) { out.push({ t: c }); i++; continue; }
      throw new Error('رمز غير مسموح في الصيغة: ' + c);
    }
    return out;
  }
  function evalFormula(src, get) {
    const tk = tokenize(src); let p = 0, depth = 0;
    const peek = () => tk[p] && tk[p].t;
    const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = tk[p++].t; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
    const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const o = tk[p++].t; const r = factor(); if (o === '/') { if (r === 0) throw new Error('قسمة على صفر'); v /= r; } else v *= r; } return v; };
    const factor = () => {
      if (peek() === '-') { p++; return -factor(); }
      if (peek() === '+') { p++; return factor(); }
      let v = primary();
      while (peek() === '%') { p++; v /= 100; }
      return v;
    };
    const primary = () => {
      const t = tk[p++];
      if (!t) throw new Error('الصيغة غير مكتملة');
      if (t.t === 'n') return t.v;
      if (t.t === 'v') return get(t.v);
      if (t.t === '(') { if (++depth > 30) throw new Error('أقواس كثيرة'); const v = expr(); if (peek() !== ')') throw new Error('قوس ناقص'); p++; depth--; return v; }
      throw new Error('الصيغة غير صحيحة');
    };
    if (!tk.length) throw new Error('اكتب الصيغة');
    const v = expr();
    if (p < tk.length) throw new Error('الصيغة غير صحيحة');
    if (!Number.isFinite(v)) throw new Error('نتيجة غير صالحة');
    return v;
  }

  /* ---------- حساب الجدول ---------- */
  function evalCalc(content) {
    const rows = (content && content.rows) || [];
    const map = {}; rows.forEach((r) => { if (r && r.key) map[String(r.key).toUpperCase()] = r; });
    const values = {}, errors = {}, empties = {}, done = new Set(), stack = [];

    function val(key) {
      key = String(key).toUpperCase();
      const row = map[key];
      if (!row) throw new Error('البند ' + key + ' غير موجود');
      if (done.has(key)) { if (errors[key]) throw new Error('البند ' + key + ' فيه خطأ'); return values[key]; }
      if (stack.includes(key)) throw new Error('بند يعتمد على نفسه (' + key + ')');
      stack.push(key);
      try {
        let v;
        if (row.kind !== 'calc') { const n = toNum(row.value); empties[key] = n === null; v = n === null ? 0 : n; }
        else {
          const args = (row.args || []).map((a) => String(a).toUpperCase()).filter((a) => a !== key);
          const op = OPS[row.op] ? row.op : 'sub';
          if (op === 'formula') v = evalFormula(row.formula, val);
          else {
            const need = OPS[op].min;
            if (args.length < need) throw new Error(need === 2 ? 'اختر بندين' : 'اختر بنداً واحداً على الأقل');
            const a = args.map(val);
            if (op === 'add') v = a.reduce((s, x) => s + x, 0);
            else if (op === 'sub') v = a.slice(1).reduce((s, x) => s - x, a[0]);
            else if (op === 'mul') v = a.reduce((s, x) => s * x, 1);
            else if (op === 'avg') v = a.reduce((s, x) => s + x, 0) / a.length;
            else { if (a[1] === 0) throw new Error('قسمة على صفر'); v = op === 'pct' ? (a[0] / a[1]) * 100 : a[0] / a[1]; }
          }
          if (!Number.isFinite(v)) throw new Error('نتيجة غير صالحة');
        }
        values[key] = v; done.add(key); return v;
      } catch (e) { errors[key] = e.message; values[key] = null; done.add(key); throw e; }
      finally { stack.pop(); }
    }
    rows.forEach((r) => { if (r && r.key) { try { val(r.key); } catch (e) { /* مسجَّل في errors */ } } });
    return { values, errors, empties };
  }
  // هل يوجد أي رقم مُدخل؟ (لإخفاء القسم الفارغ)
  const calcHasInput = (content) => ((content && content.rows) || []).some((r) => r && r.kind !== 'calc' && toNum(r.value) !== null);

  const nextKey = (rows) => { const used = new Set((rows || []).map((r) => String(r.key).toUpperCase())); return KEYS.find((k) => !used.has(k)) || null; };

  /* ---------- المقارنة بين فترتين ---------- */
  function compareRows(content) {
    const c = content || {};
    return (c.rows || []).map((r) => {
      const prev = toNum(r.prev), curr = toNum(r.curr);
      const base = { label: r.label || '', unit: r.unit || '', prev, curr, better: r.better === 'down' ? 'down' : 'up' };
      if (prev === null || curr === null) return Object.assign(base, { change: null, pct: null, dir: 'na', good: null });
      const change = curr - prev, pct = prev === 0 ? null : (change / Math.abs(prev)) * 100;
      const dir = Math.abs(change) < 1e-9 ? 'flat' : change > 0 ? 'up' : 'down';
      const good = dir === 'flat' ? null : dir === base.better;
      return Object.assign(base, { change, pct, dir, good });
    }).filter((r) => r.label || r.prev !== null || r.curr !== null);
  }
  const compareHasData = (content) => compareRows(content).some((r) => r.dir !== 'na');
  function compareSentence(r, labels) {
    const L = labels || {}, p = L.prev || 'الفترة السابقة', q = L.curr || 'الفترة الحالية';
    if (r.dir === 'na') return '';
    const range = `(من ${fmtNum(r.prev)}${r.unit ? ' ' + r.unit : ''} إلى ${fmtNum(r.curr)}${r.unit ? ' ' + r.unit : ''})`;
    if (r.dir === 'flat') return `${r.label}: لم يتغيّر بين ${p} و${q} (${fmtNum(r.curr)}${r.unit ? ' ' + r.unit : ''}).`;
    const word = r.dir === 'up' ? 'ارتفاع' : 'انخفاض';
    if (r.pct === null) return `${r.label}: ${word} بمقدار ${fmtNum(Math.abs(r.change))}${r.unit ? ' ' + r.unit : ''} ${range}، ولا تُحسب النسبة لأن ${p} صفر.`;
    return `${r.label}: ${word} بنسبة ${fmtNum(Math.abs(r.pct), 1)}% عن ${p} ${range}.`;
  }

  return { OPS, KEYS, toNum, fmtNum, fmtRow, evalFormula, evalCalc, calcHasInput, nextKey, compareRows, compareHasData, compareSentence, round2 };
});
