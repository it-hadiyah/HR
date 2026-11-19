// نماذج الموارد البشرية: قوالب (استفسار/لفت نظر/إشعار خصم)، بحث موظفي المتابعة، وسجل الصادر.
// الصلاحيات (منصة hr-forms): access للدخول، use للإصدار والسجل، manage لإدارة القوالب.
import { Router } from 'express';
import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { requireGrant, hasGrant } from '../lib/rbac.js';
import { httpError } from '../lib/util.js';
import multer from 'multer';
import { unitPaths } from './tracking.js';

const r = Router();
const use = requireGrant('hr-forms', 'use');
const manage = requireGrant('hr-forms', 'manage');

const FIELD_TYPES = ['text', 'textarea', 'date', 'dates', 'number', 'select', 'month'];
const RESERVED = new Set(['employee_name', 'emp_no', 'department', 'job_title', 'sector', 'section', 'issue_date', 'this']);
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** يتحقق من تعريف الحقول ويعيدها منظّفة */
export function cleanFields(raw) {
  if (!Array.isArray(raw)) throw httpError(400, 'تعريف الحقول يجب أن يكون قائمة');
  if (raw.length > 40) throw httpError(400, 'الحد الأقصى 40 حقلاً');
  const seen = new Set();
  return raw.map(f => {
    const key = str(f?.key, 31);
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) throw httpError(400, `اسم الحقل «${key}» غير صالح (حروف إنجليزية صغيرة وأرقام و_ وتبدأ بحرف)`);
    if (RESERVED.has(key)) throw httpError(400, `اسم الحقل «${key}» محجوز`);
    if (seen.has(key)) throw httpError(400, `اسم الحقل «${key}» مكرر`);
    seen.add(key);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const out = { key, label: str(f.label, 80) || key, type, required: !!f.required };
    if (f.default !== undefined && f.default !== null && String(f.default) !== '') out.default = str(f.default, 200);
    if (f.placeholder) out.placeholder = str(f.placeholder, 120);
    if (f.suggest && /^next_month_of:[a-z][a-z0-9_]{0,30}$/.test(String(f.suggest))) out.suggest = String(f.suggest);
    if (type === 'select') {
      const opts = Array.isArray(f.options) ? f.options : [];
      if (opts.length > 25) throw httpError(400, 'خيارات الحقل كثيرة (الحد 25)');
      out.options = opts.map(o => {
        const base = { value: str(o?.value, 160) };
        for (const [k, v] of Object.entries(o || {})) if (k !== 'value' && /^[a-z][a-z0-9_]{0,20}$/.test(k)) base[k] = str(v, 300);
        return base;
      });
    }
    return out;
  });
}

function cleanTemplate(b) {
  const title = str(b.title, 120);
  if (!title) throw httpError(400, 'العنوان مطلوب');
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').slice(0, 20000);
  if (!body.trim()) throw httpError(400, 'نص النموذج مطلوب');
  return { title, category: str(b.category, 60) || 'إنذارات', description: str(b.description, 300) || null, body, fields: cleanFields(b.fields ?? []),
    sort_order: Number.isFinite(+b.sort_order) ? Math.trunc(+b.sort_order) : 0, active: b.active !== false };
}

