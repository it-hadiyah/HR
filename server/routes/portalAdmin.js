// لوحة تحكم البوابة: بديل admin/api.ashx (كان يكتب ملفات JSON على IIS). نفس الإجراءات، لكن على قاعدة البيانات.
// الإجراءات: whoami، save، backups، restore، list، upload
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { pool, q } from '../db/pool.js';
import { wrap, audit } from '../lib/auth.js';
import { auditDenied } from '../lib/audit.js';
import { hasGrant } from '../lib/rbac.js';
import { canUseApp } from '../lib/apps.js';
import { httpError } from '../lib/util.js';
import { PORTAL_DIR, RULES, uploadMiddleware, saveUploadedFile } from '../lib/uploads.js';
import { FILES, exportFile, saveFile } from '../lib/portalData.js';

const MAX_BACKUPS = 40;

const r = Router();

const ok = (res, body = {}) => res.json({ ok: true, ...body });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// الصلاحية المطلوبة لكل إجراء (portal-admin): الحفظ والاستعادة تعديل، والرفع إضافة
const NEED = { save: 'update', restore: 'update', upload: 'create', backups: 'access', list: 'access', whoami: 'access' };

r.use(wrap(async (req, res, next) => {
  const action = String(req.query.action || '').toLowerCase();
  const allowed = (await canUseApp(req.user, 'portal-admin')) && hasGrant(req.user, 'portal-admin', NEED[action] || 'access');
  if (action === 'whoami') return ok(res, { user: `${req.user.full_name} (${req.user.username})`, allowed: await canUseApp(req.user, 'portal-admin') });
  if (!allowed) { await auditDenied(req, 'portal-admin', NEED[action] || 'access'); return fail(res, 403, 'غير مصرح لك بهذا الإجراء في لوحة التحكم.'); }
  const writes = ['save', 'upload', 'restore'].includes(action);
  if (writes && req.method !== 'POST') return fail(res, 405, 'الطريقة غير مسموحة.');
  if (writes && req.get('X-Requested-With') !== 'hadiyah-admin') return fail(res, 403, 'طلب غير صالح.');
  req.action = action;
  next();
}));

// حفظ ملف: لقطة احتياطية بالحالة الحالية، ثم الكتابة في معاملة واحدة
async function writeFile(req, file, data, note) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const before = await exportFile(c, file);
    await c.query('INSERT INTO portal_backups(file, data, saved_by, note) VALUES ($1,$2,$3,$4)', [file, JSON.stringify(before), req.user.username, note]);
    await saveFile(c, file, data, req.user.username);
    await c.query('DELETE FROM portal_backups WHERE file = $1 AND id NOT IN (SELECT id FROM portal_backups WHERE file = $1 ORDER BY id DESC LIMIT $2)', [file, MAX_BACKUPS]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await audit(req, note, 'portal_file', file, null, null);
}

const fileParam = req => {
  const f = String(req.query.file || '');
  if (!FILES.includes(f)) throw httpError(400, 'ملف غير مسموح.');
  return f;
};

// تحليل JSON حتى 20 ميجابايت لعمليات الحفظ، وmulter لعملية الرفع
const readBody = (req, res, next) => {
  if (req.action === 'upload') return uploadMiddleware(req, res, next);
  let size = 0; const chunks = [];
  req.on('data', d => { size += d.length; if (size > 20 * 1024 * 1024) req.destroy(); else chunks.push(d); });
  req.on('end', () => { try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { req.body = null; } next(); });
  req.on('error', next);
};

r.post('/', readBody, wrap(async (req, res) => {
  if (req.action === 'save') {
    const file = fileParam(req);
    if (!req.body || typeof req.body !== 'object') return fail(res, 400, 'البيانات ليست JSON صالحًا، لم يُحفظ شيء.');
    await writeFile(req, file, req.body, 'save');
    return ok(res, { file });
  }
  if (req.action === 'restore') {
    const file = fileParam(req);
    const name = String(req.query.backup || '');
    const row = (await q('SELECT data FROM portal_backups WHERE id = $1 AND file = $2', [name.replace(/\D/g, '') || 0, file])).rows[0];
    if (!row) return fail(res, 400, 'النسخة الاحتياطية غير موجودة.');
    await writeFile(req, file, row.data, `restore ${name} ->`);
    return ok(res, { file });
  }
  if (req.action === 'upload') return doUpload(req, res);
  fail(res, 400, 'إجراء غير معروف.');
}));

r.get('/', wrap(async (req, res) => {
  if (req.action === 'backups') {
    const file = fileParam(req);
    const { rows } = await q('SELECT id, length(data::text) AS size, saved_at, saved_by FROM portal_backups WHERE file = $1 ORDER BY id DESC LIMIT $2', [file, MAX_BACKUPS]);
    return ok(res, { backups: rows.map(b => ({ name: String(b.id), size: b.size, modified: new Date(b.saved_at).toISOString().replace('T', ' ').slice(0, 19), by: b.saved_by })) });
  }
  if (req.action === 'list') {
    const rule = RULES[req.query.dir];
    if (!rule) return fail(res, 400, 'مجلد غير مسموح.');
    const dir = path.join(PORTAL_DIR, rule.dir);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => rule.exts.includes(path.extname(f).toLowerCase())).sort()
        .map(f => ({ name: f, url: `${rule.dir}/${f}`, size: fs.statSync(path.join(dir, f)).size }))
      : [];
    return ok(res, { files });
  }
  fail(res, 400, 'إجراء غير معروف.');
}));

async function doUpload(req, res) {
  try {
    const out = saveUploadedFile(req.query.dir, req.file);
    await audit(req, 'upload', 'portal_upload', out.url, null, { dir: req.query.dir });
    ok(res, out);
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
}

export default r;
