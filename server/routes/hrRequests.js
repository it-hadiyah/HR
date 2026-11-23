// طلبات الموظفين (خطاب تعريف بالراتب / تثبيت بالراتب): يرفعها الموظف، تراجعها الموارد البشرية وتعتمدها،
// فيصدر مستند مختوم بلقطة نصية ثابتة ورقم مرجع وبصمة تحقق، وينزّله الموظف (طباعة/حفظ PDF من المتصفح أو PDF من الخادم إن توفّر Chromium).
// الصلاحيات (منصة hr-requests): access رفع الطلبات وعرض طلباتي · review مراجعة الطلبات واعتمادها أو رفضها.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { q } from '../db/pool.js';
import { audit, wrap } from '../lib/auth.js';
import { hasGrant } from '../lib/rbac.js';
import { httpError, isDate } from '../lib/util.js';
import { renderTemplate, buildVars, defaultValues, missingRequired } from '../../public/hr-forms/engine.js';
import { staffRows } from './payroll.js';
import { renderDocumentHtml } from '../lib/hrDocument.js';
import loansRouter from './hrLoans.js';
import { signatureDataUrl, hasSignature } from './myProfile.js';

const r = Router();
r.param('id', (req, res, next, v) => (/^\d+$/.test(v) ? next() : next('route')));   // Express 5: بلا تعبير نمطي داخل المسار
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.join(HERE, '../../public/hr-requests/img');
const TYPES = { certificate: { slug: 'salary-certificate', title: 'خطاب تعريف بالراتب' }, fixation: { slug: 'salary-fixation', title: 'تثبيت بالراتب' } };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isReviewer = u => hasGrant(u, 'hr-requests', 'review');
const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const round2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const normIban = v => String(v ?? '').replace(/\s/g, '').toUpperCase();

// ---- الموظف المرتبط بحساب المستخدم (سجل الموظفين المشترك leave_staff) ----
async function myStaff(user) {
  if (!user.employee_id) return null;
  return (await q(`SELECT s.* FROM leave_staff s WHERE s.status = 'active' AND (s.source_employee_id = $1
      OR (s.emp_no IS NOT NULL AND s.emp_no = (SELECT emp_no FROM employees WHERE id = $1))) ORDER BY s.id LIMIT 1`, [user.employee_id])).rows[0] || null;
}
const dateOnly = d => (d ? new Date(d).toISOString().slice(0, 10) : null);
async function template(type) {
  const t = (await q('SELECT slug, title, body, fields FROM hr_form_templates WHERE slug = $1', [TYPES[type].slug])).rows[0];
  if (!t) throw httpError(500, 'قالب النموذج غير موجود');
  return t;
}
const rowOut = x => ({ id: x.id, ref_no: x.ref_no, type: x.type, type_title: TYPES[x.type]?.title, status: x.status, employee_id: x.employee_id, employee_name: x.employee_name, emp_no: x.emp_no,
  requester_name: x.requester_name, params: x.params, created_at: x.created_at, decided_by: x.decided_by, decided_at: x.decided_at, decision_note: x.decision_note,
  rated: !!x.rated_at, rating_service: x.rating_service ?? null, rating_speed: x.rating_speed ?? null, rating_comment: x.rating_comment ?? null });
