-- نظام أعضاء الجمعية العمومية (داخل المنصة الموحّدة)
-- الترحيل 001: المخطط الأساسي في المخطط members. المبالغ NUMERIC(12,2). المنطقة الزمنية Asia/Riyadh.
-- حسابات الدخول مشتركة مع المنصة: الجدول public.users (لا يوجد جدول users هنا).

CREATE SCHEMA IF NOT EXISTS members;
SET LOCAL search_path TO members, public;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- ───────── المستخدمون والصلاحيات ─────────
CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE permissions (
  id       SMALLSERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name_ar  TEXT NOT NULL,
  grp      TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id       SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ربط أدوار المنصة (public.users.role) بأدوار هذا النظام. الدور غير المربوط لا يدخل النظام.
CREATE TABLE role_map (
  hr_role TEXT PRIMARY KEY,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE
);

-- ───────── الإعدادات ─────────
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION riyadh_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date $$;

CREATE FUNCTION app_setting_num(k TEXT, d NUMERIC) RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = members, public AS
$$ SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = k), d) $$;

-- ───────── أنواع العضوية والأعضاء ─────────
CREATE TABLE membership_types (
  id                     SERIAL PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name_ar                TEXT NOT NULL UNIQUE,
  default_fee            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_fee >= 0),
  default_duration_months INTEGER NOT NULL DEFAULT 12 CHECK (default_duration_months BETWEEN 1 AND 120),
  fee_exempt             BOOLEAN NOT NULL DEFAULT FALSE,  -- يسمح بالإعفاء من الرسوم
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE member_no_seq START 1;

CREATE TABLE members (
  id          BIGSERIAL PRIMARY KEY,
  member_no   TEXT NOT NULL UNIQUE DEFAULT ('H-' || lpad(nextval('member_no_seq')::text, 6, '0')),
  full_name   TEXT NOT NULL CHECK (length(btrim(full_name)) >= 3),
  phone       TEXT,
  email       TEXT,
  joined_at   DATE NOT NULL,
  -- الحالة الإدارية فقط. حالة الصلاحية الفعلية تُحسب من التواريخ والقواعد (انظر member_overview).
  admin_status TEXT NOT NULL DEFAULT 'normal' CHECK (admin_status IN ('normal','suspended','cancelled')),
  admin_status_reason TEXT,
  notes       TEXT,
  archived_at TIMESTAMPTZ,
  created_by  BIGINT REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX members_phone_idx ON members (phone);
CREATE INDEX members_email_idx ON members (lower(email));
CREATE INDEX members_name_trgm ON members USING gin (full_name gin_trgm_ops);

-- دورة العضوية (فترة صلاحية). التجديد ينشئ دورة جديدة ولا يعدّل السابقة.
CREATE TABLE membership_periods (
  id                 BIGSERIAL PRIMARY KEY,
  member_id          BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  membership_type_id INTEGER NOT NULL REFERENCES membership_types(id),
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,   -- شاملة لهذا اليوم
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  kind               TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','renewal')),
  created_by         BIGINT REFERENCES public.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  -- منع تداخل دورات العضو الفعالة
  CONSTRAINT membership_periods_no_overlap
    EXCLUDE USING gist (member_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (status = 'active')
);
CREATE INDEX membership_periods_member_idx ON membership_periods (member_id, end_date DESC);
CREATE INDEX membership_periods_end_idx ON membership_periods (end_date) WHERE status = 'active';

-- الالتزام المالي لكل دورة (واحد لكل دورة)
CREATE TABLE subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  period_id  BIGINT NOT NULL UNIQUE REFERENCES membership_periods(id) ON DELETE RESTRICT,
  member_id  BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  due_date   DATE NOT NULL,
  is_exempt  BOOLEAN NOT NULL DEFAULT FALSE,
  exempt_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_member_idx ON subscriptions (member_id);
CREATE INDEX subscriptions_due_idx ON subscriptions (due_date);

-- المدفوعات: لا تُحذف أبدًا؛ الإلغاء يتم بحالة voided مع سبب.
CREATE TABLE payments (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  member_id       BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at         DATE NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','card','cheque','other','opening_balance')),
  reference       TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','voided')),
  idempotency_key TEXT,
  voided_at       TIMESTAMPTZ,
  voided_by       BIGINT REFERENCES public.users(id),
  void_reason     TEXT,
  created_by      BIGINT REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);
CREATE INDEX payments_subscription_idx ON payments (subscription_id) WHERE status = 'confirmed';
CREATE INDEX payments_paid_at_idx ON payments (paid_at) WHERE status = 'confirmed';
CREATE INDEX payments_member_idx ON payments (member_id);
-- منع تكرار نفس المرجع البنكي/رقم الإيصال
CREATE UNIQUE INDEX payments_reference_uq ON payments (lower(btrim(reference)))
  WHERE status = 'confirmed' AND reference IS NOT NULL AND btrim(reference) <> '';
-- منع تكرار الإرسال المزدوج للنموذج نفسه
CREATE UNIQUE INDEX payments_idempotency_uq ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment_attachments (
  id            BIGSERIAL PRIMARY KEY,
  payment_id    BIGINT REFERENCES payments(id) ON DELETE RESTRICT,
  member_id     BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt','document')),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256        TEXT NOT NULL,
  uploaded_by   BIGINT REFERENCES public.users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CHECK (kind <> 'receipt' OR payment_id IS NOT NULL)
);
CREATE INDEX payment_attachments_member_idx ON payment_attachments (member_id);
CREATE INDEX payment_attachments_payment_idx ON payment_attachments (payment_id);

-- ───────── الإشعارات ─────────
CREATE TABLE notification_templates (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('internal','email','sms')),
  name_ar     TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  approved_at TIMESTAMPTZ,   -- اعتماد القالب (شرط للإرسال الخارجي)
  tested_at   TIMESTAMPTZ,   -- اختبار القالب (شرط للإرسال الخارجي)
  updated_by  BIGINT REFERENCES public.users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, channel)
);

