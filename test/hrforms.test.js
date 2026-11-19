// نماذج الموارد البشرية: محرك القوالب، القوالب الجاهزة، الصلاحيات، سجل الصادر
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers.js';
import { renderTemplate, buildVars, defaultValues, suggestValue, missingRequired, textToHtml, plainText, FILTERS } from '../public/hr-forms/engine.js';

test('محرك القوالب: المتغيرات والمرشحات والشروط والقوائم والنقاط للفارغ', () => {
  const body = 'اسم: {{employee_name}}\n{{#if late}}\nتأخر: {{late|date_num}} ({{late|weekday}})\n{{else}}\nلا تأخر\n{{/if}}\n{{#each ds}}\n- {{this|date}}\n{{/each}}\nرقم: {{emp_no}}';
  const vars = buildVars({ employee: { full_name: 'علي', emp_no: '' }, values: { late: '2026-08-06', ds: ['2026-08-06', '2026-08-14'] }, issueDate: '2026-11-18' });
  const out = renderTemplate(body, { vars, fields: [] });
  assert.match(out, /اسم: علي/);
  assert.match(out, /تأخر: 06\/08\/2026 \(الخميس\)/);
  assert.match(out, /- الخميس، 06 أغسطس 2026م\n- الجمعة، 14 أغسطس 2026م/);
  assert.match(out, /رقم: \.{5,}/);                                    // الفارغ يظهر نقاطاً ليُكمل يدوياً
  assert.ok(!out.includes('لا تأخر'));
  assert.match(renderTemplate(body, { vars: buildVars({ employee: { full_name: 'x' }, values: { ds: [] } }), fields: [] }), /لا تأخر/);
  assert.equal(FILTERS.days_construct(['a']), 'يوم الغياب'); assert.equal(FILTERS.days_construct(['a', 'b']), 'يومي الغياب');
  assert.equal(FILTERS.days_construct(new Array(4).fill('x')), 'أيام الغياب (4 أيام)'); assert.equal(FILTERS.days_construct(new Array(12).fill('x')), 'أيام الغياب (12 يوماً)');
  assert.equal(FILTERS.month_ar('2026-09'), 'سبتمبر 2026م');
  // خاصية خيار القائمة
  const fields = [{ key: 'v', type: 'select', options: [{ value: 'أ', phrase: 'عبارة أ' }, { value: 'ب', phrase: 'عبارة ب' }] }];
  assert.equal(renderTemplate('{{v}}: {{v.phrase}}', { vars: { v: 'ب' }, fields }), 'ب: عبارة ب');
  assert.throws(() => renderTemplate('{{#if x}}بلا إغلاق', { vars: {} }));
  assert.equal(suggestValue({ suggest: 'next_month_of:d' }, { d: ['2026-08-06', '2026-12-14'] }), '2027-01');
  assert.deepEqual(missingRequired([{ key: 'a', label: 'أ', required: true }, { key: 'l', label: 'ل', type: 'dates', required: true }], { a: '', l: [''] }), ['أ', 'ل']);
  assert.deepEqual(defaultValues([{ key: 'l', type: 'dates' }, { key: 's', default: 'x' }]), { l: [], s: 'x' });
  assert.equal(textToHtml('# عنوان <b>\nنص & "ا"\n'), '<h2>عنوان &lt;b&gt;</h2><p>نص &amp; &quot;ا&quot;</p><div class="gap"></div>');   // لا يمر HTML
  assert.equal(plainText('# عنوان\nنص'), 'عنوان\nنص');
});

const t = await bootApp('hrforms');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let admin, hr, plain, empId;

test('إعداد: مستخدم موارد بشرية وموظف عادي وموظف متابعة', { skip }, async () => {
  await t.mkUser('root', ['admin']); await t.mkUser('hr1', ['hr']); await t.mkUser('emp1', ['employee']);
  admin = await t.as('root'); hr = await t.as('hr1'); plain = await t.as('emp1');
  const r = await admin.post('/api/tracking/staff', { full_name: 'عبدالله الاختبار', emp_no: 'H100', job_title: 'محاسب', org_unit_id: t.root });
  assert.equal(r.status, 201); empId = r.json.row.employee_id;
});

