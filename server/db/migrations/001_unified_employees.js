// الترحيل 001: جدول موظفين مركزي واحد.
//  - يضيف إلى employees حقول الهوية المشتركة (التحويلة، الاسم الإنجليزي، البريد، الجوال، الصورة، المدير المباشر …)
//  - يجعل الحقول الخاصة بنظام الإجازات اختيارية لمن ليس له ملف إجازات (leave_enabled = false)
//  - ينقل سجلات دليل البوابة (people) إلى employees دون حذف people (تبقى مرجعاً تاريخياً)
//  - يربط حسابات الدخول (users.employee_id) ويسجّل أي تعارض في migration_conflicts
import { normalizeName } from '../../lib/text.js';

export async function up(c) {
  await c.query(`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS name_en TEXT,
      ADD COLUMN IF NOT EXISTS job_title_en TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS mobile TEXT,
      ADD COLUMN IF NOT EXISTS extension INTEGER,
      ADD COLUMN IF NOT EXISTS photo TEXT,
      ADD COLUMN IF NOT EXISTS section TEXT,
      ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS unit_role TEXT,
      ADD COLUMN IF NOT EXISTS unit_order INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS leave_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS show_in_directory BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    DO $$ BEGIN ALTER TABLE employees ADD CONSTRAINT employees_unit_role_chk CHECK (unit_role IS NULL OR unit_role IN ('head','member'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS employees_extension_uq ON employees(extension) WHERE extension IS NOT NULL;
    CREATE INDEX IF NOT EXISTS employees_email_idx ON employees(lower(email));
    CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_id);
    CREATE INDEX IF NOT EXISTS employees_name_idx ON employees(full_name);
    ALTER TABLE employees ALTER COLUMN emp_no DROP NOT NULL;
    ALTER TABLE employees ALTER COLUMN org_unit_id DROP NOT NULL;
    ALTER TABLE employees ALTER COLUMN hire_date DROP NOT NULL;
    ALTER TABLE employees ALTER COLUMN opening_date DROP NOT NULL;
    -- من فُعّل له نظام الإجازات يجب أن تكتمل بياناته الأساسية
    DO $$ BEGIN ALTER TABLE employees ADD CONSTRAINT employees_leave_profile_chk
      CHECK (NOT leave_enabled OR (emp_no IS NOT NULL AND org_unit_id IS NOT NULL AND hire_date IS NOT NULL AND opening_date IS NOT NULL));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    ALTER TABLE org_history ADD COLUMN IF NOT EXISTS moved_by TEXT;
    ALTER TABLE org_history ADD COLUMN IF NOT EXISTS reason TEXT;
    ALTER TABLE people ADD COLUMN IF NOT EXISTS migrated_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS users_employee_idx ON users(employee_id);

    CREATE TABLE IF NOT EXISTS migration_conflicts (
      id         SERIAL PRIMARY KEY,
      migration  TEXT NOT NULL,
      kind       TEXT NOT NULL,
      employee_id INTEGER,
      person_id  INTEGER,
      details    JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolved   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const conflict = (kind, employee_id, person_id, details) =>
    c.query('INSERT INTO migration_conflicts(migration, kind, employee_id, person_id, details) VALUES ($1,$2,$3,$4,$5)',
      ['001_unified_employees', kind, employee_id, person_id, JSON.stringify(details)]);

  const people = (await c.query('SELECT * FROM people WHERE migrated_employee_id IS NULL ORDER BY id')).rows;
  const stats = { merged_into_existing: 0, created: 0, conflicts: 0 };
  for (const p of people) {
    const linked = (await c.query('SELECT * FROM employees WHERE person_id = $1', [p.id])).rows[0];
    let empId;
    if (linked) {
      empId = linked.id;
      if (normalizeName(linked.full_name) !== normalizeName(p.full_name)) { await conflict('name_mismatch', empId, p.id, { employees: linked.full_name, people: p.full_name }); stats.conflicts++; }
      if (p.job_title && linked.job_title && normalizeName(linked.job_title) !== normalizeName(p.job_title)) { await conflict('job_title_mismatch', empId, p.id, { employees: linked.job_title, people: p.job_title }); stats.conflicts++; }
      const sameUnit = !p.org_unit_id || p.org_unit_id === linked.org_unit_id;
      if (!sameUnit) { await conflict('unit_mismatch', empId, p.id, { employees: linked.org_unit_id, people: p.org_unit_id }); stats.conflicts++; }
      await c.query(`UPDATE employees SET extension = COALESCE(extension, $2), email = COALESCE(email, $3), photo = COALESCE(photo, $4), section = COALESCE(section, $5),
          job_title = COALESCE(job_title, $6), unit_role = $7, unit_order = $8, sort_order = $9, extra = $10 WHERE id = $1`,
      [empId, p.extension, p.email, p.photo, p.section, p.job_title, sameUnit ? p.unit_role : null, sameUnit ? p.unit_order : 0, p.sort_order, JSON.stringify(p.extra || {})]);
      stats.merged_into_existing++;
    } else {
      empId = (await c.query(`INSERT INTO employees(full_name, job_title, extension, email, photo, section, org_unit_id, unit_role, unit_order, sort_order, extra, leave_enabled, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,'active') RETURNING id`,
      [p.full_name, p.job_title, p.extension, p.email, p.photo, p.section, p.org_unit_id, p.unit_role, p.unit_order, p.sort_order, JSON.stringify(p.extra || {})])).rows[0].id;
      stats.created++;
    }
    await c.query('UPDATE people SET migrated_employee_id = $2 WHERE id = $1', [p.id, empId]);
  }
  await c.query('UPDATE users u SET employee_id = p.migrated_employee_id FROM people p WHERE u.person_id = p.id AND u.employee_id IS NULL AND p.migrated_employee_id IS NOT NULL');
  // أسماء مكررة داخل السجل المركزي (للمراجعة اليدوية)
  const dups = (await c.query(`SELECT array_agg(id ORDER BY id) AS ids, min(full_name) AS name FROM employees GROUP BY lower(full_name) HAVING count(*) > 1`)).rows;
  for (const d of dups) await conflict('duplicate_name', d.ids[0], null, { ids: d.ids, name: d.name });
  stats.duplicate_names = dups.length;
  return stats;
}