CREATE TABLE notifications (
  id              BIGSERIAL PRIMARY KEY,
  member_id       BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE RESTRICT,
  period_id       BIGINT REFERENCES membership_periods(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'internal' CHECK (channel IN ('internal','email','sms')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','dismissed','sent','failed')),
  dedupe_key      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  read_by         BIGINT REFERENCES public.users(id),
  UNIQUE (dedupe_key, channel)
);
CREATE INDEX notifications_member_idx ON notifications (member_id, created_at DESC);
CREATE INDEX notifications_status_idx ON notifications (status, created_at DESC);

-- ───────── سجل التدقيق (إضافة فقط) ─────────
CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES public.users(id),
  username   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  before     JSONB,
  after      JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ───────── دفعات الاستيراد ─────────
CREATE TABLE import_batches (
  id          BIGSERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mapping     JSONB NOT NULL DEFAULT '{}',
  options     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','committed','cancelled')),
  summary     JSONB,
  created_by  BIGINT REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ
);

-- ───────── المشاهد: كل الأرقام والحالات تُحسب في قاعدة البيانات ─────────

-- رصيد كل اشتراك وحالة السداد المالي (مستقلة تمامًا عن حالة العضوية)
CREATE VIEW subscription_balances AS
SELECT
  s.id AS subscription_id, s.period_id, s.member_id, s.amount_due, s.due_date, s.is_exempt,
  COALESCE(pp.paid, 0)::numeric(12,2) AS paid,
  CASE WHEN s.is_exempt THEN 0 ELSE GREATEST(s.amount_due - COALESCE(pp.paid, 0), 0) END::numeric(12,2) AS remaining,
  pp.last_paid_at,
  CASE
    WHEN s.is_exempt THEN 'exempt'
    WHEN COALESCE(pp.paid, 0) >= s.amount_due THEN 'paid'
    WHEN s.due_date < riyadh_today() THEN 'overdue'
    WHEN COALESCE(pp.paid, 0) > 0 THEN 'partial'
    WHEN s.due_date > riyadh_today() THEN 'not_yet_due'
    ELSE 'unpaid'
  END AS payment_status,
  (NOT s.is_exempt AND COALESCE(pp.paid, 0) > 0 AND COALESCE(pp.paid, 0) < s.amount_due) AS is_partial,
  CASE WHEN NOT s.is_exempt AND COALESCE(pp.paid, 0) < s.amount_due AND s.due_date < riyadh_today()
       THEN riyadh_today() - s.due_date ELSE 0 END AS overdue_days
FROM subscriptions s
JOIN membership_periods mp ON mp.id = s.period_id AND mp.status = 'active'
LEFT JOIN LATERAL (
  SELECT SUM(p.amount) AS paid, MAX(p.paid_at) AS last_paid_at
  FROM payments p WHERE p.subscription_id = s.id AND p.status = 'confirmed'
) pp ON TRUE;

CREATE VIEW member_overview_base AS
SELECT
  m.id, m.member_no, m.full_name, m.phone, m.email, m.joined_at, m.admin_status, m.admin_status_reason,
  m.notes, m.archived_at, m.created_at, m.updated_at,
  lp.id AS period_id, lp.membership_type_id, mt.name_ar AS type_name, mt.code AS type_code, mt.fee_exempt AS type_fee_exempt,
  lp.start_date AS period_start, lp.end_date AS period_end,
  cp.id AS covering_period_id,
  lsb.subscription_id, lsb.amount_due, lsb.paid, lsb.remaining, lsb.due_date, lsb.last_paid_at, lsb.is_exempt,
  lsb.payment_status AS latest_payment_status, lsb.is_partial,
  COALESCE(agg.total_due, 0)::numeric(12,2) AS total_due,
  COALESCE(agg.total_paid, 0)::numeric(12,2) AS total_paid,
  COALESCE(agg.total_remaining, 0)::numeric(12,2) AS total_remaining,
  COALESCE(agg.any_overdue, FALSE) AS any_overdue,
  COALESCE(agg.max_overdue_days, 0) AS max_overdue_days,
  csb.amount_due AS cov_due, csb.paid AS cov_paid, csb.is_exempt AS cov_exempt,
  (SELECT COUNT(*) FROM membership_periods r WHERE r.member_id = m.id AND r.status = 'active') AS periods_count,
  (SELECT MIN(start_date) FROM membership_periods r WHERE r.member_id = m.id AND r.status = 'active' AND r.start_date > riyadh_today()) AS next_start
FROM members m
LEFT JOIN LATERAL (
  SELECT p.* FROM membership_periods p WHERE p.member_id = m.id AND p.status = 'active'
  ORDER BY p.end_date DESC, p.id DESC LIMIT 1) lp ON TRUE
LEFT JOIN membership_types mt ON mt.id = lp.membership_type_id
LEFT JOIN LATERAL (
  SELECT p.id FROM membership_periods p
  WHERE p.member_id = m.id AND p.status = 'active'
    AND p.start_date <= riyadh_today()
    AND p.end_date + (app_setting_num('rules.grace_days', 0))::int >= riyadh_today()
  ORDER BY p.end_date DESC LIMIT 1) cp ON TRUE
LEFT JOIN subscription_balances lsb ON lsb.period_id = lp.id
LEFT JOIN subscription_balances csb ON csb.period_id = cp.id
LEFT JOIN LATERAL (
  SELECT SUM(sb.amount_due) FILTER (WHERE NOT sb.is_exempt) AS total_due,
         SUM(sb.paid) FILTER (WHERE NOT sb.is_exempt) AS total_paid,
         SUM(sb.remaining) AS total_remaining,
         BOOL_OR(sb.payment_status = 'overdue') AS any_overdue,
         MAX(sb.overdue_days) AS max_overdue_days
  FROM subscription_balances sb WHERE sb.member_id = m.id) agg ON TRUE;

-- حالة العضوية (صلاحية) منفصلة عن حالة السداد.
-- القواعد القابلة للضبط: rules.expiry_warning_days, rules.grace_days,
-- rules.activation_min_paid_percent (0 = لا يُشترط سداد للتفعيل), rules.expire_overdue_days (0 = لا إنهاء بسبب التأخر)
CREATE VIEW member_overview AS
SELECT b.*,
  CASE
    WHEN b.admin_status = 'cancelled' THEN 'cancelled'
    WHEN b.admin_status = 'suspended' THEN 'suspended'
    WHEN b.period_id IS NULL THEN 'pending'
    WHEN b.covering_period_id IS NULL THEN
      CASE WHEN b.next_start IS NOT NULL AND b.period_end >= riyadh_today() THEN 'pending' ELSE 'expired' END
    WHEN app_setting_num('rules.expire_overdue_days', 0) > 0
         AND b.max_overdue_days > app_setting_num('rules.expire_overdue_days', 0) THEN 'expired'
    WHEN app_setting_num('rules.activation_min_paid_percent', 0) > 0
         AND NOT COALESCE(b.cov_exempt, FALSE)
         AND b.cov_due > 0
         AND (b.cov_paid * 100 / b.cov_due) < app_setting_num('rules.activation_min_paid_percent', 0) THEN 'pending'
    WHEN b.period_end - riyadh_today() <= app_setting_num('rules.expiry_warning_days', 30) THEN 'near_expiry'
    ELSE 'active'
  END AS membership_status,
  CASE
    WHEN b.period_id IS NULL THEN NULL
    WHEN b.any_overdue THEN 'overdue'
    ELSE b.latest_payment_status
  END AS payment_status,
  (b.period_end - riyadh_today()) AS days_to_expiry
FROM member_overview_base b;

-- ───────── البيانات المرجعية (ليست بيانات وهمية) ─────────
INSERT INTO roles (code, name_ar, description) VALUES
  ('admin',      'مدير النظام',    'جميع الصلاحيات'),
  ('membership', 'مسؤول العضويات', 'إضافة الأعضاء وتعديل بياناتهم وإدارة التجديد'),
  ('finance',    'المسؤول المالي', 'إدارة المدفوعات والاشتراكات والتقارير المالية'),
  ('viewer',     'مستخدم للعرض فقط', 'مشاهدة البيانات المصرح بها دون تعديل');

INSERT INTO permissions (code, name_ar, grp) VALUES
  ('dashboard.view',      'عرض لوحة التحكم',             'عام'),
  ('members.view',        'عرض الأعضاء',                'الأعضاء'),
  ('members.create',      'إضافة عضو',                  'الأعضاء'),
  ('members.edit',        'تعديل بيانات الأعضاء',        'الأعضاء'),
  ('members.archive',     'أرشفة الأعضاء واستعادتهم',    'الأعضاء'),
  ('members.status',      'تعليق/إلغاء العضوية إداريًا', 'الأعضاء'),
  ('members.renew',       'تجديد العضوية',               'الأعضاء'),
  ('members.import',      'استيراد الأعضاء',             'الأعضاء'),
  ('members.export',      'تصدير الأعضاء',               'الأعضاء'),
  ('documents.view',      'عرض مستندات الأعضاء',         'المرفقات'),
  ('documents.manage',    'رفع مستندات الأعضاء وحذفها',  'المرفقات'),
  ('payments.view',       'عرض المدفوعات',               'المالية'),
  ('payments.create',     'تسجيل مدفوعات',               'المالية'),
  ('payments.edit',       'تعديل المدفوعات',             'المالية'),
  ('payments.void',       'إلغاء المدفوعات',             'المالية'),
  ('receipts.view',       'عرض إيصالات السداد',          'المالية'),
  ('subscriptions.edit',  'تعديل قيمة الاشتراك ومواعيده', 'المالية'),
  ('reports.view',        'التقارير العامة',             'التقارير'),
  ('reports.financial',   'التقارير المالية',            'التقارير'),
  ('notifications.view',  'عرض مركز التنبيهات',          'التنبيهات'),
  ('notifications.manage','إدارة التنبيهات والقوالب',    'التنبيهات'),
  ('settings.view',       'عرض الإعدادات',               'الإدارة'),
  ('settings.manage',     'تعديل الإعدادات',             'الإدارة'),
  ('users.manage',        'إدارة المستخدمين والأدوار',   'الإدارة'),
  ('audit.view',          'عرض سجل التدقيق',             'الإدارة');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view','members.view','members.create','members.edit','members.archive','members.status',
  'members.renew','members.import','members.export','documents.view','documents.manage','payments.view',
  'reports.view','notifications.view') WHERE r.code = 'membership';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view','members.view','members.export','payments.view','payments.create','payments.edit',
  'payments.void','receipts.view','subscriptions.edit','reports.view','reports.financial','notifications.view')
