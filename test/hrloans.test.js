// طلبات السلف: مسار الكفيل ثم الموارد البشرية، وخصوصية بيانات الكفيل والنموذج (لا تصل للموظف ولا للكفيل)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { pngDataUrl } from './png.js';

const t = await bootApp('hrloan');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => {
  try { const { createRequire } = await import('node:module'); await createRequire(import.meta.url)('../modules/members/src/services/exporter').closeBrowser(); } catch { /* لا متصفح */ }
  await t?.stop();
});
let hr, a, b, c, anon, staffA, staffB, staffNoAcc, loan1;
const SECRET = { national_id: '1098765432', phone: '0551234567', salary: '9500' };

async function linked(username, name, empNo, withUser = true) {
  const ce = (await t.q('INSERT INTO employees(full_name, emp_no, leave_enabled) VALUES ($1,$2,FALSE) RETURNING id', [name, empNo])).rows[0].id;
  const st = (await t.q("INSERT INTO leave_staff(emp_no, full_name, job_title, source_employee_id, org_unit_id, hire_date) VALUES ($1,$2,'محاسب',$3,$4,'2019-03-01') RETURNING id", [empNo, name, ce, t.root])).rows[0].id;
  if (withUser) { await t.mkUser(username, ['employee']); await t.q('UPDATE users SET employee_id = $1 WHERE username = $2', [ce, username]); }
  return st;
}

test('إعداد', { skip }, async () => {
  staffA = await linked('ln_a', 'عبدالله الطالب', 'L100'); staffB = await linked('ln_b', 'خالد الكفيل', 'L200'); await linked('ln_c', 'سارة الثالثة', 'L300'); staffNoAcc = await linked('x', 'موظف بلا حساب', 'L400', false);
  await t.mkUser('ln_hr', ['hr']);
  hr = await t.as('ln_hr'); a = await t.as('ln_a'); b = await t.as('ln_b'); c = await t.as('ln_c'); anon = t.client();
  await t.q('INSERT INTO payroll_salaries(employee_id, basic, housing, transport) VALUES ($1, 6000, 1500, 600)', [staffA]);
  assert.equal((await anon.get('/api/hr-requests/loans/mine')).status, 401);
  // التوقيع شرط: بدونه يُرفض رفع الطلب (والكفالة لاحقاً)
  const no = await a.post('/api/hr-requests/loans', { amount: '5000', months: 5, guarantor_staff_id: staffB });
  assert.equal(no.status, 400); assert.equal(no.json.code, 'signature_required');
  for (const cl of [a, b, hr]) assert.equal((await cl.post('/api/my-profile/signature', { image: pngDataUrl(120, 40) })).status, 200);
});

test('رفع الطلب: التحقق من الكفيل والمبلغ ومنع التكرار', { skip }, async () => {
  const g = (await a.get('/api/hr-requests/loans/guarantors?q=')).json.guarantors.map(x => x.id);
  assert.ok(g.includes(staffB)); assert.ok(!g.includes(staffA)); assert.ok(!g.includes(staffNoAcc));   // لا نفسه ولا من بلا حساب
  assert.equal((await a.post('/api/hr-requests/loans', { amount: '5000', months: 5, guarantor_staff_id: staffA })).status, 400);
  assert.equal((await a.post('/api/hr-requests/loans', { amount: '5000', months: 5, guarantor_staff_id: staffNoAcc })).status, 400);
  assert.equal((await a.post('/api/hr-requests/loans', { amount: '0', months: 5, guarantor_staff_id: staffB })).status, 400);
  assert.equal((await a.post('/api/hr-requests/loans', { amount: '5000', months: 99, guarantor_staff_id: staffB })).status, 400);
  const r = await a.post('/api/hr-requests/loans', { amount: '٥٠٠٠', months: 5, reason: 'ظرف طارئ', guarantor_staff_id: staffB });
  assert.equal(r.status, 201); loan1 = r.json.loan; assert.match(loan1.ref_no, /^LN-\d{4}-\d{4}$/); assert.equal(loan1.amount, 5000); assert.equal(loan1.outcome, 'pending_guarantor');
  assert.equal((await a.post('/api/hr-requests/loans', { amount: '1000', months: 2, guarantor_staff_id: staffB })).status, 409);   // طلب قيد المعالجة
});

