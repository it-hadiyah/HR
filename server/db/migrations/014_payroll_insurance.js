// الترحيل 014: نسبة استقطاع التأمينات الاجتماعية لكل موظف (إدخال يدوي) من إجمالي الراتب
export async function up(c) {
  await c.query('ALTER TABLE payroll_salaries ADD COLUMN IF NOT EXISTS insurance_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (insurance_percent >= 0 AND insurance_percent <= 100)');
  return { column: 'insurance_percent' };
}
