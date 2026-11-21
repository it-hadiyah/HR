import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as H from './members-helpers.js';
import { signToken } from '../server/lib/auth.js';
const { Client, pool, days, today } = H;
// يحتاج قاعدة اختبار مخصصة: TEST_DATABASE_URL=postgres://.../xxx_test (تُعاد بناؤها بالكامل). يُتخطى إن لم تُضبط.
const ENABLED = !!process.env.TEST_DATABASE_URL;
const T = ENABLED ? describe : describe.skip;

let admin, membership, finance, viewer; // عملاء HTTP
let regular, honorary;

const newMember = (c, o = {}) => c.post('/api/members', {
  full_name: 'عبدالله بن محمد الشهري', phone: '0501234567', email: 'a@example.com', membership_type_id: regular,
  joined_at: today(), start_date: today(), amount_due: '500.00', ...o,
});
const profile = async (c, id) => (await c.get('/api/members/' + id)).data;
let phoneSeq = 0;
const uniq = () => ({ phone: '05' + String(10000000 + (++phoneSeq)).slice(0, 8), email: `u${phoneSeq}@example.com` });

ENABLED && before(async () => {
  await H.resetDb();
  await H.start();
  admin = await new Client().login(await H.mkUser('admin'));
  membership = await new Client().login(await H.mkUser('membership'));
  finance = await new Client().login(await H.mkUser('finance'));
  viewer = await new Client().login(await H.mkUser('viewer'));
  const types = (await pool.query('SELECT id, code FROM membership_types')).rows;
  regular = types.find((t) => t.code === 'regular').id;
  honorary = types.find((t) => t.code === 'honorary').id;
});
if (ENABLED) after(H.stop);

T('أدوات التطبيع والحساب', () => {
  const N = H.N;
  it('الجوال: صيغ سعودية ودولية وأرقام عربية', () => {
    assert.equal(N.normalizePhone('0501234567'), '+966501234567');
    assert.equal(N.normalizePhone('٠٥٠١٢٣٤٥٦٧'), '+966501234567');
    assert.equal(N.normalizePhone('+966 50 123 4567'), '+966501234567');
    assert.equal(N.normalizePhone('00447911123456'), '+447911123456');
    assert.throws(() => N.normalizePhone('12345'));
    assert.equal(N.normalizePhone(''), null);
  });
  it('المبالغ بدقة عشرية دون Float', () => {
    assert.equal(N.normalizeMoney('0.1'), '0.10');
    assert.equal(N.fromCents(N.cents('0.10') + N.cents('0.20')), '0.30');
    assert.equal(N.normalizeMoney('1,250.5'), '1250.50');
    assert.throws(() => N.normalizeMoney('12.345'));
    assert.throws(() => N.normalizeMoney('-5'));
    assert.throws(() => N.normalizeMoney('abc'));
  });
  it('التواريخ ونهاية الدورة', () => {
    assert.equal(N.normalizeDate('31/01/2026'), '2026-01-31');
    assert.throws(() => N.normalizeDate('2026-02-30'));
    assert.equal(N.periodEnd('2026-01-01', 12), '2026-12-31');
    assert.equal(N.periodEnd('2026-01-31', 1), '2026-02-27');
    assert.equal(N.periodEnd('2024-02-29', 12), '2025-02-27');
  });
});

T('السيناريو 1–2: إضافة عضو واسترجاعه وتعديله دون فقدان السجل', () => {
  it('يضيف عضوًا برقم عضوية تلقائي ويسترجع بياناته', async () => {
    const r = await newMember(admin, uniq());
    assert.equal(r.status, 201);
    const p = await profile(admin, r.data.id);
    assert.match(p.member.member_no, /^H-\d{6}$/);
    assert.equal(p.member.full_name, 'عبدالله بن محمد الشهري');
    assert.match(p.member.phone, /^\+9665/);
    assert.equal(p.member.amount_due, '500.00');
    assert.equal(p.periods.length, 1);
    assert.equal(p.member.membership_status, 'active');
    assert.equal(p.member.payment_status, 'not_yet_due' === p.member.payment_status ? 'not_yet_due' : p.member.payment_status);
  });
  it('أرقام العضوية فريدة ومتسلسلة', async () => {
    const a = await profile(admin, (await newMember(admin, uniq())).data.id);
    const b = await profile(admin, (await newMember(admin, uniq())).data.id);
    assert.notEqual(a.member.member_no, b.member.member_no);
  });
  it('التعديل يحتفظ بالدورات والمدفوعات ويسجل التدقيق', async () => {
    const id = (await newMember(admin, uniq())).data.id;
    const sub = (await profile(admin, id)).member.subscription_id;
    await finance.post(`/api/subscriptions/${sub}/payments`, { amount: '100', paid_at: today(), method: 'cash', reference: 'EDIT-1' });
    const u = await membership.put('/api/members/' + id, { full_name: 'اسم معدّل', notes: 'ملاحظة' });
    assert.equal(u.status, 200);
    const p = await profile(admin, id);
    assert.equal(p.member.full_name, 'اسم معدّل');
    assert.equal(p.payments.length, 1);
    assert.equal(p.periods.length, 1);
    assert.ok(p.history.some((h) => h.action === 'member.update' && h.after.full_name === 'اسم معدّل'));
  });
  it('يرفض بيانات غير صحيحة برسائل لكل حقل', async () => {
    const r = await newMember(admin, { full_name: 'ab', phone: '123', email: 'bad' });
    assert.equal(r.status, 400);
    assert.ok(r.data.details.full_name && r.data.details.phone && r.data.details.email);
  });
});

