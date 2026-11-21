'use strict';
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const { bad, notFound, conflict } = require('../lib/errors');
const N = require('../lib/normalize');

const METHODS = { cash: 'نقدًا', bank_transfer: 'حوالة بنكية', card: 'شبكة / بطاقة', cheque: 'شيك', other: 'أخرى', opening_balance: 'رصيد افتتاحي (استيراد)' };
const USER_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
const FIELDS = ['amount', 'paid_at', 'method', 'reference', 'notes'];

function parse(input, { partial = false } = {}) {
  const out = {}, errs = {};
  const set = (k, fn) => { if (partial && !(k in input)) return; try { out[k] = fn(input[k]); } catch (e) { errs[k] = e.message; } };
  set('amount', (v) => { const m = N.normalizeMoney(v, { allowZero: false }); if (!m) throw new Error('المبلغ مطلوب'); return m; });
  set('paid_at', (v) => {
    const d = N.normalizeDate(v); if (!d) throw new Error('تاريخ السداد مطلوب');
    if (d > N.todayRiyadh()) throw new Error('لا يمكن تسجيل سداد بتاريخ مستقبلي');
    return d;
  });
  set('method', (v) => { if (!USER_METHODS.includes(v)) throw new Error('طريقة السداد غير صالحة'); return v; });
  set('reference', (v) => { const s = N.clean(v); if (s && s.length > 80) throw new Error('رقم المرجع طويل'); return s; });
  set('notes', (v) => { const s = N.clean(v); if (s && s.length > 1000) throw new Error('الملاحظات طويلة'); return s; });
  if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
  return out;
}

async function lockSub(c, id) {
  const r = await c.query(
    `SELECT s.*, mp.status AS period_status FROM subscriptions s JOIN membership_periods mp ON mp.id=s.period_id WHERE s.id=$1 FOR UPDATE OF s`, [id]);
  if (!r.rows[0]) throw notFound('الاشتراك غير موجود');
  return r.rows[0];
}
const paidSum = async (c, subId, excludePaymentId = 0) =>
  (await c.query(`SELECT COALESCE(SUM(amount),0) AS p FROM payments WHERE subscription_id=$1 AND status='confirmed' AND id<>$2`, [subId, excludePaymentId])).rows[0].p;

function mapUnique(e) {
  if (e.code === '23505' && /payments_reference_uq/.test(e.constraint || e.message)) {
    return conflict('رقم المرجع/الإيصال مسجّل مسبقًا لعملية سداد أخرى', 'duplicate_reference', { reference: 'مكرر' });
  }
  return e;
}

