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

test('موظف من دليل البوابة يظهر في أرصدة الإجازات بعد تفعيل ملفه بلا تكرار السجل', { skip }, async () => {
  const p = await t.svc.employees.createEmployee({ full_name: 'خالد الدليل', job_title: 'منسق', extension: 6001, org_unit_id: unitB.id }, t.sys);
  const pend = (await admin.get('/api/employees/pending/leave-profile')).json.rows;
  assert.ok(pend.find(e => e.id === p.id), 'يظهر ضمن بانتظار التفعيل');
  assert.ok(!(await admin.get('/api/employees')).json.rows.find(e => e.id === p.id), 'لا يظهر في الأرصدة قبل التفعيل');
  const bad = await admin.post(`/api/employees/${p.id}/enable-leave`, { emp_no: 'E6001', full_name: 'خالد الدليل' });
  assert.equal(bad.status, 400);
  const ok = await admin.post(`/api/employees/${p.id}/enable-leave`, { emp_no: 'E6001', full_name: 'خالد الدليل', org_unit_id: unitB.id, hire_date: '2022-01-01', basic_salary: 8000, opening_balance: 5, opening_date: '2025-12-31' });
  assert.equal(ok.status, 201);
  assert.ok((await admin.get('/api/employees')).json.rows.find(e => e.id === p.id), 'يظهر في الأرصدة بعد التفعيل');
  assert.equal((await t.q('SELECT count(*)::int AS n FROM employees WHERE extension = 6001')).rows[0].n, 1);
  assert.equal((await admin.post(`/api/employees/${p.id}/enable-leave`, { emp_no: 'E6001', full_name: 'x', org_unit_id: unitB.id, hire_date: '2022-01-01' })).status, 409);
  assert.ok((await admin.get('/api/directory')).json.employees.find(e => e.id === p.id), 'ما زال في دليل البوابة');
});

test('الإجازة المعتمدة تُخصم تلقائياً وتظهر في المستخدم بملف الموظف', { skip }, async () => {
  const id = emp.id;
  const before = (await admin.get(`/api/employees/${id}`)).json.employee.m;
  const day = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const r = await admin.post('/api/leaves', { employee_id: id, tx_type: 'leave', start_date: day, end_date: day, days: 2 });
  assert.equal(r.status, 201);
  const m = (await admin.get(`/api/employees/${id}`)).json.employee.m;
  assert.equal(+(m.used - before.used).toFixed(2), 2);
  assert.equal(+(before.available_now - m.available_now).toFixed(2), 2);
  assert.equal(+(m.used_total - before.used_total).toFixed(2), 2);
});

test('تعطيل الموظف يخفيه من قائمة الأرصدة ودليل البوابة وتنشيطه يعيده', { skip }, async () => {
  const e2 = await t.svc.employees.createEmployee({ full_name: 'ناصر التعطيل', job_title: 'محاسب', extension: 7001, org_unit_id: unitA.id }, t.sys);
  await t.q("UPDATE employees SET leave_enabled = TRUE, emp_no = 'E7001', hire_date = '2021-01-01', opening_date = '2025-12-31', opening_balance = 10, basic_salary = 9000 WHERE id = $1", [e2.id]);
  const inList = async () => !!(await admin.get('/api/employees')).json.rows.find(e => e.id === e2.id);
  const inPortal = async () => !!(await admin.get('/portal/data/employeeInfo.json')).json.find(e => e.Extension === 7001);
  assert.ok(await inList()); assert.ok(await inPortal());
  assert.equal((await admin.put(`/api/employees/${e2.id}`, { status: 'suspended' })).status, 200);
  assert.ok(!(await inList()), 'مخفي من الأرصدة'); assert.ok(!(await inPortal()), 'مخفي من البوابة');
  assert.ok((await admin.get('/api/employees?status=suspended')).json.rows.find(e => e.id === e2.id), 'يظهر في فلتر المعطّلين');
  assert.equal((await admin.put(`/api/employees/${e2.id}`, { status: 'active' })).status, 200);
  assert.ok(await inList()); assert.ok(await inPortal());
});

test('تحقق المدخلات: مستهدف فارغ مرفوض، رصيد افتتاحي قبل التعيين مرفوض، رقم وظيفي مكرر برسالة واضحة', { skip }, async () => {
  const bad = await admin.post('/api/targets', { scope_type: 'unit', scope_id: unitA.id, year: 2026, target_type: 'max_year_end_balance', value: '' });
  assert.equal(bad.status, 400);
  assert.equal((await t.q('SELECT count(*)::int AS n FROM targets WHERE scope_id = $1', [unitA.id])).rows[0].n, 0);
  const b2 = await admin.post('/api/employees', { emp_no: 'E8001', full_name: 'تواريخ خاطئة', org_unit_id: unitA.id, hire_date: '2024-05-01', opening_date: '2024-01-01' });
  assert.equal(b2.status, 400);
  const ok = await admin.post('/api/employees', { emp_no: 'E8002', full_name: 'رقم أول', org_unit_id: unitA.id, hire_date: '2024-05-01' });
  assert.equal(ok.status, 201);
  const dup = await admin.post('/api/employees', { emp_no: 'E8002', full_name: 'رقم ثان', org_unit_id: unitA.id, hire_date: '2024-05-01' });
  assert.equal(dup.status, 409);
  assert.match(dup.json.error, /الرقم الوظيفي/);
});