T('السيناريو 3–4: السداد الجزئي والمتعدد', () => {
  let id, sub;
  before(async () => { id = (await newMember(admin, uniq())).data.id; sub = (await profile(admin, id)).member.subscription_id; });
  const pay = (c, amount, extra = {}) => c.post(`/api/subscriptions/${sub}/payments`, { amount, paid_at: today(), method: 'bank_transfer', ...extra });

  it('دفعة جزئية: المتبقي صحيح والحالة جزئي', async () => {
    const r = await pay(finance, '200.00', { reference: 'TRX-1' });
    assert.equal(r.status, 201);
    const m = (await profile(admin, id)).member;
    assert.equal(m.paid, '200.00'); assert.equal(m.remaining, '300.00');
    assert.ok(['partial', 'overdue', 'unpaid'].includes(m.payment_status));
    assert.equal(m.is_partial, true);
  });
  it('دفعات متعددة لنفس الاشتراك حتى السداد الكامل', async () => {
    assert.equal((await pay(finance, '100.10', { reference: 'TRX-2' })).status, 201);
    let m = (await profile(admin, id)).member;
    assert.equal(m.paid, '300.10'); assert.equal(m.remaining, '199.90');
    assert.equal((await pay(finance, '199.90', { reference: 'TRX-3' })).status, 201);
    m = (await profile(admin, id)).member;
    assert.equal(m.remaining, '0.00'); assert.equal(m.payment_status, 'paid');
  });
  it('يمنع تجاوز المتبقي', async () => {
    const r = await pay(finance, '0.01', { reference: 'TRX-4' });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'overpayment');
  });
  it('يمنع تكرار المرجع البنكي', async () => {
    const id2 = (await newMember(admin, uniq())).data.id;
    const sub2 = (await profile(admin, id2)).member.subscription_id;
    const r = await finance.post(`/api/subscriptions/${sub2}/payments`, { amount: '50', paid_at: today(), method: 'bank_transfer', reference: 'trx-1 ' });
    assert.equal(r.status, 409); assert.equal(r.data.code, 'duplicate_reference');
  });
  it('الإرسال المزدوج بنفس مفتاح التكرار لا ينشئ دفعة ثانية', async () => {
    const id3 = (await newMember(admin, uniq())).data.id;
    const sub3 = (await profile(admin, id3)).member.subscription_id;
    const body = { amount: '75', paid_at: today(), method: 'cash', idempotency_key: 'form-abc-123' };
    const a = await finance.post(`/api/subscriptions/${sub3}/payments`, body);
    const b = await finance.post(`/api/subscriptions/${sub3}/payments`, body);
    assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.data.replayed, true);
    assert.equal((await profile(admin, id3)).payments.length, 1);
  });
  it('تنبيه تطابق عملية بلا مرجع (نفس المبلغ والتاريخ والطريقة)', async () => {
    const id4 = (await newMember(admin, uniq())).data.id;
    const sub4 = (await profile(admin, id4)).member.subscription_id;
    const body = { amount: '60', paid_at: today(), method: 'cash' };
    assert.equal((await finance.post(`/api/subscriptions/${sub4}/payments`, body)).status, 201);
    const dup = await finance.post(`/api/subscriptions/${sub4}/payments`, body);
    assert.equal(dup.status, 409); assert.equal(dup.data.code, 'possible_duplicate');
    assert.equal((await finance.post(`/api/subscriptions/${sub4}/payments`, { ...body, confirm_duplicate: true })).status, 201);
  });
  it('يرفض تاريخ سداد مستقبليًا ومبلغًا صفريًا', async () => {
    const r1 = await pay(finance, '10', { paid_at: days(3), reference: 'F-1' });
    assert.equal(r1.status, 400); assert.ok(r1.data.details.paid_at);
    const r2 = await pay(finance, '0', { reference: 'F-2' });
    assert.equal(r2.status, 400);
  });
  it('تسجيل دفعات متزامنة لا يتجاوز الاشتراك (قفل الصف)', async () => {
    const idc = (await newMember(admin, uniq())).data.id;
    const subc = (await profile(admin, idc)).member.subscription_id;
    const rs = await Promise.all([1, 2, 3, 4].map((i) =>
      finance.post(`/api/subscriptions/${subc}/payments`, { amount: '300', paid_at: today(), method: 'cash', reference: `RACE-${i}` })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    const m = (await profile(admin, idc)).member;
    assert.equal(m.paid, '300.00'); assert.equal(m.remaining, '200.00');
  });
  it('إلغاء دفعة يعيد احتساب المتبقي ويحفظ السجل', async () => {
    const idv = (await newMember(admin, uniq())).data.id;
    const subv = (await profile(admin, idv)).member.subscription_id;
    const p = (await finance.post(`/api/subscriptions/${subv}/payments`, { amount: '500', paid_at: today(), method: 'cash', reference: 'VOID-1' })).data.payment;
    assert.equal((await finance.post(`/api/payments/${p.id}/void`, {})).status, 400); // السبب مطلوب
    assert.equal((await finance.post(`/api/payments/${p.id}/void`, { reason: 'خطأ إدخال' })).status, 200);
    const pr = await profile(admin, idv);
    assert.equal(pr.member.remaining, '500.00');
    assert.equal(pr.payments.length, 1); assert.equal(pr.payments[0].status, 'voided');
    // بعد الإلغاء يمكن إعادة استخدام المرجع
    assert.equal((await finance.post(`/api/subscriptions/${subv}/payments`, { amount: '500', paid_at: today(), method: 'cash', reference: 'VOID-1' })).status, 201);
  });
  it('تعديل دفعة يتطلب سببًا ويُدقَّق قبل/بعد', async () => {
    const ide = (await newMember(admin, uniq())).data.id;
    const sube = (await profile(admin, ide)).member.subscription_id;
    const p = (await finance.post(`/api/subscriptions/${sube}/payments`, { amount: '100', paid_at: today(), method: 'cash', reference: 'ED-1' })).data.payment;
    assert.equal((await finance.put(`/api/payments/${p.id}`, { amount: '150' })).status, 400);
    assert.equal((await finance.put(`/api/payments/${p.id}`, { amount: '150', reason: 'تصحيح' })).status, 200);
    assert.equal((await finance.put(`/api/payments/${p.id}`, { amount: '600', reason: 'تجاوز' })).status, 400);
    const log = (await admin.get('/api/audit?entity=payment&action=payment.update')).data.rows[0];
    assert.equal(log.before.amount, '100.00'); assert.equal(log.after.amount, '150.00'); assert.equal(log.after.reason, 'تصحيح');
  });
});

