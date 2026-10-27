import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { q } from '../db/pool.js';

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('تحذير: JWT_SECRET غير مضبوط؛ ستنتهي الجلسات عند إعادة التشغيل.');

export const ROLE_LABELS = {
  admin: 'مدير النظام', hr: 'الموارد البشرية', finance: 'الإدارة المالية',
  sector_manager: 'مدير قطاع', department_manager: 'مدير إدارة', section_manager: 'مدير قسم', executive: 'الإدارة العليا',
};

// صلاحيات الكتابة لكل دور (القراءة متاحة لكل الأدوار ضمن النطاق)
const WRITE = {
  admin: ['*'],
  hr: ['employees', 'leaves', 'targets', 'org', 'import', 'settings'],
  finance: ['snapshots'],
};
export const can = (user, perm) => {
  const p = WRITE[user.role] || [];
  return p.includes('*') || p.includes(perm);
};
export const canSeeFinancials = user => !['sector_manager', 'department_manager', 'section_manager'].includes(user.role);

export function signToken(user) {
  return jwt.sign({ id: user.id }, SECRET, { expiresIn: '12h' });
}

export async function authenticate(req, res, next) {
  try {
    const t = req.cookies?.token;
    if (!t) return res.status(401).json({ error: 'غير مسجّل الدخول' });
    const { id } = jwt.verify(t, SECRET);
    const { rows } = await q('SELECT id, username, full_name, role, org_unit_id, active FROM users WHERE id = $1', [id]);
    if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'الحساب غير نشط' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'انتهت الجلسة' });
  }
}

export const requirePerm = perm => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' });

export async function audit(req, action, entity, entityId, before, after) {
  await q('INSERT INTO audit_log(user_id, username, action, entity, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.user?.id ?? null, req.user?.username ?? null, action, entity, String(entityId ?? ''),
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
