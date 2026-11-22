// الترحيل 021: «إدارة الموظفين» داخل بوابة الموارد البشرية — سجل واحد لبيانات الموظفين تقرأ منه الأرصدة والنماذج والرواتب.
//  - أعمدة جديدة في leave_staff: الجنسية، رقم الهوية، الآيبان، الجوال
//  - منصة hr-employees: access · view · edit · archive · delete · sensitive (رؤية/تعديل رقم الهوية والآيبان)
export async function up(c) {
  await c.query(`ALTER TABLE leave_staff ADD COLUMN IF NOT EXISTS nationality TEXT,
                                         ADD COLUMN IF NOT EXISTS national_id TEXT,
                                         ADD COLUMN IF NOT EXISTS iban TEXT,
                                         ADD COLUMN IF NOT EXISTS phone TEXT`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS leave_staff_national_id_key ON leave_staff(national_id) WHERE national_id IS NOT NULL');
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('hr-employees', 'إدارة الموظفين', 'سجل الموظفين وبياناتهم (الوظيفة والوحدة والتعيين والهوية والآيبان) المشترك بين أنظمة الموارد البشرية', 'user-round', '/hr-employees/', '{}', 1)
    ON CONFLICT (slug) DO NOTHING`);
  const ACTIONS = [['access', 'الوصول للمنصة'], ['view', 'عرض الموظفين وبياناتهم'], ['edit', 'إضافة وتعديل الموظفين'], ['archive', 'أرشفة الموظفين واستعادتهم'], ['delete', 'حذف الموظفين نهائياً'], ['sensitive', 'رؤية وتعديل رقم الهوية والآيبان']];
  for (const [i, [action, label]] of ACTIONS.entries()) await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['hr-employees', action, label, i]);
  const GRANTS = { hr: ['access', 'view', 'edit', 'archive', 'sensitive'], finance: ['access', 'view'], executive: ['access', 'view'] };
  for (const [role, actions] of Object.entries(GRANTS)) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (r) for (const a of actions) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'hr-employees',$2,'all') ON CONFLICT DO NOTHING", [r.id, a]);
  }
  return { granted: Object.keys(GRANTS) };
}
