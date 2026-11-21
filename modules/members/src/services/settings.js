'use strict';
const { z } = require('zod');
const { query } = require('../db/pool');
const audit = require('./audit');
const { bad } = require('../lib/errors');

// مخطط تحقق لكل إعداد قابل للتعديل من لوحة الإدارة
const SCHEMA = {
  'org.name': z.string().trim().min(2).max(120),
  'brand.primary': z.string().regex(/^#[0-9a-fA-F]{6}$/),
  'fees.default_amount': z.number().min(0).max(10_000_000),
  'membership.default_duration_months': z.number().int().min(1).max(120),
  'rules.expiry_warning_days': z.number().int().min(1).max(365),
  'rules.grace_days': z.number().int().min(0).max(365),
  'rules.activation_min_paid_percent': z.number().min(0).max(100),
  'rules.expire_overdue_days': z.number().int().min(0).max(3650),
  'import.duplicate_rules': z.array(z.enum(['phone', 'email', 'name'])).min(1),
  'notifications.external_enabled': z.boolean(),
  'email.provider': z.enum(['none']),
  'email.from_name': z.string().trim().max(120),
  'email.from_address': z.union([z.literal(''), z.string().email().max(254)]),
  'sms.provider': z.enum(['none']),
  'sms.sender_id': z.string().trim().max(20),
};
const PUBLIC_KEYS = ['org.name', 'org.logo', 'brand.primary'];

async function getAll(client) {
  const r = await (client || { query }).query('SELECT key, value FROM system_settings');
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}
async function getPublic() {
  const all = await getAll();
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, all[k] ?? null]));
}
async function getValue(client, key) {
  const r = await client.query('SELECT value FROM system_settings WHERE key=$1', [key]);
  return r.rows[0]?.value;
}

/** تحديث مجموعة إعدادات في معاملة واحدة مع تسجيل التغييرات */
async function update(client, ctx, changes) {
  const before = await getAll(client);
  const applied = {};
  for (const [k, v] of Object.entries(changes)) {
    const schema = SCHEMA[k];
    if (!schema) throw bad(`الإعداد غير معروف أو غير قابل للتعديل: ${k}`);
    const parsed = schema.safeParse(v);
    if (!parsed.success) throw bad(`قيمة غير صالحة للإعداد ${k}`);
    applied[k] = parsed.data;
  }
  if (applied['notifications.external_enabled'] === true) {
    // لا يُفعَّل الإرسال الخارجي دون مزود خدمة فعلي. لا مزود مدمجًا حاليًا.
    throw bad('لا يمكن تفعيل الإرسال الخارجي قبل ربط مزود خدمة. راجع docs/members/NOTIFICATIONS.md');
  }
  for (const [k, v] of Object.entries(applied)) {
    await client.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [k, JSON.stringify(v), ctx.user.id]);
  }
  const d = audit.diff(Object.fromEntries(Object.keys(applied).map((k) => [k, before[k]])), applied);
  if (d.changed) await audit.log(client, ctx, { action: 'settings.update', entity: 'settings', entityId: 'system', before: d.before, after: d.after });
  return applied;
}

module.exports = { getAll, getPublic, getValue, update, SCHEMA };
