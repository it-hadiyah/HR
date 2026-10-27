'use strict';
// قراءة config.json مع تخزين مؤقت يتجدد عند تغيّر الملف
const fs = require('fs');
const path = require('path');
const FILE = process.env.RB_CONFIG || path.join(__dirname, '..', 'config.json');
let cache = null, mtime = 0;

const DEFAULT_AUTH = { mode: 'ad', domain: '', server: '', admins: [], managers: [], adminGroups: [], managerGroups: [], sessionHours: 8, secureCookie: false, trustProxy: false, adCommand: null };

function get() {
  try {
    const st = fs.statSync(FILE);
    if (!cache || st.mtimeMs !== mtime) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')); mtime = st.mtimeMs; }
  } catch (e) { cache = cache || {}; }
  return Object.assign({}, cache, { auth: Object.assign({}, DEFAULT_AUTH, cache.auth || {}) });
}
module.exports = { get };
