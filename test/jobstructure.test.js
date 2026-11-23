// الهيكل الوظيفي المستقل عن الموظفين: وظائف بمقاعد، إسكان الموظف فيها، اشتقاق المسمى والوحدة، والقيود
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';

const t = await bootApp('jobstruct');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let hr, fin, unitA, unitB, p1, p2, e1;

test('إعداد', { skip }, async () => {
  await t.mkUser('js_hr', ['hr']); await t.mkUser('js_fin', ['finance']);
  hr = await t.as('js_hr'); fin = await t.as('js_fin');
  unitA = (await t.q("INSERT INTO org_units(unit_type, name, parent_id) VALUES ('department','إدارة المالية',$1) RETURNING id", [t.root])).rows[0].id;
  unitB = (await t.q("INSERT INTO org_units(unit_type, name, parent_id) VALUES ('department','إدارة التقنية',$1) RETURNING id", [t.root])).rows[0].id;
  assert.equal((await hr.get('/api/hr-employees/meta')).json.can.structure, true);
  assert.equal((await fin.get('/api/hr-employees/meta')).json.can.structure, false);
});

test('الوظائف: إنشاء وتحقق وصلاحية الإدارة للموارد البشرية فقط', { skip }, async () => {
  assert.equal((await fin.post('/api/hr-employees/positions', { title: 'محاسب', org_unit_id: unitA })).status, 403);
  assert.equal((await hr.post('/api/hr-employees/positions', { title: 'م', org_unit_id: unitA })).status, 400);
  assert.equal((await hr.post('/api/hr-employees/positions', { title: 'محاسب', org_unit_id: 999999 })).status, 400);
  assert.equal((await hr.post('/api/hr-employees/positions', { title: 'محاسب', org_unit_id: unitA, headcount: 0 })).status, 400);
  let r = await hr.post('/api/hr-employees/positions', { title: 'مدير الإدارة المالية', code: 'FIN-01', org_unit_id: unitA, grade: 'الدرجة 12', headcount: 1 });
  assert.equal(r.status, 201); p1 = r.json.position; assert.equal(p1.vacant, 1); assert.equal(p1.occupied, 0); assert.match(p1.unit_path, /إدارة المالية/);
  { const a = await hr.post('/api/hr-employees/positions', { title: 'سكرتير', org_unit_id: unitA }); const b2 = await hr.post('/api/hr-employees/positions', { title: 'سكرتيرة تنفيذية', org_unit_id: unitA }); assert.equal(a.json.position.code, 'H-Sec-0001'); assert.equal(b2.json.position.code, 'H-Sec-0002'); await hr.del('/api/hr-employees/positions/' + a.json.position.id); await hr.del('/api/hr-employees/positions/' + b2.json.position.id); }   // رمز تلقائي متسلسل
  assert.equal((await hr.post('/api/hr-employees/positions', { title: 'تكرار', code: 'FIN-01', org_unit_id: unitA })).status, 409);   // رمز فريد
  r = await hr.post('/api/hr-employees/positions', { title: 'محاسب', code: 'FIN-02', org_unit_id: unitA, headcount: 2, parent_id: p1.id });
  assert.equal(r.status, 201); p2 = r.json.position; assert.equal(p2.parent_id, p1.id); assert.equal(p2.parent_title, 'مدير الإدارة المالية');
  const list = (await fin.get('/api/hr-employees/positions')).json;                                           // المالية ترى الهيكل (قراءة)
  assert.equal(list.positions.length, 2); assert.deepEqual(list.totals, { positions: 2, seats: 3, occupied: 0, vacant: 3 });
  assert.equal((await hr.get('/api/hr-employees/positions?vacant=1')).json.positions.length, 2);
});

test('منع الحلقات في التسلسل الإداري', { skip }, async () => {
  assert.equal((await hr.put(`/api/hr-employees/positions/${p1.id}`, { parent_id: p1.id })).status, 400);       // لا يرفع لنفسه
  assert.equal((await hr.put(`/api/hr-employees/positions/${p1.id}`, { parent_id: p2.id })).status, 400);       // حلقة (p2 يرفع إلى p1)
});

