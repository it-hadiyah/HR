// طلبات السلف: الموظف يرفع الطلب ويحدد كفيلاً ← الكفيل يعتمد ويضع بياناته ← الموارد البشرية تعتمد وتصدر النموذج.
// خصوصية مقصودة: الموظف والكفيل لا يريان إلا حالة الطلب. بيانات الكفيل والملاحظات والنموذج لمراجعي الموارد البشرية فقط (review).
// لذلك مساراتها منفصلة تماماً عن مسارات الخطابات: لا يوجد مسار يعيد بيانات السلفة الكاملة لغير المراجع.
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
import { myStaff, userForStaff, HAS_ACCOUNT_SQL } from '../lib/hrIdentity.js';
import { loanText, renderLoanHtml } from '../lib/hrLoan.js';
import { signatureDataUrl } from './myProfile.js';
import { staffRows } from './payroll.js';
import { unitPaths } from './tracking.js';

const r = Router();
const require = createRequire(import.meta.url);
const IMG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/hr-requests/img');
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isReviewer = u => hasGrant(u, 'hr-requests', 'review');
const round2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = v => Number(String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[,٬،\s]/g, ''));
const digits = v => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s-]/g, '');
const dmy = d => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '—');
const dateOnly = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
r.param('id', (req, res, next, v) => (/^\d+$/.test(v) ? next() : next('route')));

const SELECT = `SELECT l.*, e.full_name AS employee_name, e.emp_no, e.job_title AS employee_job, g.full_name AS guarantor_name, g.emp_no AS guarantor_emp_no, g.job_title AS guarantor_job
  FROM hr_loans l JOIN leave_staff e ON e.id = l.employee_id JOIN leave_staff g ON g.id = l.guarantor_staff_id`;
const outcome = x => (x.status === 'rejected' ? (x.rejected_by === 'guarantor' ? 'rejected_by_guarantor' : 'rejected_by_hr') : x.status);

// ---- ما يراه كل طرف ----
/** صاحب الطلب: الحالة فقط (بلا بيانات الكفيل ولا ملاحظات ولا نموذج) */
const ownerOut = x => ({ id: x.id, ref_no: x.ref_no, amount: Number(x.amount), months: x.months, reason: x.reason, created_at: x.created_at, guarantor_name: x.guarantor_name, outcome: outcome(x),
  steps: { guarantor: x.status === 'pending_guarantor' || x.status === 'cancelled' ? 'pending' : (x.status === 'rejected' && x.rejected_by === 'guarantor' ? 'rejected' : 'approved'),
    hr: x.status === 'pending_guarantor' || x.status === 'cancelled' ? 'waiting' : x.status === 'pending_hr' ? 'pending' : x.status === 'approved' ? 'approved' : (x.rejected_by === 'hr' ? 'rejected' : 'waiting') },
  can_cancel: x.status === 'pending_guarantor' || x.status === 'pending_hr' });
/** الكفيل: بيانات الطلب اللازمة لقراره + قراره وبياناته هو + الحالة العامة (بلا بيانات الموارد البشرية) */
const guarantorOut = x => ({ id: x.id, ref_no: x.ref_no, requester_name: x.employee_name, requester_emp_no: x.emp_no, requester_job: x.employee_job, amount: Number(x.amount), months: x.months, installment: round2(x.amount / x.months), reason: x.reason, created_at: x.created_at,
  my_decision: x.status === 'pending_guarantor' ? 'pending' : x.status === 'cancelled' && !x.guarantor_decided_at ? 'cancelled' : (x.rejected_by === 'guarantor' ? 'rejected' : 'approved'),
  overall: x.status === 'pending_guarantor' ? 'pending_guarantor' : x.status === 'cancelled' ? 'cancelled' : x.status === 'rejected' && x.rejected_by === 'guarantor' ? 'rejected_by_guarantor' : x.status === 'pending_hr' ? 'pending_hr' : x.status === 'approved' ? 'approved' : 'rejected_by_hr',
  my_data: withoutSig(x.guarantor_data) });
