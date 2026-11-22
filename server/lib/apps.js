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

/** بوابات مجمّعة: تضم أنظمة موجودة وتظهر لمن يملك الدخول لأي نظام منها (بلا صلاحية خاصة بها) */
export const APP_GROUPS = { 'hr-portal': ['hr-employees', 'hr-requests', 'hr', 'hr-forms', 'payroll'] };
const CHILD_OF = Object.fromEntries(Object.entries(APP_GROUPS).flatMap(([g, kids]) => kids.map(k => [k, g])));
export const groupOf = slug => CHILD_OF[slug] || null;

/** أنظمة المجموعة التي يستطيع المستخدم دخولها (بترتيب المجموعة) */
export async function groupChildren(user, group) {
  const apps = await listApps(), out = [];
  for (const slug of APP_GROUPS[group] || []) { const a = apps.find(x => x.slug === slug); if (a && a.active && hasGrant(user, slug, 'access')) out.push(a); }
  return out;
}

/** يستطيع الدخول للمنصة: المنصة مفعّلة ولديه عملية access (أو، للبوابة المجمّعة، دخول لأحد أنظمتها) */
export async function canUseApp(user, slug) {
  const app = (await listApps()).find(a => a.slug === slug);
  if (!app || !app.active) return false;
  if (APP_GROUPS[slug]) return (await groupChildren(user, slug)).length > 0;
  return hasGrant(user, slug, 'access');
}

export const requireApp = slug => async (req, res, next) => {
  try {
    if (await canUseApp(req.user, slug)) return next();
    await auditDenied(req, slug, 'access');
    res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا النظام' });
  } catch (e) { next(e); }
};
