// محرك الحسابات المركزي: جميع المؤشرات (الأرصدة، الاستحقاق، القيمة المالية) تُحسب من هنا فقط.
// دوال نقية بلا اعتماد على قاعدة البيانات لتسهيل الاختبار وإعادة الحساب التاريخي.

export const DEFAULT_POLICY = {
  accrual_method: 'daily',      // daily: استحقاق يومي تناسبي | upfront: كامل الاستحقاق السنوي في بداية السنة
  day_divisor: 30,              // قاسم أجر اليوم (30 = شهر، أو أي رقم تعتمده الجهة)
  day_basis: 'calendar',        // calendar: أيام تقويمية | working: أيام عمل
  weekend_days: [5, 6],         // الجمعة والسبت (0 = الأحد)
  entitlement_base: 21,
  entitlement_senior: 30,
  senior_after_years: 5,
  max_balance_cap: 30,          // الحد المعتمد لرصيد الموظف (للتنبيهات)
  max_carryover_days: null,     // الحد الأقصى للترحيل؛ null = بلا حد
  year_start_month: 1,          // بداية السنة المالية
  allow_partial_days: true,
  concentration_top_n: 5,
};

const DAY_MS = 86400000;
export const d2n = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
export const n2d = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (s, k) => n2d(d2n(s) + k);
export const diffDays = (a, b) => d2n(b) - d2n(a); // b - a
export const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

/** حدود السنة المالية التي تبدأ في سنة y */
export function fiscalYear(y, policy) {
  const m = String(policy.year_start_month || 1).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const nextStart = `${y + 1}-${m}-01`;
  return { year: y, start, end: addDays(nextStart, -1), days: diffDays(start, nextStart) };
}

/** السنة المالية التي يقع فيها التاريخ */
export function fiscalYearOf(date, policy) {
  const y = +date.slice(0, 4);
  let fy = fiscalYear(y, policy);
  if (date < fy.start) fy = fiscalYear(y - 1, policy);
  return fy;
}

export function entitlementDays(emp, policy, onDate) {
  if (emp.annual_entitlement_days !== null && emp.annual_entitlement_days !== undefined) {
    return emp.annual_entitlement_days;
  }
  const years = diffDays(emp.hire_date, onDate) / 365.25;
  return years >= policy.senior_after_years ? policy.entitlement_senior : policy.entitlement_base;
}

/** أول يوم يبدأ منه الاستحقاق (بعد تاريخ الرصيد الافتتاحي ، أو تاريخ التعيين إن كان لاحقاً) */
const accrualStart = emp => {
  const afterOpening = addDays(emp.opening_date, 1);
  return emp.hire_date > afterOpening ? emp.hire_date : afterOpening;
};
const accrualEnd = emp => emp.termination_date || '9999-12-31';

/** استحقاق قطعة واقعة داخل سنة مالية واحدة [a, b] */
function accrueSegment(emp, policy, fy, a, b) {
  const accEnd = accrualEnd(emp);
  const accStart = accrualStart(emp);
  const lo = a > accStart ? a : accStart;
  const hi = b < accEnd ? b : accEnd;
  const ent = entitlementDays(emp, policy, fy.start);
  if (policy.accrual_method === 'upfront') {
    // يُمنح الاستحقاق التناسبي كاملاً عند أول يوم أهلية في السنة، وتُحتسب القطعة التي تحوي ذلك اليوم
    const credit = accStart > fy.start ? accStart : fy.start;
    if (credit > accEnd || credit < a || credit > b) return 0;
    const eligibleEnd = accEnd < fy.end ? accEnd : fy.end;
    return ent * (diffDays(credit, eligibleEnd) + 1) / fy.days;
  }
  if (hi < lo) return 0;
  return ent * (diffDays(lo, hi) + 1) / fy.days;
}

const activeTx = t => t.status === 'approved';
function txEffect(t) {
  if (t.tx_type === 'adjustment') return t.days;
  return -t.days; // leave | settlement
}

/**
 * الرصيد في نهاية يوم `date` (شاملاً الحركات المعتمدة التي تبدأ حتى هذا التاريخ).
 * يعيد أيضاً تفاصيل الاستحقاق والترحيل لخدمة العرض.
 */
export function balanceAt(emp, txs, policy, date) {
  if (date < emp.opening_date) return { balance: 0, forfeited: 0, accrued: 0 };
  let bal = emp.opening_balance;
  let forfeited = 0;
  let accrued = 0;
  const sorted = txs.filter(activeTx).filter(t => t.start_date > emp.opening_date);
  let cursor = addDays(emp.opening_date, 1);
  while (cursor <= date) {
    const fy = fiscalYearOf(cursor, policy);
    const segEnd = fy.end < date ? fy.end : date;
    // ترحيل: إسقاط ما يزيد عن الحد في أول يوم من السنة المالية
    if (cursor === fy.start && policy.max_carryover_days !== null && policy.max_carryover_days !== undefined && bal > policy.max_carryover_days) {
      forfeited += bal - policy.max_carryover_days;
      bal = policy.max_carryover_days;
    }
    const acc = accrueSegment(emp, policy, fy, cursor, segEnd);
    accrued += acc;
    bal += acc;
    for (const t of sorted) {
      if (t.start_date >= cursor && t.start_date <= segEnd) bal += txEffect(t);
    }
    cursor = addDays(segEnd, 1);
  }
  return { balance: bal, forfeited, accrued };
}

