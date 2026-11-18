// الترحيل 008: منصة «نماذج الموارد البشرية» — قوالب جاهزة (استفسار/لفت نظر/إشعار خصم) تُملأ ببيانات الموظف ويُنسخ نصها، وسجل بما صدر.
//  - hr_form_templates: القوالب قابلة للتعديل والإضافة (نص بمتغيرات {{...}} وحقول إدخال)
//  - hr_form_log: سجل الصادر (من أصدر وما النص) دون حذف
//  - منصة hr-forms في الصلاحيات المركزية: access للدخول، use للإصدار والسجل، manage لإدارة القوالب
const TEMPLATES = [
  {
    slug: 'absence-inquiry', category: 'استفسار', sort_order: 1,
    title: 'استفسار وإفادة عن الغياب أو التأخير',
    description: 'يُحدَّد فيه نوع المخالفة وتواريخها ويكتب الموظف أسبابه، ثم رأي الرئيس المباشر ومرئيات إدارة رأس المال البشري.',
    fields: [
      { key: 'manager', label: 'اسم الرئيس المباشر', type: 'text', required: false, placeholder: 'اسم الرئيس المباشر للموظف' },
      { key: 'absent_dates', label: 'أيام الغياب عن الدوام الرسمي', type: 'dates', required: false },
      { key: 'late_date', label: 'تاريخ التأخر عن الدوام', type: 'date', required: false },
      { key: 'late_duration', label: 'مدة التأخر (ساعة:دقيقة)', type: 'text', required: false, placeholder: '00:30' },
      { key: 'early_date', label: 'تاريخ الخروج قبل نهاية الدوام', type: 'date', required: false },
      { key: 'early_duration', label: 'مدة الخروج المبكر (ساعة:دقيقة)', type: 'text', required: false, placeholder: '01:00' },
      { key: 'noperm_date', label: 'تاريخ الخروج بدون إذن', type: 'date', required: false },
      { key: 'noperm_duration', label: 'مدة الخروج بدون إذن (ساعة:دقيقة)', type: 'text', required: false, placeholder: '01:00' },
      { key: 'tamper_date', label: 'تاريخ التلاعب بالحضور والانصراف', type: 'date', required: false },
      { key: 'tamper_duration', label: 'مدة التلاعب (ساعة:دقيقة)', type: 'text', required: false, placeholder: '00:30' },
      { key: 'deadline', label: 'مهلة إبداء الأسباب', type: 'select', required: true, default: 'يوم', options: [{ value: 'يوم' }, { value: 'يومان' }, { value: 'ثلاثة أيام' }, { value: 'خمسة أيام' }] },
    ],
    body: `التاريخ: {{issue_date|date_num}}م
# استفسار وإفادة
أولاً: المكرم الموظف: {{employee_name}}    الإدارة: {{department}}    الرقم الوظيفي: {{emp_no}}
{{#if absent_dates}}
☑ لقد تغيبت عن الدوام الرسمي في يوم: {{#each absent_dates}}({{this|date}}) {{/each}}
{{/if}}
{{#if late_date}}
☑ لقد تأخرت عن الدوام في يوم ({{late_date|weekday}}) الموافق: ({{late_date|date_num}}) المدة: ({{late_duration}}).
{{/if}}
{{#if early_date}}
☑ لقد خرجت قبل نهاية الدوام في يوم ({{early_date|weekday}}) الموافق: ({{early_date|date_num}}) المدة: ({{early_duration}}).
{{/if}}
{{#if noperm_date}}
☑ لقد خرجت بدون إذن ليوم ({{noperm_date|weekday}}) الموافق: ({{noperm_date|date_num}}) المدة: ({{noperm_duration}}).
{{/if}}
{{#if tamper_date}}
☑ لقد تلاعبت بالحضور والانصراف يوم ({{tamper_date|weekday}}) الموافق: ({{tamper_date|date_num}}) المدة: ({{tamper_duration}}).
{{/if}}
نأمل إبداء الأسباب حيال ذلك في موعد أقصاه {{deadline}} من تاريخه.

ثانياً: (إفادة الموظف عن أسباب الغياب أو التأخير):
..........................................................................................
..........................................................................................
..........................................................................................
اسم الرئيس المباشر: {{manager}}        التوقيع: ..........        التاريخ: ..........

ثالثاً: (رأي الرئيس المباشر):
أ- ☐ عذر مقبول وتحسب مدة الغياب إجازة من رصيد الموظف.
ب- ☐ عذر مقبول نظراً لوجود تقرير طبي بذلك (إرفاق أصل التقرير الطبي).
ج- ☐ عذر غير مقبول وتحسم أيام الغياب.
د- ☐ أخرى: ..........................................................................

رابعاً: مرئيات مدير إدارة رأس المال البشري:
يعتمد ما جاء في الفقرة (          ) أعلاه وتُحال لصاحب الصلاحية للاعتماد.
أخرى: ..........................................................................
الاسم: ................        التوقيع: ..........        التاريخ: ..........`,
  },
  {
    slug: 'attention-notice', category: 'لفت نظر', sort_order: 2,
    title: 'لفت نظر',
    description: 'خطاب لفت نظر بدون إجراء جزائي: عدم البصمة أو التأخر أو الخروج المبكر أو الخروج بدون إذن.',
    fields: [
      { key: 'violation', label: 'نوع المخالفة', type: 'select', required: true, default: 'عدم وجود بصمة', options: [
        { value: 'عدم وجود بصمة', phrase: 'عدم تسجيلكم بصمة الحضور والانصراف', duty: 'تسجيل البصمة عند الحضور والانصراف', demand: 'الالتزام بتسجيل البصمة عند بداية الدوام ونهايته', reason: 'عدم التسجيل' },
        { value: 'التأخر عن الدوام', phrase: 'تأخركم عن موعد بداية الدوام الرسمي', duty: 'الالتزام بمواعيد الدوام الرسمي', demand: 'الحضور في موعد بداية الدوام', reason: 'التأخر' },
        { value: 'الخروج قبل نهاية الدوام', phrase: 'خروجكم قبل نهاية الدوام الرسمي', duty: 'البقاء في مقر العمل حتى نهاية الدوام الرسمي', demand: 'البقاء حتى نهاية الدوام الرسمي', reason: 'الخروج المبكر' },
        { value: 'الخروج بدون إذن', phrase: 'خروجكم من مقر العمل دون إذن مسبق', duty: 'الحصول على إذن مسبق قبل مغادرة مقر العمل', demand: 'الحصول على الإذن المسبق قبل الخروج', reason: 'الخروج دون إذن' },
      ] },
      { key: 'violation_date', label: 'تاريخ المخالفة', type: 'text', required: false, placeholder: 'مثال: 22/11/2026م أو عدة أيام' },
      { key: 'period', label: 'الفترة (اختياري)', type: 'text', required: false, placeholder: 'في عدد من الأيام خلال شهري أكتوبر ونوفمبر 2026م' },
    ],
    body: `التاريخ: {{issue_date|date_num}}م
# لفت نظر
المكرم الأستاذ/ {{employee_name}}
نوع المخالفة / {{violation}}
تاريخ المخالفة / {{violation_date}}

السلام عليكم ورحمة الله وبركاته،
إشارةً إلى ما لوحظ من {{violation.phrase}}{{#if period}} {{period}}{{/if}}، نلفت عنايتكم إلى أن {{violation.duty}} التزام وظيفي يتعين التقيد به، وعليه نوجّه لكم لفت النظر هذا، ونؤكد وجوب {{violation.demand}}، وعدم تكرار ذلك.
كما يتعين عليكم إفادة إدارة الموارد البشرية بأسباب {{violation.reason}} في الأيام المشار إليها، وإرفاق المستندات المؤيدة إن وجدت.
وسيُكتفى بهذا الخطاب كلفت نظر دون اتخاذ إجراء جزائي، على أن تُتخذ الإجراءات المعتمدة في حال تكرار ذلك.
مع تمنياتنا لكم بدوام الصحة والتوفيق.

مدير إدارة رأس المال البشري`,
  },
  {
    slug: 'deduction-notice', category: 'إشعار خصم', sort_order: 3,
    title: 'إشعار بالخصم (غياب دون عذر)',
    description: 'إشعار بحسم أيام الغياب دون عذر من راتب شهر محدد مع جزاء يوم أو أكثر.',
    fields: [
      { key: 'absent_dates', label: 'أيام الغياب دون عذر', type: 'dates', required: true },
      { key: 'deduction_month', label: 'شهر الراتب المخصوم منه', type: 'month', required: true, suggest: 'next_month_of:absent_dates' },
      { key: 'penalty', label: 'الجزاء الإضافي', type: 'select', required: false, default: 'يوم واحد', options: [{ value: 'يوم واحد' }, { value: 'يومين' }, { value: 'ثلاثة أيام' }, { value: '', label: 'بدون جزاء' }] },
    ],
    body: `التاريخ: {{issue_date|date_num}}م
من: إدارة الموارد البشرية
المكرم الأستاذ: {{employee_name}}
الرقم الوظيفي: {{emp_no}}
الموضوع: إشعار بالخصم
ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ
نفيدكم بأنه تم تسجيل غيابكم دون عذر أو طلب رسمي معتمد في الأيام التالية:
{{#each absent_dates}}
{{this|date}}.
{{/each}}
وعليه، سيتم حسم أجر {{absent_dates|days_construct}} من راتب شهر {{deduction_month|month_ar}}{{#if penalty}}، بالإضافة إلى حسم أجر {{penalty}} كجزاء{{/if}}، وفقًا للأنظمة واللوائح المعتمدة.
وفي حال تكرار الغياب، سيتم تطبيق الجزاءات النظامية المقررة.

مدير إدارة رأس المال البشري`,
  },
];