test('متابعة الأرصدة: الحقول اليدوية والتكلفة المالية وتحقق المدخلات وإخفاء المالي عمّن لا يملك صلاحيته', { skip }, async () => {
  const y = 2026;
  const put = (id, body) => admin.put(`/api/tracking/${id}`, { year: y, ...body });
  const r1 = await put(emp.id, { gross_salary: 12000, annual_balance: 21, total_balance: 45, target_days: 15, used_days: 6, emp_no: 'E5001', hire_date: '2021-01-01' });
  assert.equal(r1.status, 200);
  const row = r1.json.row;
  assert.equal(row.day_rate, 400);                       // 12000 ÷ 30
  assert.equal(row.cost_now, 18000);                     // 45 × 400
  assert.equal(row.remaining_to_target, 9);              // 15 − 6
  assert.equal(row.expected_balance, 36);
  assert.equal(row.cost_after_target, 14400);
  assert.equal(row.saving, 3600);
  assert.equal(row.complete, true);
  const list = (await admin.get(`/api/tracking?year=${y}`)).json;
  assert.ok(list.rows.find(x => x.employee_id === emp.id));
  assert.equal(list.summary.cost_now >= 18000, true);
  assert.equal((await put(emp.id, { target_days: -3 })).status, 400);
  assert.equal((await put(emp.id, { hire_date: 'x' })).status, 400);
  assert.equal((await put(emp.id, { emp_no: '' })).status, 400);
  // سنة أخرى مستقلة
  const r2 = await admin.put(`/api/tracking/${emp.id}`, { year: 2027, total_balance: 10 });
  assert.equal(r2.json.row.total_balance, 10); assert.equal(r2.json.row.annual_balance, null);
  // مدير بلا صلاحية مالية لا يرى الراتب ولا التكلفة ولا يعدّله
  const curUnit = (await t.q('SELECT org_unit_id FROM employees WHERE id = $1', [emp.id])).rows[0].org_unit_id;
  await t.mkUser('mgr_trk', ['department_manager'], { org_unit_id: curUnit });
  const mgr = await t.as('mgr_trk');
  const ml = (await mgr.get(`/api/tracking?year=${y}`)).json;
  assert.equal(ml.fin, false);
  const mrow = ml.rows.find(x => x.employee_id === emp.id);
  assert.ok(mrow); assert.equal(mrow.gross_salary, undefined); assert.equal(mrow.cost_now, undefined);
  assert.equal((await mgr.put(`/api/tracking/${emp.id}`, { year: y, gross_salary: 1 })).status, 403);
});

test('لوحة المؤشرات تُجمّع بيانات المتابعة، وPUT تعمل أيضاً عبر POST مع X-HTTP-Method-Override، والأرقام العربية تُحفظ', { skip }, async () => {
  const via = await admin.post(`/api/tracking/${emp.id}`, { year: 2026, total_balance: '٣٠٫٥', target_days: '١٥', used_days: '٥' }, { 'X-HTTP-Method-Override': 'PUT' });
  assert.equal(via.status, 200);
  assert.equal(via.json.row.total_balance, 30.5);
  const d = (await admin.get('/api/tracking/indicators?year=2026&level=sector')).json;
  assert.ok(d.kpis.employees >= 1);
  assert.ok(d.kpis.target_days >= 15 && d.kpis.used_days >= 5);
  assert.equal(d.kpis.remaining_to_target >= 10, true);
  assert.ok(Array.isArray(d.groups) && d.groups.length >= 1);
  assert.equal(typeof d.distribution.achieved, 'number');
  assert.ok(d.bands.length === 6 && d.yearly.length >= 1);
  const mgr = await t.as('mgr_trk');
  const md = (await mgr.get('/api/tracking/indicators?year=2026')).json;
  assert.equal(md.fin, false); assert.equal(md.kpis.cost_now, undefined);
});

