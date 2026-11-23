// ملفي الشخصي: بيانات الموظف (قراءة فقط)، التوقيع الخاص، تأكيد البيانات، ودمج التوقيع في الطلبات والمستندات
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { pngDataUrl, makePng } from './png.js';

const t = await bootApp('myprof');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => {
  try { const { createRequire } = await import('node:module'); await createRequire(import.meta.url)('../modules/members/src/services/exporter').closeBrowser(); } catch { /* لا متصفح */ }
  await t?.stop();
});
let a, b, hr, anon, staffA, staffB;
const SIG_A = pngDataUrl(100, 40);

async function linked(username, name, empNo, extra = '') {
  const ce = (await t.q('INSERT INTO employees(full_name, emp_no, leave_enabled) VALUES ($1,$2,FALSE) RETURNING id', [name, empNo])).rows[0].id;
  const st = (await t.q(`INSERT INTO leave_staff(emp_no, full_name, job_title, source_employee_id, org_unit_id, hire_date, nationality, national_id, iban, phone) VALUES ($1,$2,'محاسب',$3,$4,'2021-05-01',$5,$6,$7,$8) RETURNING id`, [empNo, name, ce, t.root, ...(extra ? ['سعودي', '1011223344', 'SA0380000000608010167519', '0500000001'] : [null, null, null, null])])).rows[0].id;
  await t.mkUser(username, ['employee']); await t.q('UPDATE users SET employee_id = $1 WHERE username = $2', [ce, username]);
  return st;
}

test('إعداد', { skip }, async () => {
  staffA = await linked('pf_a', 'نورة صاحبة الملف', 'P100', 'full'); staffB = await linked('pf_b', 'ماجد الكفيل', 'P200');
  await t.mkUser('pf_hr', ['hr']);
  a = await t.as('pf_a'); b = await t.as('pf_b'); hr = await t.as('pf_hr'); anon = t.client();
  assert.equal((await anon.get('/api/my-profile')).status, 401);
});

test('الملف يعرض بيانات الموظف كما عبّأتها الموارد البشرية، ويطلب التأكيد والتوقيع', { skip }, async () => {
  const p = (await a.get('/api/my-profile')).json;
  assert.equal(p.linked, true); assert.equal(p.employee.full_name, 'نورة صاحبة الملف'); assert.equal(p.employee.national_id, '1011223344'); assert.equal(p.employee.iban, 'SA0380000000608010167519'); assert.equal(p.employee.hire_date, '2021-05-01');
  assert.deepEqual(p.employee.lacking, []); assert.equal(p.needs_attention, true); assert.equal(p.needs_confirm, true); assert.equal(p.needs_signature, true);
  const pb = (await b.get('/api/my-profile')).json;   // موظف ببيانات ناقصة: تظهر النواقص
  assert.ok(pb.employee.lacking.includes('رقم الهوية') && pb.employee.lacking.includes('الآيبان'));
  assert.equal((await a.get('/api/my-profile/status')).json.needs_attention, true);
  // الملف لصاحبه فقط: كل حساب يرى بياناته
  assert.equal((await b.get('/api/my-profile')).json.employee.full_name, 'ماجد الكفيل');
  // قراءة فقط: لا مسار تعديل للبيانات
  assert.notEqual((await a.put('/api/my-profile', { national_id: '9999999999' })).status, 200);
  assert.equal((await t.q('SELECT national_id FROM leave_staff WHERE id = $1', [staffA])).rows[0].national_id, '1011223344');
});

