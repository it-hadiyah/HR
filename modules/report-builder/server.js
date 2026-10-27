'use strict';
// خادم بدون مكتبات خارجية وبدون قاعدة بيانات: كل تقرير يُحفظ كملف JSON داخل مجلد reports،
// وصفحة العرض تُولَّد منه عند الطلب (فتنعكس تحديثات التصميم والكليشة على التقارير القديمة).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('./public/shared/templates.js');
const C = require('./public/shared/calc.js');
const R = require('./public/shared/render.js');
const cfgm = require('./lib/config');
const auth = require('./lib/auth');
const WF = require('./lib/workflow');
const store = require('./lib/store');
const SH = require('./lib/shares');
const AI = require('./lib/ai');
const IND = require('./lib/indicators');

// المنصة الموحّدة تقدّم هذا التطبيق تحت المسار BASE وتتولى الدخول والصلاحيات والتدقيق (انظر server/routes/reportBuilder.js)
const BASE = '/report-builder';
const PUBLIC_DIR = path.join(__dirname, 'public');
const REPORTS_DIR = process.env.RB_REPORTS || path.join(__dirname, 'reports');
const MAX_BODY = 24 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const ID_RE = /^[a-z0-9-]{3,40}$/;
const slug = (v) => (R.SLUG.test(String(v || '')) ? String(v) : '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const loadConfig = () => { const c = cfgm.get(); const { auth: _a, ...pub } = c; return pub; };

/* ---------- التحقق من البيانات وتنظيفها ---------- */
const str = (v, max = 5000) => String(v == null ? '' : v).slice(0, max);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function cleanContent(type, c) {
  c = c == null ? {} : c;
  switch (type) {
    case 'text': return R.sanitize(str(c, 60000));
    case 'list': return { ordered: !!c.ordered, items: arr(c.items, 300).map((i) => str(i, 600)) };
    case 'table': return {
      zebra: c.zebra !== false, heat: !!c.heat,
      headers: arr(c.headers, 12).map((h) => str(h, 200)),
      rows: arr(c.rows, 500).map((r) => arr(r, 12).map((x) => str(x, 1000))),
    };
    case 'kpi': return { style: c.style === 'highlights' ? 'highlights' : 'cards', items: arr(c.items, 24).map((k) => ({ icon: slug(k && k.icon), label: str(k && k.label, 200), value: str(k && k.value, 100), trend: str(k && k.trend, 30) })) };
    case 'chart': return {
      kind: ['bar', 'line', 'area', 'donut', 'pie', 'hbar', 'waterfall', 'gauge', 'radar', 'funnel'].includes(c.kind) ? c.kind : 'bar', unit: str(c.unit, 20), max: str(c.max, 20), ref: /^ind-[a-z0-9]{4,20}$/.test(String(c.ref || '')) ? c.ref : '',
      data: arr(c.data, 60).map((d) => ({ label: str(d && d.label, 200), value: str(d && d.value, 50) })),
    };
    case 'progress': return { items: arr(c.items, 30).map((i) => ({ label: str(i && i.label, 200), value: str(i && i.value, 20) })) };
    case 'timeline': return { items: arr(c.items, 60).map((i) => ({ date: str(i && i.date, 100), title: str(i && i.title, 300), desc: str(i && i.desc, 1000), status: ['done', 'active', 'todo'].includes(i && i.status) ? i.status : 'todo' })) };
    case 'image': {
      const src = str(c.src, MAX_IMAGE * 1.4);
      return { src: R.SAFE_IMG.test(src) && src.length <= MAX_IMAGE * 1.4 ? src : '', caption: str(c.caption, 300), fit: c.fit === 'cover' ? 'cover' : 'contain', height: Math.max(60, Math.min(600, parseInt(c.height, 10) || 220)) };
    }
    case 'gantt': return { items: arr(c.items, 60).map((i) => ({ name: str(i && i.name, 200), start: /^\d{4}-\d{2}-\d{2}$/.test(String(i && i.start)) ? i.start : '', end: /^\d{4}-\d{2}-\d{2}$/.test(String(i && i.end)) ? i.end : '', progress: str(i && i.progress, 6), owner: str(i && i.owner, 100) })) };
    case 'calc': {
      const used = new Set(); const rows = [];
      for (const r of arr(c.rows, 26)) {
        let key = /^[A-Z]$/.test(String(r && r.key)) && !used.has(r.key) ? r.key : C.nextKey(rows.map((x) => ({ key: x.key })).concat([...used].map((k) => ({ key: k }))));
        if (!key) break; used.add(key);
        rows.push({ key, label: str(r && r.label, 120), kind: r && r.kind === 'calc' ? 'calc' : 'input', value: str(r && r.value, 40), unit: str(r && r.unit, 20), fmt: r && r.fmt === 'percent' ? 'percent' : 'number',
          op: Object.keys(C.OPS).includes(r && r.op) ? r.op : 'sub', args: arr(r && r.args, 12).map(String).filter((a) => /^[A-Z]$/.test(a)), formula: str(r && r.formula, 200) });
      }
      return { style: c.style === 'cards' ? 'cards' : 'table', rows };
    }
    case 'compare': return {
      labels: { prev: str(c.labels && c.labels.prev, 60) || 'السنة الماضية', curr: str(c.labels && c.labels.curr, 60) || 'السنة الحالية' },
      rows: arr(c.rows, 12).map((r) => ({ label: str(r && r.label, 120), prev: str(r && r.prev, 40), curr: str(r && r.curr, 40), unit: str(r && r.unit, 20), better: r && r.better === 'down' ? 'down' : 'up' })),
      chart: c.chart !== false, summary: c.summary !== false, decimals: [0, 1, 2].includes(c.decimals) ? c.decimals : 1,
    };
    case 'callout': return { tone: ['info', 'success', 'warn'].includes(c.tone) ? c.tone : 'info', text: str(c.text, 3000) };
    default: return {};
  }
}

function cleanSection(s) {
  const type = T.TYPES.includes(s && s.type) ? s.type : 'text';
  return { id: /^[A-Za-z0-9_-]{1,40}$/.test(s && s.id) ? s.id : T.uid(), type, title: str(s && s.title, 200), icon: slug(s && s.icon), visible: !(s && s.visible === false), width: s && s.width === 'half' ? 'half' : 'full', hint: str(s && s.hint, 300), source: str(s && s.source, 200), asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(s && s.asOf)) ? s.asOf : '', content: cleanContent(type, s && s.content) };
}

function clean(d) {
  d = T.migrate(d || {});
  const o = d.options || {};
  return {
    version: 2, id: d.id || null,
    template: T.TEMPLATES.some((t) => t.id === d.template) ? d.template : 'blank',
    palette: T.PALETTES[d.palette] ? d.palette : 'green', sample: !!d.sample,
    title: str(d.title, 200), subtitle: str(d.subtitle, 300), period: str(d.period, 120),
    employee: str(d.employee, 200), department: str(d.department, 200), date: str(d.date, 30),
    options: {
      cover: o.cover !== false, toc: !!o.toc, closing: !!o.closing, header: o.header !== false, pageNumbers: o.pageNumbers !== false,
      margins: ['narrow', 'normal', 'wide'].includes(o.margins) ? o.margins : 'normal', coverIcon: slug(o.coverIcon), footerText: str(o.footerText, 300), arabicDigits: !!o.arabicDigits,
    },
    sections: arr(d.sections, 80).map(cleanSection),
  };
}

/* ---------- أدوات HTTP ---------- */
function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, Object.assign({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }, extra));
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), MIME['.json'], { 'Cache-Control': 'no-store' });

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, 'طلب غير صالح'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'ممنوع');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'غير موجود');
    const ext = path.extname(file).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream', { 'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache' });
  });
}