WHERE r.code = 'finance';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'dashboard.view','members.view','payments.view','reports.view') WHERE r.code = 'viewer';

INSERT INTO membership_types (code, name_ar, default_fee, default_duration_months, fee_exempt, sort_order) VALUES
  ('regular',  'عادية', 0, 12, FALSE, 1),
  ('active',   'عاملة', 0, 12, FALSE, 2),
  ('honorary', 'فخرية', 0, 12, TRUE,  3);

INSERT INTO system_settings (key, value) VALUES
  ('org.name',                          '"جمعية هدية"'),
  ('org.logo',                          'null'),
  ('brand.primary',                     '"#0F5C4D"'),
  ('fees.default_amount',               '0'),
  ('membership.default_duration_months','12'),
  ('rules.expiry_warning_days',         '30'),
  ('rules.grace_days',                  '0'),
  ('rules.activation_min_paid_percent', '0'),
  ('rules.expire_overdue_days',         '0'),
  ('import.duplicate_rules',            '["phone","email"]'),
  ('notifications.external_enabled',    'false'),
  ('email.provider',                    '"none"'),
  ('email.from_name',                   '"جمعية هدية"'),
  ('email.from_address',                '""'),
  ('sms.provider',                      '"none"'),
  ('sms.sender_id',                     '""');

