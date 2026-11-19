// الترحيل 016: «مسمى الانتداب» يُسنَد يدوياً لكل موظف (مستقل عن مسماه الوظيفي) ويحدد أجور انتدابه من الإعدادات
export async function up(c) {
  await c.query('ALTER TABLE payroll_salaries ADD COLUMN IF NOT EXISTS assignment_title TEXT');
  return { column: 'assignment_title' };
}