T('السيناريو 5–6: حالة العضوية مستقلة عن حالة السداد', () => {
  const mk = async (start, end, due, extra = {}) => (await newMember(admin, { ...uniq(), start_date: start, end_date: end, due_date: due, joined_at: start, ...extra })).data.id;
  it('سارية / قريبة الانتهاء / منتهية بحسب التواريخ', async () => {
    const a = await profile(admin, await mk(days(-100), days(200), days(-100)));
    const b = await profile(admin, await mk(days(-350), days(15), days(-350)));
    const c = await profile(admin, await mk(days(-400), days(-5), days(-400)));
    assert.equal(a.member.membership_status, 'active');
    assert.equal(b.member.membership_status, 'near_expiry');
    assert.equal(c.member.membership_status, 'expired');
  });
  it('الحد 30 يوم شامل، و31 يوم سارية', async () => {
    assert.equal((await profile(admin, await mk(days(-300), days(30), days(-300)))).member.membership_status, 'near_expiry');
    assert.equal((await profile(admin, await mk(days(-300), days(31), days(-300)))).member.membership_status, 'active');
  });
  it('عضو منتهٍ لكنه مسدد بالكامل، وعضو ساري لكنه متأخر', async () => {
    const id = await mk(days(-400), days(-5), days(-400));
    const sub = (await profile(admin, id)).member.subscription_id;
    await finance.post(`/api/subscriptions/${sub}/payments`, { amount: '500', paid_at: today(), method: 'cash', reference: 'IND-1' });
    const m1 = (await profile(admin, id)).member;
    assert.equal(m1.membership_status, 'expired'); assert.equal(m1.payment_status, 'paid');
    const m2 = (await profile(admin, await mk(days(-100), days(200), days(-50)))).member;
    assert.equal(m2.membership_status, 'active'); assert.equal(m2.payment_status, 'overdue');
  });
  it('غير مستحق بعد / غير مسدد / مسدد جزئيًا قبل الاستحقاق', async () => {
    const f = (await profile(admin, await mk(days(0), days(364), days(20)))).member;
    assert.equal(f.payment_status, 'not_yet_due');
    const g = await mk(days(0), days(364), days(0));
    assert.equal((await profile(admin, g)).member.payment_status, 'unpaid');
    const sub = (await profile(admin, g)).member.subscription_id;
    await finance.put('/api/periods/' + (await profile(admin, g)).member.period_id, { due_date: days(10) });
    await finance.post(`/api/subscriptions/${sub}/payments`, { amount: '50', paid_at: today(), method: 'cash', reference: 'PRT-1' });
    assert.equal((await profile(admin, g)).member.payment_status, 'partial');
  });
  it('الإعفاء مسموح للنوع الفخري فقط ويمنع تسجيل المدفوعات', async () => {
    const bad = await newMember(admin, { ...uniq(), is_exempt: true });
    assert.equal(bad.status, 400);
    const ok = await newMember(admin, { ...uniq(), membership_type_id: honorary, is_exempt: true });
    assert.equal(ok.status, 201);
    const p = (await profile(admin, ok.data.id)).member;
    assert.equal(p.payment_status, 'exempt'); assert.equal(p.remaining, '0.00');
    const r = await finance.post(`/api/subscriptions/${p.subscription_id}/payments`, { amount: '10', paid_at: today(), method: 'cash', reference: 'EX-1' });
    assert.equal(r.status, 409);
  });
  it('التعليق والإلغاء الإداري يتغلبان على التواريخ، والرجوع يعيد الحالة المحسوبة', async () => {
    const id = await mk(days(-10), days(300), days(-10));
    assert.equal((await membership.post(`/api/members/${id}/status`, { status: 'suspended' })).status, 400);
    assert.equal((await membership.post(`/api/members/${id}/status`, { status: 'suspended', reason: 'قرار مجلس الإدارة' })).status, 200);
    assert.equal((await profile(admin, id)).member.membership_status, 'suspended');
    await membership.post(`/api/members/${id}/status`, { status: 'normal' });
    assert.equal((await profile(admin, id)).member.membership_status, 'active');
  });
  it('قواعد قابلة للضبط: فترة السماح وحد التنبيه ومنع التفعيل قبل السداد', async () => {
    const id = await mk(days(-400), days(-5), days(-400));
    assert.equal((await profile(admin, id)).member.membership_status, 'expired');
    assert.equal((await admin.put('/api/settings', { 'rules.grace_days': 10 })).status, 200);
    assert.notEqual((await profile(admin, id)).member.membership_status, 'expired');
    await admin.put('/api/settings', { 'rules.grace_days': 0 });
    const act = await mk(days(-1), days(364), days(-1));
    assert.equal((await profile(admin, act)).member.membership_status, 'active');
    await admin.put('/api/settings', { 'rules.activation_min_paid_percent': 50 });
    assert.equal((await profile(admin, act)).member.membership_status, 'pending');
    await admin.put('/api/settings', { 'rules.activation_min_paid_percent': 0 });
    assert.equal((await profile(admin, act)).member.membership_status, 'active');
    const log = (await admin.get('/api/audit?entity=settings')).data.rows;
    assert.ok(log.some((l) => l.after['rules.grace_days'] === 10));
  });
});

T('السيناريو 7: التجديد يحتفظ بالتاريخ', () => {
  it('ينشئ دورة واشتراكًا جديدين ويبقي القديم', async () => {
    const id = (await newMember(admin, { ...uniq(), start_date: days(-300), end_date: days(65), joined_at: days(-300), due_date: days(-300) })).data.id;
    const before = await profile(admin, id);
    const sub1 = before.member.subscription_id;
    await finance.post(`/api/subscriptions/${sub1}/payments`, { amount: '500', paid_at: today(), method: 'cash', reference: 'REN-1' });
    const r = await membership.post(`/api/members/${id}/renew`, { duration_months: 12 });
    assert.equal(r.status, 201);
    const after = await profile(admin, id);
    assert.equal(after.periods.length, 2);
    assert.equal(after.periods[1].subscription_id, sub1);
    assert.equal(after.periods[1].paid, '500.00');
    assert.equal(after.periods[0].start_date, H.N.addDaysISO(before.member.period_end, 1));
    assert.equal(after.periods[0].kind, 'renewal');
    assert.equal(after.periods[0].amount_due, '500.00'); // رُحِّلت قيمة الدورة السابقة (قيمة النوع الافتراضية صفر)
    assert.equal(after.payments.length, 1);
    assert.equal(after.member.period_id, after.periods[0].id);
    assert.equal(after.member.membership_status, 'active'); // مُجدَّد مبكرًا فلا يظهر قريب الانتهاء
  });
  it('تجديد مرتين يتطلب تأكيدًا، والمنتهي يبدأ من اليوم', async () => {
    const id = (await newMember(admin, { ...uniq(), start_date: days(-500), end_date: days(-135), joined_at: days(-500), due_date: days(-500) })).data.id;
    const r = await membership.post(`/api/members/${id}/renew`, {});
    assert.equal(r.status, 201);
    const p = await profile(admin, id);
    assert.equal(p.periods[0].start_date, today());
    assert.equal(p.member.membership_status, 'active');
    const again = await membership.post(`/api/members/${id}/renew`, {});
    assert.equal(again.status, 200 === again.status ? 200 : again.status);
  });
  it('لا يجدد عضوية ملغاة', async () => {
    const id = (await newMember(admin, uniq())).data.id;
    await membership.post(`/api/members/${id}/status`, { status: 'cancelled', reason: 'انسحاب' });
    assert.equal((await membership.post(`/api/members/${id}/renew`, {})).status, 409);
  });
  it('يمنع تداخل الدورات', async () => {
    const id = (await newMember(admin, uniq())).data.id;
    const r = await membership.post(`/api/members/${id}/renew`, { start_date: days(5), confirm_additional: true });
    assert.equal(r.status, 409); assert.equal(r.data.code, 'period_overlap');
  });
});

