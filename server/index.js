import './lib/env.js';
// المنصة الموحّدة: نقطة دخول واحدة (رابط واحد) تجمع بوابة الموظفين وأرصدة الإجازات وبطاقة الموظف والتقارير
// فوق قاعدة بيانات PostgreSQL واحدة وحسابات دخول واحدة.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, userFromRequest } from './lib/auth.js';
import { requestContext } from './lib/reqctx.js';
import { canUseApp, requireApp } from './lib/apps.js';
import { exportFile, FILES, READ_ONLY_FILES } from './lib/portalData.js';
import { getSetting } from './lib/settings.js';
import { pool } from './db/pool.js';
import { initSchema } from './db/init.js';
import authRoutes from './routes/auth.js';
import platformRoutes from './routes/platform.js';
import coreRoutes from './routes/core.js';
import reportBuilderRoutes from './routes/reportBuilder.js';
import portalAdminRoutes from './routes/portalAdmin.js';
import { PORTAL_DIR } from './lib/uploads.js';
import orgRoutes from './routes/org.js';
import employeeRoutes from './routes/employees.js';
import leaveRoutes from './routes/leaves.js';
import targetRoutes from './routes/targets.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import importRoutes from './routes/importer.js';
import adminRoutes from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MODULES = path.join(root, 'modules');
const secure = process.env.COOKIE_SECURE === '1';

export const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

// سياسة أمان صارمة للصفحة الموحّدة وأرصدة الإجازات، ومخففة للوحدات المضمّنة (تستخدم سكربتات وأنماط داخلية وخطوطاً خارجية)
const strictCsp = helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'", 'data:'], upgradeInsecureRequests: secure ? [] : null } },
});
const looseCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net', 'https://staticimgly.com', 'blob:'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'blob:', 'data:', 'https://api.aladhan.com', 'https://cdn.jsdelivr.net', 'https://staticimgly.com'],
      workerSrc: ["'self'", 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      upgradeInsecureRequests: secure ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
});
app.use((req, res, next) => (/^\/(portal|card|report-builder)(\/|$)/.test(req.path) ? looseCsp : strictCsp)(req, res, next));
app.use(cookieParser());
app.use(requestContext);

// ── واجهات API ──
app.use('/report-builder', reportBuilderRoutes);                  // منشئ التقارير: يقرأ الجسم بنفسه فيُركَّب قبل express.json
app.use('/api/portal-admin', authenticate, portalAdminRoutes);   // قبل express.json: يقرأ الجسم بنفسه (حتى 20MB)
app.use(express.json({ limit: '2mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api', authenticate);
app.use('/api', platformRoutes);
app.use('/api/core', coreRoutes);
const hr = requireApp('hr');
app.use('/api/org', hr, orgRoutes);
app.use('/api/employees', hr, employeeRoutes);
app.use('/api/leaves', hr, leaveRoutes);
app.use('/api/targets', hr, targetRoutes);
app.use('/api/dashboard', hr, dashboardRoutes);
app.use('/api/reports', hr, reportRoutes);
app.use('/api/import', hr, importRoutes);
app.use('/api/admin', adminRoutes);

// ── بوابة الدخول للوحدات الثابتة ──
const wantsPage = req => req.method === 'GET' && (req.path.endsWith('/') || req.path.endsWith('.html'));
const gate = slug => async (req, res, next) => {
  try {
    const appSlug = slug === 'portal' && req.path.startsWith('/admin') ? 'portal-admin' : slug;
    if (slug === 'portal' && appSlug === 'portal' && (await getSetting('portal_public', true)) !== false) return next();   // البوابة مفتوحة افتراضياً (إعداد portal_public من لوحة الإدارة)
    const user = await userFromRequest(req);
    if (!user) {
      if (wantsPage(req)) return res.redirect(`/login/?next=${encodeURIComponent(req.baseUrl + req.url)}`);
      return res.status(401).json({ error: 'غير مسجّل الدخول' });
    }
    if (!(await canUseApp(user, appSlug))) {
      if (wantsPage(req)) return res.status(403).type('html').send('<meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma;padding:40px"><h2>لا تملك صلاحية الوصول إلى هذا النظام</h2><p><a href="/">العودة إلى الصفحة الرئيسية للمنصة</a></p>');
      return res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا النظام' });
    }
    req.user = user;
    next();
  } catch (e) { next(e); }
};

// يحقن شريط التنقل الموحّد (العودة للمنصة والتنقل بين الأنظمة) في صفحات HTML للوحدات
const htmlCache = new Map();
const withAppBar = dir => (req, res, next) => {
  if (req.method !== 'GET') return next();
  let rel;
  try { rel = decodeURIComponent(req.path); } catch { return next(); }
  if (rel.endsWith('/')) rel += 'index.html';
  if (!rel.endsWith('.html')) return next();
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir + path.sep)) return next();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return next();
    let hit = htmlCache.get(file);
    if (!hit || hit.mtime !== st.mtimeMs) {
      let html = fs.readFileSync(file, 'utf8');
      const tag = '<script src="/appbar.js" defer></script>';
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tag}</body>`) : html + tag;
      hit = { mtime: st.mtimeMs, html };
      htmlCache.set(file, hit);
    }
    res.set('Cache-Control', 'no-cache').type('html').send(hit.html);
  });
};
const mount = (url, slug, dir) => app.use(url, gate(slug), withAppBar(dir), express.static(dir, { index: 'index.html', dotfiles: 'ignore', maxAge: '5m' }));

// بيانات البوابة تُقرأ من قاعدة البيانات بنفس صيغة ملفات JSON القديمة
app.get('/portal/data/:file', gate('portal'), async (req, res, next) => {
  try {
    const f = req.params.file;
    if (![...FILES, ...READ_ONLY_FILES].includes(f)) return res.status(404).json({ error: 'غير موجود' });
    res.set('Cache-Control', 'no-store').json(await exportFile(pool, f));
  } catch (e) { next(e); }
});

app.get('/', (req, res) => res.redirect('/portal/'));   // الرابط الرئيسي يفتح البوابة
mount('/portal', 'portal', PORTAL_DIR);
mount('/card', 'card', path.join(MODULES, 'card'));
app.use('/vendor/chart.js', express.static(path.join(root, 'node_modules/chart.js/dist/chart.umd.js')));
app.use('/hr', gate('hr'), express.static(path.join(root, 'public/hr')));
app.use('/admin', gate('admin'), withAppBar(path.join(root, 'public/admin')), express.static(path.join(root, 'public/admin')));
app.use(express.static(path.join(root, 'public')));

app.use((err, req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'السجل موجود مسبقاً (قيمة مكررة)' });
  if (err.code === '23503') return res.status(409).json({ error: 'لا يمكن تنفيذ العملية لوجود سجلات مرتبطة' });
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'قيمة غير صالحة' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initSchema();
  const port = process.env.PORT || 3000;
  app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`المنصة تعمل على http://localhost:${port}`));
}
