// منصة «منشئ التقارير» داخل المنصة الموحّدة (/report-builder/).
// التطبيق نفسه (modules/report-builder) خادم JSON/ملفات بلا اعتماديات؛ هذا الغلاف يربطه بما يلي:
//   - الدخول الموحّد (جلسة المنصة) بدل حسابات الدومين والحسابات المحلية القديمة
//   - الصلاحيات المركزية: access / create / share / approve / indicators / manage (جدول apps و roles)
//   - سجل التدقيق المركزي (كل عملية في المنشئ تُسجَّل أيضاً في audit_logs)
//   - أنواع التقارير المسموحة والمعتمِدون لكل مستخدم (جدول report_builder_prefs)
// بيانات التقارير والعروض تبقى ملفات JSON في REPORT_BUILDER_DATA (انسخها ضمن النسخ الاحتياطي).
import { Router } from 'express';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from '../db/pool.js';
import { userFromRequest } from '../lib/auth.js';
import { canUseApp } from '../lib/apps.js';
import { audit, auditDenied } from '../lib/audit.js';
import { bindUser } from '../lib/reqctx.js';
import { orgGraph } from '../lib/orggraph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../modules/report-builder');
const DATA = process.env.REPORT_BUILDER_DATA || path.resolve(here, '../../data/report-builder');
Object.assign(process.env, { RB_DATA: path.join(DATA, 'data'), RB_REPORTS: path.join(DATA, 'reports'), RB_DECKS: path.join(DATA, 'decks'), RB_CONFIG: path.join(ROOT, 'config.json') });

const require = createRequire(import.meta.url);
const builder = require(path.join(ROOT, 'server.js'));
const APP = 'report-builder';
const ACTIONS = ['access', 'create', 'share', 'approve', 'indicators', 'manage'];

// ───── مرآة المستخدمين للمنشئ (يقرؤها بشكل متزامن) ─────
let dirAt = 0;
async function refreshDirectory(force = false) {
  if (!force && Date.now() - dirAt < 15000) return;
  dirAt = Date.now();
  const [users, grants, over, prefs, graph] = await Promise.all([
    q(`SELECT u.id, u.username, u.full_name, u.active, u.employee_id, u.last_login_at, e.full_name AS emp_name, e.email, o.name AS dept
       FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN org_units o ON o.id = e.org_unit_id`),
    q(`SELECT ur.user_id, r.is_super, g.action FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_grants g ON g.role_id = r.id AND g.app_slug = $1`, [APP]),
    q('SELECT user_id, action, effect FROM user_grants WHERE app_slug = $1', [APP]),
    q('SELECT username, allowed_templates, approvers FROM report_builder_prefs'),
    orgGraph(),
  ]);
  const perms = new Map();
  for (const u of users.rows) perms.set(u.id, { isSuper: false, set: new Set() });
  for (const g of grants.rows) { const p = perms.get(g.user_id); if (!p) continue; if (g.is_super) p.isSuper = true; if (g.action) p.set.add(g.action); }
  for (const o of over.rows) { const p = perms.get(o.user_id); if (!p) continue; if (o.effect === 'allow') p.set.add(o.action); else p.set.delete(o.action); }
  const byEmp = new Map(users.rows.filter(u => u.employee_id && u.active).map(u => [u.employee_id, u.username]));
  const pref = new Map(prefs.rows.map(p => [p.username, p]));
  const list = [];
  for (const u of users.rows) {
    const p = perms.get(u.id);
    const has = a => p.isSuper || p.set.has(a);
    if (!has('access')) continue;
    const role = has('manage') ? 'admin' : has('approve') ? 'manager' : 'employee';
    const mgr = u.employee_id ? graph.managerOf(u.employee_id) : null;
    const pr = pref.get(u.username);
    list.push({ username: u.username, name: u.emp_name || u.full_name, role, disabled: !u.active, department: u.dept || '', email: u.email || '', managerUsername: mgr ? byEmp.get(mgr) || '' : '',
      allowedTemplates: pr?.allowed_templates ?? null, approvers: pr?.approvers ?? [], lastLogin: u.last_login_at });
  }
  builder.auth.setDirectory(list);
}
builder.auth.setPrefsSink((username, p) => q(`INSERT INTO report_builder_prefs(username, allowed_templates, approvers, updated_at) VALUES ($1,$2,$3,now())
  ON CONFLICT (username) DO UPDATE SET allowed_templates = EXCLUDED.allowed_templates, approvers = EXCLUDED.approvers, updated_at = now()`,
[username, p.allowedTemplates === null ? null : JSON.stringify(p.allowedTemplates), JSON.stringify(p.approvers || [])]).then(() => { dirAt = 0; }));

// ───── كل عملية في المنشئ تدخل سجل التدقيق المركزي ─────
builder.store.setSink(entry => {
  const { at, action, by, user, id, ...rest } = entry;
  const [entity] = String(action).split('-');
  audit(null, action, entity, id ?? null, null, rest, { platform: APP, user: { username: by || user || null } });
});

// ───── الغلاف ─────
const PAGES = /^\/(?:|index\.html|list\.html|dashboard\.html|admin\.html|decks\.html|deck\.html|indicators\.html)$/;      // صفحات التطبيق (يُحقن فيها زر المنصة)
const PUBLIC = /^\/(?:s\/|css\/|js\/|fonts\/|brand\/|shared\/)/;                                                           // روابط المشاركة والملفات الثابتة بلا دخول إلزامي
const APPBAR = '<script src="/appbar.js" defer></script>';

function injectAppBar(res) {
  const wh = res.writeHead.bind(res), end = res.end.bind(res);
  let html = false;
  res.writeHead = (code, headers, ...a) => { html = /text\/html/i.test(String((headers || {})['Content-Type'] || '')); return wh(code, headers, ...a); };
  res.end = (chunk, ...a) => {
    if (html && chunk && res.statusCode === 200) {
      const t = (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      chunk = /<\/body>/i.test(t) ? t.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${APPBAR}</body>`) : t + APPBAR;
    }
    return end(chunk, ...a);
  };
}

const r = Router();
r.use(async (req, res, next) => {
  try {
    const p = req.path;
    const isPublic = PUBLIC.test(p);
    const user = await userFromRequest(req);
    const allowed = user && (await canUseApp(user, APP));
    if (!allowed) {
      if (isPublic) { req.platformUser = null; return builder.handle(req, res); }           // مشاهدة رابط مشاركة أو ملف ثابت دون جلسة
      if (user) await auditDenied(req, APP, 'access');
      const page = req.method === 'GET' && (p.endsWith('/') || p.endsWith('.html'));
      if (!user && page) return res.redirect(`/login/?next=${encodeURIComponent(req.baseUrl + req.url)}`);
      return res.status(user ? 403 : 401).json({ error: user ? 'لا تملك صلاحية الوصول إلى منشئ التقارير' : 'غير مسجّل الدخول' });
    }
    bindUser(user, user.sessionId);
    await refreshDirectory();
    const rec = builder.auth.find(user.username);
    const perms = Object.fromEntries(ACTIONS.map(a => [a, user.isSuper || user.grants.has(`${APP}:${a}`)]));
    req.platformUser = { username: user.username, name: rec?.name || user.full_name, role: rec?.role || 'employee', department: rec?.department || '', email: rec?.email || '', source: 'platform',
      managerUsername: rec?.managerUsername || '', perms, allowedTemplates: rec?.role === 'admin' ? null : rec?.allowedTemplates ?? null };
    if (req.method === 'GET' && PAGES.test(p)) injectAppBar(res);
    return builder.handle(req, res);
  } catch (e) { next(e); }
});

export default r;
