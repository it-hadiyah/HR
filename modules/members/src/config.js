'use strict';
// إعدادات وحدة الأعضاء. تشارك المنصة الموحّدة قاعدة البيانات وحسابات الدخول (JWT) وجدول apps.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/pw-browsers/chromium'];
  try {
    for (const d of fs.readdirSync('/opt/pw-browsers')) if (d.startsWith('chromium-')) candidates.push(path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome'));
  } catch { /* لا شيء */ }
  return candidates.find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

module.exports = {
  root,
  nodeModules: path.join(root, 'node_modules'),
  databaseUrl: () => process.env.DATABASE_URL || 'postgres://hr:hr@localhost:5432/hr',
  uploadDir: path.resolve(process.env.MEMBERS_UPLOAD_DIR || path.join(root, 'uploads', 'members')),
  chromePath: findChrome(),
  maxUploadBytes: 5 * 1024 * 1024,
};