/** تسجيل سداد: يُعدّ ناجحًا فقط بعد اكتمال المعاملة (COMMIT) */
async function create(ctx, subscriptionId, input) {
  const f = parse(input);
  const idem = N.clean(input.idempotency_key);
  if (idem && idem.length > 100) throw bad('مفتاح التكرار غير صالح');
  try {
    return await tx(async (c) => {
      const sub = await lockSub(c, subscriptionId);
      if (idem) {
        const ex = (await c.query('SELECT * FROM payments WHERE idempotency_key=$1', [idem])).rows[0];
        if (ex) {
          if (ex.subscription_id !== sub.id) throw conflict('مفتاح التكرار مستخدم لاشتراك آخر', 'idempotency_mismatch');
          return { payment: ex, replayed: true };
        }
      }
      if (sub.period_status !== 'active') throw conflict('دورة العضوية ملغاة', 'period_cancelled');
      if (sub.is_exempt) throw conflict('الاشتراك معفى من الرسوم ولا تُسجَّل عليه مدفوعات', 'exempt');
      const paid = await paidSum(c, sub.id);
      const remaining = N.cents(sub.amount_due) - N.cents(paid);
      if (N.cents(f.amount) > remaining) {
        throw bad(`المبلغ يتجاوز المتبقي (${N.fromCents(remaining > 0n ? remaining : 0n)} ريال)`, { amount: 'يتجاوز المتبقي' }, 'overpayment');
      }
      if (!f.reference && input.confirm_duplicate !== true) {
        const dup = (await c.query(
          `SELECT id FROM payments WHERE subscription_id=$1 AND status='confirmed' AND amount=$2 AND paid_at=$3 AND method=$4 LIMIT 1`,
          [sub.id, f.amount, f.paid_at, f.method])).rows[0];
        if (dup) throw conflict('توجد عملية سداد مطابقة (المبلغ والتاريخ والطريقة). أكّد إن كانت عملية مختلفة', 'possible_duplicate');
      }
      const r = await c.query(
        `INSERT INTO payments (subscription_id, member_id, amount, paid_at, method, reference, notes, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [sub.id, sub.member_id, f.amount, f.paid_at, f.method, f.reference, f.notes, idem, ctx.user.id]);
      const payment = r.rows[0];
      await audit.log(c, ctx, { action: 'payment.create', entity: 'payment', entityId: payment.id,
        after: { member_id: sub.member_id, subscription_id: sub.id, ...N_pick(payment) } });
      return { payment, replayed: false };
    });
  } catch (e) { throw mapUnique(e); }
}
const N_pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p[k]]));

async function lockPayment(c, id) {
  const r = await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id]);
  if (!r.rows[0]) throw notFound('عملية السداد غير موجودة');
  return r.rows[0];
}

/** تعديل عملية سداد: يتطلب سببًا ويُسجَّل في التدقيق بالقيم قبل/بعد */
async function update(ctx, id, input) {
  const reason = N.clean(input.reason);
  if (!reason) throw bad('سبب التعديل مطلوب', { reason: 'مطلوب' });
  const f = parse(input, { partial: true });
  try {
    return await tx(async (c) => {
      const cur = await lockPayment(c, id);
      if (cur.status !== 'confirmed') throw conflict('لا يمكن تعديل عملية ملغاة', 'voided');
      if (cur.method === 'opening_balance') throw conflict('لا يمكن تعديل رصيد افتتاحي مستورد؛ ألغِه وسجّل بدلًا منه', 'opening_balance');
      const sub = await lockSub(c, cur.subscription_id);
      if ('amount' in f) {
        const others = await paidSum(c, sub.id, id);
        if (N.cents(others) + N.cents(f.amount) > N.cents(sub.amount_due)) throw bad('المبلغ يتجاوز قيمة الاشتراك', { amount: 'يتجاوز المتبقي' }, 'overpayment');
      }
      const keys = Object.keys(f);
      if (!keys.length) return cur;
      let r;
      r = await c.query(`UPDATE payments SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1 RETURNING *`, [id, ...keys.map((k) => f[k])]);
      const d = audit.diff(N_pick(cur), N_pick(r.rows[0]));
      await audit.log(c, ctx, { action: 'payment.update', entity: 'payment', entityId: id,
        before: { member_id: cur.member_id, ...d.before }, after: { ...d.after, reason } });
      return r.rows[0];
    });
  } catch (e) { throw mapUnique(e); }
}

async function voidPayment(ctx, id, reason) {
  const why = N.clean(reason);
  if (!why) throw bad('سبب الإلغاء مطلوب', { reason: 'مطلوب' });
  return tx(async (c) => {
    const cur = await lockPayment(c, id);
    if (cur.status === 'voided') throw conflict('العملية ملغاة مسبقًا', 'voided');
    await lockSub(c, cur.subscription_id);
    const r = await c.query(`UPDATE payments SET status='voided', voided_at=now(), voided_by=$2, void_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`, [id, ctx.user.id, why]);
    await audit.log(c, ctx, { action: 'payment.void', entity: 'payment', entityId: id,
      before: { member_id: cur.member_id, status: 'confirmed', amount: cur.amount }, after: { status: 'voided', reason: why } });
    return r.rows[0];
  });
}

async function list(f = {}) {
  const w = ['1=1'], p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (f.member_id) add('p.member_id = ?', Number(f.member_id));
  if (f.from) add('p.paid_at >= ?', N.normalizeDate(f.from));
  if (f.to) add('p.paid_at <= ?', N.normalizeDate(f.to));
  if (f.method) add('p.method = ?', String(f.method));
  if (f.status) add('p.status = ?', String(f.status)); else w.push("p.status='confirmed'");
  if (f.q) { const like = `%${String(f.q).slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`; p.push(like); w.push(`(m.full_name ILIKE $${p.length} OR m.member_no ILIKE $${p.length} OR p.reference ILIKE $${p.length})`); }
  const pageSize = Math.min(Math.max(parseInt(f.pageSize, 10) || 25, 1), 200), page = Math.max(parseInt(f.page, 10) || 1, 1);
  const where = w.join(' AND ');
  const total = (await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(p.amount) FILTER (WHERE p.status='confirmed'),0) AS sum FROM payments p JOIN members m ON m.id=p.member_id WHERE ${where}`, p)).rows[0];
  const rows = (await pool.query(
    `SELECT p.*, m.full_name, m.member_no, (SELECT COUNT(*)::int FROM payment_attachments a WHERE a.payment_id=p.id AND a.deleted_at IS NULL) AS attachments_count
     FROM payments p JOIN members m ON m.id=p.member_id WHERE ${where}
     ORDER BY p.paid_at DESC, p.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p)).rows;
  return { rows, total: total.n, sum: total.sum, page, pageSize };
}

async function listSubscriptions(f = {}) {
  const w = ['m.archived_at IS NULL'], p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (f.payment_status) { p.push(String(f.payment_status).split(',')); w.push(`sb.payment_status = ANY($${p.length})`); }
  if (f.due_from) add('sb.due_date >= ?', N.normalizeDate(f.due_from));
  if (f.due_to) add('sb.due_date <= ?', N.normalizeDate(f.due_to));
  if (f.q) { const like = `%${String(f.q).slice(0, 80).replace(/[\\%_]/g, '\\$&')}%`; p.push(like); w.push(`(m.full_name ILIKE $${p.length} OR m.member_no ILIKE $${p.length})`); }
  const pageSize = Math.min(Math.max(parseInt(f.pageSize, 10) || 25, 1), 200), page = Math.max(parseInt(f.page, 10) || 1, 1);
  const where = w.join(' AND ');
  const from = `FROM subscription_balances sb JOIN members m ON m.id=sb.member_id JOIN membership_periods mp ON mp.id=sb.period_id`;
  const tot = (await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(sb.amount_due) FILTER (WHERE NOT sb.is_exempt),0) due, COALESCE(SUM(sb.paid),0) paid, COALESCE(SUM(sb.remaining),0) remaining ${from} WHERE ${where}`, p)).rows[0];
  const rows = (await pool.query(
    `SELECT sb.*, m.full_name, m.member_no, mp.start_date, mp.end_date ${from} WHERE ${where}
     ORDER BY sb.due_date DESC, sb.subscription_id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p)).rows;
  return { rows, total: tot.n, totals: { due: tot.due, paid: tot.paid, remaining: tot.remaining }, page, pageSize };
}

module.exports = { METHODS, USER_METHODS, create, update, voidPayment, list, listSubscriptions, lockSub, paidSum };
