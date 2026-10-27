// تصدير DOCX حقيقي (OOXML): عناوين وفقرات وقوائم وجداول قابلة للتحرير، والرسوم البيانية كصور.
// بدون مكتبات: يُبنى ملف ZIP يدوياً (بدون ضغط) وفق مواصفة Office Open XML.
import * as T from './templates.js';

import { getIndicatorMap } from './indicators-cache.js';
const RBR = window.RBR;
const FONT = 'Arial'; // خط متوفر في Word على كل الأجهزة ويدعم العربية
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;

/* ---------- ZIP (store) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder();
function zip(files, mime) {
  const parts = [], central = []; let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
export { zip, chartCss, loadImg, toPng };

/* ---------- أدوات XML ---------- */
const xe = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const hex = (c) => String(c).replace('#', '').toUpperCase();

function makeCtx(report) {
  const pal = T.PALETTES[report.palette] || T.PALETTES.green;
  const ad = report.options && report.options.arabicDigits;
  return { a: hex(pal.a), d: hex(pal.d), s: hex(pal.s), x: hex(pal.x), map: ad ? (t) => t.replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[n]) : (t) => t, media: [], rels: [], numbering: [], id: 100 };
}

function run(ctx, text, o = {}) {
  const t = ctx.map(String(text));
  const sz = Math.round((o.size || 11) * 2);
  return `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${o.b ? '<w:b/><w:bCs/>' : ''}${o.i ? '<w:i/><w:iCs/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
}
function para(runs, o = {}) {
  const sp = `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 120 : o.after}" w:line="${o.line || 360}" w:lineRule="auto"/>`;
  const num = o.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.numId}"/></w:numPr>` : '';
  const bd = o.quote ? '<w:pBdr><w:right w:val="single" w:sz="24" w:space="8" w:color="' + o.quote + '"/></w:pBdr>' : '';
  const sh = o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '';
  return `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keep ? '<w:keepNext/>' : ''}${num}${bd}${sh}${sp}<w:bidi/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
}

/* ---------- HTML الغني (بعد التنظيف) → فقرات ---------- */
function richToParas(ctx, html) {
  const out = []; const toks = String(html || '').split(/(<\/?[a-z0-9]+\s*\/?>)/i).filter((x) => x !== '');
  let fmt = { b: 0, i: 0, u: 0 }, block = null, runs = [], lists = [];
  const flush = () => {
    if (!block) return;
    const base = { size: block === 'h3' ? 14 : block === 'h4' ? 12.5 : 11, b: block === 'h3' || block === 'h4', color: block === 'h3' ? ctx.d : null };
    const list = block === 'li' ? lists[lists.length - 1] : null;
    out.push(para(runs.join('') || run(ctx, ' ', base), { numId: list ? list.numId : 0, quote: block === 'quote' ? ctx.a : null, shade: block === 'quote' ? ctx.s : null, keep: block === 'h3' || block === 'h4', before: block === 'h3' ? 120 : 0, after: block === 'li' ? 40 : 120 }));
    block = null; runs = [];
  };
  const open = (b) => { flush(); block = b; };
  for (const tk of toks) {
    const m = tk.match(/^<(\/?)([a-z0-9]+)\s*\/?>$/i);
    if (!m) { if (!block) block = 'p'; const t = decode(tk); if (t) runs.push(run(ctx, t, { b: fmt.b > 0 || block === 'h3' || block === 'h4', i: fmt.i > 0, u: fmt.u > 0, size: block === 'h3' ? 14 : block === 'h4' ? 12.5 : 11, color: block === 'h3' ? ctx.d : null })); continue; }
    const close = !!m[1], tag = m[2].toLowerCase();
    if (tag === 'strong') fmt.b += close ? -1 : 1; else if (tag === 'em') fmt.i += close ? -1 : 1; else if (tag === 'u') fmt.u += close ? -1 : 1;
    else if (tag === 'br') { if (!block) block = 'p'; runs.push('<w:r><w:br/></w:r>'); }
    else if (tag === 'ul' || tag === 'ol') { if (close) { flush(); lists.pop(); } else { flush(); lists.push({ numId: tag === 'ul' ? 1 : newNum(ctx) }); } }
    else if (['p', 'h3', 'h4', 'li', 'blockquote'].includes(tag)) { if (close) flush(); else open(tag === 'blockquote' ? 'quote' : tag); }
  }
  flush();
  return out;
}
function newNum(ctx) { ctx.numbering.push(ctx.numbering.length + 3); return ctx.numbering[ctx.numbering.length - 1]; }

/* ---------- الجداول ---------- */
const border = (c, sz = 4) => `w:val="single" w:sz="${sz}" w:space="0" w:color="${c}"`;
function cell(content, w, o = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}${o.borders || ''}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>${o.v ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
}
function table(rows, widths, o = {}) {
  const total = widths.reduce((s, x) => s + x, 0);
  const bd = o.noBorders ? '' : `<w:tblBorders><w:top ${border('D5DBE3')}/><w:left ${border('D5DBE3')}/><w:bottom ${border('D5DBE3')}/><w:right ${border('D5DBE3')}/><w:insideH ${border('E3E8EE')}/><w:insideV ${border('E3E8EE')}/></w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:bidiVisual/>${bd}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>${para('', { after: 120, line: 240 })}`;
}
const tr = (cells, o = {}) => `<w:tr><w:trPr><w:cantSplit/>${o.header ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`;

const blendHex = (hex, pct) => { const h = String(hex).replace('#', ''); const ch = (i) => parseInt(h.substr(i, 2), 16); return [0, 2, 4].map((i) => Math.round(ch(i) * (pct / 100) + 255 * (1 - pct / 100)).toString(16).padStart(2, '0')).join('').toUpperCase(); };

function ganttXml(ctx, c) {
  const items = (c.items || []).filter((i) => i && i.name);
  if (!items.length) return '';
  const W = [Math.round(CONTENT_W * 0.34), Math.round(CONTENT_W * 0.17), Math.round(CONTENT_W * 0.17), Math.round(CONTENT_W * 0.12), 0]; W[4] = CONTENT_W - W[0] - W[1] - W[2] - W[3];
  const hc = (t, w) => cell(para(run(ctx, t, { b: true, color: 'FFFFFF', size: 10.5 }), { after: 0, line: 300 }), w, { fill: ctx.a });
  const tc = (t, w, fill, b) => cell(para(run(ctx, t, { size: 10.5, b }), { after: 0, line: 300 }), w, { fill });
  return table([tr([hc('المهمة', W[0]), hc('البداية', W[1]), hc('النهاية', W[2]), hc('الإنجاز', W[3]), hc('المسؤول', W[4])], { header: true }),
    ...items.map((i, k) => { const f = k % 2 ? ctx.s : null; return tr([tc(i.name, W[0], f, true), tc(i.start || '—', W[1], f), tc(i.end || '—', W[2], f), tc(i.progress ? i.progress + '%' : '—', W[3], f), tc(i.owner || '', W[4], f)]); })], W);
}

function tableXml(ctx, c) {
  const n = Math.max(c.headers.length, ...c.rows.map((r) => r.length), 1);
  const w = Math.floor(CONTENT_W / n), widths = Array(n).fill(w);
  const head = tr(Array.from({ length: n }, (_, j) => cell(para(run(ctx, c.headers[j] || '', { b: true, color: 'FFFFFF', size: 10.5 }), { after: 0, line: 300 }), w, { fill: ctx.a })), { header: true });
  let lo = Infinity, hi = -Infinity; const body = c.rows.filter((r) => r.some((x) => String(x).trim()));
  if (c.heat) body.forEach((r) => r.forEach((x, j) => { const v = j > 0 ? window.RBC.toNum(x) : null; if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  const rows = body.map((r, i) => tr(Array.from({ length: n }, (_, j) => { const v = c.heat && j > 0 ? window.RBC.toNum(r[j]) : null; const heat = v !== null && hi > lo ? Math.round(8 + 82 * ((v - lo) / (hi - lo))) : null;
    return cell(para(run(ctx, r[j] || '', { size: 10.5, color: heat && heat > 52 ? 'FFFFFF' : null }), { after: 0, line: 300 }), w, { fill: heat ? blendHex(ctx.a, heat) : (!c.heat && c.zebra !== false && i % 2 ? ctx.s : null) }); })));
  return table([head, ...rows], widths);
}

function kpiXml(ctx, c) {
  const items = c.items.filter((k) => k.label || k.value), per = Math.min(4, items.length || 1), out = [];
  const w = Math.floor(CONTENT_W / per);
  for (let i = 0; i < items.length; i += per) {
    const chunk = items.slice(i, i + per);
    const cells = Array.from({ length: per }, (_, j) => {
      const k = chunk[j]; if (!k) return cell('', w);
      const t = String(k.trend || '').trim(), down = /^[-−]/.test(t);
      const body = para(run(ctx, k.label, { size: 9.5, color: '4A5968' }), { after: 20, line: 280 }) + para(run(ctx, k.value, { size: 20, b: true, color: ctx.d }), { after: 20, line: 340 }) + (t ? para(run(ctx, (down ? '▼ ' : '▲ ') + t.replace(/^[-−+]/, ''), { size: 9.5, b: true, color: down ? 'B3382A' : '1F7A5C' }), { after: 0, line: 280 }) : '');
      return cell(body, w, { fill: c.style === 'highlights' ? null : ctx.s, borders: `<w:tcBorders><w:top w:val="single" w:sz="24" w:space="0" w:color="${ctx.a}"/></w:tcBorders>` });
    });
    out.push(tr(cells));
  }
  return table(out, Array(per).fill(w), { noBorders: true });
}

function progressXml(ctx, c) {
  return c.items.filter((i) => i.label || i.value).map((i) => {
    const v = Math.max(0, Math.min(100, RBR.num(i.value)));
    const bar = table([tr([cell('<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>', Math.max(1, Math.round(CONTENT_W * v / 100)), { fill: ctx.a }), v < 100 ? cell('<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>', Math.round(CONTENT_W * (100 - v) / 100), { fill: 'E6EBF0' }) : ''])], v < 100 ? [Math.max(1, Math.round(CONTENT_W * v / 100)), Math.round(CONTENT_W * (100 - v) / 100)] : [CONTENT_W], { noBorders: true });
    return para(run(ctx, i.label + '  —  ', { size: 10.5 }) + run(ctx, RBR.fmt(v) + '%', { b: true, size: 10.5, color: ctx.d }), { after: 40, keep: true }) + bar;
  }).join('');
}

function timelineXml(ctx, c) {
  const items = c.items.filter((i) => i.title || i.date), W = [1700, 6538, 1400];
  const label = { done: 'مكتملة', active: 'جارية', todo: 'قادمة' }, col = { done: '1F7A5C', active: 'C98A00', todo: '647385' };
  return table(items.map((i) => tr([cell(para(run(ctx, i.date, { b: true, color: ctx.d, size: 10.5 }), { after: 0 }), W[0]), cell(para(run(ctx, i.title, { b: true, size: 10.5 }), { after: 0 }) + (i.desc ? para(run(ctx, i.desc, { size: 9.5, color: '4A5968' }), { after: 0 }) : ''), W[1]), cell(para(run(ctx, label[i.status] || '', { size: 10, b: true, color: col[i.status] || '647385' }), { after: 0 }), W[2])])), W);
}

function calloutXml(ctx, c) {
  const fill = { info: ctx.s, success: 'E6F4EE', warn: 'FDF3DC' }[c.tone] || ctx.s, line = { info: ctx.a, success: '1F7A5C', warn: 'C98A00' }[c.tone] || ctx.a;
  return table([tr([cell(para(run(ctx, c.text, { size: 11.5 }), { after: 0 }), CONTENT_W, { fill, borders: `<w:tcBorders><w:right w:val="single" w:sz="36" w:space="0" w:color="${line}"/></w:tcBorders>` })])], [CONTENT_W], { noBorders: true });
}

/* ---------- الصور والرسوم ---------- */
function drawing(ctx, rid, cx, cy, name) {
  const id = ++ctx.id;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xe(name)}" descr="${xe(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${xe(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
function addMedia(ctx, bytes, ext) { const n = ctx.media.length + 1, name = `image${n}.${ext}`; ctx.media.push({ name, data: bytes }); const rid = 'rIdImg' + n; ctx.rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`); return rid; }
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('تعذر تحميل صورة')); i.src = src; });
async function toPng(img, w, h, bg) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } g.drawImage(img, 0, 0, w, h); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); return new Uint8Array(await blob.arrayBuffer()); }

