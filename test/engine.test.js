import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, balanceAt, computeEmployee, countLeaveDays, overlaps, fiscalYear } from '../server/lib/engine.js';
import { buildTree, resolveTargets, summarize } from '../server/lib/targets.js';

const policy = { ...DEFAULT_POLICY };
const emp = (o = {}) => ({
  id: 1, org_unit_id: 4, hire_date: '2020-01-01', termination_date: null, basic_salary: 9000,
  leave_salary_override: null, annual_entitlement_days: 30, opening_balance: 45, opening_date: '2025-12-31', status: 'active', ...o,
});
const leave = (start, end, days, status = 'approved', type = 'leave') => ({ id: Math.random(), employee_id: 1, tx_type: type, start_date: start, end_date: end, days, status });

test('الاستحقاق اليومي: سنة كاملة تضيف الاستحقاق السنوي كاملاً', () => {
  const r = balanceAt(emp(), [], policy, '2026-12-31');
  assert.ok(Math.abs(r.balance - 75) < 1e-9, `got ${r.balance}`);
});

test('الإجازات المعتمدة تخصم، والمعلقة لا تخصم', () => {
  const txs = [leave('2026-03-01', '2026-03-10', 10), leave('2026-04-01', '2026-04-05', 5, 'pending')];
  const r = balanceAt(emp(), txs, policy, '2026-12-31');
  assert.ok(Math.abs(r.balance - 65) < 1e-9);
});

test('مؤشرات الموظف: المتاح الآن والمتوقع آخر السنة والمجدول', () => {
  const txs = [leave('2026-02-01', '2026-02-10', 10), leave('2026-11-01', '2026-11-05', 5)];
  const m = computeEmployee(emp(), txs, [], [], policy, 2026, '2026-06-30');
  assert.equal(m.used, 10);
  assert.equal(m.scheduled, 5);
  assert.equal(m.baseline, 45);
  assert.equal(m.projected_year_end, 60);
  assert.ok(m.available_now > 45 && m.available_now < 60);
});

test('القيمة المالية = الرصيد × (الراتب المعتمد ÷ القاسم)', () => {
  const m = computeEmployee(emp({ opening_balance: 20, annual_entitlement_days: 0 }), [], [{ include_in_leave: true, amount: 3000 }, { include_in_leave: false, amount: 999 }], [], policy, 2026, '2026-06-30');
  assert.equal(m.leave_salary, 12000);
  assert.equal(m.day_rate, 400);
  assert.equal(m.value_now, 8000);
});

test('الرصيد السالب لا يخفض الالتزام المالي', () => {
  const m = computeEmployee(emp({ opening_balance: 0, annual_entitlement_days: 0 }), [leave('2026-02-01', '2026-02-05', 5)], [], [], policy, 2026, '2026-06-30');
  assert.equal(m.available_now, -5);
  assert.equal(m.value_now, 0);
  assert.equal(m.negative_balance, true);
});

test('الموظف المعيّن خلال السنة يستحق بالتناسب من تاريخ التعيين', () => {
  const e = emp({ hire_date: '2026-07-01', opening_balance: 0, opening_date: '2025-12-31', annual_entitlement_days: 30 });
  const r = balanceAt(e, [], policy, '2026-12-31');
  assert.ok(Math.abs(r.balance - 30 * 184 / 365) < 1e-6);
});

test('نهاية الخدمة توقف الاستحقاق', () => {
  const e = emp({ opening_balance: 0, termination_date: '2026-06-30' });
  const r = balanceAt(e, [], policy, '2026-12-31');
  assert.ok(Math.abs(r.accrued - 30 * 181 / 365) < 1e-6);
});

test('حد الترحيل يُسقط الزائد في بداية السنة التالية', () => {
  const p = { ...policy, max_carryover_days: 10 };
  const r = balanceAt(emp({ annual_entitlement_days: 0 }), [], p, '2027-01-01');
  assert.equal(r.balance, 10);
  assert.equal(r.forfeited, 35);
});

test('الاستحقاق الكامل المقدّم يُمنح أول السنة', () => {
  const p = { ...policy, accrual_method: 'upfront' };
  const r = balanceAt(emp({ opening_balance: 0 }), [], p, '2026-01-01');
  assert.ok(Math.abs(r.balance - 30) < 1e-9);
});

test('سياسة الاستحقاق حسب سنوات الخدمة عند غياب قيمة مخصصة', () => {
  const junior = computeEmployee(emp({ annual_entitlement_days: null, hire_date: '2024-01-01', opening_balance: 0 }), [], [], [], policy, 2026, '2026-12-31');
  const senior = computeEmployee(emp({ annual_entitlement_days: null, hire_date: '2015-01-01', opening_balance: 0 }), [], [], [], policy, 2026, '2026-12-31');
  assert.equal(junior.accrued_full_year, 21);
  assert.equal(senior.accrued_full_year, 30);
});

