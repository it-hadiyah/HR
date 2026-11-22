// طلبات الموظفين: رفع الطلب، مراجعة الموارد البشرية، الاعتماد/الرفض، المستند المختوم، والعزل بين الموظفين
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';

const t = await bootApp('hrreq');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => {
  try { const { createRequire } = await import('node:module'); await createRequire(import.meta.url)('../modules/members/src/services/exporter').closeBrowser(); } catch { /* لا متصفح */ }
  await t?.stop();
});
let hr, e1, e2, anon, staff1, staff2, reqCert, reqFix;

async function linkedEmployee(username, name, empNo) {
  const ce = (await t.q("INSERT INTO employees(full_name, emp_no, leave_enabled) VALUES ($1,$2,FALSE) RETURNING id", [name, empNo])).rows[0].id;
  const st = (await t.q("INSERT INTO leave_staff(emp_no, full_name, job_title, source_employee_id, org_unit_id) VALUES ($1,$2,'محاسب',$3,$4) RETURNING id", [empNo, name, ce, t.root])).rows[0].id;
  await t.mkUser(username, ['employee']);
  await t.q('UPDATE users SET employee_id = $1 WHERE username = $2', [ce, username]);
  return st;
}

test('إعداد: موظفان مرتبطان بحسابين وموظف موارد بشرية', { skip }, async () => {
  staff1 = await linkedEmployee('emp_a', 'عبدالله الأول', 'R100');
  staff2 = await linkedEmployee('emp_b', 'سارة الثانية', 'R200');
  await t.mkUser('hr_r', ['hr']);
  hr = await t.as('hr_r'); e1 = await t.as('emp_a'); e2 = await t.as('emp_b'); anon = t.client();
  await t.q('INSERT INTO payroll_salaries(employee_id, basic) VALUES ($1, 6000)', [staff1]);
  assert.equal((await anon.get('/api/hr-requests/meta')).status, 401);
  const m = (await e1.get('/api/hr-requests/meta')).json;
  assert.equal(m.me.id, staff1); assert.equal(m.can.review, false);
  assert.equal((await hr.get('/api/hr-requests/meta')).json.can.review, true);
});

test('الموظف يرفع الطلبات ويُمنع التكرار والتحقق من الحقول', { skip }, async () => {
  assert.equal((await e1.post('/api/hr-requests', { type: 'nope' })).status, 400);
  assert.equal((await e1.post('/api/hr-requests', { type: 'fixation', bank: '', iban: '' })).status, 400);
  assert.equal((await e1.post('/api/hr-requests', { type: 'fixation', bank: 'بنك الإنماء', iban: 'SA12' })).status, 400);
  let r = await e1.post('/api/hr-requests', { type: 'certificate', to: 'قسم المساعدات', notes: 'للتقديم' });
  assert.equal(r.status, 201); reqCert = r.json.request; assert.match(reqCert.ref_no, /^HR-\d{4}-\d{4}$/); assert.equal(reqCert.status, 'pending');
  assert.equal((await e1.post('/api/hr-requests', { type: 'certificate' })).status, 409);   // طلب مماثل قيد المراجعة
  r = await e1.post('/api/hr-requests', { type: 'fixation', bank: 'بنك الإنماء', iban: 'sa03 8000 0000 6080 1016 7519' });
  assert.equal(r.status, 201); reqFix = r.json.request; assert.equal(reqFix.params.iban, 'SA0380000000608010167519');
  assert.equal((await e1.get('/api/hr-requests/mine')).json.requests.length, 2);
  assert.equal((await e2.get('/api/hr-requests/mine')).json.requests.length, 0);
});

test('العزل: الموظف لا يرى طلب غيره ولا يراجع الطلبات', { skip }, async () => {
  assert.equal((await e2.get('/api/hr-requests/' + reqCert.id)).status, 404);
  assert.equal((await e2.get('/api/hr-requests')).status, 403);
  assert.equal((await e1.post(`/api/hr-requests/${reqCert.id}/approve`, { data: {} })).status, 403);
  assert.equal((await e1.post(`/api/hr-requests/${reqCert.id}/reject`, { note: 'محاولة' })).status, 403);
  assert.equal((await e2.post(`/api/hr-requests/${reqCert.id}/cancel`)).status, 404);
  assert.equal((await e1.get(`/api/hr-requests/${reqCert.id}/document`)).status, 409);   // لم يُعتمد بعد
});

