import { q } from '../db/pool.js';
import { DEFAULT_POLICY, computeEmployee, fiscalYear, fiscalYearOf, diffDays } from './engine.js';
import { buildTree, resolveTargets, summarize } from './targets.js';
import { resolveScope, hasGrant } from './rbac.js';
import { httpError } from './util.js';

export const today = () => new Date().toISOString().slice(0, 10);

export async function loadPolicy() {
  const { rows } = await q('SELECT key, value FROM settings');
  const p = { ...DEFAULT_POLICY };
  for (const r of rows) if (r.key in DEFAULT_POLICY) p[r.key] = r.value;
  return p;
}

export async function loadHolidays() {
  const { rows } = await q('SELECT day FROM holidays');
  return new Set(rows.map(r => r.day));
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); }
  return m;
};

/**
 * يحمّل البيانات ويحسب مؤشرات كل موظف بالمحرك المركزي ثم يوزّع المستهدفات،
 * وبعدها يطبّق صلاحيات المستخدم ومرشحات الشاشة.
 */
export async function buildContext(user, opts = {}) {
  const policy = await loadPolicy();
  const todayStr = today();
  const year = opts.year ? +opts.year : fiscalYearOf(todayStr, policy).year;
  const fy = fiscalYear(year, policy);
  let asOf = opts.to || opts.asOf || (todayStr < fy.start ? fy.start : todayStr > fy.end ? fy.end : todayStr);
  if (asOf > fy.end) asOf = fy.end;
  const period = opts.from ? { from: opts.from, to: asOf } : null;

  const [units, emps, allow, hist, txs, targets] = await Promise.all([
    q('SELECT * FROM org_units WHERE active ORDER BY id'),
    q('SELECT * FROM employees WHERE leave_enabled'),    // موظفو نظام الإجازات فقط من السجل المركزي
    q('SELECT * FROM employee_allowances'),
    q('SELECT * FROM salary_history'),
    q("SELECT * FROM leave_transactions WHERE status IN ('pending','approved')"),
    q('SELECT * FROM targets WHERE year = $1', [year]),
  ]);
  const tree = buildTree(units.rows);
  const allowBy = groupBy(allow.rows, 'employee_id');
  const histBy = groupBy(hist.rows, 'employee_id');
  const txBy = groupBy(txs.rows, 'employee_id');

  // مسار الوحدة (قطاع/إدارة/قسم) لكل موظف
  const pathOf = unitId => {
    const names = { sector: null, department: null, section: null };
    const ids = { sector: null, department: null, section: null };
    let n = tree.byId.get(unitId);
    while (n) {
      if (n.unit_type in names) { names[n.unit_type] = n.name; ids[n.unit_type] = n.id; }
      n = n.parent_id ? tree.byId.get(n.parent_id) : null;
    }
    return { names, ids };
  };

  const elapsedPct = Math.max(0, Math.min(100, (diffDays(fy.start, asOf) + 1) / fy.days * 100));
  const all = emps.rows.map(e => {
    const m = computeEmployee(e, txBy.get(e.id) || [], allowBy.get(e.id) || [], histBy.get(e.id) || [], policy, year, asOf, period);
    const p = pathOf(e.org_unit_id);
    return { ...e, m, sector: p.names.sector, department: p.names.department, section: p.names.section, path_ids: p.ids };
  });

  // المستهدفات تُوزَّع على الموظفين النشطين (المعطَّلون والمنتهية خدمتهم مستبعدون) على مستوى المنشأة كلها لضمان الاتساق
  const live = all.filter(e => e.status === 'active');
  const { empTarget, unitInfo } = resolveTargets(tree, live, targets.rows);
  for (const e of all) {
    const t = empTarget.get(e.id);
    e.target_days = t ? t.days : null;
    e.target_source = t ? t.source : null;
    e.high_balance = e.m.available_now > policy.max_balance_cap;
  }

  // صلاحيات النطاق (من الصلاحيات المركزية hr:view) ثم المرشحات
  if (!hasGrant(user, 'hr', 'view')) throw httpError(403, 'لا تملك صلاحية عرض الأرصدة');
  const sc = await resolveScope(user, 'hr', 'view');
  const allowedUnits = sc.all ? null : (sc.unitIds ?? new Set());
  const allowedEmployees = sc.all ? null : sc.employeeIds;
  let list = all;
  if (!sc.all) list = list.filter(e => (sc.unitIds?.has(e.org_unit_id)) || (sc.employeeIds?.has(e.id)));
  const statusFilter = opts.status || 'live';
  if (statusFilter === 'live') list = list.filter(e => e.status === 'active');
  else if (statusFilter !== 'all') list = list.filter(e => e.status === statusFilter);
  if (opts.unit) {
    const n = tree.byId.get(+opts.unit);
    if (n) { const ids = new Set(); const walk = x => { ids.add(x.id); x.children.forEach(walk); }; walk(n); list = list.filter(e => ids.has(e.org_unit_id)); }
  }
  if (opts.employee) list = list.filter(e => e.id === +opts.employee);

  const raw = { allowBy, histBy, txBy };
  return { policy, year, fy, asOf, period, elapsedPct, tree, units: units.rows, all, list, targets: targets.rows, unitInfo, allowedUnits, allowedEmployees, scopeRoot: sc.rootId ?? null, txs: txs.rows, raw };
}

/** مؤشرات كل وحدة تنظيمية في الشجرة، مجمّعة من موظفي الفرع (ضمن القائمة المحددة) */
export function unitRollups(ctx, empList = ctx.list) {
  const by = new Map();
  for (const n of ctx.tree.byId.values()) by.set(n.id, []);
  for (const e of empList) {
    let n = ctx.tree.byId.get(e.org_unit_id);
    while (n) { by.get(n.id).push(e); n = n.parent_id ? ctx.tree.byId.get(n.parent_id) : null; }
  }
  const res = new Map();
  for (const [id, emps] of by) {
    const node = ctx.tree.byId.get(id);
    res.set(id, { id, name: node.name, code: node.code, unit_type: node.unit_type, parent_id: node.parent_id,
      ...summarize(emps, ctx.elapsedPct), stated: ctx.unitInfo.get(id) || null });
  }
  return res;
}

/** إعادة حساب مؤشرات موظف في تاريخ/سنة مختلفة (للاتجاهات والمقارنات) */
export function computeAt(ctx, e, year, asOf) {
  const { allowBy, histBy, txBy } = ctx.raw;
  return computeEmployee(e, txBy.get(e.id) || [], allowBy.get(e.id) || [], histBy.get(e.id) || [], ctx.policy, year, asOf, null);
}
