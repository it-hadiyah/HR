// تقارير مبيعات: وحدة ثابتة محمية بصلاحية access (التنفيذي والمالية افتراضياً)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';

const t = await bootApp('salesrep');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });

test('الصفحة والمكتبة محميتان وتفتحان لمن يملك الصلاحية', { skip }, async () => {
  await t.mkUser('fin1', ['finance']); await t.mkUser('emp1', ['employee']);
  const fin = await t.as('fin1'), emp = await t.as('emp1'), anon = t.client();
  const page = await fin.get('/sales-reports/');
  assert.equal(page.status, 200); assert.match(page.text, /تقارير مبيعات/); assert.match(page.text, /\/sales-reports\/app\.js/);
  assert.equal((await fin.get('/sales-reports/app.js')).status, 200);
  assert.equal((await fin.get('/sales-reports/vendor/xlsx.full.min.js')).status, 200);
  assert.ok(!/<script>[^<]/.test(page.text), 'لا سكربت مضمّن بسبب CSP الصارمة');
  assert.notEqual((await emp.get('/sales-reports/')).status, 200);
  assert.notEqual((await anon.get('/sales-reports/')).status, 200);
});

test('بوابة الموارد البشرية: تظهر لمن يملك أحد أنظمتها وتخفي الأنظمة المفردة من القائمة الرئيسية', { skip }, async () => {
  await t.mkUser('hrp1', ['hr']); await t.mkUser('fin2', ['finance']); await t.mkUser('emp2', ['employee']);
  const hr = await t.as('hrp1'), emp = await t.as('emp2');
  const l = (await hr.get('/api/launcher')).json.apps.map(a => a.slug);
  assert.ok(l.includes('hr-portal')); assert.ok(!l.includes('hr') && !l.includes('hr-forms') && !l.includes('payroll'));
  const sec = (await hr.get('/api/hr-portal/sections')).json.sections.map(s => s.slug);
  assert.deepEqual(sec, ['hr-employees', 'hr', 'hr-forms', 'payroll']);
  assert.equal((await hr.get('/hr-portal/')).status, 200);
  assert.equal((await hr.get('/hr-forms/')).status, 200);                       // الرابط المباشر يعمل
  const e = (await emp.get('/api/launcher')).json.apps.map(a => a.slug);
  assert.ok(!e.includes('hr-portal'));
  assert.equal((await emp.get('/hr-portal/')).status, 403);
  assert.deepEqual((await emp.get('/api/hr-portal/sections')).json.sections, []);
});
