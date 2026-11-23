// إدارة الموظفين (بوابة الموارد البشرية): الصلاحيات، الإضافة والتعديل، الحقول الحساسة، الأرشفة والحذف، والتكامل مع النماذج
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';

const t = await bootApp('hremp');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let hr, fin, emp, id;

test('إعداد', { skip }, async () => {
  await t.mkUser('hre1', ['hr']); await t.mkUser('fin3', ['finance']); await t.mkUser('emp3', ['employee']);
  hr = await t.as('hre1'); fin = await t.as('fin3'); emp = await t.as('emp3');
});

test('الصلاحيات: الموارد البشرية تدير، المالية تعرض فقط، والموظف العادي ممنوع', { skip }, async () => {
  assert.equal((await emp.get('/api/hr-employees/meta')).status, 403);
  assert.deepEqual((await hr.get('/api/hr-employees/meta')).json.can, { view: true, edit: true, archive: true, delete: false, sensitive: true, structure: true });
  assert.deepEqual((await fin.get('/api/hr-employees/meta')).json.can, { view: true, edit: false, archive: false, delete: false, sensitive: false, structure: false });
  assert.equal((await fin.post('/api/hr-employees', { full_name: 'ممنوع' })).status, 403);
});

test('إضافة وتعديل وتحقق الحقول', { skip }, async () => {
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'س' })).status, 400);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'خالد الاختبار', national_id: '123' })).status, 400);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'خالد الاختبار', iban: 'XX12' })).status, 400);
  let r;
  r = await hr.post('/api/hr-employees', { full_name: 'خالد الاختبار', emp_no: 'E900', job_title: 'محاسب', org_unit_id: t.root, hire_date: '2020-01-15', nationality: 'سعودي', national_id: '١٠٢٣٤٥٦٧٨٩', phone: '0501234567', iban: 'sa03 8000 0000 6080 1016 7519' });
  assert.equal(r.status, 201); id = r.json.row.id;
  assert.equal(r.json.row.national_id, '1023456789'); assert.equal(r.json.row.iban, 'SA0380000000608010167519'); assert.deepEqual(r.json.row.lacking, []);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'مكرر', emp_no: 'E900' })).status, 409);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'مكرر', national_id: '1023456789' })).status, 409);
  r = await hr.put('/api/hr-employees/' + id, { job_title: 'رئيس حسابات', version: 1 });
  assert.equal(r.status, 200); assert.equal(r.json.row.job_title, 'رئيس حسابات'); assert.equal(r.json.row.version, 2);
  assert.equal((await hr.put('/api/hr-employees/' + id, { job_title: 'قديم', version: 1 })).status, 409);   // نسخة قديمة
});

test('الحقول الحساسة: مخفية عن غير المخوّلين ولا تظهر في سجل التدقيق', { skip }, async () => {
  const seen = (await fin.get('/api/hr-employees?q=خالد')).json.rows[0];
  assert.match(seen.national_id, /^••••••\d{4}$/); assert.equal(seen.masked, true); assert.ok(!JSON.stringify(seen).includes('1023456789'));
  assert.equal((await fin.get('/api/hr-employees/export')).status, 200);
  const log = await t.q("SELECT before, after FROM audit_logs WHERE entity = 'leave_staff' ORDER BY id DESC LIMIT 5");
  assert.ok(!JSON.stringify(log.rows).includes('1023456789') && !JSON.stringify(log.rows).includes('SA0380000000608010167519'));
});

test('نماذج الموارد البشرية تأخذ بيانات الموظف المسجلة', { skip }, async () => {
  const e = (await hr.get('/api/hr-forms/employees?id=' + id)).json.employees[0];
  assert.equal(e.hire_date, '2020-01-15'); assert.equal(e.nationality, 'سعودي'); assert.equal(e.national_id, '1023456789'); assert.equal(e.iban, 'SA0380000000608010167519');
});

test('الأرشفة والحذف: الأرشفة تُخفيه من النشطين، والحذف مرفوض إن كانت له بيانات مرتبطة', { skip }, async () => {
  assert.equal((await fin.post(`/api/hr-employees/${id}/archive`)).status, 403);
  assert.equal((await hr.post(`/api/hr-employees/${id}/archive`)).json.row.status, 'archived');
  assert.equal((await hr.get('/api/hr-employees')).json.rows.some(x => x.id === id), false);
  assert.equal((await hr.get('/api/hr-employees?status=archived')).json.rows.some(x => x.id === id), true);
  assert.equal((await hr.post(`/api/hr-employees/${id}/restore`)).json.row.status, 'active');
  await t.q("INSERT INTO payroll_salaries(employee_id, basic) VALUES ($1, 5000)", [id]);
  const root = await t.as('root2').catch(async () => { await t.mkUser('root2', ['admin']); return t.as('root2'); });
  assert.equal((await root.del('/api/hr-employees/' + id)).status, 409);
  await t.q('DELETE FROM payroll_salaries WHERE employee_id = $1', [id]);
  assert.equal((await root.del('/api/hr-employees/' + id)).status, 200);
});
