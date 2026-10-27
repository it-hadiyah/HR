import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { audit } from './audit.js';
import { validateSession } from './sessions.js';
import { attachGrants, hasGrant, requireGrant } from './rbac.js';
import { bindUser } from './reqctx.js';

export { audit };

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('تحذير: JWT_SECRET غير مضبوط؛ ستنتهي الجلسات عند إعادة التشغيل.');

export const cookieOptions = hours => ({ httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: hours * 3600 * 1000 });
export const signToken = (userId, sid, hours) => jwt.sign({ id: userId, sid }, SECRET, { expiresIn: `${hours}h` });

/** المستخدم الحالي (مع صلاحياته) من الكوكي والجلسة، أو null. يُرفض أي حساب معطّل أو جلسة ملغاة/منتهية */
export async function userFromRequest(req) {
  const t = req.cookies?.token;
  if (!t) return null;
  try {
    const { id, sid } = jwt.verify(t, SECRET);
    if (!sid || !(await validateSession(sid, id))) return null;
    const { rows } = await q('SELECT id, username, full_name, role, org_unit_id, employee_id, person_id, active, must_change_password FROM users WHERE id = $1', [id]);
    const u = rows[0];
    if (!u?.active) return null;
    u.sessionId = sid;
    await attachGrants(u);
    return u;
  } catch { return null; }
}

export async function authenticate(req, res, next) {
  try {
    if (!req.cookies?.token) return res.status(401).json({ error: 'غير مسجّل الدخول' });
    const u = await userFromRequest(req);
    if (!u) return res.status(401).json({ error: 'انتهت الجلسة' });
    req.user = u;
    bindUser(u, u.sessionId);
    next();
  } catch (e) { next(e); }
}

// ── صلاحيات نظام الإجازات (أسماؤها هي عمليات المنصة hr) ──
export const can = (user, perm) => hasGrant(user, 'hr', perm);
export const canSeeFinancials = user => hasGrant(user, 'hr', 'financials');
export const requirePerm = perm => requireGrant('hr', perm);

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
