// لوحة تحكم البوابة: بديل admin/api.ashx (كان يكتب ملفات JSON على IIS). نفس الإجراءات، لكن على قاعدة البيانات.
// الإجراءات: whoami، save، backups، restore، list، upload
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q } from '../db/pool.js';
import { wrap, audit } from '../lib/auth.js';
import { canUseApp } from '../lib/apps.js';
import { httpError } from '../lib/util.js';
import { FILES, exportFile, saveFile } from '../lib/portalData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORTAL_DIR = path.resolve(here, '../../modules/portal');
const MAX_BACKUPS = 40;

const IMG = ['.png', '.jpg', '.jpeg', '.webp'];
const RULES = {
  policies: { dir: 'policies', exts: ['.pdf'], maxMb: 25 },
  'employee-photos': { dir: 'images/content/employee-info', exts: IMG, maxMb: 5 },
  'link-images': { dir: 'images/content/library-links', exts: IMG, maxMb: 5 },
  ads: { dir: 'images/ads', exts: IMG, maxMb: 8 },
  'location-photos': { dir: 'images/content/locations', exts: IMG, maxMb: 5 },
};

const magicOk = (ext, b) => {
  if (b.length < 12) return false;
  switch (ext) {
    case '.pdf': return b.subarray(0, 4).toString('latin1') === '%PDF';
    case '.png': return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case '.jpg': case '.jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case '.webp': return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
};

const safeName = raw => {
  const base = path.basename(raw || '');
  const ext = path.extname(base).toLowerCase();
  let stem = path.basename(base, path.extname(base)).replace(/[^\p{L}\p{N}\-_ ()]/gu, '_').replace(/^[ _.]+|[ _.]+$/g, '');
  if (!stem) stem = 'file';
  return stem.slice(0, 80) + ext;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const r = Router();

const ok = (res, body = {}) => res.json({ ok: true, ...body });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

r.use(wrap(async (req, res, next) => {
  req.portalAllowed = await canUseApp(req.user, 'portal-admin');
  const action = String(req.query.action || '').toLowerCase();
  if (action === 'whoami') return ok(res, { user: `${req.user.full_name} (${req.user.username})`, allowed: req.portalAllowed });
  if (!req.portalAllowed) return fail(res, 403, 'غير مصرح لك بالدخول إلى لوحة التحكم.');
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
  if (req.action === 'upload') return upload.single('file')(req, res, next);
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
  const rule = RULES[req.query.dir];
  if (!rule) return fail(res, 400, 'مجلد غير مسموح.');
  const f = req.file;
  if (!f) return fail(res, 400, 'لم يتم اختيار ملف.');
  if (f.size > rule.maxMb * 1024 * 1024) return fail(res, 400, `حجم الملف غير مسموح (الحد الأقصى ${rule.maxMb} ميجابايت).`);
  const name = safeName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
  const ext = path.extname(name).toLowerCase();
  if (!rule.exts.includes(ext)) return fail(res, 400, `نوع الملف غير مسموح. المسموح: ${rule.exts.join(' ')}`);
  if (!magicOk(ext, f.buffer)) return fail(res, 400, 'محتوى الملف لا يطابق نوعه.');
  const dir = path.join(PORTAL_DIR, rule.dir);
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.basename(name, ext);
  let final = name;
  for (let n = 2; fs.existsSync(path.join(dir, final)); n++) final = `${stem}-${n}${ext}`;   // لا يُستبدل ملف موجود
  fs.writeFileSync(path.join(dir, final), f.buffer, { flag: 'wx' });
  await audit(req, 'upload', 'portal_upload', `${rule.dir}/${final}`, null, null);
  ok(res, { name: final, url: `${rule.dir}/${final}` });
}

export default r;
