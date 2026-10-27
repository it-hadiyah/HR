// تصدير العرض إلى PowerPoint (PPTX) بعناصر أصلية قابلة للتعديل (نصوص، جداول، أشكال)، وإلى صور PNG
// ملاحظة: الرسوم البيانية تُدرَج كصور عالية الدقة لأن الرسوم الأصلية تتطلب مصنّفات Excel مضمَّنة.
import { zip, chartCss, loadImg, toPng } from './docx.js';
import { getIndicatorMap } from './indicators-cache.js';

const RBR = window.RBR, RBC = window.RBC, RBD = window.RBD, RBT = window.RBT;
const X = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const hex = (c) => String(c).replace('#', '').toUpperCase();
const E = (px) => Math.round(px * 9525);
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const enc = new TextEncoder();

/* ---------- عناصر DrawingML ---------- */
function P(c, text, o = {}) {
  const sz = Math.round((o.sz || 18) * 100), col = hex(o.color || '17212C'), bul = o.bullet;
  const t = c.map(String(text == null ? '' : text));
  return `<a:p><a:pPr algn="${o.algn || 'r'}" rtl="1"${bul ? ' marL="342900" indent="-342900"' : ''}>${o.spc ? `<a:spcAft><a:spcPts val="${o.spc * 100}"/></a:spcAft>` : ''}${bul ? `<a:buClr><a:srgbClr val="${hex(o.bulColor || col)}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>'}</a:pPr><a:r><a:rPr lang="ar-SA" sz="${sz}" b="${o.b ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${X(t)}</a:t></a:r></a:p>`;
}
function box(c, o) {
  const id = ++c.id;
  const fill = o.fill ? `<a:solidFill><a:srgbClr val="${hex(o.fill)}"/></a:solidFill>` : '<a:noFill/>';
  const ln = o.line ? `<a:ln w="${o.lw || 12700}"><a:solidFill><a:srgbClr val="${hex(o.line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const ins = E(o.inset == null ? 8 : o.inset);
  const geom = o.geom === 'roundRect' ? '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom>' : `<a:prstGeom prst="${o.geom || 'rect'}"><a:avLst/></a:prstGeom>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${X(o.name || 'عنصر ' + id)}"/><p:cNvSpPr${o.text && !o.fill && !o.line ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm>${geom}${fill}${ln}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${o.anchor || 't'}" rtlCol="1"><a:normAutofit/></a:bodyPr><a:lstStyle/>${o.text || '<a:p><a:endParaRPr lang="ar-SA"/></a:p>'}</p:txBody></p:sp>`;
}
function pic(c, rid, o) {
  const id = ++c.id;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${X(o.name || 'صورة')}" descr="${X(o.name || 'صورة')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(o.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function tbl(c, o) {
  const id = ++c.id, n = o.rows[0].length, cw = o.cols || Array(n).fill(o.w / n), rh = o.rowH || 38;
  const cell = (t, ri, ci) => {
    const head = ri === 0, fill = head ? c.a : (ri % 2 ? 'FFFFFF' : c.s);
    const f = o.fills && o.fills[ri] && o.fills[ri][ci];
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${P(c, t, { sz: o.sz || 15, b: head || (o.boldFirst && ci === 0), color: head ? 'FFFFFF' : (f && f.color) || '17212C', algn: ci === 0 ? 'r' : 'ctr' })}</a:txBody><a:tcPr marL="${E(10)}" marR="${E(10)}" marT="${E(5)}" marB="${E(5)}" anchor="ctr"><a:lnB w="6350"><a:solidFill><a:srgbClr val="DDE3E8"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${hex((f && f.fill) || fill)}"/></a:solidFill></a:tcPr></a:tc>`;
  };
  const rows = o.rows.map((r, ri) => `<a:tr h="${E(rh)}">${r.map((t, ci) => cell(t, ri, ci)).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${X(o.name || 'جدول')}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${E(o.w)}" cy="${E(rh * o.rows.length)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr rtl="1" firstRow="1" bandRow="1"/><a:tblGrid>${cw.map((w) => `<a:gridCol w="${E(w)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/* ---------- الوسائط ---------- */
async function svgToPng(c, svgStr, scale = 2) {
  const vb = svgStr.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/); const w = +vb[1], h = +vb[2];
  const svg = svgStr.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="direction:ltr" `).replace('>', `><style>${chartCss(c)}</style>`);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  return { bytes: await toPng(img, w * scale, h * scale, '#ffffff'), w, h };
}
function addMedia(c, bytes, ext) { const n = c.media.length + 1; c.media.push({ name: `image${n}.${ext}`, data: bytes }); const rid = 'rId' + (c.rels.length + 2); c.rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/image${n}.${ext}"/>`); return rid; }
async function fetchPng(url) { const r = await fetch(url); const blob = await r.blob(); const img = await loadImg(URL.createObjectURL(blob)); return { bytes: await toPng(img, img.naturalWidth || 600, img.naturalHeight || 200, null), w: img.naturalWidth || 600, h: img.naturalHeight || 200 }; }
async function svgFilePng(path) {
  const txt = await (await fetch(path)).text();
  const vb = txt.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/); const w = vb ? +vb[1] : 100, h = vb ? +vb[2] : 100, k = 600 / Math.max(w, h);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt.replace('<svg ', `<svg width="${Math.round(w * k)}" height="${Math.round(h * k)}" `)));
  return { bytes: await toPng(img, Math.round(w * k), Math.round(h * k), null), w: w * k, h: h * k };
}
const fit = (w, h, bw, bh) => { const k = Math.min(bw / w, bh / h); return { w: w * k, h: h * k }; };

/* ---------- محتوى الشريحة (بالبكسل المنطقي للشريحة) ---------- */
async function blockShapes(c, blk, area) {
  const out = [], ct = blk.content || {}, { x, y, w, h } = area;
  switch (blk.type) {
    case 'kpi': {
      const items = (ct.items || []).filter((k) => k && (k.label || k.value)).slice(0, 8), per = Math.min(4, items.length || 1), rows = Math.ceil(items.length / per), gap = 18;
      const cw = (w - gap * (per - 1)) / per, ch = Math.min(200, (h - gap * (rows - 1)) / rows);
      items.forEach((k, i) => {
        const col = i % per, row = Math.floor(i / per), cx = x + w - (col + 1) * cw - col * gap, cy = y + row * (ch + gap);
        const t = String(k.trend || '').trim(), down = /^[-−]/.test(t);
        const text = P(c, k.label, { sz: 16, color: '4A5968', algn: 'ctr', spc: 4 }) + P(c, k.value, { sz: 34, b: true, color: c.d, algn: 'ctr', spc: 4 }) + (t ? P(c, (down ? '▼ ' : '▲ ') + t.replace(/^[-−+]/, ''), { sz: 15, b: true, color: down ? 'B3382A' : '1F7A5C', algn: 'ctr' }) : '');
        out.push(box(c, { x: cx, y: cy, w: cw, h: ch, geom: 'roundRect', fill: ct.style === 'highlights' ? 'FFFFFF' : c.s, line: ct.style === 'highlights' ? c.x : null, lw: 25400, text, anchor: 'ctr', name: 'مؤشر' }));
      });
      break;
    }
    case 'table': {
      const rows = (ct.rows || []).filter((r) => r.some((v) => String(v).trim())).slice(0, 11);
      if (!(ct.headers || []).length) break;
      const n = ct.headers.length;
      out.push(tbl(c, { x, y, w, rows: [ct.headers].concat(rows.map((r) => Array.from({ length: n }, (_, i) => r[i] || ''))), sz: n > 5 ? 12 : 15, rowH: Math.min(46, h / (rows.length + 1)), boldFirst: true, name: 'جدول' }));
      break;
    }
    case 'calc': {
      const ev = RBC.evalCalc(ct), rows = (ct.rows || []).filter((r) => r && (r.label || (r.kind !== 'calc' && RBC.toNum(r.value) !== null)));
      const fills = [null].concat(rows.map((r) => (r.kind === 'calc' ? [{ fill: c.s, color: c.d }, { fill: c.s, color: c.d }] : [])));
      out.push(tbl(c, { x, y, w, cols: [w * 0.62, w * 0.38], rows: [['البند', 'القيمة']].concat(rows.map((r) => [r.label, ev.errors[r.key] ? 'خطأ' : RBC.fmtRow(ev.values[r.key], r)])), fills, sz: 18, rowH: Math.min(54, h / (rows.length + 1)), boldFirst: true, name: 'حسابات' }));
      break;
    }
    case 'compare': {
      const rows = RBC.compareRows(ct), L = ct.labels || {}, d = ct.decimals == null ? 1 : ct.decimals;
      const un = (r, v) => (v === null ? '—' : RBC.fmtNum(v) + (r.unit ? ' ' + r.unit : ''));
      const body = rows.map((r) => [r.label, un(r, r.prev), un(r, r.curr), r.dir === 'na' ? '—' : r.dir === 'flat' ? '0%' : (r.dir === 'up' ? '▲ ' : '▼ ') + (r.pct === null ? 'جديد' : RBC.fmtNum(Math.abs(r.pct), d) + '%')]);
      const fills = [null].concat(rows.map((r) => [null, null, null, { color: r.good === true ? '1F7A5C' : r.good === false ? 'B3382A' : '647385' }].map((f, i) => (i === 3 ? f : null))));
      const tw = ct.chart !== false ? w * 0.55 : w, th = Math.min(h, 44 * (rows.length + 1));
      out.push(tbl(c, { x: x + (w - tw), y, w: tw, cols: [tw * 0.31, tw * 0.23, tw * 0.23, tw * 0.23], rows: [['البند', L.prev || 'السابقة', L.curr || 'الحالية', 'التغيّر']].concat(body), fills, sz: 14, rowH: 44, boldFirst: true, name: 'مقارنة' }));
      if (ct.chart !== false) { const svg = RBR.compareSvg(ct, (v) => RBR.escRaw(c.map(String(v)))); if (svg) { const im = await svgToPng(c, svg), f = fit(im.w, im.h, w * 0.43, h); out.push(pic(c, addMedia(c, im.bytes, 'png'), { x, y, w: f.w, h: f.h, name: 'رسم المقارنة' })); } }
      break;
    }
    case 'chart': {
      const svg = (RBR.chartSvg(ct, (v) => RBR.escRaw(c.map(String(v)))).match(/<svg[\s\S]*?<\/svg>/) || [])[0]; if (!svg) break;
      const legend = ct.kind === 'donut' || ct.kind === 'pie', im = await svgToPng(c, svg), f = fit(im.w, im.h, legend ? w * 0.55 : w, h);
      if (legend) {
        const rows = (ct.data || []).filter((d) => d && (d.label || d.value)), tot = rows.reduce((t, d) => t + RBR.num(d.value), 0) || 1;
        out.push(pic(c, addMedia(c, im.bytes, 'png'), { x, y, w: f.w, h: f.h, name: 'رسم بياني' }));
        out.push(box(c, { x: x + w * 0.58, y, w: w * 0.42, h, anchor: 'ctr', name: 'دليل الرسم', text: rows.map((d) => P(c, `${d.label}: ${d.value}${ct.unit ? ' ' + ct.unit : ''}  (${Math.round(RBR.num(d.value) / tot * 100)}%)`, { sz: 18, bullet: true, bulColor: c.x, spc: 8 })).join('') }));
      } else out.push(pic(c, addMedia(c, im.bytes, 'png'), { x: x + (w - f.w) / 2, y, w: f.w, h: f.h, name: 'رسم بياني' }));
      break;
    }
    case 'progress': {
      const items = (ct.items || []).filter((i) => i && (i.label || i.value)).slice(0, 7), rh = Math.min(70, h / Math.max(1, items.length));
      items.forEach((it, i) => {
        const v = Math.max(0, Math.min(100, RBR.num(it.value))), yy = y + i * rh;
        out.push(box(c, { x, y: yy, w: w * 0.28, h: rh - 14, text: P(c, it.label, { sz: 18 }), anchor: 'ctr', name: 'تسمية' }));
        out.push(box(c, { x: x + w * 0.3, y: yy + (rh - 14) / 2 - 11, w: w * 0.58, h: 22, geom: 'roundRect', fill: 'E3E8EE', name: 'مسار' }));
        if (v > 0) out.push(box(c, { x: x + w * 0.3 + w * 0.58 * (1 - v / 100), y: yy + (rh - 14) / 2 - 11, w: w * 0.58 * (v / 100), h: 22, geom: 'roundRect', fill: c.a, name: 'إنجاز' }));
        out.push(box(c, { x: x + w * 0.9, y: yy, w: w * 0.1, h: rh - 14, text: P(c, v + '%', { sz: 18, b: true, color: c.d, algn: 'ctr' }), anchor: 'ctr', name: 'نسبة' }));
      });
      break;
    }
    case 'timeline': {
      const items = (ct.items || []).filter((i) => i && (i.title || i.date)).slice(0, 9), st = { done: 'مكتمل', active: 'جارٍ', todo: 'قادم' };
      out.push(tbl(c, { x, y, w, cols: [w * 0.2, w * 0.58, w * 0.22], rows: [['الموعد', 'المرحلة', 'الحالة']].concat(items.map((i) => [i.date, i.title, st[i.status] || ''])), sz: 16, rowH: Math.min(50, h / (items.length + 1)), name: 'خط زمني' }));
      break;
    }
    case 'gantt': {
      const items = (ct.items || []).filter((i) => i && i.name && i.start && i.end).slice(0, 9);
      out.push(tbl(c, { x, y, w, cols: [w * 0.34, w * 0.18, w * 0.18, w * 0.14, w * 0.16], rows: [['المهمة', 'البداية', 'النهاية', 'الإنجاز', 'المسؤول']].concat(items.map((i) => [i.name, i.start, i.end, (i.progress || 0) + '%', i.owner || ''])), sz: 14, rowH: Math.min(46, h / (items.length + 1)), name: 'مخطط جانت' }));
      break;
    }
    case 'callout': out.push(box(c, { x, y, w, h: Math.min(h, 220), geom: 'roundRect', fill: c.s, line: c.a, text: P(c, ct.text || '', { sz: 22 }), anchor: 'ctr', inset: 20, name: 'ملاحظة' })); break;
    case 'image': {
      if (!ct.src) break;
      try {
        let bytes, iw, ih, ext = 'png';
        if (ct.src.startsWith('/')) { const p = await svgFilePng(ct.src); bytes = p.bytes; iw = p.w; ih = p.h; }
        else { const img = await loadImg(ct.src); iw = img.naturalWidth || 800; ih = img.naturalHeight || 600; const m = ct.src.match(/^data:image\/(png|jpe?g)/); if (m) { bytes = Uint8Array.from(atob(ct.src.split(',')[1]), (ch) => ch.charCodeAt(0)); ext = m[1] === 'png' ? 'png' : 'jpeg'; } else bytes = await toPng(img, iw, ih, null); }
        const f = fit(iw, ih, w, h - (ct.caption ? 40 : 0));
        out.push(pic(c, addMedia(c, bytes, ext), { x: x + (w - f.w) / 2, y, w: f.w, h: f.h, name: ct.caption || 'صورة' }));
        if (ct.caption) out.push(box(c, { x, y: y + f.h + 6, w, h: 34, text: P(c, ct.caption, { sz: 14, color: '647385', algn: 'ctr' }) }));
      } catch (e) { /* تخطّي الصورة غير القابلة للتحميل */ }
      break;
    }
    default: break;
  }
  return out;
}

/* ---------- الشريحة ---------- */

/* ---------- عناصر القوالب الرسمية: تُحوَّل القائمة الهندسية نفسها التي يرسمها المحرر إلى أشكال PPTX ---------- */
const RBS = window.RBS;
const parseColor = (v) => {
  v = String(v || ''); let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return { hex: m[1].toUpperCase(), a: 1 };
  m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/);
  if (m) return { hex: [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(), a: m[4] != null ? +m[4] : 1 };
  return null;
};
const clr = (v, k = 1) => { const p = parseColor(v); if (!p) return ''; const a = p.a * k; return `<a:srgbClr val="${p.hex}">${a < 1 ? `<a:alpha val="${Math.round(a * 100000)}"/>` : ''}</a:srgbClr>`; };
function geomXml(e) {
  const m = Math.max(1, Math.min(e.w, e.h));
  if (e.shape === 'ellipse') return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  if (e.shape === 'hex') return '<a:prstGeom prst="hexagon"><a:avLst><a:gd name="adj" fmla="val 25000"/><a:gd name="vf" fmla="val 115470"/></a:avLst></a:prstGeom>';
  if (e.shape === 'arch') return `<a:prstGeom prst="round2SameRect"><a:avLst><a:gd name="adj1" fmla="val 50000"/><a:gd name="adj2" fmla="val ${Math.min(50000, Math.round(18 / m * 100000))}"/></a:avLst></a:prstGeom>`;
  if (e.radius > 0) return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round(e.radius / m * 100000))}"/></a:avLst></a:prstGeom>`;
  return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
}
function rawShape(c, e, o) {
  const id = ++c.id;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${X(o.name || e.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(e.x)}" y="${E(e.y)}"/><a:ext cx="${E(e.w)}" cy="${E(e.h)}"/></a:xfrm>${geomXml(e)}${o.fillXml || '<a:noFill/>'}<a:ln><a:noFill/></a:ln>${o.shadow ? '<a:effectLst><a:outerShdw blurRad="190500" dist="63500" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="003C34"><a:alpha val="14000"/></a:srgbClr></a:outerShdw></a:effectLst>' : ''}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ar-SA"/></a:p></p:txBody></p:sp>`;
}
function textShape(c, e) {
  const id = ++c.id, size = (e.size || 28) * 0.75, anchor = { t: 't', m: 'ctr', b: 'b' }[e.anchor] || 't', al = { right: 'r', center: 'ctr', left: 'l' }[e.align] || 'r';
  const col = clr(e.color || '#17302c');
  const paras = String(e.text).split('\n').map((ln) => (ln.trim() ? `<a:p><a:pPr algn="${al}" rtl="1"><a:lnSpc><a:spcPct val="${Math.round((e.lh || 1.4) * 100000)}"/></a:lnSpc><a:buNone/></a:pPr><a:r><a:rPr lang="ar-SA" sz="${Math.round(size * 100)}" b="${(e.weight || 700) >= 600 ? 1 : 0}" dirty="0"><a:solidFill>${col}</a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${X(c.map(ln))}</a:t></a:r></a:p>` : `<a:p><a:endParaRPr lang="ar-SA" sz="${Math.round(size * 100)}"/></a:p>`)).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${X(e.id)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${E(e.x)}" y="${E(e.y)}"/><a:ext cx="${E(e.w)}" cy="${E(e.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}" rtlCol="1"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
function picXml(c, rid, e, o) {
  const id = ++c.id, cr = o.crop || { l: 0, t: 0, r: 0, b: 0 }, fr = (v) => Math.max(0, Math.round(v * 100000));
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${X(o.name || e.id)}" descr="${X(o.name || e.id)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${o.alpha != null && o.alpha < 1 ? `<a:alphaModFix amt="${Math.round(o.alpha * 100000)}"/>` : ''}</a:blip><a:srcRect l="${fr(cr.l)}" t="${fr(cr.t)}" r="${fr(cr.r)}" b="${fr(cr.b)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${E(o.x != null ? o.x : e.x)}" y="${E(o.y != null ? o.y : e.y)}"/><a:ext cx="${E(o.w != null ? o.w : e.w)}" cy="${E(o.h != null ? o.h : e.h)}"/></a:xfrm>${o.geomE ? geomXml(o.geomE) : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}</p:spPr></p:pic>`;
}
function overlayFill(ov) {
  const c = ov.color || '#005a52', st = (pos, a) => `<a:gs pos="${pos}"><a:srgbClr val="${hex(c)}"><a:alpha val="${Math.round(Math.max(0, Math.min(1, a)) * 100000)}"/></a:srgbClr></a:gs>`;
  if (ov.dir === 'all') return `<a:solidFill><a:srgbClr val="${hex(c)}"><a:alpha val="${Math.round(ov.from * 100000)}"/></a:srgbClr></a:solidFill>`;
  const rev = ov.dir === 'right' || ov.dir === 'bottom', ang = ov.dir === 'top' || ov.dir === 'bottom' ? 5400000 : 0;
  const stops = rev ? [st(0, ov.to), st(50000, ov.mid), st(100000, ov.from)] : [st(0, ov.from), st(50000, ov.mid), st(100000, ov.to)];
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops.join('')}</a:gsLst><a:lin ang="${ang}" scaled="0"/></a:gradFill>`;
}
const imgCache = new Map();
async function srcBytes(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const img = await loadImg(src); let bytes, ext = 'png';
  const m = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (m) { bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)); ext = m[1] === 'png' ? 'png' : 'jpeg'; } else bytes = await toPng(img, img.naturalWidth || 800, img.naturalHeight || 600, null);
  const r = { bytes, ext, w: img.naturalWidth || 800, h: img.naturalHeight || 600 }; imgCache.set(src, r); return r;
}
const BG_PPTX = (c, kind) => ({
  green: `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${c.d}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${c.a}"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>`,
  dark: `<a:solidFill><a:srgbClr val="${c.d}"/></a:solidFill>`,
  mint: '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="F6FAF9"/></a:gs><a:gs pos="100000"><a:srgbClr val="E4F1EE"/></a:gs></a:gsLst><a:lin ang="4000000" scaled="0"/></a:gradFill>',
  white: '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
}[kind] || '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');

