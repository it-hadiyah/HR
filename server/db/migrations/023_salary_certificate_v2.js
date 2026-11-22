// الترحيل 023: استبدال قالب «خطاب تعريف بالراتب» بالنموذج المعتمد الجديد (Excel 2026):
// الأساسي + بدل السكن + بدل المواصلات + بدلات أخرى = «أساسي مع البدلات النظامية» (يُحسب تلقائياً ويُكتب بالحروف)،
// بلا القرض الحسن وصافي الراتب. يُستبدل القالب كاملاً بطلب صريح من المستخدم (ويرفع رقم نسخته).
const FIELDS = [
  { key: 'hire_date', label: 'تاريخ التعيين', type: 'date', required: true },
  { key: 'nationality', label: 'الجنسية', type: 'text', required: true, default: 'سعودي' },
  { key: 'national_id', label: 'رقم الهوية', type: 'text', required: true, placeholder: '10 أرقام' },
  { key: 'basic', label: 'الراتب الأساسي (ريال)', type: 'number', required: true },
  { key: 'housing', label: 'بدل السكن (ريال)', type: 'number', required: false, default: '0' },
  { key: 'transport', label: 'بدل المواصلات (ريال)', type: 'number', required: false, default: '0' },
  { key: 'other', label: 'بدلات أخرى (ريال)', type: 'number', required: false, default: '0' },
  { key: 'to', label: 'الجهة الموجّه إليها الخطاب', type: 'text', required: true, default: 'قسم المساعدات' },
];
const BODY = `التاريخ: {{issue_date|hijri}}هـ     الموافق: {{issue_date|date_num}}م
# جمعية هدية الحاج والمعتمر الخيرية (خطاب تعريف)
الاسم: {{employee_name}}
الرقم الوظيفي: {{emp_no}}
الوظيفة: {{job_title}}
الجنسية: {{nationality}}
تاريخ التعيين: {{hire_date|date_num}}
رقم الهوية: {{national_id}}

اعتماد بيانات الراتب:
الأساسي: {{basic|money}} ريال
بدل سكن: {{housing|money}} ريال
بدل مواصلات: {{transport|money}} ريال
بدلات أخرى: {{other|money}} ريال
أساسي مع البدلات النظامية: {{salary_total|money}} ريال
الإجمالي كتابةً: {{salary_total|tafqeet}}

تشهد جمعية هدية الحاج والمعتمر الخيرية بأن الموظف الموضحة بياناته أعلاه يعمل لديها وما زال على رأس العمل حتى تاريخه وبناءً على طلبه أُعطي له هذا الخطاب لتقديمه إلى:
{{to}}
وذلك دون أدنى مسؤولية أو التزام مالي على الجمعية.

شاكرين لكم تعاونكم معنا،،،،،

إدارة رأس المال البشري
ص/ لملف الموظف.
ملاحظة: أي كشط أو تغيير في معلومات الخطاب يعتبر لاغياً.`;

export async function up(c) {
  const r = await c.query(`UPDATE hr_form_templates SET fields = $1, body = $2, description = $3, version = version + 1, updated_by = 'system', updated_at = now() WHERE slug = 'salary-certificate' RETURNING id`,
    [JSON.stringify(FIELDS), BODY, 'تعريف بالموظف وبيانات راتبه (أساسي وبدلات وأساسي مع البدلات النظامية) موجّه لجهة محددة؛ الإجمالي وكتابته بالحروف تلقائيان.']);
  return { updated: r.rowCount };
}
