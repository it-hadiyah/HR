// الترحيل 022: «طلبات الموظفين» — يرفع الموظف طلب خطاب تعريف بالراتب أو تثبيت بالراتب، وتعتمده الموارد البشرية،
// فيصدر المستند مختوماً (لقطة نصية ثابتة برقم مرجع) ينزّله الموظف ويحفظه.
//  - hr_requests: الطلب وحالته والمستند الصادر
//  - منصة hr-requests: access (رفع الطلبات وعرض طلباتي) · review (مراجعة الطلبات واعتمادها أو رفضها)
export async function up(c) {
  await c.query(`
    CREATE SEQUENCE IF NOT EXISTS hr_requests_ref_seq;
    CREATE TABLE IF NOT EXISTS hr_requests (
      id              SERIAL PRIMARY KEY,
      ref_no          TEXT NOT NULL UNIQUE,
      type            TEXT NOT NULL CHECK (type IN ('certificate','fixation')),
      employee_id     INTEGER NOT NULL REFERENCES leave_staff(id) ON DELETE CASCADE,
      requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      requester_name  TEXT,
      params          JSONB NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
      decided_by      TEXT,
      decided_at      TIMESTAMPTZ,
      decision_note   TEXT,
      document_text   TEXT,
      document_data   JSONB,
      document_hash   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hr_requests_status_idx ON hr_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS hr_requests_emp_idx ON hr_requests(employee_id, created_at DESC);`);
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('hr-requests', 'طلبات الموظفين', 'رفع طلب خطاب تعريف بالراتب أو تثبيت بالراتب واعتماده من الموارد البشرية وتنزيله مختوماً', 'file-pen-line', '/hr-requests/', '{}', 3)
    ON CONFLICT (slug) DO NOTHING`);
  const ACTIONS = [['access', 'رفع الطلبات وعرض طلباتي'], ['review', 'مراجعة الطلبات واعتمادها أو رفضها']];
  for (const [i, [action, label]] of ACTIONS.entries()) await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['hr-requests', action, label, i]);
  const GRANTS = { employee: ['access'], hr: ['access', 'review'] };
  for (const [role, actions] of Object.entries(GRANTS)) {
    const r = (await c.query('SELECT id FROM roles WHERE key = $1', [role])).rows[0];
    if (r) for (const a of actions) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'hr-requests',$2,'all') ON CONFLICT DO NOTHING", [r.id, a]);
  }
  return { granted: Object.keys(GRANTS) };
}