async function elementShapes(c, deck, s, cfg, els) {
  const out = [];
  for (const e of els) {
    if (e.type === 'rect') {
      const p = parseColor(e.fill); if (!p) continue;
      out.push(rawShape(c, e, { fillXml: `<a:solidFill>${clr(e.fill, e.opacity != null ? e.opacity : 1)}</a:solidFill>`, shadow: e.shadow }));
    } else if (e.type === 'text') {
      if (String(e.text || '').trim()) out.push(textShape(c, e));
    } else if (e.type === 'img') {
      const url = cfg[e.kind]; if (!url) continue;
      try {
        const im = await fetchPng(url), cover = /^pattern/.test(e.kind), rid = addMedia(c, im.bytes, 'png'), op = e.opacity != null ? e.opacity : 1;
        if (cover) {
          const k = Math.max(e.w / im.w, e.h / im.h), vw = e.w / (im.w * k), vh = e.h / (im.h * k);
          out.push(picXml(c, rid, e, { crop: { l: (1 - vw) / 2, r: (1 - vw) / 2, t: (1 - vh) / 2, b: (1 - vh) / 2 }, alpha: op }));
        } else { const f = fit(im.w, im.h, e.w, e.h); out.push(picXml(c, rid, e, { x: e.x + (e.w - f.w) / 2, y: e.y + (e.h - f.h) / 2, w: f.w, h: f.h, alpha: op })); }
      } catch (x) { /* شعار غير متاح */ }
    } else if (e.type === 'photo') {
      const p = e.photo;
      if (!p.src) { if (!e.tile) out.push(rawShape(c, e, { fillXml: `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${c.d}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${c.a}"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>` })); }
      else {
        try {
          const im = await srcBytes(p.src), pp = Object.assign({}, p, { nw: p.nw || im.w, nh: p.nh || im.h }), g = RBS.photoGeom(pp, e.w, e.h), rid = addMedia(c, im.bytes, im.ext);
          if (pp.fit === 'contain') out.push(picXml(c, rid, e, { x: e.x + g.l, y: e.y + g.t, w: g.w, h: g.h, geomE: e }));
          else out.push(picXml(c, rid, e, { crop: { l: -g.l / g.w, t: -g.t / g.h, r: 1 - (-g.l + e.w) / g.w, b: 1 - (-g.t + e.h) / g.h }, geomE: e }));
        } catch (x) { /* صورة تالفة */ }
      }
      if (p.ov && p.ov.on !== false && !(e.tile && !p.src)) out.push(rawShape(c, e, { fillXml: overlayFill(p.ov), name: e.id + '-overlay' }));
    } else if (e.type === 'block') {
      const id = e.blockId || (RBD.idsOf(s)[e.bi]); const b = id && (deck.sections || []).find((x) => x.id === id); if (!b) continue;
      const bb = RBR.applyRef(b, getIndicatorMap()); if (RBR.isEmptySection(bb)) continue;
      out.push(...(await blockShapes(c, bb, { x: e.x, y: e.y, w: e.w, h: e.h })));
    }
  }
  return out;
}
const ctxFor = (deck, cfg) => ({ config: cfg, preview: false, indicators: getIndicatorMap() });

