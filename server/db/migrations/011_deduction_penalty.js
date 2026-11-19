// الترحيل 011: إشعار الخصم — قائمة الجزاء الإضافي من يوم إلى 14 يوماً + خيار حسم مبلغ يدوي بالريال
// يُحدَّث القالب فقط إن لم يُعدَّل من صفحة إدارة القوالب (version = 1) كي لا نكتب فوق تعديلات المستخدم.
const DAYS = ['يوم واحد', 'يومين', 'ثلاثة أيام', 'أربعة أيام', 'خمسة أيام', 'ستة أيام', 'سبعة أيام', 'ثمانية أيام', 'تسعة أيام', 'عشرة أيام', 'أحد عشر يوماً', 'اثني عشر يوماً', 'ثلاثة عشر يوماً', 'أربعة عشر يوماً'];

export async function up(c) {
  const fields = [
    { key: 'absent_dates', label: 'أيام الغياب دون عذر', type: 'dates', required: true },
    { key: 'deduction_month', label: 'شهر الراتب المخصوم منه', type: 'month', required: true, suggest: 'next_month_of:absent_dates' },
    { key: 'penalty', label: 'الجزاء الإضافي (بالأيام)', type: 'select', required: false, default: 'يوم واحد', options: [...DAYS.map(value => ({ value })), { value: '', label: 'بدون جزاء' }] },
    { key: 'penalty_amount', label: 'حسم مبلغ إضافي (ريال) — إدخال يدوي', type: 'number', required: false, placeholder: 'اتركه فارغاً إن لم يوجد' },
  ];
  const row = (await c.query("SELECT id, version, body FROM hr_form_templates WHERE slug = 'deduction-notice'")).rows[0];
  if (!row || row.version !== 1) return { updated: false };
  const body = row.body.replace('{{#if penalty}}، بالإضافة إلى حسم أجر {{penalty}} كجزاء{{/if}}، وفقًا', '{{#if penalty}}، بالإضافة إلى حسم أجر {{penalty}} كجزاء{{/if}}{{#if penalty_amount}}، وحسم مبلغ وقدره ({{penalty_amount}}) ريال سعودي كجزاء إضافي{{/if}}، وفقًا');
  if (body === row.body) return { updated: false };
  await c.query("UPDATE hr_form_templates SET fields = $2, body = $3, updated_at = now() WHERE id = $1", [row.id, JSON.stringify(fields), body]);
  return { updated: true };
}
