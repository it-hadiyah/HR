// التحكم بالوصول للتطبيقات حسب جدول apps (الأدوار المسموح لها بكل تطبيق)
import { q } from '../db/pool.js';

let cache = { at: 0, rows: [] };
export async function listApps() {
  if (Date.now() - cache.at > 15000) cache = { at: Date.now(), rows: (await q('SELECT * FROM apps WHERE active ORDER BY sort_order, slug')).rows };
  return cache.rows;
}
export const resetAppsCache = () => { cache.at = 0; };

export async function canUseApp(user, slug) {
  if (user.role === 'admin') return true;
  const app = (await listApps()).find(a => a.slug === slug);
  return !!app && app.roles.includes(user.role);
}

/** وسيط: يمنع الدور غير المصرّح له بالتطبيق */
export const requireApp = slug => async (req, res, next) => {
  try {
    if (await canUseApp(req.user, slug)) return next();
    res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا النظام' });
  } catch (e) { next(e); }
};
