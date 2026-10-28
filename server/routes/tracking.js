// متابعة أرصدة الإجازات: حقول يعبّئها المسؤول لكل موظف وسنة، وتُحسب منها التكلفة المالية والمؤشرات.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q, pool } from '../db/pool.js';
import { requirePerm, audit, wrap, canSeeFinancials, can } from '../lib/auth.js';
import { resolveScope } from '../lib/rbac.js';
import { loadPolicy } from '../lib/context.js';
import { httpError, isDate } from '../lib/util.js';
import { resetOrgGraph } from '../lib/orggraph.js';
import { normalizeFilter, applyFilter, filterContext, buildFacets, yearTiming, classifyRow } from '../lib/trackingFilter.js';

const r = Router();
const round2 = x => Math.round(x * 100) / 100;
const numOrNull = (v, label, { min = 0 } = {}) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫]/g, '.').replace(/[,٬،\s]/g, ''));
  if (!Number.isFinite(n) || (min !== null && n < min)) throw httpError(400, `قيمة غير صالحة: ${label}`);
  return round2(n);
};

/** يحسب المؤشرات المشتقة لصف واحد؛ الحقول المالية تُعاد فقط لمن يملك صلاحية الاطلاع المالي */
export function derive(row, policy, fin) {
  const divisor = policy.day_divisor || 30;
  const total = row.total_balance, target = row.target_days, used = row.used_days ?? 0;
  const rate = fin && row.gross_salary !== null ? row.gross_salary / divisor : null;
  const remaining = target !== null ? (target > 0 ? Math.max(0, target - used) : 0) : null;       // المتبقي لتحقيق المستهدف (الهدف السالب/الصفري لا خطة له)
  const expected = total !== null && remaining !== null ? total - remaining : null;   // الرصيد المتوقع نهاية السنة إن تحقق المستهدف
  const pos = x => (x > 0 ? x : 0);
  const missing = [];
  if (!row.emp_no) missing.push('الرقم الوظيفي');
  if (!row.hire_date) missing.push('تاريخ التعيين');
  if (row.annual_balance === null) missing.push('الرصيد السنوي');
  if (total === null) missing.push('الرصيد الكلي');
  if (target === null) missing.push('المستهدف');
  if (fin && row.gross_salary === null) missing.push('الراتب الإجمالي');
  const out = {
    remaining_to_target: remaining === null ? null : round2(remaining),
    owed_days: total !== null && total < 0 ? round2(-total) : 0,                          // رصيد سالب = مستحق على الموظف
    remaining_total: total === null ? null : round2(total - used),                      // المتبقي من الرصيد الكلي بعد خصم المستخدم
    expected_balance: expected === null ? null : round2(expected),
    progress_pct: target > 0 ? Math.min(100, round2(used / target * 100)) : null,
    target_met: target !== null && target > 0 ? used >= target : null,
    high_balance: total !== null && total > policy.max_balance_cap,
    service_years: row.hire_date ? Math.max(0, round2((Date.now() - new Date(row.hire_date).getTime()) / (365.25 * 864e5))) : null,
    missing,
    complete: missing.length === 0,
  };
  if (fin) {
    out.day_rate = rate === null ? null : round2(rate);
    out.cost_now = rate !== null && total !== null ? round2(pos(total) * rate) : null;               // تكلفة الرصيد الحالي
    out.cost_after_target = rate !== null && expected !== null ? round2(pos(expected) * rate) : null;  // التكلفة إن تحقق المستهدف
    out.owed_cost = rate !== null ? round2(out.owed_days * rate) : null;                  // المبلغ المستحق على الموظف
    out.cost_target = rate !== null && target !== null ? round2(pos(target) * rate) : null;                       // تكلفة المستهدف لنهاية السنة
    out.cost_remaining_target = rate !== null && remaining !== null ? round2(remaining * rate) : null;       // تكلفة المتبقي من المستهدف
    out.cost_remaining_total = rate !== null && total !== null ? round2(pos(total - used) * rate) : null;   // تكلفة المتبقي من الكلي
    out.saving = out.cost_now !== null && out.cost_after_target !== null ? round2(out.cost_now - out.cost_after_target) : null;
  }
  return out;
}