/** الراتب المعتمد لاحتساب الإجازات في تاريخ معين */
export function leaveSalaryAt(emp, allowances, history, date) {
  if (history && history.length) {
    const h = [...history].filter(x => x.effective_date <= date).sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1))[0];
    if (h) return h.leave_salary;
  }
  if (emp.leave_salary_override !== null && emp.leave_salary_override !== undefined) return emp.leave_salary_override;
  const extra = (allowances || []).filter(a => a.include_in_leave).reduce((s, a) => s + a.amount, 0);
  return emp.basic_salary + extra;
}

export const dayRate = (leaveSalary, policy) => leaveSalary / (policy.day_divisor || 30);

/**
 * مؤشرات موظف واحد لسنة مالية محددة حتى تاريخ asOf.
 * القيم المالية تعتمد الرصيد الموجب فقط (الرصيد السالب يُعرض كتنبيه ولا يخفض الالتزام).
 */
export function computeEmployee(emp, txs, allowances, history, policy, year, asOf, period) {
  const fy = fiscalYear(year, policy);
  let cut = asOf || fy.end;
  if (cut > fy.end) cut = fy.end;
  if (cut < fy.start) cut = fy.start;

  const before = addDays(fy.start, -1);
  const startSnap = balanceAt(emp, txs, policy, before);
  let baseline = startSnap.balance;
  let carried = 0;
  if (emp.opening_date >= fy.start && emp.opening_date <= fy.end) {
    baseline = emp.opening_balance; // سنة الافتتاح
  } else if (emp.opening_date < fy.start) {
    carried = startSnap.balance;
    if (policy.max_carryover_days !== null && policy.max_carryover_days !== undefined && carried > policy.max_carryover_days) {
      carried = policy.max_carryover_days;
    }
    baseline = carried;
  }

  const now = balanceAt(emp, txs, policy, cut);
  const end = balanceAt(emp, txs, policy, fy.end);
  const accruedFull = end.accrued - (balanceAt(emp, txs, policy, before).accrued);
  const accruedToDate = now.accrued - startSnap.accrued;

  const inYear = txs.filter(t => t.start_date >= fy.start && t.start_date <= fy.end && t.start_date > emp.opening_date);
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0);
  const leaves = inYear.filter(t => activeTx(t) && t.tx_type === 'leave');
  const used = sum(leaves.filter(t => t.start_date <= cut), t => t.days);
  const scheduled = sum(leaves.filter(t => t.start_date > cut), t => t.days);
  const usedTotal = sum(txs.filter(t => activeTx(t) && t.tx_type === 'leave' && t.start_date > emp.opening_date && t.start_date <= cut), t => t.days);
  const settlements = sum(inYear.filter(t => activeTx(t) && t.tx_type === 'settlement' && t.start_date <= cut), t => t.days);
  const adjustments = sum(inYear.filter(t => activeTx(t) && t.tx_type === 'adjustment' && t.start_date <= cut), t => t.days);
  const pending = sum(inYear.filter(t => t.status === 'pending' && t.tx_type === 'leave'), t => t.days);
  let usedPeriod = used;
  if (period && period.from) {
    usedPeriod = sum(leaves.filter(t => t.start_date >= period.from && t.start_date <= (period.to || cut)), t => t.days);
  }

  const leaveSalary = leaveSalaryAt(emp, allowances, history, cut);
  const rate = dayRate(leaveSalary, policy);
  const availNow = now.balance;
  const projected = end.balance;
  const pos = x => (x > 0 ? x : 0);

  return {
    employee_id: emp.id,
    year,
    baseline: round2(baseline),
    opening_balance: round2(emp.opening_date >= fy.start && emp.opening_date <= fy.end ? emp.opening_balance : 0),
    carried: round2(carried),
    accrued_full_year: round2(accruedFull),
    accrued_to_date: round2(accruedToDate),
    used: round2(used),
    used_period: round2(usedPeriod),
    scheduled: round2(scheduled),
    recorded_year: round2(used + scheduled),
    used_total: round2(usedTotal),
    available_after_scheduled: round2(availNow - scheduled),
    pending: round2(pending),
    adjustments: round2(adjustments),
    settlements: round2(settlements),
    forfeited: round2(end.forfeited - startSnap.forfeited),
    available_now: round2(availNow),
    projected_year_end: round2(projected),
    leave_salary: round2(leaveSalary),
    day_rate: round2(rate),
    value_now: round2(pos(availNow) * rate),
    value_year_end: round2(pos(projected) * rate),
    negative_balance: availNow < 0,
  };
}

/** عدد أيام إجازة بين تاريخين وفق سياسة الجهة (تقويمية أو أيام عمل مع العطلات الرسمية) */
export function countLeaveDays(start, end, policy, holidaySet = new Set()) {
  if (end < start) return 0;
  if (policy.day_basis !== 'working') return diffDays(start, end) + 1;
  let n = 0;
  for (let d = d2n(start); d <= d2n(end); d++) {
    const dow = new Date(d * DAY_MS).getUTCDay();
    if (policy.weekend_days.includes(dow)) continue;
    if (holidaySet.has(n2d(d))) continue;
    n++;
  }
  return n;
}

/** هل تتداخل فترة جديدة مع إجازة موجودة (معتمدة أو معلقة) لنفس الموظف؟ */
export function overlaps(existing, start, end, ignoreId) {
  return existing.some(t =>
    t.tx_type === 'leave' && t.id !== ignoreId && (t.status === 'approved' || t.status === 'pending') &&
    t.start_date <= end && t.end_date >= start);
}