export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS hr_form_templates (
      id          SERIAL PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'إنذارات',
      description TEXT,
      body        TEXT NOT NULL,
      fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      version     INTEGER NOT NULL DEFAULT 1,
      created_by  TEXT,
      updated_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hr_form_log (
      id             BIGSERIAL PRIMARY KEY,
      template_id    INTEGER REFERENCES hr_form_templates(id) ON DELETE SET NULL,
      template_title TEXT NOT NULL,
      employee_id    INTEGER,
      employee_name  TEXT NOT NULL,
      emp_no         TEXT,
      department     TEXT,
      values         JSONB NOT NULL DEFAULT '{}'::jsonb,
      body_text      TEXT NOT NULL,
      action         TEXT NOT NULL DEFAULT 'copy',
      issued_by      TEXT,
      issued_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hr_form_log_emp_idx ON hr_form_log(employee_id, issued_at DESC);
    CREATE INDEX IF NOT EXISTS hr_form_log_time_idx ON hr_form_log(issued_at DESC);`);
  for (const t of TEMPLATES) {
    await c.query(`INSERT INTO hr_form_templates(slug, title, category, description, body, fields, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'system')
      ON CONFLICT (slug) DO NOTHING`, [t.slug, t.title, t.category, t.description, t.body, JSON.stringify(t.fields), t.sort_order]);
  }
  await c.query(`INSERT INTO apps(slug, title, description, icon, path, roles, sort_order)
    VALUES ('hr-forms', 'نماذج الموارد البشرية', 'قوالب جاهزة للاستفسار ولفت النظر وإشعارات الخصم تُملأ ببيانات الموظف ويُنسخ نصها', 'file-text', '/hr-forms/', '{}', 5)
    ON CONFLICT (slug) DO NOTHING`);
  const ACTIONS = [['access', 'الوصول للمنصة'], ['use', 'إصدار النماذج وعرض سجل الصادر'], ['manage', 'إدارة القوالب (إضافة وتعديل وإيقاف)']];
  for (const [i, [action, label]] of ACTIONS.entries()) await c.query('INSERT INTO app_actions(app_slug, action, label, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['hr-forms', action, label, i]);
  const hr = (await c.query("SELECT id FROM roles WHERE key = 'hr'")).rows[0];
  if (hr) for (const [action] of ACTIONS) await c.query("INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,'hr-forms',$2,'all') ON CONFLICT DO NOTHING", [hr.id, action]);
  return { templates: TEMPLATES.length, granted_roles: hr ? 1 : 0 };
}