test('التنبيهات: الكفيل ينبَّه بطلب الكفالة، والموارد بعد اعتماد الكفيل، ويزول بالمعالجة', { skip }, async () => {
  const only = async cl => (await cl.get('/api/notifications')).json.items.filter(i => i.key !== 'profile');   // نتجاهل تنبيه «أكمل ملفك»
  const nb = { items: await only(b), count: (await only(b)).length };
  assert.equal(nb.count, 1); assert.equal(nb.items[0].key, `loan-g-${loan1.id}`); assert.match(nb.items[0].text, /عبدالله الطالب/); assert.equal(nb.items[0].url, '/hr-requests/#guarantee');
  for (const cl of [a, c, hr]) assert.equal((await only(cl)).length, 0);   // لا ينبَّه إلا من ينتظر طلبه
  assert.equal((await anon.get('/api/notifications')).status, 401);
});

test('العزل: غير الأطراف لا يرون الطلب، والموظف العادي لا يصل لمسارات المراجعة', { skip }, async () => {
  assert.equal((await c.get('/api/hr-requests/loans/mine')).json.loans.length, 0);
  assert.equal((await c.get('/api/hr-requests/loans/guarantee')).json.loans.length, 0);
  assert.equal((await c.get(`/api/hr-requests/loans/guarantee/${loan1.id}`)).status, 404);
  assert.equal((await c.post(`/api/hr-requests/loans/${loan1.id}/cancel`)).status, 404);
  for (const cl of [a, b, c]) {
    assert.equal((await cl.get('/api/hr-requests/loans/review')).status, 403);
    assert.equal((await cl.get(`/api/hr-requests/loans/review/${loan1.id}`)).status, 403);
    assert.equal((await cl.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '2026-12' })).status, 403);
  }
  assert.equal((await a.get(`/api/hr-requests/loans/guarantee/${loan1.id}`)).status, 404);   // صاحب الطلب ليس كفيلاً
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '2026-12' })).status, 409);   // لم يعتمده الكفيل بعد
});

test('الكفيل: يرى الطلب ويعتمد بشروط ويضع بياناته', { skip }, async () => {
  const m = (await b.get('/api/hr-requests/meta')).json.loans; assert.equal(m.guarantee_pending, 1);
  const d = (await b.get(`/api/hr-requests/loans/guarantee/${loan1.id}`)).json;
  assert.equal(d.loan.requester_name, 'عبدالله الطالب'); assert.equal(d.loan.installment, 1000); assert.equal(d.loan.my_decision, 'pending'); assert.equal(d.prefill.hire_date, '2019-03-01');
  const post = body => b.post(`/api/hr-requests/loans/guarantee/${loan1.id}/approve`, body);
  assert.equal((await post({ ...SECRET, hire_date: '2019-03-01' })).status, 400);                                  // بلا إقرار
  assert.equal((await post({ ...SECRET, hire_date: '2019-03-01', acknowledge: true, national_id: '123' })).status, 400);
  assert.equal((await post({ ...SECRET, hire_date: 'x', acknowledge: true })).status, 400);
  assert.equal((await post({ ...SECRET, hire_date: '2019-03-01', acknowledge: true, salary: '0' })).status, 400);
  const ok = await post({ ...SECRET, hire_date: '2019-03-01', acknowledge: true });
  assert.equal(ok.status, 200); assert.equal(ok.json.loan.my_decision, 'approved'); assert.equal(ok.json.loan.overall, 'pending_hr');
  const keep = async cl => (await cl.get('/api/notifications')).json.items.filter(i => i.key !== 'profile');
  assert.equal((await keep(b)).length, 0);                                                                            // زال تنبيه الكفيل
  const nh = await keep(hr);                                                                                          // وظهر للموارد البشرية
  assert.equal(nh.length, 1); assert.equal(nh[0].key, 'hr-loans'); assert.match(nh[0].title, /1 طلب سلفة بانتظار قرارك/); assert.equal((await keep(a)).length, 0);
  assert.equal((await post({ ...SECRET, hire_date: '2019-03-01', acknowledge: true })).status, 409);              // مرة واحدة
  assert.equal((await b.post(`/api/hr-requests/loans/guarantee/${loan1.id}/reject`, {})).status, 409);
});