function chartCss(ctx) {
  const A = '#' + ctx.a, X = '#' + ctx.x, D = '#' + ctx.d;
  return `text{font-family:Tahoma,Arial,sans-serif}.gl{stroke:#e3e8ee}.ax{stroke:#b8c2cd;stroke-width:1.2}.v{font-size:12px;font-weight:600;fill:#17212c}.l{font-size:12px;fill:#4a5968}.big{font-size:26px;font-weight:700;fill:#17212c}.bar.s0{fill:${A}}.bar.s1{fill:#9db8b2}.area.s0{fill:${X};opacity:.28}.ln.s0{fill:none;stroke:${A};stroke-width:3;stroke-linejoin:round}.dot.s0{fill:#fff;stroke:${A};stroke-width:3}.gg-bg{fill:none;stroke:#e3e8ee;stroke-width:18;stroke-linecap:round}.gg-fg{fill:none;stroke:${A};stroke-width:18;stroke-linecap:round}.rd-grid{fill:none;stroke:#dbe2ea}.rd-area{fill:${X};fill-opacity:.35;stroke:${A};stroke-width:2.5}.rd-dot{fill:#fff;stroke:${A};stroke-width:2.5}.fn{fill:${A}}.fnv{font-size:13px;font-weight:700;fill:#fff}.mut{fill:#8393a4}.wf-tot{fill:${A}}.wf-up{fill:${X}}.wf-dn{fill:#d96c4f}.wf-c{stroke:#9aa8b6;stroke-dasharray:3 3}.arc.s0{stroke:${A}}.arc.s1{stroke:${X}}.arc.s2{stroke:${D}}.arc.s3{stroke:#e0b04a}.arc.s4{stroke:#d96c4f}.arc.s5{stroke:#7d93a8}`;
}
async function chartXml(ctx, c) {
  const html = RBR.chartSvg(c, (v) => RBR.escRaw(ctx.map(String(v))));
  const m = html.match(/<svg[\s\S]*?<\/svg>/); if (!m) return '';
  const vb = m[0].match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/); const w = +vb[1], h = +vb[2];
  const svg = m[0].replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="direction:ltr" `).replace('>', `><style>${chartCss(ctx)}</style>`);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const bytes = await toPng(img, w * 2, h * 2, '#ffffff');
  const widthEmu = Math.round((c.kind === 'donut' || c.kind === 'pie' ? 7 : c.kind === 'gauge' ? 9 : c.kind === 'radar' ? 11 : 15) * 360000), heightEmu = Math.round(widthEmu * h / w);
  let out = para(drawing(ctx, addMedia(ctx, bytes, 'png'), widthEmu, heightEmu, 'رسم بياني'), { after: 120, line: 240 });
  if (c.kind === 'donut' || c.kind === 'pie') {
    const total = c.data.reduce((s, d) => s + RBR.num(d.value), 0) || 1;
    out += c.data.filter((d) => d.label || d.value).map((d) => para(run(ctx, `${d.label}: ${d.value}${c.unit || ''}  —  ${Math.round(RBR.num(d.value) / total * 100)}%`, { size: 10.5 }), { after: 20, line: 300 })).join('');
  }
  return out;
}
async function svgPathToPng(path) {
  const txt = await (await fetch(path)).text();
  const vb = txt.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/); const w = vb ? +vb[1] : 100, h = vb ? +vb[2] : 100, k = 600 / Math.max(w, h);
  const svg = txt.replace('<svg ', `<svg width="${Math.round(w * k)}" height="${Math.round(h * k)}" `);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  return { bytes: await toPng(img, Math.round(w * k), Math.round(h * k), null), w: w * k, h: h * k };
}
async function svgPara(ctx, svgStr, widthCm) {
  const vb = svgStr.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/); const w = +vb[1], h = +vb[2];
  const svg = svgStr.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="direction:ltr" `).replace('>', `><style>${chartCss(ctx)}</style>`);
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const bytes = await toPng(img, w * 2, h * 2, '#ffffff');
  const widthEmu = Math.round(widthCm * 360000);
  return para(drawing(ctx, addMedia(ctx, bytes, 'png'), widthEmu, Math.round(widthEmu * h / w), 'رسم بياني'), { after: 120, line: 240 });
}

