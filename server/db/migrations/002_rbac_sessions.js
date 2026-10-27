// الترحيل 002: التطبيقات (المنصات) والأدوار والصلاحيات المركزية (RBAC) والجلسات وإعدادات المنصة.
//  - الصلاحيات تُفحص في الخادم لكل API؛ الرفض هو الأصل (أقل صلاحية)
//  - الأدوار الحالية في users.role تتحول إلى أدوار نظامية بنفس صلاحياتها السابقة تماماً

const APPS = [
  ['portal', 'بوابة الموظفين', 'دليل الموظفين والهيكل التنظيمي والروابط والسياسات والمواقع', 'building-2', '/portal/', 1],
  ['hr', 'أرصدة الإجازات', 'إدارة وتحليل أرصدة الإجازات وتكلفتها المالية', 'calendar-days', '/hr/', 2],
  ['card', 'بطاقة الموظف', 'إصدار بطاقة الموظف للطباعة (PDF / PNG)', 'id-card', '/card/', 3],
  ['report', 'تقرير مراكز التوزيع', 'تقرير تقييم مراكز التوزيع الخيري', 'chart-column', '/report/', 4],
  ['portal-admin', 'لوحة تحكم البوابة', 'تعديل الروابط والسياسات والمواقع ومحتوى الصفحة الرئيسية', 'layout-template', '/portal/admin/', 5],
  ['admin', 'الإدارة المركزية', 'الموظفون والهيكل التنظيمي والمستخدمون والصلاحيات وسجل العمليات', 'shield-check', '/admin/', 6],
];

const A = (action, label) => [action, label];
const ACTIONS = {
  portal: [A('access', 'الوصول للمنصة'), A('view', 'عرض الدليل والمحتوى')],
  'portal-admin': [A('access', 'الوصول للوحة التحكم'), A('create', 'إضافة محتوى'), A('update', 'تعديل المحتوى'), A('delete', 'حذف المحتوى')],
  hr: [A('access', 'الوصول للمنصة'), A('view', 'عرض الأرصدة والتقارير'), A('financials', 'الاطلاع على القيم المالية'), A('employees', 'إدارة بيانات موظفي الإجازات (إضافة/تعديل/حذف)'),
    A('leaves', 'تسجيل الإجازات واعتمادها'), A('targets', 'إدارة المستهدفات'), A('org', 'إدارة الهيكل من نظام الإجازات'), A('import', 'استيراد البيانات'),
    A('settings', 'إعدادات نظام الإجازات'), A('snapshots', 'اللقطات المالية'), A('export', 'تصدير البيانات'), A('reports', 'الاطلاع على التقارير')],
  card: [A('access', 'الوصول للمنصة'), A('view', 'إصدار بطاقة'), A('export', 'تصدير/طباعة البطاقة')],
  report: [A('access', 'الوصول للمنصة'), A('view', 'عرض التقرير'), A('export', 'تصدير التقرير')],
  admin: [A('access', 'الوصول للوحة الإدارة'), A('employees_view', 'عرض الموظفين'), A('employees_edit', 'إضافة وتعديل وحذف الموظفين'), A('org_edit', 'تعديل الهيكل التنظيمي'),
    A('users_manage', 'إدارة المستخدمين'), A('roles_manage', 'إدارة الأدوار والصلاحيات'), A('platforms_manage', 'إدارة المنصات'), A('sessions_manage', 'إدارة الجلسات النشطة'),
    A('audit_view', 'عرض سجل العمليات'), A('audit_export', 'تصدير سجل العمليات'), A('settings_edit', 'تعديل إعدادات المنصة')],
};