const SELECT = `SELECT h.*, s.full_name AS employee_name, s.emp_no FROM hr_requests h JOIN leave_staff s ON s.id = h.employee_id`;
// يشترط تقييم الخدمة قبل تحميل المستند: يسري على صاحب الطلب نفسه (المراجعون من الموارد البشرية يطّلعون دون تقييم)
function ratingGate(req, res, row) {
  if (row.requester_user_id === req.user.id && !row.rated_at) {
    res.status(403).json({ error: 'قيّم الخدمة أولاً لتتمكن من تحميل المستند', code: 'rating_required', id: row.id });
    return true;
  }
  return false;
}
async function loadRequest(req, id) {
  const row = (await q(`${SELECT} WHERE h.id = $1`, [id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  if (!isReviewer(req.user) && row.requester_user_id !== req.user.id) throw httpError(404, 'الطلب غير موجود');
  return row;
}

// ---- الختم الرسمي: نفس إعدادات «نماذج الموارد البشرية» (الافتراضي أو المرفوع) ----
async function stampState() {
  const en = (await q("SELECT value FROM hr_form_settings WHERE key = 'stamp_enabled'")).rows[0];
  const a = (await q("SELECT mime, data, updated_at FROM hr_form_assets WHERE key = 'stamp'")).rows[0];
  return { enabled: en ? en.value !== false : true, mime: a?.mime || 'image/png', data: a?.data || fs.readFileSync(path.join(IMG, 'stamp.png')), version: a ? new Date(a.updated_at).getTime() : 0 };
}
r.use('/loans', loansRouter);   // طلبات السلف: مسارات منفصلة بخصوصية خاصة (انظر hrLoans.js)
r.get('/stamp', wrap(async (req, res) => {
  const s = await stampState();
  res.set({ 'Content-Type': s.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(s.data);
}));

function chromeAvailable() { try { return !!require('../../modules/members/src/config').chromePath; } catch { return false; } }

r.get('/meta', wrap(async (req, res) => {
  const staff = await myStaff(req.user);
  const st = await stampState();
  const counts = isReviewer(req.user) ? (await q("SELECT count(*)::int AS n FROM hr_requests WHERE status = 'pending'")).rows[0].n : 0;
  const gc = (await q("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'pending_guarantor')::int AS pending FROM hr_loans WHERE guarantor_user_id = $1", [req.user.id])).rows[0];
  const lp = isReviewer(req.user) ? (await q("SELECT count(*)::int AS n FROM hr_loans WHERE status = 'pending_hr'")).rows[0].n : 0;
  const hasSig = await hasSignature(req.user.id);
  res.json({ has_signature: hasSig, loans: { guarantee_total: gc.total, guarantee_pending: gc.pending, pending_hr: lp }, can: { review: isReviewer(req.user) }, types: Object.entries(TYPES).map(([id, t]) => ({ id, title: t.title })), pdf: chromeAvailable(), pending: counts, stamp: { enabled: st.enabled, version: st.version },
    me: staff ? { id: staff.id, full_name: staff.full_name, emp_no: staff.emp_no, job_title: staff.job_title, iban: staff.iban || '' } : null });
}));

// ---- رفع طلب ----
r.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  if (!TYPES[b.type]) throw httpError(400, 'نوع الطلب غير صالح');
  let staff = null;
  if (b.employee_id && isReviewer(req.user)) staff = (await q("SELECT * FROM leave_staff WHERE id = $1 AND status = 'active'", [+b.employee_id])).rows[0];
  else staff = await myStaff(req.user);
  if (!staff) throw httpError(400, b.employee_id ? 'الموظف غير موجود' : 'حسابك غير مرتبط بسجل موظف؛ تواصل مع الموارد البشرية');
  const params = {};
  if (b.type === 'certificate') params.to = str(b.to, 120) || 'قسم المساعدات';
  else {
    params.bank = str(b.bank, 80); if (!params.bank) throw httpError(400, 'اسم البنك مطلوب');
    params.iban = normIban(b.iban); if (!/^SA\d{22}$/.test(params.iban)) throw httpError(400, 'الآيبان يبدأ بـ SA ويتبعه 22 رقماً');
  }
  if (str(b.notes, 300)) params.notes = str(b.notes, 300);
  const dup = (await q("SELECT ref_no FROM hr_requests WHERE employee_id = $1 AND type = $2 AND status = 'pending' LIMIT 1", [staff.id, b.type])).rows[0];
  if (dup) throw httpError(409, `لديك طلب مماثل قيد المراجعة (${dup.ref_no})`);
  const seq = (await q("SELECT nextval('hr_requests_ref_seq')::int AS n")).rows[0].n;
  const ref = `HR-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
  const row = (await q(`INSERT INTO hr_requests(ref_no, type, employee_id, requester_user_id, requester_name, params) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ref, b.type, staff.id, req.user.id, req.user.full_name, JSON.stringify(params)])).rows[0];
  await audit(req, 'create', 'hr_request', row.id, null, { ref_no: ref, type: b.type, employee_id: staff.id });
  res.status(201).json({ request: rowOut((await q(`${SELECT} WHERE h.id = $1`, [row.id])).rows[0]) });
}));

