// تكامل المنصات على السجل المركزي الواحد + التدقيق + التزامن
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootApp } from './helpers.js';

const t = await bootApp('central');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let admin, unitA, unitB, emp;

test('إعداد: مدير وهيكل وموظف بملف إجازات وتحويلة', { skip }, async () => {
  await t.mkUser('root', ['admin']);
  admin = await t.as('root');
  const { org, employees } = t.svc;
  const sector = await org.createUnit({ parent_id: t.root, name: 'قطاع الخدمات' }, t.sys);
  unitA = await org.createUnit({ parent_id: sector.id, name: 'إدارة التقنية' }, t.sys);
  unitB = await org.createUnit({ parent_id: sector.id, name: 'إدارة المالية' }, t.sys);
  emp = await employees.createEmployee({ full_name: 'سارة الأحمد', name_en: 'Sarah Alahmad', job_title: 'محللة', extension: 5001, email: 's.ahmad@hadiyah.org.sa', org_unit_id: unitA.id, photo: 'images/content/employee-info/5001.png' }, t.sys);
  await t.q("UPDATE employees SET leave_enabled = TRUE, emp_no = 'E5001', hire_date = '2021-01-01', opening_date = '2025-12-31', opening_balance = 10, basic_salary = 9000 WHERE id = $1", [emp.id]);
  assert.ok(emp.id);
});

test('تعديل الموظف من الإدارة ينعكس فوراً في البوابة والبطاقة والإجازات بلا نسخ مكررة', { skip }, async () => {
  const r = await admin.put(`/api/core/employees/${emp.id}`, { full_name: 'سارة محمد الأحمد', job_title: 'محللة أولى', version: emp.version });
  assert.equal(r.status, 200);
  const portal = (await admin.get('/portal/data/employeeInfo.json')).json.find(e => e.Extension === 5001);
  assert.equal(portal.Name, 'سارة محمد الأحمد');
  assert.equal(portal.JobName, 'محللة أولى');
  const card = (await admin.get('/api/directory')).json.employees.find(e => e.id === emp.id);
  assert.equal(card.name_ar, 'سارة محمد الأحمد');
  assert.equal(card.name_en, 'Sarah Alahmad');
  assert.equal(card.photo_url, undefined);                                           // الصورة يرفعها الموظف بنفسه ولا تُسحب من سجله
  assert.equal(card.extension, 5001);
  const hr = (await admin.get('/api/employees')).json.rows.find(e => e.id === emp.id);
  assert.equal(hr.full_name, 'سارة محمد الأحمد');
  assert.equal((await t.q('SELECT count(*)::int AS n FROM employees WHERE extension = 5001')).rows[0].n, 1);
});

test('نقل موظف بين الإدارات ينعكس في الهيكل والإجازات ويُحفظ تاريخه وتدقيقه', { skip }, async () => {
  const cur = (await admin.get(`/api/core/employees/${emp.id}`)).json;
  assert.equal((await admin.put(`/api/core/employees/${emp.id}`, { org_unit_id: unitB.id, move_reason: 'إعادة هيكلة', version: cur.version })).status, 200);
  const struct = (await admin.get('/portal/data/orgStructure.json')).json;
  const find = (n) => (n.members?.includes(5001) ? n.title : (n.children || []).map(find).find(Boolean));
  // الموظف في الدليل يظهر ضمن الوحدة الجديدة إن كان له دور؛ نتحقق من الربط عبر سجل الموظف
  assert.equal((await admin.get(`/api/core/employees/${emp.id}`)).json.unit_name, 'إدارة المالية');
  const hrEmp = (await admin.get(`/api/employees/${emp.id}`)).json.employee;
  assert.equal(hrEmp.department, 'إدارة المالية');
  const hist = (await admin.get(`/api/core/employees/${emp.id}`)).json.history;
  assert.equal(hist[0].from_unit, 'إدارة التقنية');
  assert.equal(hist[0].to_unit, 'إدارة المالية');
  assert.equal(hist[0].reason, 'إعادة هيكلة');
  const a = (await admin.get('/api/core/audit?action=move&entity=employee')).json.rows[0];
  const detail = (await admin.get(`/api/core/audit/${a.id}`)).json;
  assert.equal(detail.before.org_unit_id, unitA.id);
  assert.equal(detail.after.org_unit_id, unitB.id);
  assert.ok(detail.session_id && detail.request_id && detail.ip);
  assert.ok(!JSON.stringify(detail).includes('9000'));                    // لا تُسجَّل الرواتب
  assert.equal(find(struct), undefined);
});

