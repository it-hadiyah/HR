// محرك الفلترة المتقدمة لمتابعة الأرصدة: مواصفة JSON واحدة تُطبَّق على لوحة المؤشرات والجدول والتصدير.
const round2 = x => Math.round(x * 100) / 100;

export const MISSING_LABEL = { emp_no: 'الرقم الوظيفي', hire_date: 'تاريخ التعيين', annual_balance: 'الرصيد السنوي', total_balance: 'الرصيد الكلي', target_days: 'المستهدف', gross_salary: 'الراتب الإجمالي' };
export const RANGE_FIELDS = { total: 'total_balance', annual: 'annual_balance', used: 'used_days', target: 'target_days', remaining: 'remaining_to_target', progress: 'progress_pct', service: 'service_years', salary: 'gross_salary', cost: 'cost_now' };
const FIN_ONLY = new Set(['salary', 'cost']);

/** الوقت المنقضي من السنة (0..1) والأشهر المتبقية */
export function yearTiming(year, now = new Date()) {
  const cy = now.getFullYear();
  const elapsed = year < cy ? 1 : year > cy ? 0 : Math.min(1, (now - new Date(cy, 0, 1)) / (365 * 864e5));
  return { elapsed, monthsLeft: year < cy ? 0 : year > cy ? 12 : Math.max(0.5, (1 - elapsed) * 12) };
}

/** حالة الموظف من المستهدف: achieved | on_track | lagging | no_target */
export function classifyRow(e, elapsed) {
  if (!e.target_days) return 'no_target';
  const used = e.used_days ?? 0;
  if (used >= e.target_days) return 'achieved';
  return used >= e.target_days * elapsed * 0.9 ? 'on_track' : 'lagging';
}

/** الشرائح الذكية: لكل شريحة معرّف وعنوان ودالة اختبار؛ ctx = { elapsed, cap, p90cost } */
export const SEGMENTS = [
  { id: 'high_balance', label: 'رصيد مرتفع', test: (e) => e.high_balance },
  { id: 'near_cap', label: 'قريب من الحد', test: (e, c) => e.total_balance !== null && !e.high_balance && e.total_balance >= c.cap * 0.8 },
  { id: 'negative', label: 'رصيد سالب', test: (e) => e.total_balance !== null && e.total_balance < 0 },
  { id: 'achieved', label: 'حقق المستهدف', test: (e, c) => classifyRow(e, c.elapsed) === 'achieved' },
  { id: 'on_track', label: 'وفق الخطة', test: (e, c) => classifyRow(e, c.elapsed) === 'on_track' },
  { id: 'lagging', label: 'متأخر عن الخطة', test: (e, c) => classifyRow(e, c.elapsed) === 'lagging' },
  { id: 'no_target', label: 'بلا مستهدف', test: (e, c) => classifyRow(e, c.elapsed) === 'no_target' },
  { id: 'no_usage', label: 'لم يستخدم أي إجازة', test: (e) => !(e.used_days > 0) },
  { id: 'incomplete', label: 'بيانات ناقصة', test: (e) => !e.complete },
  { id: 'new_hire', label: 'مُعيَّن حديثاً (أقل من سنة)', test: (e) => e.service_years !== null && e.service_years < 1 },
  { id: 'top_cost', label: 'أعلى 10% تكلفة', fin: true, test: (e, c) => e.cost_now !== null && c.p90cost !== null && e.cost_now >= c.p90cost && e.cost_now > 0 },
];

const strArr = (v, max = 200) => (Array.isArray(v) ? [...new Set(v.map(x => String(x).slice(0, 120)).filter(Boolean))].slice(0, max) : []);
const numOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const dateOrNull = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** يحوّل المدخل الخام (نص JSON أو كائن) إلى مواصفة آمنة ومنظّمة */
export function normalizeFilter(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = {}; } }
  if (!o || typeof o !== 'object') o = {};
  const f = { sector: strArr(o.sector), department: strArr(o.department), section: strArr(o.section), job: strArr(o.job), q: String(o.q || '').trim().slice(0, 80),
    hire_from: dateOrNull(o.hire_from), hire_to: dateOrNull(o.hire_to), ranges: {}, segments: strArr(o.segments, 20).filter(id => SEGMENTS.some(s => s.id === id)),
    segMode: o.segMode === 'any' ? 'any' : 'all', missing: strArr(o.missing, 10).filter(k => k in MISSING_LABEL) };
  for (const k of Object.keys(RANGE_FIELDS)) {
    const r = o.ranges?.[k];
    if (Array.isArray(r)) { const lo = numOrNull(r[0]), hi = numOrNull(r[1]); if (lo !== null || hi !== null) f.ranges[k] = [lo, hi]; }
  }
  return f;
}