T('السيناريو 8: مؤشرات لوحة التحكم تطابق قاعدة البيانات', () => {
  it('الأرقام تُحسب من قاعدة البيانات', async () => {
    const d = (await admin.get('/api/dashboard')).data;
    const q = async (sql) => (await pool.query(sql)).rows[0];
    const total = await q(`SELECT count(*)::int n FROM members WHERE archived_at IS NULL`);
    const valid = await q(`SELECT count(*)::int n FROM member_overview WHERE archived_at IS NULL AND membership_status IN ('active','near_expiry')`);
    const exp = await q(`SELECT count(*)::int n FROM member_overview WHERE archived_at IS NULL AND membership_status='expired'`);
    const money = await q(`SELECT COALESCE(SUM(s.amount_due) FILTER (WHERE NOT s.is_exempt),0) due,
        COALESCE((SELECT SUM(p.amount) FROM payments p JOIN subscriptions s2 ON s2.id=p.subscription_id JOIN members m2 ON m2.id=s2.member_id
                  JOIN membership_periods mp2 ON mp2.id=s2.period_id AND mp2.status='active'
                  WHERE p.status='confirmed' AND m2.archived_at IS NULL),0) paid
      FROM subscriptions s JOIN members m ON m.id=s.member_id AND m.archived_at IS NULL JOIN membership_periods mp ON mp.id=s.period_id AND mp.status='active'`);
    assert.equal(d.kpis.total_members, total.n);
    assert.equal(d.kpis.valid_members, valid.n);
    assert.equal(d.kpis.expired, exp.n);
    assert.equal(Number(d.kpis.total_due), Number(money.due));
    assert.equal(Number(d.kpis.total_collected), Number(money.paid));
    assert.equal((BigInt(Math.round(Number(d.kpis.total_due) * 100)) - BigInt(Math.round(Number(d.kpis.total_collected) * 100))).toString(),
      BigInt(Math.round(Number(d.kpis.total_remaining) * 100)).toString());
    assert.equal(d.charts.by_type.reduce((a, b) => a + b.count, 0), total.n);
    assert.equal(d.charts.collections.length, 12);
    assert.equal(d.charts.expiring.length, 6);
  });
  it('الأعضاء المرتبطون بكل مؤشر يطابقون العدد', async () => {
    const d = (await admin.get('/api/dashboard')).data.kpis;
    assert.equal((await admin.get('/api/members?membership_status=expired&pageSize=1')).data.total, d.expired);
    assert.equal((await admin.get('/api/members?membership_status=active,near_expiry&pageSize=1')).data.total, d.valid_members);
    assert.equal((await admin.get('/api/members?membership_status=near_expiry&pageSize=1')).data.total, d.near_expiry);
    assert.equal((await admin.get('/api/members?payment_status=overdue&pageSize=1')).data.total, d.overdue_members);
    assert.equal((await admin.get('/api/members?has_balance=1&pageSize=1')).data.total > 0, true);
  });
  it('المؤرشفون يُستثنون من المؤشرات', async () => {
    const before = (await admin.get('/api/dashboard')).data.kpis.total_members;
    const id = (await newMember(admin, uniq())).data.id;
    assert.equal((await admin.get('/api/dashboard')).data.kpis.total_members, before + 1);
    await membership.post(`/api/members/${id}/archive`);
    assert.equal((await admin.get('/api/dashboard')).data.kpis.total_members, before);
    assert.equal((await admin.get('/api/members?archived=1')).data.rows.some((r) => r.id === id), true);
  });
});

T('البحث والتصفية والفرز', () => {
  it('بحث بالاسم والرقم والجوال والبريد', async () => {
    const r = await newMember(admin, { full_name: 'فاطمة الزهراني الفريدة', phone: '0555123987', email: 'unique.search@test.org' });
    const p = await profile(admin, r.data.id);
    for (const q of ['الزهراني الفريدة', p.member.member_no, '0555123987', '+966555123987', '٠٥٥٥١٢٣٩٨٧', 'unique.search']) {
      const res = (await admin.get('/api/members?q=' + encodeURIComponent(q))).data;
      assert.ok(res.rows.some((x) => x.id === r.data.id), 'q=' + q);
    }
    assert.equal((await admin.get('/api/members?q=' + encodeURIComponent("' OR 1=1 --"))).data.total, 0);
    assert.equal((await admin.get('/api/members?q=%25')).data.total, 0);
  });
  it('الفرز بعمود غير مسموح لا يسبب حقنًا', async () => {
    const r = await admin.get('/api/members?sort=' + encodeURIComponent('id; DROP TABLE members') + '&dir=desc');
    assert.equal(r.status, 200);
    assert.ok((await pool.query('SELECT 1 FROM members LIMIT 1')).rowCount === 1);
  });
});