/** المراجع: كل شيء */
const reviewerOut = x => ({ id: x.id, ref_no: x.ref_no, employee_id: x.employee_id, employee_name: x.employee_name, emp_no: x.emp_no, employee_job: x.employee_job, amount: Number(x.amount), months: x.months, reason: x.reason, created_at: x.created_at,
  guarantor_name: x.guarantor_name, guarantor_emp_no: x.guarantor_emp_no, guarantor_job: x.guarantor_job, status: x.status, outcome: outcome(x), rejected_by: x.rejected_by, guarantor_decided_at: x.guarantor_decided_at, guarantor_note: x.guarantor_note, guarantor_data: withoutSig(x.guarantor_data),
  hr_decided_by: x.hr_decided_by, hr_decided_at: x.hr_decided_at, hr_note: x.hr_note, approved_amount: x.approved_amount === null ? null : Number(x.approved_amount), approved_months: x.approved_months, has_document: !!x.document_text });

// التوقيع شرط لرفع الطلب واعتماد الكفالة: تُؤخذ لقطة من توقيع المستخدم المحفوظ في «ملفي الشخصي»
const noSignature = res => res.status(400).json({ error: 'أضف توقيعك أولاً من «ملفي الشخصي» لتتمكن من التوقيع على الطلب', code: 'signature_required' });
const withoutSig = gd => (gd ? { ...gd, signature: undefined, has_signature: !!gd.signature } : null);   // لا تُرسَل صور التواقيع في القوائم
const requireReviewer = (req, res, next) => (isReviewer(req.user) ? next() : next(httpError(403, 'هذا الإجراء للموارد البشرية فقط')));

// ---- بحث الكفلاء: موظفون نشطون لهم حساب على المنصة (غير صاحب الطلب) ----
r.get('/guarantors', wrap(async (req, res) => {
  const me = await myStaff(req.user);
  const term = str(req.query.q, 60); const p = [me?.id ?? 0]; let w = '';
  if (term) { p.push(`%${term}%`); w = `AND (s.full_name ILIKE $2 OR s.emp_no ILIKE $2)`; }
  const rows = (await q(`SELECT s.id, s.full_name, s.emp_no, s.job_title FROM leave_staff s WHERE s.status = 'active' AND s.id <> $1 AND ${HAS_ACCOUNT_SQL} ${w} ORDER BY s.full_name LIMIT 30`, p)).rows;
  res.json({ guarantors: rows });
}));

// ---- رفع الطلب ----
r.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const me = await myStaff(req.user);
  if (!me) throw httpError(400, 'حسابك غير مرتبط بسجل موظف؛ تواصل مع الموارد البشرية');
  const amount = round2(num(b.amount)), months = Math.trunc(num(b.months));
  if (!(amount > 0 && amount <= 1_000_000)) throw httpError(400, 'مبلغ السلفة غير صالح');
  if (!(months >= 1 && months <= 60)) throw httpError(400, 'عدد الأقساط بين 1 و60 شهراً');
  const gid = +b.guarantor_staff_id;
  if (!Number.isInteger(gid) || gid <= 0) throw httpError(400, 'اختر الكفيل');
  if (gid === me.id) throw httpError(400, 'لا يمكنك كفالة نفسك');
  const g = (await q("SELECT id FROM leave_staff WHERE id = $1 AND status = 'active'", [gid])).rows[0];
  if (!g) throw httpError(400, 'الكفيل غير موجود');
  const gu = await userForStaff(gid);
  if (!gu) throw httpError(400, 'الكفيل المختار ليس له حساب على المنصة فلا يمكنه اعتماد الطلب؛ اختر كفيلاً آخر');
  if ((await q("SELECT 1 FROM hr_loans WHERE requester_user_id = $1 AND status IN ('pending_guarantor','pending_hr')", [req.user.id])).rows.length) throw httpError(409, 'لديك طلب سلفة قيد المعالجة');
  const mySig = await signatureDataUrl(req.user.id);
  if (!mySig) return noSignature(res);
  const seq = (await q("SELECT nextval('hr_loans_ref_seq')::int AS n")).rows[0].n;
  const ref = `LN-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
  const row = (await q(`INSERT INTO hr_loans(ref_no, employee_id, requester_user_id, amount, months, reason, guarantor_staff_id, guarantor_user_id, requester_signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ref, me.id, req.user.id, amount, months, str(b.reason, 300) || null, gid, gu.id, mySig])).rows[0];
  await audit(req, 'create', 'hr_loan', row.id, null, { ref_no: ref, amount, months, guarantor_staff_id: gid });
  res.status(201).json({ loan: ownerOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));

r.get('/mine', wrap(async (req, res) => {
  const rows = (await q(`${SELECT} WHERE l.requester_user_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 100`, [req.user.id])).rows;
  res.json({ loans: rows.map(ownerOut) });
}));