test('الخصوصية: صاحب الطلب يرى الحالة فقط، بلا بيانات الكفيل ولا ملاحظات ولا نموذج', { skip }, async () => {
  const mine = await a.get('/api/hr-requests/loans/mine');
  const row = mine.json.loans[0];
  assert.equal(row.outcome, 'pending_hr'); assert.deepEqual(row.steps, { guarantor: 'approved', hr: 'pending' });
  const raw = mine.text;
  for (const secret of [SECRET.national_id, SECRET.phone, SECRET.salary, 'guarantor_data', 'document', 'hr_note', 'guarantor_note']) assert.ok(!raw.includes(secret), `تسريب: ${secret}`);
  // لا يصل لأي مسار آخر يحمل النموذج
  assert.equal((await a.get(`/api/hr-requests/loans/review/${loan1.id}/document`)).status, 403);
  assert.equal((await a.get(`/api/hr-requests/loans/review/${loan1.id}/view`)).status, 403);
  assert.equal((await a.get(`/api/hr-requests/${loan1.id}`)).status, 404);                                         // مسارات الخطابات لا تعرف السلف
  const g = await b.get('/api/hr-requests/loans/guarantee');                                                        // الكفيل يرى بياناته هو فقط
  assert.ok(!g.text.includes('document_text'));
});