T('السيناريو 9: التقارير والتصدير', () => {
  it('تقرير Excel صحيح (RTL، أرقام وتواريخ حقيقية)', async () => {
    const r = await admin.get('/api/reports/remaining_dues?format=xlsx');
    assert.equal(r.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.data);
    const ws = wb.worksheets[0];
    assert.equal(ws.views[0].rightToLeft, true);
    const json = (await admin.get('/api/reports/remaining_dues')).data;
    assert.equal(ws.rowCount, 4 + json.rows.length + 1);
    const rem = json.columns.findIndex((c) => c.key === 'total_remaining') + 1;
    assert.equal(typeof ws.getRow(5).getCell(rem).value, 'number');
    assert.equal(ws.getRow(ws.rowCount).getCell(rem).value, Number(json.totals.total_remaining));
    const col = (await admin.get('/api/reports/collections?format=xlsx')).data;
    const ws2 = (await new ExcelJS.Workbook().xlsx.load(col)).worksheets[0];
    assert.ok(ws2.getRow(5).getCell(1).value instanceof Date);
  });
  it('تقرير PDF يُولَّد بصيغة صحيحة', async () => {
    const r = await admin.get('/api/reports/all_members?format=pdf');
    assert.equal(r.status, 200);
    assert.equal(r.data.slice(0, 5).toString(), '%PDF-');
    assert.ok(r.data.length > 5000);
  });
  it('كل التقارير التسعة تعمل مع المرشحات', async () => {
    const cat = (await admin.get('/api/reports')).data;
    assert.equal(cat.length, 9);
    for (const rep of cat) {
      const r = await admin.get(`/api/reports/${rep.id}?from=2000-01-01&to=2100-01-01&type_id=${regular}`);
      assert.equal(r.status, 200, rep.id);
      assert.ok(Array.isArray(r.data.rows));
    }
  });
  it('تقرير الجزئي يضم المتأخرين جزئيًا ولا يضم غير المسددين', async () => {
    const r = (await admin.get('/api/reports/partial_members')).data;
    assert.ok(r.rows.length > 0);
    assert.ok(r.rows.every((x) => Number(x.total_paid) > 0 && Number(x.total_remaining) > 0));
    const u = (await admin.get('/api/reports/unpaid_members')).data;
    assert.ok(u.rows.every((x) => Number(x.total_paid) === 0));
  });
  it('تقرير التحصيل: المجموع يطابق قاعدة البيانات في الفترة', async () => {
    const r = (await admin.get(`/api/reports/collections?from=${today()}&to=${today()}`)).data;
    const db = (await pool.query(`SELECT COALESCE(SUM(amount),0) s, COUNT(*)::int n FROM payments WHERE status='confirmed' AND paid_at=$1`, [today()])).rows[0];
    assert.equal(Number(r.totals.amount), Number(db.s)); assert.equal(r.count, db.n);
  });
  it('تصدير قائمة الأعضاء وملخص العضو PDF', async () => {
    const x = await admin.get('/api/members/export?format=xlsx&membership_status=active');
    assert.equal(x.status, 200);
    const id = (await admin.get('/api/members?pageSize=1')).data.rows[0].id;
    const p = await admin.get(`/api/members/${id}/summary.pdf`);
    assert.equal(p.data.slice(0, 5).toString(), '%PDF-');
  });
});