r.post('/:id/cancel', wrap(async (req, res) => {
  const row = (await q(`${SELECT} WHERE l.id = $1 AND l.requester_user_id = $2`, [+req.params.id, req.user.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  if (!['pending_guarantor', 'pending_hr'].includes(row.status)) throw httpError(409, 'لا يمكن إلغاء طلب تمت معالجته');
  await q("UPDATE hr_loans SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('pending_guarantor','pending_hr')", [row.id]);
  await audit(req, 'update', 'hr_loan', row.id, { status: row.status }, { status: 'cancelled', ref_no: row.ref_no });
  res.json({ loan: ownerOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));

// ---- الكفيل ----
r.get('/guarantee', wrap(async (req, res) => {
  const rows = (await q(`${SELECT} WHERE l.guarantor_user_id = $1 ORDER BY (l.status = 'pending_guarantor') DESC, l.created_at DESC LIMIT 100`, [req.user.id])).rows;
  res.json({ loans: rows.map(guarantorOut) });
}));
async function guarantorLoan(req, id) {
  const row = (await q(`${SELECT} WHERE l.id = $1 AND l.guarantor_user_id = $2`, [id, req.user.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  return row;
}
r.get('/guarantee/:id', wrap(async (req, res) => {
  const row = await guarantorLoan(req, +req.params.id);
  const s = (await q('SELECT hire_date, national_id, phone FROM leave_staff WHERE id = $1', [row.guarantor_staff_id])).rows[0];
  res.json({ loan: guarantorOut(row), prefill: { hire_date: dateOnly(s?.hire_date), national_id: s?.national_id || '', phone: s?.phone || '' } });
}));
r.post('/guarantee/:id/approve', wrap(async (req, res) => {
  const row = await guarantorLoan(req, +req.params.id);
  if (row.status !== 'pending_guarantor') throw httpError(409, 'الطلب لم يعد بانتظار اعتمادك');
  const b = req.body || {};
  if (b.acknowledge !== true) throw httpError(400, 'يلزم الإقرار بالكفالة');
  const national_id = digits(b.national_id); if (!/^\d{10}$/.test(national_id)) throw httpError(400, 'رقم الهوية 10 أرقام');
  const hire_date = str(b.hire_date, 10); if (!isDate(hire_date)) throw httpError(400, 'تاريخ بداية العمل غير صالح');
  const phone = digits(b.phone); if (!/^\+?\d{7,15}$/.test(phone)) throw httpError(400, 'رقم الجوال غير صالح');
  const salary = round2(num(b.salary)); if (!(salary > 0 && salary <= 10_000_000)) throw httpError(400, 'الراتب الشهري غير صالح');
  const sig = await signatureDataUrl(req.user.id);
  if (!sig) return noSignature(res);
  const data = { national_id, hire_date, phone, salary, signature: sig };
  const upd = (await q("UPDATE hr_loans SET status = 'pending_hr', guarantor_decided_at = now(), guarantor_data = $2, guarantor_note = $3, updated_at = now() WHERE id = $1 AND status = 'pending_guarantor' RETURNING id", [row.id, JSON.stringify(data), str(b.note, 300) || null])).rows[0];
  if (!upd) throw httpError(409, 'الطلب لم يعد بانتظار اعتمادك');
  await audit(req, 'approve', 'hr_loan', row.id, { status: 'pending_guarantor' }, { status: 'pending_hr', ref_no: row.ref_no, stage: 'guarantor' });
  res.json({ loan: guarantorOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));
r.post('/guarantee/:id/reject', wrap(async (req, res) => {
  const row = await guarantorLoan(req, +req.params.id);
  if (row.status !== 'pending_guarantor') throw httpError(409, 'الطلب لم يعد بانتظار اعتمادك');
  const upd = (await q("UPDATE hr_loans SET status = 'rejected', rejected_by = 'guarantor', guarantor_decided_at = now(), guarantor_note = $2, updated_at = now() WHERE id = $1 AND status = 'pending_guarantor' RETURNING id", [row.id, str(req.body?.note, 300) || null])).rows[0];
  if (!upd) throw httpError(409, 'الطلب لم يعد بانتظار اعتمادك');
  await audit(req, 'reject', 'hr_loan', row.id, { status: 'pending_guarantor' }, { status: 'rejected', ref_no: row.ref_no, stage: 'guarantor' });
  res.json({ loan: guarantorOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));

// ---- الموارد البشرية (المراجعون فقط) ----
r.get('/review', requireReviewer, wrap(async (req, res) => {
  const p = []; const where = [];
  if (['pending_guarantor', 'pending_hr', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) { p.push(req.query.status); where.push(`l.status = $${p.length}`); }
  const term = str(req.query.q, 60);
  if (term) { p.push(`%${term}%`); where.push(`(e.full_name ILIKE $${p.length} OR e.emp_no ILIKE $${p.length} OR g.full_name ILIKE $${p.length} OR l.ref_no ILIKE $${p.length})`); }
  const rows = (await q(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (l.status = 'pending_hr') DESC, l.created_at DESC LIMIT 300`, p)).rows;
  res.json({ loans: rows.map(reviewerOut) });
}));

async function reviewContext(row) {
  const [emp] = await staffRows({ status: 'all', ids: [row.employee_id] });
  const es = (await q('SELECT * FROM leave_staff WHERE id = $1', [row.employee_id])).rows[0];
  const gs = (await q('SELECT * FROM leave_staff WHERE id = $1', [row.guarantor_staff_id])).rows[0];
  const pathOf = await unitPaths();
  const eu = pathOf(es.org_unit_id), gu = pathOf(gs.org_unit_id);
  return { es, gs, emp, eu, gu };
}
r.get('/review/:id', requireReviewer, wrap(async (req, res) => {
  const row = (await q(`${SELECT} WHERE l.id = $1`, [+req.params.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  const { es, emp, eu } = await reviewContext(row);
  res.json({ loan: reviewerOut(row), employee: { name: es.full_name, emp_no: es.emp_no, job_title: es.job_title, department: eu.department, section: eu.section, hire_date: dateOnly(es.hire_date), basic: emp?.basic ?? 0, gross: emp?.gross ?? 0 },
    defaults: { amount: Number(row.amount), months: row.months, gratuity_employee: 0, gratuity_guarantor: 0, previous_balance: 0 } });
}));

function buildDocument(row, ctx, b, reviewer, hrSignature) {
  const amount = round2(num(b.amount ?? row.amount)), months = Math.trunc(num(b.months ?? row.months));
  if (!(amount > 0 && amount <= 1_000_000)) throw httpError(400, 'المبلغ المعتمد غير صالح');
  if (!(months >= 1 && months <= 60)) throw httpError(400, 'عدد الأقساط بين 1 و60 شهراً');
  const nn = (v, label) => { const x = v === undefined || v === '' ? 0 : round2(num(v)); if (!(x >= 0 && x <= 100_000_000)) throw httpError(400, `قيمة غير صالحة: ${label}`); return x; };
  const gratuity_employee = nn(b.gratuity_employee, 'إجمالي مكافأة الموظف'), gratuity_guarantor = nn(b.gratuity_guarantor, 'إجمالي مكافأة الضامن'), previous_balance = nn(b.previous_balance, 'رصيد السلف السابقة');
  const first = str(b.first_installment, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(first)) throw httpError(400, 'حدد شهر بداية أول قسط');
  const g = row.guarantor_data, now = new Date();
  const issue = dmy(now);
  const d = {
    ref_no: row.ref_no, issue_date: issue,
    employee: { signature: row.requester_signature || null, name: ctx.es.full_name, emp_no: ctx.es.emp_no, job_title: ctx.es.job_title, department: ctx.eu.department, section: ctx.eu.section, hire_date: dateOnly(ctx.es.hire_date), basic: ctx.emp?.basic ?? 0, gross: ctx.emp?.gross ?? 0 },
    guarantor: { signature: g.signature || null, name: ctx.gs.full_name, emp_no: ctx.gs.emp_no, job_title: ctx.gs.job_title, department: ctx.gu.department, section: ctx.gu.section, hire_date: g.hire_date, national_id: g.national_id, phone: g.phone, salary: g.salary },
    loan: { requested_amount: Number(row.amount), amount, months, installment: round2(amount / months), reason: row.reason },
    hr: { gratuity_employee, gratuity_guarantor, previous_balance, first_installment: first, covers_employee: gratuity_employee >= amount, covers_both: gratuity_employee + gratuity_guarantor >= amount, note: str(b.note, 300), name: reviewer.full_name, signature: hrSignature || null },
    timeline: { requested: dmy(row.created_at), guarantor: dmy(row.guarantor_decided_at), hr: issue, hr_by: reviewer.full_name },
  };
  return { d, amount, months };
}

r.post('/review/:id/approve', requireReviewer, wrap(async (req, res) => {
  const row = (await q(`${SELECT} WHERE l.id = $1`, [+req.params.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  if (row.status !== 'pending_hr') throw httpError(409, 'الطلب ليس بانتظار قرار الموارد البشرية');
  const ctx = await reviewContext(row);
  const { d, amount, months } = buildDocument(row, ctx, req.body || {}, req.user, await signatureDataUrl(req.user.id));
  const text = loanText(d);
  const hash = crypto.createHash('sha256').update(`${row.ref_no}\n${text}`).digest('hex');
  const upd = (await q(`UPDATE hr_loans SET status = 'approved', hr_decided_by = $2, hr_decided_at = now(), hr_note = $3, approved_amount = $4, approved_months = $5, document_text = $6, document_data = $7, document_hash = $8, updated_at = now()
    WHERE id = $1 AND status = 'pending_hr' RETURNING id`, [row.id, req.user.username, d.hr.note || null, amount, months, text, JSON.stringify(d), hash])).rows[0];
  if (!upd) throw httpError(409, 'تم البت في الطلب من مراجع آخر');
  await audit(req, 'approve', 'hr_loan', row.id, { status: 'pending_hr' }, { status: 'approved', ref_no: row.ref_no, amount, months, stage: 'hr' });
  res.json({ loan: reviewerOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));
r.post('/review/:id/reject', requireReviewer, wrap(async (req, res) => {
  const row = (await q(`${SELECT} WHERE l.id = $1`, [+req.params.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  if (row.status !== 'pending_hr') throw httpError(409, 'الطلب ليس بانتظار قرار الموارد البشرية');
  const note = str(req.body?.note, 300); if (note.length < 3) throw httpError(400, 'اكتب سبب الرفض');
  const upd = (await q("UPDATE hr_loans SET status = 'rejected', rejected_by = 'hr', hr_decided_by = $2, hr_decided_at = now(), hr_note = $3, updated_at = now() WHERE id = $1 AND status = 'pending_hr' RETURNING id", [row.id, req.user.username, note])).rows[0];
  if (!upd) throw httpError(409, 'تم البت في الطلب من مراجع آخر');
  await audit(req, 'reject', 'hr_loan', row.id, { status: 'pending_hr' }, { status: 'rejected', ref_no: row.ref_no, stage: 'hr' });
  res.json({ loan: reviewerOut((await q(`${SELECT} WHERE l.id = $1`, [row.id])).rows[0]) });
}));

// ---- النموذج المعتمد: للموارد البشرية فقط ----
async function approvedDoc(req) {
  const row = (await q(`${SELECT} WHERE l.id = $1`, [+req.params.id])).rows[0];
  if (!row) throw httpError(404, 'الطلب غير موجود');
  if (row.status !== 'approved' || !row.document_data) throw httpError(409, 'النموذج غير متاح: الطلب لم يُعتمد من الموارد البشرية');
  return row;
}
const code = row => String(row.document_hash || '').slice(0, 10).toUpperCase();
const page = row => renderLoanHtml({ row, d: row.document_data, code: code(row), imgDir: IMG });
r.get('/review/:id/document', requireReviewer, wrap(async (req, res) => {
  const row = await approvedDoc(req);
  res.json({ ref_no: row.ref_no, text: row.document_text, code: code(row) });
}));
r.get('/review/:id/view', requireReviewer, wrap(async (req, res) => {
  const row = await approvedDoc(req);
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(page(row));
}));
r.get('/review/:id/pdf', requireReviewer, wrap(async (req, res) => {
  const row = await approvedDoc(req);
  let chrome = false; try { chrome = !!require('../../modules/members/src/config').chromePath; } catch { /* لا Chromium */ }
  if (!chrome) throw httpError(501, 'توليد PDF من الخادم غير متاح؛ استخدم «طباعة / حفظ PDF» من صفحة النموذج');
  const { htmlToPdf } = require('../../modules/members/src/services/exporter');
  const buf = await htmlToPdf(page(row), { landscape: false });
  await audit(req, 'export', 'hr_loan', row.id, null, { ref_no: row.ref_no, format: 'pdf' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${row.ref_no}.pdf"`, 'Cache-Control': 'no-store' }).send(buf);
}));

export default r;
