let F = [], TOTALS = [], GROUPS = [], HAS_TOTALS = false;
const METRICS = { amount: 'إجمالي السعر', qty: 'كمية المنتج', orders: 'عدد الطلبات' };
const COLORS = ['var(--c0)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
const colorOf = g => COLORS[Math.max(0, GROUPS.indexOf(g)) % COLORS.length];
const st = { months: new Set(), groups: new Set(), products: new Set(), q: '', metric: 'amount' };
let sortKey = 'amount', sortDir = -1;

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n * 10) / 10 === Math.round(n) ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 10) / 10).toLocaleString('en-US');
const r1 = x => String(+x.toFixed(1)), r2 = x => String(+x.toFixed(2));
const cpt = v => v >= 1e6 ? r2(v / 1e6) + ' م' : v >= 1e3 ? r1(v / 1e3) + ' ألف' : String(v);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const toggle = (set, v) => { set.has(v) ? set.delete(v) : set.add(v); render(); };
const noProdFilter = () => !st.groups.size && !st.products.size && !st.q;

function base() { return F.filter(r => (!st.groups.size || st.groups.has(r.group)) && (!st.products.size || st.products.has(r.product)) && (!st.q || r.product.includes(st.q) || r.group.includes(st.q))); }
function compute() {
  const b = base(), sel = b.filter(r => !st.months.size || st.months.has(r.m));
  const amount = sum(sel, r => r.amount), qty = sum(sel, r => r.qty);
  let orders = sum(sel, r => r.orders), exact = false;
  if (noProdFilter() && HAS_TOTALS) { orders = sum(TOTALS.filter(t => !st.months.size || st.months.has(t[0])), t => t[2]); exact = true; }
  const all = sum(F, r => r.amount), M = st.metric;
  const kpi = { amount, qty, orders, exact, unit: qty ? Math.round(amount / qty * 10) / 10 : null, per: orders ? Math.round(amount / orders) : null, share: all ? Math.round(amount / all * 1000) / 10 : 0 };
  const bymonth = TOTALS.map(t => { const rs = b.filter(r => r.m === t[0]); return { m: t[0], month: t[1], amount: sum(rs, r => r.amount), qty: sum(rs, r => r.qty), orders: (noProdFilter() && HAS_TOTALS) ? t[2] : sum(rs, r => r.orders), on: !st.months.size || st.months.has(t[0]) }; });
  const tot = amount, vt = sum(sel, r => r[M]);
  const map = new Map(); sel.forEach(r => { if (!map.has(r.product)) map.set(r.product, []); map.get(r.product).push(r); });
  const byproduct = [...map].map(([p, rs]) => { const a = sum(rs, r => r.amount), q = sum(rs, r => r.qty), v = sum(rs, r => r[M]); return { product: p, group: rs[0].group, orders: sum(rs, r => r.orders), qty: q, amount: a, unit: q ? Math.round(a / q * 10) / 10 : null, share: tot ? Math.round(a / tot * 1000) / 10 : 0, value: v, vshare: vt ? Math.round(v / vt * 1000) / 10 : 0 }; }).sort((x, y) => y.value - x.value);
  const gm = new Map(); sel.forEach(r => { if (!gm.has(r.group)) gm.set(r.group, []); gm.get(r.group).push(r); });
  const bygroup = [...gm].map(([g, rs]) => { const a = sum(rs, r => r.amount); return { group: g, orders: sum(rs, r => r.orders), qty: sum(rs, r => r.qty), amount: a, share: tot ? Math.round(a / tot * 1000) / 10 : 0 }; }).sort((x, y) => y.amount - x.amount);
  return { b, sel, kpi, bymonth, byproduct, bygroup };
}

function chip(text, on, dim, fn) { const b = el('button', text, 'chip' + (on ? ' on' : '') + (dim ? ' dim' : '')); b.type = 'button'; b.setAttribute('aria-pressed', on); b.onclick = fn; return b; }