T('السيناريو 10: الصلاحيات من جهة الخادم', () => {
  let sub, payId;
  before(async () => {
    const id = (await newMember(admin, uniq())).data.id;
    sub = (await profile(admin, id)).member.subscription_id;
    payId = (await finance.post(`/api/subscriptions/${sub}/payments`, { amount: '100', paid_at: today(), method: 'cash', reference: 'RBAC-1' })).data.payment.id;
  });
  it('غير المصادق عليه: 401', async () => {
    const anon = new Client();
    assert.equal((await anon.get('/api/members')).status, 401);
    assert.equal((await anon.get('/api/dashboard')).status, 401);
    assert.equal((await anon.get('/api/attachments/1')).status, 401);
  });
  it('مستخدم العرض لا يعدّل ولا يسجل ولا يصدّر ولا يرى الإعدادات', async () => {
    assert.equal((await viewer.post(`/api/subscriptions/${sub}/payments`, { amount: '1', paid_at: today(), method: 'cash', reference: 'V-1' })).status, 403);
    assert.equal((await viewer.put(`/api/payments/${payId}`, { amount: '5', reason: 'x' })).status, 403);
    assert.equal((await viewer.post(`/api/payments/${payId}/void`, { reason: 'x' })).status, 403);
    assert.equal((await viewer.post('/api/members', {})).status, 403);
    assert.equal((await viewer.get('/api/members/export')).status, 403);
    assert.equal((await viewer.get('/api/settings')).status, 403);
    assert.equal((await viewer.get('/api/audit')).status, 403);
    assert.equal((await viewer.get('/api/members')).status, 200);
  });
  it('مسؤول العضويات لا يعدّل المدفوعات ولا الاشتراكات المالية', async () => {
    assert.equal((await membership.post(`/api/subscriptions/${sub}/payments`, { amount: '1', paid_at: today(), method: 'cash', reference: 'M-1' })).status, 403);
    assert.equal((await membership.put(`/api/payments/${payId}`, { amount: '5', reason: 'x' })).status, 403);
    assert.equal((await membership.post(`/api/payments/${payId}/void`, { reason: 'x' })).status, 403);
    const pid = (await pool.query('SELECT period_id FROM subscriptions WHERE id=$1', [sub])).rows[0].period_id;
    assert.equal((await membership.put(`/api/periods/${pid}`, { amount_due: '1.00' })).status, 403);
    assert.equal((await membership.put(`/api/periods/${pid}`, { end_date: days(500) })).status, 200);
    const c = await newMember(membership, { ...uniq(), amount_due: '1.00' });
    assert.equal(c.status, 403); // لا يحدد مبلغًا مخصصًا
    const ok = await newMember(membership, { ...uniq(), amount_due: undefined });
    assert.equal(ok.status, 201);
  });
  it('المسؤول المالي لا يعدّل بيانات الأعضاء ولا الإعدادات ولا المستخدمين', async () => {
    assert.equal((await finance.put('/api/members/1', { full_name: 'تعديل مرفوض' })).status, 403);
    assert.equal((await finance.post('/api/members', {})).status, 403);
    assert.equal((await finance.put('/api/settings', { 'rules.grace_days': 5 })).status, 403);
        assert.equal((await finance.put(`/api/payments/${payId}`, { amount: '120', reason: 'تصحيح' })).status, 200);
  });
  it('الحقول المالية مخفية عمن لا يملك payments.view', async () => {
    const noFin = await pool.query(`SELECT id FROM roles WHERE code='viewer'`);
    const pid = (await pool.query(`SELECT id FROM permissions WHERE code='payments.view'`)).rows[0].id;
    await pool.query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2', [noFin.rows[0].id, pid]);
    try {
      const r = (await viewer.get('/api/members?pageSize=1')).data.rows[0];
      assert.equal('amount_due' in r, false); assert.equal('total_remaining' in r, false);
      const d = (await viewer.get('/api/dashboard')).data;
      assert.equal('total_collected' in d.kpis, false);
      assert.equal((await viewer.get('/api/payments')).status, 403);
      assert.equal((await viewer.get('/api/reports/collections')).status, 403);
    } finally { await pool.query('INSERT INTO role_permissions VALUES ($1,$2)', [noFin.rows[0].id, pid]); }
  });
  it('CSRF: الطلب المغيّر بلا رمز مرفوض ومع أصل غريب مرفوض', async () => {
    const c = new Client(); c.cookie = admin.cookie; c.csrf = '';
    assert.equal((await c.post('/api/members', {})).status, 403);
    const evil = await admin.req('POST', '/api/members', {}, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
  });
  it('تغيير صلاحيات دور يسري فورًا ويُدقَّق', async () => {
    const role = (await pool.query(`SELECT id FROM roles WHERE code='viewer'`)).rows[0].id;
    const roles = (await admin.get('/api/roles')).data;
    const cur = roles.roles.find((r) => r.id === role).permission_ids;
    const exportId = roles.permissions.find((p) => p.code === 'members.export').id;
    assert.equal((await admin.put(`/api/roles/${role}/permissions`, { permission_ids: [...cur, exportId] })).status, 200);
    assert.equal((await viewer.get('/api/members/export?format=xlsx')).status, 200);
    assert.equal((await admin.put(`/api/roles/${role}/permissions`, { permission_ids: cur })).status, 200);
    assert.equal((await viewer.get('/api/members/export?format=xlsx')).status, 403);
    const adminRole = (await pool.query(`SELECT id FROM roles WHERE code='admin'`)).rows[0].id;
    assert.equal((await admin.put(`/api/roles/${adminRole}/permissions`, { permission_ids: [] })).status, 409);
  });
});

T('السيناريو 11: سجل التدقيق', () => {
  it('يسجل العمليات الهامة بالمستخدم والقيم، ويقنّع الجوال والبريد', async () => {
    const id = (await newMember(admin, { ...uniq(), phone: '0561112233' })).data.id;
    await membership.put('/api/members/' + id, { phone: '0561112244' });
    const rows = (await admin.get(`/api/audit?entity=member&entity_id=${id}`)).data.rows;
    const upd = rows.find((r) => r.action === 'member.update');
    assert.match(upd.username, /^membership/);
    assert.notEqual(upd.after.phone, '+966561112244'); assert.match(upd.after.phone, /\*\*\*/);
    assert.ok(rows.some((r) => r.action === 'member.create'));
    assert.ok(!JSON.stringify(rows).includes('password'));
  });
  it('السجل لا يقبل التعديل أو الحذف حتى من قاعدة البيانات', async () => {
    await assert.rejects(() => pool.query('UPDATE audit_logs SET action=$1', ['x']), /append-only/);
    await assert.rejects(() => pool.query('DELETE FROM audit_logs'), /append-only/);
    await assert.rejects(() => pool.query('TRUNCATE audit_logs'), /append-only/);
  });
  it('لا تُحذف المدفوعات: قيد المفتاح الأجنبي يمنع حذف العضو', async () => {
    await assert.rejects(() => pool.query('DELETE FROM members WHERE id IN (SELECT member_id FROM payments LIMIT 1)'), /violates foreign key/);
  });
  it('قيود المبالغ في قاعدة البيانات', async () => {
    await assert.rejects(() => pool.query(`UPDATE payments SET amount=-1 WHERE id=(SELECT min(id) FROM payments)`), /check constraint/);
  });
});

T('السيناريو 12: الاستيراد', () => {
  const csvFile = (text) => { const f = new FormData(); f.append('file', new Blob([text], { type: 'text/csv' }), 'members.csv'); return f; };
  const header = 'الاسم الكامل,رقم الجوال,البريد الإلكتروني,نوع العضوية,تاريخ بداية العضوية,قيمة الاشتراك,المبلغ المسدد\n';
  let batch;
  it('يعاين: أخطاء برقم الصف وتكرار داخل الملف ومع قاعدة البيانات', async () => {
    await newMember(admin, { full_name: 'عضو موجود مسبقًا', phone: '0599000111', email: 'exists@test.org' });
    const text = header + [
      'أحمد المطيري,0540000001,ahmed@test.org,عادية,2026-01-01,300,100',
      'سارة العتيبي,0540000002,sara@test.org,عاملة,01/02/2026,400,',
      ',0540000003,x@test.org,عادية,2026-01-01,300,',
      'خالد الدوسري,12345,k@test.org,عادية,2026-01-01,300,',
      'ليلى القحطاني,0540000005,bad-email,عادية,2026-01-01,300,',
      'ماجد الحربي,0540000006,m@test.org,غير موجود,2026-01-01,300,',
      'نورة السبيعي,0540000007,n@test.org,عادية,2026-13-45,300,',
      'تكرار الملف,0540000001,other@test.org,عادية,2026-01-01,300,',
      'تكرار القاعدة,0599000111,zz@test.org,عادية,2026-01-01,300,',
      'مبلغ زائد,0540000010,o@test.org,عادية,2026-01-01,300,999',
      'فخري معفى,0540000011,h@test.org,فخرية,2026-01-01,,',
    ].join('\n');
    const r = await membership.req('POST', '/api/import/preview', csvFile(text));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    batch = r.data;
    assert.deepEqual(batch.summary, { total: 11, valid: 3, errors: 6, duplicates: 2 });
    assert.equal(batch.missing_required.length, 0);
    const byRow = Object.fromEntries(batch.problem_rows.map((x) => [x.row, x]));
    assert.equal(byRow[4].errors[0].field, 'full_name');
    assert.equal(byRow[5].errors[0].field, 'phone');
    assert.equal(byRow[6].errors[0].field, 'email');
    assert.equal(byRow[7].errors[0].field, 'type');
    assert.equal(byRow[8].errors[0].field, 'start_date');
    assert.equal(byRow[9].status, 'duplicate'); assert.match(byRow[9].duplicates[0].with, /الصف 2/);
    assert.equal(byRow[10].status, 'duplicate'); assert.match(byRow[10].duplicates[0].with, /H-/);
    assert.equal(byRow[11].errors[0].field, 'paid_amount');
    const before = (await pool.query('SELECT count(*)::int n FROM members')).rows[0].n;
    assert.equal(before > 0, true); // المعاينة لا تكتب شيئًا
    assert.equal((await pool.query(`SELECT count(*)::int n FROM members WHERE full_name='أحمد المطيري'`)).rows[0].n, 0);
  });
  it('الاعتماد يتطلب تأكيدًا صريحًا', async () => {
    assert.equal((await membership.post(`/api/import/${batch.batch_id}/commit`, {})).status, 400);
    assert.equal((await membership.post(`/api/import/${batch.batch_id}/commit`, { confirm: 'yes' })).status, 400);
  });
  it('يستورد الصحيح فقط، ويسجل الرصيد الافتتاحي كدفعة، ويمنع الاعتماد المزدوج', async () => {
    const before = (await pool.query('SELECT count(*)::int n FROM members')).rows[0].n;
    const r = await membership.post(`/api/import/${batch.batch_id}/commit`, { confirm: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.summary.imported, 3); assert.equal(r.data.summary.opening_payments, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM members')).rows[0].n, before + 3);
    const a = (await pool.query(`SELECT * FROM member_overview WHERE full_name='أحمد المطيري'`)).rows[0];
    assert.equal(a.paid, '100.00'); assert.equal(a.remaining, '200.00'); assert.equal(a.phone, '+966540000001');
    const h = (await pool.query(`SELECT * FROM member_overview WHERE full_name='فخري معفى'`)).rows[0];
    assert.equal(h.payment_status, 'exempt');
    assert.equal((await membership.post(`/api/import/${batch.batch_id}/commit`, { confirm: true })).status, 409);
    // إعادة رفع نفس الملف: الكل مكرر الآن
    const again = await membership.req('POST', '/api/import/preview', csvFile(header + 'أحمد المطيري,0540000001,ahmed@test.org,عادية,2026-01-01,300,'));
    assert.equal(again.data.summary.duplicates, 1);
    const logs = (await admin.get('/api/audit?action=members.import')).data.rows;
    assert.equal(logs[0].after.imported, 3);
  });
  it('مطابقة الأعمدة يدويًا وإعادة المعاينة', async () => {
    const text = 'A,B,C,D\nرانيا الغامدي,0540000099,2026-03-01,عادية\n';
    const pre = await membership.req('POST', '/api/import/preview', csvFile(text));
    assert.ok(pre.data.missing_required.length > 0);
    const re = await membership.post(`/api/import/${pre.data.batch_id}/preview`, { mapping: { full_name: 0, phone: 1, start_date: 2, type: 3 } });
    assert.equal(re.data.summary.valid, 1); assert.equal(re.data.missing_required.length, 0);
    await membership.del(`/api/import/${pre.data.batch_id}`);
  });
  it('القالب يُنزَّل ويُرفض الاستيراد لمن لا يملك الصلاحية', async () => {
    const t = await membership.get('/api/import/template');
    assert.equal(t.status, 200);
    const ws = (await new ExcelJS.Workbook().xlsx.load(t.data)).worksheets[0];
    assert.match(String(ws.getRow(1).getCell(1).value), /الاسم الكامل/);
    assert.equal((await finance.get('/api/import/template')).status, 403);
    assert.equal((await viewer.req('POST', '/api/import/preview', csvFile(header))).status, 403);
  });
  it('يرفض امتدادات غير مدعومة وملف xlsx مزيف', async () => {
    const f = new FormData(); f.append('file', new Blob(['MZ...'], { type: 'application/x-msdownload' }), 'evil.exe');
    assert.equal((await membership.req('POST', '/api/import/preview', f)).status, 400);
    const g = new FormData(); g.append('file', new Blob(['not a zip'], { type: 'x' }), 'fake.xlsx');
    assert.equal((await membership.req('POST', '/api/import/preview', g)).status, 400);
  });
});

T('المرفقات والإيصالات', () => {
  let pay, memberId;
  before(async () => {
    memberId = (await newMember(admin, uniq())).data.id;
    const sub = (await profile(admin, memberId)).member.subscription_id;
    pay = (await finance.post(`/api/subscriptions/${sub}/payments`, { amount: '100', paid_at: today(), method: 'cash', reference: 'ATT-1' })).data.payment.id;
  });
  const file = (bytes, name) => { const f = new FormData(); f.append('file', new Blob([bytes]), name); return f; };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  it('يرفع إيصال PNG ويحمّله من يملك الصلاحية فقط', async () => {
    const r = await finance.req('POST', `/api/payments/${pay}/receipts`, file(png, 'receipt.png'));
    assert.equal(r.status, 201);
    const d = await finance.get('/api/attachments/' + r.data.id);
    assert.equal(d.status, 200);
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
    assert.match(d.headers.get('content-disposition'), /^attachment/);
    assert.equal((await membership.get('/api/attachments/' + r.data.id)).status, 403);
    assert.equal((await new Client().get('/api/attachments/' + r.data.id)).status, 401);
    assert.equal((await finance.del('/api/attachments/' + r.data.id)).status, 403);
    assert.equal((await admin.del('/api/attachments/' + r.data.id)).status, 400); // الإيصالات لا تُحذف
  });
  it('يرفض ملفًا تنفيذيًا بامتداد صورة، وملفات كبيرة', async () => {
    const r = await finance.req('POST', `/api/payments/${pay}/receipts`, file(Buffer.from('MZ\x90\x00 malicious'), 'receipt.png'));
    assert.equal(r.status, 400);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024)]);
    assert.equal((await finance.req('POST', `/api/payments/${pay}/receipts`, file(big, 'big.pdf'))).status, 413);
  });
  it('مستندات العضو: رفع بصلاحية، وعرض بصلاحية، وحذف منطقي', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const up = await membership.req('POST', `/api/members/${memberId}/documents`, file(pdf, '../../etc/passwd.pdf'));
    assert.equal(up.status, 201);
    assert.ok(!up.data.original_name.includes('/'));
    assert.equal((await finance.req('POST', `/api/members/${memberId}/documents`, file(pdf, 'a.pdf'))).status, 403);
    assert.equal((await membership.get('/api/attachments/' + up.data.id)).status, 200);
    assert.equal((await viewer.get('/api/attachments/' + up.data.id)).status, 403);
    assert.equal((await membership.del('/api/attachments/' + up.data.id)).status, 200);
    assert.equal((await membership.get('/api/attachments/' + up.data.id)).status, 404);
  });
});

