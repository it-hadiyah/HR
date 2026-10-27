'use strict';
// روابط المشاركة للتقارير والعروض: بعد الدخول / لمستخدمين محددين / بكلمة مرور، مع انتهاء وإلغاء وسجل وصول
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const FILE = 'shares.json';
const LOG = path.join(store.DATA, 'share-access.log');
const MODES = ['login', 'users', 'password'];
let shares = store.readJson(FILE, {});
const save = () => store.writeJson(FILE, shares);

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPw(pw) { const salt = crypto.randomBytes(16); return salt.toString('hex') + '$' + (await scrypt(pw, salt)).toString('hex'); }
async function checkPw(pw, stored) {
  const [s, h] = String(stored || '').split('$'); if (!s || !h) return false;
  const a = await scrypt(String(pw || ''), Buffer.from(s, 'hex')), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const state = (s) => (s.revoked ? 'revoked' : s.expiresAt && Date.parse(s.expiresAt) <= Date.now() ? 'expired' : 'active');
const pub = (s) => ({ token: s.token, type: s.type, id: s.id, mode: s.mode, users: s.users || [], hasPassword: !!s.passHash, expiresAt: s.expiresAt || null, noPrint: !!s.noPrint, label: s.label || '', createdAt: s.createdAt, createdByName: s.ownerName, views: s.views || 0, lastViewAt: s.lastViewAt || null, state: state(s), url: '/s/' + s.token });

async function create(owner, o) {
  if (!['deck', 'report'].includes(o.type)) throw new Error('نوع غير صالح');
  if (!MODES.includes(o.mode)) throw new Error('نوع الرابط غير صالح');
  const s = { token: crypto.randomBytes(18).toString('base64url'), type: o.type, id: String(o.id), owner: owner.username, ownerName: owner.name, mode: o.mode, users: [], passHash: '', expiresAt: null, noPrint: !!o.noPrint, revoked: false, label: String(o.label || '').slice(0, 100), createdAt: new Date().toISOString(), views: 0 };
  if (o.mode === 'users') {
    s.users = Array.from(new Set((o.users || []).map(String))).slice(0, 100);
    if (!s.users.length) throw new Error('اختر مستخدماً واحداً على الأقل');
  }
  if (o.mode === 'password') {
    if (String(o.password || '').length < 4) throw new Error('كلمة المرور 4 أحرف على الأقل');
    s.passHash = await hashPw(String(o.password));
  }
  const days = parseInt(o.expiresDays, 10);
  if (days > 0) s.expiresAt = new Date(Date.now() + Math.min(days, 365) * 86400000).toISOString();
  shares[s.token] = s; save();
  return s;
}

const get = (t) => shares[String(t)] || null;
const listFor = (type, id) => Object.values(shares).filter((s) => s.type === type && s.id === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const listByOwner = (u) => Object.values(shares).filter((s) => s.owner === u).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
function revoke(token) { const s = get(token); if (s) { s.revoked = true; s.revokedAt = new Date().toISOString(); save(); } return s; }
function remove(token) { delete shares[token]; save(); }
function removeFor(type, id) { Object.keys(shares).forEach((t) => { if (shares[t].type === type && shares[t].id === id) delete shares[t]; }); save(); }

// سجل الوصول: سطر JSON لكل محاولة
function log(token, entry) { try { fs.appendFile(LOG, JSON.stringify(Object.assign({ at: new Date().toISOString(), token }, entry)) + '\n', () => {}); } catch (e) { /* ignore */ } }
function readLog(token, n = 100) {
  try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((x) => x && x.token === token).slice(-n).reverse(); } catch (e) { return []; }
}
function view(s) { s.views = (s.views || 0) + 1; s.lastViewAt = new Date().toISOString(); save(); }

// رمز فتح القفل لكلمة المرور (HMAC بسر الخادم) يُحفظ في كوكي لكل رابط
const SECRET = (() => { let d = store.readJson('share-secret.json', null); if (!d || !d.k) { d = { k: crypto.randomBytes(32).toString('hex') }; store.writeJson('share-secret.json', d); } return Buffer.from(d.k, 'hex'); })();
const unlockToken = (s) => crypto.createHmac('sha256', SECRET).update(s.token + '|' + s.passHash).digest('base64url');
const unlockOk = (s, v) => { const a = Buffer.from(String(v || '')), b = Buffer.from(unlockToken(s)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

module.exports = { create, get, listFor, listByOwner, revoke, remove, removeFor, pub, state, checkPw, log, readLog, view, unlockToken, unlockOk, MODES };
