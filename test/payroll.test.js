// الرواتب والإضافي: معادلات الاحتساب، الصلاحيات، الرواتب، الإضافي والانتداب، التقرير، الإعدادات
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { DEFAULT_SETTINGS, grossOf, baseOf, dailyWage, hourlyWage, entryAmount, buildTree, groupRows } from '../public/payroll/calc.js';

test('معادلات الاحتساب', () => {
  const st = { ...DEFAULT_SETTINGS };
  const emp = { basic: 6000, housing: 1500, transport: 500, other: 0 };
  assert.equal(grossOf(emp), 8000);
  assert.equal(baseOf(emp, st), 8000);
  assert.equal(baseOf(emp, { ...st, salary_basis: 'basic' }), 6000);
  assert.equal(dailyWage(8000, st), 8000 / 30);
  assert.equal(hourlyWage(8000, st), 8000 / 240);
  // 3 ساعات × (8000/240) × 150% = 150
  assert.equal(entryAmount('overtime', 3, 150, 8000, st).amount, 150);
  // يومان × (8000/30) × 150% = 800
  assert.equal(entryAmount('assignment', 2, 150, 8000, st).amount, 800);
});

test('التجميع والشجرة', () => {
  const rows = [
    { employee_id: 1, full_name: 'أ', sector: 'ق1', department: 'د1', section: 's1', gross: 100, overtime_hours: 1, overtime_amount: 10, assignment_days: 0, assignment_amount: 0, total: 110 },
    { employee_id: 2, full_name: 'ب', sector: 'ق1', department: 'د1', section: 's2', gross: 200, overtime_hours: 0, overtime_amount: 0, assignment_days: 1, assignment_amount: 20, total: 220 },
  ];
  const g = groupRows(rows, 'department');
  assert.equal(g.length, 1); assert.equal(g[0].salaries, 300); assert.equal(g[0].total, 330);
  const tree = buildTree(rows);
  assert.equal(tree.salaries, 300);
});

const t = await bootApp('payroll');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let admin, fin, plain, empId;

test('إعداد', { skip }, async () => {
  await t.mkUser('root', ['admin']); await t.mkUser('fin1', ['finance']); await t.mkUser('emp1', ['employee']);
  admin = await t.as('root'); fin = await t.as('fin1'); plain = await t.as('emp1');
  const r = await admin.post('/api/tracking/staff', { full_name: 'سارة الاختبار', emp_no: 'P100', org_unit_id: t.root });
  assert.equal(r.status, 201); empId = r.json.row.employee_id;
});

test('الصلاحيات', { skip }, async () => {
  assert.equal((await plain.get('/api/payroll/meta')).status, 403);
  const m = await fin.get('/api/payroll/meta');
  assert.equal(m.status, 200); assert.equal(m.json.can.settings, true);
});

test('الرواتب والإضافي والانتداب والتقرير', { skip }, async () => {
  // الاحتساب التلقائي (الافتراضي): سكن 25% ونقل 10% من الأساسي
  let r = await fin.put('/api/payroll/salaries/' + empId, { basic: '6000', housing: '1', transport: '1', other: 0 });
  assert.equal(r.status, 200); assert.equal(r.json.row.housing, 1500); assert.equal(r.json.row.transport, 600); assert.equal(r.json.row.gross, 8100);
  // يدوي: تُستخدم القيم المخزّنة
  r = await fin.put('/api/payroll/settings', { ...DEFAULT_SETTINGS, allowances_auto: false });
  assert.equal(r.status, 200);
  r = await fin.put('/api/payroll/salaries/' + empId, { basic: '6000', housing: '1500', transport: '500', other: 0 });
  assert.equal(r.json.row.gross, 8000);
  r = await fin.put('/api/payroll/settings', { ...DEFAULT_SETTINGS, allowances_auto: false, housing_percent: 150 });
  assert.equal(r.status, 400);
  r = await fin.put('/api/payroll/salaries/' + empId, { basic: '-5' });
  assert.equal(r.status, 400);
  r = await fin.post('/api/payroll/entries', { kind: 'overtime', employee_id: empId, entry_date: '2026-11-05', pay_month: '2026-11', type_id: 'ot-workday', quantity: '3' });
  assert.equal(r.status, 201); assert.equal(r.json.row.amount, 150);
  r = await fin.post('/api/payroll/entries', { kind: 'assignment', employee_id: empId, entry_date: '2026-11-06', pay_month: '2026-11', type_id: 'as-outside', quantity: '2' });
  assert.equal(r.status, 201); assert.equal(r.json.row.amount, 800);
  r = await fin.post('/api/payroll/entries', { kind: 'overtime', employee_id: empId, entry_date: '2026-11-05', pay_month: '2026-11', type_id: 'nope', quantity: '1' });
  assert.equal(r.status, 400);
  const rep = (await fin.get('/api/payroll/report?month=2026-11')).json;
  assert.equal(rep.totals.overtime_amount, 150); assert.equal(rep.totals.assignment_amount, 800); assert.equal(rep.totals.salaries, 8000); assert.equal(rep.totals.total, 8950);
  const x = await fin.get('/api/payroll/export?month=2026-11'); assert.equal(x.status, 200);
});

test('الإعدادات تتحقق وتؤثر على الحساب', { skip }, async () => {
  let r = await fin.put('/api/payroll/settings', { ...DEFAULT_SETTINGS, days_per_month: 0 });
  assert.equal(r.status, 400);
  r = await fin.put('/api/payroll/settings', { ...DEFAULT_SETTINGS, overtime_types: [{ id: 'ot-workday', name: 'عادي', percent: 200 }] });
  assert.equal(r.status, 200);
  r = await fin.post('/api/payroll/entries', { kind: 'overtime', employee_id: empId, entry_date: '2026-11-07', pay_month: '2026-12', type_id: 'ot-workday', quantity: '3' });
  assert.equal(r.json.row.amount, 202.5);   // الإجمالي 8100 (تلقائي) → 3 × 33.75 × 2
});