export const isEmptyFilter = f => !f.sector.length && !f.department.length && !f.section.length && !f.job.length && !f.q && !f.hire_from && !f.hire_to && !Object.keys(f.ranges).length && !f.segments.length && !f.missing.length;

export function filterContext(rows, year, policy) {
  const { elapsed } = yearTiming(year);
  const costs = rows.map(r => r.cost_now).filter(x => x !== null && x !== undefined).sort((a, b) => a - b);
  const p90cost = costs.length >= 5 ? costs[Math.floor(costs.length * 0.9)] : null;
  return { elapsed, cap: policy.max_balance_cap, p90cost };
}

const inSet = (set, v, empty) => set.includes(v ?? empty);

/** يطبّق المواصفة على الصفوف (fin: هل يحق للمستخدم الاطلاع على الحقول المالية) */
export function applyFilter(rows, f, ctx, fin) {
  if (isEmptyFilter(f)) return rows;
  const q = f.q;
  const segs = SEGMENTS.filter(s => f.segments.includes(s.id) && (fin || !s.fin));
  return rows.filter(e => {
    if (f.sector.length && !inSet(f.sector, e.sector, 'بدون قطاع')) return false;
    if (f.department.length && !inSet(f.department, e.department, 'بدون إدارة')) return false;
    if (f.section.length && !inSet(f.section, e.section, 'بدون قسم')) return false;
    if (f.job.length && !inSet(f.job, e.job_title, 'بدون مسمى')) return false;
    if (q && !(`${e.full_name} ${e.emp_no || ''} ${e.job_title || ''}`).includes(q)) return false;
    if (f.hire_from && !(e.hire_date && e.hire_date >= f.hire_from)) return false;
    if (f.hire_to && !(e.hire_date && e.hire_date <= f.hire_to)) return false;
    for (const [k, [lo, hi]] of Object.entries(f.ranges)) {
      if (FIN_ONLY.has(k) && !fin) continue;
      const v = e[RANGE_FIELDS[k]];
      if (v === null || v === undefined) return false;
      if (lo !== null && v < lo) return false;
      if (hi !== null && v > hi) return false;
    }
    if (f.missing.length && !f.missing.some(k => e.missing.includes(MISSING_LABEL[k]))) return false;
    if (segs.length) {
      const hits = segs.map(s => s.test(e, ctx));
      if (f.segMode === 'any' ? !hits.some(Boolean) : !hits.every(Boolean)) return false;
    }
    return true;
  });
}

/** خيارات الفلاتر وعدّاداتها الحيّة من الصفوف الأساسية */
export function buildFacets(rows, ctx, fin) {
  const count = (key, empty) => { const m = new Map(); for (const e of rows) { const v = e[key] || empty; m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'ar')); };
  const ranges = {};
  for (const [k, field] of Object.entries(RANGE_FIELDS)) {
    if (FIN_ONLY.has(k) && !fin) continue;
    const vs = rows.map(r => r[field]).filter(v => v !== null && v !== undefined);
    ranges[k] = vs.length ? { min: round2(Math.min(...vs)), max: round2(Math.max(...vs)) } : null;
  }
  const hires = rows.map(r => r.hire_date).filter(Boolean).sort();
  return {
    total: rows.length,
    sector: count('sector', 'بدون قطاع'), department: count('department', 'بدون إدارة'), section: count('section', 'بدون قسم'), job: count('job_title', 'بدون مسمى').slice(0, 300),
    ranges, hire: hires.length ? { min: hires[0], max: hires[hires.length - 1] } : null,
    missing: Object.entries(MISSING_LABEL).filter(([k]) => fin || k !== 'gross_salary').map(([value, label]) => ({ value, label, count: rows.filter(e => e.missing.includes(label)).length })),
    segments: SEGMENTS.filter(s => fin || !s.fin).map(s => ({ id: s.id, label: s.label, count: rows.filter(e => s.test(e, ctx)).length })),
  };
}