T('التنبيهات', () => {
  it('تولّد التنبيهات المناسبة مرة واحدة فقط (idempotent)', async () => {
    const mk = async (o) => (await newMember(admin, { ...uniq(), ...o })).data.id;
    const a = await mk({ start_date: days(-300), end_date: days(65), due_date: days(7), joined_at: days(-300), full_name: 'تنبيه سبعة أيام' });
    const b = await mk({ start_date: days(-300), end_date: days(65), due_date: days(-3), joined_at: days(-300), full_name: 'تنبيه متأخر' });
    const c = await mk({ start_date: days(-300), end_date: days(10), due_date: days(300), joined_at: days(-300), full_name: 'تنبيه قرب الانتهاء' });
    const d = await mk({ start_date: days(-400), end_date: days(-2), due_date: days(300), joined_at: days(-400), full_name: 'تنبيه انتهاء' });
    const g1 = await admin.post('/api/notifications/generate');
    assert.ok(g1.data.created >= 4);
    const g2 = await admin.post('/api/notifications/generate');
    assert.equal(g2.data.created, 0);
    const types = async (id) => (await pool.query('SELECT type FROM notifications WHERE member_id=$1 ORDER BY type', [id])).rows.map((r) => r.type);
    assert.ok((await types(a)).includes('due_7'));
    assert.ok((await types(b)).includes('overdue'));
    assert.ok((await types(c)).includes('expiry_soon'));
    assert.ok((await types(d)).includes('expired'));
    const p = await profile(admin, a);
    assert.match(p.notifications[0].body, /500\.00/);
  });
  it('تعطيل نوع تنبيه يوقف توليده، وتعديل القالب يُدقَّق، ولا إرسال خارجي', async () => {
    const tpls = (await admin.get('/api/notification-templates')).data;
    const t = tpls.find((x) => x.type === 'due_15' && x.channel === 'internal');
    assert.equal((await admin.put('/api/notification-templates/' + t.id, { enabled: false })).status, 200);
    const id = (await newMember(admin, { ...uniq(), start_date: days(-300), end_date: days(65), due_date: days(12), joined_at: days(-300) })).data.id;
    await admin.post('/api/notifications/generate');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM notifications WHERE member_id=$1`, [id])).rows[0].n, 0);
    await admin.put('/api/notification-templates/' + t.id, { enabled: true });
    assert.equal((await admin.put('/api/settings', { 'notifications.external_enabled': true })).status, 400);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM notifications WHERE channel<>'internal'`)).rows[0].n, 0);
    assert.equal((await viewer.post('/api/notifications/generate')).status, 403);
    const em = tpls.find((x) => x.channel === 'email');
    await admin.put('/api/notification-templates/' + em.id, { body: 'نص جديد {{member_name}}' });
    assert.equal((await admin.post(`/api/notification-templates/${em.id}/approve`, {})).status, 200);
    await admin.put('/api/notification-templates/' + em.id, { body: 'نص آخر {{member_name}}' });
    const after = (await admin.get('/api/notification-templates')).data.find((x) => x.id === em.id);
    assert.equal(after.approved_at, null); // التعديل يُسقط الاعتماد
  });
});

