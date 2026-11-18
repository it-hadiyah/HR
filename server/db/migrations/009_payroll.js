// الترحيل 009: منصة «الرواتب والإضافي»
//  - payroll_salaries: مكوّنات راتب كل موظف (أساسي + بدلات) والإجمالي يُحسب منها
//  - payroll_entries: بنود الإضافي (ساعات) والانتداب (أيام) بلقطة من الراتب والنسبة وقت الإدخال
//  - payroll_settings: النسب وأسس الاحتساب (تُضبط من صفحة الإعدادات)
//  - منصة payroll في الصلاحيات المركزية. الموظفون من جدول leave_staff (موظفو المتابعة)
const DEFAULT_SETTINGS = {
  salary_basis: 'gross', days_per_month: 30, hours_per_day: 8, overtime_monthly_cap_hours: 0,
  overtime_types: [
    { id: 'ot-workday', name: 'إضافي أيام العمل', percent: 150 },
    { id: 'ot-weekend', name: 'إضافي نهاية الأسبوع', percent: 150 },
    { id: 'ot-holiday', name: 'إضافي العطل والمناسبات', percent: 200 },
  ],
  assignment_types: [
    { id: 'as-inside', name: 'انتداب داخل المدينة', percent: 100 },
    { id: 'as-outside', name: 'انتداب خارج المدينة', percent: 150 },
  ],
};

export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS payroll_salaries (
      employee_id INTEGER PRIMARY KEY REFERENCES leave_staff(id) ON DELETE CASCADE,
      basic       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
      housing     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (housing >= 0),
      transport   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transport >= 0),
      other       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other >= 0),
      notes       TEXT,
      updated_by  TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payroll_entries (
      id          BIGSERIAL PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('overtime','assignment')),
      employee_id INTEGER NOT NULL REFERENCES leave_staff(id) ON DELETE CASCADE,
      entry_date  DATE NOT NULL,
      pay_month   TEXT NOT NULL CHECK (pay_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      type_id     TEXT,
      type_name   TEXT NOT NULL,
      quantity    NUMERIC(8,2) NOT NULL CHECK (quantity > 0),
      percent     NUMERIC(7,2) NOT NULL CHECK (percent >= 0),
      base_salary NUMERIC(12,2) NOT NULL,
      unit_wage   NUMERIC(12,2) NOT NULL,
      amount      NUMERIC(12,2) NOT NULL,
      notes       TEXT,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payroll_entries_month_idx ON payroll_entries(pay_month, kind);
    CREATE INDEX IF NOT EXISTS payroll_entries_emp_idx ON payroll_entries(employee_id, pay_month);
    CREATE TABLE IF NOT EXISTS payroll_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  await c.query("INSERT INTO payroll_settings(key, value, updated_by) VALUES ('config', $1, 'system') ON CONFLICT (key) DO NOTHING", [JSON.stringify(DEFAULT_SETTINGS)]);

  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('payroll', 'الرواتب والإضافي', 'رواتب الموظفين الإجمالية حسب القطاع والإدارة والقسم، وحساب الإضافي والانتداب تلقائياً من نسب تضبطها', 'banknote', '/payroll/', '{}', 6)
    ON CONFLICT (slug) DO NOTHING`);
  const ACTIONS = [['access', 'الوصول للمنصة'], ['view', 'عرض الرواتب والتقارير'], ['edit_salaries', 'تعديل واستيراد الرواتب'], ['entries', 'تسجيل الإضافي والانتدابات'], ['settings', 'ضبط النسب والإعدادات']];
  for (const [i, [action, label]] of ACTIONS.entries()) await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['payroll', action, label, i]);
  const GRANTS = { finance: ['access', 'view', 'edit_salaries', 'entries', 'settings'], hr: ['access', 'view', 'entries'] };
  for (const [role, actions] of Object.entries(GRANTS)) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (r) for (const a of actions) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'payroll',$2,'all') ON CONFLICT DO NOTHING", [r.id, a]);
  }
  return { granted: Object.keys(GRANTS) };
}