/* ---------- التقارير ---------- */
const fileOf = (id) => path.join(REPORTS_DIR, id + '.json');

function toReport(raw, id) {
  const d = T.migrate(raw);
  d.id = id; d.owner = raw.owner || ''; d.ownerName = raw.ownerName || '';
  d.workflow = raw.workflow || { status: 'draft' }; d.history = raw.history || [];
  d.comments = raw.comments || []; d.versions = raw.versions || []; d.archived = !!raw.archived;
  d.createdAt = raw.createdAt; d.updatedAt = raw.updatedAt;
  return d;
}
async function readReport(id) { return toReport(JSON.parse(await fs.promises.readFile(fileOf(id), 'utf8')), id); }


const META_KEYS = ['title', 'subtitle', 'period', 'employee', 'department', 'date', 'palette', 'template'];
function addSnapshot(K, rep, user, label) {
  const v = rep.versions || (rep.versions = []);
  const n = (v.length ? Math.max(...v.map((x) => x.n)) : 0) + 1;
  v.push({ n, at: new Date().toISOString(), by: user.username, byName: user.name, label: String(label || 'نسخة').slice(0, 80), status: WF.wf(rep).status, content: K.clean(rep) });
  while (v.length > 12) { const i = v.findIndex((x) => x.label !== 'النسخة المعتمدة'); v.splice(i < 0 ? 0 : i, 1); }
}
function diffReports(oldC, newC) {
  const meta = META_KEYS.filter((k) => String(oldC[k] || '') !== String(newC[k] || ''));
  const om = new Map((oldC.sections || []).map((x) => [x.id, x])), seen = new Set(), sections = [];
  (newC.sections || []).forEach((x) => {
    seen.add(x.id); const o = om.get(x.id);
    if (!o) sections.push({ id: x.id, title: x.title, type: x.type, change: 'added' });
    else if (JSON.stringify([o.title, o.visible, o.content, o.source, o.asOf]) !== JSON.stringify([x.title, x.visible, x.content, x.source, x.asOf])) sections.push({ id: x.id, title: x.title, type: x.type, change: 'changed', titleChanged: o.title !== x.title, oldTitle: o.title });
  });
  (oldC.sections || []).forEach((o) => { if (!seen.has(o.id)) sections.push({ id: o.id, title: o.title, type: o.type, change: 'removed' }); });
  if (oldC.slides || newC.slides) {
    const key = (c, sl) => JSON.stringify([sl.layout, sl.bg, sl.title, sl.subtitle, sl.bullets, sl.notes, (sl.blockIds || []).map((id) => (c.sections || []).find((x) => x.id === id))]);
    const os = new Map((oldC.slides || []).map((x) => [x.id, x])), seenS = new Set();
    (newC.slides || []).forEach((x) => { seenS.add(x.id); const o = os.get(x.id); if (!o) sections.push({ id: x.id, title: 'شريحة: ' + (x.title || ''), type: 'slide', change: 'added' }); else if (key(oldC, o) !== key(newC, x)) sections.push({ id: x.id, title: 'شريحة: ' + (x.title || ''), type: 'slide', change: 'changed' }); });
    (oldC.slides || []).forEach((o) => { if (!seenS.has(o.id)) sections.push({ id: o.id, title: 'شريحة: ' + (o.title || ''), type: 'slide', change: 'removed' }); });
    const secOnly = sections.filter((x) => x.type === 'slide');
    return { meta: META_KEYS.filter((k) => String(oldC[k] || '') !== String(newC[k] || '')).concat(String(oldC.ratio || '') !== String(newC.ratio || '') ? [] : []), sections: secOnly, same: !secOnly.length && !meta.length };
  }
  return { meta, sections, same: !meta.length && !sections.length };
}
const keepMeta = (r) => ({ comments: r.comments || [], versions: r.versions || [], archived: !!r.archived });
async function writeReport(id, content, meta) {
  const d = Object.assign(clean(content), meta, { id });
  const tmp = fileOf(id) + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(d, null, 2));
  await fs.promises.rename(tmp, fileOf(id));
  indexCache.delete(id);
  return d;
}

