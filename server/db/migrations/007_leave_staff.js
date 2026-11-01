// الترحيل 007: فصل موظفي متابعة الأرصدة عن جدول الموظفين المركزي (دليل البوابة).
//  - جدول leave_staff مستقل بإدارته الخاصة (إضافة/تعديل/أرشفة/حذف من صفحة متابعة الأرصدة)
//  - يُنسخ إليه كل من في employees بنفس المعرّفات، فتبقى بيانات المتابعة كما هي
//  - يُنقل ارتباط leave_tracking من employees إلى leave_staff. لا يُحذف أو يُعدَّل أي شيء في employees
export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS leave_staff (
      id                 SERIAL PRIMARY KEY,
      emp_no             TEXT UNIQUE,
      full_name          TEXT NOT NULL,
      job_title          TEXT,
      hire_date          DATE,
      org_unit_id        INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
      status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      source_employee_id INTEGER,
      version            INTEGER NOT NULL DEFAULT 1,
      created_by         TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS leave_staff_unit_idx ON leave_staff(org_unit_id);`);
  const copied = (await c.query(`INSERT INTO leave_staff(id, emp_no, full_name, job_title, hire_date, org_unit_id, status, source_employee_id)
    SELECT id, NULLIF(trim(emp_no), ''), full_name, job_title, hire_date, org_unit_id, CASE WHEN status = 'active' THEN 'active' ELSE 'archived' END, id FROM employees
    ON CONFLICT (id) DO NOTHING`)).rowCount;
  await c.query(`SELECT setval(pg_get_serial_sequence('leave_staff', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM leave_staff), 1))`);
  await c.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_tracking_employee_id_fkey') THEN
        ALTER TABLE leave_tracking DROP CONSTRAINT leave_tracking_employee_id_fkey;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_tracking_staff_fkey') THEN
        ALTER TABLE leave_tracking ADD CONSTRAINT leave_tracking_staff_fkey FOREIGN KEY (employee_id) REFERENCES leave_staff(id) ON DELETE CASCADE;
      END IF;
    END $$;`);
  return { copied };
}
