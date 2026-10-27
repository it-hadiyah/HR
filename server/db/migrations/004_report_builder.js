// الترحيل 004: استبدال منصة «تقرير مراكز التوزيع» بمنصة «منشئ التقارير» وربطها بالصلاحيات المركزية.
//  - تُحذف المنصة القديمة report مع أدوارها وصلاحياتها (إعداد فقط؛ لا بيانات مستخدمين)
//  - تُضاف المنصة report-builder وعملياتها، وتُمنح الأدوار الحالية صلاحيات تطابق سلوك المنشئ الأصلي
//  - جدول report_builder_prefs لأنواع التقارير المسموحة والمعتمِدين لكل مستخدم

const ACTIONS = [['access', 'الوصول للمنصة'], ['create', 'إنشاء التقارير والعروض وتعديل ما أنشأه'], ['share', 'إنشاء روابط المشاركة'],
  ['approve', 'اعتماد التقارير المرسلة إليه وإعادتها'], ['indicators', 'إدارة مركز المؤشرات'], ['manage', 'إدارة المنصة: كل التقارير والأنواع والإعدادات']];
const BASIC = ['access', 'create', 'share'];
const GRANTS = {
  employee: BASIC, hr: BASIC, finance: BASIC, content_admin: BASIC,
  executive: [...BASIC, 'approve', 'indicators'],
  sector_manager: [...BASIC, 'approve', 'indicators'],
  department_manager: [...BASIC, 'approve', 'indicators'],
  section_manager: [...BASIC, 'approve'],
};

export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS report_builder_prefs (
      username          TEXT PRIMARY KEY,
      allowed_templates JSONB,            -- null = الافتراضي العام، مصفوفة = أنواع محددة
      approvers         JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const removed = (await c.query("DELETE FROM apps WHERE slug = 'report'")).rowCount;
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('report-builder', 'منشئ التقارير', 'إنشاء التقارير والعروض التقديمية واعتمادها ومشاركتها بهوية هدية', 'file-pen-line', '/report-builder/', '{}', 4)
    ON CONFLICT (slug) DO NOTHING`);
  for (const [i, [action, label]] of ACTIONS.entries())
    await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['report-builder', action, label, i]);
  for (const [role, actions] of Object.entries(GRANTS)) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (!r) continue;
    for (const a of actions) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'report-builder',$2,'all') ON CONFLICT DO NOTHING", [r.id, a]);
  }
  // دور مسؤول منشئ التقارير: كل عمليات المنصة + دخول البوابة
  const ra = (await c.query(`INSERT INTO roles(key, name, description, is_system) VALUES ('report_admin', 'مسؤول منشئ التقارير', 'يدير منشئ التقارير: كل التقارير وأنواعها وإعداداتها', TRUE)
    ON CONFLICT (key) DO UPDATE SET is_system = TRUE RETURNING id`)).rows[0].id;
  for (const [action] of ACTIONS) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'report-builder',$2,'all') ON CONFLICT DO NOTHING", [ra, action]);
  await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'portal','access','all'), ($1,'portal','view','all') ON CONFLICT DO NOTHING", [ra]);
  return { removed_old_platform: removed, roles_granted: Object.keys(GRANTS).length + 1 };
}