r.get('/mine', wrap(async (req, res) => {
  const rows = (await q(`${SELECT} WHERE h.requester_user_id = $1 ORDER BY h.created_at DESC, h.id DESC LIMIT 200`, [req.user.id])).rows;
  res.json({ requests: rows.map(rowOut) });
}));

r.get('/', wrap(async (req, res) => {
  if (!isReviewer(req.user)) throw httpError(403, 'لا تملك صلاحية مراجعة الطلبات');
  const p = []; const where = [];
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) { p.push(req.query.status); where.push(`h.status = $${p.length}`); }
  if (TYPES[req.query.type]) { p.push(req.query.type); where.push(`h.type = $${p.length}`); }
  const term = str(req.query.q, 60);
  if (term) { p.push(`%${term}%`); where.push(`(s.full_name ILIKE $${p.length} OR s.emp_no ILIKE $${p.length} OR h.ref_no ILIKE $${p.length})`); }
  const rows = (await q(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (h.status = 'pending') DESC, h.created_at DESC, h.id DESC LIMIT 500`, p)).rows;
  const sum = (await q("SELECT count(rated_at)::int AS n, round(avg(rating_service), 2)::float8 AS service, round(avg(rating_speed), 2)::float8 AS speed FROM hr_requests WHERE rated_at IS NOT NULL")).rows[0];
  res.json({ requests: rows.map(rowOut), ratings: { count: sum.n, service: sum.service, speed: sum.speed } });
}));

// ---- تفاصيل طلب (للمراجع: بيانات مقترحة من سجل الموظف والرواتب لتعبئة النموذج) ----
async function suggestions(row) {
  const s = (await q('SELECT * FROM leave_staff WHERE id = $1', [row.employee_id])).rows[0];
  const t = await template(row.type);
  const sug = { ...defaultValues(t.fields), nationality: s.nationality || 'سعودي' };
  if (row.type === 'certificate') {
    Object.assign(sug, { hire_date: dateOnly(s.hire_date) || '', national_id: s.national_id || '', to: row.params.to || 'قسم المساعدات' });
    const sal = (await staffRows({ status: 'all', ids: [s.id] }))[0];
    if (sal?.has_salary) Object.assign(sug, { basic: String(sal.basic), housing: String(sal.housing), transport: String(sal.transport), other: String(sal.other) });
  } else Object.assign(sug, { bank: row.params.bank, iban: row.params.iban });
  return { staff: { id: s.id, full_name: s.full_name, emp_no: s.emp_no, job_title: s.job_title, hire_date: dateOnly(s.hire_date) }, fields: t.fields, values: sug };
}
r.get('/:id', wrap(async (req, res) => {
  const row = await loadRequest(req, +req.params.id);
  const out = { request: rowOut(row) };
  if (isReviewer(req.user) && row.status === 'pending') out.review = await suggestions(row);
  res.json(out);
}));

function buildDocument(row, staff, tpl, data, issueDate) {
  const values = { ...defaultValues(tpl.fields) };
  for (const f of tpl.fields) if (f.key in data) values[f.key] = str(data[f.key], 200);
  const miss = missingRequired(tpl.fields, values);
  if (miss.length) throw httpError(400, `حقول مطلوبة: ${miss.join('، ')}`);
  for (const f of tpl.fields) {
    if (f.type === 'number' && values[f.key] !== '' && !Number.isFinite(Number(String(values[f.key]).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))))) throw httpError(400, `قيمة غير صالحة: ${f.label}`);
    if (f.type === 'date' && values[f.key] && !isDate(values[f.key])) throw httpError(400, `تاريخ غير صالح: ${f.label}`);
  }
  if (values.national_id && !/^\d{10}$/.test(values.national_id)) throw httpError(400, 'رقم الهوية 10 أرقام');
  if (values.iban) { values.iban = normIban(values.iban); if (!/^SA\d{22}$/.test(values.iban)) throw httpError(400, 'الآيبان غير صالح'); }
  const text = renderTemplate(tpl.body, { vars: buildVars({ employee: { full_name: staff.full_name, emp_no: staff.emp_no, job_title: staff.job_title }, values, issueDate }), fields: tpl.fields });
  return { text, values };
}

// معاينة النص قبل الاعتماد (لا تكتب شيئاً)
r.post('/:id/preview', wrap(async (req, res) => {
  if (!isReviewer(req.user)) throw httpError(403, 'لا تملك صلاحية المراجعة');
  const row = await loadRequest(req, +req.params.id);
  if (row.status !== 'pending') throw httpError(409, 'الطلب لم يعد قيد المراجعة');
  const staff = (await q('SELECT * FROM leave_staff WHERE id = $1', [row.employee_id])).rows[0];
  const tpl = await template(row.type);
  const values = { ...defaultValues(tpl.fields) };
  for (const f of tpl.fields) if (f.key in (req.body?.data || {})) values[f.key] = str(req.body.data[f.key], 200);
  const text = renderTemplate(tpl.body, { vars: buildVars({ employee: { full_name: staff.full_name, emp_no: staff.emp_no, job_title: staff.job_title }, values, issueDate: todayRiyadh() }), fields: tpl.fields });
  res.json({ text, missing: missingRequired(tpl.fields, values) });
}));

r.post('/:id/approve', wrap(async (req, res) => {
  if (!isReviewer(req.user)) throw httpError(403, 'لا تملك صلاحية الاعتماد');
  const id = +req.params.id;
  const row = await loadRequest(req, id);
  if (row.status !== 'pending') throw httpError(409, 'الطلب لم يعد قيد المراجعة');
  const staff = (await q('SELECT * FROM leave_staff WHERE id = $1', [row.employee_id])).rows[0];
  const tpl = await template(row.type);
  const issueDate = todayRiyadh();
  const { text, values } = buildDocument(row, staff, tpl, req.body?.data || {}, issueDate);
  const hash = crypto.createHash('sha256').update(`${row.ref_no}\n${text}`).digest('hex');
  const upd = (await q(`UPDATE hr_requests SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3, document_text = $4, document_data = $5, document_hash = $6, updated_at = now()
    WHERE id = $1 AND status = 'pending' RETURNING id`, [id, req.user.username, str(req.body?.note, 300) || null, text, JSON.stringify({ issue_date: issueDate, values, signature: await signatureDataUrl(req.user.id) }), hash])).rows[0];
  if (!upd) throw httpError(409, 'تم البت في الطلب من مراجع آخر');
  // تحديث بيانات الموظف الناقصة من البيانات المعتمدة (الحساسة بصلاحية hr-employees/sensitive)
  const sets = []; const vals = [staff.id];
  const fill = (col, v) => { if (v && !staff[col]) { vals.push(v); sets.push(`${col} = $${vals.length}`); } };
  fill('hire_date', values.hire_date); fill('nationality', values.nationality);
  if (hasGrant(req.user, 'hr-employees', 'sensitive')) { fill('national_id', values.national_id); fill('iban', values.iban); }
  if (sets.length) { try { await q(`UPDATE leave_staff SET ${sets.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, vals); } catch (e) { if (e.code !== '23505') throw e; } }
  await audit(req, 'approve', 'hr_request', id, { status: 'pending' }, { status: 'approved', ref_no: row.ref_no, type: row.type });
  res.json({ request: rowOut((await q(`${SELECT} WHERE h.id = $1`, [id])).rows[0]) });
}));