function render() {
  const d = compute(), k = d.kpi, M = st.metric;
  // filters
  $('f_months').replaceChildren(...TOTALS.map(t => chip(t[1], st.months.has(t[0]), false, () => toggle(st.months, t[0]))));
  $('f_groups').replaceChildren(...GROUPS.map(g => chip(g, st.groups.has(g), false, () => toggle(st.groups, g))));
  const pn = []; GROUPS.forEach(g => { pn.push(el('span', g, 'glabel')); [...new Set(F.filter(r => r.group === g).map(r => r.product))].forEach(p => pn.push(chip(p, st.products.has(p), st.groups.size && !st.groups.has(g), () => toggle(st.products, p)))); });
  $('f_products').replaceChildren(...pn);
  document.querySelectorAll('#metric button').forEach(b => { const on = b.dataset.m === M; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const n = (st.months.size ? 1 : 0) + (st.groups.size ? 1 : 0) + (st.products.size ? 1 : 0) + (st.q ? 1 : 0);
  $('fstate').textContent = n ? 'فلاتر مطبّقة: ' + n : 'لا فلاتر مطبّقة';
  $('reset').hidden = !(n || M !== 'amount');
  // kpis
  $('k_amount').textContent = fmt(k.amount); $('k_orders').textContent = fmt(k.orders); $('k_qty').textContent = fmt(k.qty);
  $('k_unit').textContent = k.unit == null ? '—' : fmt(k.unit); $('k_per').textContent = k.per == null ? '—' : fmt(k.per); $('k_share').textContent = k.share + '%';
  $('ordnote').hidden = k.exact;
  // lede
  const L = $('lede');
  if (!k.amount && !k.qty && !k.orders) L.textContent = 'لا توجد نتائج تطابق الفلاتر الحالية. جرّب مسح بعض الفلاتر.';
  else {
    let t = (n ? 'ضمن الفلاتر المحددة بلغ إجمالي السعر ' : 'بلغ إجمالي السعر ') + fmt(k.amount) + ' عبر ' + fmt(k.orders) + ' طلب وكمية منتجات ' + fmt(k.qty);
    const top = d.byproduct[0]; if (top && top.value > 0 && d.byproduct.length > 1) t += '، وجاء ' + top.product + ' في المقدمة بنسبة ' + top.vshare + '% من ' + METRICS[M];
    L.textContent = t + '.';
  }
  chart(d); rank(d); groups(d); heat(d); table(d);
}

function chart(d) {
  const box = $('mchart'), M = st.metric, stacked = M !== 'orders', bm = d.bymonth;
  const W = Math.max(280, box.clientWidth), H = 300;
  const gs = GROUPS.filter(g => d.b.some(r => r.group === g));
  const wrap = el('div', null, 'box'), legend = el('div', null, 'legend');
  (stacked ? gs : ['عدد الطلبات']).forEach((g, i) => { const s = el('span'), c = el('i'); c.style.background = stacked ? colorOf(g) : COLORS[0]; s.append(c, document.createTextNode(g)); legend.append(s); });
  const svg = sv('svg', { class: 'ch', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'أعمدة شهرية لـ' + METRICS[M] });
  const tip = el('div', null, 'tip'); tip.hidden = true;
  wrap.append(legend, svg, tip); box.replaceChildren(wrap);
  const max = Math.max(1, ...bm.map(x => x[M]));
  const step = Math.pow(10, Math.floor(Math.log10(max))); let top = Math.ceil(max / step) * step; if (top / step < 3) top = Math.ceil(max / (step / 2)) * (step / 2);
  const ticks = [0, 1, 2, 3, 4].map(i => top * i / 4), y = v => H - 60 - (v / top) * (H - 78);
  let ml = 30; ticks.forEach(t => { const x = sv('text', {}); x.textContent = cpt(t); svg.append(x); ml = Math.max(ml, x.getComputedTextLength() + 10); x.remove(); });
  const bw = (W - 6 - ml) / bm.length, pad = bw * .22, bwi = bw - pad, narrow = bwi < 46;
  ticks.forEach(t => { svg.append(sv('line', { class: 'gl', x1: ml, x2: W - 6, y1: y(t), y2: y(t) })); const x = sv('text', { x: ml - 6, y: y(t), dy: '0.32em', 'text-anchor': 'end' }); x.textContent = cpt(t); svg.append(x); });
  bm.forEach((x, i) => {
    const x0 = ml + i * bw + pad / 2, g = sv('g', { opacity: x.on ? 1 : .28 }); svg.append(g);
    if (stacked) { let acc = 0; gs.forEach(gr => { const v = sum(d.b.filter(r => r.m === x.m && r.group === gr), r => r[M]); if (!v) return; const y1 = y(acc + v), y0 = y(acc); acc += v; const rc = sv('rect', { x: x0, width: bwi, y: y1, height: Math.max(0, y0 - y1), rx: 2 }); rc.style.fill = colorOf(gr); g.append(rc); }); }
    else { const rc = sv('rect', { x: x0, width: bwi, y: y(x[M]), height: Math.max(0, y(0) - y(x[M])), rx: 2 }); rc.style.fill = COLORS[0]; g.append(rc); }
    if (x.on && x[M] && bwi >= 30) { const t = sv('text', { class: 'val', x: x0 + bwi / 2, y: y(x[M]) - 5, 'text-anchor': 'middle' }); t.textContent = cpt(x[M]); svg.append(t); }
    const lx = x0 + bwi / 2, lt = sv('text', { x: lx, y: H - 40 }); lt.textContent = x.month;
    if (narrow) { lt.setAttribute('transform', `rotate(-40 ${lx} ${H - 40})`); lt.setAttribute('text-anchor', 'end'); lt.setAttribute('dy', '0.3em'); } else { lt.setAttribute('text-anchor', 'middle'); lt.setAttribute('dy', '1em'); }
    svg.append(lt);
    const ov = sv('rect', { x: x0 - 3, width: bwi + 6, y: 0, height: H - 40, fill: 'transparent' }); ov.style.cursor = 'pointer';
    ov.addEventListener('mousemove', ev => {
      const px = ev.clientX - wrap.getBoundingClientRect().left; tip.hidden = false; tip.replaceChildren(el('div', x.month + (x.on ? '' : ' (خارج الفلتر)'), 'th'));
      const line = (a, v) => { const l = el('div', null, 'tl'); l.append(el('span', a), el('b', v)); tip.append(l); };
      line(METRICS[M], fmt(x[M])); if (stacked) gs.forEach(gr => { const v = sum(d.b.filter(r => r.m === x.m && r.group === gr), r => r[M]); if (v) line(gr, fmt(v)); });
      const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(W - tw, px - tw / 2)) + 'px'; tip.style.top = '30px';
    });
    ov.addEventListener('mouseleave', () => { tip.hidden = true; });
    ov.addEventListener('click', () => toggle(st.months, x.m));
    svg.append(ov);
  });
}

function rank(d) {
  $('rank_hint').textContent = 'حسب ' + METRICS[st.metric] + ' · انقر على منتج لتصفيته';
  const rows = d.byproduct.filter(x => x.value > 0);
  if (!rows.length) { $('rank').replaceChildren(el('div', 'لا توجد بيانات للفلاتر الحالية.', 'empty')); return; }
  const max = Math.max(...rows.map(x => x.value));
  $('rank').replaceChildren(...rows.map(x => {
    const row = el('button', null, 'rrow' + (st.products.has(x.product) ? ' on' : '')); row.type = 'button';
    const tr = el('div', null, 'tr'), fl = el('div', null, 'fl'); fl.style.width = (x.value / max * 100) + '%'; fl.style.background = colorOf(x.group); tr.append(fl);
    row.append(el('span', x.product, 'nm'), el('span', fmt(x.value) + ' · ' + x.vshare + '%', 'vv'), tr); row.onclick = () => toggle(st.products, x.product); return row;
  }));
}

function groups(d) {
  if (!d.bygroup.length || !sum(d.bygroup, x => x.amount)) { $('groups').replaceChildren(el('div', 'لا توجد بيانات للفلاتر الحالية.', 'empty')); return; }
  $('groups').replaceChildren(...d.bygroup.map(x => {
    const t = el('div', null, 'gt'), top = el('div', null, 'top'); top.append(el('span', x.group), el('span', fmt(x.amount), 'gv'));
    const bar = el('div', null, 'bar'), i = el('i'); i.style.width = x.share + '%'; i.style.background = colorOf(x.group); bar.append(i);
    t.append(top, bar, el('div', x.share + '% · ' + fmt(x.orders) + ' طلب · كمية ' + fmt(x.qty), 'gm')); return t;
  }));
}

function heat(d) {
  $('heat_hint').textContent = METRICS[st.metric] + ' · انقر على اسم منتج لتصفيته';
  const M = st.metric, rows = d.sel;
  if (!rows.length || !sum(rows, r => r[M])) { $('heat').replaceChildren(el('div', 'لا توجد بيانات للفلاتر الحالية.', 'empty')); return; }
  const months = [...new Map(rows.map(r => [r.m, r.month]))].sort((a, b) => a[0] - b[0]);
  const prods = [...new Set(rows.map(r => r.product))].map(p => ({ p, t: sum(rows.filter(r => r.product === p), r => r[M]) })).sort((a, b) => b.t - a.t);
  const max = Math.max(...rows.map(r => r[M])) || 1, grid = el('div', null, 'heat');
  grid.style.gridTemplateColumns = `minmax(190px,1.6fr) repeat(${months.length}, minmax(50px,1fr))`;
  grid.append(el('div', '', 'hc hh')); months.forEach(m => grid.append(el('div', m[1], 'hc hh')));
  prods.forEach(({ p }) => {
    const n = el('div', p, 'hc hn'); if (st.products.has(p)) n.style.fontWeight = '600'; n.onclick = () => toggle(st.products, p); grid.append(n);
    months.forEach(m => { const r = rows.find(z => z.product === p && z.m === m[0]), v = r ? r[M] : 0, c = el('div', v ? cpt(v) : '·', 'hc');
      if (v) c.style.background = `color-mix(in srgb, var(--c0) ${Math.round(8 + v / max * 62)}%, var(--panel))`; else c.style.color = 'var(--muted)'; grid.append(c); });
  });
  $('heat').replaceChildren(grid);
}

function table(d) {
  const rows = d.byproduct.slice().sort((x, y) => { const a = x[sortKey], c = y[sortKey]; return (typeof a === 'string' ? a.localeCompare(c, 'ar') : (a ?? -1) - (c ?? -1)) * sortDir; });
  $('ptbody').replaceChildren(...rows.map(r => { const tr = document.createElement('tr');
    ['product', 'group', 'orders', 'qty', 'amount', 'unit', 'share'].forEach(f => { const td = el('td', typeof r[f] === 'number' ? fmt(r[f]) : (r[f] ?? '—')); if (typeof r[f] === 'number') td.className = 'num'; tr.append(td); }); return tr; }));
}

document.querySelectorAll('#presets .preset').forEach(b => b.onclick = () => { const n = { all: 0, last3: 3, last6: 6 }[b.dataset.p], ids = TOTALS.map(t => t[0]); st.months = new Set(n ? ids.slice(-n) : []); render(); });
document.querySelectorAll('#metric button').forEach(b => b.onclick = () => { st.metric = b.dataset.m; render(); });
let qt; $('q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim(); render(); }, 200); });
$('reset').onclick = () => { st.months.clear(); st.groups.clear(); st.products.clear(); st.q = ''; st.metric = 'amount'; $('q').value = ''; render(); };
document.querySelectorAll('#ptable th[data-s]').forEach(th => th.onclick = () => {
  const k = th.dataset.s; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'product' || k === 'group') ? 1 : -1; }
  document.querySelectorAll('#ptable th[data-s]').forEach(h => h.dataset.s === sortKey ? h.setAttribute('aria-sort', sortDir < 0 ? 'descending' : 'ascending') : h.removeAttribute('aria-sort'));
  table(compute());
});
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (F.length) chart(compute()); }, 120); });

