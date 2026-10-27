-- الترحيل 003: سجل التدقيق المركزي (audit_logs) وسجل تغييرات قاعدة البيانات (db_change_log)

CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id        INTEGER,
  username       TEXT,
  platform       TEXT,                    -- slug المنصة التي حدثت فيها العملية
  action         TEXT NOT NULL,           -- login, login_failed, logout, create, update, delete, move, export, denied …
  entity         TEXT,                    -- الجدول أو الكيان المتأثر
  entity_id      TEXT,
  before         JSONB,                   -- القيم السابقة (بعد إخفاء الحقول الحساسة)
  after          JSONB,
  ip             TEXT,
  user_agent     TEXT,
  session_id     TEXT,
  request_id     TEXT,
  correlation_id TEXT,                    -- يربط عمليات الطلب المعقد الواحد
  result         TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied')),
  reason         TEXT,
  source         TEXT NOT NULL DEFAULT 'app'
);
CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs(at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_platform_idx ON audit_logs(platform, at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action, at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity, entity_id);

-- السجل لا يُعدَّل ولا يُحذف ولا يُفرَّغ من أي واجهة أو استعلام عادي
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs سجل للإضافة فقط: لا يمكن التعديل أو الحذف' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS audit_logs_no_change ON audit_logs;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- نقل السجل القديم كما هو (الجدول القديم يبقى دون حذف)
INSERT INTO audit_logs(at, user_id, username, platform, action, entity, entity_id, before, after, source)
SELECT at, user_id, username, 'hr', action, entity, entity_id, before, after, 'legacy' FROM audit_log;

-- تغييرات قاعدة البيانات على مستوى الصف، حتى المباشرة منها (psql / pgAdmin) والتي لا تُنسب لمستخدم التطبيق.
-- direct = true عندما لا يكون application_name هو hadiyah-platform، فيُسجَّل مستخدم القاعدة وعنوان العميل.
CREATE TABLE IF NOT EXISTS db_change_log (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_name   TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  row_id       TEXT,
  old_row      JSONB,
  new_row      JSONB,
  changed_cols TEXT[],
  db_user      TEXT,
  app_name     TEXT,
  client_addr  TEXT,
  txid         BIGINT,
  direct       BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS db_change_log_at_idx ON db_change_log(at DESC);
CREATE INDEX IF NOT EXISTS db_change_log_table_idx ON db_change_log(table_name, at DESC);
CREATE INDEX IF NOT EXISTS db_change_log_direct_idx ON db_change_log(direct, at DESC);

CREATE OR REPLACE FUNCTION db_change_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  oldj jsonb; newj jsonb; cols text[]; rid text;
  skip text[] := ARRAY['updated_at','last_login_at','failed_logins','locked_until','version'];
  secret text[] := ARRAY['password_hash'];
  app text := coalesce(current_setting('application_name', true), '');
BEGIN
  IF TG_OP <> 'INSERT' THEN oldj := to_jsonb(OLD) - secret; END IF;
  IF TG_OP <> 'DELETE' THEN newj := to_jsonb(NEW) - secret; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key) INTO cols FROM jsonb_each(newj) n WHERE n.value IS DISTINCT FROM (oldj -> n.key);
    IF (to_jsonb(OLD) ->> 'password_hash') IS DISTINCT FROM (to_jsonb(NEW) ->> 'password_hash') THEN
      cols := coalesce(cols, '{}'::text[]) || 'password_hash'::text;
      newj := newj || '{"password_hash":"[تغيّرت]"}'::jsonb;      -- لا تُخزَّن القيمة نفسها
    END IF;
    IF cols IS NULL OR cols <@ skip THEN RETURN NULL; END IF;     -- لا تغيير فعلي (أو تغيير تقني فقط)
  END IF;
  rid := coalesce(newj ->> 'id', oldj ->> 'id', newj ->> 'key', oldj ->> 'key', newj ->> 'day', oldj ->> 'day');
  INSERT INTO db_change_log(table_name, op, row_id, old_row, new_row, changed_cols, db_user, app_name, client_addr, txid, direct)
  VALUES (TG_TABLE_NAME, TG_OP, rid, oldj, newj, cols, current_user, app, host(inet_client_addr()), txid_current(), app <> 'hadiyah-platform');
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','org_units','users','roles','role_grants','user_roles','user_grants','apps','platform_settings',
                           'leave_transactions','targets','employee_allowances','salary_history','settings','holidays'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'z_db_change_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION db_change_capture()', 'z_db_change_' || t, t);
  END LOOP;
END $$;
