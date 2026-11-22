// لوحة مؤشرات الرواتب والإضافي: فلترة متقدمة فورية (فترة، وحدات، شرائح ذكية، نطاقات رقمية)، مؤشرات مع مقارنة بالفترة السابقة، ورسوم تفاعلية.
// البيانات تُجلب مرة لكل فترة ثم تُرشَّح وتُجمَّع في المتصفح، فيستجيب كل فلتر لحظياً.
const COLORS = ['#00a393', '#bb9a5f', '#054d45', '#4f7f9a', '#a34a6a', '#6c5ba7', '#a8893a', '#7aa874', '#c0745a', '#5d6d7e'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = m => { const [y, mo] = m.split('-'); return `${MONTHS_AR[+mo - 1]} ${y}`; };
const shortMonth = m => { const [y, mo] = m.split('-'); return `${MONTHS_AR[+mo - 1].slice(0, 3)} ${y.slice(2)}`; };
const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const shift = (mo, d) => { const [y, m] = mo.split('-').map(Number); const t = y * 12 + (m - 1) + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

const RANGES = [['gross', 'الراتب الإجمالي الشهري (ر.س)'], ['ot_hours', 'ساعات الإضافي'], ['ot_amount', 'مبلغ الإضافي (ر.س)'], ['as_days', 'أيام الانتداب'], ['as_amount', 'مبلغ الانتداب (ر.س)'], ['extra', 'إجمالي الإضافات (ر.س)'], ['pct', 'الإضافات من الراتب (%)']];
const METRICS = [['due', 'الإجمالي المستحق'], ['extra', 'الإضافات'], ['ot', 'الإضافي'], ['as', 'الانتداب'], ['sal', 'الرواتب']];
const emptySpec = () => ({ from: curMonth(), to: curMonth(), sector: [], department: [], section: [], job: [], atitle: [], q: '', ranges: {}, segments: [], segMode: 'all' });
const normSpec = raw => {
  const e = emptySpec(); if (!raw || typeof raw !== 'object') return e;
  if (/^\d{4}-\d{2}$/.test(raw.from)) e.from = raw.from; if (/^\d{4}-\d{2}$/.test(raw.to)) e.to = raw.to; if (e.from > e.to) e.to = e.from;
  for (const k of ['sector', 'department', 'section', 'job', 'atitle', 'segments']) if (Array.isArray(raw[k])) e[k] = raw[k].map(String).slice(0, 60);
  e.q = String(raw.q || '').slice(0, 80); e.segMode = raw.segMode === 'any' ? 'any' : 'all';
  if (raw.ranges && typeof raw.ranges === 'object') for (const [k, v] of Object.entries(raw.ranges)) if (RANGES.some(r => r[0] === k) && Array.isArray(v)) { const lo = v[0] === '' || v[0] === null ? null : Number(v[0]), hi = v[1] === '' || v[1] === null ? null : Number(v[1]); if ((lo !== null && Number.isFinite(lo)) || (hi !== null && Number.isFinite(hi))) e.ranges[k] = [Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null]; }
  return e;
};

export function parseShared(hashPart) { try { return normSpec(JSON.parse(decodeURIComponent(escape(atob(hashPart))))); } catch { return null; } }

export async function dashboardView(ctx, sharedSpec) {
  const { h, api, toast, sar, qty, view } = ctx;
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const money = v => nf0.format(Math.round(v || 0));
  let spec = normSpec(sharedSpec || (() => { try { return JSON.parse(localStorage.getItem('payroll.dash.last') || 'null'); } catch { return null; } })());
  let data = null, rows = [], charts = [], metric = 'due', sort = { key: 'extra', dir: -1 }, shown = 25;
  const root = h('div', { class: 'dash' });
  const panel = h('div', { class: 'card d-filters no-print' }), kpiBox = h('div', { class: 'd-kpis' }), insightBox = h('div', { class: 'd-insights' }), chartBox = h('div', { class: 'd-charts' }), tableBox = h('div');
  root.append(panel, insightBox, kpiBox, chartBox, tableBox);

  // ---- تحميل الفترة (مع الفترة السابقة للمقارنة) ----
  async function load() {
    const d = await api(`/dashboard?from=${spec.from}&to=${spec.to}`);
    data = d;
    const sum = (e, ms) => { let a = 0, b = 0, c = 0, dd = 0; for (const m of ms) { const x = e.m[m]; if (x) { a += x[0]; b += x[1]; c += x[2]; dd += x[3]; } } return [a, b, c, dd]; };
    const n = d.months.length;
    for (const e of d.employees) {
      const [oh, oa, ad, aa] = sum(e, d.months), [, poa, , paa] = sum(e, d.prev_months);
      Object.assign(e, { oh, oa, ad, aa, poa, paa, extra: oa + aa, sal: e.gross * n, due: e.gross * n + oa + aa, pextra: poa + paa,
        pct: e.gross > 0 ? Math.round((oa + aa) / (e.gross * n) * 1000) / 10 : 0, capHit: d.cap > 0 && d.months.some(m => (e.m[m]?.[0] || 0) > d.cap) });
    }
    const oas = d.employees.map(e => e.oa).filter(v => v > 0).sort((a, b) => a - b);
    data.p90 = oas.length >= 5 ? oas[Math.floor(oas.length * 0.9)] : Infinity;
  }

  // ---- الفلترة ----
  const SEGMENTS = [
    { id: 'ot', label: 'عليهم إضافي', test: e => e.oa > 0 }, { id: 'as', label: 'عليهم انتداب', test: e => e.aa > 0 },
    { id: 'none', label: 'بلا إضافي ولا انتداب', test: e => e.extra === 0 }, { id: 'nosal', label: 'بلا راتب مسجّل', test: e => !e.has_salary },
    { id: 'top', label: 'أعلى 10% إضافي', test: e => e.oa > 0 && e.oa >= data.p90 }, { id: 'grew', label: 'ارتفع عن الفترة السابقة', test: e => e.extra > e.pextra && e.extra > 0 },
    { id: 'heavy', label: 'الإضافات فوق 20% من الراتب', test: e => e.pct > 20 }, { id: 'cap', label: 'تجاوزوا حد الساعات', test: e => e.capHit }, { id: 'nograde', label: 'بلا مسمى انتداب', test: e => !e.assignment_title },
  ];
  const val = (e, k) => ({ gross: e.gross, ot_hours: e.oh, ot_amount: e.oa, as_days: e.ad, as_amount: e.aa, extra: e.extra, pct: e.pct })[k];
  const facetVal = (e, k) => (k === 'job' ? e.job_title || 'بدون مسمى' : k === 'atitle' ? e.assignment_title || 'بدون مسمى انتداب' : e[k] || (k === 'sector' ? 'بدون قطاع' : k === 'department' ? 'بدون إدارة' : 'بدون قسم'));
  function passes(e, { skipSegments = false, skipFacet = null } = {}) {
    for (const k of ['sector', 'department', 'section', 'job', 'atitle']) if (k !== skipFacet && spec[k].length && !spec[k].includes(facetVal(e, k))) return false;
    if (spec.q && !(`${e.full_name} ${e.emp_no || ''} ${e.job_title || ''}`).includes(spec.q)) return false;
    for (const [k, [lo, hi]] of Object.entries(spec.ranges)) { const v = val(e, k); if (lo !== null && v < lo) return false; if (hi !== null && v > hi) return false; }
    if (!skipSegments && spec.segments.length) {
      const ss = SEGMENTS.filter(s => spec.segments.includes(s.id)).map(s => s.test(e));
      if (spec.segMode === 'any' ? !ss.some(Boolean) : !ss.every(Boolean)) return false;
    }
    return true;
  }
  const filtered = () => data.employees.filter(e => passes(e));

  // ---- لوحة الفلاتر ----
  const persist = () => { try { localStorage.setItem('payroll.dash.last', JSON.stringify(spec)); } catch { /* التخزين غير متاح */ } };
  let timer;
  const emit = (reload = false) => { persist(); clearTimeout(timer); timer = setTimeout(async () => { try { if (reload) await load(); update(); } catch (e) { toast(e.message, true); } }, 150); };
  const set = (mut, { redraw = true, reload = false } = {}) => { mut(spec); if (redraw) drawPanel(); emit(reload); };

  function multi(label, key) {
    const counts = new Map(); for (const e of data.employees) if (passes(e, { skipFacet: key })) { const v = facetVal(e, key); counts.set(v, (counts.get(v) || 0) + 1); }
    for (const v of spec[key]) if (!counts.has(v)) counts.set(v, 0);
    const opts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));
    const btn = h('button', { type: 'button', class: 'ms-btn' + (spec[key].length ? ' on' : '') }, label, spec[key].length ? h('b', { class: 'ms-n' }, String(spec[key].length)) : null, h('span', { class: 'ms-caret' }, '▾'));
    const pop = h('div', { class: 'ms-pop', hidden: true }), list = h('div', { class: 'ms-list' });
    const search = h('input', { type: 'search', placeholder: 'بحث…', 'aria-label': 'بحث في ' + label });
    const draw = () => { const t = search.value.trim(); list.replaceChildren(...opts.filter(([v]) => !t || v.includes(t)).map(([v, c]) => h('label', { class: 'ms-opt' },
      h('input', { type: 'checkbox', checked: spec[key].includes(v), onchange: ev => set(s => { s[key] = ev.target.checked ? [...s[key], v] : s[key].filter(x => x !== v); }, { redraw: false }) }), h('span', null, v), h('small', null, String(c))))); if (!list.children.length) list.append(h('div', { class: 'ms-empty' }, 'لا نتائج')); };
    search.addEventListener('input', draw);
    pop.append(search, h('div', { class: 'ms-acts' }, h('button', { type: 'button', class: 'btn sm', onclick: () => set(s => { s[key] = []; }) }, 'مسح')), list);
    btn.addEventListener('click', ev => { ev.stopPropagation(); const open = pop.hidden; document.querySelectorAll('.d-filters .ms-pop').forEach(p => { p.hidden = true; }); pop.hidden = !open; if (open) { draw(); search.focus(); } });
    pop.addEventListener('click', ev => ev.stopPropagation());
    return h('div', { class: 'ms' }, btn, pop);
  }
  document.addEventListener('click', () => document.querySelectorAll('.d-filters .ms-pop').forEach(p => { p.hidden = true; }));

  let advOpen = false;
  function drawPanel() {
    const n = data.months.length;
    const presets = [['هذا الشهر', curMonth(), curMonth()], ['آخر 3 أشهر', shift(curMonth(), -2), curMonth()], ['آخر 6 أشهر', shift(curMonth(), -5), curMonth()],
      ['هذه السنة', `${new Date().getFullYear()}-01`, curMonth()], ['السنة الماضية', `${new Date().getFullYear() - 1}-01`, `${new Date().getFullYear() - 1}-12`]];
    const from = h('input', { type: 'month', value: spec.from, 'aria-label': 'من شهر', onchange: ev => ev.target.value && set(s => { s.from = ev.target.value; if (s.to < s.from) s.to = s.from; }, { reload: true }) });
    const to = h('input', { type: 'month', value: spec.to, 'aria-label': 'إلى شهر', onchange: ev => ev.target.value && set(s => { s.to = ev.target.value; if (s.from > s.to) s.from = s.to; }, { reload: true }) });
    const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم أو المسمى…', value: spec.q, 'aria-label': 'بحث', oninput: ev => set(s => { s.q = ev.target.value.trim(); }, { redraw: false }) });
    // شرائح ذكية بعدّادات حيّة (حسب بقية الفلاتر)
    const base = data.employees.filter(e => passes(e, { skipSegments: true }));
    const segs = h('div', { class: 'd-segs' }, SEGMENTS.filter(s => s.id !== 'cap' || data.cap > 0).map(s => {
      const on = spec.segments.includes(s.id), c = base.filter(e => s.test(e)).length;
      return h('button', { type: 'button', class: 'chip' + (on ? ' on' : '') + (!on && !c ? ' dim' : ''), onclick: () => set(x => { x.segments = on ? x.segments.filter(i => i !== s.id) : [...x.segments, s.id]; }) }, s.label, h('span', { class: 'cn' }, String(c)));
    }));
    const rangeRows = RANGES.map(([k, label]) => {
      const vs = data.employees.map(e => val(e, k)); const mx = Math.max(0, ...vs);
      const lo = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'من 0', value: spec.ranges[k]?.[0] ?? '' }), hi = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'إلى ' + money(mx), value: spec.ranges[k]?.[1] ?? '' });
      const ch = () => set(s => { const a = lo.value.trim(), b = hi.value.trim(); if (a === '' && b === '') delete s.ranges[k]; else s.ranges[k] = [a, b]; Object.assign(s, normSpec(s)); }, { redraw: false });
      lo.addEventListener('input', ch); hi.addEventListener('input', ch);
      return h('div', { class: 'd-range' }, h('label', null, label), lo, h('span', null, '–'), hi);
    });
    // شارات الفلاتر الفعّالة
    const chips = [];
    const chip = (text, clear) => chips.push(h('span', { class: 'fchip' }, text, h('button', { type: 'button', 'aria-label': 'إزالة', onclick: () => set(clear) }, '×')));
    for (const [k, lb] of [['sector', 'القطاع'], ['department', 'الإدارة'], ['section', 'القسم'], ['job', 'المسمى'], ['atitle', 'مسمى الانتداب']]) if (spec[k].length) chip(`${lb}: ${spec[k].slice(0, 2).join('، ')}${spec[k].length > 2 ? ` +${spec[k].length - 2}` : ''}`, s => { s[k] = []; });
    for (const id of spec.segments) chip(SEGMENTS.find(s => s.id === id)?.label || id, s => { s.segments = s.segments.filter(x => x !== id); });
    for (const [k, [lo, hi]] of Object.entries(spec.ranges)) chip(`${RANGES.find(r => r[0] === k)[1].replace(/ \(.*\)/, '')}: ${lo ?? '…'} – ${hi ?? '…'}`, s => { delete s.ranges[k]; });
    if (spec.q) chip(`بحث: ${spec.q}`, s => { s.q = ''; });
    // العروض المحفوظة
    const views = (() => { try { return JSON.parse(localStorage.getItem('payroll.dash.views') || '[]'); } catch { return []; } })();
    const saveViews = v => { try { localStorage.setItem('payroll.dash.views', JSON.stringify(v.slice(0, 30))); } catch { /* التخزين غير متاح */ } };
    const viewSel = h('select', { 'aria-label': 'العروض المحفوظة', onchange: ev => { const v = views.find(x => x.name === ev.target.value); if (v) { spec = normSpec(v.spec); drawPanel(); persist(); load().then(update).catch(e => toast(e.message, true)); } } },
      h('option', { value: '' }, views.length ? 'العروض المحفوظة…' : 'لا عروض محفوظة'), ...views.map(v => h('option', { value: v.name }, v.name)));
    const shareLink = () => { const code = btoa(unescape(encodeURIComponent(JSON.stringify(spec)))); const url = `${location.origin}/payroll/#dashboard~${code}`; (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('نُسخ رابط العرض'), () => toast('تعذّر النسخ تلقائياً', true)); };
    panel.replaceChildren(...[
      h('div', { class: 'd-row' }, h('span', { class: 'flabel' }, 'الفترة'), h('div', { class: 'd-presets' }, presets.map(([l, a, b]) => h('button', { type: 'button', class: 'chip' + (spec.from === a && spec.to === b ? ' on' : ''), onclick: () => set(s => { s.from = a; s.to = b; }, { reload: true }) }, l))),
        from, h('span', null, '←'), to, h('span', { class: 'hint' }, `${n} ${n === 1 ? 'شهر' : n === 2 ? 'شهران' : n <= 10 ? 'أشهر' : 'شهراً'}`)),
      h('div', { class: 'd-row' }, search, multi('القطاع', 'sector'), multi('الإدارة', 'department'), multi('القسم', 'section'), multi('المسمى الوظيفي', 'job'), multi('مسمى الانتداب', 'atitle'), h('div', { class: 'sp' }), viewSel,
        h('button', { type: 'button', class: 'btn sm', onclick: () => { const name = prompt('اسم العرض:'); if (name && name.trim()) { const v = views.filter(x => x.name !== name.trim()); v.unshift({ name: name.trim().slice(0, 40), spec }); saveViews(v); drawPanel(); toast('تم حفظ العرض'); } } }, 'حفظ العرض'),
        views.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => { if (viewSel.value) { saveViews(views.filter(x => x.name !== viewSel.value)); drawPanel(); } else toast('اختر عرضاً لحذفه', true); } }, 'حذف عرض') : null,
        h('button', { type: 'button', class: 'btn sm', onclick: shareLink }, 'نسخ الرابط')),
      h('div', { class: 'd-row' }, h('span', { class: 'flabel' }, 'شرائح ذكية'), segs,
        spec.segments.length > 1 ? h('div', { class: 'seg' }, ['all', 'any'].map(m => h('button', { type: 'button', class: spec.segMode === m ? 'on' : '', onclick: () => set(s => { s.segMode = m; }) }, m === 'all' ? 'كلها' : 'أيٌّ منها'))) : null),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { advOpen = !advOpen; drawPanel(); } }, advOpen ? '▾ إخفاء الفلاتر المتقدمة' : '⚙ فلاتر متقدمة (نطاقات رقمية)'),
      advOpen ? h('div', { class: 'd-ranges' }, rangeRows) : null,
      h('div', { class: 'd-row d-active' }, h('span', { class: 'hint', id: 'd-count' }), ...chips, chips.length ? h('button', { type: 'button', class: 'btn sm danger', onclick: () => set(s => { Object.assign(s, { sector: [], department: [], section: [], job: [], atitle: [], q: '', ranges: {}, segments: [] }); }) }, 'مسح الفلاتر') : null)].filter(Boolean));   // replaceChildren يكتب null نصاً
  }

  // ---- المؤشرات والرسوم والجدول ----
  const sumBy = (list, f) => list.reduce((a, e) => a + f(e), 0);
  const delta = (cur, prev) => (prev > 0 ? Math.round((cur - prev) / prev * 100) : cur > 0 ? null : 0);
  const kpi = (label, value, unit, { hint, d, tone, bad } = {}) => h('div', { class: 'd-kpi ' + (tone || '') }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value, unit ? h('span', { class: 'u' }, unit) : null),
    d === undefined ? null : h('div', { class: 'dl ' + (d === null ? '' : (d > 0) === !bad ? 'good' : d === 0 ? '' : 'badd') }, d === null ? 'جديد مقابل الفترة السابقة' : d === 0 ? 'بلا تغيّر عن الفترة السابقة' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}% عن الفترة السابقة`),
    hint ? h('div', { class: 'h' }, hint) : null);
  const groupSum = (list, keyFn, f) => { const m = new Map(); for (const e of list) { const k = keyFn(e); m.set(k, (m.get(k) || 0) + f(e)); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const mval = e => ({ due: e.due, extra: e.extra, ot: e.oa, as: e.aa, sal: e.sal })[metric];

  function destroyCharts() { for (const c of charts) c.destroy(); charts = []; }
  const chartCard = (title, sub, canvasH = 260) => { const cv = h('canvas'); const box = h('div', { class: 'd-chart' }, h('div', { class: 'ct' }, h('b', null, title), sub ? h('small', null, sub) : null), h('div', { class: 'cv', style: `height:${canvasH}px` }, cv)); return { box, cv }; };
  const baseOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: 'Tahoma' }, usePointStyle: true } }, tooltip: { rtl: true, textDirection: 'rtl', bodyFont: { family: 'Tahoma' }, titleFont: { family: 'Tahoma' }, callbacks: {} } } };

  function update() {
    if (!data) return;
    const list = filtered(), n = data.months.length;
    // الشرائح تعتمد على بقية الفلاتر: نعيد رسم اللوحة عند الحاجة
    drawPanelKeepFocus();
    const sal = sumBy(list, e => e.sal), oa = sumBy(list, e => e.oa), aa = sumBy(list, e => e.aa), oh = sumBy(list, e => e.oh), ad = sumBy(list, e => e.ad);
    const poa = sumBy(list, e => e.poa), paa = sumBy(list, e => e.paa), ins = sumBy(list, e => e.insurance) * n;
    const withExtra = list.filter(e => e.extra > 0).length;
    kpiBox.replaceChildren(
      kpi('الموظفون', String(list.length), 'موظف', { hint: `${withExtra} لديهم إضافي أو انتداب · ${list.filter(e => !e.has_salary).length} بلا راتب`, tone: 'ink' }),
      kpi('الرواتب' + (n > 1 ? ` (${n} أشهر)` : ' الشهرية'), money(sal), 'ر.س', { hint: `شهرياً ${money(sumBy(list, e => e.gross))} ر.س` }),
      kpi('الإضافي', money(oa), 'ر.س', { d: delta(oa, poa), bad: true, hint: `${qty(oh)} ساعة` }),
      kpi('الانتدابات', money(aa), 'ر.س', { d: delta(aa, paa), bad: true, hint: `${qty(ad)} يوم` }),
      kpi('الإجمالي المستحق', money(sal + oa + aa), 'ر.س', { tone: 'ok', hint: `الإضافات ${sal > 0 ? Math.round((oa + aa) / sal * 1000) / 10 : 0}% من الرواتب` }),
      kpi('استقطاع التأمينات', money(ins), 'ر.س', { hint: n > 1 ? `عن ${n} أشهر` : 'شهرياً' }));
    // رؤى تلقائية
    const tips = [];
    const topE = [...list].sort((a, b) => b.extra - a.extra)[0];
    if (topE && topE.extra > 0) tips.push(`أعلى إضافات: ${topE.full_name} بمبلغ ${money(topE.extra)} ر.س (${topE.pct}% من راتبه).`);
    const dep = groupSum(list, e => e.department || 'بدون إدارة', e => e.extra)[0];
    if (dep && dep[1] > 0) tips.push(`أكثر إدارة في الإضافات: ${dep[0]} (${money(dep[1])} ر.س).`);
    const capN = list.filter(e => e.capHit).length; if (capN) tips.push(`${capN} موظف تجاوزوا حد ساعات الإضافي الشهري (${data.cap} ساعة).`);
    const dOA = delta(oa + aa, poa + paa); if (dOA !== null && Math.abs(dOA) >= 10) tips.push(`إجمالي الإضافات ${dOA > 0 ? 'ارتفع' : 'انخفض'} ${Math.abs(dOA)}% عن الفترة السابقة.`);
    const ns = list.filter(e => !e.has_salary).length; if (ns) tips.push(`${ns} موظف بلا راتب مسجّل (لا يُحسب لهم إضافي).`);
    insightBox.replaceChildren(...tips.slice(0, 4).map(t => h('div', { class: 'tip' }, '💡 ' + t)));
    insightBox.hidden = !tips.length;

    destroyCharts();
    const C = window.Chart; if (!C) { chartBox.replaceChildren(h('div', { class: 'hint' }, 'تعذّر تحميل مكتبة الرسوم.')); drawTable(list, sal, oa, aa, oh, ad, n); return; }
    // 1) الاتجاه الشهري
    const c1 = chartCard('الاتجاه الشهري', 'الإضافي والانتداب بالريال', 280);
    const trend = data.months.map(m => [sumBy(list, e => e.m[m]?.[1] || 0), sumBy(list, e => e.m[m]?.[3] || 0)]);
    // 2) توزيع حسب القطاع
    const MET = METRICS.find(x => x[0] === metric)[1];
    const secG = groupSum(list, e => e.sector || 'بدون قطاع', mval).filter(x => x[1] > 0);
    const c2 = chartCard('التوزيع حسب القطاع', MET, 280);
    // 3) أعلى الإدارات
    const depG = groupSum(list, e => e.department || 'بدون إدارة', mval).filter(x => x[1] > 0).slice(0, 10);
    const c3 = chartCard('أعلى الإدارات', MET, Math.max(220, depG.length * 34 + 40));
    // 4) أعلى 10 موظفين بالإضافات
    const top = [...list].sort((a, b) => b.extra - a.extra).filter(e => e.extra > 0).slice(0, 10);
    const c4 = chartCard('أعلى 10 موظفين بالإضافات', 'اضغط على عمود لتصفية الجدول', Math.max(220, top.length * 34 + 40));
    // 5) الأنواع
    const tg = new Map(); for (const e of list) for (const [m, kind, type, , amount] of e.t) if (data.months.includes(m)) { const k = `${kind}|${type}`; tg.set(k, (tg.get(k) || 0) + amount); }
    const types = [...tg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const c5 = chartCard('حسب النوع', 'مبلغ كل نوع إضافي أو انتداب', Math.max(220, types.length * 34 + 40));
    const metricSeg = h('div', { class: 'seg d-metric' }, METRICS.map(([k, l]) => h('button', { type: 'button', class: metric === k ? 'on' : '', onclick: () => { metric = k; update(); } }, l)));
    chartBox.replaceChildren(h('div', { class: 'bar' }, h('span', { class: 'flabel' }, 'قياس الرسوم'), metricSeg), h('div', { class: 'd-grid2' }, c1.box, c2.box), h('div', { class: 'd-grid2' }, c3.box, c4.box), h('div', { class: 'd-grid1' }, c5.box));
    const fmtTip = { callbacks: { label: ctx2 => ` ${ctx2.dataset.label || ctx2.label}: ${money(ctx2.parsed.y ?? ctx2.parsed.x ?? ctx2.parsed)} ر.س` } };
    charts.push(new C(c1.cv, { type: 'bar', data: { labels: data.months.map(shortMonth), datasets: [{ label: 'الإضافي', data: trend.map(t => t[0]), backgroundColor: COLORS[0], borderRadius: 4 }, { label: 'الانتداب', data: trend.map(t => t[1]), backgroundColor: COLORS[1], borderRadius: 4 }] },
      options: { ...baseOpts, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => money(v) } } }, plugins: { ...baseOpts.plugins, tooltip: { ...baseOpts.plugins.tooltip, ...fmtTip } } } }));
    charts.push(new C(c2.cv, { type: 'doughnut', data: { labels: secG.map(x => x[0]), datasets: [{ data: secG.map(x => Math.round(x[1])), backgroundColor: secG.map((_, i) => COLORS[i % COLORS.length]), borderWidth: 2 }] },
      options: { ...baseOpts, cutout: '58%', plugins: { ...baseOpts.plugins, legend: { position: 'bottom', labels: { font: { family: 'Tahoma' }, usePointStyle: true } }, tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: x => ` ${x.label}: ${money(x.parsed)} ر.س` } } } } }));
    const hbar = (cv, labels, values, colors, onClick) => charts.push(new C(cv, { type: 'bar', data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
      options: { ...baseOpts, indexAxis: 'y', plugins: { ...baseOpts.plugins, legend: { display: false }, tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: x => ` ${money(x.parsed.x)} ر.س` } } }, scales: { x: { ticks: { callback: v => money(v) } }, y: { grid: { display: false }, ticks: { font: { family: 'Tahoma' } } } }, onClick: onClick || null } }));
    hbar(c3.cv, depG.map(x => x[0]), depG.map(x => Math.round(x[1])), COLORS[0]);
    hbar(c4.cv, top.map(e => e.full_name), top.map(e => Math.round(e.extra)), COLORS[2], (_, els) => { if (els[0]) { const e = top[els[0].index]; set(s => { s.q = e.full_name; }); } });
    hbar(c5.cv, types.map(([k]) => k.split('|')[1]), types.map(([, v]) => Math.round(v)), types.map(([k]) => (k.startsWith('overtime') ? COLORS[0] : COLORS[1])));
    drawTable(list, sal, oa, aa, oh, ad, n);
  }
  // يعيد رسم اللوحة مع الحفاظ على التركيز في مربع البحث
  function drawPanelKeepFocus() {
    const act = document.activeElement; const wasSearch = act && act.type === 'search' && panel.contains(act) && act.getAttribute('aria-label') === 'بحث';
    const pos = wasSearch ? act.selectionStart : 0;
    if (panel.querySelector('.ms-pop:not([hidden])') && !wasSearch) { const c = document.getElementById('d-count'); if (c) c.textContent = `${filtered().length} من ${data.employees.length} موظف`; return; }   // لا نغلق قائمة مفتوحة
    drawPanel(); const cnt = document.getElementById('d-count'); if (cnt) cnt.textContent = `${filtered().length} من ${data.employees.length} موظف`;
    if (wasSearch) { const s = panel.querySelector('input[aria-label="بحث"]'); s?.focus(); try { s?.setSelectionRange(pos, pos); } catch { /* غير مدعوم */ } }
  }

  function drawTable(list, sal, oa, aa, oh, ad, n) {
    const cols = [['full_name', 'الموظف'], ['unit', 'الوحدة'], ['gross', 'الراتب الشهري'], ['oh', 'ساعات إضافي'], ['oa', 'مبلغ الإضافي'], ['ad', 'أيام انتداب'], ['aa', 'مبلغ الانتداب'], ['extra', 'الإضافات'], ['pct', '% من الراتب'], ['due', 'المستحق للفترة']];
    const unit = e => [e.sector, e.department, e.section].filter(Boolean).join(' ‹ ');
    const sorted = [...list].sort((a, b) => { const x = sort.key === 'unit' ? unit(a) : a[sort.key], y = sort.key === 'unit' ? unit(b) : b[sort.key]; return (typeof x === 'string' ? x.localeCompare(y, 'ar') : x - y) * sort.dir; });
    const head = h('tr', null, h('th', null, '#'), cols.map(([k, l]) => h('th', { class: k === 'full_name' || k === 'unit' ? '' : 'n', 'aria-sort': sort.key === k ? (sort.dir < 0 ? 'descending' : 'ascending') : null },
      h('button', { type: 'button', class: 'th-btn', onclick: () => { sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'full_name' || k === 'unit' ? 1 : -1) }; drawTable(list, sal, oa, aa, oh, ad, n); } }, l, sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''))));
    const body = sorted.slice(0, shown).map((e, i) => h('tr', null, h('td', { class: 'n' }, String(i + 1)),
      h('td', { class: 'who' }, h('b', null, e.full_name), h('small', null, [e.emp_no ? `رقم ${e.emp_no}` : '', e.job_title].filter(Boolean).join(' · '))), h('td', null, unit(e) || '—'),
      h('td', { class: 'n' }, e.has_salary ? money(e.gross) : '—'), h('td', { class: 'n' }, e.oh ? qty(e.oh) : '—'), h('td', { class: 'n' }, e.oa ? money(e.oa) : '—'), h('td', { class: 'n' }, e.ad ? qty(e.ad) : '—'), h('td', { class: 'n' }, e.aa ? money(e.aa) : '—'),
      h('td', { class: 'n' }, e.extra ? h('b', null, money(e.extra)) : '—'), h('td', { class: 'n' }, e.extra && e.has_salary ? `${e.pct}%` : '—'), h('td', { class: 'n' }, money(e.due))));
    const foot = h('tr', null, h('td'), h('td', null, 'الإجمالي'), h('td'), h('td', { class: 'n' }, money(sumBy(list, e => e.gross))), h('td', { class: 'n' }, qty(oh)), h('td', { class: 'n' }, money(oa)), h('td', { class: 'n' }, qty(ad)), h('td', { class: 'n' }, money(aa)), h('td', { class: 'n' }, money(oa + aa)), h('td', { class: 'n' }, sal > 0 ? `${Math.round((oa + aa) / sal * 1000) / 10}%` : '—'), h('td', { class: 'n' }, money(sal + oa + aa)));
    tableBox.replaceChildren(...[h('div', { class: 'd-ttl' }, h('h3', null, 'تفصيل الموظفين'), h('span', { class: 'hint' }, `${sorted.length} موظف`)),
      list.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'pay' }, h('thead', null, head), h('tbody', null, body), h('tfoot', null, foot))) : h('div', { class: 'empty' }, 'لا موظفين مطابقين للفلاتر.'),
      sorted.length > shown ? h('div', { class: 'bar', style: 'margin-top:10px' }, h('button', { class: 'btn', type: 'button', onclick: () => { shown += 50; drawTable(list, sal, oa, aa, oh, ad, n); } }, `عرض المزيد (${sorted.length - shown} متبقٍ)`), h('button', { class: 'btn', type: 'button', onclick: () => { shown = sorted.length; drawTable(list, sal, oa, aa, oh, ad, n); } }, 'عرض الكل')) : null].filter(Boolean));
  }

  view.replaceChildren(root);
  await load(); drawPanel(); update();
  return () => destroyCharts();
}
