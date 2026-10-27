/* HADIYAH Studio — محرك العناصر المشترك (مصدر الحقيقة الواحد لتصميم الشرائح الرسمية)
   كل تخطيط رسمي يُحوَّل إلى قائمة عناصر هندسية (نص، مستطيل، صورة، شعار، زخرفة، قسم بيانات)، ومنها:
   - يُولَّد HTML للمعاينة والمحرر ووضع العرض والمعرض والطباعة (PDF) والصفحة المستقلة،
   - ويُبنى ملف PPTX (نصوص وأشكال وصور قابلة للتحرير) من القائمة نفسها،
   فلا يختلف التصميم بين المعاينة والمحرر والتصدير. الأبعاد المنطقية: 1280×720 (16:9) أو 960×720 (4:3). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RBS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GOLD = '#c9a24b', INK = '#17302c';
  const FONT = { d: "'The Year of Handicrafts','IBM Plex Sans Arabic',Tahoma,sans-serif", b: "'IBM Plex Sans Arabic','The Year of Handicrafts',Tahoma,sans-serif" };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgba = (hex, a) => { const h = String(hex || '#005a52').replace('#', ''); const n = h.length === 3 ? h.replace(/./g, '$&$&') : h.padEnd(6, '0'); return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${clamp(a, 0, 1)})`; };

  /* ---------- التدرج الرسمي لهدية وصورة التغطية ---------- */
  const officialOverlay = (dir) => ({ on: true, preset: 'hadiyah', color: '#005a52', dir: dir || 'right', from: 0.94, mid: 0.6, to: 0 });
  const DIRS = { right: 'اليمين', left: 'اليسار', top: 'الأعلى', bottom: 'الأسفل', all: 'كامل الصورة' };
  const normPhoto = (p, def) => {
    p = p || {}; def = def || {};
    const o = Object.assign({}, officialOverlay(def.dir), def.ov || {}, p.ov || {});
    return { src: p.src || '', th: p.th || '', x: clamp(num(p.x, 50), 0, 100), y: clamp(num(p.y, 40), 0, 100), scale: clamp(num(p.scale, 1), 1, 4), nw: num(p.nw, 0), nh: num(p.nh, 0), fit: p.fit === 'contain' ? 'contain' : (def.fit || 'cover'), ov: o };
  };
  // اتجاه التدرج: الجهة التي يكون عندها اللون كثيفاً
  const CSS_DIR = { right: 'to left', left: 'to right', top: 'to bottom', bottom: 'to top' };
  function overlayCss(ov) {
    if (!ov || ov.on === false) return '';
    const c = ov.color || '#005a52';
    if (ov.dir === 'all') return `background:${rgba(c, ov.from)}`;
    return `background:linear-gradient(${CSS_DIR[ov.dir] || 'to left'},${rgba(c, ov.from)} 0%,${rgba(c, ov.mid)} 50%,${rgba(c, ov.to)} 100%)`;
  }
  // هندسة الصورة داخل الإطار (نفسها تُستعمل في HTML وPPTX): تغطية كاملة مع تكبير ونقطة تركيز
  function photoGeom(p, bw, bh) {
    if (!p.nw || !p.nh) return { w: bw, h: bh, l: 0, t: 0, known: false };
    const base = p.fit === 'contain' ? Math.min(bw / p.nw, bh / p.nh) : Math.max(bw / p.nw, bh / p.nh);
    const k = base * (p.fit === 'contain' ? 1 : p.scale), w = p.nw * k, h = p.nh * k;
    return { w, h, l: p.fit === 'contain' ? (bw - w) / 2 : -(w - bw) * (p.x / 100), t: p.fit === 'contain' ? (bh - h) / 2 : -(h - bh) * (p.y / 100), known: true };
  }

  /* ---------- ملاءمة النص: تقدير ثابت يُستعمل في كل المخرجات ---------- */
  // تقدير عدد الأسطر بمحاكاة الالتفاف عند حدود الكلمات (عرض الحرف ≈ 0.5 من حجم الخط)
  const textLines = (text, w, size) => String(text || '').split('\n').reduce((n, para) => {
    const words = para.split(/\s+/).filter(Boolean); if (!words.length) return n + 1;
    let lines = 1, cur = 0; const sp = size * 0.28;
    words.forEach((wd) => { const ww = wd.length * size * 0.5; if (cur && cur + sp + ww > w) { lines++; cur = ww; } else cur += (cur ? sp : 0) + ww; if (ww > w) lines += Math.floor(ww / w); });
    return n + lines;
  }, 0);
  const overflows = (e) => !!String(e.text || '').trim() && textLines(e.text, e.w, e.size || 28) * (e.size || 28) * ((e.lh || 1.4) + 0.18 + ((e.size || 28) >= 40 ? 0.12 : 0)) > e.h + 2;
  function fit(text, w, h, size, min, lh) {
    lh = lh || 1.4; min = min || 12;
    for (let s = size; s >= min; s -= 1) if (textLines(text, w, s) * s * (lh + 0.18 + (s >= 40 ? 0.12 : 0)) <= h) return s;
    return min;
  }

  /* ---------- مساعدات بناء العناصر ---------- */
  let seq = 0;
  const E = {
    rect: (id, x, y, w, h, o) => Object.assign({ type: 'rect', id, x, y, w, h, fill: '', radius: 0, shape: 'rect' }, o || {}),
    text: (id, field, text, x, y, w, h, o) => Object.assign({ type: 'text', id, field, text: text || '', x, y, w, h, size: 28, weight: 700, color: INK, align: 'right', lh: 1.4, anchor: 't', font: 'b' }, o || {}),
    photo: (id, pi, x, y, w, h, o) => Object.assign({ type: 'photo', id, pi, x, y, w, h, radius: 0, shape: 'rect' }, o || {}),
    img: (id, kind, x, y, w, h, o) => Object.assign({ type: 'img', id, kind, x, y, w, h }, o || {}),
    block: (id, bi, x, y, w, h, o) => Object.assign({ type: 'block', id, bi, x, y, w, h }, o || {}),
  };
  // شبكة خلايا من اليمين لليسار
  function grid(n, cols, x, y, w, h, gap) {
    const rows = Math.ceil(n / cols), cw = (w - gap * (cols - 1)) / cols, ch = (h - gap * (rows - 1)) / rows, out = [];
    for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; out.push({ x: x + w - (c + 1) * cw - c * gap, y: y + r * (ch + gap), w: cw, h: ch }); }
    return out;
  }

  /* ---------- التخطيطات الرسمية (16) ---------- */
  const BG = { green: 'green', mint: 'mint', white: 'white', dark: 'dark' };
  const ITEMS = (max, fields, labels) => ({ max, fields, labels });
  const LAYOUTS = {
    'o-cover': { name: 'الغلاف الرسمي', bg: 'green', photos: [{ dir: 'right' }], items: null, text: ['title', 'subtitle', 'tag'] },
    'o-about': { name: 'التعريف بالجمعية', bg: 'mint', photos: [], items: ITEMS(4, ['t', 'd']) },
    'o-exec': { name: 'الملخص التنفيذي', bg: 'white', photos: [{ dir: 'all', from: 0.0, mid: 0.0, to: 0.0, ov: { on: false } }], items: null, paragraphs: true },
    'o-project': { name: 'نبذة عن المشروع', bg: 'white', photos: [{ dir: 'right', ov: { color: '#ffffff', from: 1, mid: 0.7, to: 0 } }], items: null, paragraphs: true },
    'o-vision': { name: 'الرؤية والرسالة', bg: 'white', photos: [{ dir: 'right', ov: { color: '#ffffff', from: 1, mid: 0.75, to: 0.1 } }], items: ITEMS(2, ['t', 'd']) },
    'o-goals': { name: 'الأهداف', bg: 'dark', photos: [], items: ITEMS(6, ['t']) },
    'o-phases': { name: 'مراحل التنفيذ', bg: 'green', photos: [], items: ITEMS(8, ['t']) },
    'o-kpi': { name: 'مؤشرات الأداء', bg: 'mint', photos: [], items: ITEMS(6, ['t', 'd', 'v']) },
    'o-numbers': { name: 'الإنجازات بالأرقام', bg: 'white', photos: [], items: ITEMS(4, ['t', 'v']) },
    'o-budget': { name: 'الموازنة والمصروفات', bg: 'mint', photos: [], items: null, blocks: 2 },
    'o-compare': { name: 'المقارنات السنوية', bg: 'white', photos: [], items: null, blocks: 1 },
    'o-impact': { name: 'النتائج والأثر', bg: 'mint', photos: [], items: ITEMS(4, ['t', 'd']) },
    'o-photos': { name: 'الصور الميدانية', bg: 'white', photos: [{ dir: 'bottom', ov: { from: 0.8, mid: 0.2, to: 0 } }, { dir: 'bottom', ov: { from: 0.8, mid: 0.2, to: 0 } }, { dir: 'bottom', ov: { from: 0.8, mid: 0.2, to: 0 } }, { dir: 'bottom', ov: { from: 0.8, mid: 0.2, to: 0 } }], items: ITEMS(4, ['t']) },
    'o-partners': { name: 'الشركاء والجهات الداعمة', bg: 'white', photos: Array.from({ length: 8 }, () => ({ fit: 'contain', ov: { on: false } })), items: ITEMS(8, ['t']) },
    'o-reco': { name: 'التوصيات', bg: 'mint', photos: [], items: ITEMS(5, ['t', 'd']) },
    'o-closing': { name: 'الختام', bg: 'green', photos: [{ dir: 'all', ov: { from: 0.86 } }], items: null },
  };
  const isOfficial = (l) => !!LAYOUTS[l];

  function titleBlock(c, o) {
    o = o || {};
    const dark = c.dark;
    return [E.text('title', 'title', c.s.title, c.M, o.y || 62, c.W - 2 * c.M, o.h || 80, { size: fit(c.s.title, c.W - 2 * c.M, o.h || 80, o.size || 46, 26, 1.25), lh: 1.25, color: dark ? '#fff' : c.p.d, font: 'd', anchor: 'm' })]
      .concat(c.s.subtitle ? [E.text('sub', 'subtitle', c.s.subtitle, c.M, (o.y || 62) + (o.h || 80), c.W - 2 * c.M, 56, { size: fit(c.s.subtitle, c.W - 2 * c.M, 56, 22, 13, 1.3), lh: 1.3, weight: 500, color: dark ? 'rgba(255,255,255,.85)' : '#5b6b68' })] : []);
  }
  const it = (c, i, k) => (c.items[i] && c.items[i][k]) || '';
  const ITEM_PH = { t: 'العنوان', d: 'اكتب الوصف هنا', v: '0' };

  const BUILD = {
    'o-cover'(c) {
      const { W, H, M, s } = c;
      const els = [E.photo('photo0', 0, 0, 0, W, H), E.img('logo', 'logoLight', W - M - 170 * c.u, 44, 170 * c.u, 54)];
      els.push(E.text('title', 'title', s.title, W * 0.36, H * 0.26, W * 0.64 - M, H * 0.3, { size: fit(s.title, W * 0.64 - M, H * 0.3, 88 * c.u, 36, 1.2), lh: 1.2, color: GOLD, font: 'd', anchor: 'b' }));
      els.push(E.text('sub', 'subtitle', s.subtitle, W * 0.36, H * 0.57, W * 0.64 - M, 90, { size: fit(s.subtitle, W * 0.64 - M, 90, 36, 20, 1.3), lh: 1.3, weight: 600, color: '#fff' }));
      if (c.tag) els.push(E.text('tag', 'bullets.0', c.tag, W * 0.36, H * 0.74, W * 0.64 - M, 60, { size: fit(c.tag, W * 0.64 - M, 60, 22, 13, 1.3), lh: 1.3, weight: 500, color: 'rgba(255,255,255,.9)' }));
      if (c.meta) els.push(E.text('meta', null, c.meta, M, H - 64, W - 2 * M, 30, { size: 17, weight: 500, color: 'rgba(255,255,255,.8)', align: 'left' }));
      els.push(E.img('pat', 'patternLight', 0, H - 56, W, 56, { opacity: 0.22 }));
      return els;
    },
    'o-about'(c) {
      const { W, M, H } = c, els = [E.img('logo', 'logoVertical', M, H / 2 - 150, 300 * c.u, 300)];
      els.push(E.text('title', 'title', c.s.title, W * 0.42, 56, W * 0.58 - M, 120, { size: fit(c.s.title, W * 0.58 - M, 120, 50, 26, 1.25), lh: 1.25, color: c.p.a, font: 'd', anchor: 'm' }));
      const nn = c.n(4), cells = grid(nn, 2, W * 0.42, 200, W * 0.58 - M, 430, 18);
      for (let i = 0; i < nn; i++) {
        const g = cells[i];
        els.push(E.rect('card' + i, g.x, g.y, g.w, g.h, { fill: '#fff', radius: 16, shadow: true }));
        els.push(E.rect('num' + i, g.x + g.w - 52, g.y + 14, 38, 38, { fill: GOLD, shape: 'ellipse' }));
        els.push(E.text('numt' + i, null, String(i + 1), g.x + g.w - 52, g.y + 14, 38, 38, { size: 22, color: '#fff', align: 'center', anchor: 'm', font: 'd' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 14, g.y + 14, g.w - 74, 44, { size: fit(it(c, i, 't'), g.w - 74, 44, 24, 16, 1.2), lh: 1.2, color: c.p.a, font: 'd', anchor: 'm', ph: ITEM_PH.t }));
        els.push(E.text('i' + i + 'd', 'items.' + i + '.d', it(c, i, 'd'), g.x + 16, g.y + 66, g.w - 32, g.h - 80, { size: fit(it(c, i, 'd'), g.w - 32, g.h - 80, 19, 13, 1.5), lh: 1.5, weight: 400, color: '#3b4f4b', ph: ITEM_PH.d }));
      }
      return els;
    },
    'o-exec'(c) {
      const { W, H, M } = c, pw = W * 0.4;
      const els = [E.rect('panel', 0, 0, pw, H, { fill: c.p.a }), E.photo('photo0', 0, M * 0.7, 64, pw - M * 1.4, H - 128, { shape: 'arch' })];
      els.push(E.text('title', 'title', c.s.title, pw + 40, 56, W - pw - 40 - M, 90, { size: fit(c.s.title, W - pw - 40 - M, 90, 48, 26, 1.2), lh: 1.2, color: c.p.a, font: 'd', anchor: 'm' }));
      els.push(E.text('body', 'bullets', c.para, pw + 40, 160, W - pw - 40 - M, H - 240, { size: fit(c.para, W - pw - 40 - M, H - 240, 22, 13, 1.65), lh: 1.65, weight: 400, color: '#2c3f3b', lh: 1.65, ph: 'اكتب الملخص التنفيذي: الهدف، أبرز النتائج، والتوصية.' }));
      els.push(E.img('logo', 'logo', M, H - 70, 130, 40));
      return els;
    },
    'o-project'(c) {
      const { W, H, M } = c, pw = W * 0.5;
      const els = [E.photo('photo0', 0, 0, 0, pw, H)];
      els.push(E.text('title', 'title', c.s.title, W * 0.46, 56, W * 0.54 - M, 90, { size: fit(c.s.title, W * 0.54 - M, 90, 50, 26, 1.2), lh: 1.2, color: c.p.a, font: 'd', anchor: 'm' }));
      els.push(E.text('body', 'bullets', c.para, W * 0.46, 160, W * 0.54 - M, H - 250, { size: fit(c.para, W * 0.54 - M, H - 250, 22, 13, 1.65), lh: 1.65, weight: 400, color: '#2c3f3b', lh: 1.65, ph: 'اكتب نبذة عن المشروع وفكرته ومن يستفيد منه.' }));
      els.push(E.img('pat', 'pattern', W * 0.46, H - 56, W * 0.54, 56, { opacity: 0.45 }), E.img('logo', 'logo', M, H - 110, 130, 40));
      return els;
    },
    'o-vision'(c) {
      const { W, H, M } = c, els = [E.photo('photo0', 0, 0, 0, W * 0.4, H)];
      for (let i = 0; i < 2; i++) {
        const y = 70 + i * 290, x = W * 0.4;
        els.push(E.rect('bar' + i, W - M - 6, y + 6, 6, 56, { fill: GOLD, radius: 3 }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't') || (i ? 'الرسالة' : 'الرؤية'), x, y, W - M - x - 22, 70, { size: fit(it(c, i, 't') || 'الرؤية', W - M - x - 22, 70, 44, 20, 1.2), lh: 1.2, color: c.p.a, font: 'd', anchor: 'm' }));
        els.push(E.text('i' + i + 'd', 'items.' + i + '.d', it(c, i, 'd'), x, y + 76, W - M - x - 22, 170, { size: fit(it(c, i, 'd'), W - M - x - 22, 170, 24, 14, 1.6), lh: 1.6, weight: 400, color: '#2c3f3b', lh: 1.6, ph: ITEM_PH.d }));
      }
      els.push(E.img('logo', 'logo', M, H - 70, 130, 40));
      return els;
    },
    'o-goals'(c) {
      const { W, H, M } = c, n = c.n(6), cells = grid(n, 2, M, 190, W - 2 * M, H - 260, 20);
      const els = titleBlock(c, { y: 50 });
      cells.forEach((g, i) => {
        const hy = g.y + g.h / 2 - 32;
        els.push(E.rect('hx' + i, g.x + g.w - 72, hy, 64, 64, { fill: GOLD, shape: 'hex' }));
        els.push(E.text('n' + i, null, String(i + 1), g.x + g.w - 72, hy, 64, 64, { size: 30, color: '#fff', font: 'd', anchor: 'm', align: 'center' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x, g.y, g.w - 82, g.h, { size: fit(it(c, i, 't'), g.w - 82, g.h, 28, 14, 1.35), lh: 1.35, color: '#fff', weight: 600, anchor: 'm', ph: 'اكتب الهدف' }));
      });
      els.push(E.img('pat', 'patternLight', 0, H - 56, W, 56, { opacity: 0.2 }));
      return els;
    },
    'o-phases'(c) {
      const { W, H, M } = c, n = Math.max(2, c.n(8)), step = (W - 2 * M) / n, els = titleBlock(c, { y: 50 });
      els.push(E.rect('line', M, 372, W - 2 * M, 4, { fill: 'rgba(255,255,255,.35)', radius: 2 }));
      for (let i = 0; i < n; i++) {
        const cx = W - M - step * i - step / 2;
        els.push(E.rect('dot' + i, cx - 28, 346, 56, 56, { fill: GOLD, shape: 'hex' }));
        els.push(E.text('d' + i, null, String(i + 1), cx - 26, 350, 52, 52, { size: 26, color: '#fff', align: 'center', anchor: 'm', font: 'd' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), cx - step / 2 + 4, 420, step - 8, 110, { size: fit(it(c, i, 't'), step - 8, 110, 24, 13, 1.3), lh: 1.3, color: '#fff', align: 'center', weight: 600, ph: 'المرحلة' }));
      }
      els.push(E.img('pat', 'patternLight', 0, H - 56, W, 56, { opacity: 0.2 }));
      return els;
    },
    'o-kpi'(c) {
      const { W, H, M } = c, n = c.n(6), cols = n <= 4 ? 2 : 3, cells = grid(n, cols, M, 180, W - 2 * M, H - 250, 20), els = titleBlock(c, { y: 44 });
      cells.forEach((g, i) => {
        els.push(E.rect('c' + i, g.x, g.y, g.w, g.h, { fill: '#fff', radius: 16, shadow: true }));
        els.push(E.rect('s' + i, g.x + 24, g.y, g.w - 48, 6, { fill: GOLD, radius: 3 }));
        els.push(E.text('i' + i + 'v', 'items.' + i + '.v', it(c, i, 'v'), g.x + 14, g.y + 20, g.w - 28, g.h * 0.42, { size: fit(it(c, i, 'v'), g.w - 28, g.h * 0.42, 54, 22, 1.1), lh: 1.1, color: c.p.a, font: 'd', anchor: 'm', align: 'center', ph: '٠٠' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 14, g.y + g.h * 0.5, g.w - 28, g.h * 0.2, { size: fit(it(c, i, 't'), g.w - 28, g.h * 0.2, 24, 14, 1.2), lh: 1.2, color: INK, align: 'center', anchor: 'm', ph: ITEM_PH.t }));
        els.push(E.text('i' + i + 'd', 'items.' + i + '.d', it(c, i, 'd'), g.x + 14, g.y + g.h * 0.7, g.w - 28, g.h * 0.26, { size: fit(it(c, i, 'd'), g.w - 28, g.h * 0.26, 17, 11, 1.35), lh: 1.35, weight: 400, color: '#5b6b68', align: 'center', ph: 'وصف المؤشر' }));
      });
      els.push(E.img('logo', 'logo', M, H - 62, 120, 38));
      return els;
    },
    'o-numbers'(c) {
      const { W, H, M } = c, n = c.n(4), cells = grid(n, n >= 4 ? 4 : n === 3 ? 3 : 2, M, 190, W - 2 * M, H - 280, 22), els = titleBlock(c, { y: 44 });
      cells.forEach((g, i) => {
        const gold = i % 2 === 1;
        els.push(E.rect('c' + i, g.x, g.y, g.w, g.h, { fill: gold ? GOLD : c.p.a, radius: 20 }));
        els.push(E.text('i' + i + 'v', 'items.' + i + '.v', it(c, i, 'v'), g.x + 10, g.y + 20, g.w - 20, g.h * 0.55, { size: fit(it(c, i, 'v'), g.w - 20, g.h * 0.55, 76, 26, 1.1), lh: 1.1, color: '#fff', font: 'd', anchor: 'm', align: 'center', ph: '٠٠٠' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 14, g.y + g.h * 0.62, g.w - 28, g.h * 0.32, { size: fit(it(c, i, 't'), g.w - 28, g.h * 0.32, 26, 14, 1.25), lh: 1.25, color: '#fff', weight: 600, align: 'center', ph: ITEM_PH.t }));
      });
      els.push(E.img('pat', 'pattern', 0, H - 56, W, 56, { opacity: 0.5 }));
      return els;
    },
    'o-budget'(c) {
      const { W, H, M } = c, els = titleBlock(c, { y: 44 }), two = c.blocks >= 2, gw = two ? (W - 2 * M - 24) / 2 : W - 2 * M;
      [0, 1].slice(0, two ? 2 : 1).forEach((i) => {
        const x = W - M - gw - i * (gw + 24);
        els.push(E.rect('card' + i, x, 170, gw, H - 250, { fill: '#fff', radius: 18, shadow: true }));
        els.push(E.block('b' + i, i, x + 18, 188, gw - 36, H - 286, { ph: i ? 'أضف رسماً بيانياً للمصروفات' : 'أضف جدول الموازنة أو حساباً' }));
      });
      els.push(E.img('logo', 'logo', M, H - 62, 120, 38));
      return els;
    },
    'o-compare'(c) {
      const { W, H, M } = c, els = titleBlock(c, { y: 44 });
      els.push(E.rect('card', M, 170, W - 2 * M, H - 250, { fill: '#fff', radius: 18, shadow: true }), E.block('b0', 0, M + 20, 188, W - 2 * M - 40, H - 286, { ph: 'أضف قسم مقارنة بين سنتين أو جدولاً' }), E.img('logo', 'logo', M, H - 62, 120, 38));
      return els;
    },
    'o-impact'(c) {
      const { W, H, M } = c, els = titleBlock(c, { y: 44 }), cells = grid(c.n(4), 2, M, 180, W - 2 * M, H - 250, 24);
      cells.forEach((g, i) => {
        els.push(E.rect('c' + i, g.x, g.y, g.w, g.h, { fill: '#fff', radius: 18, shadow: true }), E.rect('s' + i, g.x + g.w - 8, g.y + 20, 6, g.h - 40, { fill: i % 2 ? GOLD : c.p.a, radius: 3 }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 18, g.y + 14, g.w - 50, 50, { size: fit(it(c, i, 't'), g.w - 50, 50, 28, 16, 1.2), lh: 1.2, color: c.p.a, font: 'd', anchor: 'm', ph: ITEM_PH.t }));
        els.push(E.text('i' + i + 'd', 'items.' + i + '.d', it(c, i, 'd'), g.x + 18, g.y + 68, g.w - 50, g.h - 80, { size: fit(it(c, i, 'd'), g.w - 50, g.h - 80, 20, 12, 1.5), lh: 1.5, weight: 400, color: '#3b4f4b', ph: ITEM_PH.d }));
      });
      els.push(E.img('logo', 'logo', M, H - 62, 120, 38));
      return els;
    },
    'o-photos'(c) {
      const { W, H, M } = c, els = titleBlock(c, { y: 36, h: 70, size: 42 }), n = 4, cells = grid(n, 2, M, 150, W - 2 * M, H - 190, 16);
      cells.forEach((g, i) => {
        els.push(E.photo('photo' + i, i, g.x, g.y, g.w, g.h, { radius: 16 }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 18, g.y + g.h - 56, g.w - 36, 44, { size: fit(it(c, i, 't'), g.w - 36, 44, 24, 14, 1.2), lh: 1.2, color: '#fff', weight: 600, anchor: 'm', ph: 'وصف الصورة' }));
      });
      return els;
    },
    'o-partners'(c) {
      const { W, H, M } = c, els = titleBlock(c, { y: 44 }), n = 8, cells = grid(n, 4, M, 180, W - 2 * M, H - 250, 18);
      cells.forEach((g, i) => {
        els.push(E.rect('c' + i, g.x, g.y, g.w, g.h, { fill: '#fff', radius: 14, shadow: true }));
        els.push(E.photo('photo' + i, i, g.x + 14, g.y + 12, g.w - 28, g.h - 60, { radius: 6, tile: true }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), g.x + 8, g.y + g.h - 44, g.w - 16, 34, { size: fit(it(c, i, 't'), g.w - 16, 34, 18, 11, 1.2), lh: 1.2, color: '#44575a', weight: 600, align: 'center', anchor: 'm', ph: 'اسم الجهة' }));
      });
      return els;
    },
    'o-reco'(c) {
      const { W, H, M } = c, n = c.n(5), els = titleBlock(c, { y: 44 }), top = 170, rh = Math.min(100, (H - top - 70 - 14 * (n - 1)) / n);
      for (let i = 0; i < n; i++) {
        const y = top + i * (rh + 14);
        els.push(E.rect('r' + i, M, y, W - 2 * M, rh, { fill: '#fff', radius: 14, shadow: true }), E.rect('b' + i, W - M - 64, y + 10, 52, rh - 20, { fill: GOLD, radius: 10 }));
        els.push(E.text('n' + i, null, String(i + 1), W - M - 64, y + 10, 52, rh - 20, { size: 30, color: '#fff', font: 'd', align: 'center', anchor: 'm' }));
        els.push(E.text('i' + i + 't', 'items.' + i + '.t', it(c, i, 't'), M + 20, y + 4, W - 2 * M - 100, rh - 8, { size: fit(it(c, i, 't'), W - 2 * M - 100, rh - 8, 24, 13, 1.3), lh: 1.3, color: INK, weight: 600, anchor: 'm', ph: 'اكتب التوصية' }));
      }
      els.push(E.img('logo', 'logo', M, H - 56, 110, 34));
      return els;
    },
    'o-closing'(c) {
      const { W, H, M } = c, els = [E.photo('photo0', 0, 0, 0, W, H), E.img('logo', 'logoVerticalLight', W / 2 - 110, 110, 220, 190)];
      els.push(E.text('title', 'title', c.s.title || 'شكراً لكم', M, 330, W - 2 * M, 130, { size: fit(c.s.title || 'شكراً لكم', W - 2 * M, 130, 92, 36, 1.2), lh: 1.2, color: GOLD, font: 'd', align: 'center', anchor: 'm' }));
      els.push(E.text('sub', 'subtitle', c.s.subtitle, M, 470, W - 2 * M, 60, { size: fit(c.s.subtitle, W - 2 * M, 60, 28, 14, 1.3), lh: 1.3, color: '#fff', weight: 500, align: 'center' }));
      if (c.contact) els.push(E.text('contact', null, c.contact, M, H - 110, W - 2 * M, 40, { size: 18, color: 'rgba(255,255,255,.85)', align: 'center' }));
      els.push(E.img('pat', 'patternLight', 0, H - 56, W, 56, { opacity: 0.22 }));
      return els;
    },
  };

  const BG_FILL = { green: 'linear-gradient(135deg,var(--d),var(--a))', dark: 'var(--d)', mint: 'linear-gradient(160deg,#f6faf9,#e4f1ee)', white: '#ffffff' };
  const BG_MAP = { light: 'white', tint: 'mint', dark: 'dark', brand: 'green' };
  const bgKind = (s, L) => (s.bgCustom ? BG_MAP[s.bg] || L.bg : L.bg);

  const extras = (s) => (s.extra || []).map((x) => { const e = Object.assign({ extra: true }, x); if (e.type === 'photo') e.photo = normPhoto(e.photo, { dir: 'right' }); return e; });

  /* ---------- بناء قائمة عناصر الشريحة ---------- */
  function build(deck, s, ctx) {
    const L = LAYOUTS[s.layout]; if (!L) return null;
    const rt = ctx.dims || { w: 1280, h: 720 }, W = rt.w, H = rt.h, u = W / 1280;
    const p = ctx.palette || { a: '#007f73', d: '#005a52', s: '#e0f4f1', x: '#02a999' };
    const bg = bgKind(s, L), dark = bg === 'green' || bg === 'dark';
    const items = (s.items || []).filter((x) => x);
    const meta = [deck.presenter, deck.date].filter(Boolean).join('   ·   ');
    const c = { W, H, u, M: 64 * u, p, s, dark, items, blocks: L.blocks || 0, n: (d) => (items.length ? Math.min(d, items.length) : d), tag: (s.bullets || [])[0] || '', para: (s.bullets || []).filter((x) => String(x).trim()).join('\n\n'), meta, contact: ctx.contact || '' };
    let els = BUILD[s.layout](c);
    // الصور: تُطبَّق إعدادات الصورة والتدرج الافتراضي للتخطيط
    els.forEach((e) => { if (e.type === 'photo') { e.photo = normPhoto((s.photos || [])[e.pi], (L.photos || [])[e.pi]); } });
    // إزاحات المستخدم لعناصر التخطيط (سحب/تحجيم)
    const ov = s.ov || {};
    els.forEach((e) => { const o = ov[e.id]; if (o) ['x', 'y', 'w', 'h'].forEach((k) => { if (Number.isFinite(+o[k])) e[k] = +o[k]; }); });
    const sty = s.sty || {};
    els.forEach((e) => { const o = sty[e.id]; if (!o) return; if (e.type === 'text') { if (o.color) e.color = o.color; if (+o.size) e.size = +o.size; if (+o.weight) e.weight = +o.weight; if (o.align) e.align = o.align; } else if (e.type === 'rect' && o.fill) e.fill = o.fill; });
    return { bg, dark, els: els.concat(extras(s)), W, H };
  }

  /* ---------- HTML ---------- */
  function elStyle(e) {
    let st = `left:${e.x.toFixed(1)}px;top:${e.y.toFixed(1)}px;width:${e.w.toFixed(1)}px;height:${e.h.toFixed(1)}px`;
    if (e.opacity != null && e.opacity !== 1) st += `;opacity:${e.opacity}`;
    return st;
  }
  const shapeRadius = (e) => (e.shape === 'ellipse' ? '50%' : e.shape === 'arch' ? `${Math.round(e.w / 2)}px ${Math.round(e.w / 2)}px 18px 18px` : e.radius ? `${e.radius}px` : '0');
  function elHtml(e, ctx) {
    const id = `data-eid="${esc(e.id)}"`, ex = e.extra ? ' extra' : '';
    if (e.type === 'rect') {
      let bg = e.fill || 'transparent';
      return `<div class="el el-rect${ex}" ${id} style="${elStyle(e)};background:${bg};border-radius:${shapeRadius(e)}${e.shape === 'hex' ? ';clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)' : ''}${e.shadow ? ';box-shadow:0 6px 20px rgba(0,60,52,.12)' : ''}${e.border ? `;border:${e.bw || 2}px solid ${e.border}` : ''}"></div>`;
    }
    if (e.type === 'text') {
      const txt = String(e.text || '').trim();
      if (!txt && !ctx.preview) return '';
      const ph = !txt;
      const size = e.size || 28;
      const jc = e.anchor === 'm' ? 'center' : e.anchor === 'b' ? 'flex-end' : 'flex-start';
      return `<div class="el el-text${ex}${ph ? ' ph' : ''}${e.field ? ' editable' : ''}${ctx.preview && overflows(e) ? ' over' : ''}" ${id}${e.field ? ` data-field="${esc(e.field)}"` : ''} style="${elStyle(e)};display:flex;flex-direction:column;justify-content:${jc};font-family:${FONT[e.font] || FONT.b};font-size:${size}px;font-weight:${e.weight || 700};color:${e.color || INK};text-align:${e.align || 'right'};line-height:${e.lh || 1.4}"><span class="tx">${esc(ph ? e.ph || '' : txt)}</span></div>`;
    }
    if (e.type === 'img') {
      const src = (ctx.cfg || {})[e.kind] || '';
      if (!src) return '';
      return `<div class="el el-img${ex}" ${id} style="${elStyle(e)}"><img src="${esc(src)}" alt="" style="width:100%;height:100%;object-fit:${e.kind && /^pattern/.test(e.kind) ? 'cover' : 'contain'}"></div>`;
    }
    if (e.type === 'photo') {
      const p = e.photo, g = photoGeom(p, e.w, e.h), rad = shapeRadius(e);
      let inner;
      const psrc = ctx.thumb && p.th ? p.th : p.src;
      if (p.src) inner = g.known ? `<img src="${esc(psrc)}" alt="" style="position:absolute;left:${g.l.toFixed(1)}px;top:${g.t.toFixed(1)}px;width:${g.w.toFixed(1)}px;height:${g.h.toFixed(1)}px;max-width:none">` : `<img src="${esc(psrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${p.fit};object-position:${p.x}% ${p.y}%">`;
      else inner = `<div class="ph-photo${ctx.preview ? ' show' : ''}">${ctx.preview ? '<b>＋</b><span>اضغط لإضافة صورة</span>' : ''}</div>`;
      const ovc = p.src || ctx.preview ? overlayCss(p.ov) : overlayCss(p.ov);
      return `<div class="el el-photo${ex}${p.src ? '' : ' empty'}" ${id} style="${elStyle(e)};border-radius:${rad}">${inner}${ovc && !(e.tile && !p.src) ? `<div class="ov" style="${ovc}"></div>` : ''}</div>`;
    }
    if (e.type === 'block') {
      const b = ctx.blockAt ? ctx.blockAt(e) : null;
      if (!b) return ctx.preview ? `<div class="el el-block empty${ex}" ${id} style="${elStyle(e)}"><span>${esc(e.ph || 'أضف قسم بيانات')}</span></div>` : '';
      const z = Math.max(0.6, Math.min(1.7, e.w / 620));
      return `<div class="el el-block${ex}" ${id} style="${elStyle(e)}"><div class="s-block b-${esc(b.type)}" style="zoom:${z.toFixed(2)}">${b.html}</div></div>`;
    }
    return '';
  }
  function render(deck, s, ctx) {
    const m = build(deck, s, ctx); if (!m) return null;
    const html = m.els.map((e) => elHtml(e, ctx)).join('');
    return { html: `<div class="layer" data-bg="${m.bg}" style="background:${BG_FILL[m.bg]}">${html}</div>`, bg: m.bg, dark: m.dark, els: m.els };
  }

  // عناصر حرة تُضاف يدوياً
  function newExtra(type, W, H, extra) {
    const id = 'x' + Date.now().toString(36) + (++seq).toString(36);
    const base = { id, type, x: W * 0.3, y: H * 0.35, w: W * 0.4, h: H * 0.2 };
    if (type === 'text') return Object.assign(base, { text: 'نص جديد', size: 32, weight: 700, color: INK, align: 'right', lh: 1.4, anchor: 'm', font: 'b', field: 'extra.' + id, ph: 'اكتب هنا' });
    if (type === 'rect') return Object.assign(base, { fill: GOLD, radius: 16, shape: 'rect', h: H * 0.2 });
    if (type === 'hex') return Object.assign(base, { type: 'rect', fill: GOLD, shape: 'hex', w: 160, h: 160 });
    if (type === 'ellipse') return Object.assign(base, { type: 'rect', fill: '#007f73', shape: 'ellipse', w: 160, h: 160 });
    if (type === 'photo') return Object.assign(base, { w: W * 0.34, h: H * 0.4, radius: 14, photo: { src: '', x: 50, y: 40, scale: 1, ov: Object.assign(officialOverlay('bottom'), { on: false }) } });
    if (type === 'block') return Object.assign(base, { w: W * 0.5, h: H * 0.45, blockId: extra && extra.blockId });
    return base;
  }

  return { overflows, extras, GOLD, FONT, LAYOUTS, isOfficial, DIRS, officialOverlay, normPhoto, overlayCss, photoGeom, fit, rgba, build, render, elHtml, newExtra, esc, clamp, BG_FILL };
});