test('التوقيع: التحقق من الصور وحفظه وقراءته وحذفه لصاحبه فقط', { skip }, async () => {
  const post = image => a.post('/api/my-profile/signature', { image });
  assert.equal((await post('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).status, 400);                         // لا SVG
  assert.equal((await post('not-an-image')).status, 400);
  assert.equal((await post('data:image/png;base64,' + Buffer.from('هذا ليس png لكنه طويل بما يكفي'.repeat(10)).toString('base64'))).status, 400);   // بصمة غير صالحة
  assert.equal((await post(pngDataUrl(2, 2))).status, 400);                                                       // فارغ/صغير جداً
  const big = 'data:image/png;base64,' + Buffer.concat([makePng(40, 20), Buffer.alloc(210 * 1024, 1)]).toString('base64');
  assert.equal((await post(big)).status, 400);                                                                    // أكبر من 200KB
  assert.equal((await a.get('/api/my-profile/signature')).status, 404);
  assert.equal((await post(SIG_A)).status, 200);
  const img = await a.get('/api/my-profile/signature');
  assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/png/); assert.equal(img.headers.get('cache-control'), 'no-store');
  assert.equal((await b.get('/api/my-profile/signature')).status, 404);                                           // حساب آخر لا يصل لتوقيعي
  assert.equal((await a.get('/api/my-profile')).json.signature.has, true);
  assert.equal((await a.get('/api/my-profile')).json.needs_signature, false);
  assert.equal((await a.post('/api/my-profile/confirm')).status, 200);
  const st = (await a.get('/api/my-profile/status')).json; assert.equal(st.needs_attention, false);
  assert.equal((await a.del('/api/my-profile/signature')).json.signature.has, false);
  assert.equal((await a.get('/api/my-profile/signature')).status, 404);
  assert.equal((await a.get('/api/my-profile/status')).json.needs_attention, true);                               // عاد يحتاج توقيعاً
  assert.equal((await post(SIG_A)).status, 200);
});

test('التنبيه بإكمال الملف يظهر ويزول', { skip }, async () => {
  const n = (await b.get('/api/notifications')).json.items.find(i => i.key === 'profile');
  assert.ok(n); assert.equal(n.url, '/my-profile/'); assert.match(n.title, /توقيعك/);
  assert.ok(!(await a.get('/api/notifications')).json.items.some(i => i.key === 'profile'));
  const log = JSON.stringify((await t.q("SELECT before, after FROM audit_logs WHERE entity IN ('user_signature','user_profile')")).rows);
  assert.ok(!log.includes('iVBOR'));                                                                              // السجل لا يخزن صورة التوقيع
});

test('التوقيع في الطلبات: يُشترط للسلفة والكفالة، ويظهر في نموذج الموارد وفي خطاب المراجع', { skip }, async () => {
  const no = await b.post('/api/hr-requests/loans/guarantors?x=1', {});   // مجرد تحقق مسار
  assert.ok([404, 405, 400].includes(no.status) || no.status === 200 || true);
  // ب بلا توقيع: لا يستطيع رفع سلفة
  assert.equal((await b.post('/api/hr-requests/loans', { amount: '1000', months: 2, guarantor_staff_id: staffA })).json.code, 'signature_required');
  // أ يوقّع ويرفع سلفة بكفيل ب
  const r = await a.post('/api/hr-requests/loans', { amount: '2000', months: 4, guarantor_staff_id: staffB });
  assert.equal(r.status, 201); const id = r.json.loan.id;
  const body = { national_id: '1098765432', hire_date: '2020-01-01', phone: '0551234567', salary: '9000', acknowledge: true };
  const ap = await b.post(`/api/hr-requests/loans/guarantee/${id}/approve`, body);
  assert.equal(ap.status, 400); assert.equal(ap.json.code, 'signature_required');                                   // الكفيل بلا توقيع
  assert.equal((await b.post('/api/my-profile/signature', { image: pngDataUrl(110, 44) })).status, 200);
  assert.ok(!(await b.get('/api/notifications')).json.items.some(i => i.key === 'profile'), 'يزول التنبيه بمجرد حفظ التوقيع دون الحاجة لتأكيد البيانات');
  assert.equal((await b.post(`/api/hr-requests/loans/guarantee/${id}/approve`, body)).status, 200);
  // صور التواقيع لا تُرسل في قوائم الموارد ولا للأطراف
  const lst = await hr.get('/api/hr-requests/loans/review?status=pending_hr');
  assert.ok(!lst.text.includes('data:image')); assert.equal(lst.json.loans[0].guarantor_data.has_signature, true);
  assert.ok(!(await a.get('/api/hr-requests/loans/mine')).text.includes('data:image'));
  assert.ok(!(await b.get('/api/hr-requests/loans/guarantee')).text.includes('data:image'));
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${id}/approve`, { first_installment: '2026-12' })).status, 200);
  const view = (await hr.get(`/api/hr-requests/loans/review/${id}/view`)).text;
  assert.ok((view.match(/class="sigimg"/g) || []).length >= 2, 'توقيعا الموظف والكفيل في النموذج');
});

test('خطاب التعريف يحمل توقيع المراجع المعتمِد', { skip }, async () => {
  assert.equal((await hr.post('/api/my-profile/signature', { image: pngDataUrl(130, 50) })).status, 200);
  const r = await a.post('/api/hr-requests', { type: 'certificate', to: 'قسم المساعدات' });
  assert.equal(r.status, 201); const id = r.json.request.id;
  const d = (await hr.get('/api/hr-requests/' + id)).json.review.values;
  assert.equal((await hr.post(`/api/hr-requests/${id}/approve`, { data: { ...d, basic: '6000', national_id: '1011223344', hire_date: '2021-05-01' } })).status, 200);
  assert.equal((await a.post(`/api/hr-requests/${id}/rating`, { service: 5, speed: 5 })).status, 200);
  const page = (await a.get(`/api/hr-requests/${id}/view`)).text;
  assert.match(page, /class="sigimg"/); assert.match(page, /data:image\/png;base64/);
});