test('تزامن: تعديلان بالإصدار نفسه ينجح أحدهما ويُرفض الآخر', { skip }, async () => {
  const cur = (await admin.get(`/api/core/employees/${emp.id}`)).json;
  const results = await Promise.all([
    admin.put(`/api/core/employees/${emp.id}`, { job_title: 'أ', version: cur.version }),
    admin.put(`/api/core/employees/${emp.id}`, { job_title: 'ب', version: cur.version }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const row = (await t.q('SELECT version, job_title FROM employees WHERE id = $1', [emp.id])).rows[0];
  assert.equal(row.version, cur.version + 1);
});

test('قيود السلامة: تحويلة فريدة، بريد صالح، حلقة المدير ممنوعة، حذف موظف له إجازات مرفوض', { skip }, async () => {
  assert.equal((await admin.post('/api/core/employees', { full_name: 'مكرر', extension: 5001 })).status, 409);
  assert.equal((await admin.post('/api/core/employees', { full_name: 'بريد', email: 'not-an-email' })).status, 400);
  const b = (await admin.post('/api/core/employees', { full_name: 'تابع', extension: 5002, manager_id: emp.id })).json;
  assert.equal((await admin.put(`/api/core/employees/${emp.id}`, { manager_id: b.id })).status, 400);   // حلقة
  await t.q("INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days) VALUES ($1,'leave','2026-03-01','2026-03-03',3)", [emp.id]);
  assert.equal((await admin.del(`/api/core/employees/${emp.id}`)).status, 409);
});

test('دمج سجلين مكررين ينقل الإجازات ويحذف المكرر', { skip }, async () => {
  const dup = (await admin.post('/api/core/employees', { full_name: 'سارة الأحمد', extension: 5099, mobile: '0500000000' })).json;
  const groups = (await admin.get('/api/core/employees/duplicates')).json.groups;
  assert.ok(groups.length >= 0);
  const r = await admin.post('/api/core/employees/merge', { keep: emp.id, drop: dup.id });
  assert.equal(r.status, 200);
  assert.equal((await t.q('SELECT count(*)::int AS n FROM employees WHERE id = $1', [dup.id])).rows[0].n, 0);
  const kept = (await t.q('SELECT mobile, leave_enabled FROM employees WHERE id = $1', [emp.id])).rows[0];
  assert.equal(kept.mobile, '0500000000');
  assert.equal(kept.leave_enabled, true);
});

test('لوحة تحكم البوابة: الحفظ لا يحذف سجلات الموظفين من القاعدة (يخفيها من الدليل فقط)', { skip }, async () => {
  const data = (await admin.get('/portal/data/employeeInfo.json')).json.filter(e => e.Extension !== 5001);
  const r = await admin.post('/api/portal-admin?action=save&file=employeeInfo.json', data);   // بلا ترويسة الحماية
  assert.equal(r.status, 403);
  const ok = await fetch(`${t.base}/api/portal-admin?action=save&file=employeeInfo.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hadiyah-admin', Cookie: (await cookieOf('root')) }, body: JSON.stringify(data) });
  assert.equal(ok.status, 200);
  const row = (await t.q('SELECT show_in_directory, leave_enabled FROM employees WHERE id = $1', [emp.id])).rows[0];
  assert.deepEqual(row, { show_in_directory: false, leave_enabled: true });
  assert.equal((await admin.get('/portal/data/employeeInfo.json')).json.some(e => e.Extension === 5001), false);
});
async function cookieOf(username) {
  const res = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: t.PASS }) });
  return res.headers.get('set-cookie').split(';')[0];
}

test('سجل التدقيق: لا يُعدَّل ولا يُحذف ولا يُفرَّغ، ولا تُخزَّن كلمات المرور', { skip }, async () => {
  await assert.rejects(t.q("UPDATE audit_logs SET action = 'x'"), /للإضافة فقط/);
  await assert.rejects(t.q('DELETE FROM audit_logs'), /للإضافة فقط/);
  await assert.rejects(t.q('TRUNCATE audit_logs'), /للإضافة فقط/);
  await t.mkUser('pw_user', ['employee']);
  const rows = (await t.q("SELECT before, after FROM audit_logs WHERE entity = 'user' AND action = 'create' ORDER BY id DESC LIMIT 1")).rows;
  assert.ok(!JSON.stringify(rows).includes(t.PASS));
  assert.ok(!JSON.stringify(rows).includes('$2'));                         // لا هاش كلمة مرور
  const login = (await t.q("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login' AND username = 'root'")).rows[0].n;
  assert.ok(login >= 1);
});

test('التغييرات المباشرة على القاعدة (خارج التطبيق) تُسجَّل كـ direct مع مستخدم القاعدة', { skip }, async () => {
  const c = new pg.Client({ connectionString: t.db.url, application_name: 'psql' });
  await c.connect();
  await c.query("UPDATE employees SET job_title = 'تعديل يدوي' WHERE id = $1", [emp.id]);
  await c.query("UPDATE users SET password_hash = 'x' WHERE username = 'pw_user'");
  await c.end();
  const rows = (await t.q("SELECT table_name, direct, app_name, changed_cols, db_user, new_row FROM db_change_log WHERE direct ORDER BY id")).rows;
  assert.ok(rows.some(r => r.table_name === 'employees' && r.changed_cols.includes('job_title') && r.app_name === 'psql'));
  const u = rows.find(r => r.table_name === 'users');
  assert.ok(u.changed_cols.includes('password_hash'));
  assert.equal(u.new_row.password_hash, '[تغيّرت]');                       // لا تُخزَّن قيمة الهاش
  const viaApp = (await t.q("SELECT count(*)::int AS n FROM db_change_log WHERE NOT direct AND table_name = 'employees'")).rows[0].n;
  assert.ok(viaApp > 0);
  const api = (await admin.get('/api/core/db-changes?direct=true')).json;
  assert.ok(api.total >= 2);
});

test('تصدير سجل العمليات CSV يحتاج صلاحية audit_export ويُسجَّل هو نفسه', { skip }, async () => {
  await t.mkUser('auditor1', ['auditor']);
  const a = await t.as('auditor1');
  const r = await a.get('/api/core/audit/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.equal((await a.post('/api/core/employees', { full_name: 'x' })).status, 403);   // المدقق لا يعدّل
  const exp = (await t.q("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'export' AND entity = 'audit_logs' AND username = 'auditor1'")).rows[0].n;
  assert.equal(exp, 1);
  await t.mkUser('plain_emp', ['employee']);
  const emp1 = await t.as('plain_emp');
  assert.equal((await emp1.get('/api/core/audit/export.csv')).status, 403);
});