test('أيام العمل تستثني نهاية الأسبوع والعطل الرسمية', () => {
  const p = { ...policy, day_basis: 'working' };
  // الأحد 2026-03-01 إلى السبت 2026-03-07 (الجمعة والسبت عطلة)
  assert.equal(countLeaveDays('2026-03-01', '2026-03-07', p), 5);
  assert.equal(countLeaveDays('2026-03-01', '2026-03-07', p, new Set(['2026-03-02'])), 4);
  assert.equal(countLeaveDays('2026-03-01', '2026-03-07', policy), 7);
});

test('منع تداخل الإجازات', () => {
  const ex = [{ id: 1, tx_type: 'leave', status: 'approved', start_date: '2026-03-10', end_date: '2026-03-15' }];
  assert.equal(overlaps(ex, '2026-03-15', '2026-03-20'), true);
  assert.equal(overlaps(ex, '2026-03-16', '2026-03-20'), false);
  assert.equal(overlaps(ex, '2026-03-10', '2026-03-12', 1), false);
});

test('السنة المالية غير التقويمية', () => {
  const fy = fiscalYear(2026, { ...policy, year_start_month: 7 });
  assert.equal(fy.start, '2026-07-01');
  assert.equal(fy.end, '2027-06-30');
});

// ---- المستهدفات ----
function mkEmp(id, unit, baseline, projected, rate = 100) {
  return { id, org_unit_id: unit, m: { baseline, projected_year_end: projected, available_now: projected, accrued_full_year: 0, day_rate: rate,
    used: 0, used_period: 0, scheduled: 0, pending: 0, value_now: projected * rate, value_year_end: projected * rate } };
}
const units = [
  { id: 1, parent_id: null, unit_type: 'org', name: 'org' },
  { id: 2, parent_id: 1, unit_type: 'sector', name: 's' },
  { id: 3, parent_id: 2, unit_type: 'department', name: 'd1' },
  { id: 4, parent_id: 2, unit_type: 'department', name: 'd2' },
];

test('توزيع مستهدف القطاع على الموظفين لا يضاعف الإجمالي', () => {
  const emps = [mkEmp(1, 3, 40, 40), mkEmp(2, 3, 40, 40), mkEmp(3, 4, 40, 40), mkEmp(4, 4, 40, 40)];
  const tree = buildTree(units);
  const { empTarget } = resolveTargets(tree, emps, [{ scope_type: 'unit', scope_id: 2, target_type: 'max_year_end_balance', value: 80 }]);
  const total = [...empTarget.values()].reduce((s, t) => s + t.days, 0);
  assert.equal(total, 80);
  assert.equal(empTarget.get(1).days, 20);
});

test('المستهدف الصريح للإدارة يُخصم من حصة بقية القطاع، والتعارض يُسجَّل', () => {
  const emps = [mkEmp(1, 3, 40, 40), mkEmp(2, 3, 40, 40), mkEmp(3, 4, 40, 40), mkEmp(4, 4, 40, 40)];
  const tree = buildTree(units);
  const t = [
    { scope_type: 'unit', scope_id: 2, target_type: 'max_year_end_balance', value: 100 },
    { scope_type: 'unit', scope_id: 3, target_type: 'max_year_end_balance', value: 60 },
  ];
  const { empTarget } = resolveTargets(tree, emps, t);
  assert.equal(empTarget.get(1).days + empTarget.get(2).days, 60);
  assert.equal(empTarget.get(3).days + empTarget.get(4).days, 40);

  const tree2 = buildTree(units);
  const { unitInfo } = resolveTargets(tree2, emps, [
    { scope_type: 'unit', scope_id: 2, target_type: 'max_year_end_balance', value: 50 },
    { scope_type: 'unit', scope_id: 3, target_type: 'max_year_end_balance', value: 60 },
  ]);
  assert.equal(unitInfo.get(2).conflict_days, 10);
});

test('أنواع المستهدفات: خفض بنسبة وتقليل أيام', () => {
  const emps = [mkEmp(1, 3, 45, 45)];
  const tree = buildTree(units);
  const { empTarget } = resolveTargets(tree, emps, [{ scope_type: 'employee', scope_id: 1, target_type: 'reduction_pct', value: 20 }]);
  assert.equal(empTarget.get(1).days, 36);
});

test('تحقق المستهدف ونسبة الإنجاز: مثال المستند (45 → 20)', () => {
  const e = mkEmp(1, 3, 45, 45); e.target_days = 20;
  let s = summarize([e], 50);
  assert.equal(s.reduction_needed, 25);
  assert.equal(s.achievement, 0);
  const e2 = mkEmp(1, 3, 45, 32.5); e2.target_days = 20;
  s = summarize([e2], 50);
  assert.equal(s.achievement, 50);
  const e3 = mkEmp(1, 3, 45, 20); e3.target_days = 20;
  s = summarize([e3], 50);
  assert.equal(s.target_status, 'achieved');
  assert.equal(s.achievement, 100);
});
