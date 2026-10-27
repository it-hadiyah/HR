import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db/pool.js';
import { signToken, authenticate, wrap, ROLE_LABELS, can } from '../lib/auth.js';
import { httpError } from '../lib/util.js';

const r = Router();

r.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw httpError(400, 'أدخل اسم المستخدم وكلمة المرور');
  const { rows } = await q('SELECT * FROM users WHERE username = $1 AND active', [String(username).trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(password), u.password_hash))) throw httpError(401, 'بيانات الدخول غير صحيحة');
  res.cookie('token', signToken(u), { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', maxAge: 12 * 3600 * 1000 });
  res.json({ ok: true });
}));

r.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

r.get('/me', authenticate, (req, res) => {
  const u = req.user;
  res.json({ ...u, role_label: ROLE_LABELS[u.role], perms: ['employees', 'leaves', 'targets', 'org', 'import', 'settings', 'snapshots', '*'].filter(p => p === '*' ? false : can(u, p)), is_admin: u.role === 'admin' });
});

export default r;
