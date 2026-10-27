import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';

const t = await bootApp('rbac');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });

test('الرفض هو الأصل: مستخدم بلا أدوار لا يصل لأي منصة ولا لأي API', { skip }, async () => {
  const nb = await t.mkUser('nobody', ['employee']);
  await t.q('DELETE FROM user_roles WHERE user_id = $1', [nb.id]);       // بلا أدوار ← بلا صلاحيات
  const c = await t.as('nobody');
  for (const path of ['/api/core/dashboard', '/api/core/employees', '/api/core/users', '/api/employees', '/api/dashboard', '/api/directory', '/api/portal-admin?action=list&dir=policies'])
    assert.equal((await c.get(path)).status, 403, path);
  assert.deepEqual((await c.get('/api/launcher')).json.apps, []);
  assert.equal((await c.get('/hr/')).status, 403);
});

test('محاولات الوصول غير المصرح بها تُسجَّل في audit_logs بنتيجة denied', { skip }, async () => {
  const { rows } = await t.q("SELECT username, platform, entity, entity_id FROM audit_logs WHERE result = 'denied' AND username = 'nobody'");
  assert.ok(rows.length >= 3);
  assert.ok(rows.some(r => r.entity === 'admin' && r.entity_id === 'access'));
});

test('الصلاحيات تُفرض في الخادم حتى لو عُرف المسار: employee لا يعدّل ولا يرى الأرصدة', { skip }, async () => {
  await t.mkUser('emp', ['employee']);
  const c = await t.as('emp');
  assert.equal((await c.post('/api/core/employees', { full_name: 'x' })).status, 403);
  assert.equal((await c.get('/api/employees')).status, 403);
  assert.equal((await c.put('/api/core/roles/1', { name: 'hack' })).status, 403);
  assert.equal((await c.get('/portal/')).status, 200);                 // البوابة مفتوحة
  assert.equal((await c.get('/portal/admin/')).status, 403);
});

test('دور مخصص + استثناء deny/allow فردي يسريان فوراً دون إعادة دخول', { skip }, async () => {
  const admin = await t.as('admin-x').catch(() => null);
  await t.mkUser('boss', ['admin']);
  const a = await t.as('boss');
  const role = (await a.post('/api/core/roles', { key: 'hr_viewer', name: 'مشاهد موارد' })).json;
  assert.ok(role.id);
  assert.equal((await a.put(`/api/core/roles/${role.id}`, { grants: [{ app: 'hr', action: 'access', scope: 'all' }, { app: 'hr', action: 'view', scope: 'all' }, { app: 'portal', action: 'access', scope: 'all' }] })).status, 200);
  const u = await t.mkUser('viewer', ['hr_viewer']);
  const v = await t.as('viewer');
  assert.equal((await v.get('/api/dashboard')).status, 200);
  assert.equal((await v.post('/api/targets', {})).status, 403);          // لا صلاحية targets
  // منع فردي يغلب الدور
  assert.equal((await a.put(`/api/core/users/${u.id}/grants`, { grants: [{ app: 'hr', action: 'view', effect: 'deny' }] })).status, 200);
  assert.equal((await v.get('/api/dashboard')).status, 403);
  // سماح فردي يضيف فوق الدور
  await a.put(`/api/core/users/${u.id}/grants`, { grants: [{ app: 'hr', action: 'view', effect: 'allow' }, { app: 'card', action: 'access', effect: 'allow' }] });
  assert.equal((await v.get('/api/dashboard')).status, 200);
  assert.equal((await v.get('/api/launcher')).json.apps.some(x => x.slug === 'card'), true);
  assert.ok(admin === null || true);
});