test('القوالب الثلاثة جاهزة وتُملأ كما في النماذج الأصلية', { skip }, async () => {
  const { templates, can_manage } = (await hr.get('/api/hr-forms/templates')).json;
  assert.deepEqual(templates.map(x => x.slug), ['absence-inquiry', 'attention-notice', 'deduction-notice', 'salary-fixation']);
  assert.equal(can_manage, true);
  const ded = templates.find(x => x.slug === 'deduction-notice');
  const emp = { full_name: 'عبدالله الاختبار', emp_no: 'H100' };
  const out = renderTemplate(ded.body, { vars: buildVars({ employee: emp, values: { absent_dates: ['2026-08-06', '2026-08-14'], deduction_month: '2026-09', penalty: 'يوم واحد' }, issueDate: '2026-11-18' }), fields: ded.fields });
  assert.match(out, /المكرم الأستاذ: عبدالله الاختبار/);
  assert.match(out, /الخميس، 06 أغسطس 2026م\.\nالجمعة، 14 أغسطس 2026م\./);
  assert.match(out, /سيتم حسم أجر يومي الغياب من راتب شهر سبتمبر 2026م، بالإضافة إلى حسم أجر يوم واحد كجزاء، وفقًا للأنظمة واللوائح المعتمدة\./);
  const noPen = renderTemplate(ded.body, { vars: buildVars({ employee: emp, values: { absent_dates: ['2026-08-06'], deduction_month: '2026-09', penalty: '' } }), fields: ded.fields });
  assert.match(noPen, /حسم أجر يوم الغياب من راتب شهر سبتمبر 2026م، وفقًا/);
  const att = templates.find(x => x.slug === 'attention-notice');
  const a = renderTemplate(att.body, { vars: buildVars({ employee: emp, values: { violation: 'عدم وجود بصمة', violation_date: '22/11/2026', period: 'في عدد من الأيام خلال شهري أكتوبر ونوفمبر 2026م' } }), fields: att.fields });
  assert.match(a, /إشارةً إلى ما لوحظ من عدم تسجيلكم بصمة الحضور والانصراف في عدد من الأيام خلال شهري أكتوبر ونوفمبر 2026م، نلفت عنايتكم إلى أن تسجيل البصمة عند الحضور والانصراف التزام وظيفي/);
  const inq = templates.find(x => x.slug === 'absence-inquiry');
  const q = renderTemplate(inq.body, { vars: buildVars({ employee: { ...emp, department: 'تنمية الموارد المالية' }, values: { manager: 'عبدالله الشريف', absent_dates: ['2026-06-16'], late_date: '2026-07-20', late_duration: '00:45', deadline: 'يوم' } }), fields: inq.fields });
  assert.match(q, /الإدارة: تنمية الموارد المالية/); assert.match(q, /☑ لقد تغيبت عن الدوام الرسمي في يوم: \(الثلاثاء، 16 يونيو 2026م\)/);
  assert.match(q, /لقد تأخرت عن الدوام في يوم \(الاثنين\) الموافق: \(20\/07\/2026\) المدة: \(00:45\)/); assert.ok(!q.includes('لقد خرجت قبل'));
  assert.match(q, /اسم الرئيس المباشر: عبدالله الشريف/);
});

test('الصلاحيات: الموظف العادي ممنوع، والموارد البشرية تصدر وتدير', { skip }, async () => {
  assert.equal((await plain.get('/api/hr-forms/templates')).status, 403);
  assert.equal((await plain.get('/hr-forms/')).status, 403);
  assert.equal((await hr.get('/hr-forms/')).status, 200);
  assert.equal((await hr.get('/api/hr-forms/employees?q=عبدالله')).json.employees[0].emp_no, 'H100');
  assert.equal((await hr.get('/api/hr-forms/employees?q=غير-موجود-أبداً')).json.employees.length, 0);
});

