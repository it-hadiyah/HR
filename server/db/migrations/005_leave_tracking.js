// الترحيل 005: نظام متابعة أرصدة الإجازات — حقول يعبّئها المسؤول لكل موظف وسنة (الرصيد السنوي والكلي والمستهدف والمستخدم والراتب الإجمالي).
// لا يمس أي جدول قائم؛ الرقم الوظيفي وتاريخ التعيين يبقيان في السجل المركزي employees.
export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS leave_tracking (
      employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      annual_balance NUMERIC(8,2) CHECK (annual_balance IS NULL OR annual_balance >= 0),
      total_balance  NUMERIC(8,2),
      target_days    NUMERIC(8,2) CHECK (target_days IS NULL OR target_days >= 0),
      used_days      NUMERIC(8,2) CHECK (used_days IS NULL OR used_days >= 0),
      gross_salary   NUMERIC(12,2) CHECK (gross_salary IS NULL OR gross_salary >= 0),
      notes          TEXT,
      updated_by     TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (employee_id, year)
    );
    CREATE INDEX IF NOT EXISTS leave_tracking_year_idx ON leave_tracking(year);`);
  return { table: 'leave_tracking' };
}
