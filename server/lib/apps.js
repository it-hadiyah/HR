// المنصات (جدول apps) والوصول إليها حسب الصلاحيات المركزية
import { q } from '../db/pool.js';
import { hasGrant } from './rbac.js';
import { auditDenied } from './audit.js';

let cache = { at: 0, rows: [] };
export async function listApps() {
  if (Date.now() - cache.at > 5000) cache = { at: Date.now(), rows: (await q('SELECT * FROM apps ORDER BY sort_order, slug')).rows };
  return cache.rows;
}
export const resetAppsCache = () => { cache.at = 0; };

/** يستطيع الدخول للمنصة: المنصة مفعّلة ولديه عملية access */
export async function canUseApp(user, slug) {
  const app = (await listApps()).find(a => a.slug === slug);
  return !!app && app.active && hasGrant(user, slug, 'access');
}

export const requireApp = slug => async (req, res, next) => {
  try {
    if (await canUseApp(req.user, slug)) return next();
    await auditDenied(req, slug, 'access');
    res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا النظام' });
  } catch (e) { next(e); }
};