const ALL_ROLES = ['admin', 'hr', 'finance', 'sector_manager', 'department_manager', 'section_manager', 'executive', 'employee', 'content_admin'];
// [مفتاح الدور, الاسم, الوصف, super, { app: { action: scope } }]
const g = (actions, scope = 'all') => Object.fromEntries(actions.map(a => [a, scope]));
const ROLES = [
  ['admin', 'مدير النظام', 'كل الصلاحيات على كل المنصات (يشمل ما يُضاف مستقبلاً)', true, {}],
  ['hr', 'الموارد البشرية', 'إدارة الموظفين والإجازات والاستيراد', false, {
    portal: g(['access', 'view']),
    hr: g(['access', 'view', 'financials', 'employees', 'leaves', 'targets', 'org', 'import', 'settings', 'export', 'reports']),
    card: g(['access', 'view', 'export']) }],
  ['finance', 'الإدارة المالية', 'الاطلاع على الأرصدة وقيمتها المالية واللقطات الشهرية', false, {
    portal: g(['access', 'view']), hr: g(['access', 'view', 'financials', 'snapshots', 'reports', 'export']), report: g(['access', 'view', 'export']) }],
  ['executive', 'الإدارة العليا', 'اطلاع على كل الأنظمة دون تعديل', false, {
    portal: g(['access', 'view']), hr: g(['access', 'view', 'financials', 'reports', 'export']), card: g(['access', 'view', 'export']), report: g(['access', 'view', 'export']) }],
  ['sector_manager', 'مدير قطاع', 'يرى بيانات قطاعه فقط', false, {
    portal: g(['access', 'view']), hr: { access: 'all', view: 'sector', reports: 'sector' }, report: g(['access', 'view']) }],
  ['department_manager', 'مدير إدارة', 'يرى بيانات إدارته فقط', false, {
    portal: g(['access', 'view']), hr: { access: 'all', view: 'department', reports: 'department' }, report: g(['access', 'view']) }],
  ['section_manager', 'مدير قسم', 'يرى بيانات قسمه فقط', false, {
    portal: g(['access', 'view']), hr: { access: 'all', view: 'section', reports: 'section' } }],
  ['employee', 'موظف', 'يدخل البوابة ويصدر بطاقته الشخصية فقط', false, {
    portal: g(['access', 'view']), card: { access: 'all', view: 'self', export: 'self' } }],
  ['content_admin', 'مدير محتوى البوابة', 'يعدّل محتوى البوابة ويصدر البطاقات', false, {
    portal: g(['access', 'view']), 'portal-admin': g(['access', 'create', 'update', 'delete']), card: g(['access', 'view', 'export']) }],
  ['auditor', 'مدقق', 'يطلع على سجل العمليات ويصدّره دون أي تعديل', false, {
    portal: g(['access', 'view']), admin: g(['access', 'audit_view', 'audit_export']) }],
];

export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS app_actions (
      app_slug   TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE,
      action     TEXT NOT NULL,
      label      TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (app_slug, action)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id          SERIAL PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
      name        TEXT NOT NULL,
      description TEXT,
      is_system   BOOLEAN NOT NULL DEFAULT FALSE,
      is_super    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS role_grants (
      role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      app_slug TEXT NOT NULL,
      action   TEXT NOT NULL,
      scope    TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('self','reports','section','department','sector','all')),
      PRIMARY KEY (role_id, app_slug, action),
      FOREIGN KEY (app_slug, action) REFERENCES app_actions(app_slug, action) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
    -- استثناءات فردية فوق الأدوار: allow تضيف، و deny تمنع حتى لو منحها الدور
    CREATE TABLE IF NOT EXISTS user_grants (
      id       SERIAL PRIMARY KEY,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      app_slug TEXT NOT NULL,
      action   TEXT NOT NULL,
      scope    TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('self','reports','section','department','sector','all')),
      effect   TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
      UNIQUE (user_id, app_slug, action),
      FOREIGN KEY (app_slug, action) REFERENCES app_actions(app_slug, action) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at   TIMESTAMPTZ NOT NULL,
      ip           TEXT,
      user_agent   TEXT,
      revoked_at   TIMESTAMPTZ,
      revoked_by   TEXT,
      revoke_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, revoked_at);
    CREATE TABLE IF NOT EXISTS platform_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  `);

  // المنصات
  for (const [slug, title, description, icon, path, sort] of APPS) {
    await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order) VALUES ($1,$2,$3,$4,$5,'{}',$6)
      ON CONFLICT (slug) DO UPDATE SET icon = EXCLUDED.icon`, [slug, title, description, icon, path, sort]);   // الأيقونات صارت أسماء Lucide بدل emoji
  }
  for (const [slug, list] of Object.entries(ACTIONS))
    for (const [i, [action, label]] of list.entries())
      await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [slug, action, label, i]);

  // الأدوار النظامية بصلاحياتها السابقة
  for (const [key, name, description, isSuper, grants] of ROLES) {
    const id = (await c.query(`INSERT INTO roles(key, name, description, is_system, is_super) VALUES ($1,$2,$3,TRUE,$4)
      ON CONFLICT (key) DO UPDATE SET is_system = TRUE RETURNING id`, [key, name, description, isSuper])).rows[0].id;
    for (const [app, actions] of Object.entries(grants))
      for (const [action, scope] of Object.entries(actions))
        await c.query('INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, app, action, scope]);
  }
  // كل مستخدم يحصل على دوره الحالي
  await c.query('INSERT INTO user_roles(user_id, role_id) SELECT u.id, r.id FROM users u JOIN roles r ON r.key = u.role ON CONFLICT DO NOTHING');
  await c.query(`DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_role_fk FOREIGN KEY (role) REFERENCES roles(key) ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // الإعدادات (القيم الافتراضية؛ PORTAL_PUBLIC متغير البيئة يحدد القيمة الأولى فقط)
  const defaults = {
    portal_public: process.env.PORTAL_PUBLIC !== '0',
    session_hours: 12,
    idle_minutes: 120,
    password_min_length: 8,
    max_failed_logins: 5,
    lockout_minutes: 15,
  };
  for (const [k, v] of Object.entries(defaults)) await c.query('INSERT INTO platform_settings(key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING', [k, JSON.stringify(v)]);
  return { roles: ROLES.length, apps: APPS.length, legacy_roles_ok: ALL_ROLES.length };
}