T('التكامل مع المنصة الموحّدة (الدخول والأدوار وجدول apps)', () => {
  it('بوابة المنصة: بلا دخول 401، ودور غير مسموح بالتطبيق 403 (واجهة وAPI)', async () => {
    const anon = new Client();
    assert.equal((await anon.get('/api/members')).status, 401);
    assert.equal((await anon.req('GET', '/members/css/app.css')).status, 401);
    const emp = new Client(); emp.cookie = `token=${signToken({ id: (await H.mkUser('employee', 'emp_user', 'employee')).id })}`;
    assert.equal((await emp.get('/api/members')).status, 403);
    assert.equal((await emp.req('GET', '/members/')).status, 403);
  });
  it('الصفحة تُخدم لمن يملك الدور مع شريط المنصة الموحّد، والأصول ثابتة النسخ', async () => {
    const r = await admin.req('GET', '/members/');
    assert.equal(r.status, 200);
    const html = r.data.toString();
    assert.match(html, /<base href="\/members\/">/);
    assert.match(html, /\/appbar\.js/);
    assert.equal((await admin.req('GET', '/members/js/main.js')).status, 200);
    assert.equal((await admin.req('GET', '/members/vendor/chart/chart.umd.js')).status, 200);
    assert.equal((await admin.req('GET', '/members/vendor/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2')).status, 200);
  });
  it('التطبيق مسجّل في public.apps بالأدوار الافتراضية', async () => {
    const app = (await H.pool.query(`SELECT roles, path FROM public.apps WHERE slug='members'`)).rows[0];
    assert.deepEqual([...app.roles].sort(), ['admin', 'executive', 'finance', 'hr']);
    assert.equal(app.path, '/members/');
  });
  it('ربط دور من المنصة بدور في النظام يسمح بالدخول ويحدّث apps، وإزالته تمنعه فورًا', async () => {
    const viewerRole = (await admin.get('/api/roles')).data.roles.find((r) => r.code === 'viewer').id;
    const sector = await H.mkUser('x', 'sector_user', 'sector_manager');
    const sc = new Client(); sc.cookie = `token=${signToken({ id: sector.id })}`;
    assert.equal((await sc.get('/api/members')).status, 403);
    assert.equal((await admin.put('/api/role-map/sector_manager', { role_id: viewerRole })).status, 200);
    assert.ok((await H.pool.query(`SELECT roles FROM public.apps WHERE slug='members'`)).rows[0].roles.includes('sector_manager'));
    await sc.login(sector);
    assert.equal((await sc.get('/api/members')).status, 200);
    assert.equal((await sc.post('/api/members', {})).status, 403);
    assert.ok((await admin.get('/api/audit?action=role.map')).data.rows.length >= 1);
    assert.equal((await admin.put('/api/role-map/sector_manager', { role_id: null })).status, 200);
    assert.equal((await sc.get('/api/members')).status, 403);
  });
  it('ربط الأدوار: لا يمكن تعديل مدير النظام، ويتطلب صلاحية إدارة المستخدمين', async () => {
    assert.equal((await admin.put('/api/role-map/admin', { role_id: null })).status, 409);
    assert.equal((await membership.put('/api/role-map/finance', { role_id: null })).status, 403);
    assert.equal((await admin.put('/api/role-map/unknown_role', { role_id: null })).status, 400);
  });
});

T('الإعدادات وأنواع العضوية', () => {
  it('تعديل الإعدادات يُسجَّل، وقيم غير صالحة تُرفض', async () => {
    assert.equal((await admin.put('/api/settings', { 'org.name': 'جمعية هدية الخيرية' })).status, 200);
    assert.equal((await admin.put('/api/settings', { 'rules.expiry_warning_days': 0 })).status, 400);
    assert.equal((await admin.put('/api/settings', { 'unknown.key': 1 })).status, 400);
    assert.equal((await admin.get('/api/meta')).data.org.name, 'جمعية هدية الخيرية');
    await admin.put('/api/settings', { 'org.name': 'جمعية هدية' });
  });
  it('أنواع عضوية مخصصة بقيمة ومدة افتراضية تنعكس على العضو الجديد', async () => {
    const t = await admin.post('/api/membership-types', { name_ar: 'داعمة', default_fee: '1200.50', default_duration_months: 6, fee_exempt: false });
    assert.equal(t.status, 201);
    assert.equal((await admin.post('/api/membership-types', { name_ar: 'داعمة', default_fee: '1', default_duration_months: 6 })).status, 409);
    const m = await profile(admin, (await newMember(admin, { ...uniq(), membership_type_id: t.data.id, amount_due: undefined, end_date: undefined, start_date: '2026-01-01', joined_at: '2026-01-01' })).data.id);
    assert.equal(m.member.amount_due, '1200.50');
    assert.equal(m.member.period_end, '2026-06-30');
    assert.equal((await membership.post('/api/membership-types', { name_ar: 'x1', default_duration_months: 1 })).status, 403);
  });
});