// فهرس خفيف للتقارير (يُعاد استخدامه ما دام الملف لم يتغير)
const indexCache = new Map();
async function listAll() {
  const files = (await fs.promises.readdir(REPORTS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    try {
      const st = await fs.promises.stat(path.join(REPORTS_DIR, f));
      let c = indexCache.get(id);
      if (!c || c.m !== st.mtimeMs) {
        const raw = JSON.parse(await fs.promises.readFile(path.join(REPORTS_DIR, f), 'utf8'));
        const d = T.migrate(raw), w = WF.wf(raw);
        c = { m: st.mtimeMs, v: { id, title: d.title, template: d.template, templateName: raw.version === 2 ? T.byId(d.template).name : raw.type || '', employee: d.employee, department: d.department, date: d.date, createdAt: raw.createdAt || '', updatedAt: raw.updatedAt || raw.createdAt || '', owner: raw.owner || '', ownerName: raw.ownerName || '', archived: !!raw.archived, comments: (raw.comments || []).length, workflow: w, _raw: { owner: raw.owner || '', workflow: raw.workflow || { status: 'draft' } } } };
        indexCache.set(id, c);
      }
      out.push(c.v);
    } catch (e) { /* تجاهل الملفات التالفة */ }
  }
  return out;
}
function summary(user, v) {
  const a = WF.access(user, v._raw);
  const { _raw, workflow, ...rest } = v;
  return Object.assign(rest, { status: workflow.status, statusLabel: WF.STATUS[workflow.status] || '', sharedWith: workflow.sharedWith || '', sharedWithName: workflow.sharedWithName || '', canEdit: a.edit, canDecide: a.decide });
}
async function listFor(user, scope) {
  const all = await listAll();
  let rows;
  if (scope === 'all') { if (user.role !== 'admin') return null; rows = all; }
  else if (scope === 'inbox') rows = all.filter((v) => v.workflow.status !== 'draft' && (v.workflow.sharedWith === user.username || (user.role === 'admin' && v.workflow.status === 'submitted')));
  else if (scope === 'archive') rows = all.filter((v) => v.owner === user.username && v.archived);
  else rows = all.filter((v) => v.owner === user.username && !v.archived);
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((v) => summary(user, v));
}
async function inboxCount(user) {
  if (user.role === 'employee') return 0;
  const all = await listAll();
  const nd = ((await listDecks(user, 'inbox')) || []).filter((v) => v.status === 'submitted').length;
  return nd + all.filter((v) => v.workflow.status === 'submitted' && !v.archived && (user.role === 'admin' || v.workflow.sharedWith === user.username)).length;
}


/* ---------- العروض التقديمية ---------- */
const DECKS_DIR = process.env.RB_DECKS || path.join(__dirname, 'decks');
const D = require('./public/shared/deck.js');
const DECK_BLOCKS = new Set(D.BLOCK_TYPES.concat(['text', 'list']));
const sid = (v) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(v || '')) ? String(v) : '');
const HEX = /^#[0-9a-fA-F]{6}$/, COLOR = /^(#[0-9a-fA-F]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[01]?\.?\d*\s*)?\))$/;
const nrm = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const idKey = (k) => /^[A-Za-z0-9_-]{1,40}$/.test(String(k));
function cleanPhoto(p) {
  p = p || {}; const src = str(p.src, MAX_IMAGE * 1.4), o = p.ov;
  const th = str(p.th, 120000), out = { src: R.SAFE_IMG.test(src) && src.length <= MAX_IMAGE * 1.4 ? src : '', th: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(th) && th.length <= 100000 ? th : '', x: nrm(p.x, 0, 100, 50), y: nrm(p.y, 0, 100, 40), scale: nrm(p.scale, 1, 4, 1), nw: Math.round(nrm(p.nw, 0, 20000, 0)), nh: Math.round(nrm(p.nh, 0, 20000, 0)), fit: p.fit === 'contain' ? 'contain' : 'cover' };
  if (o && typeof o === 'object') out.ov = { on: o.on !== false, preset: str(o.preset, 20), color: HEX.test(o.color) ? o.color : '#005a52', dir: ['right', 'left', 'top', 'bottom', 'all'].includes(o.dir) ? o.dir : 'right', from: nrm(o.from, 0, 1, 0.9), mid: nrm(o.mid, 0, 1, 0.5), to: nrm(o.to, 0, 1, 0) };
  return out;
}
function cleanExtra(e) {
  const type = ['text', 'rect', 'photo', 'block'].includes(e && e.type) ? e.type : null; if (!type || !idKey(e.id)) return null;
  const o = { id: String(e.id), type, x: nrm(e.x, -2000, 4000, 100), y: nrm(e.y, -2000, 4000, 100), w: nrm(e.w, 4, 4000, 200), h: nrm(e.h, 4, 4000, 100) };
  if (e.opacity != null) o.opacity = nrm(e.opacity, 0, 1, 1);
  if (type === 'text') Object.assign(o, { text: str(e.text, 2000), size: nrm(e.size, 8, 300, 32), weight: nrm(e.weight, 100, 900, 700), color: COLOR.test(e.color) ? e.color : '#17302c', align: ['right', 'center', 'left'].includes(e.align) ? e.align : 'right', lh: nrm(e.lh, 1, 3, 1.4), anchor: ['t', 'm', 'b'].includes(e.anchor) ? e.anchor : 'm', font: e.font === 'd' ? 'd' : 'b', field: 'extra.' + o.id, ph: str(e.ph, 80) });
  if (type === 'rect') Object.assign(o, { fill: COLOR.test(e.fill) ? e.fill : '#c9a24b', radius: nrm(e.radius, 0, 300, 0), shape: ['rect', 'ellipse', 'arch', 'hex'].includes(e.shape) ? e.shape : 'rect', shadow: !!e.shadow, border: COLOR.test(e.border) ? e.border : '', bw: nrm(e.bw, 0, 40, 2) });
  if (type === 'photo') Object.assign(o, { photo: cleanPhoto(e.photo), radius: nrm(e.radius, 0, 300, 0), shape: ['rect', 'ellipse', 'arch'].includes(e.shape) ? e.shape : 'rect' });
  if (type === 'block') o.blockId = idKey(e.blockId) ? String(e.blockId) : '';
  return o;
}
function cleanDeck(d) {
  d = d || {}; const o = d.options || {};
  const sections = arr(d.sections, 120).filter((s) => DECK_BLOCKS.has(s && s.type)).map(cleanSection);
  const ids = new Set(sections.map((s) => s.id));
  const seen = new Set();
  const slides = arr(d.slides, 200).map((s) => {
    let id = sid(s && s.id) || T.uid(); if (seen.has(id)) id = T.uid(); seen.add(id);
    const layout = D.layoutOk(s && s.layout) ? s.layout : 'content', official = !!D.S.LAYOUTS[layout];
    const def = official ? D.S.LAYOUTS[layout] : D.LAYOUTS[layout];
    const bgs = official ? ['green', 'mint', 'white', 'dark'] : Object.keys(D.BGS);
    const ov = {}; Object.keys(s && s.ov && typeof s.ov === 'object' ? s.ov : {}).filter(idKey).slice(0, 60).forEach((k) => { const v = s.ov[k] || {}; ov[k] = { x: nrm(v.x, -2000, 4000, 0), y: nrm(v.y, -2000, 4000, 0), w: nrm(v.w, 4, 4000, 100), h: nrm(v.h, 4, 4000, 100) }; });
    const sty = {}; Object.keys(s && s.sty && typeof s.sty === 'object' ? s.sty : {}).filter(idKey).slice(0, 60).forEach((k) => { const v = s.sty[k] || {}; const r = {}; if (COLOR.test(v.color)) r.color = v.color; if (COLOR.test(v.fill)) r.fill = v.fill; if (+v.size > 0) r.size = nrm(v.size, 8, 300, 0); if (+v.weight > 0) r.weight = nrm(v.weight, 100, 900, 700); if (['right', 'center', 'left'].includes(v.align)) r.align = v.align; sty[k] = r; });
    return { id, layout, bg: bgs.includes(s && s.bg) ? s.bg : def.bg, title: str(s && s.title, 300), subtitle: str(s && s.subtitle, 400), bullets: arr(s && s.bullets, 20).map((b) => str(b, 1500)), notes: str(s && s.notes, 4000), hint: str(s && s.hint, 300), blockIds: Array.from(new Set((Array.isArray(s && s.blockIds) && s.blockIds.length ? s.blockIds : s && s.blockId ? [s.blockId] : []).filter((x) => ids.has(x)))).slice(0, 8),
      items: arr(s && s.items, 16).map((i) => ({ t: str(i && i.t, 300), d: str(i && i.d, 1500), v: str(i && i.v, 60) })), photos: arr(s && s.photos, 10).map(cleanPhoto), ov, sty, extra: arr(s && s.extra, 40).map(cleanExtra).filter(Boolean) };
  });
  return {
    version: 1, kind: 'deck', id: d.id || null, template: D.TEMPLATES.some((t) => t.id === d.template) ? d.template : 'blank', sample: !!d.sample,
    title: str(d.title, 200), subtitle: str(d.subtitle, 300), presenter: str(d.presenter, 200), date: str(d.date, 30),
    ratio: D.RATIOS[d.ratio] ? d.ratio : '16:9', palette: T.PALETTES[d.palette] ? d.palette : 'hadiyah',
    options: { pageNumbers: o.pageNumbers !== false, footerText: str(o.footerText, 300), arabicDigits: !!o.arabicDigits },
    sections, slides,
  };
}
const deckFile = (id) => path.join(DECKS_DIR, id + '.json');
async function readDeck(id) { return JSON.parse(await fs.promises.readFile(deckFile(id), 'utf8')); }
async function writeDeck(id, content, meta) {
  const d = Object.assign(cleanDeck(content), meta, { id });
  const tmp = deckFile(id) + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(d, null, 2)); await fs.promises.rename(tmp, deckFile(id));
  return d;
}
const deckAccess = (user, d) => WF.access(user, d);
async function listDecks(user, scope) {
  if (scope === 'all' && user.role !== 'admin') return null;
  const out = [];
  for (const f of (await fs.promises.readdir(DECKS_DIR)).filter((x) => x.endsWith('.json'))) {
    try {
      const d = JSON.parse(await fs.promises.readFile(path.join(DECKS_DIR, f), 'utf8')), w = WF.wf(d), a = WF.access(user, d), me = user.username, arch = !!d.archived;
      const ok = scope === 'all' ? true : scope === 'archive' ? d.owner === me && arch : scope === 'inbox' ? !arch && w.status !== 'draft' && (w.sharedWith === me || (user.role === 'admin' && w.status === 'submitted')) : d.owner === me && !arch;
      if (!ok) continue;
      const tpl = D.TEMPLATES.find((t) => t.id === d.template);
      out.push({ id: f.slice(0, -5), kind: 'deck', title: d.title, subtitle: d.subtitle, slides: (d.slides || []).length, ratio: d.ratio, owner: d.owner || '', ownerName: d.ownerName || '', employee: d.presenter || '', department: '', date: d.date || '', updatedAt: d.updatedAt || d.createdAt || '', createdAt: d.createdAt || '', template: d.template, templateName: tpl ? tpl.name : 'عرض تقديمي', archived: arch, comments: (d.comments || []).length, status: w.status, statusLabel: WF.STATUS[w.status] || '', sharedWith: w.sharedWith || '', sharedWithName: w.sharedWithName || '', canEdit: a.edit, canDecide: a.decide });
    } catch (e) { /* تجاهل التالف */ }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
let inlineAssets = null;
function standaloneHtml(deck, id) {
  const rd = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
  const data = (u) => { try { const f = path.join(PUBLIC_DIR, path.normalize(u)); if (!f.startsWith(PUBLIC_DIR + path.sep)) return null; const ext = path.extname(f).toLowerCase(); return `data:${MIME[ext] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`; } catch (e) { return null; } };
  if (!inlineAssets) {
    let css = ['css/tokens.css', 'css/report.css', 'css/deck.css'].map(rd).join('\n');
    css = css.replace(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g, (m, u) => `url(${data(u) || u})`);
    inlineAssets = { css, js: rd('js/deck-present.js') };
  }
  let html = D.renderDeckPage(deck, { config: loadConfig(), id, inlineCss: inlineAssets.css, allowPrint: true, indicators: IND.map() });
  html = html.replace(/<script src="\/js\/deck-present\.js"><\/script>/, () => `<script>${inlineAssets.js}</script>`);
  html = html.replace(/(src|href)="(\/brand\/[^"]+)"/g, (m, a, u) => { const d = data(u); return d ? `${a}="${d}"` : m; });
  return html;
}


/* ---------- روابط المشاركة ---------- */
async function canShare(user, type, id) {
  try {
    if (!ID_RE.test(id)) return false;
    if (type === 'deck') { const d = await readDeck(id); return user.role === 'admin' || d.owner === user.username; }
    if (type === 'report') { const r = await readReport(id); return user.role === 'admin' || r.owner === user.username; }
  } catch (e) { /* غير موجود */ }
  return false;
}
const unlockFails = new Map();
const aiHits = new Map();
const shareCookie = (tok) => 'rb_s_' + tok.slice(0, 12);
const msgPage = (res, code, title, msg) => send(res, code, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${R.escRaw(title)}</title><link rel="stylesheet" href="/report-builder/css/tokens.css"><body style="font-family:var(--font,Tahoma);display:grid;place-items:center;min-height:100vh;margin:0;background:#eef2f5"><div style="background:#fff;padding:32px 40px;border-radius:16px;max-width:460px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.12)"><img src="/report-builder/brand/logo-icon.png" width="48" alt=""><h2>${R.escRaw(title)}</h2><p>${R.escRaw(msg)}</p></div></body></html>`, MIME['.html'], { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
const pwPage = (res, tok, err) => send(res, 200, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>محتوى محمي</title><link rel="stylesheet" href="/report-builder/css/tokens.css"><body style="font-family:var(--font,Tahoma);display:grid;place-items:center;min-height:100vh;margin:0;background:#eef2f5"><form method="post" action="/report-builder/s/${tok}/unlock" style="background:#fff;padding:32px 40px;border-radius:16px;max-width:420px;width:90%;box-shadow:0 8px 30px rgba(0,0,0,.12)"><img src="/report-builder/brand/logo-icon.png" width="48" alt=""><h2>محتوى محمي بكلمة مرور</h2>${err ? `<p style="color:#b3382a">${R.escRaw(err)}</p>` : ''}<input type="password" name="password" autofocus required placeholder="كلمة المرور" aria-label="كلمة المرور" style="width:100%;padding:12px;border:1px solid #cfd8e0;border-radius:10px;font:inherit;box-sizing:border-box"><button style="margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:#007f73;color:#fff;font:inherit;cursor:pointer">فتح</button></form></body></html>`, MIME['.html'], { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });

async function handleShare(req, res, p) {
  const m = p.match(/^\/s\/([A-Za-z0-9_-]{10,64})(\/unlock)?$/);
  const sh = m && SH.get(m[1]);
  if (!sh || sh.revoked) return msgPage(res, 404, 'الرابط غير متاح', 'هذا الرابط غير صحيح أو تم إلغاؤه من صاحبه.');
  if (SH.state(sh) === 'expired') return msgPage(res, 410, 'انتهت صلاحية الرابط', 'انتهت مدة هذا الرابط. اطلب من صاحبه رابطاً جديداً.');
  const user = userOf(req), ip = clientIp(req);
  const privileged = user && (user.role === 'admin' || user.username === sh.owner);
  const who = user ? user.username : 'زائر';
  if (!privileged) {
    if (sh.mode === 'login' || sh.mode === 'users') {
      if (!user) return toLogin(res, req);
      if (sh.mode === 'users' && !sh.users.includes(user.username)) { SH.log(sh.token, { user: who, ip, ok: false, note: 'غير مصرّح' }); return page403(res, 'هذا الرابط مخصص لمستخدمين محددين ولست منهم.'); }
    } else if (sh.mode === 'password') {
      const ck = parseCookies(req)[shareCookie(sh.token)];
      if (!SH.unlockOk(sh, ck)) {
        if (m[2] && req.method === 'POST') {
          if (!sameOrigin(req)) return msgPage(res, 403, 'طلب مرفوض', 'مصدر الطلب غير موثوق.');
          const key = ip + '|' + sh.token, f = unlockFails.get(key) || { n: 0, until: 0 };
          if (f.until > Date.now()) return pwPage(res, sh.token, 'محاولات كثيرة. حاول بعد قليل.');
          const body = new URLSearchParams(await readBody(req, 4000));
          if (await SH.checkPw(body.get('password'), sh.passHash)) {
            unlockFails.delete(key); SH.log(sh.token, { user: who, ip, ok: true, note: 'فتح بكلمة المرور' });
            res.setHeader('Set-Cookie', `${shareCookie(sh.token)}=${SH.unlockToken(sh)}; HttpOnly; SameSite=Strict; Path=${BASE}/s/${sh.token}; Max-Age=${8 * 3600}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
            return redirect(res, BASE + '/s/' + sh.token);
          }
          f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; } unlockFails.set(key, f);
          SH.log(sh.token, { user: who, ip, ok: false, note: 'كلمة مرور خاطئة' });
          return pwPage(res, sh.token, 'كلمة المرور غير صحيحة');
        }
        return pwPage(res, sh.token, '');
      }
    }
  }
  if (m[2]) return redirect(res, BASE + '/s/' + sh.token);
  let html;
  try {
    if (sh.type === 'deck') html = D.renderDeckPage(await readDeck(sh.id), { config: loadConfig(), id: sh.id, allowPrint: !sh.noPrint, indicators: IND.map() });
    else { const d = await readReport(sh.id); html = R.renderPage(d, { config: loadConfig(), id: sh.id, workflow: d.workflow, shared: true, allowPrint: !sh.noPrint, indicators: IND.map() }); }
  } catch (e) { return msgPage(res, 404, 'المحتوى غير متاح', 'تم حذف المحتوى المشارَك.'); }
  SH.log(sh.token, { user: who, ip, ok: true, note: 'عرض' }); SH.view(sh);
  return send(res, 200, html, MIME['.html'], { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
}


/* ---------- القوالب المخصصة ---------- */
const CT_FILE = 'custom-templates.json';
const readCT = () => store.readJson(CT_FILE, []);
function blankSection(sec) {
  if (sec.type === 'text') return Object.assign(sec, { content: '' });
  const c = JSON.parse(JSON.stringify(sec.content)), E = T.emptyContent(sec.type);
  switch (sec.type) {
    case 'list': c.items = ['']; break;
    case 'table': c.rows = [Array(c.headers.length).fill(''), Array(c.headers.length).fill('')]; break;
    case 'kpi': c.items.forEach((k) => { k.value = ''; k.trend = ''; }); break;
    case 'chart': c.data.forEach((d) => { d.value = ''; }); c.ref = ''; break;
    case 'progress': c.items.forEach((i) => { i.value = ''; }); break;
    case 'calc': c.rows.forEach((r) => { if (r.kind === 'input') r.value = ''; }); break;
    case 'compare': c.rows.forEach((r) => { r.prev = ''; r.curr = ''; }); break;
    case 'callout': c.text = ''; break;
    default: return Object.assign(sec, { content: E });
  }
  return Object.assign(sec, { content: c });
}
const ctPub = (t, user) => ({ id: t.id, name: t.name, desc: t.desc, shared: !!t.shared, official: !!t.official, ownerName: t.ownerName, mine: t.owner === user.username, createdAt: t.createdAt, sections: (t.payload.sections || []).length });
const ctVisible = (t, user) => t.owner === user.username || t.shared || user.role === 'admin';

/* ---------- الجلسات والمصادقة ---------- */
const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }).filter((x) => x.length));
const userOf = (req) => req.platformUser || null;           // المستخدم يحدده غلاف المنصة (جلسة المنصة + صلاحياتها المركزية)
const clientIp = (req) => req.ip || req.socket.remoteAddress || '';
const toLogin = (res, req) => redirect(res, '/login/?next=' + encodeURIComponent((req.baseUrl || '') + req.url));
const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch (e) { return false; } };
const deny = (msg) => Object.assign(new Error(msg), { status: 403 });
const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const page403 = (res, msg) => send(res, 403, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير مصرّح</title><link rel="stylesheet" href="/report-builder/css/tokens.css"><body style="font-family:var(--font);display:grid;place-items:center;min-height:100vh;margin:0;background:#f3f5f8"><div style="text-align:center;background:#fff;padding:40px 48px;border-radius:16px;box-shadow:0 4px 24px #0002"><h1 style="margin:0 0 8px">غير مصرّح</h1><p style="color:#647385">${msg}</p><p><a href="/">العودة للرئيسية</a></p></div></body></html>`, MIME['.html']);
const PROTECTED_PAGES = new Set(['/', '/index.html', '/list.html', '/admin.html', '/decks.html', '/deck.html', '/dashboard.html', '/indicators.html']);


const REPORT_K = { kind: 'report', clean: (r) => clean(r), write: (id, rec, meta) => writeReport(id, rec, meta) };
const DECK_K = { kind: 'deck', clean: (r) => cleanDeck(r), write: (id, rec, meta) => writeDeck(id, rec, meta) };
async function wfApi(K, { id, act, vnum, method, req, res, user, rep, acc }) {
  if (act === 'versions' && method === 'GET') {
    if (vnum) {
      const v = (rep.versions || []).find((x) => x.n === +vnum); if (!v) return json(res, 404, { error: 'النسخة غير موجودة' });
      return json(res, 200, { n: v.n, at: v.at, byName: v.byName, label: v.label, status: v.status, title: v.content.title, diff: diffReports(v.content, K.clean(rep)) });
    }
    return json(res, 200, (rep.versions || []).map((v) => ({ n: v.n, at: v.at, byName: v.byName, label: v.label, status: v.status, sections: (v.content.sections || []).length })).reverse());
  }
  if (act && method === 'POST') {
    const body = JSON.parse((await readBody(req, 20000)) || '{}');
    try {
      if (act === 'share') {
        if (!acc.share) throw deny('لا يمكن الإرسال في الحالة الحالية');
        if (!rep.title.trim()) throw new Error('أدخل العنوان أولاً');
        const mgr = auth.find(body.manager);
        if (!mgr || mgr.disabled || auth.RANK[mgr.role] < 1) throw new Error('اختر مديراً صحيحاً');
        if (mgr.username === user.username) throw new Error('لا يمكنك الإرسال لنفسك');
        const ap = auth.approversOf(user);
        if (ap.restricted && !ap.list.some((m) => m.username === mgr.username)) throw deny(ap.list.length ? 'هذا المدير ليس معتمِدك. المعتمِد المحدد لك: ' + ap.list.map((m) => m.name).join('، ') : 'المعتمِد المحدد لك غير متاح حالياً. تواصل مع مسؤول النظام.');
        WF.actions.share(rep, user, { manager: mgr, note: body.note });
      } else if (act === 'withdraw') { if (!acc.withdraw) throw deny('غير متاح'); WF.actions.withdraw(rep, user); }
      else if (act === 'approve') { if (!acc.decide) throw deny('غير مصرّح لك بالاعتماد'); WF.actions.approve(rep, user, body); }
      else if (act === 'return') { if (!acc.decide) throw deny('غير مصرّح لك بالإعادة'); WF.actions.return(rep, user, body); }
      else if (act === 'reopen') { if (!acc.reopen) throw deny('غير متاح'); WF.actions.reopen(rep, user); }
      else if (act === 'comment') {
        const text = String(body.text || '').trim().slice(0, 1000); if (!text) throw new Error('اكتب التعليق أولاً');
        rep.comments = (rep.comments || []).concat([{ id: crypto.randomBytes(4).toString('hex'), at: new Date().toISOString(), by: user.username, byName: user.name, text }]).slice(-300);
      } else if (act === 'archive' || act === 'unarchive') {
        if (!(acc.owner || acc.admin)) throw deny('للمالك أو المسؤول فقط');
        if (act === 'archive' && WF.wf(rep).status === 'submitted') throw new Error('لا يمكن الأرشفة أثناء انتظار الاعتماد');
        rep.archived = act === 'archive'; WF.push(rep, user, act);
      } else if (act === 'snapshot') {
        if (!(acc.owner || acc.admin)) throw deny('للمالك أو المسؤول فقط');
        addSnapshot(K, rep, user, body.label || 'نسخة يدوية'); WF.push(rep, user, 'snapshot', body.label);
      } else if (act === 'restore') {
        if (!acc.edit) throw deny('لا يمكنك التعديل في الحالة الحالية');
        const v = (rep.versions || []).find((x) => x.n === +body.n); if (!v) throw new Error('النسخة غير موجودة');
        addSnapshot(K, rep, user, 'قبل الاستعادة'); Object.assign(rep, JSON.parse(JSON.stringify(v.content)), { id }); WF.push(rep, user, 'restore', 'النسخة ' + v.n);
      }
      else if (act === 'owner') {
        if (!acc.reassign) throw deny('للمسؤول فقط');
        const nu = auth.find(body.username); if (!nu) throw new Error('المستخدم غير موجود');
        rep.owner = nu.username; rep.ownerName = nu.name; WF.push(rep, user, 'reassign', 'إلى ' + nu.name);
      }
      if (['share', 'approve', 'return'].includes(act)) addSnapshot(K, rep, user, { share: 'مُرسلة للاعتماد', approve: 'النسخة المعتمدة', return: 'قبل الإعادة للتعديل' }[act]);
    } catch (e) { return json(res, e.status || 400, { error: e.message }); }
    await K.write(id, rep, Object.assign({ owner: rep.owner, ownerName: rep.ownerName, workflow: rep.workflow, history: rep.history, createdAt: rep.createdAt, updatedAt: new Date().toISOString() }, keepMeta(rep)));
    store.audit({ action: K.kind + '-' + act, by: user.username, id, to: rep.workflow && rep.workflow.sharedWith });
    return json(res, 200, { ok: true, workflow: rep.workflow, comments: rep.comments, archived: !!rep.archived });
  }
  return json(res, 405, { error: 'غير مدعوم' });
}

async function handleApi(req, res, url, p) {
  const method = req.method;
  if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'طلب مرفوض' });

  // --- الدخول والخروج وكلمات المرور تُدار من المنصة الموحّدة ---
  if (p === '/api/auth-info' && method === 'GET') return json(res, 200, { mode: 'platform', orgName: cfgm.get().orgName || '' });
  if (p === '/api/login' && method === 'POST') return json(res, 410, { error: 'تسجيل الدخول من الصفحة الموحّدة للمنصة' });
  if (p === '/api/logout' && method === 'POST') return json(res, 200, { ok: true });

  const user = userOf(req);
  if (!user) return json(res, 401, { error: 'يلزم تسجيل الدخول' });

  if (p === '/api/me' && method === 'GET') return json(res, 200, Object.assign({}, user, { inbox: await inboxCount(user), canChangePassword: false }));
  if (p === '/api/me/password') return json(res, 410, { error: 'كلمة المرور تُدار من حسابك في المنصة الموحّدة' });
  if (p === '/api/config' && method === 'GET') return json(res, 200, loadConfig());
  if (p === '/api/managers' && method === 'GET') {
    const ap = auth.approversOf(user);
    if (ap.restricted) return json(res, 200, { restricted: true, list: ap.list.map((m, i) => ({ username: m.username, name: m.name, department: m.department, isMine: i === 0 })) });
    const mine = (auth.find(user.username) || {}).managerUsername || '';
    return json(res, 200, { restricted: false, list: auth.listManagers().filter((m) => m.username !== user.username).map((m) => ({ username: m.username, name: m.name, department: m.department, isMine: m.username === mine })) });
  }

  // --- إدارة النظام ---
  if (p.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return json(res, 403, { error: 'للمسؤول فقط' });
    if (p === '/api/admin/users' && method === 'GET') return json(res, 200, auth.listUsers());
    if (p === '/api/admin/settings' && method === 'GET') return json(res, 200, auth.getSettings());
    if (p === '/api/admin/settings' && method === 'PUT') { try { const b = JSON.parse(await readBody(req, 20000)); const st = auth.setSettings(b); store.audit({ action: 'settings-update', by: user.username, defaultTemplates: st.defaultTemplates }); return json(res, 200, st); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/admin/users/auto-approvers' && method === 'POST') { const n = await auth.autoApprovers(); store.audit({ action: 'approvers-auto', by: user.username, count: n }); return json(res, 200, { count: n }); }
    if (p === '/api/admin/audit' && method === 'GET') return json(res, 200, store.readAudit(Math.min(500, parseInt(url.searchParams.get('n'), 10) || 150)));
    try {
      if (p === '/api/admin/users' && method === 'POST') return json(res, 410, { error: 'إنشاء المستخدمين من الإدارة المركزية للمنصة' });
      const m = p.match(/^\/api\/admin\/users\/([a-z0-9._-]+)(\/password)?$/);
      if (m) {
        if (m[2] || method === 'DELETE') return json(res, 410, { error: 'الحسابات وكلمات المرور تُدار من الإدارة المركزية للمنصة' });
        if (method === 'PATCH') { const b = JSON.parse(await readBody(req, 20000)); const u = await auth.updateUser(m[1], b); store.audit({ action: 'user-update', by: user.username, user: m[1], patch: { allowedTemplates: b.allowedTemplates, approvers: b.approvers } }); return json(res, 200, u); }
      }
    } catch (e) { return json(res, 400, { error: e.message }); }
    return json(res, 404, { error: 'غير موجود' });
  }

  // --- القوالب المخصصة ---
  if (p === '/api/custom-templates' && method === 'GET') return json(res, 200, readCT().filter((t) => ctVisible(t, user)).map((t) => ctPub(t, user)).sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt))));
  if (p === '/api/custom-templates' && method === 'POST') {
    const b = JSON.parse(await readBody(req)), name = str(b.name, 100).trim();
    if (!name) return json(res, 400, { error: 'اسم القالب مطلوب' });
    const share = !!b.shared;
    if (share && auth.RANK[user.role] < 1) return json(res, 403, { error: 'مشاركة القوالب للمدير أو المسؤول فقط' });
    const payload = clean(b.report || {});
    payload.id = null; payload.sample = false; payload.employee = ''; payload.department = ''; payload.period = '';
    if (!b.keepData) payload.sections = payload.sections.map(blankSection);
    const list = readCT(); if (list.filter((t) => t.owner === user.username).length >= 50) return json(res, 400, { error: 'بلغت الحد الأقصى للقوالب (50)' });
    const t = { id: 'my-' + crypto.randomBytes(5).toString('hex'), name, desc: str(b.desc, 300), owner: user.username, ownerName: user.name, shared: share, official: share && user.role === 'admin', createdAt: new Date().toISOString(), payload };
    list.push(t); store.writeJson(CT_FILE, list); store.audit({ action: 'template-create', by: user.username, id: t.id, shared: share });
    return json(res, 201, ctPub(t, user));
  }
  const ctm = p.match(/^\/api\/custom-templates\/(my-[a-z0-9]{6,12})$/);
  if (ctm) {
    const list = readCT(), t = list.find((x) => x.id === ctm[1]);
    if (!t || !ctVisible(t, user)) return json(res, 404, { error: 'غير موجود' });
    if (method === 'GET') return json(res, 200, Object.assign(ctPub(t, user), { payload: t.payload }));
    if (method === 'DELETE') {
      if (t.owner !== user.username && user.role !== 'admin') return json(res, 403, { error: 'لا يمكنك حذف هذا القالب' });
      store.writeJson(CT_FILE, list.filter((x) => x.id !== t.id)); store.audit({ action: 'template-delete', by: user.username, id: t.id }); return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'غير مدعوم' });
  }

  // --- مركز المؤشرات ---
  if (p === '/api/indicators' && method === 'GET') return json(res, 200, IND.all());
  if (p === '/api/indicators' && method === 'POST') {
    if (!user.perms.indicators) return json(res, 403, { error: 'لا تملك صلاحية إدارة المؤشرات' });
    try { const x = IND.create(user, JSON.parse(await readBody(req, 100000))); store.audit({ action: 'indicator-create', by: user.username, id: x.id }); return json(res, 201, x); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const im = p.match(/^\/api\/indicators\/(ind-[a-z0-9]{4,20})$/);
  if (im) {
    if (!user.perms.indicators) return json(res, 403, { error: 'لا تملك صلاحية إدارة المؤشرات' });
    try {
      if (method === 'PUT') { const x = IND.update(user, im[1], JSON.parse(await readBody(req, 100000))); store.audit({ action: 'indicator-update', by: user.username, id: x.id }); return json(res, 200, x); }
      if (method === 'DELETE') { IND.remove(im[1]); store.audit({ action: 'indicator-delete', by: user.username, id: im[1] }); return json(res, 200, { ok: true }); }
    } catch (e) { return json(res, 400, { error: e.message }); }
    return json(res, 405, { error: 'غير مدعوم' });
  }

  // --- مساعد الكتابة (الخادم فقط) ---
  if (p === '/api/ai/status' && method === 'GET') return json(res, 200, { enabled: !!auth.getSettings().aiEnabled && AI.configured(), configured: AI.configured(), adminEnabled: !!auth.getSettings().aiEnabled });
  if (p === '/api/ai/assist' && method === 'POST') {
    if (!auth.getSettings().aiEnabled) return json(res, 403, { error: 'المساعد الذكي غير مفعّل. يفعّله مسؤول النظام من لوحة الإدارة.' });
    if (!AI.configured()) return json(res, 503, { error: 'لم يُضبط مفتاح الخدمة على الخادم بعد.' });
    const now = Date.now(), h = (aiHits.get(user.username) || []).filter((t) => now - t < 3600000);
    if (h.length >= 20) return json(res, 429, { error: 'تجاوزت الحد (20 طلباً في الساعة).' });
    const b = JSON.parse(await readBody(req, 200000));
    const sec = cleanSection(b.section || {});
    if (!['kpi', 'chart', 'table', 'compare', 'calc', 'progress', 'timeline', 'gantt', 'list'].includes(sec.type) || R.isEmptySection(sec)) return json(res, 400, { error: 'اختر قسماً يحتوي بيانات فعلية.' });
    h.push(now); aiHits.set(user.username, h);
    try {
      let computed = null;
      if (sec.type === 'calc') { const ev = C.evalCalc(sec.content); computed = (sec.content.rows || []).map((r) => ({ البند: r.label, القيمة: ev.errors[r.key] ? 'خطأ: ' + ev.errors[r.key] : C.fmtRow(ev.values[r.key], r) })); }
      else if (sec.type === 'compare') { const d = sec.content.decimals; computed = C.compareRows(sec.content).map((r) => ({ البند: r.label, السابق: r.prev, الحالي: r.curr, الفرق: r.change, نسبة_التغيير: r.pct === null || r.pct === undefined ? null : C.fmtNum(Math.abs(r.pct), d) + '%', الاتجاه: r.dir })); }
      const out = await AI.assist({ action: String(b.action), title: str(b.title, 200), section: sec, computed });
      store.audit({ action: 'ai-assist', by: user.username, kind: b.action, section: sec.type, unverified: out.unverified.length });
      return json(res, 200, out);
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  // --- لوحة الرئيسية ---
  if (p === '/api/dashboard' && method === 'GET') {
    const mine = await listFor(user, 'mine'), decks = (await listDecks(user, 'mine')) || [];
    const inboxR = user.role === 'employee' ? [] : await listFor(user, 'inbox');
    const inboxD = user.role === 'employee' ? [] : ((await listDecks(user, 'inbox')) || []).filter((x) => x.status === 'submitted');
    const inbox = inboxR.concat(inboxD);
    const pick = (r) => ({ id: r.id, title: r.title, status: r.status, statusLabel: r.statusLabel, updatedAt: r.updatedAt, templateName: r.templateName });
    const titleOf = new Map(mine.map((r) => ['report:' + r.id, r.title]).concat(decks.map((d) => ['deck:' + d.id, d.title])));
    const shares = SH.listByOwner(user.username).map((s) => Object.assign(SH.pub(s), { title: titleOf.get(s.type + ':' + s.id) || '' }));
    const by = (st) => mine.filter((r) => r.status === st);
    const out = {
      counts: { reports: mine.length, drafts: by('draft').length, submitted: by('submitted').length, approved: by('approved').length, returned: by('returned').length, decks: decks.length, shares: shares.filter((s) => s.state === 'active').length, inbox: inbox.length, reportTemplates: T.TEMPLATES.length, deckTemplates: D.TEMPLATES.length },
      recentReports: mine.slice(0, 5).map(pick), drafts: by('draft').slice(0, 5).map(pick), returned: by('returned').slice(0, 5).map(pick), inbox: inbox.slice(0, 6).map((r) => Object.assign(pick(r), { ownerName: r.ownerName, kind: r.kind || 'report' })),
      recentDecks: decks.slice(0, 5).map((d) => ({ id: d.id, title: d.title, slides: d.slides, updatedAt: d.updatedAt })), shares: shares.filter((s) => s.state === 'active').slice(0, 5),
    };
    if (user.role === 'admin') { out.admin = { allReports: (await listAll()).length, allDecks: ((await listDecks(user, 'all')) || []).length, users: auth.listUsers().length }; }
    return json(res, 200, out);
  }

  // --- روابط المشاركة ---
  if (p === '/api/users-lite' && method === 'GET') return json(res, 200, auth.listUsers().filter((u) => !u.disabled && u.username !== user.username).map((u) => ({ username: u.username, name: u.name, department: u.department || '' })));
  if (p === '/api/shares' && method === 'GET') {
    const type = url.searchParams.get('type'), rid = url.searchParams.get('id') || '';
    if (!(await canShare(user, type, rid))) return json(res, 403, { error: 'غير مصرّح لك' });
    return json(res, 200, SH.listFor(type, rid).map(SH.pub));
  }
  if (p === '/api/shares' && method === 'POST') {
    if (!user.perms.share) return json(res, 403, { error: 'لا تملك صلاحية إنشاء روابط المشاركة' });
    const b = JSON.parse(await readBody(req, 20000));
    if (!(await canShare(user, b.type, String(b.id || '')))) return json(res, 403, { error: 'غير مصرّح لك بمشاركة هذا العنصر' });
    try {
      const sh = await SH.create(user, b);
      store.audit({ action: 'share-create', by: user.username, type: sh.type, id: sh.id, mode: sh.mode });
      return json(res, 201, SH.pub(sh));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const shm = p.match(/^\/api\/shares\/([A-Za-z0-9_-]{10,64})(?:\/(revoke|log))?$/);
  if (shm) {
    const sh = SH.get(shm[1]);
    if (!sh) return json(res, 404, { error: 'غير موجود' });
    if (!(await canShare(user, sh.type, sh.id))) return json(res, 403, { error: 'غير مصرّح لك' });
    if (shm[2] === 'log' && method === 'GET') return json(res, 200, SH.readLog(sh.token));
    if (shm[2] === 'revoke' && method === 'POST') { SH.revoke(sh.token); store.audit({ action: 'share-revoke', by: user.username, type: sh.type, id: sh.id }); return json(res, 200, SH.pub(SH.get(sh.token))); }
    if (!shm[2] && method === 'DELETE') { SH.remove(sh.token); store.audit({ action: 'share-delete', by: user.username, type: sh.type, id: sh.id }); return json(res, 200, { ok: true }); }
    return json(res, 405, { error: 'غير مدعوم' });
  }

  // --- العروض التقديمية ---
  if (p === '/api/decks' && method === 'GET') {
    const rows = await listDecks(user, url.searchParams.get('scope') || 'mine');
    return rows ? json(res, 200, rows) : json(res, 403, { error: 'للمسؤول فقط' });
  }
  if (p === '/api/decks' && method === 'POST') {
    if (!user.perms.create) return json(res, 403, { error: 'لا تملك صلاحية إنشاء العروض' });
    const data = JSON.parse(await readBody(req));
    if (!str(data.title).trim()) return json(res, 400, { error: 'عنوان العرض مطلوب' });
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), now = new Date().toISOString();
    await writeDeck(id, data, { owner: user.username, ownerName: user.name, workflow: { status: 'draft' }, history: [{ at: now, by: user.username, byName: user.name, action: 'create', note: '' }], createdAt: now, updatedAt: now });
    store.audit({ action: 'deck-create', by: user.username, id });
    return json(res, 201, { id, url: BASE + '/decks/' + id + '.html' });
  }
  const dm = p.match(/^\/api\/decks\/([a-z0-9-]+)(?:\/(export\.html|share|withdraw|approve|return|reopen|owner|comment|archive|unarchive|snapshot|restore|versions)(?:\/(\d+))?)?$/);
  if (dm) {
    if (!ID_RE.test(dm[1])) return json(res, 404, { error: 'غير موجود' });
    const did = dm[1], dk = await readDeck(did), dacc = deckAccess(user, dk), dact = dm[2];
    if (!dacc.read) return json(res, 403, { error: 'غير مصرّح لك بهذا العرض' });
    if (dact === 'export.html' && method === 'GET') {
      store.audit({ action: 'deck-export-html', by: user.username, id: did });
      return send(res, 200, standaloneHtml(dk, did), MIME['.html'], { 'Content-Disposition': `attachment; filename="deck-${did}.html"`, 'Cache-Control': 'no-store' });
    }
    if (dact) {
      if ((method === 'POST' && dact !== 'versions') || (method === 'GET' && dact === 'versions')) return await wfApi(DECK_K, { id: did, act: dact, vnum: dm[3], method, req, res, user, rep: dk, acc: dacc });
      return json(res, 405, { error: 'غير مدعوم' });
    }
    if (method === 'GET') { const { versions, ...rest } = dk; return json(res, 200, Object.assign({}, rest, { versionCount: (versions || []).length, access: dacc, statusLabel: WF.STATUS[WF.wf(dk).status] })); }
    if (method === 'PUT') {
      if (!dacc.edit) return json(res, 403, { error: WF.wf(dk).status === 'approved' ? 'العرض معتمد ولا يمكن تعديله' : WF.wf(dk).status === 'submitted' ? 'العرض بانتظار الاعتماد ولا يمكن تعديله الآن' : 'لا يمكنك تعديل هذا العرض' });
      const data = JSON.parse(await readBody(req));
      if (!str(data.title).trim()) return json(res, 400, { error: 'عنوان العرض مطلوب' });
      await writeDeck(did, data, Object.assign({ owner: dk.owner, ownerName: dk.ownerName, workflow: dk.workflow, history: dk.history, createdAt: dk.createdAt, updatedAt: new Date().toISOString() }, keepMeta(dk)));
      store.audit({ action: 'deck-update', by: user.username, id: did });
      return json(res, 200, { id: did, url: BASE + '/decks/' + did + '.html' });
    }
    if (method === 'DELETE') {
      if (!(dacc.owner || dacc.admin) || WF.wf(dk).status === 'submitted') return json(res, 403, { error: 'لا يمكنك حذف هذا العرض الآن' });
      await fs.promises.unlink(deckFile(did)); SH.removeFor('deck', did); store.audit({ action: 'deck-delete', by: user.username, id: did });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'غير مدعوم' });
  }

  // --- التقارير ---
  if (p === '/api/reports' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'mine';
    const rows = await listFor(user, scope);
    return rows ? json(res, 200, rows) : json(res, 403, { error: 'للمسؤول فقط' });
  }
  if (p === '/api/reports' && method === 'POST') {
    if (!user.perms.create) return json(res, 403, { error: 'لا تملك صلاحية إنشاء التقارير' });
    const data = JSON.parse(await readBody(req));
    if (!str(data.title).trim()) return json(res, 400, { error: 'عنوان التقرير مطلوب' });
    if (!auth.canUseTemplate(user, clean(data).template)) return json(res, 403, { error: 'نوع هذا التقرير غير مسموح لحسابك. تواصل مع مسؤول النظام.' });
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), now = new Date().toISOString();
    await writeReport(id, data, { owner: user.username, ownerName: user.name, workflow: { status: 'draft' }, history: [{ at: now, by: user.username, byName: user.name, action: 'create', note: '' }], createdAt: now, updatedAt: now });
    store.audit({ action: 'report-create', by: user.username, id });
    return json(res, 201, { id, url: BASE + '/reports/' + id + '.html' });
  }
  const m = p.match(/^\/api\/reports\/([a-z0-9-]+)(?:\/(share|withdraw|approve|return|reopen|owner|comment|archive|unarchive|snapshot|restore|versions)(?:\/(\d+))?)?$/);
  if (!m || !ID_RE.test(m[1])) return json(res, 404, { error: 'غير موجود' });
  const id = m[1], act = m[2];
  const rep = await readReport(id);                       // يرمي ENOENT → 404
  const acc = WF.access(user, rep);
  if (!acc.read) return json(res, 403, { error: 'غير مصرّح لك بهذا التقرير' });

  if (!act && method === 'GET') { const { versions, ...rest } = rep; return json(res, 200, Object.assign({}, rest, { versionCount: (versions || []).length, access: acc, statusLabel: WF.STATUS[WF.wf(rep).status] })); }
  if (act && ((method === 'POST' && act !== 'versions') || (method === 'GET' && act === 'versions'))) return await wfApi(REPORT_K, { id, act, vnum: m[3], method, req, res, user, rep, acc });
  if (!act && method === 'PUT') {
    if (!user.perms.create && user.role !== 'admin') return json(res, 403, { error: 'لا تملك صلاحية تعديل التقارير' });
    if (!acc.edit) return json(res, 403, { error: WF.wf(rep).status === 'approved' ? 'التقرير معتمد ولا يمكن تعديله' : WF.wf(rep).status === 'submitted' ? 'التقرير بانتظار الاعتماد. اسحبه أولاً لتعديله' : 'غير مصرّح لك بالتعديل' });
    const data = JSON.parse(await readBody(req));
    if (!str(data.title).trim()) return json(res, 400, { error: 'عنوان التقرير مطلوب' });
    const nt = clean(data).template;
    if (nt !== rep.template && !auth.canUseTemplate(user, nt)) return json(res, 403, { error: 'نوع القالب المختار غير مسموح لحسابك' });
    await writeReport(id, data, Object.assign({ owner: rep.owner, ownerName: rep.ownerName, workflow: rep.workflow, history: rep.history, createdAt: rep.createdAt, updatedAt: new Date().toISOString() }, keepMeta(rep)));
    store.audit({ action: 'report-update', by: user.username, id });
    return json(res, 200, { id, url: BASE + '/reports/' + id + '.html' });
  }
  return json(res, 405, { error: 'غير مدعوم' });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url, p);

    // صفحة التقرير النهائية: تتطلب تسجيل دخول وصلاحية قراءة
    let m = p.match(/^\/reports\/([a-z0-9-]+)\.html$/);
    if (m && req.method === 'GET') {
      if (!ID_RE.test(m[1])) return send(res, 404, 'غير موجود');
      const user = userOf(req);
      if (!user) return toLogin(res, req);
      const d = await readReport(m[1]);
      if (!WF.access(user, d).read) return page403(res, 'هذا التقرير ليس من تقاريرك ولم يُشارَك معك.');
      return send(res, 200, R.renderPage(d, { config: loadConfig(), id: m[1], workflow: d.workflow, indicators: IND.map() }), MIME['.html'], { 'Cache-Control': 'no-store' });
    }

    if (p.startsWith('/s/') && (req.method === 'GET' || req.method === 'POST')) return await handleShare(req, res, p);

    let dv = p.match(/^\/decks\/([a-z0-9-]+)\.html$/);
    if (dv && req.method === 'GET') {
      if (!ID_RE.test(dv[1])) return send(res, 404, 'غير موجود');
      const user = userOf(req);
      if (!user) return toLogin(res, req);
      const d = await readDeck(dv[1]);
      if (!deckAccess(user, d).read) return page403(res, 'هذا العرض ليس من عروضك.');
      return send(res, 200, D.renderDeckPage(d, { config: loadConfig(), id: dv[1], indicators: IND.map(), wf: true, actions: `<a class="btn" href="${BASE}/api/decks/${dv[1]}/export.html">تنزيل صفحة ويب</a>` }), MIME['.html'], { 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' && PROTECTED_PAGES.has(p)) {
      const user = userOf(req);
      if (!user) return toLogin(res, req);
      if (p === '/admin.html' && user.role !== 'admin') return page403(res, 'هذه الصفحة للمسؤول فقط.');
    }
    if (req.method === 'GET') return serveStatic(res, p);
    send(res, 405, 'Method Not Allowed');
  } catch (e) {
    if (e && e.code === 'ENOENT') return json(res, 404, { error: 'غير موجود' });
    json(res, 400, { error: 'طلب غير صالح' });
  }
}

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.mkdirSync(DECKS_DIR, { recursive: true });

module.exports = { handle, BASE, auth, store };