async function slideXml(c, deck, s, i, total, logos, geo) {
  const { sw, sh } = geo;
  if (RBS.isOfficial(s.layout)) {
    const m = RBS.build(deck, s, RBD.sctx(deck, ctxFor(deck, geo.cfg), RBR.makeRenderer({ options: {}, palette: deck.palette, template: 'blank', sections: [] }, {})));
    const shapes = await elementShapes(c, deck, s, geo.cfg, m.els);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr>${BG_PPTX(c, m.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }
  const L = s.layout, bg = s.bg || RBD.LAYOUTS[L].bg, dark = bg === 'brand' || bg === 'dark';
  const shapes = [];
  const fg = dark ? 'FFFFFF' : c.d;
  const logo = dark ? logos.light : logos.dark;
  const addLogo = (x, y, h) => { if (!logo) return; const f = fit(logo.w, logo.h, 400, h); shapes.push(pic(c, addMedia(c, logo.bytes, 'png'), { x, y, w: f.w, h: f.h, name: 'شعار الجمعية' })); };
  if (L === 'cover') {
    addLogo(sw - 56 - 240, 34, 54);
    shapes.push(box(c, { x: 60, y: 200, w: sw - 120, h: 170, anchor: 'b', text: P(c, s.title || deck.title, { sz: 54, b: true, color: 'FFFFFF' }), name: 'العنوان' }));
    if (s.subtitle) shapes.push(box(c, { x: 60, y: 380, w: sw - 120, h: 70, text: P(c, s.subtitle, { sz: 28, color: 'E6F4F1' }), name: 'العنوان الفرعي' }));
    const meta = [deck.presenter, deck.date].filter(Boolean).join('   ·   ');
    if (meta) shapes.push(box(c, { x: 60, y: 470, w: sw - 120, h: 50, text: P(c, meta, { sz: 18, color: 'CDE7E3' }), name: 'بيانات المقدّم' }));
  } else if (L === 'section' || L === 'closing') {
    addLogo(sw / 2 - 150, 120, L === 'closing' ? 110 : 60);
    shapes.push(box(c, { x: 60, y: 250, w: sw - 120, h: 130, anchor: 'ctr', text: P(c, s.title || (L === 'closing' ? 'شكراً لكم' : ''), { sz: 50, b: true, color: 'FFFFFF', algn: L === 'closing' ? 'ctr' : 'r' }), name: 'العنوان' }));
    const sub = s.subtitle || (L === 'closing' ? (geo.cfg.orgName || '') : '');
    if (sub) shapes.push(box(c, { x: 60, y: 390, w: sw - 120, h: 80, text: P(c, sub, { sz: 24, color: 'E6F4F1', algn: L === 'closing' ? 'ctr' : 'r' }), name: 'العنوان الفرعي' }));
  } else {
    addLogo(56, 22, 38);
    shapes.push(box(c, { x: sw - 64 - 12, y: 76, w: 8, h: 50, fill: c.x, name: 'شريط العنوان' }));
    shapes.push(box(c, { x: 60, y: 70, w: sw - 64 - 28 - 60, h: 62, anchor: 'ctr', text: P(c, s.title, { sz: 34, b: true, color: fg }), name: 'العنوان' }));
    let y0 = 150;
    if (s.subtitle) { shapes.push(box(c, { x: 60, y: 128, w: sw - 120, h: 36, text: P(c, s.subtitle, { sz: 18, color: dark ? 'CDE7E3' : '5B6B7A' }) })); y0 = 175; }
    const bl = (s.bullets || []).filter((b) => String(b).trim());
    const blks = RBD.blocksOf(deck, s).map((x) => RBR.applyRef(x, getIndicatorMap())).filter((x) => !RBR.isEmptySection(x));
    const H = sh - y0 - 56;
    if (bl.length) {
      const bw = blks.length ? (sw - 120) * 0.38 : sw - 120, size = bl.length > 6 || blks.length ? 22 : 26;
      shapes.push(box(c, { x: sw - 60 - bw, y: y0, w: bw, h: H, text: bl.map((b) => P(c, b, { sz: size, bullet: true, bulColor: c.x, spc: 8 })).join(''), name: 'نقاط' }));
    }
    if (blks.length) {
      const bw = bl.length ? (sw - 120) * 0.58 : sw - 120, rows = [];
      blks.forEach((b) => { const last = rows[rows.length - 1]; if (b.width === 'half' && last && last.length === 1 && last[0].width === 'half') last.push(b); else rows.push([b]); });
      const gap = 14, rh = (H - gap * (rows.length - 1)) / rows.length;
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri], cw = (bw - gap * (row.length - 1)) / row.length, ry = y0 + ri * (rh + gap);
        for (let ci = 0; ci < row.length; ci++) {
          const b = row[ci], cx = 60 + bw - (ci + 1) * cw - ci * gap, note = [b.source && 'المصدر: ' + b.source, /^\d{4}-\d{2}-\d{2}$/.test(b.asOf || '') && 'آخر تحديث: ' + b.asOf].filter(Boolean).join(' · ');
          const th = b.title ? 30 : 0, nh = note ? 22 : 0;
          if (b.title) shapes.push(box(c, { x: cx, y: ry, w: cw, h: th, text: P(c, b.title, { sz: 18, b: true, color: c.d }), name: 'عنوان القسم' }));
          shapes.push(...(await blockShapes(c, b, { x: cx, y: ry + th, w: cw, h: rh - th - nh })));
          if (note) shapes.push(box(c, { x: cx, y: ry + rh - nh, w: cw, h: nh, text: P(c, note, { sz: 11, color: '7B8996' }), name: 'المصدر' }));
        }
      }
    }
    shapes.push(box(c, { x: 60, y: sh - 40, w: sw - 120, h: 28, text: P(c, `${i + 1} / ${total}`, { sz: 12, color: '7B8996', algn: 'l' }), name: 'رقم الشريحة' }));
  }
  if ((s.extra || []).length) shapes.push(...(await elementShapes(c, deck, s, geo.cfg, RBS.extras(s))));
  const bgXml = bg === 'brand' ? `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${c.d}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${c.a}"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>`
    : `<a:solidFill><a:srgbClr val="${bg === 'dark' ? c.d : bg === 'tint' ? c.s : 'FFFFFF'}"/></a:solidFill>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr>${bgXml}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = (a, d, x) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Hadiyah"><a:themeElements><a:clrScheme name="Hadiyah"><a:dk1><a:srgbClr val="17212C"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${d}"/></a:dk2><a:lt2><a:srgbClr val="E6F4F1"/></a:lt2><a:accent1><a:srgbClr val="${a}"/></a:accent1><a:accent2><a:srgbClr val="${x}"/></a:accent2><a:accent3><a:srgbClr val="E0B04A"/></a:accent3><a:accent4><a:srgbClr val="D96C4F"/></a:accent4><a:accent5><a:srgbClr val="7D93A8"/></a:accent5><a:accent6><a:srgbClr val="145A43"/></a:accent6><a:hlink><a:srgbClr val="0B6BCB"/></a:hlink><a:folHlink><a:srgbClr val="7A3B6E"/></a:folHlink></a:clrScheme><a:fontScheme name="Hadiyah"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

export async function buildPptx(deck, cfg) {
  const rt = RBD.RATIOS[deck.ratio] || RBD.RATIOS['16:9'], sw = rt.w, sh = rt.h;
  const pal = RBT.PALETTES[deck.palette] || RBT.PALETTES.hadiyah;
  const base = { a: hex(pal.a), d: hex(pal.d), s: hex(pal.s), x: hex(pal.x), map: deck.options && deck.options.arabicDigits ? (t) => t.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[n]) : (t) => t };
  const logos = {};
  try { if (cfg.logoLight) logos.light = await fetchPng(cfg.logoLight); } catch (e) { /* بدون شعار */ }
  try { if (cfg.logo) logos.dark = await fetchPng(cfg.logo); } catch (e) { /* بدون شعار */ }
  const files = [], slideRels = [];
  const media = [];
  const n = deck.slides.length, notes = [];
  for (let i = 0; i < n; i++) {
    const c = Object.assign({ id: 1, media: [], rels: [] }, base);
    const xml = await slideXml(c, deck, deck.slides[i], i, n, logos, { sw, sh, cfg });
    // أرقام الوسائط عامة على مستوى الملف
    const rels = c.rels.map((r) => r.replace(/Target="\.\.\/media\/image(\d+)\.(\w+)"/, (m, k, ext) => { const name = `s${i + 1}_${k}.${ext}`; media.push({ name, data: c.media[+k - 1].data }); return `Target="../media/${name}"`; }));
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: xml });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels.join('')}</Relationships>` });
    slideRels.push(i + 1);
    const note = String(deck.slides[i].notes || '').trim();
    if (note) {
      notes.push(i + 1);
      files[files.length - 1].data = files[files.length - 1].data.replace('</Relationships>', `<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`);
      const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
      const paras = note.split('\n').map((ln) => `<a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr lang="ar-SA" dirty="0"/><a:t>${X(ln)}</a:t></a:r></a:p>`).join('');
      files.push({ name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>` });
      files.push({ name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide${i + 1}.xml"/></Relationships>` });
    }
  }
  media.forEach((m) => files.push({ name: 'ppt/media/' + m.name, data: m.data }));
  const W = E(sw), H = E(sh);
  files.unshift(
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideRels.map((k) => `<Override PartName="/ppt/slides/slide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} rtl="1" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideRels.map((k) => `<p:sldId id="${255 + k}" r:id="rId${k + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels.map((k) => `<Relationship Id="rId${k + 2}" Type="${REL}/slide" Target="slides/slide${k}.xml"/>`).join('')}<Relationship Id="rId${n + 3}" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="r" rtl="1"><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr algn="r" rtl="1"><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr algn="r" rtl="1"><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
    { name: 'ppt/theme/theme1.xml', data: THEME(base.a, base.d, base.x) });
  if (notes.length) {
    const f = (name) => files.find((x) => x.name === name);
    f('[Content_Types].xml').data = f('[Content_Types].xml').data.replace('</Types>', `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${notes.map((k) => `<Override PartName="/ppt/notesSlides/notesSlide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('')}</Types>`);
    f('ppt/presentation.xml').data = f('ppt/presentation.xml').data.replace('</p:sldMasterIdLst>', '</p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rIdNM"/></p:notesMasterIdLst>');
    f('ppt/_rels/presentation.xml.rels').data = f('ppt/_rels/presentation.xml.rels').data.replace('</Relationships>', `<Relationship Id="rIdNM" Type="${REL}/notesMaster" Target="notesMasters/notesMaster1.xml"/></Relationships>`);
    const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    files.push({ name: 'ppt/notesMasters/notesMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ar-SA"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr algn="r" rtl="1"><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>` });
    files.push({ name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/theme2.xml"/></Relationships>` });
    files.push({ name: 'ppt/theme/theme2.xml', data: THEME(base.a, base.d, base.x) });
  }
  return zip(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}

const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
const safeName = (t) => String(t || 'presentation').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'presentation';

export async function exportPptx(deck, cfg) { download(await buildPptx(deck, cfg), safeName(deck.title) + '.pptx'); }

/* ---------- PNG: رسم الشريحة عبر SVG foreignObject مع تضمين الخطوط والصور ---------- */
let cssCache = null;
const toDataUrl = async (url) => { const b = await (await fetch(url)).blob(); return new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
async function inlineCss() {
  if (cssCache) return cssCache;
  let css = '';
  for (const f of ['tokens', 'report', 'deck']) css += await (await fetch(`/report-builder/css/${f}.css`)).text() + '\n';
  const urls = Array.from(new Set(Array.from(css.matchAll(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g)).map((m) => m[1])));
  for (const u of urls) { try { css = css.split(u).join(await toDataUrl(u)); } catch (e) { /* خط غير متاح */ } }
  return (cssCache = css);
}
export async function slidePng(deck, cfg, i, scale = 2) {
  const rt = RBD.RATIOS[deck.ratio] || RBD.RATIOS['16:9'];
  let html = RBD.renderSlide(deck, deck.slides[i], { config: cfg, index: i, total: deck.slides.length, indicators: getIndicatorMap() });
  const srcs = Array.from(new Set(Array.from(html.matchAll(/src="(\/brand\/[^"]+)"/g)).map((m) => m[1])));
  for (const u of srcs) { try { html = html.split(`src="${u}"`).join(`src="${await toDataUrl(u)}"`); } catch (e) { /* ignore */ } }
  const css = await inlineCss();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rt.w}" height="${rt.h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="${RBD.rootStyle(deck)};width:${rt.w}px;height:${rt.h}px"><style><![CDATA[${css}]]></style>${html.replace(/ data-split(?=[\s>])/g, ' data-split=""').replace(/&nbsp;/g, '&#160;').replace(/<(img|br|hr)([^>]*?)\/?>/g, '<$1$2/>')}</div></foreignObject></svg>`;
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  return toPng(img, rt.w * scale, rt.h * scale, '#ffffff');
}
export async function exportPng(deck, cfg, current) {
  const n = deck.slides.length, nm = safeName(deck.title);
  if (n === 1) { download(new Blob([await slidePng(deck, cfg, 0)], { type: 'image/png' }), nm + '.png'); return; }
  const files = [];
  for (let i = 0; i < n; i++) files.push({ name: `${nm}-${String(i + 1).padStart(2, '0')}.png`, data: await slidePng(deck, cfg, i) });
  download(zip(files, 'application/zip'), nm + '-png.zip');
}
