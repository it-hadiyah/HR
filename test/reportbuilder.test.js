// منشئ التقارير داخل المنصة: الدخول الموحّد، الصلاحيات المركزية، مسار الاعتماد، روابط المشاركة، وسجل التدقيق
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.REPORT_BUILDER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
const { bootApp } = await import('./helpers.js');
const t = await bootApp('rbuilder');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); fs.rmSync(process.env.REPORT_BUILDER_DATA, { recursive: true, force: true }); });

const require = createRequire(import.meta.url);
const TPL = require('../modules/report-builder/public/shared/templates.js').TEMPLATES.map(x => x.id);
const BASE = '/report-builder';
const report = (over = {}) => ({ version: 2, title: 'تقرير اختبار', template: 'blank', sections: [], ...over });
let admin, emp, mgr, other, emp2;

test('إعداد المستخدمين: موظف ومدير إدارة ومسؤول المنشئ', { skip }, async () => {
  await t.mkUser('boss', ['admin']);
  await t.mkUser('emp', ['employee']);
  await t.mkUser('emp2', ['employee']);
  await t.mkUser('mgr', ['department_manager']);
  await t.mkUser('rbadmin', ['report_admin']);
  admin = await t.as('boss'); emp = await t.as('emp'); emp2 = await t.as('emp2'); mgr = await t.as('mgr'); other = await t.as('rbadmin');
  const me = (await emp.get(`${BASE}/api/me`)).json;
  assert.equal(me.role, 'employee'); assert.equal(me.perms.create, true); assert.equal(me.perms.approve, false); assert.equal(me.canChangePassword, false);
  assert.equal((await mgr.get(`${BASE}/api/me`)).json.role, 'manager');
  assert.equal((await other.get(`${BASE}/api/me`)).json.role, 'admin');
});

test('الدخول الموحّد: الزائر يُحوَّل لصفحة دخول المنصة، والـAPI تُرفض، والملفات الثابتة متاحة', { skip }, async () => {
  const anon = t.client();
  const page = await anon.get(`${BASE}/list.html`);
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\/\?next=%2Freport-builder%2Flist\.html/);
  assert.equal((await anon.get(`${BASE}/api/reports`)).status, 401);
  assert.equal((await anon.get(`${BASE}/css/tokens.css`)).status, 200);
  assert.equal((await anon.post(`${BASE}/api/login`, { username: 'x', password: 'y' })).status, 401);   // لا دخول مستقل عن المنصة
  const nb = await t.mkUser('noaccess', ['employee']);
  await t.q('DELETE FROM user_roles WHERE user_id = $1', [nb.id]);
  const na = await t.as('noaccess');
  assert.equal((await na.get(`${BASE}/api/me`)).status, 403);
  assert.equal((await na.get(`${BASE}/dashboard.html`)).status, 403);
});

test('إنشاء التقارير يحتاج صلاحية create من الإدارة المركزية', { skip }, async () => {
  const r = await t.mkUser('readonly', ['employee']);
  await admin.put(`/api/core/users/${r.id}/grants`, { grants: [{ app: 'report-builder', action: 'create', effect: 'deny' }] });
  const ro = await t.as('readonly');
  assert.equal((await ro.post(`${BASE}/api/reports`, report())).status, 403);
  assert.equal((await ro.get(`${BASE}/api/reports`)).status, 200);                 // يبقى مسموحاً بالدخول
  assert.equal((await emp.post(`${BASE}/api/reports`, report())).status, 201);
});

test('مسار الاعتماد: الموظف يرسل، المدير يعتمد، والآخرون لا يرون التقرير', { skip }, async () => {
  const id = (await emp.post(`${BASE}/api/reports`, report({ title: 'تقرير الربع الأول' }))).json.id;
  assert.equal((await emp2.get(`${BASE}/api/reports/${id}`)).status, 403);        // ليس مالكه
  assert.equal((await emp.post(`${BASE}/api/reports/${id}/share`, { manager: 'emp2' })).status, 400);   // ليس مديراً
  const sent = await emp.post(`${BASE}/api/reports/${id}/share`, { manager: 'mgr', note: 'للاعتماد' });
  assert.equal(sent.status, 200);
  assert.equal((await emp.put(`${BASE}/api/reports/${id}`, report({ title: 'تعديل بعد الإرسال' }))).status, 403);   // مقفل أثناء الاعتماد
  assert.equal((await emp.post(`${BASE}/api/reports/${id}/approve`, {})).status, 403);         // الموظف لا يعتمد
  assert.equal((await mgr.get(`${BASE}/api/reports?scope=inbox`)).json.length, 1);
  assert.equal((await mgr.post(`${BASE}/api/reports/${id}/approve`, { note: 'معتمد' })).status, 200);
  assert.equal((await emp.get(`${BASE}/api/reports/${id}`)).json.workflow.status, 'approved');
  assert.equal((await emp.put(`${BASE}/api/reports/${id}`, report())).status, 403);            // معتمد لا يُعدَّل
  assert.equal((await other.post(`${BASE}/api/reports/${id}/reopen`, {})).status, 200);      // مسؤول المنشئ يعيد فتحه
});