// ---- الختم الرسمي: صورة ثابتة تظهر في كل النماذج، تُستبدل من الإعدادات ----
const stampUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } }).single('file');
function sniffImage(buf) {   // PNG/JPEG/WebP فقط (لا SVG لمنع السكربتات)
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
async function stampInfo() {
  const en = (await q("SELECT value FROM hr_form_settings WHERE key = 'stamp_enabled'")).rows[0];
  const a = (await q("SELECT updated_at FROM hr_form_assets WHERE key = 'stamp'")).rows[0];
  return { enabled: en ? en.value !== false : true, custom: !!a, version: a ? new Date(a.updated_at).getTime() : 0 };
}
r.get('/stamp', wrap(async (req, res) => {
  const a = (await q("SELECT mime, data FROM hr_form_assets WHERE key = 'stamp'")).rows[0];
  if (!a) return res.redirect(302, '/hr-forms/img/stamp.png');
  res.set({ 'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(a.data);
}));
r.post('/stamp', manage, (req, res, next) => stampUpload(req, res, e => (e ? next(httpError(400, e.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 1 ميجابايت' : 'تعذّر رفع الصورة')) : next())), wrap(async (req, res) => {
  if (!req.file) throw httpError(400, 'اختر صورة الختم');
  const mime = sniffImage(req.file.buffer);
  if (!mime) throw httpError(400, 'الصيغة غير مدعومة: استخدم PNG أو JPG أو WebP (يُفضّل PNG بخلفية شفافة)');
  await q("INSERT INTO hr_form_assets(key, mime, data, updated_by) VALUES ('stamp', $1, $2, $3) ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()", [mime, req.file.buffer, req.user.username]);
  await audit(req, 'update', 'hr_form_stamp', 'stamp', null, { mime, bytes: req.file.buffer.length });
  res.json({ stamp: await stampInfo() });
}));
r.delete('/stamp', manage, wrap(async (req, res) => {
  await q("DELETE FROM hr_form_assets WHERE key = 'stamp'");
  await audit(req, 'delete', 'hr_form_stamp', 'stamp', { custom: true }, { custom: false });
  res.json({ stamp: await stampInfo() });
}));
r.put('/stamp/enabled', manage, wrap(async (req, res) => {
  const on = req.body?.enabled !== false;
  await q("INSERT INTO hr_form_settings(key, value, updated_by) VALUES ('stamp_enabled', $1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()", [JSON.stringify(on), req.user.username]);
  await audit(req, 'update', 'hr_form_stamp', 'enabled', null, { enabled: on });
  res.json({ stamp: await stampInfo() });
}));

// ---- القوالب ----
r.get('/templates', wrap(async (req, res) => {
  const all = req.query.all === '1' && hasGrant(req.user, 'hr-forms', 'manage');
  const { rows } = await q(`SELECT id, slug, title, category, description, body, fields, sort_order, active, version, updated_by, updated_at FROM hr_form_templates ${all ? '' : 'WHERE active'} ORDER BY sort_order, id`);
  res.json({ templates: rows, can_manage: hasGrant(req.user, 'hr-forms', 'manage'), can_use: hasGrant(req.user, 'hr-forms', 'use'), stamp: await stampInfo() });
}));

r.post('/templates', manage, wrap(async (req, res) => {
  const t = cleanTemplate(req.body || {});
  const slug = /^[a-z0-9-]{3,40}$/.test(String(req.body.slug || '')) ? req.body.slug : 'tpl-' + crypto.randomBytes(4).toString('hex');
  let row;
  try {
    row = (await q(`INSERT INTO hr_form_templates(slug, title, category, description, body, fields, sort_order, active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [slug, t.title, t.category, t.description, t.body, JSON.stringify(t.fields), t.sort_order, t.active, req.user.username])).rows[0];
  } catch (e) { if (e.code === '23505') throw httpError(409, 'المعرّف مستخدم'); throw e; }
  await audit(req, 'create', 'hr_form_template', row.id, null, { title: row.title, slug });
  res.status(201).json(row);
}));

r.put('/templates/:id', manage, wrap(async (req, res) => {
  const id = +req.params.id;
  const old = (await q('SELECT * FROM hr_form_templates WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'النموذج غير موجود');
  const t = cleanTemplate({ ...old, ...req.body });
  const row = (await q(`UPDATE hr_form_templates SET title=$2, category=$3, description=$4, body=$5, fields=$6, sort_order=$7, active=$8, version = version + 1, updated_by=$9, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, t.title, t.category, t.description, t.body, JSON.stringify(t.fields), t.sort_order, t.active, req.user.username])).rows[0];
  await audit(req, 'update', 'hr_form_template', id, { title: old.title, active: old.active, version: old.version }, { title: row.title, active: row.active, version: row.version });
  res.json(row);
}));

// ---- موظفو المتابعة (جدول leave_staff) للاختيار ----
r.get('/employees', use, wrap(async (req, res) => {
  const term = str(req.query.q, 60);
  const p = [];
  const where = ["status = 'active'"];
  if (term) { p.push(`%${term}%`); where.push('(full_name ILIKE $1 OR emp_no ILIKE $1 OR job_title ILIKE $1)'); }
  const rows = (await q(`SELECT id, emp_no, full_name, job_title, org_unit_id FROM leave_staff WHERE ${where.join(' AND ')} ORDER BY full_name LIMIT 40`, p)).rows;
  const pathOf = await unitPaths();
  res.json({ employees: rows.map(e => { const u = pathOf(e.org_unit_id); return { id: e.id, emp_no: e.emp_no, full_name: e.full_name, job_title: e.job_title, sector: u.sector, department: u.department, section: u.section }; }) });
}));

// ---- سجل الصادر ----
r.post('/log', use, wrap(async (req, res) => {
  const b = req.body || {};
  const tpl = (await q('SELECT id, title FROM hr_form_templates WHERE id = $1', [+b.template_id])).rows[0];
  if (!tpl) throw httpError(400, 'النموذج غير موجود');
  const name = str(b.employee_name, 160);
  if (!name) throw httpError(400, 'اسم الموظف مطلوب');
  const text = String(b.body_text ?? '').slice(0, 30000);
  if (!text.trim()) throw httpError(400, 'نص النموذج فارغ');
  const values = b.values && typeof b.values === 'object' ? b.values : {};
  if (JSON.stringify(values).length > 20000) throw httpError(400, 'قيم النموذج كبيرة');
  let empId = null;
  if (Number.isInteger(+b.employee_id) && +b.employee_id > 0 && (await q('SELECT 1 FROM leave_staff WHERE id = $1', [+b.employee_id])).rows.length) empId = +b.employee_id;
  const action = ['copy', 'copy_rich', 'print', 'save'].includes(b.action) ? b.action : 'copy';
  const empNo = str(b.emp_no, 40) || null;
  const row = (await q(`INSERT INTO hr_form_log(template_id, template_title, employee_id, employee_name, emp_no, department, values, body_text, action, issued_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, issued_at`, [tpl.id, tpl.title, empId, name, empNo, str(b.department, 160) || null, JSON.stringify(values), text, action, req.user.username])).rows[0];
  await audit(req, 'issue', 'hr_form', row.id, null, { template: tpl.title, employee: name, emp_no: empNo, action });
  res.status(201).json(row);
}));

r.get('/log', use, wrap(async (req, res) => {
  const p = [];
  const where = ['TRUE'];
  if (Number.isInteger(+req.query.employee_id) && +req.query.employee_id > 0) { p.push(+req.query.employee_id); where.push(`l.employee_id = $${p.length}`); }
  if (Number.isInteger(+req.query.template_id) && +req.query.template_id > 0) { p.push(+req.query.template_id); where.push(`l.template_id = $${p.length}`); }
  const term = str(req.query.q, 60);
  if (term) { p.push(`%${term}%`); where.push(`(l.employee_name ILIKE $${p.length} OR l.emp_no ILIKE $${p.length} OR l.template_title ILIKE $${p.length})`); }
  const limit = Math.min(Math.max(+req.query.limit || 100, 1), 300);
  const { rows } = await q(`SELECT l.id, l.template_id, l.template_title, l.employee_id, l.employee_name, l.emp_no, l.department, l.action, l.issued_by, l.issued_at
    FROM hr_form_log l WHERE ${where.join(' AND ')} ORDER BY l.issued_at DESC, l.id DESC LIMIT ${limit}`, p);
  res.json({ log: rows });
}));

r.get('/log/:id', use, wrap(async (req, res) => {
  const row = (await q('SELECT * FROM hr_form_log WHERE id = $1', [+req.params.id])).rows[0];
  if (!row) throw httpError(404, 'السجل غير موجود');
  res.json(row);
}));

// ملخص ما صدر لموظف (لعرض تكرار المخالفات قبل الإصدار)
r.get('/employee/:id/summary', use, wrap(async (req, res) => {
  const { rows } = await q(`SELECT template_id, template_title, count(*)::int AS n, max(issued_at) AS last_at FROM hr_form_log WHERE employee_id = $1 AND action <> 'save' GROUP BY template_id, template_title ORDER BY max(issued_at) DESC`, [+req.params.id]);
  res.json({ summary: rows });
}));

export default r;