function calcXml(ctx, c) {
  const RBC = window.RBC, ev = RBC.evalCalc(c);
  const rows = (c.rows || []).filter((x) => x && (x.label || (x.kind !== 'calc' && RBC.toNum(x.value) !== null)));
  if (!rows.length) return '';
  const W = [Math.round(CONTENT_W * 0.62), CONTENT_W - Math.round(CONTENT_W * 0.62)];
  return table(rows.map((x) => { const res = x.kind === 'calc', err = ev.errors[x.key]; const fill = res ? ctx.s : null;
    return tr([cell(para(run(ctx, x.label, { b: res, size: res ? 12 : 11, color: res ? ctx.d : null }), { after: 0, line: 320 }), W[0], { fill }),
      cell(para(run(ctx, err ? 'خطأ' : RBC.fmtRow(ev.values[x.key], x), { b: true, size: res ? 13 : 11.5, color: err ? 'B3382A' : res ? ctx.d : null }), { after: 0, line: 320 }), W[1], { fill })]); }), W);
}

async function compareXml(ctx, c) {
  const RBC = window.RBC, rows = RBC.compareRows(c), L = c.labels || {}, d = c.decimals == null ? 1 : c.decimals;
  if (!rows.length) return '';
  const W = [Math.round(CONTENT_W * 0.28), Math.round(CONTENT_W * 0.18), Math.round(CONTENT_W * 0.18), Math.round(CONTENT_W * 0.18), 0]; W[4] = CONTENT_W - W[0] - W[1] - W[2] - W[3];
  const hc = (t, w) => cell(para(run(ctx, t, { b: true, color: 'FFFFFF', size: 10.5 }), { after: 0, line: 300 }), w, { fill: ctx.a });
  const unit = (r, v) => RBC.fmtNum(v) + (r.unit ? ' ' + r.unit : '');
  const head = tr([hc('البند', W[0]), hc(L.prev || '', W[1]), hc(L.curr || '', W[2]), hc('الفرق', W[3]), hc('التغيّر', W[4])], { header: true });
  const body = rows.map((r, i) => {
    const col = r.good === true ? '1F7A5C' : r.good === false ? 'B3382A' : '647385', fill = i % 2 ? ctx.s : null;
    const chg = r.dir === 'na' ? '—' : r.dir === 'flat' ? '■ 0%' : (r.dir === 'up' ? '▲ ' : '▼ ') + (r.pct === null ? 'جديد' : RBC.fmtNum(Math.abs(r.pct), d) + '%');
    const diff = r.change === null ? '—' : (r.change > 0 ? '+' : r.change < 0 ? '−' : '') + unit(r, Math.abs(r.change));
    const tc = (t, w, o) => cell(para(run(ctx, t, Object.assign({ size: 10.5 }, o || {})), { after: 0, line: 300 }), w, { fill });
    return tr([tc(r.label, W[0], { b: true }), tc(r.prev === null ? '—' : unit(r, r.prev), W[1]), tc(r.curr === null ? '—' : unit(r, r.curr), W[2]), tc(diff, W[3]), tc(chg, W[4], { b: true, color: col })]);
  });
  let out = table([head, ...body], W);
  if (c.chart !== false) { const svg = window.RBR.compareSvg(c, (v) => window.RBR.escRaw(ctx.map(String(v)))); if (svg) out += await svgPara(ctx, svg, 15); }
  if (c.summary !== false) out += rows.map((r) => RBC.compareSentence(r, L)).filter(Boolean).map((t) => para(run(ctx, '• ' + t, { size: 10.5, color: '3A4755' }), { after: 40, line: 320 })).join('');
  return out;
}

