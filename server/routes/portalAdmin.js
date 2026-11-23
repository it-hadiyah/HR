// لوحة تحكم البوابة: بديل admin/api.ashx (كان يكتب ملفات JSON على IIS). نفس الإجراءات، لكن على قاعدة البيانات.
// الإجراءات: whoami، save، backups، restore، list، upload
import { Router } from 'express';
import ExcelJS from 'exceljs';
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
const NEED = { save: 'update', restore: 'update', upload: 'create', backups: 'access', list: 'access', whoami: 'access', 'export-xlsx': 'access', 'parse-xlsx': 'access' };

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
  if (req.action === 'upload' || req.action === 'parse-xlsx') return uploadMiddleware(req, res, next);
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
  if (req.action === 'export-xlsx') return exportXlsx(req, res);
  if (req.action === 'parse-xlsx') return parseXlsx(req, res);
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

// ---------- Excel الموظفين: تصدير الصفوف الظاهرة في اللوحة (بما فيها غير المحفوظة) واستيراد ملف معدَّل ----------
const EMP_COLS = [['extension', 'التحويلة', 12], ['name', 'الاسم', 30], ['job', 'المسمى الوظيفي', 30], ['email', 'البريد الإلكتروني', 32], ['unit', 'الوحدة التنظيمية', 46], ['role', 'الدور في الوحدة', 16]];
const cellText = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') { if (v.result !== undefined) return cellText(v.result); if (v.text) return String(v.text).trim(); if (v.richText) return v.richText.map(x => x.text).join('').trim(); if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/i, ''); return ''; }
  return String(v).trim();
};

async function exportXlsx(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : null;
  if (!rows) return fail(res, 400, 'لا توجد صفوف للتصدير.');
  const units = Array.isArray(req.body?.units) ? req.body.units.map(String).slice(0, 2000) : [];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الموظفون', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = EMP_COLS.map(([key, header, width]) => ({ key, header, width }));
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF054D45' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
  for (const x of rows) ws.addRow({ extension: x.extension === '' || x.extension === null ? '' : Number(x.extension), name: String(x.name ?? ''), job: String(x.job ?? ''), email: String(x.email ?? ''), unit: String(x.unit ?? ''), role: String(x.role ?? 'عضو') });
  const uws = wb.addWorksheet('الوحدات', { views: [{ rightToLeft: true }] });
  uws.columns = [{ header: 'الوحدات التنظيمية المتاحة (انسخ النص كما هو)', key: 'u', width: 70 }];
  uws.getRow(1).font = { bold: true };
  units.forEach(u => uws.addRow({ u }));
  const last = Math.max(rows.length + 200, 400);
  for (let r = 2; r <= last; r++) {
    ws.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"عضو,رئيس"'] };
    if (units.length) ws.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`الوحدات!$A$2:$A$${units.length + 1}`], showErrorMessage: false };
  }
  const guide = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  guide.columns = [{ key: 'a', width: 110 }];
  for (const t of ['طريقة التعديل ثم الرفع:', '١) عدّل الصفوف أو أضف صفوفاً جديدة في ورقة «الموظفون» (لا تغيّر عناوين الأعمدة).',
    '٢) التحويلة رقم فريد لكل موظف: إن وُجدت في النظام تُحدَّث بياناته، وإن لم توجد يُضاف موظف جديد.',
    '٣) الوحدة التنظيمية: اخترها من القائمة (أو انسخها من ورقة «الوحدات»)؛ اتركها فارغة لموظف بلا وحدة.', '٤) الدور: «عضو» أو «رئيس».',
    '٥) ارفع الملف من لوحة التحكم ← الموظفون ← «استيراد Excel»؛ تُعرض معاينة قبل التطبيق ولا يُحفظ شيء حتى تضغط «حفظ التغييرات».',
    'الصور واللجان لا تتغير بالاستيراد.']) guide.addRow({ a: t });
  guide.getRow(1).font = { bold: true, size: 13 };
  await audit(req, 'export', 'portal_file', 'employees-xlsx', null, { count: rows.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.xlsx"');
  await wb.xlsx.write(res); res.end();
}

async function parseXlsx(req, res) {
  if (!req.file) return fail(res, 400, 'لم يُرفع ملف.');
  const wb = new ExcelJS.Workbook();
  try { if ((req.file.originalname || '').toLowerCase().endsWith('.csv')) await wb.csv.read((await import('node:stream')).Readable.from(req.file.buffer)); else await wb.xlsx.load(req.file.buffer); }
  catch { return fail(res, 400, 'تعذّرت قراءة الملف؛ استخدم ملف Excel الذي صدّرته من اللوحة.'); }
  const ws = wb.getWorksheet('الموظفون') || wb.worksheets[0];
  if (!ws) return fail(res, 400, 'الملف فارغ.');
  const labelToKey = new Map(EMP_COLS.map(([k, l]) => [l, k]));
  const map = []; ws.getRow(1).eachCell((c, i) => { const k = labelToKey.get(cellText(c.value).replace(/\s+/g, ' ')); if (k) map[i] = k; });
  if (!map.includes('extension') || !map.includes('name')) return fail(res, 400, 'أعمدة الملف لا تطابق النموذج (يلزم «التحويلة» و«الاسم»). صدّر الملف من اللوحة وعدّله.');
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = { row: n }; let any = false;
    row.eachCell({ includeEmpty: false }, (c, i) => { const k = map[i]; if (k) { o[k] = cellText(c.value); if (o[k] !== '') any = true; } });
    if (any) out.push(o);
  });
  if (!out.length) return fail(res, 400, 'لا توجد صفوف بيانات.');
  if (out.length > 5000) return fail(res, 400, 'الحد الأقصى 5000 صف.');
  ok(res, { rows: out, columns: [...new Set(map.filter(Boolean))] });
}

async function doUpload(req, res) {
  try {
    const out = saveUploadedFile(req.query.dir, req.file);
    await audit(req, 'upload', 'portal_upload', out.url, null, { dir: req.query.dir });
    ok(res, out);
  } catch (e) { if (e.status) return fail(res, e.status, e.message); throw e; }
}

export default r;
