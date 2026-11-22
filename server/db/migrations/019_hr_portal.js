// الترحيل 019: «بوابة الموارد البشرية» تجمع أرصدة الإجازات ونماذج الموارد البشرية والرواتب والإضافي في صفحة واحدة بتبويبات.
// لا صلاحيات جديدة: من يملك الدخول لأي نظام من الثلاثة يرى البوابة وأقسامه فقط (المجموعة معرّفة في server/lib/apps.js).
export async function up(c) {
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('hr-portal', 'بوابة الموارد البشرية', 'أرصدة الإجازات ونماذج الموارد البشرية والرواتب والإضافي في مكان واحد', 'user-cog', '/hr-portal/', '{}', 2)
    ON CONFLICT (slug) DO NOTHING`);
  return { group: ['hr', 'hr-forms', 'payroll'] };
}