async function imageXml(ctx, c) {
  if (!c.src) return '';
  if (c.src.startsWith('/')) {
    const p = await svgPathToPng(c.src), hmax = Math.min(parseInt(c.height, 10) || 220, 160) * 9525, k = Math.min(hmax / (p.h * 9525), 1);
    return para(drawing(ctx, addMedia(ctx, p.bytes, 'png'), Math.round(p.w * 9525 * k), Math.round(p.h * 9525 * k), c.caption || 'أيقونة'), { after: 60, line: 240 }) + (c.caption ? para(run(ctx, c.caption, { size: 9.5, color: '647385' }), { after: 120 }) : '');
  }
  const img = await loadImg(c.src);
  const maxW = CONTENT_W * 635, maxH = (parseInt(c.height, 10) || 220) * 9525;
  let w = img.naturalWidth || 800, h = img.naturalHeight || 600; const k = Math.min(maxW / (w * 9525), maxH / (h * 9525), 1);
  const cx = Math.round(w * 9525 * k), cy = Math.round(h * 9525 * k);
  const m = c.src.match(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,(.+)$/);
  let bytes, ext;
  if (m[1] === 'png' || m[1] === 'jpeg' || m[1] === 'jpg') { bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)); ext = m[1] === 'png' ? 'png' : 'jpeg'; }
  else { bytes = await toPng(img, w, h, null); ext = 'png'; }
  return para(drawing(ctx, addMedia(ctx, bytes, ext), cx, cy, c.caption || 'صورة'), { after: 60, line: 240 }) + (c.caption ? para(run(ctx, c.caption, { size: 9.5, color: '647385' }), { after: 120 }) : '');
}