test('المراجعة: اقتراحات من الرواتب والسجل ثم اعتماد يصدر مستنداً مختوماً', { skip }, async () => {
  const inbox = (await hr.get('/api/hr-requests?status=pending')).json.requests;
  assert.equal(inbox.length, 2);
  const d = (await hr.get('/api/hr-requests/' + reqCert.id)).json;
  assert.equal(d.review.values.basic, '6000'); assert.equal(d.review.values.to, 'قسم المساعدات');
  // بيانات ناقصة تُرفض
  assert.equal((await hr.post(`/api/hr-requests/${reqCert.id}/approve`, { data: { ...d.review.values, national_id: '', hire_date: '' } })).status, 400);
  const bad = await hr.post(`/api/hr-requests/${reqCert.id}/approve`, { data: { ...d.review.values, hire_date: '2020-01-15', national_id: '123' } });
  assert.equal(bad.status, 400);
  const pv = await hr.post(`/api/hr-requests/${reqCert.id}/preview`, { data: { ...d.review.values, hire_date: '2020-01-15', national_id: '1023456789', net: '5000' } });
  assert.match(pv.json.text, /الاسم: عبدالله الأول/);
  const ok = await hr.post(`/api/hr-requests/${reqCert.id}/approve`, { data: { ...d.review.values, hire_date: '2020-01-15', national_id: '1023456789', net: '5415.00' }, note: 'تم' });
  assert.equal(ok.status, 200); assert.equal(ok.json.request.status, 'approved');
  assert.equal((await hr.post(`/api/hr-requests/${reqCert.id}/approve`, { data: d.review.values })).status, 409);   // لا اعتماد مزدوج
  // المستند يصل للموظف صاحب الطلب فقط
  const doc = await e1.get(`/api/hr-requests/${reqCert.id}/document`);
  assert.equal(doc.status, 200); assert.equal(doc.json.ref_no, reqCert.ref_no); assert.equal(doc.json.stamp, true); assert.match(doc.json.code, /^[0-9A-F]{10}$/);
  assert.match(doc.json.text, /الاسم: عبدالله الأول/); assert.match(doc.json.text, /الأساسي: 6,000\.00 ريال/); assert.match(doc.json.text, /رقم الهوية: 1023456789/);
  assert.match(doc.json.text, /الإجمالي كتابةً: ثمانية آلاف ومائة ريال فقط لا غير\./);
  assert.equal((await e2.get(`/api/hr-requests/${reqCert.id}/document`)).status, 404);
  assert.equal((await e1.get('/api/hr-requests/stamp')).status, 200);
  // بيانات الموظف الناقصة تُكمَّل من المعتمد (التعيين والجنسية)، والهوية بصلاحية sensitive (للموارد البشرية افتراضياً)
  const s = (await t.q('SELECT hire_date, nationality, national_id FROM leave_staff WHERE id = $1', [staff1])).rows[0];
  assert.equal(new Date(s.hire_date).toISOString().slice(0, 10), '2020-01-15'); assert.equal(s.nationality, 'سعودي');
  // السجل لا يخزن رقم الهوية
  const log = await t.q("SELECT before, after FROM audit_logs WHERE entity = 'hr_request' ORDER BY id DESC LIMIT 5");
  assert.ok(!JSON.stringify(log.rows).includes('1023456789'));
});

test('الرفض يتطلب سبباً ويظهر للموظف، والإلغاء للطلبات قيد المراجعة فقط', { skip }, async () => {
  assert.equal((await hr.post(`/api/hr-requests/${reqFix.id}/reject`, { note: '' })).status, 400);
  assert.equal((await hr.post(`/api/hr-requests/${reqFix.id}/reject`, { note: 'الآيبان لا يخصك' })).json.request.status, 'rejected');
  const mine = (await e1.get('/api/hr-requests/mine')).json.requests.find(x => x.id === reqFix.id);
  assert.equal(mine.status, 'rejected'); assert.equal(mine.decision_note, 'الآيبان لا يخصك');
  assert.equal((await e1.post(`/api/hr-requests/${reqFix.id}/cancel`)).status, 409);
  const r = await e1.post('/api/hr-requests', { type: 'fixation', bank: 'بنك الراجحي', iban: 'SA0380000000608010167519' });
  assert.equal(r.status, 201);
  assert.equal((await e1.post(`/api/hr-requests/${r.json.request.id}/cancel`)).json.request.status, 'cancelled');
});

test('الصفحات تُخدم، وPDF الخادم يعمل أو يُرجع 501 بوضوح', { skip }, async () => {
  assert.equal((await e1.get('/hr-requests/')).status, 200);
  assert.equal((await e1.get('/hr-requests/doc.html')).status, 200);
  assert.equal((await e1.get('/hr-requests/img/letterhead.png')).status, 200);
  assert.equal((await anon.get('/hr-requests/')).status !== 200, true);
  const pdf = await e1.get(`/api/hr-requests/${reqCert.id}/pdf`);
  assert.ok([200, 501].includes(pdf.status), 'pdf status ' + pdf.status);
  if (pdf.status === 200) assert.match(pdf.headers.get('content-type'), /pdf/);
});