const SELECT = `SELECT e.id AS employee_id, e.emp_no, e.full_name, e.job_title, e.hire_date::text AS hire_date, e.status, e.org_unit_id, e.version,
    t.annual_balance::float8 AS annual_balance, t.total_balance::float8 AS total_balance, t.target_days::float8 AS target_days, t.used_days::float8 AS used_days,
    t.gross_salary::float8 AS gross_salary, t.notes, t.updated_by, t.updated_at
  FROM employees e LEFT JOIN leave_tracking t ON t.employee_id = e.id AND t.year = $1`;

async function unitPaths() {
  const units = (await q('SELECT id, name, unit_type, parent_id FROM org_units')).rows;
  const by = new Map(units.map(u => [u.id, u]));
  return id => {
    const p = { sector: null, department: null, section: null };
    for (let u = by.get(id); u; u = by.get(u.parent_id)) if (u.unit_type in p) p[u.unit_type] = u.name;
    return p;
  };
}

async function loadRows(req, year, { search = '', unit, status = 'active', incomplete = false, ids } = {}) {
  const sc = await resolveScope(req.user, 'hr', 'view');
  const fin = canSeeFinancials(req.user);
  const [policy, pathOf] = await Promise.all([loadPolicy(), unitPaths()]);
  const where = ['TRUE']; const p = [year];
  if (status && status !== 'all') { p.push(status); where.push(`e.status = $${p.length}`); }
  if (ids) { p.push(ids); where.push(`e.id = ANY($${p.length}::int[])`); }
  if (search) { p.push(`%${search}%`); where.push(`(e.full_name ILIKE $${p.length} OR e.emp_no ILIKE $${p.length} OR e.job_title ILIKE $${p.length})`); }
  if (unit) { p.push(+unit); where.push(`e.org_unit_id IN (WITH RECURSIVE t AS (SELECT id FROM org_units WHERE id = $${p.length} UNION ALL SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT id FROM t)`); }
  if (!sc.all) {
    const parts = [];
    if (sc.unitIds?.size) { p.push([...sc.unitIds]); parts.push(`e.org_unit_id = ANY($${p.length}::int[])`); }
    if (sc.employeeIds?.size) { p.push([...sc.employeeIds]); parts.push(`e.id = ANY($${p.length}::int[])`); }
    where.push(parts.length ? `(${parts.join(' OR ')})` : 'FALSE');
  }
  const rows = (await q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.full_name, e.id`, p)).rows;
  let out = rows.map(x => {
    const path = pathOf(x.org_unit_id);
    const base = { ...x, sector: path.sector, department: path.department, section: path.section };
    if (!fin) delete base.gross_salary;
    return { ...base, ...derive({ ...x, gross_salary: fin ? x.gross_salary : null }, policy, fin) };
  });
  if (incomplete) out = out.filter(x => !x.complete);
  return { rows: out, fin, policy };
}

function summarize(rows, fin) {
  const s = (k) => round2(rows.reduce((a, x) => a + (x[k] ?? 0), 0));
  const out = { employees: rows.length, complete: rows.filter(x => x.complete).length, incomplete: rows.filter(x => !x.complete).length,
    annual_balance: s('annual_balance'), total_balance: round2(rows.reduce((a, x) => a + Math.max(0, x.total_balance ?? 0), 0)), owed_days: s('owed_days'), owed_count: rows.filter(x => x.owed_days > 0).length,
    target_days: round2(rows.reduce((a, x) => a + Math.max(0, x.target_days ?? 0), 0)), used_days: s('used_days'),
    remaining_to_target: s('remaining_to_target'), remaining_total: s('remaining_total'), high_balance: rows.filter(x => x.high_balance).length, target_met: rows.filter(x => x.target_met).length };
  if (fin) Object.assign(out, { owed_cost: s('owed_cost'), cost_now: s('cost_now'), cost_target: s('cost_target'), cost_remaining_target: s('cost_remaining_target'), cost_remaining_total: s('cost_remaining_total'), cost_after_target: s('cost_after_target'), saving: s('saving') });
  return out;
}

const yearOf = req => { const y = +req.query.year || new Date().getFullYear(); if (!(y >= 2000 && y <= 2100)) throw httpError(400, 'سنة غير صالحة'); return y; };

r.get('/', wrap(async (req, res) => {
  const year = yearOf(req);
  const { rows: all, fin, policy } = await loadRows(req, year, { search: (req.query.search || '').trim(), unit: req.query.unit, status: req.query.status || 'active', incomplete: req.query.incomplete === '1' });
  const rows = applyFilter(all, normalizeFilter(req.query.f), filterContext(all, year, policy), fin);
  res.json({ year, fin, max_balance_cap: policy.max_balance_cap, can_edit: can(req.user, 'employees'), rows, summary: summarize(rows, fin) });
}));

// لوحة المؤشرات: نتائج وأداء وخطة وإحصاءات مجمّعة من بيانات المتابعة (للقراءة فقط)
// خيارات الفلاتر وعدّاداتها (الوحدات والمسميات والشرائح الذكية والنطاقات)
r.get('/facets', wrap(async (req, res) => {
  const year = yearOf(req);
  const { rows, fin, policy } = await loadRows(req, year, { unit: req.query.unit, status: req.query.status || 'active' });
  res.json({ year, fin, ...buildFacets(rows, filterContext(rows, year, policy), fin) });
}));

r.get('/indicators', wrap(async (req, res) => {
  const year = yearOf(req);
  const level = ['sector', 'department', 'section'].includes(req.query.level) ? req.query.level : 'sector';
  const base = { unit: req.query.unit, status: req.query.status || 'active' };
  const { rows: allRows, fin, policy } = await loadRows(req, year, base);
  const filter = normalizeFilter(req.query.f);
  const rows = applyFilter(allRows, filter, filterContext(allRows, year, policy), fin);
  const { elapsed, monthsLeft } = yearTiming(year);
  const R = x => round2(x ?? 0);
  const classify = e => classifyRow(e, elapsed);
  const groups = new Map();
  const dist = { achieved: 0, on_track: 0, lagging: 0, no_target: 0 };
  const bands = [['سالب', -Infinity, 0], ['0–10', 0, 10], ['10–20', 10, 20], ['20–30', 20, 30], ['30–45', 30, 45], ['45+', 45, Infinity]].map(([label, lo, hi]) => ({ label, lo, hi, count: 0 }));
  for (const e of rows) {
    const key = e[level] || (level === 'sector' ? 'بدون قطاع' : level === 'department' ? 'بدون إدارة' : 'بدون قسم');
    const g = groups.get(key) || { name: key, employees: 0, complete: 0, total_balance: 0, annual_balance: 0, target_days: 0, used_days: 0, remaining: 0, high_balance: 0, achieved: 0, remaining_total: 0, owed_days: 0, owed_count: 0, owed_cost: 0, cost_now: 0, cost_target: 0, cost_remaining_target: 0, cost_remaining_total: 0, cost_after_target: 0, saving: 0 };
    g.employees++; g.complete += e.complete ? 1 : 0; g.total_balance += Math.max(0, e.total_balance ?? 0); g.owed_days += e.owed_days; g.owed_count += e.owed_days > 0 ? 1 : 0; g.annual_balance += e.annual_balance ?? 0;
    g.target_days += Math.max(0, e.target_days ?? 0); g.used_days += e.used_days ?? 0; g.remaining += e.remaining_to_target ?? 0; g.high_balance += e.high_balance ? 1 : 0; g.achieved += e.target_met ? 1 : 0;
    g.remaining_total += e.remaining_total ?? 0;
    if (fin) { g.owed_cost += e.owed_cost ?? 0; g.cost_now += e.cost_now ?? 0; g.cost_target += e.cost_target ?? 0; g.cost_remaining_target += e.cost_remaining_target ?? 0; g.cost_remaining_total += e.cost_remaining_total ?? 0; g.cost_after_target += e.cost_after_target ?? 0; g.saving += e.saving ?? 0; }
    groups.set(key, g);
    dist[classify(e)]++;
    if (e.total_balance !== null) { const b = bands.find(x => e.total_balance >= x.lo && e.total_balance < x.hi); if (b) b.count++; }
  }
  const glist = [...groups.values()].map(g => ({ ...Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'number' ? R(v) : v])),
    achievement_pct: g.target_days > 0 ? Math.min(100, round2(g.used_days / g.target_days * 100)) : null,
    required_per_month: monthsLeft > 0 ? round2(g.remaining / monthsLeft) : null,
    expected_balance: round2(g.total_balance - g.remaining) })).sort((a, b) => (fin ? b.cost_now - a.cost_now : b.total_balance - a.total_balance));
  const S = k => R(rows.reduce((a, x) => a + (x[k] ?? 0), 0));
  const SP = k => R(rows.reduce((a, x) => a + Math.max(0, x[k] ?? 0), 0));   // الموجب فقط (السالب مستحق على الموظف ولا يخفض التزام الجهة)
  const kpis = { employees: rows.length, complete: rows.filter(x => x.complete).length, completion_pct: rows.length ? round2(rows.filter(x => x.complete).length / rows.length * 100) : 0,
    total_balance: SP('total_balance'), annual_balance: S('annual_balance'), avg_balance: rows.length ? round2(SP('total_balance') / rows.length) : 0, owed_days: S('owed_days'), owed_count: rows.filter(x => x.owed_days > 0).length, target_days: SP('target_days'), used_days: S('used_days'),
    remaining_to_target: S('remaining_to_target'), remaining_total: S('remaining_total'), achievement_pct: S('target_days') > 0 ? Math.min(100, round2(S('used_days') / S('target_days') * 100)) : null,
    high_balance: rows.filter(x => x.high_balance).length, required_per_month: monthsLeft > 0 ? round2(S('remaining_to_target') / monthsLeft) : null,
    ...(fin ? { owed_cost: S('owed_cost'), cost_now: S('cost_now'), cost_target: S('cost_target'), cost_remaining_target: S('cost_remaining_target'), cost_remaining_total: S('cost_remaining_total'), cost_after_target: S('cost_after_target'), saving: S('saving') } : {}) };
  const slim = e => ({ employee_id: e.employee_id, full_name: e.full_name, unit: [e.sector, e.department, e.section].filter(Boolean).join(' ‹ '), total_balance: e.total_balance, target_days: e.target_days, used_days: e.used_days,
    remaining_to_target: e.remaining_to_target, progress_pct: e.progress_pct, ...(fin ? { cost_now: e.cost_now } : {}) });
  const top = [...rows].filter(e => (fin ? e.cost_now : e.total_balance) > 0).sort((a, b) => (fin ? b.cost_now - a.cost_now : b.total_balance - a.total_balance)).slice(0, 10).map(slim);
  const lagging = rows.filter(e => classify(e) === 'lagging').sort((a, b) => (b.remaining_to_target ?? 0) - (a.remaining_to_target ?? 0)).slice(0, 10).map(slim);
  // الاتجاه عبر السنوات المتاحة (آخر 5)
  const years = (await q('SELECT DISTINCT year FROM leave_tracking ORDER BY year DESC LIMIT 5')).rows.map(x => x.year).sort();
  const yearly = [];
  for (const y of years) {
    const lr = await loadRows(req, y, base);
    const rr = applyFilter(lr.rows, filter, filterContext(lr.rows, y, lr.policy), fin);
    const sum = k => R(rr.reduce((a, x) => a + (x[k] ?? 0), 0));
    yearly.push({ year: y, total_balance: R(rr.reduce((a, x) => a + Math.max(0, x.total_balance ?? 0), 0)), target_days: R(rr.reduce((a, x) => a + Math.max(0, x.target_days ?? 0), 0)), used_days: sum('used_days'), ...(fin ? { cost_now: sum('cost_now') } : {}) });
  }
  // السنة السابقة بالمرشحات نفسها لعرض التغيّر
  let prev = null;
  if (year - 1 >= 2000) {
    const lr = await loadRows(req, year - 1, base);
    const pr = applyFilter(lr.rows, filter, filterContext(lr.rows, year - 1, lr.policy), fin);
    if (pr.some(x => x.total_balance !== null || x.used_days !== null || x.target_days !== null)) {
      const ps = k => R(pr.reduce((a, x) => a + (x[k] ?? 0), 0));
      prev = { year: year - 1, employees: pr.length, total_balance: R(pr.reduce((a, x) => a + Math.max(0, x.total_balance ?? 0), 0)), annual_balance: ps('annual_balance'), target_days: R(pr.reduce((a, x) => a + Math.max(0, x.target_days ?? 0), 0)), used_days: ps('used_days'),
        ...(fin ? { cost_now: ps('cost_now'), saving: ps('saving') } : {}) };
    }
  }
  const listed = [...rows].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar')).slice(0, 300).map(e => ({ ...slim(e), job_title: e.job_title, hire_date: e.hire_date, annual_balance: e.annual_balance,
    state: classify(e), complete: e.complete, ...(fin ? { gross_salary: e.gross_salary, saving: e.saving } : {}) }));
  res.json({ year, fin, level, matched: rows.length, base_total: allRows.length, filters_applied: filter, prev, employees: listed, elapsed_pct: round2(elapsed * 100), months_left: round2(monthsLeft), max_balance_cap: policy.max_balance_cap, kpis, groups: glist, distribution: dist,
    bands: bands.map(b => ({ label: b.label, count: b.count, lo: Number.isFinite(b.lo) ? b.lo : null, hi: Number.isFinite(b.hi) ? b.hi : null })), top, lagging, yearly });
}));

// تعديل حقول المتابعة لموظف وسنة (وتاريخ التعيين/الرقم الوظيفي في السجل المركزي)
r.put('/:employeeId', requirePerm('employees'), wrap(async (req, res) => {
  const id = +req.params.employeeId; const b = req.body || {};
  const year = +b.year || new Date().getFullYear();
  const fin = canSeeFinancials(req.user);
  const emp = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!emp) throw httpError(404, 'الموظف غير موجود');
  const sc = await resolveScope(req.user, 'hr', 'view');
  if (!sc.all && !(sc.unitIds?.has(emp.org_unit_id) || sc.employeeIds?.has(id))) throw httpError(404, 'الموظف غير موجود');

  const trackCols = {};
  if ('annual_balance' in b) trackCols.annual_balance = numOrNull(b.annual_balance, 'الرصيد السنوي');
  if ('total_balance' in b) trackCols.total_balance = numOrNull(b.total_balance, 'الرصيد الكلي', { min: null });
  if ('target_days' in b) trackCols.target_days = numOrNull(b.target_days, 'المستهدف', { min: null });
  if ('used_days' in b) trackCols.used_days = numOrNull(b.used_days, 'المستخدم', { min: null });
  if ('notes' in b) trackCols.notes = String(b.notes ?? '').trim().slice(0, 500) || null;
  if ('gross_salary' in b) {
    if (!fin) throw httpError(403, 'لا تملك صلاحية تعديل الراتب');
    trackCols.gross_salary = numOrNull(b.gross_salary, 'الراتب الإجمالي');
  }
  const empCols = {};
  if ('emp_no' in b) { const v = String(b.emp_no ?? '').trim(); if (!v) throw httpError(400, 'لا يمكن تفريغ الرقم الوظيفي'); empCols.emp_no = v; }
  if ('hire_date' in b) { const v = String(b.hire_date ?? '').trim(); if (!isDate(v)) throw httpError(400, 'تاريخ التعيين غير صالح'); empCols.hire_date = v; }

  const old = (await loadRows(req, year, { status: 'all', ids: [id] })).rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Object.keys(empCols).length) {
      const ks = Object.keys(empCols);
      await client.query(`UPDATE employees SET ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, [id, ...ks.map(k => empCols[k])]);
    }
    const ks = Object.keys(trackCols);
    if (ks.length) {
      await client.query(`INSERT INTO leave_tracking(employee_id, year, ${ks.join(', ')}, updated_by) VALUES ($1, $2, ${ks.map((_, i) => `$${i + 3}`).join(', ')}, $${ks.length + 3})
        ON CONFLICT (employee_id, year) DO UPDATE SET ${ks.map(k => `${k} = EXCLUDED.${k}`).join(', ')}, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, year, ...ks.map(k => trackCols[k]), req.user.username]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') throw httpError(409, 'الرقم الوظيفي مستخدم لموظف آخر');
    throw e;
  } finally { client.release(); }
  resetOrgGraph();
  const fresh = (await loadRows(req, year, { status: 'all', ids: [id] })).rows[0];
  await audit(req, 'update', 'leave_tracking', id, old, fresh);
  res.json({ row: fresh });
}));

// نسخ بيانات السنة السابقة (الراتب الإجمالي والرصيد السنوي) إلى سنة جديدة لمن ليس لهم صف فيها
r.post('/copy-year', requirePerm('employees'), wrap(async (req, res) => {
  const from = +req.body?.from, to = +req.body?.to;
  if (!(from >= 2000 && to >= 2000 && from !== to)) throw httpError(400, 'سنتان غير صالحتين');
  const sc = await resolveScope(req.user, 'hr', 'view');
  if (!sc.all) throw httpError(403, 'النسخ الجماعي لمن يملك نطاق كل المنشأة');
  const fin = canSeeFinancials(req.user);
  const { rowCount } = await q(`INSERT INTO leave_tracking(employee_id, year, annual_balance, gross_salary, updated_by)
    SELECT employee_id, $2, annual_balance, ${fin ? 'gross_salary' : 'NULL'}, $3 FROM leave_tracking WHERE year = $1
    ON CONFLICT (employee_id, year) DO NOTHING`, [from, to, req.user.username]);
  await audit(req, 'copy', 'leave_tracking', `${from}->${to}`, null, { copied: rowCount });
  res.json({ copied: rowCount });
}));

r.get('/export', wrap(async (req, res) => {
  const year = yearOf(req);
  const { rows: all, fin, policy: pol } = await loadRows(req, year, { search: (req.query.search || '').trim(), unit: req.query.unit, status: req.query.status || 'active', incomplete: req.query.incomplete === '1' });
  const rows = applyFilter(all, normalizeFilter(req.query.f), filterContext(all, year, pol), fin);
  const cols = [['الرقم الوظيفي', 'emp_no'], ['الاسم', 'full_name'], ['المسمى', 'job_title'], ['القطاع', 'sector'], ['الإدارة', 'department'], ['القسم', 'section'], ['تاريخ التعيين', 'hire_date'],
    ...(fin ? [['الراتب الإجمالي', 'gross_salary']] : []), ['الرصيد السنوي', 'annual_balance'], ['الرصيد الكلي', 'total_balance'], ['المستهدف', 'target_days'], ['المستخدم', 'used_days'], ['المتبقي للمستهدف', 'remaining_to_target'], ['المتبقي من الكلي', 'remaining_total'], ['مستحق على الموظف (يوم)', 'owed_days'],
    ...(fin ? [['أجر اليوم', 'day_rate'], ['تكلفة الإجازة الكلية', 'cost_now'], ['تكلفة المستهدف لنهاية السنة', 'cost_target'], ['تكلفة المتبقي من المستهدف', 'cost_remaining_target'], ['تكلفة المتبقي من الكلي', 'cost_remaining_total'], ['التكلفة بعد تحقق المستهدف', 'cost_after_target'], ['التوفير المتوقع', 'saving'], ['مبلغ مستحق على الموظف (ر.س)', 'owed_cost']] : []), ['ملاحظات', 'notes']];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`متابعة ${year}`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }] });
  ws.addRow([`متابعة أرصدة الإجازات — ${year}`]).font = { bold: true, size: 14 };
  const head = ws.addRow(cols.map(c => c[0]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  for (const x of rows) ws.addRow(cols.map(([, k]) => x[k] ?? ''));
  const sum = summarize(rows, fin);
  const tot = ws.addRow(cols.map(([, k]) => (k === 'full_name' ? 'الإجمالي' : sum[k] ?? '')));
  tot.font = { bold: true };
  ws.columns.forEach(c => { c.width = 18; });
  await audit(req, 'export', 'leave_tracking', year, null, { rows: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="leave-tracking-${year}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

export default r;