/* ---------- بناء المستند ---------- */
export async function exportDocx(report, config, fileName, workflow) {
  report = RBR.applyRefs(report, getIndicatorMap());
  const ctx = makeCtx(report), o = report.options || {}, tpl = T.byId(report.template);
  const body = [];
  const h1 = (t) => para(run(ctx, t, { size: 15, b: true, color: ctx.d }), { style: 'Heading1', keep: true, before: 200, after: 100, line: 300 });

  if (o.cover !== false) {
    if (config.logo) { try { const img = await loadImg(config.logo); const bytes = new Uint8Array(await (await fetch(config.logo)).arrayBuffer()); const h = 1.8 * 360000, w = h * img.naturalWidth / img.naturalHeight; body.push(para(drawing(ctx, addMedia(ctx, bytes, 'png'), Math.round(w), Math.round(h), config.orgName || 'الشعار'), { before: 300, after: 120, line: 240 })); } catch (e) { /* الشعار اختياري */ } }
    if (!(workflow && workflow.status === 'approved')) body.push(para(run(ctx, '[ غير معتمد ]', { size: 16, b: true, color: 'B42318' }), { before: 60, after: 60 }));
    body.push(para(run(ctx, config.orgName || '', { size: 18, b: true, color: ctx.d }), { before: 200, after: 40 }), para(run(ctx, config.orgSubName || '', { size: 11, color: '647385' }), { after: 2400 }),
      para(run(ctx, tpl.name, { size: 12, b: true, color: ctx.a }), { after: 120 }), para(run(ctx, report.title || 'عنوان التقرير', { size: 32, b: true, color: ctx.d }), { style: 'Title', after: 160, line: 400 }));
    if (report.subtitle) body.push(para(run(ctx, report.subtitle, { size: 16, color: '4A5968' }), { after: 80 }));
    if (report.period) body.push(para(run(ctx, report.period, { size: 13, b: true }), { after: 1600 }));
    [['إعداد', report.employee], ['الإدارة / القسم', report.department], ['التاريخ', report.date]].filter((x) => x[1]).forEach(([k, v]) => body.push(para(run(ctx, k + ': ', { size: 11, color: '647385' }) + run(ctx, v, { size: 12, b: true }), { after: 60 })));
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  if (o.toc) body.push(h1('فهرس المحتويات').replace('Heading1', 'TOCHeading'), `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(ctx, 'اضغط F9 (أو «نعم» عند فتح الملف) لتحديث الفهرس.', { size: 10, color: '647385' })}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`, '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

  for (const s of report.sections) {
    if (s.visible === false) continue;
    if (s.type === 'pagebreak') { body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); continue; }
    if (RBR.isEmptySection(s)) continue;
    if (s.title) body.push(h1(s.title));
    const c = s.content;
    switch (s.type) {
      case 'text': body.push(...richToParas(ctx, c)); break;
      case 'list': { const numId = c.ordered ? newNum(ctx) : 1; c.items.filter((i) => String(i).trim()).forEach((i) => body.push(para(run(ctx, i), { numId, after: 40 }))); break; }
      case 'table': body.push(tableXml(ctx, c)); break;
      case 'kpi': body.push(kpiXml(ctx, c)); break;
      case 'chart': body.push(await chartXml(ctx, c)); break;
      case 'progress': body.push(progressXml(ctx, c)); break;
      case 'gantt': body.push(ganttXml(ctx, c)); break;
      case 'calc': body.push(calcXml(ctx, c)); break;
      case 'compare': body.push(await compareXml(ctx, c)); break;
      case 'timeline': body.push(timelineXml(ctx, c)); break;
      case 'image': body.push(await imageXml(ctx, c)); break;
      case 'callout': body.push(calloutXml(ctx, c)); break;
      default: break;
    }
    const srcTxt = [s.source && 'المصدر: ' + s.source, /^\d{4}-\d{2}-\d{2}$/.test(s.asOf || '') && 'آخر تحديث: ' + s.asOf].filter(Boolean).join(' · ');
    if (srcTxt) body.push(para(run(ctx, srcTxt, { size: 9, color: '7B8996' }), { after: 120, line: 260 }));
  }

  if (workflow && workflow.status === 'approved') {
    body.push(table([tr([cell(para(run(ctx, '✓ تم اعتماد التقرير', { size: 13, b: true, color: '0D4A37' }), { after: 40 }) + para(run(ctx, `اعتمده: ${workflow.decidedByName || ''} — بتاريخ ${String(workflow.decidedAt || '').slice(0, 10)}`, { size: 10.5 }), { after: 0 }) + (workflow.decisionNote ? para(run(ctx, workflow.decisionNote, { size: 10, color: '4A5968' }), { after: 0 }) : ''), CONTENT_W, { fill: 'E6F4EE', borders: '<w:tcBorders><w:right w:val="single" w:sz="36" w:space="0" w:color="1F7A5C"/></w:tcBorders>' })])], [CONTENT_W], { noBorders: true }));
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="1418" w:right="${MARGIN}" w:bottom="1134" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:bidi/>${o.cover !== false ? '<w:titlePg/>' : ''}</w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const hdr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${para(run(ctx, (config.orgName || '') + '   |   ' + (report.title || ''), { size: 9, color: '647385' }), { after: 0, line: 240 })}</w:hdr>`;
  const ftr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:bidi/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="E3E8EE"/></w:pBdr></w:pPr>${run(ctx, (o.footerText || config.footerText || '') + (o.pageNumbers === false ? '' : '      صفحة '), { size: 9, color: '647385' })}${o.pageNumbers === false ? '' : `<w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:rtl/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:rtl/></w:rPr><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`}</w:p></w:ftr>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

  const lvl = (fmtv, txt) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmtv}"/><w:lvlText w:val="${txt}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:right="540" w:hanging="360"/></w:pPr></w:lvl>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>${lvl('decimal', '%1.')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>${ctx.numbering.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;

  const exts = [...new Set(ctx.media.map((m) => m.name.split('.').pop()))];
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(report.title)}</dc:title><dc:creator>${xe(report.employee || config.orgName || '')}</dc:creator><dc:language>ar-SA</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>` },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering },
    { name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${o.toc ? '<w:updateFields w:val="true"/>' : ''}<w:defaultTabStop w:val="720"/><w:themeFontLang w:val="ar-SA" w:bidi="ar-SA"/></w:settings>` },
    { name: 'word/header1.xml', data: hdr }, { name: 'word/footer1.xml', data: ftr },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${ctx.rels.join('')}</Relationships>` },
    ...ctx.media.map((m) => ({ name: 'word/media/' + m.name, data: m.data })),
  ];
  const blob = zip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = (fileName || 'تقرير') + '.docx';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return blob;
}