test('صفحة التقرير تُولَّد بمسارات المنصة (/report-builder/…) بلا مسارات جذرية مكسورة', { skip }, async () => {
  const id = (await emp.post(`${BASE}/api/reports`, report({ title: 'عرض الصفحة', sections: [{ type: 'text', title: 'نص', content: '<p>مرحباً</p>' }] }))).json.id;
  const html = (await emp.get(`${BASE}/reports/${id}.html`)).text;
  assert.match(html, /مرحباً/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js|brand|fonts|shared)\//);
  assert.match(html, /\/report-builder\/(?:css|brand|fonts)\//);
  assert.equal((await emp2.get(`${BASE}/reports/${id}.html`)).status, 403);
});

test('روابط المشاركة: بكلمة مرور وبعد الدخول، دون تسريب لغير المصرّح', { skip }, async () => {
  const id = (await emp.post(`${BASE}/api/reports`, report({ title: 'تقرير للمشاركة' }))).json.id;
  const pw = (await emp.post(`${BASE}/api/shares`, { type: 'report', id, mode: 'password', password: 'abcd1234' })).json;
  const login = (await emp.post(`${BASE}/api/shares`, { type: 'report', id, mode: 'login' })).json;
  assert.ok(pw.token && login.token);
  assert.equal((await emp2.post(`${BASE}/api/shares`, { type: 'report', id, mode: 'login' })).status, 403);   // ليس مالكاً
  const anon = t.client();
  const form = await anon.get(`${BASE}/s/${pw.token}`);
  assert.equal(form.status, 200);
  assert.match(form.text, /action="\/report-builder\/s\/.+\/unlock"/);
  const bad = await anon.post(`${BASE}/s/${pw.token}/unlock`, null);
  assert.notEqual(bad.status, 302);
  const unlock = await fetch(`${t.base}${BASE}/s/${pw.token}/unlock`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=abcd1234' });
  assert.equal(unlock.status, 302);
  const cookie = unlock.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`Path=${BASE}/s/${pw.token}`));
  const page = await fetch(`${t.base}${BASE}/s/${pw.token}`, { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /تقرير للمشاركة/);
  const toLogin = await anon.get(`${BASE}/s/${login.token}`);
  assert.equal(toLogin.status, 302);
  assert.match(toLogin.headers.get('location'), /^\/login\/\?next=%2Freport-builder%2Fs%2F/);
  assert.equal((await emp2.get(`${BASE}/s/${login.token}`)).status, 200);               // بعد الدخول
});

test('إدارة المنشئ: للمسؤول فقط، والمستخدمون والأدوار من الإدارة المركزية، وتفضيلات الأنواع والمعتمِدين تُحفظ في القاعدة', { skip }, async () => {
  assert.equal((await emp.get(`${BASE}/api/admin/users`)).status, 403);
  assert.equal((await emp.get(`${BASE}/admin.html`)).status, 403);
  const users = (await other.get(`${BASE}/api/admin/users`)).json;
  assert.ok(users.some(u => u.username === 'mgr' && u.role === 'manager'));
  assert.equal((await other.post(`${BASE}/api/admin/users`, { username: 'x', password: 'password1' })).status, 410);
  assert.equal((await other.del(`${BASE}/api/admin/users/emp`)).status, 410);
  assert.equal((await other.put(`${BASE}/api/admin/users/emp`, { role: 'admin' })).status, 404);   // PATCH فقط
  const allowed = ['blank', TPL.find(x => x !== 'blank')];
  const patch = await fetch(`${t.base}${BASE}/api/admin/users/emp`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: await cookieOf('rbadmin') }, body: JSON.stringify({ allowedTemplates: allowed, approvers: ['mgr'] }) });
  assert.equal(patch.status, 200);
  const row = (await t.q("SELECT allowed_templates, approvers FROM report_builder_prefs WHERE username = 'emp'")).rows[0];
  assert.deepEqual(row.allowed_templates, allowed); assert.deepEqual(row.approvers, ['mgr']);
  const bad = await fetch(`${t.base}${BASE}/api/admin/users/emp`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: await cookieOf('rbadmin') }, body: JSON.stringify({ role: 'admin' }) });
  assert.equal(bad.status, 400);                                                       // الدور لا يُغيَّر هنا
  const other3 = TPL.find(x => !allowed.includes(x));
  assert.equal((await emp.post(`${BASE}/api/reports`, report({ template: other3 }))).status, 403);   // نوع غير مسموح
  assert.equal((await emp.post(`${BASE}/api/reports`, report({ template: allowed[1] }))).status, 201);
  const id = (await emp.post(`${BASE}/api/reports`, report())).json.id;
  assert.equal((await emp.post(`${BASE}/api/reports/${id}/share`, { manager: 'rbadmin' })).status, 403);   // المعتمِد المحدد له mgr فقط
});
async function cookieOf(username) {
  const res = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: t.PASS }) });
  return res.headers.get('set-cookie').split(';')[0];
}

test('كل عملية في المنشئ تُسجَّل في سجل التدقيق المركزي، وتعطيل المنصة يمنع الجميع', { skip }, async () => {
  const rows = (await t.q("SELECT action, username, platform, entity FROM audit_logs WHERE platform = 'report-builder' ORDER BY id")).rows;
  assert.ok(rows.some(r => r.action === 'report-create' && r.username === 'emp' && r.entity === 'report'));
  assert.ok(rows.some(r => r.action === 'report-approve' && r.username === 'mgr'));
  assert.ok(rows.some(r => r.action === 'share-create'));
  const denied = (await t.q("SELECT count(*)::int AS n FROM audit_logs WHERE result = 'denied' AND entity = 'report-builder'")).rows[0].n;
  assert.ok(denied >= 1);
  assert.equal((await admin.put('/api/core/platforms/report-builder', { active: false })).status, 200);
  assert.equal((await emp.get(`${BASE}/api/me`)).status, 403);
  assert.equal((await admin.put('/api/core/platforms/report-builder', { active: true })).status, 200);
  assert.equal((await emp.get(`${BASE}/api/me`)).status, 200);
});
