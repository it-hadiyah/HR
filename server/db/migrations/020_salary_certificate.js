// الترحيل 020: قالب «خطاب تعريف بالراتب» (من نموذج Excel المعتمد). الإجمالي وتفقيطه يُحسبان تلقائياً من مكوّنات الراتب،
// والتاريخ يظهر هجرياً وميلادياً. الختم الرسمي يُضاف تلقائياً على كل النماذج من إعدادات المنصة.
const TEMPLATE = {
  slug: 'salary-certificate', category: 'خطابات', sort_order: 5,
  title: 'خطاب تعريف بالراتب',
  description: 'تعريف بالموظف وبيانات راتبه (أساسي وبدلات وقرض حسن وصافي بعد التأمينات) موجّه لجهة محددة؛ الإجمالي وكتابته بالحروف تلقائيان.',
  fields: [
    { key: 'hire_date', label: 'تاريخ التعيين', type: 'date', required: true },
    { key: 'nationality', label: 'الجنسية', type: 'text', required: true, default: 'سعودي' },
    { key: 'national_id', label: 'رقم الهوية', type: 'text', required: true, placeholder: '10 أرقام' },
    { key: 'basic', label: 'الراتب الأساسي (ريال)', type: 'number', required: true },
    { key: 'housing', label: 'بدل السكن (ريال)', type: 'number', required: false, default: '0' },
    { key: 'transport', label: 'بدل المواصلات (ريال)', type: 'number', required: false, default: '0' },
    { key: 'other', label: 'بدلات أخرى (ريال)', type: 'number', required: false, default: '0' },
    { key: 'loan', label: 'القرض الحسن (ريال)', type: 'number', required: false, default: '0' },
    { key: 'net', label: 'صافي الراتب بعد خصم التأمينات الاجتماعية (ريال)', type: 'number', required: true },
    { key: 'to', label: 'الجهة الموجّه إليها الخطاب', type: 'text', required: true, default: 'قسم المساعدات' },
  ],
  body: `التاريخ: {{issue_date|hijri}}هـ     الموافق: {{issue_date|date_num}}م
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
أخرى: {{other|money}} ريال
القرض الحسن: {{loan|money}} ريال
صافي الراتب بعد خصم التأمينات الاجتماعية: {{net|money}} ريال
الإجمالي: {{salary_total|money}} ريال
الإجمالي كتابةً: {{salary_total|tafqeet}}

تشهد جمعية هدية الحاج والمعتمر الخيرية بأن الموظف الموضحة بياناته أعلاه يعمل لديها وما زال على رأس العمل حتى تاريخه وبناءً على طلبه أُعطي له هذا الخطاب لتقديمه إلى:
{{to}}
وذلك دون أدنى مسؤولية أو التزام مالي على الجمعية.

شاكرين لكم تعاونكم معنا،،،،،

إدارة رأس المال البشري
ص/ لملف الموظف.
ملاحظة: أي كشط أو تغيير في معلومات الخطاب يعتبر لاغياً.`,
};

export async function up(c) {
  await c.query(`INSERT INTO hr_form_templates(slug, title, category, description, body, fields, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'system')
    ON CONFLICT (slug) DO NOTHING`, [TEMPLATE.slug, TEMPLATE.title, TEMPLATE.category, TEMPLATE.description, TEMPLATE.body, JSON.stringify(TEMPLATE.fields), TEMPLATE.sort_order]);
  return { template: TEMPLATE.slug };
}
