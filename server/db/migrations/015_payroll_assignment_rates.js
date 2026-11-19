// الترحيل 015: أجور الانتداب حسب المسمى الوظيفي (معيشة + انتداب يومي + أجر نقل ثابت). تُخزَّن لقطة التفصيل مع كل بند.
export async function up(c) {
  await c.query(`ALTER TABLE payroll_entries ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                                             ADD COLUMN IF NOT EXISTS breakdown JSONB`);
  return { columns: ['fixed_amount', 'breakdown'] };
}
