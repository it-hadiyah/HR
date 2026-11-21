'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const sec = require('./middleware/security');
const api = require('./routes/api');
const settings = require('./services/settings');

const PUBLIC = path.join(__dirname, '..', 'public');

/** راوتر نظام الأعضاء. يُركَّب في المنصة على /members بعد بوابة الدخول (gate) التي تضع req.user. */
function createRouter() {
  const r = express.Router();
  r.use('/api', express.json({ limit: '100kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    sec.apiLimiter, sec.sameOrigin, sec.loadUser, sec.csrf, api);

  // الشعار (PNG/JPG فقط، اسم ملف مولَّد ومُتحقَّق منه)
  r.get('/branding/logo', async (req, res, next) => {
    try {
      const name = (await settings.getPublic())['org.logo'];
      if (!name || !/^logo-[0-9a-f]{16}\.(png|jpg)$/.test(name)) return res.status(404).end();
      const f = path.join(config.uploadDir, 'branding', name);
      if (!fs.existsSync(f)) return res.status(404).end();
      res.set({ 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.type(path.extname(f)).sendFile(f);
    } catch (e) { next(e); }
  });

  const nm = config.nodeModules;
  r.use('/vendor/chart', express.static(path.join(nm, 'chart.js', 'dist'), { index: false, maxAge: '7d' }));
  r.use('/vendor/fonts', express.static(path.join(nm, '@fontsource', 'ibm-plex-sans-arabic', 'files'), { index: false, maxAge: '30d', immutable: true }));
  r.use(express.static(PUBLIC, { index: 'index.html', maxAge: 0, etag: true }));
  r.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

  // معالج الأخطاء: رسائل واضحة بلا تسريب تفاصيل داخلية
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'صيغة JSON غير صالحة', code: 'bad_json' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم الملف يتجاوز الحد المسموح', code: 'file_too_large' });
    if (err.name === 'MulterError') return res.status(400).json({ error: 'خطأ في رفع الملف', code: 'upload' });
    if (err.status && err.code) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    console.error(`[members ${new Date().toISOString()}] ${req.method} ${req.path}:`, err.stack || err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع. حاول مرة أخرى', code: 'internal' });
  });
  return r;
}
module.exports = { createRouter, PUBLIC };
