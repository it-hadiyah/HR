// جلسات المستخدمين: كل تسجيل دخول جلسة في قاعدة البيانات يمكن إنهاؤها إدارياً، ولها انتهاء مطلق وخمول
import { q } from '../db/pool.js';
import { getSetting } from './settings.js';

export async function createSession(userId, req) {
  const hours = Number(await getSetting('session_hours', 12)) || 12;
  const { rows } = await q(`INSERT INTO sessions(user_id, expires_at, ip, user_agent) VALUES ($1, now() + make_interval(hours => $2), $3, $4) RETURNING id, expires_at`,
    [userId, hours, req.ip ?? null, (req.get('user-agent') || '').slice(0, 300)]);
  return { id: rows[0].id, hours, expiresAt: rows[0].expires_at };
}

/** صالحة؟ (غير ملغاة، لم تنتهِ، ولم تتجاوز مدة الخمول). تُحدّث last_seen كل دقيقة */
export async function validateSession(sid, userId) {
  const idle = Number(await getSetting('idle_minutes', 120)) || 120;
  const { rows } = await q(`UPDATE sessions SET last_seen_at = CASE WHEN last_seen_at < now() - interval '60 seconds' THEN now() ELSE last_seen_at END
    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - make_interval(mins => $3) RETURNING id`, [sid, userId, idle]);
  return rows.length > 0;
}

export async function revokeSession(sid, by, reason = 'logout') {
  const { rows } = await q('UPDATE sessions SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING user_id', [sid, by ?? null, reason]);
  return rows[0] ?? null;
}

export async function revokeUserSessions(userId, by, reason, exceptSid = null) {
  const { rowCount } = await q(`UPDATE sessions SET revoked_at = now(), revoked_by = $2, revoke_reason = $3
    WHERE user_id = $1 AND revoked_at IS NULL AND ($4::uuid IS NULL OR id <> $4)`, [userId, by ?? null, reason, exceptSid]);
  return rowCount;
}
