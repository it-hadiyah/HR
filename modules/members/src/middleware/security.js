'use strict';
// الأمان داخل المنصة الموحّدة: المصادقة تتم في بوابة المنصة (JWT) فيصل req.user جاهزًا،
// وهنا: ربطه بدور النظام، حماية CSRF عديمة الحالة، فحص الأصل، وتحديد معدل الطلبات.
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const access = require('../services/access');
const { AppError, forbidden } = require('../lib/errors');

const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { error: 'طلبات كثيرة. حاول لاحقًا', code: 'rate_limited' } });

/** رمز CSRF مشتق من كوكي الجلسة HttpOnly (لا يقرؤه مهاجم من موقع آخر) */
const csrfFor = (req) => crypto.createHash('sha256').update('members-csrf:' + (req.cookies?.token || '')).digest('hex');

async function loadUser(req, res, next) {
  try {
    req.ctx = { user: null, perms: new Set(), ip: req.ip };
    if (!req.user) return next(new AppError(401, 'يجب تسجيل الدخول', 'unauthenticated'));
    const u = await access.resolveUser(req.user);
    if (!u) return next(new AppError(403, 'لا يملك دورك صلاحية الوصول إلى هذا النظام', 'no_access'));
    req.ctx.user = u; req.ctx.perms = new Set(u.permissions);
    next();
  } catch (e) { next(e); }
}

const requirePerm = (...codes) => (req, res, next) => (codes.every((c) => req.ctx.perms.has(c)) ? next() : next(forbidden()));
const requireAny = (...codes) => (req, res, next) => (codes.some((c) => req.ctx.perms.has(c)) ? next() : next(forbidden()));

function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token') || '';
  const expected = csrfFor(req);
  if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return next(new AppError(403, 'رمز الحماية غير صالح. أعد تحميل الصفحة', 'csrf'));
  }
  next();
}
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return next(new AppError(403, 'أصل الطلب غير مسموح', 'origin')); } catch { return next(new AppError(403, 'أصل الطلب غير صالح', 'origin')); }
  }
  next();
}

module.exports = { apiLimiter, loadUser, requirePerm, requireAny, csrf, sameOrigin, csrfFor };