test('إنشاء الموظف وإسكانه: المسمى والوحدة من الوظيفة، والمقاعد محدودة', { skip }, async () => {
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'بلا وظيفة', job_title: 'حر' })).status, 400);   // موظف جديد يلزمه اختيار وظيفة من الهيكل
  let r = await hr.post('/api/hr-employees', { full_name: 'خالد المسكَّن', emp_no: 'JS1', position_id: p1.id, job_title: 'تجاهل هذا', org_unit_id: unitB });
  assert.equal(r.status, 201); e1 = r.json.row;
  assert.equal(e1.job_title, 'مدير الإدارة المالية'); assert.equal(e1.org_unit_id, unitA); assert.equal(e1.position_id, p1.id); assert.equal(e1.position_code, 'FIN-01');   // اشتُق من الوظيفة
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'موظف ثان', position_id: p1.id })).status, 409);       // امتلأ المقعد الوحيد
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'موظف ثان', position_id: 999999 })).status, 400);
  const pl = (await hr.get('/api/hr-employees/positions')).json.positions.find(x => x.id === p1.id);
  assert.equal(pl.occupied, 1); assert.equal(pl.vacant, 0); assert.equal(pl.occupants[0].full_name, 'خالد المسكَّن');
  r = await hr.post('/api/hr-employees', { full_name: 'سارة', emp_no: 'JS2', position_id: p2.id }); assert.equal(r.status, 201);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'نورة', emp_no: 'JS3', position_id: p2.id })).status, 201);
  assert.equal((await hr.post('/api/hr-employees', { full_name: 'رابع', position_id: p2.id })).status, 409);              // مقعدان فقط
  assert.equal((await hr.get('/api/hr-employees?position=none')).json.totals.no_position, 0);
  const meta = (await hr.get('/api/hr-employees/meta')).json.positions.find(x => x.id === p2.id); assert.equal(meta.vacant, 0);
});

test('تعديل الوظيفة ينتقل لشاغليها، والقيود على المقاعد والإيقاف والحذف', { skip }, async () => {
  let r = await hr.put(`/api/hr-employees/positions/${p1.id}`, { title: 'رئيس الإدارة المالية', org_unit_id: unitB, version: p1.version });
  assert.equal(r.status, 200);
  const emp = (await hr.get('/api/hr-employees?q=المسكَّن')).json.rows[0];
  assert.equal(emp.job_title, 'رئيس الإدارة المالية'); assert.equal(emp.org_unit_id, unitB);                       // انتقل المسمى والوحدة مع الوظيفة
  assert.equal((await hr.put(`/api/hr-employees/positions/${p1.id}`, { title: 'قديم', version: 1 })).status, 409);   // نسخة قديمة
  assert.equal((await hr.put(`/api/hr-employees/positions/${p2.id}`, { headcount: 1 })).status, 409);               // أقل من الشاغلين
  assert.equal((await hr.put(`/api/hr-employees/positions/${p2.id}`, { active: false })).status, 409);
  assert.equal((await hr.del(`/api/hr-employees/positions/${p2.id}`)).status, 409);                                  // يشغلها موظفان
  // نقل موظف من وظيفة لأخرى يحرر مقعده
  assert.equal((await hr.put(`/api/hr-employees/${emp.id}`, { position_id: '' })).json.row.position_id, null);
  assert.equal((await hr.get('/api/hr-employees/positions')).json.positions.find(x => x.id === p1.id).vacant, 1);
  assert.equal((await hr.put(`/api/hr-employees/${emp.id}`, { position_id: p1.id, version: 99 })).status, 409);
  // أرشفة الموظف تفرّغ المقعد
  const sara = (await hr.get('/api/hr-employees?q=سارة')).json.rows[0];
  await hr.post(`/api/hr-employees/${sara.id}/archive`);
  assert.equal((await hr.get('/api/hr-employees/positions')).json.positions.find(x => x.id === p2.id).occupied, 1);
  assert.equal((await hr.del(`/api/hr-employees/positions/${p1.id}`)).status, 200);                                  // فارغة فتُحذف
});

test('توليد الهيكل من الموظفين الحاليين', { skip }, async () => {
  await t.q("INSERT INTO leave_staff(emp_no, full_name, job_title, org_unit_id) VALUES ('S1','أ','مهندس شبكات',$1),('S2','ب','مهندس شبكات',$1),('S3','ج','فني',$1)", [unitB]);
  assert.equal((await fin.post('/api/hr-employees/positions/seed-from-employees', {})).status, 403);
  const r = await hr.post('/api/hr-employees/positions/seed-from-employees', {});
  assert.equal(r.status, 200); assert.ok(r.json.created >= 2 && r.json.linked >= 3);
  const net = (await hr.get('/api/hr-employees/positions?q=مهندس شبكات')).json.positions[0];
  assert.equal(net.headcount, 2); assert.equal(net.occupied, 2);
  assert.equal((await hr.post('/api/hr-employees/positions/seed-from-employees', {})).json.created, 0);          // لا تكرار
});

test('رموز الوظائف: اختصار المسمى وتوليد H-Sec-0001', async () => {
  const { abbrOf } = await import('../server/lib/poscode.js');
  assert.equal(abbrOf('سكرتير تنفيذي'), 'Sec'); assert.equal(abbrOf('مدير الإدارة المالية'), 'Mgr'); assert.equal(abbrOf('محاسبة'), 'Acc'); assert.match(abbrOf('طبيب'), /^[A-Z][a-z]+$/);
});