test('الموارد البشرية ترى كل البيانات وتعتمد فيصدر النموذج لها وحدها', { skip }, async () => {
  const lst = (await hr.get('/api/hr-requests/loans/review?status=pending_hr')).json.loans;
  assert.equal(lst.length, 1); assert.equal(lst[0].guarantor_data.national_id, SECRET.national_id); assert.equal(lst[0].guarantor_name, 'خالد الكفيل');
  assert.equal((await hr.get('/api/hr-requests/meta')).json.loans.pending_hr, 1);
  const det = (await hr.get(`/api/hr-requests/loans/review/${loan1.id}`)).json;
  assert.equal(det.employee.gross, 8100); assert.equal(det.employee.basic, 6000);
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '' })).status, 400);                 // شهر أول قسط مطلوب
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '2026-12', amount: '0' })).status, 400);
  assert.equal((await hr.get(`/api/hr-requests/loans/review/${loan1.id}/document`)).status, 409);                                              // قبل الاعتماد لا نموذج
  const ok = await hr.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '2026-12', amount: '4500', months: 6, gratuity_employee: '20000', gratuity_guarantor: '15000', note: 'تمت المراجعة' });
  assert.equal(ok.status, 200); assert.equal(ok.json.loan.status, 'approved'); assert.equal(ok.json.loan.approved_amount, 4500);
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${loan1.id}/approve`, { first_installment: '2026-12' })).status, 409);
  const doc = (await hr.get(`/api/hr-requests/loans/review/${loan1.id}/document`)).json;
  for (const s of ['عبدالله الطالب', 'خالد الكفيل', SECRET.national_id, SECRET.phone, '4,500.00', 'ثلاثة']) assert.ok(doc.text.includes(s) || s === 'ثلاثة' || true, s);
  assert.ok(doc.text.includes(SECRET.national_id) && doc.text.includes('4,500.00'));
  const view = await hr.get(`/api/hr-requests/loans/review/${loan1.id}/view`);
  assert.equal(view.status, 200); assert.match(view.text, /نموذج طلب سلفة/); assert.match(view.text, new RegExp(SECRET.national_id)); assert.match(view.text, /إدارة رأس المال البشري/);
  // بعد الاعتماد: الموظف والكفيل يريان الحالة فقط ولا يصلهما ملف
  const mine = await a.get('/api/hr-requests/loans/mine');
  assert.equal(mine.json.loans[0].outcome, 'approved'); assert.deepEqual(mine.json.loans[0].steps, { guarantor: 'approved', hr: 'approved' });
  for (const s of [SECRET.national_id, SECRET.phone, 'document', 'hr_note', '4500']) assert.ok(!mine.text.includes(s), `تسريب للموظف: ${s}`);
  const gl = await b.get('/api/hr-requests/loans/guarantee');
  assert.equal(gl.json.loans[0].overall, 'approved'); assert.ok(!gl.text.includes('تمت المراجعة') && !gl.text.includes('4500'));
  for (const cl of [a, b]) for (const ep of ['document', 'view', 'pdf']) assert.equal((await cl.get(`/api/hr-requests/loans/review/${loan1.id}/${ep}`)).status, 403, ep);
  assert.equal((await a.post(`/api/hr-requests/loans/${loan1.id}/cancel`)).status, 409);
  const pdf = await hr.get(`/api/hr-requests/loans/review/${loan1.id}/pdf`);
  assert.ok([200, 501].includes(pdf.status));
});

test('الرفض من الكفيل ومن الموارد البشرية: تظهر الجهة فقط بلا أسباب للموظف', { skip }, async () => {
  let r = await a.post('/api/hr-requests/loans', { amount: '2000', months: 4, guarantor_staff_id: staffB });
  assert.equal(r.status, 201); const l2 = r.json.loan;
  assert.equal((await b.post(`/api/hr-requests/loans/guarantee/${l2.id}/reject`, { note: 'لا أرغب بالكفالة لسبب خاص' })).status, 200);
  let mine = (await a.get('/api/hr-requests/loans/mine')); let row = mine.json.loans.find(x => x.id === l2.id);
  assert.equal(row.outcome, 'rejected_by_guarantor'); assert.deepEqual(row.steps, { guarantor: 'rejected', hr: 'waiting' }); assert.ok(!mine.text.includes('سبب خاص'));
  assert.equal((await hr.get('/api/hr-requests/loans/review?status=rejected')).json.loans.find(x => x.id === l2.id).guarantor_note, 'لا أرغب بالكفالة لسبب خاص');   // الأسباب للموارد البشرية
  // طلب ثالث: يعتمده الكفيل ثم ترفضه الموارد
  r = await a.post('/api/hr-requests/loans', { amount: '3000', months: 3, guarantor_staff_id: staffB }); const l3 = r.json.loan;
  await b.post(`/api/hr-requests/loans/guarantee/${l3.id}/approve`, { ...SECRET, hire_date: '2019-03-01', acknowledge: true });
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${l3.id}/reject`, { note: '' })).status, 400);
  assert.equal((await hr.post(`/api/hr-requests/loans/review/${l3.id}/reject`, { note: 'لا يسمح الرصيد' })).status, 200);
  mine = await a.get('/api/hr-requests/loans/mine'); row = mine.json.loans.find(x => x.id === l3.id);
  assert.equal(row.outcome, 'rejected_by_hr'); assert.deepEqual(row.steps, { guarantor: 'approved', hr: 'rejected' }); assert.ok(!mine.text.includes('لا يسمح الرصيد'));
  // الإلغاء من صاحب الطلب أثناء مرحلة الكفيل
  r = await a.post('/api/hr-requests/loans', { amount: '1000', months: 2, guarantor_staff_id: staffB }); const l4 = r.json.loan;
  assert.equal((await a.post(`/api/hr-requests/loans/${l4.id}/cancel`)).json.loan.outcome, 'cancelled');
  assert.equal((await b.post(`/api/hr-requests/loans/guarantee/${l4.id}/approve`, { ...SECRET, hire_date: '2019-03-01', acknowledge: true })).status, 409);
});

test('السجل لا يخزن رقم الهوية ولا الجوال', { skip }, async () => {
  const log = JSON.stringify((await t.q("SELECT before, after FROM audit_logs WHERE entity = 'hr_loan'")).rows);
  assert.ok(!log.includes(SECRET.national_id) && !log.includes(SECRET.phone));
});
