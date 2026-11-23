// لوحة تحكم البوابة: تصدير الموظفين إلى Excel واستيراد ملف معدَّل (قراءة وتحقق، والتطبيق يتم في اللوحة قبل الحفظ)
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { bootApp } from './helpers.js';

const t = await bootApp('portaladm');
const skip = !t && 'لا توجد قاعدة PostgreSQL للاختبار';
test.after(async () => { await t?.stop(); });
let admin, emp, xlsx;
const H = { 'X-Requested-With': 'hadiyah-admin' };

test('إعداد', { skip }, async () => {
  await t.mkUser('pa_root', ['admin']); await t.mkUser('pa_emp', ['employee']);
  admin = await t.as('pa_root'); emp = await t.as('pa_emp');
});

test('تصدير الموظفين إلى Excel: أوراق الموظفين والوحدات والتعليمات وقوائم الاختيار', { skip }, async () => {
  const body = { rows: [{ extension: 101, name: 'سعد الاختبار', job: 'محاسب', email: 's@example.com', unit: 'المالية › الحسابات', role: 'عضو' }, { extension: 102, name: 'منى', job: 'مديرة', email: 'm@example.com', unit: 'المالية', role: 'رئيس' }], units: ['المالية', 'المالية › الحسابات'] };
  // نحتاج الجسم ثنائياً: نسجّل الدخول مباشرة ونقرأ arrayBuffer
  const login = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pa_root', password: t.PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${t.base}/api/portal-admin?action=export-xlsx`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H, Cookie: cookie }, body: JSON.stringify(body) });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  xlsx = Buffer.from(await r.arrayBuffer());
  await wb.xlsx.load(xlsx);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['الموظفون', 'الوحدات', 'تعليمات']);
  const ws = wb.getWorksheet('الموظفون');
  assert.equal(ws.getRow(1).getCell(1).value, 'التحويلة'); assert.equal(ws.getRow(2).getCell(2).value, 'سعد الاختبار'); assert.equal(ws.getRow(3).getCell(6).value, 'رئيس');
  assert.equal(wb.getWorksheet('الوحدات').rowCount, 3);
  assert.equal(ws.getCell('F2').dataValidation.type, 'list');
  assert.equal((await emp.post('/api/portal-admin?action=export-xlsx', body, H)).status, 403);   // الموظف العادي ممنوع
  assert.equal((await admin.post('/api/portal-admin?action=export-xlsx', { nope: 1 }, H)).status, 400);
});

test('قراءة ملف معدَّل: تُرجع الصفوف والأعمدة الموجودة ويُرفض غير المطابق', { skip }, async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('الموظفون');
  ws.addRow(['التحويلة', 'الاسم', 'المسمى الوظيفي', 'البريد الإلكتروني', 'الوحدة التنظيمية']);
  ws.addRow([201, 'علي', 'مهندس', { text: 'ali@example.com', hyperlink: 'mailto:ali@example.com' }, 'المالية']); ws.addRow([202, 'نوف', 'مصممة', 'n@example.com', '']);
  ws.addRow([]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const fd = () => { const f = new FormData(); f.append('file', new Blob([buf]), 'e.xlsx'); return f; };
  const ok = await admin.post('/api/portal-admin?action=parse-xlsx', fd(), H);
  assert.equal(ok.status, 200); assert.equal(ok.json.rows.length, 2); assert.equal(ok.json.rows[0].email, 'ali@example.com'); assert.equal(ok.json.rows[0].unit, 'المالية');
  assert.deepEqual(ok.json.columns.sort(), ['email', 'extension', 'job', 'name', 'unit']);   // بلا عمود الدور → يُبقى كما هو عند التطبيق
  assert.equal((await emp.post('/api/portal-admin?action=parse-xlsx', fd(), H)).status, 403);
  const bad = new ExcelJS.Workbook(); bad.addWorksheet('x').addRow(['اسم', 'قيمة']);
  const f2 = new FormData(); f2.append('file', new Blob([Buffer.from(await bad.xlsx.writeBuffer())]), 'b.xlsx');
  assert.equal((await admin.post('/api/portal-admin?action=parse-xlsx', f2, H)).status, 400);
  assert.equal((await admin.post('/api/portal-admin?action=parse-xlsx', new FormData(), H)).status, 400);
});
