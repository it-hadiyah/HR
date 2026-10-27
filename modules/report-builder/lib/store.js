'use strict';
// تخزين ملفات البيانات (المستخدمون، الجلسات، سجل التدقيق) داخل مجلد data بدون قاعدة بيانات
const fs = require('fs');
const path = require('path');
const DATA = process.env.RB_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

const file = (n) => path.join(DATA, n);
function readJson(name, def) { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) { return def; } }
function writeJson(name, obj) { const p = file(name), t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o600 }); fs.renameSync(t, p); }

// المنصة تسجّل كل عملية أيضاً في سجل التدقيق المركزي (audit_logs)
let sink = null;
const setSink = (fn) => { sink = fn; };
function audit(entry) {
  if (sink) { try { sink(entry); } catch (e) { /* لا تُسقط العملية الأصلية */ } }
  try { fs.appendFile(file('audit.log'), JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n', () => {}); } catch (e) { /* ignore */ }
}
function readAudit(n = 200) {
  try {
    const lines = fs.readFileSync(file('audit.log'), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).reverse().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
module.exports = { readJson, writeJson, audit, readAudit, setSink, DATA };