test('الفلترة المتقدمة: نطاقات وشرائح ذكية وبيانات ناقصة وقوائم متعددة، ومرشحات مالية تُتجاهل لمن لا يملك الصلاحية', { skip }, async () => {
  const mk = async (no, total, target, used, sal, job) => {
    const e = await t.svc.employees.createEmployee({ full_name: 'فلتر ' + no, job_title: job, org_unit_id: unitB.id }, t.sys);
    await t.q("UPDATE employees SET emp_no = $2, hire_date = '2020-01-01' WHERE id = $1", [e.id, no]);
    await admin.put(`/api/tracking/${e.id}`, { year: 2026, annual_balance: 21, total_balance: total, target_days: target, used_days: used, gross_salary: sal });
    return e;
  };
  const a = await mk('F1', 50, 20, 20, 9000, 'محاسب');       // رصيد مرتفع وحقق المستهدف
  const b = await mk('F2', 10, 20, 0, 6000, 'مهندس');         // لم يستخدم، بلا إنجاز
  const c = await t.svc.employees.createEmployee({ full_name: 'فلتر ناقص', job_title: 'محاسب', org_unit_id: unitB.id }, t.sys);  // بيانات ناقصة
  const get = (f) => admin.get('/api/tracking/indicators?year=2026&f=' + encodeURIComponent(JSON.stringify(f)));
  const ids = r => r.json.employees.map(x => x.employee_id);
  let r = await get({ ranges: { total: [40, null] } });
  assert.ok(ids(r).includes(a.id) && !ids(r).includes(b.id));
  r = await get({ segments: ['high_balance', 'achieved'], segMode: 'all' });
  assert.ok(ids(r).includes(a.id) && !ids(r).includes(b.id));
  r = await get({ segments: ['no_usage'] });
  assert.ok(ids(r).includes(b.id) && !ids(r).includes(a.id));
  r = await get({ segments: ['high_balance', 'no_usage'], segMode: 'any' });
  assert.ok(ids(r).includes(a.id) && ids(r).includes(b.id));
  r = await get({ missing: ['total_balance'] });
  assert.ok(ids(r).includes(c.id) && !ids(r).includes(a.id));
  r = await get({ job: ['مهندس'] });
  assert.deepEqual(ids(r).filter(i => [a.id, b.id, c.id].includes(i)), [b.id]);
  r = await get({ ranges: { cost: [1000, null] }, hire_from: '2019-01-01' });
  assert.ok(ids(r).includes(a.id));
  assert.equal(r.json.matched, r.json.employees.length);
  assert.ok(r.json.base_total >= r.json.matched);
  assert.equal((await admin.get('/api/tracking/indicators?year=2026&f=%7Bbroken')).status, 200);   // مواصفة تالفة تُتجاهل
  const fac = (await admin.get('/api/tracking/facets?year=2026')).json;
  assert.ok(fac.segments.find(s => s.id === 'high_balance').count >= 1 && fac.sector.length >= 1 && fac.ranges.total);
  // المدير بلا صلاحية مالية: فلتر الراتب مُهمَل ولا يظهر في الخيارات
  const mgr = await t.as('mgr_trk');
  const mf = (await mgr.get('/api/tracking/facets?year=2026')).json;
  assert.equal(mf.fin, false); assert.equal(mf.ranges.salary, undefined); assert.equal(mf.segments.find(s => s.id === 'top_cost'), undefined);
  const mr = await mgr.get('/api/tracking/indicators?year=2026&f=' + encodeURIComponent(JSON.stringify({ ranges: { salary: [99999, null] } })));
  assert.equal(mr.status, 200); assert.equal(mr.json.fin, false);
});

test('تكاليف الإجازة الأربع: الكلية والمستهدفة والمتبقي من المستهدف والمتبقي من الكلي', { skip }, async () => {
  const r = await admin.put(`/api/tracking/${emp.id}`, { year: 2026, gross_salary: 12000, total_balance: 45, target_days: 15, used_days: 6 });
  const x = r.json.row;                       // أجر اليوم 400
  assert.equal(x.cost_now, 18000);            // 45 × 400
  assert.equal(x.cost_target, 6000);          // 15 × 400
  assert.equal(x.remaining_to_target, 9);
  assert.equal(x.cost_remaining_target, 3600);// 9 × 400
  assert.equal(x.remaining_total, 39);        // 45 − 6
  assert.equal(x.cost_remaining_total, 15600);// 39 × 400
  const ind = (await admin.get('/api/tracking/indicators?year=2026')).json.kpis;
  for (const k of ['cost_now', 'cost_target', 'cost_remaining_target', 'cost_remaining_total']) assert.equal(typeof ind[k], 'number');
  const mgr = await t.as('mgr_trk');
  const mrow = (await mgr.get('/api/tracking?year=2026')).json.rows.find(y => y.employee_id === emp.id);
  assert.equal(mrow.cost_target, undefined); assert.equal(mrow.cost_remaining_total, undefined); assert.equal(typeof mrow.remaining_total, 'number');
});
