-- نظام إدارة أرصدة الإجازات وتكلفتها المالية — هيكل قاعدة البيانات (PostgreSQL)

CREATE TABLE IF NOT EXISTS org_units (
  id          SERIAL PRIMARY KEY,
  parent_id   INTEGER REFERENCES org_units(id) ON DELETE RESTRICT,
  -- المنشأة → القطاع → الإدارة → القسم ؛ المستوى يحدده النوع ويمكن إضافة مستويات جديدة بإضافة نوع
  unit_type   TEXT NOT NULL CHECK (unit_type IN ('org','sector','department','section')),
  name        TEXT NOT NULL,
  code        TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_units_parent_idx ON org_units(parent_id);

CREATE TABLE IF NOT EXISTS employees (
  id                      SERIAL PRIMARY KEY,
  emp_no                  TEXT NOT NULL UNIQUE,
  full_name               TEXT NOT NULL,
  job_title               TEXT,
  org_unit_id             INTEGER NOT NULL REFERENCES org_units(id),
  hire_date               DATE NOT NULL,
  termination_date        DATE,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','terminated')),
  basic_salary            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  -- الراتب المعتمد لاحتساب الإجازات: إن تُرك فارغاً = الأساسي + البدلات المشمولة
  leave_salary_override   NUMERIC(14,2) CHECK (leave_salary_override >= 0),
  -- الاستحقاق السنوي بالأيام: إن تُرك فارغاً تُطبَّق سياسة الجهة (حسب سنوات الخدمة)
  annual_entitlement_days NUMERIC(6,2) CHECK (annual_entitlement_days >= 0),
  opening_balance         NUMERIC(8,2) NOT NULL DEFAULT 0,
  opening_date            DATE NOT NULL,           -- تاريخ الرصيد الافتتاحي؛ الاستحقاق يُحتسب بعده
  is_demo                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_unit_idx ON employees(org_unit_id);

CREATE TABLE IF NOT EXISTS employee_allowances (
  id               SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  include_in_leave BOOLEAN NOT NULL DEFAULT FALSE   -- هل يدخل البدل في احتساب قيمة الإجازة
);

-- سجل تغيّر الراتب المعتمد لاحتساب الإجازات (لحفظ التاريخ وإعادة التقييم)
CREATE TABLE IF NOT EXISTS salary_history (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  leave_salary   NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_history (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_unit_id  INTEGER REFERENCES org_units(id),
  to_unit_id    INTEGER NOT NULL REFERENCES org_units(id),
  moved_on      DATE NOT NULL DEFAULT CURRENT_DATE
);

-- سجل حركات الإجازات (دفتر الأستاذ). الاستحقاق يحسبه المحرك ولا يُخزَّن.
CREATE TABLE IF NOT EXISTS leave_transactions (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tx_type     TEXT NOT NULL CHECK (tx_type IN ('leave','adjustment','settlement')),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  -- leave/settlement: عدد موجب يُخصم من الرصيد؛ adjustment: موجب يزيد ، سالب ينقص
  days        NUMERIC(8,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','cancelled')),
  notes       TEXT,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (tx_type = 'adjustment' OR days > 0)
);
CREATE INDEX IF NOT EXISTS leave_tx_emp_idx ON leave_transactions(employee_id, start_date);

-- المستهدفات: وحدة تنظيمية أو موظف أو المنشأة كاملة (scope_type = 'org' و scope_id = جذر الهيكل)
CREATE TABLE IF NOT EXISTS targets (
  id          SERIAL PRIMARY KEY,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('unit','employee')),
  scope_id    INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN
               ('max_year_end_balance','days_to_use','reduction_pct','financial_target','usage_plan_pct')),
  value       NUMERIC(16,2) NOT NULL CHECK (value >= 0),
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, year)
);

CREATE TABLE IF NOT EXISTS holidays (
  id    SERIAL PRIMARY KEY,
  day   DATE NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN
                  ('admin','hr','finance','sector_manager','department_manager','section_manager','executive')),
  org_unit_id   INTEGER REFERENCES org_units(id),  -- نطاق المدير
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- لقطة شهرية لقيمة الالتزام المالي (تحفظ القيمة التقديرية وقت اللقطة، ويمكن للمالية إدخال القيمة المحاسبية الرسمية)
CREATE TABLE IF NOT EXISTS snapshots (
  id          SERIAL PRIMARY KEY,
  snap_date   DATE NOT NULL UNIQUE,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  official_total NUMERIC(16,2),               -- القيمة المحاسبية الرسمية المعتمدة (اختيارية)
  notes       TEXT
);
CREATE TABLE IF NOT EXISTS snapshot_rows (
  snapshot_id  INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL,
  org_unit_id  INTEGER NOT NULL,
  balance_days NUMERIC(10,2) NOT NULL,
  day_rate     NUMERIC(14,4) NOT NULL,
  est_value    NUMERIC(16,2) NOT NULL,
  PRIMARY KEY (snapshot_id, employee_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INTEGER,
  username    TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- المنصة الموحّدة: البنية المشتركة بين الموارد البشرية والبوابة والبطاقات والتقارير
-- ═══════════════════════════════════════════════════════════════════

-- الهيكل التنظيمي واحد للجميع: الوحدات التي لها slug تظهر في بوابة الموظفين أيضاً
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS slug        TEXT UNIQUE;
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS portal_kind TEXT;
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS sort_order  INTEGER NOT NULL DEFAULT 0;

-- دليل الأشخاص (الهوية المشتركة): البوابة والبطاقات تقرأ منه، ويُربط به موظف الموارد البشرية والمستخدم
CREATE TABLE IF NOT EXISTS people (
  id          SERIAL PRIMARY KEY,
  extension   INTEGER UNIQUE,                 -- الرقم الداخلي (مفتاح الدليل في البوابة)
  full_name   TEXT NOT NULL,
  job_title   TEXT,
  section     TEXT,
  email       TEXT,
  photo       TEXT,
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  unit_role   TEXT CHECK (unit_role IN ('head','member')),
  unit_order  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- أي حقول إضافية في ملفات البوابة تُحفظ كما هي
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_unit_idx ON people(org_unit_id);
CREATE INDEX IF NOT EXISTS people_email_idx ON people(lower(email));

-- ربط موظف الموارد البشرية بالشخص في الدليل، وربط حساب الدخول بالشخص
ALTER TABLE employees ADD COLUMN IF NOT EXISTS person_id INTEGER UNIQUE REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;

-- أدوار إضافية: employee (موظف عادي: البوابة والبطاقة) و content_admin (مدير محتوى البوابة)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('admin','hr','finance','sector_manager','department_manager','section_manager','executive','employee','content_admin'));

-- بوابة الموظفين: الروابط والسياسات والمواقع
CREATE TABLE IF NOT EXISTS link_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS links (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES link_categories(id) ON DELETE CASCADE,
  home_group  TEXT CHECK (home_group IN ('oprations','orders','list')),   -- روابط الصفحة الرئيسية
  name        TEXT NOT NULL,
  description TEXT,
  url         TEXT,
  image       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  CHECK (category_id IS NOT NULL OR home_group IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS policy_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS policies (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES policy_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  file        TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS locations (
  id         SERIAL PRIMARY KEY,
  branch     TEXT NOT NULL,
  photo      TEXT,
  map_link   TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
-- محتوى مرن (الرئيسية، اللجان، موظف الشهر، الهوية البصرية)
CREATE TABLE IF NOT EXISTS portal_docs (
  name       TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- نسخ احتياطية قبل كل حفظ من لوحة تحكم البوابة (بديل مجلد backup)
CREATE TABLE IF NOT EXISTS portal_backups (
  id       BIGSERIAL PRIMARY KEY,
  file     TEXT NOT NULL,
  data     JSONB NOT NULL,
  saved_by TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note     TEXT
);
CREATE INDEX IF NOT EXISTS portal_backups_file_idx ON portal_backups(file, id DESC);

-- التطبيقات التي تظهر في الصفحة الموحّدة وأدوار كل منها
CREATE TABLE IF NOT EXISTS apps (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  path        TEXT NOT NULL,
  roles       TEXT[] NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO apps(slug, title, description, icon, path, roles, sort_order) VALUES
 ('portal', 'بوابة الموظفين', 'دليل الموظفين والهيكل التنظيمي والروابط والسياسات والمواقع', '🏢', '/portal/',
   ARRAY['admin','hr','finance','sector_manager','department_manager','section_manager','executive','employee','content_admin'], 1),
 ('hr', 'أرصدة الإجازات', 'إدارة وتحليل أرصدة الإجازات وتكلفتها المالية', '🌴', '/hr/',
   ARRAY['admin','hr','finance','sector_manager','department_manager','section_manager','executive'], 2),
 ('card', 'بطاقة الموظف', 'إصدار بطاقة الموظف للطباعة (PDF / PNG)', '🪪', '/card/',
   ARRAY['admin','hr','executive','content_admin','employee'], 3),
 ('report', 'تقرير مراكز التوزيع', 'تقرير تقييم مراكز التوزيع الخيري', '📊', '/report/',
   ARRAY['admin','executive','finance','sector_manager','department_manager'], 4),
 ('portal-admin', 'لوحة تحكم البوابة', 'تعديل الموظفين والروابط والسياسات والمواقع', '⚙️', '/portal/admin/',
   ARRAY['admin','content_admin'], 5)
ON CONFLICT (slug) DO NOTHING;
