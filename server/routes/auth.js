import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db/pool.js';
import { signToken, authenticate, userFromRequest, wrap, cookieOptions, audit } from '../lib/auth.js';
import { createSession, revokeSession } from '../lib/sessions.js';
import { getSetting } from '../lib/settings.js';
import { effectiveGrants } from '../lib/rbac.js';
import { httpError } from '../lib/util.js';

const r = Router();
const HR_PERMS = ['employees', 'leaves', 'targets', 'org', 'import', 'settings', 'snapshots'];

r.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw httpError(400, 'أدخل اسم المستخدم وكلمة المرور');
  const name = String(username).trim().toLowerCase();
  const u = (await q('SELECT * FROM users WHERE username = $1', [name])).rows[0];
  const fail = async (reason, status = 401, msg = 'بيانات الدخول غير صحيحة') => {
    await audit(req, 'login_failed', 'user', u?.id ?? name, null, { username: name }, { platform: 'platform', result: 'failure', reason, user: u ? { id: u.id, username: u.username } : { username: name } });
    throw httpError(status, msg);
  };
  if (!u) return fail('مستخدم غير موجود');
  if (u.locked_until && new Date(u.locked_until) > new Date()) return fail('الحساب مقفل مؤقتاً', 423, 'الحساب مقفل مؤقتاً بسبب محاولات فاشلة متكررة. حاول لاحقاً.');
  if (!u.active) return fail('حساب معطّل');
  if (!(await bcrypt.compare(String(password), u.password_hash))) {
    const max = Number(await getSetting('max_failed_logins', 5)) || 5, mins = Number(await getSetting('lockout_minutes', 15)) || 15;
    const n = (await q(`UPDATE users SET failed_logins = failed_logins + 1,
        locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END WHERE id = $1 RETURNING failed_logins`, [u.id, max, mins])).rows[0].failed_logins;
    return fail(n >= max ? 'كلمة مرور خاطئة وتم قفل الحساب' : 'كلمة مرور خاطئة');
  }
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  const s = await createSession(u.id, req);
  res.cookie('token', signToken(u.id, s.id, s.hours), cookieOptions(s.hours));
  await audit(req, 'login', 'user', u.id, null, null, { platform: 'platform', user: { id: u.id, username: u.username } });
  res.json({ ok: true });
}));

r.post('/logout', wrap(async (req, res) => {
  const u = await userFromRequest(req);          // تسجيل الخروج مسموح حتى لو انتهت الجلسة
  if (u) {
    await revokeSession(u.sessionId, u.username, 'logout');
    await audit(req, 'logout', 'user', u.id, null, null, { platform: 'platform', user: u });
  }
  res.clearCookie('token');
  res.json({ ok: true });
}));

r.get('/me', authenticate, wrap(async (req, res) => {
  const u = req.user;
  const roles = (await q('SELECT name FROM roles WHERE key = ANY($1)', [u.roleKeys])).rows.map(x => x.name);
  res.json({
    id: u.id, username: u.username, full_name: u.full_name, role: u.role, org_unit_id: u.org_unit_id, employee_id: u.employee_id,
    role_label: roles.join('، ') || u.role, roles: u.roleKeys,
    perms: HR_PERMS.filter(p => u.isSuper || u.grants.has(`hr:${p}`)),
    is_admin: u.isSuper || u.grants.has('admin:users_manage'),
    grants: effectiveGrants(u),
  });
}));

export default r;
