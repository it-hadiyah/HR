/* مولّد التقرير المشترك بين المتصفح (للمعاينة) والخادم (للصفحة النهائية).
   يحوّل بيانات التقرير إلى HTML مصدر، ثم يقوم paginate.js بتقسيمه إلى صفحات A4. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./templates.js'), require('./calc.js'));
  else root.RBR = factory(root.RBT, root.RBC);
})(typeof self !== 'undefined' ? self : this, function (T, C) {
  'use strict';

  const SERIES = ['#1f7a5c', '#3cc79a', '#145a43', '#e0b04a', '#d96c4f', '#7d93a8'];
  const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote']);
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  const escRaw = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[,٬\s%]/g, '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))); return Number.isFinite(n) ? n : 0; };
  const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------- تنظيف HTML الغني (قائمة بيضاء، بدون أي سمات) ---------- */
  function escText(s, map) {
    s = String(s).replace(/&(?!(?:amp|lt|gt|quot|nbsp|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return map ? map(s) : s;
  }
  function sanitize(html, map) {
    html = String(html == null ? '' : html).replace(/<(script|style|iframe|object|embed|noscript|template|textarea|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
    const out = [], stack = [];
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    let last = 0, m;
    while ((m = re.exec(html))) {
      out.push(escText(html.slice(last, m.index), map));
      last = re.lastIndex;
      if (!m[2]) continue;
      const tag = m[2].toLowerCase(), close = !!m[1];
      if (tag === 'br') { if (!close) out.push('<br>'); continue; }
      const norm = { b: 'strong', i: 'em', div: 'p', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4' }[tag] || tag;
      if (!ALLOWED.has(norm)) continue;
      if (close) { const i = stack.lastIndexOf(norm); if (i >= 0) while (stack.length > i) out.push('</' + stack.pop() + '>'); }
      else { stack.push(norm); out.push('<' + norm + '>'); }
    }
    out.push(escText(html.slice(last), map));
    while (stack.length) out.push('</' + stack.pop() + '>');
    return out.join('');
  }
  const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();

  /* ---------- الرسوم البيانية (SVG بدون مكتبات) ---------- */
  function chartSvg(c, E) {
    const data = (c.data || []).map((d) => ({ label: String(d.label == null ? '' : d.label), value: num(d.value) })).filter((d) => d.label || d.value);
    if (!data.length) return '';
    const unit = c.unit ? E(c.unit) : '';
    const max = Math.max(...data.map((d) => d.value), 1);
    const W = 480, H = 250, kind = c.kind;
    const grid = (t, ih, l, r) => [0.25, 0.5, 0.75, 1].map((p) => `<line class="gl" x1="${l}" x2="${W - r}" y1="${t + ih - ih * p}" y2="${t + ih - ih * p}"/>`).join('');

    if (kind === 'bar') {
      const p = { l: 14, r: 14, t: 26, b: 40 }, iw = W - p.l - p.r, ih = H - p.t - p.b, step = iw / data.length, bw = Math.min(64, step * 0.62);
      const bars = data.map((d, i) => {
        const h = (d.value / max) * ih, x = p.l + i * step + (step - bw) / 2, y = p.t + ih - h;
        return `<rect class="bar s0" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="4"/>
          <text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${E(fmt(d.value))}${unit}</text>
          <text class="l" x="${(x + bw / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">${E(short(d.label, 12))}</text>`;
      }).join('');
      return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid(p.t, ih, p.l, p.r)}<line class="ax" x1="${p.l}" x2="${W - p.r}" y1="${p.t + ih}" y2="${p.t + ih}"/>${bars}</svg>`;
    }

    if (kind === 'line' || kind === 'area') {
      const p = { l: 30, r: 30, t: 28, b: 40 }, iw = W - p.l - p.r, ih = H - p.t - p.b, step = data.length > 1 ? iw / (data.length - 1) : 0;
      const pts = data.map((d, i) => [p.l + (data.length > 1 ? i * step : iw / 2), p.t + ih - (d.value / max) * ih]);
      const line = pts.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ');
      const area = kind === 'area' ? `<polygon class="area s0" points="${p.l},${p.t + ih} ${line} ${pts[pts.length - 1][0].toFixed(1)},${p.t + ih}"/>` : '';
      const dots = data.map((d, i) => `<circle class="dot s0" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4.5"/>
        <text class="v" x="${pts[i][0].toFixed(1)}" y="${(pts[i][1] - 10).toFixed(1)}" text-anchor="middle">${E(fmt(d.value))}${unit}</text>
        <text class="l" x="${pts[i][0].toFixed(1)}" y="${H - 16}" text-anchor="middle">${E(short(d.label, 12))}</text>`).join('');
      return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid(p.t, ih, p.l, p.r)}<line class="ax" x1="${p.l}" x2="${W - p.r}" y1="${p.t + ih}" y2="${p.t + ih}"/>${area}<polyline class="ln s0" points="${line}"/>${dots}</svg>`;
    }

    if (kind === 'hbar') {
      const rowH = Math.min(34, 200 / data.length), gap = 10, labelW = 110, top = 6;
      const rows = data.map((d, i) => {
        const w = Math.max((d.value / max) * (W - labelW - 80), 0), y = top + i * (rowH + gap);
        return `<text class="l" x="${W - 4}" y="${y + rowH / 2 + 4}" text-anchor="end">${E(short(d.label, 16))}</text>
          <rect class="bar s0" x="${(W - labelW - w).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" rx="4"/>
          <text class="v" x="${(W - labelW - w - 8).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="end">${E(fmt(d.value))}${unit}</text>`;
      }).join('');
      return `<svg viewBox="0 0 ${W} ${top + data.length * (rowH + gap)}" role="img">${rows}</svg>`;
    }

    if (kind === 'gauge') {
      const v = data[0].value, mx = num(c.max) > 0 ? num(c.max) : 100, ratio = Math.max(0, Math.min(1, v / mx));
      return `<svg viewBox="0 0 200 138" role="img"><path class="gg-bg" d="M20 100 A80 80 0 0 1 180 100" pathLength="100"/><path class="gg-fg" d="M20 100 A80 80 0 0 1 180 100" pathLength="100" stroke-dasharray="${(ratio * 100).toFixed(2)} 100"/><text class="big" x="100" y="94" text-anchor="middle">${E(fmt(v))}${unit}</text><text class="l" x="20" y="116" text-anchor="middle">0</text><text class="l" x="180" y="116" text-anchor="middle">${E(fmt(mx))}</text><text class="l" x="100" y="132" text-anchor="middle">${E(data[0].label)}</text></svg>`;
    }

    if (kind === 'radar') {
      const n = Math.max(data.length, 3), cx = 150, cy = 130, R = 85, pts = [];
      const ang = (i) => -Math.PI / 2 - (i * 2 * Math.PI) / n; // عكس عقارب الساعة ليناسب الاتجاه العربي
      const pt = (i, f) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];
      const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon class="rd-grid" points="${Array.from({ length: n }, (_, i) => pt(i, f).map((x) => x.toFixed(1)).join(',')).join(' ')}"/>`).join('');
      const spokes = Array.from({ length: n }, (_, i) => { const p = pt(i, 1); return `<line class="rd-grid" x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`; }).join('');
      data.forEach((d, i) => pts.push(pt(i, Math.max(0, d.value) / max)));
      while (pts.length < n) pts.push([cx, cy]);
      const labels = data.map((d, i) => { const p = pt(i, 1.2), a = Math.cos(ang(i)); return `<text class="l" x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="${a > 0.3 ? 'start' : a < -0.3 ? 'end' : 'middle'}">${E(short(d.label, 12))}</text>`; }).join('');
      const dots = pts.slice(0, data.length).map((p, i) => `<circle class="rd-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"/><text class="v" x="${p[0].toFixed(1)}" y="${(p[1] - 7).toFixed(1)}" text-anchor="middle">${E(fmt(data[i].value))}</text>`).join('');
      return `<svg viewBox="0 0 300 262" role="img">${rings}${spokes}<polygon class="rd-area" points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ')}"/>${dots}${labels}</svg>`;
    }

    if (kind === 'funnel') {
      const rowH = Math.min(38, 220 / data.length), gap = 4, maxW = 300, cx = 150, first = data[0].value || 1;
      const rows = data.map((d, i) => {
        const w1 = Math.max(24, (d.value / max) * maxW), nxt = data[i + 1] ? Math.max(24, (data[i + 1].value / max) * maxW) : w1 * 0.8, y = i * (rowH + gap);
        const poly = `${cx - w1 / 2},${y} ${cx + w1 / 2},${y} ${cx + nxt / 2},${y + rowH} ${cx - nxt / 2},${y + rowH}`;
        return `<polygon class="fn" style="opacity:${(1 - i * 0.55 / data.length).toFixed(2)}" points="${poly}"/><text class="fnv" x="${cx}" y="${y + rowH / 2 + 4}" text-anchor="middle">${E(fmt(d.value))}${unit}</text><text class="l" x="${W - 4}" y="${y + rowH / 2 - 2}" text-anchor="end">${E(short(d.label, 14))}</text><text class="l mut" x="${W - 4}" y="${y + rowH / 2 + 12}" text-anchor="end">${E(Math.round((d.value / first) * 100))}%</text>`;
      }).join('');
      return `<svg viewBox="0 0 ${W} ${data.length * (rowH + gap)}" role="img">${rows}</svg>`;
    }

    if (kind === 'waterfall') {
      // أول عنصر = الرصيد الافتتاحي، والباقي تغيّرات (موجب/سالب)، ويُضاف تلقائياً عمود «الإجمالي»
      const steps = []; let cum = 0;
      data.forEach((d, i) => { if (i === 0) { cum = d.value; steps.push({ label: d.label, from: 0, to: cum, kind: 'tot', val: d.value }); } else { const from = cum; cum += d.value; steps.push({ label: d.label, from, to: cum, kind: d.value >= 0 ? 'up' : 'dn', val: d.value }); } });
      steps.push({ label: 'الإجمالي', from: 0, to: cum, kind: 'tot', val: cum });
      const lo = Math.min(0, ...steps.flatMap((s) => [s.from, s.to])), hi = Math.max(1, ...steps.flatMap((s) => [s.from, s.to]));
      const p = { l: 14, r: 14, t: 28, b: 40 }, iw = W - p.l - p.r, ih = H - p.t - p.b, step = iw / steps.length, bw = Math.min(46, step * 0.64);
      const y = (v) => p.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
      const bars = steps.map((s, i) => {
        const x = p.l + i * step + (step - bw) / 2, top = y(Math.max(s.from, s.to)), h = Math.max(1.5, Math.abs(y(s.from) - y(s.to)));
        const conn = i < steps.length - 1 ? `<line class="wf-c" x1="${(x + bw).toFixed(1)}" x2="${(x + step).toFixed(1)}" y1="${y(s.to).toFixed(1)}" y2="${y(s.to).toFixed(1)}"/>` : '';
        const txt = s.kind === 'tot' ? fmt(s.val) : (s.val >= 0 ? '+' : '−') + fmt(Math.abs(s.val));
        return `${conn}<rect class="bar wf-${s.kind}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/><text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle">${E(txt)}${unit}</text><text class="l" x="${(x + bw / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">${E(short(s.label, 11))}</text>`;
      }).join('');
      return `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="ax" x1="${p.l}" x2="${W - p.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>${bars}</svg>`;
    }

    // donut / pie
    const isPie = kind === 'pie';
    const total = data.reduce((s, d) => s + d.value, 0) || 1, R = isPie ? 35 : 70, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = data.map((d, i) => {
      const len = (d.value / total) * C;
      const el = `<circle class="arc s${i % 6}" cx="100" cy="100" r="${R}" fill="none" stroke-width="${isPie ? 70 : 30}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)"/>`;
      off += len; return el;
    }).join('');
    const centre = data.length === 1 ? Math.round(data[0].value) + '%' : fmt(total);
    const legend = data.map((d, i) => `<li><i class="sw s${i % 6}"></i><span>${E(d.label)}</span><b><bdi>${E(fmt(d.value))}${unit}</bdi></b><em>${Math.round((d.value / total) * 100)}%</em></li>`).join('');
    return `<div class="donut"><svg viewBox="0 0 200 200" role="img">${arcs}${isPie ? '' : `<text class="big" x="100" y="108" text-anchor="middle">${E(centre)}</text>`}</svg><ul class="legend">${legend}</ul></div>`;
  }

  // رسم أعمدة مزدوجة (الفترة السابقة مقابل الحالية)
  function compareSvg(c, E) {
    const items = C.compareRows(c).filter((r) => r.dir !== 'na').slice(0, 8);
    if (!items.length) return '';
    const L = c.labels || {}, W = 480, H = 270, p = { l: 14, r: 14, t: 44, b: 40 }, iw = W - p.l - p.r, ih = H - p.t - p.b;
    const max = Math.max(...items.flatMap((r) => [Math.max(r.prev, 0), Math.max(r.curr, 0)]), 1), step = iw / items.length, bw = Math.min(40, step * 0.34);
    const bars = items.map((r, i) => {
      const cx = p.l + i * step + step / 2;
      const one = (v, x, cls) => { const h = (Math.max(v, 0) / max) * ih, y = p.t + ih - h; return `<rect class="bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/><text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${E(C.fmtNum(v))}</text>`; };
      return one(r.prev, cx - bw - 2, 's1') + one(r.curr, cx + 2, 's0') + `<text class="l" x="${cx.toFixed(1)}" y="${H - 16}" text-anchor="middle">${E(short(r.label, 14))}</text>`;
    }).join('');
    const legend = `<rect class="bar s1" x="${W - 150}" y="8" width="12" height="12" rx="2"/><text class="l" x="${W - 154}" y="19" text-anchor="end">${E(short(L.prev || 'السابقة', 16))}</text><rect class="bar s0" x="${W - 14 - 12}" y="8" width="12" height="12" rx="2"/><text class="l" x="${W - 30}" y="19" text-anchor="end">${E(short(L.curr || 'الحالية', 16))}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${legend}${[0.5, 1].map((q) => `<line class="gl" x1="${p.l}" x2="${W - p.r}" y1="${p.t + ih - ih * q}" y2="${p.t + ih - ih * q}"/>`).join('')}<line class="ax" x1="${p.l}" x2="${W - p.r}" y1="${p.t + ih}" y2="${p.t + ih}"/>${bars}</svg>`;
  }

  /* ---------- أقسام التقرير ---------- */
  function isEmptySection(s) {
    const c = s.content;
    switch (s.type) {
      case 'text': return !plain(c);
      case 'list': return !(c && (c.items || []).some((i) => String(i).trim()));
      case 'table': return !(c && (c.rows || []).some((r) => r.some((x) => String(x).trim())));
      case 'kpi': return !(c && (c.items || []).some((k) => k && (k.label || k.value)));
      case 'chart': return !(c && (c.data || []).some((d) => d && (d.label || d.value)));
      case 'progress': return !(c && (c.items || []).some((i) => i && (i.label || i.value)));
      case 'timeline': return !(c && (c.items || []).some((i) => i && (i.title || i.date)));
      case 'image': return !(c && c.src);
      case 'gantt': return !(c && (c.items || []).some((i) => i && i.name && isoOk(i.start) && isoOk(i.end)));
      case 'calc': return !C.calcHasInput(c);
      case 'compare': return !C.compareHasData(c);
      case 'callout': return !(c && String(c.text || '').trim());
      case 'pagebreak': return false;
      default: return true;
    }
  }

  // ربط الرسم بمؤشر مركزي: تُستبدل البيانات بآخر قيم المؤشر عند التصيير
  function applyRef(s, map) {
    const ref = s && s.type === 'chart' && s.content && s.content.ref;
    const ind = ref && map && map[ref];
    if (!ind) return s;
    return Object.assign({}, s, { source: s.source || ind.source, asOf: s.asOf || ind.asOf, content: Object.assign({}, s.content, { unit: s.content.unit || ind.unit, data: ind.series.map((p) => ({ label: p.label, value: p.value })) }) });
  }
  const applyRefs = (report, map) => (map ? Object.assign({}, report, { sections: (report.sections || []).map((x) => applyRef(x, map)) }) : report);

  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));
  const SAFE_IMG = /^(?:data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+|\/brand\/icons\/(?:hex|plain)\/[a-z0-9-]{1,40}\.svg)$/;
  const SLUG = /^[a-z0-9-]{1,40}$/;
  const iconUrl = (slug, v) => (SLUG.test(slug || '') ? `/report-builder/brand/icons/${v || 'hex'}/${slug}.svg` : '');

  function makeRenderer(report, ctx) {
    ctx = ctx || {};
    const opts = Object.assign({}, T.DEFAULT_OPTIONS, report.options || {});
    const map = opts.arabicDigits ? (s) => s.replace(/[0-9]/g, (d) => AR_DIGITS[d]) : null;
    const E = (v) => { const s = escRaw(v); return map ? map(s) : s; };
    const cfg = ctx.config || {};

    function body(s) {
      const c = s.content || {};
      switch (s.type) {
        case 'text': return `<div class="rt" data-split>${sanitize(c, map)}</div>`;
        case 'list': {
          const tag = c.ordered ? 'ol' : 'ul';
          return `<${tag} class="lst" data-split>${(c.items || []).filter((i) => String(i).trim()).map((i) => `<li>${E(i)}</li>`).join('')}</${tag}>`;
        }
        case 'table': {
          const heads = (c.headers || []).map((h) => `<th>${E(h)}</th>`).join('');
          const body = (c.rows || []).filter((r) => r.some((x) => String(x).trim()));
          let lo = Infinity, hi = -Infinity;
          if (c.heat) body.forEach((r) => r.forEach((x, j) => { const n = j > 0 ? C.toNum(x) : null; if (n !== null) { lo = Math.min(lo, n); hi = Math.max(hi, n); } }));
          const cell = (x, j) => { const n = c.heat && j > 0 ? C.toNum(x) : null; if (n === null || hi <= lo) return `<td>${E(x)}</td>`; const p = Math.round(8 + 82 * ((n - lo) / (hi - lo))); return `<td class="hm" style="background:color-mix(in srgb, var(--a) ${p}%, #fff);color:${p > 52 ? '#fff' : '#17212c'}">${E(x)}</td>`; };
          const rows = body.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
          return `<div class="tw"><table class="tbl${c.zebra === false || c.heat ? '' : ' zebra'}${c.heat ? ' heat' : ''}"><thead><tr>${heads}</tr></thead><tbody data-split>${rows}</tbody></table></div>`;
        }
        case 'kpi': {
          const items = (c.items || []).filter((k) => k && (k.label || k.value));
          return `<div class="kpis ${c.style === 'highlights' ? 'hl' : 'cards'}">${items.map((k) => {
            const t = String(k.trend || '').trim(), down = /^[-−]/.test(t);
            const trend = t ? `<em class="${down ? 'dn' : 'up'}"><span aria-hidden="true">${down ? '▼' : '▲'}</span> <bdi>${E(t.replace(/^[-−+]/, ''))}</bdi></em>` : '';
            const ic = iconUrl(k.icon) ? `<img class="kpi-ic" src="${iconUrl(k.icon)}" alt="">` : '';
            return `<div class="kpi">${ic}<span class="kl">${E(k.label)}</span><b class="kv"><bdi>${E(k.value)}</bdi></b>${trend}</div>`;
          }).join('')}</div>`;
        }
        case 'chart': return `<figure class="chart ck-${escRaw(c.kind || 'bar')}">${chartSvg(c, E)}</figure>`;
        case 'progress':
          return `<div class="prog">${(c.items || []).filter((i) => i && (i.label || i.value)).map((i) => {
            const v = Math.max(0, Math.min(100, num(i.value)));
            return `<div class="pr"><div class="pl"><span>${E(i.label)}</span><b><bdi>${E(fmt(v))}%</bdi></b></div><div class="pbar" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><i style="width:${v}%"></i></div></div>`;
          }).join('')}</div>`;
        case 'timeline':
          return `<ol class="tl" data-split>${(c.items || []).filter((i) => i && (i.title || i.date)).map((i) =>
            `<li class="st-${['done', 'active', 'todo'].includes(i.status) ? i.status : 'todo'}"><span class="td">${E(i.date)}</span><div><b>${E(i.title)}</b>${i.desc ? `<p>${E(i.desc)}</p>` : ''}</div></li>`).join('')}</ol>`;
        case 'image':
          return SAFE_IMG.test(c.src || '') ? `<figure class="img"><img src="${c.src}" alt="${E(c.caption || s.title || '')}" style="max-height:${Math.max(60, Math.min(600, parseInt(c.height, 10) || 220))}px;object-fit:${c.fit === 'cover' ? 'cover' : 'contain'}">${c.caption ? `<figcaption>${E(c.caption)}</figcaption>` : ''}</figure>` : '';
        case 'gantt': {
          const items = (c.items || []).filter((i) => i && i.name && isoOk(i.start) && isoOk(i.end) && Date.parse(i.end) >= Date.parse(i.start));
          if (!items.length) return '';
          const DAY = 86400000, t0 = Math.min(...items.map((i) => Date.parse(i.start))), t1 = Math.max(...items.map((i) => Date.parse(i.end))) + DAY;
          const a = new Date(t0), start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1), e = new Date(t1), end = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1), total = end - start;
          const months = []; for (let t = new Date(start); t.getTime() < end && months.length < 36; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))) months.push(new Date(t));
          const nm = (d) => d.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 || d === months[0] ? ' ' + d.getUTCFullYear() : '');
          const pctx = (t) => (((t - start) / total) * 100).toFixed(3);
          const head = months.map((m, i) => `<span style="right:${pctx(m.getTime())}%;width:${(((i + 1 < months.length ? months[i + 1].getTime() : end) - m.getTime()) / total * 100).toFixed(3)}%">${E(nm(m))}</span>`).join('');
          const rows = items.map((i) => {
            const s = Date.parse(i.start), f = Date.parse(i.end) + DAY, pr = Math.max(0, Math.min(100, C.toNum(i.progress) || 0));
            return `<div class="g-name"><b>${E(i.name)}</b>${i.owner ? `<small>${E(i.owner)}</small>` : ''}</div><div class="g-track"><i class="g-bar" style="right:${pctx(s)}%;width:${(((f - s) / total) * 100).toFixed(3)}%"><b style="width:${pr}%"></b><em>${pr ? E(pr + '%') : ''}</em></i></div>`;
          }).join('');
          const today = Date.now(), tl = today >= start && today < end ? `<i class="g-today" style="right:${pctx(today)}%"></i>` : '';
          return `<div class="gantt"><div class="g-corner"></div><div class="g-head">${head}</div>${rows}${tl ? `<div class="g-ov">${tl}</div>` : ''}</div>`;
        }
        case 'calc': {
          const ev = C.evalCalc(c), rows = (c.rows || []).filter((x) => x && (x.label || (x.kind !== 'calc' && C.toNum(x.value) !== null)));
          const val = (x) => (ev.errors[x.key] ? '<span class="cerr">خطأ</span>' : `<bdi>${E(C.fmtRow(ev.values[x.key], x))}</bdi>`);
          if (c.style === 'cards') return `<div class="kpis cards calc-cards">${rows.map((x) => `<div class="kpi${x.kind === 'calc' ? ' res' : ''}"><span class="kl">${E(x.label)}</span><b class="kv">${val(x)}</b></div>`).join('')}</div>`;
          return `<div class="tw"><table class="tbl calc"><tbody>${rows.map((x) => `<tr class="${x.kind === 'calc' ? 'res' : 'inp'}"><th scope="row">${E(x.label)}</th><td class="num">${val(x)}</td></tr>`).join('')}</tbody></table></div>`;
        }
        case 'compare': {
          const L = c.labels || {}, d = c.decimals == null ? 1 : c.decimals, rows = C.compareRows(c);
          const cell = (r) => {
            if (r.dir === 'na') return '<span class="chg flat">—</span>';
            const arrow = r.dir === 'up' ? '▲' : r.dir === 'down' ? '▼' : '■', cls = r.good === true ? 'good' : r.good === false ? 'bad' : 'flat';
            return `<span class="chg ${cls}"><span aria-hidden="true">${arrow}</span> <bdi>${r.dir === 'flat' ? E('0%') : r.pct === null ? E('جديد') : E(C.fmtNum(Math.abs(r.pct), d) + '%')}</bdi></span>`;
          };
          const unit = (r, v) => `<bdi>${E(C.fmtNum(v) + (r.unit ? ' ' + r.unit : ''))}</bdi>`;
          const sumLines = c.summary !== false ? rows.map((r) => C.compareSentence(r, L)).filter(Boolean) : [];
          let out;
          if (rows.length === 1 && rows[0].dir !== 'na') {
            const r = rows[0];
            out = `<div class="kpis cards cmp-cards"><div class="kpi"><span class="kl">${E(L.prev)}</span><b class="kv">${unit(r, r.prev)}</b></div><div class="kpi"><span class="kl">${E(L.curr)}</span><b class="kv">${unit(r, r.curr)}</b></div><div class="kpi res ${r.good === false ? 'badres' : ''}"><span class="kl">${E(r.label || 'التغيّر')}</span><b class="kv">${cell(r)}</b></div></div>`;
          } else {
            out = `<div class="tw"><table class="tbl zebra cmp"><thead><tr><th>${E('البند')}</th><th>${E(L.prev)}</th><th>${E(L.curr)}</th><th>${E('الفرق')}</th><th>${E('التغيّر')}</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${E(r.label)}</th><td class="ctr">${r.prev === null ? '—' : unit(r, r.prev)}</td><td class="ctr">${r.curr === null ? '—' : unit(r, r.curr)}</td><td class="ctr">${r.change === null ? '—' : `<bdi>${E((r.change > 0 ? '+' : r.change < 0 ? '−' : '') + C.fmtNum(Math.abs(r.change)) + (r.unit ? ' ' + r.unit : ''))}</bdi>`}</td><td class="ctr">${cell(r)}</td></tr>`).join('')}</tbody></table></div>`;
          }
          if (c.chart !== false && rows.some((r) => r.dir !== 'na') && !(rows.length === 1 && c.chart === 'auto')) out += `<figure class="chart cmpchart">${compareSvg(c, E)}</figure>`;
          if (sumLines.length) out += `<ul class="cmp-sum">${sumLines.map((l) => `<li>${E(l)}</li>`).join('')}</ul>`;
          return out;
        }
        case 'callout': return `<div class="call tone-${['info', 'success', 'warn'].includes(c.tone) ? c.tone : 'info'}"><p>${E(c.text).replace(/\r?\n/g, '<br>')}</p></div>`;
        default: return '';
      }
    }

    function sourceNote(s) {
      const src = String(s.source || '').trim(), d = isoOk(s.asOf) ? s.asOf : '';
      if (!src && !d) return '';
      return `<p class="src-note">${src ? `المصدر: ${E(src)}` : ''}${src && d ? ' · ' : ''}${d ? `آخر تحديث: <bdi>${E(d)}</bdi>` : ''}</p>`;
    }

    function section(s, i) {
      s = applyRef(s, ctx.indicators);
      if (s.visible === false) return '';
      if (s.type === 'pagebreak') return `<div class="blk pb" data-sid="${escRaw(s.id)}"></div>`;
      const empty = isEmptySection(s);
      if (empty && !ctx.preview) return '';
      const sic = iconUrl(s.icon) ? `<img class="bt-ic" src="${iconUrl(s.icon)}" alt="">` : '';
      const title = s.title || sic ? `<h2 class="bt">${sic}${E(s.title)}</h2>` : '';
      const w = s.width === 'half' ? 'half' : 'full';
      if (empty) return `<section class="blk ph w-${w}" data-sid="${escRaw(s.id)}" data-title="${escRaw(s.title)}">${title}<p class="phm">${E(s.hint || 'سيظهر هنا ما تكتبه في هذا القسم')}</p></section>`;
      return `<section class="blk b-${s.type} w-${w}" data-sid="${escRaw(s.id)}" data-title="${escRaw(s.title)}">${title}${body(s)}${sourceNote(s)}</section>`;
    }

    function logoHtml(cls, o) {
      o = o || {};
      const src = o.vertical ? (o.light ? cfg.logoVerticalLight : cfg.logoVertical) : (o.light ? cfg.logoLight : cfg.logo);
      const use = src || cfg.logo;
      return use ? `<img class="${cls}" src="${escRaw(use)}" alt="${E(cfg.orgName)}">` : '';
    }
    const patternHtml = (cls, light) => { const p = light ? cfg.patternLight : cfg.pattern; return p ? `<img class="${cls}" src="${escRaw(p)}" alt="">` : ''; };

    function cover() {
      if (opts.cover === false) return '';
      const t = T.byId(report.template);
      const lightCover = t.cover === 'hero' || t.cover === 'split';
      const meta = [report.employee && `<div><span>إعداد</span><b>${E(report.employee)}</b></div>`, report.department && `<div><span>الإدارة / القسم</span><b>${E(report.department)}</b></div>`, report.date && `<div><span>التاريخ</span><b><bdi>${E(report.date)}</bdi></b></div>`].filter(Boolean).join('');
      return `<div class="cover-src cv-${escRaw(t.cover)}">
        <div class="cv-top">${logoHtml('cv-logo', { light: lightCover })}<div class="cv-org"><strong>${E(cfg.orgName)}</strong><span>${E(cfg.orgSubName)}</span></div>${ctx.noMark || (ctx.workflow && ctx.workflow.status === 'approved') ? '' : '<div class="cv-unap" role="note">غير معتمد</div>'}</div>
        <div class="cv-main">${ctx.workflow && ctx.workflow.status === 'approved' ? '<div class="ribbon ok">معتمد</div>' : report.sample ? '<div class="ribbon">بيانات تجريبية</div>' : ''}<small class="cv-kind">${E(t.name)}</small><h1>${E(report.title || 'عنوان التقرير')}</h1>${report.subtitle ? `<p class="cv-sub">${E(report.subtitle)}</p>` : ''}${report.period ? `<p class="cv-period">${E(report.period)}</p>` : ''}</div>
        <div class="cv-meta">${meta}</div>${iconUrl(opts.coverIcon, 'plain') ? `<img class="cv-icon" src="${iconUrl(opts.coverIcon, 'plain')}" alt="">` : ''}${patternHtml('cv-pattern', t.cover === 'hero')}</div>`;
    }

    function closing() {
      if (!opts.closing) return '';
      const c = cfg.contact || {};
      const lines = [c.phone && `هاتف: <bdi>${E(c.phone)}</bdi>`, c.email && `<bdi>${E(c.email)}</bdi>`, c.website && `<bdi>${E(c.website)}</bdi>`, c.address && E(c.address)].filter(Boolean).map((l) => `<p>${l}</p>`).join('');
      return `<div class="closing-src">${logoHtml('cl-logo', { light: true, vertical: true })}<h2>شكراً لكم</h2><p class="cl-org">${E(cfg.orgName)}</p>${lines}${patternHtml('cl-pattern', true)}</div>`;
    }

    function stamp() {
      const w = ctx.workflow;
      if (!w || !w.status || w.status === 'draft' || ctx.preview) return '';
      const day = (iso) => E(String(iso || '').slice(0, 10));
      const note = (n) => (n ? `<p class="stn">${E(n)}</p>` : '');
      if (w.status === 'approved') return `<section class="blk stamp ok"><div class="seal" aria-hidden="true">✓</div><div><b>تم اعتماد التقرير</b><p>اعتمده: ${E(w.decidedByName || '')} · بتاريخ <bdi>${day(w.decidedAt)}</bdi></p>${note(w.decisionNote)}</div></section>`;
      if (w.status === 'submitted') return `<section class="blk stamp wait"><div><b>بانتظار الاعتماد</b><p>أُرسل إلى: ${E(w.sharedWithName || '')} · بتاريخ <bdi>${day(w.submittedAt)}</bdi></p></div></section>`;
      return `<section class="blk stamp ret"><div><b>أُعيد للتعديل</b><p>بواسطة: ${E(w.decidedByName || '')}</p>${note(w.decisionNote)}</div></section>`;
    }

    function source() {
      const secs = (report.sections || []).map(section).join('') + stamp();
      const footer = opts.footerText || cfg.footerText || '';
      return `${cover()}
        ${opts.toc ? '<div class="toc-src"></div>' : ''}
        <div class="flow">${secs}</div>
        ${closing()}
        <template id="tpl-head">${opts.header === false ? '' : `<div class="sh">${logoHtml('sh-logo')}<span class="sh-org">${E(cfg.orgName)}</span><span class="sh-title">${E(report.title)}</span></div>`}</template>
        <template id="tpl-foot"><div class="sf"><span>${E(footer)}</span>${opts.pageNumbers === false ? '' : '<span class="pg">صفحة <b class="pn"></b> من <b class="pt"></b></span>'}</div></template>`;
    }

    function rootAttrs() {
      const p = T.PALETTES[report.palette] || T.PALETTES.green;
      const t = T.byId(report.template);
      return { style: `--a:${p.a};--d:${p.d};--s:${p.s};--x:${p.x}`, cls: `rpt h-${t.head} m-${['narrow', 'normal', 'wide'].includes(opts.margins) ? opts.margins : 'normal'}${opts.arabicDigits ? ' ad' : ''}`, title: `${report.title || 'تقرير'}${report.date ? ' - ' + report.date : ''}` };
    }
    return { source, rootAttrs, E, body, logoHtml, patternHtml, sourceNote };
  }

  function renderSource(report, ctx) { return makeRenderer(report, ctx).source(); }

  /* الصفحة الكاملة للتقرير المحفوظ */
  function renderPage(report, ctx) {
    ctx = ctx || {};
    const r = makeRenderer(report, ctx), a = r.rootAttrs();
    const id = ctx.id ? escRaw(ctx.id) : '';
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escRaw(a.title)}</title>
<link rel="icon" href="/report-builder/brand/logo-icon.png" type="image/png">
<link rel="stylesheet" href="/report-builder/css/tokens.css">
<link rel="stylesheet" href="/report-builder/css/report.css">
<link rel="stylesheet" href="/report-builder/css/components.css">
${ctx.allowPrint === false ? '<style>@media print{body{display:none}}</style>' : ''}
</head>
<body class="${a.cls} view" style="${a.style}" data-rid="${id}">
<div class="viewbar noprint">
  <div class="vb-title"><strong>${escRaw(report.title || 'تقرير')}</strong><span id="pcount"></span><span id="vb-status" class="chip-status"></span></div>
  <div class="vb-actions" id="vb-actions">
    ${ctx.shared ? '' : '<a class="btn" href="/report-builder/list.html">تقاريري</a>'}
    ${ctx.allowPrint === false ? '' : '<button class="btn primary" onclick="window.print()">طباعة / حفظ PDF</button>'}
  </div>
</div>
<div id="toasts" class="toasts" aria-live="polite"></div>
<div id="src" hidden>${r.source()}</div>
<div id="pages" class="pages"></div>
${ctx.shared ? '' : '<script src="/report-builder/js/guard.js"></script>'}
<script src="/report-builder/js/paginate.js"></script>
${ctx.shared ? '' : '<script type="module" src="/report-builder/js/viewbar.js"></script>'}
</body>
</html>`;
  }

  return { applyRef, applyRefs, compareSvg, sanitize, plain, chartSvg, isEmptySection, makeRenderer, renderSource, renderPage, escRaw, num, fmt, SAFE_IMG, SLUG };
});