INSERT INTO notification_templates (type, channel, name_ar, subject, body) VALUES
  ('due_30',      'internal', 'قبل الاستحقاق بـ30 يومًا', NULL, 'يستحق اشتراك {{member_name}} ({{member_no}}) بمبلغ {{amount_remaining}} ريال بتاريخ {{due_date}}.'),
  ('due_15',      'internal', 'قبل الاستحقاق بـ15 يومًا', NULL, 'تبقى 15 يومًا أو أقل على استحقاق اشتراك {{member_name}} ({{member_no}}): المتبقي {{amount_remaining}} ريال، الاستحقاق {{due_date}}.'),
  ('due_7',       'internal', 'قبل الاستحقاق بـ7 أيام',   NULL, 'تبقى 7 أيام أو أقل على استحقاق اشتراك {{member_name}} ({{member_no}}): المتبقي {{amount_remaining}} ريال، الاستحقاق {{due_date}}.'),
  ('due_today',   'internal', 'يوم الاستحقاق',            NULL, 'اليوم موعد استحقاق اشتراك {{member_name}} ({{member_no}}): المتبقي {{amount_remaining}} ريال.'),
  ('overdue',     'internal', 'تجاوز موعد السداد',        NULL, 'تجاوز {{member_name}} ({{member_no}}) موعد السداد ({{due_date}}) والمتبقي {{amount_remaining}} ريال.'),
  ('expiry_soon', 'internal', 'قرب انتهاء العضوية',       NULL, 'تنتهي عضوية {{member_name}} ({{member_no}}) بتاريخ {{end_date}}.'),
  ('expired',     'internal', 'انتهاء العضوية',           NULL, 'انتهت عضوية {{member_name}} ({{member_no}}) بتاريخ {{end_date}}.'),
  ('due_7',       'email', 'بريد: قبل الاستحقاق بـ7 أيام', 'تذكير باستحقاق الاشتراك – {{org_name}}', 'السيد/ة {{member_name}}،\nنذكّركم بموعد استحقاق اشتراك العضوية بتاريخ {{due_date}} والمبلغ المتبقي {{amount_remaining}} ريال.\n{{org_name}}'),
  ('overdue',     'email', 'بريد: تجاوز موعد السداد',      'تأخر سداد الاشتراك – {{org_name}}', 'السيد/ة {{member_name}}،\nنفيدكم بتجاوز موعد سداد الاشتراك ({{due_date}}) والمتبقي {{amount_remaining}} ريال.\n{{org_name}}'),
  ('expiry_soon', 'email', 'بريد: قرب انتهاء العضوية',     'قرب انتهاء العضوية – {{org_name}}', 'السيد/ة {{member_name}}،\nتنتهي عضويتكم بتاريخ {{end_date}}. نأمل تجديدها.\n{{org_name}}'),
  ('due_7',       'sms', 'رسالة: قبل الاستحقاق بـ7 أيام', NULL, '{{org_name}}: يستحق اشتراككم بتاريخ {{due_date}} والمتبقي {{amount_remaining}} ر.س'),
  ('overdue',     'sms', 'رسالة: تجاوز موعد السداد',      NULL, '{{org_name}}: تجاوز اشتراككم موعد السداد ({{due_date}}) والمتبقي {{amount_remaining}} ر.س');

INSERT INTO role_map (hr_role, role_id)
SELECT m.hr_role, r.id FROM (VALUES ('admin','admin'),('hr','membership'),('finance','finance'),('executive','viewer')) AS m(hr_role, role_code)
JOIN roles r ON r.code = m.role_code;

-- تسجيل النظام في قائمة تطبيقات المنصة (يتحكم بمن يراه في الصفحة الرئيسية وبالوصول إلى /members/)
INSERT INTO public.apps (slug, title, description, icon, path, roles, sort_order) VALUES
  ('members', 'أعضاء الجمعية العمومية', 'قاعدة بيانات الأعضاء والاشتراكات والتجديد والتقارير', '👥', '/members/', ARRAY['admin','hr','finance','executive'], 6)
ON CONFLICT (slug) DO NOTHING;