/* ---------- رفع الملف وقراءته ---------- */
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
function parseSheet(ws) {
  const A = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  let hr = -1;
  for (let i = 0; i < Math.min(A.length, 12); i++) if ((A[i] || []).some(c => norm(c) === 'الطلب')) { hr = i; break; }
  if (hr < 0) throw new Error('لم أجد صف العناوين (الطلب / كمية المنتج / إجمالي السعر) في هذه الورقة.');
  const blocks = [];
  A[hr].forEach((c, ci) => {
    if (norm(c) !== 'الطلب') return;
    let label = '';
    for (let r = hr - 1; r >= 0; r--) { const v = norm((A[r] || [])[ci]); if (v && v !== 'الإجمالي بالشهر') { label = v; break; } }
    blocks.push({ ci, label });
  });
  const months = blocks.filter(b => b.label && !b.label.startsWith('الإجمالي'));
  const overall = blocks.find(b => b.label.startsWith('الإجمالي'));
  if (!months.length) throw new Error('لم أجد أعمدة الأشهر في الملف.');
  const sales = [], tots = months.map(() => null);
  for (let i = hr + 1; i < A.length; i++) {
    const row = A[i] || [], name = norm(row[0]); if (!name) continue;
    if (name === 'الإجمالي') { months.forEach((b, k) => { tots[k] = [num(row[b.ci]), num(row[b.ci + 1]), num(row[b.ci + 2])]; }); continue; }
    const group = name.includes(' - ') ? name.split(' - ')[0].trim() : name;
    months.forEach((b, k) => sales.push({ m: k + 1, month: b.label, group, product: name, orders: num(row[b.ci]), qty: num(row[b.ci + 1]), amount: num(row[b.ci + 2]) }));
  }
  if (!sales.length) throw new Error('لم أجد صفوف منتجات تحت صف العناوين.');
  return { sales, tots, months, period: overall ? overall.label.replace(/^الإجمالي\s*/, '') : '' };
}

