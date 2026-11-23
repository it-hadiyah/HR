// الترحيل 029: «الهيكل الوظيفي» مستقل عن الموظفين: وظائف (مقاعد) تُعرَّف في وحدات الهيكل التنظيمي، ثم يُنشأ الموظف ويُسكَن في وظيفة منها.
//  - hr_positions: الوظيفة (مسمى، رمز، وحدة، ترفع إلى، درجة، عدد المقاعد). تبقى قائمة ولو كانت شاغرة.
//  - leave_staff.position_id: الوظيفة التي يشغلها الموظف؛ مسماه ووحدته يُشتقّان منها.
//  - صلاحية جديدة في hr-employees: structure (إدارة الهيكل الوظيفي) للموارد البشرية
export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS hr_positions (
      id           SERIAL PRIMARY KEY,
      code         TEXT,
      title        TEXT NOT NULL,
      org_unit_id  INTEGER NOT NULL REFERENCES org_units(id) ON DELETE RESTRICT,
      parent_id    INTEGER REFERENCES hr_positions(id) ON DELETE SET NULL,
      grade        TEXT,
      headcount    INTEGER NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 500),
      active       BOOLEAN NOT NULL DEFAULT TRUE,
      notes        TEXT,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      version      INTEGER NOT NULL DEFAULT 1,
      created_by   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hr_positions_code_key ON hr_positions(code) WHERE code IS NOT NULL;
    CREATE INDEX IF NOT EXISTS hr_positions_unit_idx ON hr_positions(org_unit_id);
    ALTER TABLE leave_staff ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES hr_positions(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS leave_staff_position_idx ON leave_staff(position_id);`);
  await c.query("INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ('hr-employees', 'structure', 'إدارة الهيكل الوظيفي (إضافة وتعديل الوظائف)', 6) ON CONFLICT DO NOTHING");
  const r = (await c.query("SELECT id FROM roles WHERE key = 'hr'")).rows[0];
  if (r) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'hr-employees','structure','all') ON CONFLICT DO NOTHING", [r.id]);
  return { granted: r ? ['hr'] : [] };
}
