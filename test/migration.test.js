// الترحيل من البنية القديمة (people + employees منفصلان) إلى السجل المركزي دون فقدان بيانات
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers.js';

const db = await createTestDb('migr');
const skip = !db && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await db?.drop(); });

test('الترحيل 001-003 على بيانات قديمة: دمج، ربط حسابات، تعارضات، وقابلية التكرار', { skip }, async () => {
  process.env.DATABASE_URL = db.url; process.env.SKIP_BACKUP = '1';
  const { pool, q } = await import('../server/db/pool.js');
  const { initBaseSchema } = await import('../server/db/init.js');
  const { runMigrations } = await import('../server/db/migrate.js');
  await initBaseSchema();                                                // البنية القديمة فقط (قبل الترحيلات)
  const root = (await q("INSERT INTO org_units(unit_type, name) VALUES ('org','المنشأة') RETURNING id")).rows[0].id;
  const u1 = (await q("INSERT INTO org_units(parent_id, unit_type, name, slug) VALUES ($1,'sector','قطاع 1','s1') RETURNING id", [root])).rows[0].id;
  const u2 = (await q("INSERT INTO org_units(parent_id, unit_type, name) VALUES ($1,'sector','قطاع 2') RETURNING id", [root])).rows[0].id;
  // دليل البوابة (people) وموظفو الإجازات القدامى
  const p1 = (await q("INSERT INTO people(extension, full_name, job_title, email, photo, org_unit_id, unit_role) VALUES (101,'محمد إبراهيم كشك','رئيس قطاع الخدمات','m@x.org','images/a.png',$1,'head') RETURNING id", [u1])).rows[0].id;
  const p2 = (await q("INSERT INTO people(extension, full_name, job_title, email, org_unit_id, unit_role) VALUES (102,'ليلى العلي','مصممة',NULL,$1,'member') RETURNING id", [u1])).rows[0].id;
  await q("INSERT INTO people(extension, full_name) VALUES (103,'بلا وحدة')");
  const e1 = (await q(`INSERT INTO employees(emp_no, full_name, job_title, org_unit_id, hire_date, basic_salary, opening_balance, opening_date, person_id)
    VALUES ('200','محمد ابراهيم كشك','رئيس قطاع',$1,'2020-01-01',10000,12,'2025-12-31',$2) RETURNING id`, [u2, p1])).rows[0].id;
  await q("INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days) VALUES ($1,'leave','2026-01-01','2026-01-03',3)", [e1]);
  const user = (await q("INSERT INTO users(username, full_name, password_hash, role, person_id) VALUES ('kishk','كشك','x','hr',$1) RETURNING id", [p1])).rows[0].id;
  await q("INSERT INTO audit_log(username, action, entity, entity_id) VALUES ('old','create','employee','1')");

  const applied = await runMigrations({ backup: false });
  assert.deepEqual(applied, ['001_unified_employees.js', '002_rbac_sessions.js', '003_audit_logs.sql']);

  // لا فقدان: 1 مدموج + 2 جديدان = 3 موظفين، وسجل الإجازات والراتب سليمان
  assert.equal((await q('SELECT count(*)::int AS n FROM employees')).rows[0].n, 3);
  const kishk = (await q('SELECT * FROM employees WHERE id = $1', [e1])).rows[0];
  assert.equal(kishk.extension, 101); assert.equal(kishk.email, 'm@x.org'); assert.equal(kishk.photo, 'images/a.png');
  assert.equal(kishk.basic_salary, 10000); assert.equal(kishk.leave_enabled, true); assert.equal(kishk.org_unit_id, u2);   // وحدة الإجازات محفوظة
  assert.equal((await q('SELECT count(*)::int AS n FROM leave_transactions WHERE employee_id = $1', [e1])).rows[0].n, 1);
  const lila = (await q('SELECT * FROM employees WHERE extension = 102')).rows[0];
  assert.equal(lila.leave_enabled, false); assert.equal(lila.emp_no, null); assert.equal(lila.org_unit_id, u1); assert.equal(lila.unit_role, 'member');
  // الحسابات مربوطة بالسجل المركزي وأدوارها نُقلت
  assert.equal((await q('SELECT employee_id FROM users WHERE id = $1', [user])).rows[0].employee_id, e1);
  assert.equal((await q('SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [user])).rows[0].key, 'hr');
  // التعارضات سُجّلت (المسمى مختلف، الوحدة مختلفة) ولم تُهمَل
  const kinds = (await q('SELECT kind FROM migration_conflicts')).rows.map(r => r.kind).sort();
  assert.deepEqual(kinds, ['job_title_mismatch', 'unit_mismatch']);
  // people تبقى كما هي (لا حذف) ومعلَّمة بما رُحِّل منها
  assert.equal((await q('SELECT count(*)::int AS n FROM people WHERE migrated_employee_id IS NOT NULL')).rows[0].n, 3);
  // السجل القديم نُقل إلى audit_logs والجدول القديم باقٍ
  assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs WHERE source = 'legacy' AND username = 'old'")).rows[0].n, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, 1);
  // التحويلة فريدة والقيد المشروط يمنع ملف إجازات ناقصاً
  await assert.rejects(q("INSERT INTO employees(full_name, extension, leave_enabled) VALUES ('مكرر', 101, FALSE)"), /unique/i);
  await assert.rejects(q("INSERT INTO employees(full_name, leave_enabled) VALUES ('ناقص', TRUE)"), /leave_profile/);
  // إعادة التشغيل آمنة ولا تكرر شيئاً
  assert.deepEqual(await runMigrations({ backup: false }), []);
  assert.equal((await q('SELECT count(*)::int AS n FROM employees')).rows[0].n, 3);
  await pool.end();
});