test('سجل الصادر: تسجيل، ملخص الموظف، بحث، تدقيق', { skip }, async () => {
  const tpl = (await hr.get('/api/hr-forms/templates')).json.templates.find(x => x.slug === 'attention-notice');
  const body = { template_id: tpl.id, employee_id: empId, employee_name: 'عبدالله الاختبار', emp_no: 'H100', department: 'إدارة', values: { violation: 'عدم وجود بصمة' }, body_text: 'نص النموذج', action: 'copy' };
  assert.equal((await hr.post('/api/hr-forms/log', body)).status, 201);
  assert.equal((await hr.post('/api/hr-forms/log', { ...body, action: 'print' })).status, 201);
  assert.equal((await hr.post('/api/hr-forms/log', { ...body, action: 'save' })).status, 201);
  assert.equal((await hr.post('/api/hr-forms/log', { ...body, body_text: '  ' })).status, 400);
  assert.equal((await hr.post('/api/hr-forms/log', { ...body, template_id: 99999 })).status, 400);
  assert.equal((await plain.post('/api/hr-forms/log', body)).status, 403);
  const sum = (await hr.get(`/api/hr-forms/employee/${empId}/summary`)).json.summary;
  assert.equal(sum[0].n, 2);                                   // الحفظ فقط لا يُحسب إصداراً
  const log = (await hr.get('/api/hr-forms/log?q=H100')).json.log;
  assert.equal(log.length, 3); assert.equal(log[0].issued_by, 'hr1');
  const one = (await hr.get(`/api/hr-forms/log/${log[0].id}`)).json; assert.equal(one.body_text, 'نص النموذج');
  assert.ok((await t.q("SELECT count(*)::int AS n FROM audit_logs WHERE entity = 'hr_form' AND action = 'issue' AND platform = 'hr-forms'")).rows[0].n >= 3);
});

test('إدارة القوالب: إضافة وتعديل وإيقاف مع تحقق صارم', { skip }, async () => {
  const good = { title: 'إنذار مخصص', category: 'إنذارات', body: 'المكرم {{employee_name}}\n{{#if reason}}السبب: {{reason}}{{/if}}', fields: [{ key: 'reason', label: 'السبب', type: 'text', required: true }] };
  const c = await hr.post('/api/hr-forms/templates', good); assert.equal(c.status, 201);
  assert.equal((await hr.post('/api/hr-forms/templates', { ...good, fields: [{ key: 'employee_name', label: 'x', type: 'text' }] })).status, 400);   // اسم محجوز
  assert.equal((await hr.post('/api/hr-forms/templates', { ...good, fields: [{ key: 'Bad Key', label: 'x' }] })).status, 400);
  assert.equal((await hr.post('/api/hr-forms/templates', { ...good, fields: [{ key: 'a', label: 'x' }, { key: 'a', label: 'y' }] })).status, 400);
  assert.equal((await hr.post('/api/hr-forms/templates', { ...good, body: '   ' })).status, 400);
  assert.equal((await plain.post('/api/hr-forms/templates', good)).status, 403);
  const up = await hr.put(`/api/hr-forms/templates/${c.json.id}`, { title: 'إنذار معدّل' }); assert.equal(up.status, 200); assert.equal(up.json.title, 'إنذار معدّل'); assert.equal(up.json.version, 2);
  assert.equal((await hr.put(`/api/hr-forms/templates/${c.json.id}`, { active: false })).json.active, false);
  assert.ok(!(await hr.get('/api/hr-forms/templates')).json.templates.find(x => x.id === c.json.id));          // الموقوف لا يظهر للإصدار
  assert.ok((await hr.get('/api/hr-forms/templates?all=1')).json.templates.find(x => x.id === c.json.id));     // ويظهر لمن يدير
});

test('الختم: رفع صورة صالحة، رفض غير الصور، منع غير المصرّح، وإعادة الافتراضي', { skip }, async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = (buf, name) => { const f = new FormData(); f.append('file', new Blob([buf]), name); return f; };
  assert.equal((await plain.post('/api/hr-forms/stamp', fd(png, 's.png'))).status, 403);
  assert.equal((await hr.post('/api/hr-forms/stamp', fd(Buffer.from('<svg onload=alert(1)>'), 's.svg'))).status, 400);
  const ok = await hr.post('/api/hr-forms/stamp', fd(png, 's.png'));
  assert.equal(ok.status, 200); assert.equal(ok.json.stamp.custom, true);
  const got = await hr.get('/api/hr-forms/stamp'); assert.equal(got.status, 200);
  assert.equal((await hr.put('/api/hr-forms/stamp/enabled', { enabled: false })).json.stamp.enabled, false);
  assert.equal((await hr.get('/api/hr-forms/templates')).json.stamp.enabled, false);
  await hr.put('/api/hr-forms/stamp/enabled', { enabled: true });
  assert.equal((await hr.del('/api/hr-forms/stamp')).json.stamp.custom, false);
});
