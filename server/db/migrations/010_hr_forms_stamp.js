// الترحيل 010: قالب «تثبيت بالراتب» + إعدادات الختم الرسمي (يظهر ثابتاً في كل النماذج ويمكن استبداله من الإعدادات)
const TEMPLATE = {
  slug: 'salary-fixation', category: 'خطابات', sort_order: 4,
  title: 'تثبيت بالراتب (خطاب للبنك)',
  description: 'تعهد للبنك بتحويل راتب الموظف على حسابه وإبلاغه عند انتهاء الخدمة. تحدد البنك ورقم الآيبان.',
  fields: [
    { key: 'bank', label: 'اسم البنك', type: 'text', required: true, default: 'بنك الإنماء' },
    { key: 'iban', label: 'رقم الآيبان (IBAN)', type: 'text', required: true, placeholder: 'SA00 0000 0000 0000 0000 0000' },
    { key: 'nationality', label: 'جنسية الموظف', type: 'text', required: true, default: 'سعودي' },
    { key: 'manager', label: 'اسم مدير الإدارة الموقِّع', type: 'text', required: true, default: 'محمد إبراهيم كشك' },
  ],
  body: `التاريخ: {{issue_date|date_num}}م
# تثبيت بالراتب
السادة / {{bank}}          المحترمين
الموضوع: رواتب ومستحقات السيد/ {{employee_name}}
حيث أن المذكور {{nationality}} الجنسية، والذي يعمل موظفاً لدينا قد أشعرنا برغبته بتثبيت راتبه وطلب إلينا في ذلك الصدد أن نقوم بتحويل مرتباته الشهرية إليكم في تواريخ استحقاقه على حساب رقم ({{iban}})، فإننا بموجب هذا نتعهد بأن نقوم بتحويل مرتباته الشهرية وأن نقوم كذلك في حالة إنهاء أو انتهاء خدمة المذكور معنا لأي سبب كان بإبلاغكم خطياً بذلك ومن ثم تحويل جميع ما قد يكون مستحقاً له حينذاك من مكافأة أو معاش أو أية مبالغ أخرى لديكم، وتستمر تعهداتنا المدرجة هنا نافذة وسارية المفعول لحين إنهاء أو انتهاء خدمة المذكور لدينا أو حتى استلامنا لإشعار خطي منكم بإعفائنا من التزاماتنا الواردة أعلاه.

وإشهاداً على ما ورد قمنا بوضع توقيعنا وخاتمنا الرسمي،

الختم الرسمي

مدير الإدارة
{{manager}}
التوقيع: ..............................................`,
};

export async function up(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS hr_form_settings (
      key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hr_form_assets (
      key TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  await c.query("INSERT INTO hr_form_settings(key, value, updated_by) VALUES ('stamp_enabled', 'true', 'system') ON CONFLICT (key) DO NOTHING");
  await c.query(`INSERT INTO hr_form_templates(slug, title, category, description, body, fields, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'system')
    ON CONFLICT (slug) DO NOTHING`, [TEMPLATE.slug, TEMPLATE.title, TEMPLATE.category, TEMPLATE.description, TEMPLATE.body, JSON.stringify(TEMPLATE.fields), TEMPLATE.sort_order]);
  return { template: TEMPLATE.slug };
}
