// اختبار واجهة نظام الأعضاء من طرف إلى طرف عبر المنصة الموحّدة (Playwright + Chromium).
// التشغيل: TEST_DATABASE_URL=postgres://.../xxx_test npm run test:e2e:members   (تُعاد بناء القاعدة)
// الصور تُحفظ في SHOTS_DIR إن حُدد. يتطلب حزمة playwright متاحة عالميًا (NODE_PATH).
import '../members-env.js';
import * as H from '../members-helpers.js';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
if (!process.env.TEST_DATABASE_URL) { console.log('اضبط TEST_DATABASE_URL (قاعدة تنتهي بـ _test)'); process.exit(2); }

const SHOTS = process.env.SHOTS_DIR;
const { days, today } = H;
const errors = [];

async function seed(admin) {
  const types = (await H.pool.query('SELECT id, code FROM membership_types')).rows;
  const t = (c) => types.find((x) => x.code === c).id;
  const names = ['عبدالله بن محمد الشهري', 'فاطمة سعد الزهراني', 'خالد إبراهيم الدوسري', 'نورة عبدالعزيز العتيبي', 'سلطان فهد القحطاني', 'ريم ناصر الغامدي', 'ماجد صالح الحربي', 'هند عبدالله المطيري', 'يوسف علي السبيعي', 'مها حمد الشمري', 'بدر سعود العنزي', 'لطيفة ماجد الخالدي'];
  const plan = [[-100, 260, -100, 'regular', '600'], [-340, 25, -340, 'regular', '600'], [-420, -20, -420, 'active', '1200'], [-30, 335, -30, 'regular', '600'], [-200, 165, 10, 'honorary', null], [-380, -15, -380, 'regular', '600'],
    [-10, 355, 20, 'active', '1200'], [-350, 15, -350, 'regular', '600'], [-60, 305, -60, 'regular', '600'], [-300, 65, -300, 'active', '1200'], [-5, 360, 25, 'regular', '600'], [-250, 115, -250, 'regular', '600']];
  let i = 0;
  for (const [s, e, due, type, amt] of plan) {
    const r = await admin.post('/api/members', { full_name: names[i], phone: `05${String(50000000 + i * 1111)}`, email: `m${i}@example.org`, membership_type_id: t(type), joined_at: days(s), start_date: days(s), end_date: days(e), due_date: days(due), amount_due: amt || undefined, is_exempt: type === 'honorary' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    if (amt && i % 3 === 0) { const p = (await admin.get('/api/members/' + r.data.id)).data; await admin.post(`/api/subscriptions/${p.member.subscription_id}/payments`, { amount: i % 2 ? amt : String(Number(amt) / 2), paid_at: days(s + 3 > 0 ? 0 : s + 3), method: 'bank_transfer', reference: `SEED-${i}` }); }
    i++;
  }
  await admin.post('/api/notifications/generate');
}

{
  await H.resetDb();
  const base = await H.start();
  const adminU = await H.mkUser('admin');
  const admin = await new H.Client().login(adminU);
  await seed(admin);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-SA', deviceScaleFactor: SHOTS ? 1.5 : 1 });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/auth\/me/.test(r.url())) errors.push(`[http ${r.status()}] ${r.url()}`); });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
  const step = async (n, fn) => { try { await fn(); console.log('✓', n); } catch (e) { console.log('✗', n, '\n  ', e.message.split('\n')[0]); errors.push(`[step ${n}] ${e.message.split('\n')[0]}`); await shot('fail-' + n.replace(/\W+/g, '_')); } };
  const settle = () => page.waitForLoadState('networkidle');

  await step('platform login → members app', async () => {
    await page.goto(base + '/members/'); await page.waitForURL(/\/\?next=/); await page.waitForSelector('#loginForm');
    await page.fill('#u', adminU.username); await page.fill('#p', 'wrong-password-1'); await page.click('#loginForm button[type=submit]');
    await page.waitForFunction(() => document.getElementById('err')?.textContent.trim().length > 0);
    await page.fill('#p', adminU.password); await page.click('#loginForm button[type=submit]');
    await page.waitForURL(/\/members\//); await page.waitForSelector('.ledger');
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
    assert.ok(await page.locator('#hd-appbar').count() === 1, 'شريط المنصة الموحّد');
  });
  await step('dashboard', async () => {
    await settle(); await page.waitForSelector('.ledger a.kpi'); await page.waitForTimeout(600);
    assert.ok((await page.locator('.ledger a.kpi').count()) === 10);
    const total = await page.locator('.ledger a.kpi').first().locator('.k-v').innerText();
    assert.equal(total.trim(), '12');
    assert.equal(await page.locator('canvas').count(), 3);
    await shot('02-dashboard');
  });
  await step('kpi drill-down', async () => {
    await page.locator('.ledger a.kpi', { hasText: 'عضويات منتهية' }).click();
    await page.waitForSelector('table.t'); await settle();
    const expected = await page.locator('.page-head .small').innerText();
    const rows = await page.locator('tbody tr').count();
    assert.ok(expected.includes(String(rows)), expected + ' vs ' + rows);
    assert.ok((await page.locator('.chip').count()) >= 1);
    await shot('03-members-expired');
  });
  await step('members list + search + sort', async () => {
    await page.goto(base + '/members/#/members'); await page.waitForSelector('table.t'); await settle(); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 12);
    await page.fill('.panel input[name=q]', 'الزهراني'); await page.waitForTimeout(600); await settle();
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.fill('.panel input[name=q]', ''); await page.waitForTimeout(500);
    await page.click('th button:has-text("الاسم")'); await settle();
    await shot('04-members');
  });
  await step('add member via modal', async () => {
    await page.goto(base + '/members/#/members'); await page.waitForSelector('table.t');
    await page.click('button:has-text("إضافة عضو")'); await page.waitForSelector('.modal');
    await shot('05-member-form');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal .err:not(:empty)');
    await page.fill('.modal input[name=full_name]', 'سارة بنت أحمد القرني'); await page.fill('.modal input[name=phone]', '0551234567'); await page.fill('.modal input[name=email]', 'sara@example.org');
    await page.fill('.modal input[name=amount_due]', '750');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.pid h2'); await settle();
    assert.equal((await page.locator('.pid h2').innerText()).trim(), 'سارة بنت أحمد القرني');
    assert.ok((await page.locator('.facts').innerText()).includes('750.00'));
  });
  await step('record payment (review + confirm) and receipt', async () => {
    await page.click('.actions >> text=تسجيل سداد'); await page.waitForSelector('.modal');
    await page.fill('.modal input[name=amount]', '300'); await page.fill('.modal input[name=reference]', 'UI-TRX-1');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await page.setInputFiles('.modal input[type=file]', { name: 'receipt.png', mimeType: 'image/png', buffer: png });
    await page.click('.modal button:has-text("مراجعة")'); await page.waitForSelector('.modal dl');
    await shot('06-payment-review');
    await page.click('.modal button:has-text("تأكيد وتسجيل السداد")');
    await page.waitForSelector('.modal', { state: 'detached' }); await settle();
    const text = await page.locator('.facts').innerText();
    assert.ok(text.includes('300.00') && text.includes('450.00'), text);
    assert.ok((await page.locator('table:has-text("UI-TRX-1")').count()) >= 1);
    assert.ok((await page.locator('a:has-text("receipt.png")').count()) === 1);
    // سداد جزئي ثانٍ + منع التجاوز
    await page.click('.actions >> text=تسجيل سداد'); await page.waitForSelector('.modal');
    await page.fill('.modal input[name=amount]', '451'); await page.fill('.modal input[name=reference]', 'UI-TRX-2');
    await page.click('.modal button:has-text("مراجعة")');
    await page.waitForSelector('.modal .field .err:not(:empty)');
    await page.click('.modal .modal-h button');
    await shot('07-profile');
  });
  await step('renew membership', async () => {
    await page.click('.actions >> text=تجديد العضوية'); await page.waitForSelector('.modal'); await shot('08-renew');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' }); await settle();
    await page.waitForFunction(() => [...document.querySelectorAll('section')].find((x) => x.querySelector('h3')?.textContent.includes('دورات الاشتراك'))?.querySelectorAll('tbody tr').length === 2);
  });
  await step('edit member keeps history', async () => {
    await page.click('.actions >> text=تعديل البيانات'); await page.waitForSelector('.modal');
    await page.fill('.modal textarea[name=notes]', 'ملاحظة اختبار'); await page.click('.modal button[type=submit]');
    await page.waitForSelector('.modal', { state: 'detached' }); await settle();
    assert.ok((await page.locator('text=ملاحظة اختبار').count()) >= 1);
    assert.ok((await page.locator('section:has(h3:has-text("سجل التعديلات")) li').count()) >= 3);
  });
  for (const [name, hash, sel] of [['finance', '#/finance', 'table.t'], ['finance-payments', '#/finance?tab=payments', 'table.t'], ['notifications', '#/notifications', 'table.t'], ['templates', '#/notifications?tab=templates', 'table.t'],
    ['reports', '#/reports', 'table.t'], ['import', '#/import', '.dropzone'], ['settings', '#/settings', 'form'], ['settings-rules', '#/settings?tab=rules', 'form'], ['settings-types', '#/settings?tab=types', 'table.t'], ['settings-roles', '#/settings?tab=roles', 'table.matrix'], ['audit', '#/audit', 'table.t']]) {
    await step('page ' + name, async () => { await page.goto(base + '/members/' + hash); await page.waitForSelector(sel, { timeout: 8000 }); await settle(); await page.waitForTimeout(250); await shot('10-' + name); });
  }
  await step('report export downloads', async () => {
    await page.goto(base + '/members/#/reports?r=remaining_dues'); await page.waitForSelector('table.t'); await settle();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Excel")')]);
    assert.match(dl.suggestedFilename(), /\.xlsx$/);
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('button:has-text("PDF")')]);
    assert.match(dl2.suggestedFilename(), /\.pdf$/);
  });
  await step('import flow via UI', async () => {
    await page.goto(base + '/members/#/import'); await page.waitForSelector('.dropzone');
    const csv = 'الاسم الكامل,رقم الجوال,البريد الإلكتروني,نوع العضوية,تاريخ بداية العضوية,قيمة الاشتراك\nمحمد القرشي,0561112222,mq@test.org,عادية,2026-01-01,500\n,0561112223,bad,عادية,2026-01-01,500\nمحمد القرشي المكرر,0561112222,x@test.org,عادية,2026-01-01,500';
    await page.setInputFiles('input[type=file]', { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('text=نتيجة التحقق'); await shot('11-import-preview');
    await page.click('button:has-text("متابعة إلى الاعتماد")'); await page.waitForSelector('#cf');
    assert.ok(await page.locator('button:has-text("استيراد 1 عضو")').isDisabled());
    await page.check('#cf'); await page.click('button:has-text("استيراد 1 عضو")');
    await page.waitForSelector('text=ملخص الاستيراد'); await shot('12-import-result');
  });
  await step('mobile layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/members/#/members'); await page.waitForSelector('table.t'); await settle();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'أفقي: ' + overflow);
    await shot('13-mobile-members');
    await page.click('button.menu'); await page.waitForSelector('.side[data-open=true]'); await shot('14-mobile-nav'); await page.click('.scrim', { position: { x: 20, y: 300 } });
    await page.goto(base + '/members/'); await page.waitForSelector('.ledger'); await page.waitForTimeout(500);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    await shot('15-mobile-dashboard');
  });
  await step('dark mode', async () => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(base + '/members/'); await page.waitForSelector('.ledger'); await page.click('button[title^="تبديل الوضع"]'); await page.waitForTimeout(400); await shot('16-dark-dashboard');
    await page.goto(base + '/members/#/members'); await page.waitForSelector('table.t'); await shot('17-dark-members');
  });
  await step('viewer role sees no write actions', async () => {
    const v = await H.mkUser('viewer');
    const ctx2 = await browser.newContext({ locale: 'ar-SA' }); const p2 = await ctx2.newPage();
    await p2.goto(base + '/members/'); await p2.waitForSelector('#loginForm'); await p2.fill('#u', v.username); await p2.fill('#p', v.password); await p2.click('#loginForm button[type=submit]');
    await p2.waitForSelector('.ledger');
    assert.equal(await p2.locator('a[data-nav=settings]').count(), 0);
    await p2.goto(base + '/members/#/members'); await p2.waitForSelector('table.t');
    assert.equal(await p2.locator('button:has-text("إضافة عضو")').count(), 0);
    await p2.goto(base + '/members/#/settings'); await p2.waitForSelector('text=ليست لديك صلاحية');
    await ctx2.close();
  });
  await browser.close();
  await H.stop();
  // أخطاء متوقعة: كلمة مرور خاطئة (401) ونموذج فارغ (400) ضمن سيناريوهات الاختبار نفسها
  const real = errors.filter((e) => !/favicon|ERR_ABORTED|http 401\] .*\/api\/auth\/login|http 400\] .*\/api\/members|status of (401|400)/.test(e));
  if (real.length) { console.log('\nأخطاء:\n' + [...new Set(real)].join('\n')); process.exit(1); }
  console.log('\nكل خطوات الواجهة نجحت بلا أخطاء كونسول.');
}