r.post('/:id/reject', wrap(async (req, res) => {
  if (!isReviewer(req.user)) throw httpError(403, 'لا تملك صلاحية الرفض');
  const id = +req.params.id; const note = str(req.body?.note, 300);
  if (note.length < 3) throw httpError(400, 'اكتب سبب الرفض');
  const row = await loadRequest(req, id);
  if (row.status !== 'pending') throw httpError(409, 'الطلب لم يعد قيد المراجعة');
  await q("UPDATE hr_requests SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $1 AND status = 'pending'", [id, req.user.username, note]);
  await audit(req, 'reject', 'hr_request', id, { status: 'pending' }, { status: 'rejected', ref_no: row.ref_no });
  res.json({ request: rowOut((await q(`${SELECT} WHERE h.id = $1`, [id])).rows[0]) });
}));

r.post('/:id/cancel', wrap(async (req, res) => {
  const id = +req.params.id;
  const row = await loadRequest(req, id);
  if (row.requester_user_id !== req.user.id && !isReviewer(req.user)) throw httpError(403, 'لا يحق لك إلغاء هذا الطلب');
  if (row.status !== 'pending') throw httpError(409, 'لا يمكن إلغاء طلب تمت معالجته');
  await q("UPDATE hr_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'", [id]);
  await audit(req, 'update', 'hr_request', id, { status: 'pending' }, { status: 'cancelled', ref_no: row.ref_no });
  res.json({ request: rowOut((await q(`${SELECT} WHERE h.id = $1`, [id])).rows[0]) });
}));

