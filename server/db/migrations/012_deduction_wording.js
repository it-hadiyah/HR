// الترحيل 012: إشعار الخصم — لا يُحتسب أجر أيام الغياب؛ تُذكر الأيام بتواريخها ثم الجزاء المحدد (أيام و/أو مبلغ) من راتب الشهر
// يُحدَّث القالب فقط إن لم يُعدَّل من صفحة إدارة القوالب (version = 1).
const NEW_LINE = 'وعليه، سيتم حسم{{#if penalty}} أجر {{penalty}}{{#if penalty_amount}} و{{/if}}{{/if}}{{#if penalty_amount}}{{#if penalty}}{{else}} {{/if}}مبلغ وقدره ({{penalty_amount}}) ريال سعودي{{/if}}{{#if penalty}}{{else}}{{#if penalty_amount}}{{else}} الجزاء المقرر{{/if}}{{/if}} من راتب شهر {{deduction_month|month_ar}}، كجزاء إضافي، وفقًا للأنظمة واللوائح المعتمدة.';

export async function up(c) {
  const row = (await c.query("SELECT id, version, body FROM hr_form_templates WHERE slug = 'deduction-notice'")).rows[0];
  if (!row || row.version !== 1) return { updated: false };
  const lines = row.body.split('\n');
  const i = lines.findIndex(l => l.startsWith('وعليه، سيتم حسم'));
  if (i < 0) return { updated: false };
  lines[i] = NEW_LINE;
  await c.query('UPDATE hr_form_templates SET body = $2, updated_at = now() WHERE id = $1', [row.id, lines.join('\n')]);
  return { updated: true };
}
