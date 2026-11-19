// الترحيل 013: إشعار الخصم — عبارة «وعليه، سيتم حسم…» لا تظهر إلا إذا حُدِّد جزاء بالأيام أو مبلغ يدوي (الافتراضي: بدون جزاء)
// يُحدَّث القالب فقط إن لم يُعدَّل من صفحة إدارة القوالب (version = 1).
const MONTH = 'من راتب شهر {{deduction_month|month_ar}}، كجزاء إضافي، وفقًا للأنظمة واللوائح المعتمدة.';
const NEW_LINE = `{{#if penalty}}وعليه، سيتم حسم أجر {{penalty}}{{#if penalty_amount}} ومبلغ وقدره ({{penalty_amount}}) ريال سعودي{{/if}} ${MONTH}{{else}}{{#if penalty_amount}}وعليه، سيتم حسم مبلغ وقدره ({{penalty_amount}}) ريال سعودي ${MONTH}{{/if}}{{/if}}`;

export async function up(c) {
  const row = (await c.query("SELECT id, version, body, fields FROM hr_form_templates WHERE slug = 'deduction-notice'")).rows[0];
  if (!row || row.version !== 1) return { updated: false };
  const lines = row.body.split('\n');
  const i = lines.findIndex(l => l.includes('وعليه، سيتم حسم'));
  if (i < 0) return { updated: false };
  lines[i] = NEW_LINE;
  const fields = row.fields.map(f => {
    if (f.key === 'penalty') {
      const opts = (f.options || []).filter(o => o.value !== '');
      return { ...f, default: '', options: [{ value: '', label: 'بدون جزاء' }, ...opts] };
    }
    if (f.key === 'deduction_month') return { ...f, required: false };
    return f;
  });
  await c.query('UPDATE hr_form_templates SET body = $2, fields = $3, updated_at = now() WHERE id = $1', [row.id, lines.join('\n'), JSON.stringify(fields)]);
  return { updated: true };
}