// ---- تقييم الخدمة بالنجوم (مرة واحدة، من صاحب الطلب بعد الاعتماد) ----
r.post('/:id/rating', wrap(async (req, res) => {
  const row = await loadRequest(req, +req.params.id);
  if (row.requester_user_id !== req.user.id) throw httpError(403, 'التقييم لصاحب الطلب فقط');
  if (row.status !== 'approved') throw httpError(409, 'التقييم متاح بعد اعتماد الطلب');
  if (row.rated_at) throw httpError(409, 'سبق تقييم هذا الطلب');
  const star = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
  const service = star(req.body?.service), speed = star(req.body?.speed);
  if (!service || !speed) throw httpError(400, 'قيّم السؤالين بعدد النجوم من 1 إلى 5');
  const comment = str(req.body?.comment, 300) || null;
  const upd = (await q('UPDATE hr_requests SET rating_service = $2, rating_speed = $3, rating_comment = $4, rated_at = now(), updated_at = now() WHERE id = $1 AND rated_at IS NULL RETURNING id', [row.id, service, speed, comment])).rows[0];
  if (!upd) throw httpError(409, 'سبق تقييم هذا الطلب');
  await audit(req, 'update', 'hr_request', row.id, null, { ref_no: row.ref_no, rating_service: service, rating_speed: speed });
  res.json({ request: rowOut((await q(`${SELECT} WHERE h.id = $1`, [row.id])).rows[0]) });
}));

// ---- المستند المعتمد ----
const verifyCode = row => String(row.document_hash || '').slice(0, 10).toUpperCase();
r.get('/:id/document', wrap(async (req, res) => {
  const row = await loadRequest(req, +req.params.id);
  if (row.status !== 'approved' || !row.document_text) throw httpError(409, 'المستند غير متاح: الطلب لم يُعتمد');
  if (ratingGate(req, res, row)) return;
  const st = await stampState();
  res.json({ ref_no: row.ref_no, type_title: TYPES[row.type].title, text: row.document_text, issue_date: row.document_data?.issue_date, approved_by: row.decided_by, code: verifyCode(row), stamp: st.enabled, stamp_version: st.version, employee_name: row.employee_name });
}));

async function documentPage(row) { return renderDocumentHtml({ row, code: verifyCode(row), stamp: await stampState(), imgDir: IMG }); }
// صفحة المستند نفسها (تُعرض في إطار داخل صفحة المستند وتُستخدم لتوليد PDF)
r.get('/:id/view', wrap(async (req, res) => {
  const row = await loadRequest(req, +req.params.id);
  if (row.status !== 'approved' || !row.document_text) throw httpError(409, 'المستند غير متاح: الطلب لم يُعتمد');
  if (ratingGate(req, res, row)) return;
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.send(await documentPage(row));
}));
r.get('/:id/pdf', wrap(async (req, res) => {
  const row = await loadRequest(req, +req.params.id);
  if (row.status !== 'approved' || !row.document_text) throw httpError(409, 'المستند غير متاح: الطلب لم يُعتمد');
  if (ratingGate(req, res, row)) return;
  if (!chromeAvailable()) throw httpError(501, 'توليد PDF من الخادم غير متاح؛ استخدم «طباعة / حفظ PDF» من صفحة المستند');
  const { htmlToPdf } = require('../../modules/members/src/services/exporter');
  const buf = await htmlToPdf(await documentPage(row), { landscape: false });
  await audit(req, 'export', 'hr_request', row.id, null, { ref_no: row.ref_no, format: 'pdf' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${row.ref_no}.pdf"`, 'Cache-Control': 'no-store' });
  res.send(buf);
}));

export default r;
