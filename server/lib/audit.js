// سجل التدقيق المركزي: كل العمليات المهمة تُكتب في audit_logs مع المستخدم والمنصة والعنوان والجلسة ونتيجة العملية.
import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { getCtx } from './reqctx.js';

const SENSITIVE = /pass(word)?|secret|token|hash|cookie|authorization|jwt|api[_-]?key|otp|salary/i;
const MAX_JSON = 20000;

/** ينسخ القيمة مع إخفاء الحقول الحساسة (كلمات المرور والرموز والأسرار) ويحدّ من الحجم */
export function redact(v, depth = 0) {
  if (v === null || v === undefined) return v ?? null;
  if (depth > 6) return '[عمق كبير]';
  if (Array.isArray(v)) return v.slice(0, 200).map(x => redact(x, depth + 1));
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? '[محجوب]' : redact(x, depth + 1)]));
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}
const pack = v => {
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(redact(v));
  return s.length > MAX_JSON ? JSON.stringify({ truncated: true, size: s.length }) : s;
};

/**
 * audit(req, action, entity, entityId, before, after, opts)
 * req اختياري (يُؤخذ المستخدم من سياق الطلب إن غاب). opts: { platform, result, reason, user, correlationId }
 */
export async function audit(req, action, entity, entityId, before, after, opts = {}) {
  try {
    const ctx = getCtx();
    const user = opts.user || req?.user || ctx.user || {};
    await q(`INSERT INTO audit_logs(user_id, username, platform, action, entity, entity_id, before, after, ip, user_agent, session_id, request_id, correlation_id, result, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [user.id ?? null, user.username ?? null, opts.platform || ctx.platform || null, action, entity ?? null, entityId === undefined || entityId === null ? null : String(entityId),
      pack(before), pack(after), ctx.ip ?? req?.ip ?? null, ctx.ua ?? null, ctx.sessionId ?? null, ctx.requestId ?? null, opts.correlationId ?? ctx.requestId ?? null,
      opts.result || 'success', opts.reason ?? null]);
  } catch (e) {
    console.error('تعذّر تسجيل العملية في سجل التدقيق:', e.message);   // لا نُسقط العملية الأصلية بسبب فشل التسجيل
  }
}

export const auditDenied = (req, platform, action, reason) =>
  audit(req, 'denied', platform, action, null, { path: req?.originalUrl, method: req?.method }, { platform, result: 'denied', reason: reason || `لا يملك صلاحية ${platform}:${action}` });

export const newCorrelationId = () => crypto.randomUUID();
