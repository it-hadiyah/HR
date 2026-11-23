// الترحيل 025: احتساب الإضافي بالطريقة المركّبة المعتمدة: لكل ساعة إضافي = ساعة (100%) من الأجر الساعي للإجمالي + نصف ساعة (50%) من الأجر الساعي للأساسي.
// تُضاف النسبتان لكل نوع إضافي موجود (قابلتان للتعديل لكل نوع من الإعدادات)، والبنود المسجّلة سابقاً تحتفظ بمبالغها.
export async function up(c) {
  const row = (await c.query("SELECT value FROM payroll_settings WHERE key = 'config'")).rows[0];
  if (!row) return { updated: false };
  const v = row.value;
  v.overtime_method = 'split';
  v.overtime_types = (v.overtime_types || []).map(t => ({ ...t, gross_percent: t.gross_percent ?? 100, basic_percent: t.basic_percent ?? 50 }));
  await c.query("UPDATE payroll_settings SET value = $1, updated_by = 'system', updated_at = now() WHERE key = 'config'", [JSON.stringify(v)]);
  return { updated: true, types: v.overtime_types.length };
}