function showError(msg) { const e = $('err'); e.textContent = msg; e.hidden = !msg; }

async function loadFile(file) {
  showError('');
  try {
    if (typeof XLSX === 'undefined') throw new Error('تعذّر تحميل مكتبة قراءة الإكسل. أعد تحميل الصفحة، وإن استمر الخطأ فتواصل مع مدير النظام.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let res = null, lastErr = null;
    for (const n of wb.SheetNames) { try { res = parseSheet(wb.Sheets[n]); break; } catch (e) { lastErr = e; } }
    if (!res) throw lastErr || new Error('الملف فارغ.');
    F = res.sales; GROUPS = [...new Set(F.map(r => r.group))];
    HAS_TOTALS = res.tots.every(Boolean);
    TOTALS = res.months.map((b, k) => { const t = res.tots[k]; const rs = F.filter(r => r.m === k + 1); return [k + 1, b.label, t ? t[0] : sum(rs, r => r.orders), t ? t[1] : sum(rs, r => r.qty), t ? t[2] : sum(rs, r => r.amount)]; });
    st.months.clear(); st.groups.clear(); st.products.clear(); st.q = ''; st.metric = 'amount'; $('q').value = '';
    $('sub').textContent = GROUPS.join(' · ') + (res.period ? ' · ' + res.period : '');
    $('fname').textContent = 'الملف: ' + file.name;
    const sumO = sum(F, r => r.orders), sumQ = sum(F, r => r.qty), sumA = sum(F, r => r.amount);
    const totO = sum(TOTALS, t => t[2]), totQ = sum(TOTALS, t => t[3]), totA = sum(TOTALS, t => t[4]);
    let foot = 'المصدر: ' + file.name + '. أسماء المنتجات كما وردت في الملف، والفئة مأخوذة من بداية الاسم.';
    if (HAS_TOTALS) {
      foot += ' بلا فلتر منتج يُعرض عدد الطلبات من صف الإجمالي في الملف (' + fmt(totO) + '). عند اختيار منتج أو فئة يُجمع عدد طلبات المنتجات، ومجموعها ' + fmt(sumO) + (sumO !== totO ? ' فيختلف عن الإجمالي.' : '.');
      const bad = []; if (sumQ !== totQ) bad.push('الكمية (' + fmt(sumQ) + ' مقابل ' + fmt(totQ) + ')'); if (sumA !== totA) bad.push('إجمالي السعر (' + fmt(sumA) + ' مقابل ' + fmt(totA) + ')');
      foot += bad.length ? ' تنبيه: مجموع المنتجات لا يطابق صف الإجمالي في ' + bad.join(' و') + '.' : ' الكمية وإجمالي السعر مطابقتان لصف الإجمالي.';
    } else foot += ' لا يوجد صف «الإجمالي» في الملف، فعدد الطلبات هو مجموع طلبات المنتجات.';
    $('foot').textContent = foot;
    $('drop').hidden = true; $('report').hidden = false; $('lede').hidden = false;
    render(); scrollTo(0, 0);
  } catch (e) { showError(e.message || 'تعذّرت قراءة الملف.'); }
}

const fileIn = $('file');
$('pick').onclick = () => fileIn.click();
$('again').onclick = () => { $('report').hidden = true; $('lede').hidden = true; $('drop').hidden = false; $('sub').textContent = 'ارفق ملف الإكسل (تحليل نقطة البيع) ليتحول مباشرة إلى تقرير.'; fileIn.value = ''; };
fileIn.onchange = () => { if (fileIn.files[0]) loadFile(fileIn.files[0]); };
['dragenter', 'dragover'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
