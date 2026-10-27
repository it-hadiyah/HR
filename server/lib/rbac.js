// الصلاحيات المركزية (RBAC) مع نطاق البيانات. القاعدة: الرفض افتراضياً، وكل فحص يتم في الخادم من قاعدة البيانات.
//  - الدور يمنح (منصة، عملية، نطاق). الاستثناء الفردي allow/deny فوق الأدوار؛ deny يغلب.
//  - النطاقات من الأضيق للأوسع: self < reports < section < department < sector < all
import { q } from '../db/pool.js';
import { auditDenied } from './audit.js';
import { orgGraph } from './orggraph.js';

export const SCOPES = ['self', 'reports', 'section', 'department', 'sector', 'all'];
const RANK = Object.fromEntries(SCOPES.map((s, i) => [s, i + 1]));

const cache = new Map();            // userId → { at, v }
const TTL = 3000;
export const invalidateGrants = userId => { if (userId) cache.delete(userId); else cache.clear(); };

async function loadGrants(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const [roles, grants, overrides] = await Promise.all([
    q('SELECT r.id, r.key, r.name, r.is_super FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [userId]),
    q('SELECT g.app_slug, g.action, g.scope FROM user_roles ur JOIN role_grants g ON g.role_id = ur.role_id WHERE ur.user_id = $1', [userId]),
    q('SELECT app_slug, action, scope, effect FROM user_grants WHERE user_id = $1', [userId]),
  ]);
  const map = new Map();
  const put = (k, scope) => { if (!map.has(k) || RANK[scope] > RANK[map.get(k)]) map.set(k, scope); };   // الأوسع يغلب بين الأدوار
  for (const g of grants.rows) put(`${g.app_slug}:${g.action}`, g.scope);
  for (const o of overrides.rows) if (o.effect === 'allow') put(`${o.app_slug}:${o.action}`, o.scope);
  for (const o of overrides.rows) if (o.effect === 'deny') map.delete(`${o.app_slug}:${o.action}`);
  const v = { grants: map, isSuper: roles.rows.some(r => r.is_super), roleKeys: roles.rows.map(r => r.key), roleNames: roles.rows.map(r => r.name) };
  cache.set(userId, { at: Date.now(), v });
  return v;
}

/** يضيف grants/isSuper/roleKeys إلى كائن المستخدم */
export async function attachGrants(user) { return Object.assign(user, await loadGrants(user.id)); }

export const hasGrant = (user, app, action) => !!user && (user.isSuper || user.grants?.has(`${app}:${action}`) || false);
export const grantScope = (user, app, action) => (user?.isSuper ? 'all' : user?.grants?.get(`${app}:${action}`) ?? null);

/** وسيط Express: يمنع (403) ويسجّل المحاولة غير المصرح بها */
export const requireGrant = (app, action) => async (req, res, next) => {
  if (hasGrant(req.user, app, action)) return next();
  await auditDenied(req, app, action);
  res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' });
};

/** كل الصلاحيات الفعلية للمستخدم (لعرضها في لوحة الإدارة) */
export const effectiveGrants = user => (user.isSuper ? [{ app: '*', action: '*', scope: 'all' }]
  : [...user.grants].map(([k, scope]) => { const [app, action] = k.split(':'); return { app, action, scope }; }));

/**
 * نطاق البيانات المسموح: { all: true } أو { all: false, unitIds: Set|null, employeeIds: Set|null }
 * الموظف مسموح إن كان في unitIds أو في employeeIds. بلا صلاحية = مجموعتان فارغتان (لا شيء).
 */
export async function resolveScope(user, app, action) {
  const scope = grantScope(user, app, action);
  if (scope === 'all') return { all: true };
  const none = { all: false, unitIds: new Set(), employeeIds: new Set() };
  if (!scope) return none;
  const g = await orgGraph();
  const meId = user.employee_id;
  const me = meId ? g.emps.get(meId) : null;
  if (scope === 'self') return { all: false, unitIds: null, employeeIds: new Set(meId ? [meId] : []) };
  if (scope === 'reports') return { all: false, unitIds: null, employeeIds: new Set(meId ? [meId, ...g.subordinates(meId)] : []) };
  // نطاقات الوحدات: وحدة مسندة صراحةً للمستخدم، وإلا أقرب سلف لوحدة موظفه من النوع المطلوب
  let rootId = user.org_unit_id || (me?.org_unit_id ? g.ancestorOfType(me.org_unit_id, scope) ?? me.org_unit_id : null);
  if (!rootId) return none;
  return { all: false, unitIds: g.subtree(rootId), employeeIds: null, rootId };
}

export const inScope = (sc, e) => sc.all || !!(sc.unitIds?.has(e.org_unit_id) || sc.employeeIds?.has(e.id));

/** الصلاحيات الفعلية لمستخدم (من أدواره واستثناءاته) لعرضها في لوحة الإدارة */
export async function effectiveForUser(userId) {
  const v = await loadGrants(userId);
  return { isSuper: v.isSuper, roles: v.roleKeys, grants: [...v.grants].map(([k, scope]) => { const [app, action] = k.split(':'); return { app, action, scope }; }) };
}
