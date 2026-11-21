'use strict';
// سجل التدقيق. لا يُسجَّل أي سر؛ الجوال والبريد يُقنَّعان في القيم المسجلة (تقليل البيانات الشخصية).
const SECRET_KEYS = new Set(['password', 'password_hash', 'new_password', 'sess']);
const MASK_KEYS = new Set(['phone', 'email']);

function maskValue(v) {
  if (v === null || v === undefined) return v;
  const s = String(v);
  return s.length <= 4 ? '***' : `${s.slice(0, 2)}***${s.slice(-2)}`;
}
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = MASK_KEYS.has(k) ? maskValue(v) : (v && typeof v === 'object' ? scrub(v) : v);
  }
  return out;
}
/** يحتفظ بالحقول التي تغيّرت فقط */
function diff(before, after) {
  const b = {}, a = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) { b[k] = before?.[k] ?? null; a[k] = after?.[k] ?? null; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

/** يكتب داخل نفس معاملة العملية ليكون التدقيق والتغيير ذريين */
async function log(client, ctx, { action, entity, entityId, before = null, after = null }) {
  await client.query(
    `INSERT INTO audit_logs (user_id, username, action, entity, entity_id, before, after, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx?.user?.id ?? null, ctx?.user?.username ?? null, action, entity, entityId == null ? null : String(entityId),
      before ? JSON.stringify(scrub(before)) : null, after ? JSON.stringify(scrub(after)) : null, ctx?.ip ?? null]);
}
module.exports = { log, diff, scrub };