test('نطاق البيانات: مدير قسم يرى موظفي قسمه فقط، والموظف بنطاق self يرى نفسه فقط', { skip }, async () => {
  const { employees, org } = t.svc;
  const sec = async (name) => { const s = await org.createUnit({ parent_id: t.root, name: 'قطاع ' + name }, t.sys); const d = await org.createUnit({ parent_id: s.id, name: 'إدارة ' + name }, t.sys); return { s, d }; };
  const A = await sec('أ'), B = await sec('ب');
  const e1 = await employees.createEmployee({ full_name: 'موظف أ', org_unit_id: A.d.id, extension: 7001 }, t.sys);
  await employees.createEmployee({ full_name: 'موظف ب', org_unit_id: B.d.id, extension: 7002 }, t.sys);
  await t.q("UPDATE employees SET leave_enabled = TRUE, emp_no = 'A' || extension, hire_date = '2020-01-01', opening_date = '2025-12-31' WHERE extension IN (7001, 7002)");
  await t.mkUser('mgr_a', ['department_manager'], { employee_id: e1.id });
  const m = await t.as('mgr_a');
  const list = (await m.get('/api/employees')).json.rows.map(r => r.full_name);
  assert.deepEqual(list, ['موظف أ']);
  // الدليل للبطاقة: employee بنطاق self
  await t.mkUser('self_a', ['employee'], { employee_id: e1.id });
  const s = await t.as('self_a');
  assert.deepEqual((await s.get('/api/directory')).json.employees.map(x => x.name_ar), ['موظف أ']);
  // لا يصدر بطاقة لغيره
  const other = (await t.q("SELECT id FROM employees WHERE extension = 7002")).rows[0].id;
  assert.equal((await s.post('/api/card/log', { employee_id: other, format: 'pdf' })).status, 403);
  assert.equal((await s.post('/api/card/log', { employee_id: e1.id, format: 'pdf' })).status, 200);
});

test('تعطيل منصة يمنع الجميع، والإدارة المركزية لا تُعطَّل', { skip }, async () => {
  const a = await t.as('boss');
  assert.equal((await a.put('/api/core/platforms/admin', { active: false })).status, 400);
  assert.equal((await a.put('/api/core/platforms/report-builder', { active: false })).status, 200);
  assert.equal((await a.get('/report-builder/')).status, 403);
  assert.equal((await a.get('/api/launcher')).json.apps.some(x => x.slug === 'report-builder'), false);
  await a.put('/api/core/platforms/report-builder', { active: true });
  assert.equal((await a.get('/report-builder/')).status, 200);
});

test('الجلسات: الخروج وإنهاء الجلسة إدارياً وتعطيل الحساب وتغيير كلمة المرور تُسقط الجلسة فوراً', { skip }, async () => {
  const a = await t.as('boss');
  const u = await t.mkUser('victim', ['employee']);
  const v1 = await t.as('victim'), v2 = await t.as('victim');
  assert.equal((await v1.get('/api/launcher')).status, 200);
  assert.equal((await v1.post('/api/auth/logout', {})).status, 200);
  assert.equal((await v1.get('/api/launcher')).status, 401);
  const sess = (await a.get('/api/core/sessions')).json.sessions.find(s => s.username === 'victim');
  assert.equal((await a.post(`/api/core/sessions/${sess.id}/revoke`, {})).status, 200);
  assert.equal((await v2.get('/api/launcher')).status, 401);
  const v3 = await t.as('victim');
  assert.equal((await a.put(`/api/core/users/${u.id}`, { active: false })).status, 200);
  assert.equal((await v3.get('/api/launcher')).status, 401);
  assert.equal((await t.client().login('victim')).status, 401);       // الحساب المعطّل لا يدخل
  await a.put(`/api/core/users/${u.id}`, { active: true });
  const v4 = await t.as('victim');
  await a.put(`/api/core/users/${u.id}`, { password: 'NewPassw0rd!x' });
  assert.equal((await v4.get('/api/launcher')).status, 401);
});

test('قفل الحساب بعد محاولات فاشلة متكررة وتسجيلها', { skip }, async () => {
  await t.mkUser('locky', ['employee']);
  const c = t.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.login('locky', 'wrong')).status, 401);
  assert.equal((await c.login('locky')).status, 423);                // حتى بكلمة المرور الصحيحة
  const n = (await t.q("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login_failed' AND username = 'locky'")).rows[0].n;
  assert.ok(n >= 5);
  const a = await t.as('boss');
  const id = (await t.q("SELECT id FROM users WHERE username = 'locky'")).rows[0].id;
  await a.put(`/api/core/users/${id}`, { unlock: true });
  assert.equal((await c.login('locky')).status, 200);
});

test('لا يمكن إزالة آخر مدير نظام فعّال', { skip }, async () => {
  const a = await t.as('boss');
  const admins = (await a.get('/api/core/users')).json.users.filter(u => u.roles.includes('admin') && u.active);
  for (const u of admins.slice(1)) await a.put(`/api/core/users/${u.id}`, { active: false });
  const only = admins[0];
  assert.equal((await a.put(`/api/core/users/${only.id}`, { roles: ['employee'] })).status, 400);
});
