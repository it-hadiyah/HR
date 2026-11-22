'use strict';
const { pool } = require('../db/pool');
const members = require('./members');
const L = require('../lib/labels');
const N = require('../lib/normalize');
const { bad } = require('../lib/errors');

const col = (key, label, type = 'text', width) => ({ key, label, type, width });
const MEMBER_COLS = [
  col('member_no', 'رقم العضوية', 'text', 14), col('full_name', 'الاسم الكامل', 'text', 28), col('phone', 'الجوال', 'phone', 16),
  col('type_name', 'نوع العضوية', 'text', 14), col('period_start', 'بداية العضوية', 'date', 14), col('period_end', 'نهاية العضوية', 'date', 14),
  col('membership_status', 'حالة العضوية', 'membership_status', 16),
];
const FIN_COLS = [
  col('amount_due', 'المستحق', 'money', 14), col('paid', 'المسدد', 'money', 14), col('remaining', 'المتبقي', 'money', 14),
  col('due_date', 'تاريخ الاستحقاق', 'date', 15), col('payment_status', 'حالة السداد', 'payment_status', 16),
];
const money = (rows, k) => rows.reduce((a, r) => a + N.cents(r[k] ?? '0'), 0n);

const DEFS = {
  all_members: { title: 'تقرير جميع أعضاء الجمعية العمومية', financial: false, dateLabel: 'تاريخ الانضمام', dateField: 'joined', cols: [...MEMBER_COLS, col('email', 'البريد', 'text', 24)], base: {} },
  active_members: { title: 'تقرير العضويات السارية', financial: false, dateLabel: 'تاريخ نهاية العضوية', dateField: 'end', cols: MEMBER_COLS, base: { membership_status: 'active,near_expiry' } },
  expired_members: { title: 'تقرير العضويات المنتهية', financial: false, dateLabel: 'تاريخ نهاية العضوية', dateField: 'end', cols: MEMBER_COLS, base: { membership_status: 'expired' } },
  near_expiry_members: { title: 'تقرير العضويات القريبة من الانتهاء', financial: false, dateLabel: 'تاريخ نهاية العضوية', dateField: 'end', cols: [...MEMBER_COLS, col('days_to_expiry', 'الأيام المتبقية', 'int', 12)], base: { membership_status: 'near_expiry' } },
  unpaid_members: { title: 'تقرير الأعضاء غير المسددين', financial: true, dateLabel: 'تاريخ الاستحقاق', dateField: 'due', cols: [...MEMBER_COLS.slice(0, 4), ...FIN_COLS], base: { payment_status: 'unpaid,overdue,not_yet_due' }, extra: (o) => Number(o.total_paid) === 0 && Number(o.total_remaining) > 0 },
  partial_members: { title: 'تقرير الاشتراكات المسددة جزئيًا', financial: true, dateLabel: 'تاريخ الاستحقاق', dateField: 'due', cols: [...MEMBER_COLS.slice(0, 4), ...FIN_COLS], base: { partial: '1' } },
  remaining_dues: { title: 'تقرير المستحقات المالية المتبقية', financial: true, dateLabel: 'تاريخ الاستحقاق', dateField: 'due', cols: [...MEMBER_COLS.slice(0, 4), col('total_due', 'إجمالي المستحق', 'money', 15), col('total_paid', 'إجمالي المسدد', 'money', 15), col('total_remaining', 'إجمالي المتبقي', 'money', 15), col('payment_status', 'حالة السداد', 'payment_status', 16)], base: { has_balance: '1' } },
};
const SPECIAL = {
  collections: { title: 'تقرير التحصيل المالي خلال فترة', financial: true, dateLabel: 'تاريخ السداد' },
  renewals: { title: 'تقرير عمليات تجديد العضويات', financial: false, dateLabel: 'تاريخ التجديد' },
};
const catalog = () => [
  ...Object.entries(DEFS).map(([id, d]) => ({ id, title: d.title, financial: d.financial, dateLabel: d.dateLabel, statusFilter: !d.base.membership_status && !d.base.payment_status })),
  ...Object.entries(SPECIAL).map(([id, d]) => ({ id, title: d.title, financial: d.financial, dateLabel: d.dateLabel, statusFilter: false })),
];

function dateFilter(field, from, to) {
  const o = {};
  const [a, b] = { joined: ['joined_from', 'joined_to'], end: ['end_from', 'end_to'], due: ['due_from', 'due_to'] }[field];
  if (from) o[a] = from; if (to) o[b] = to;
  return o;
}

async function run(id, q = {}) {
  const from = q.from ? N.normalizeDate(q.from) : null, to = q.to ? N.normalizeDate(q.to) : null;
  const filters = { from, to, type_id: q.type_id || null, membership_status: q.membership_status || null, payment_status: q.payment_status || null };
  let result;
  if (DEFS[id]) {
    const d = DEFS[id];
    const f = { ...d.base, ...dateFilter(d.dateField, from, to), archived: '0' };
    if (q.type_id) f.type_id = q.type_id;
    if (!d.base.membership_status && q.membership_status) f.membership_status = q.membership_status;
    if (!d.base.payment_status && !d.base.partial && q.payment_status) f.payment_status = q.payment_status;
    let rows = await members.listAll({ ...f, sort: 'member_no' });
    if (d.extra) rows = rows.filter(d.extra);
    const totals = {};
    for (const c of d.cols) if (c.type === 'money') totals[c.key] = N.fromCents(money(rows, c.key));
    result = { id, title: d.title, columns: d.cols, rows, totals, count: rows.length, financial: d.financial };
  } else if (id === 'collections') {
    const p = [], w = ["p.status='confirmed'"];
    if (from) { p.push(from); w.push(`p.paid_at >= $${p.length}`); }
    if (to) { p.push(to); w.push(`p.paid_at <= $${p.length}`); }
    if (q.type_id) { p.push(Number(q.type_id)); w.push(`mp.membership_type_id = $${p.length}`); }
    const rows = (await pool.query(
      `SELECT p.paid_at, m.member_no, m.full_name, mt.name_ar AS type_name, p.amount, p.method, p.reference
       FROM payments p JOIN members m ON m.id=p.member_id JOIN subscriptions s ON s.id=p.subscription_id
       JOIN membership_periods mp ON mp.id=s.period_id JOIN membership_types mt ON mt.id=mp.membership_type_id
       WHERE ${w.join(' AND ')} ORDER BY p.paid_at, p.id LIMIT 50000`, p)).rows;
    const cols = [col('paid_at', 'تاريخ السداد', 'date', 14), col('member_no', 'رقم العضوية', 'text', 14), col('full_name', 'الاسم الكامل', 'text', 28),
      col('type_name', 'نوع العضوية', 'text', 14), col('amount', 'المبلغ', 'money', 14), col('method', 'طريقة السداد', 'payment_method', 16), col('reference', 'المرجع', 'text', 20)];
    result = { id, title: SPECIAL.collections.title, columns: cols, rows, totals: { amount: N.fromCents(money(rows, 'amount')) }, count: rows.length, financial: true };
  } else if (id === 'renewals') {
    const p = ["mp.kind='renewal'", "mp.status='active'"], params = [];
    if (from) { params.push(from); p.push(`(mp.created_at AT TIME ZONE 'Asia/Riyadh')::date >= $${params.length}`); }
    if (to) { params.push(to); p.push(`(mp.created_at AT TIME ZONE 'Asia/Riyadh')::date <= $${params.length}`); }
    if (q.type_id) { params.push(Number(q.type_id)); p.push(`mp.membership_type_id = $${params.length}`); }
    const rows = (await pool.query(
      `SELECT (mp.created_at AT TIME ZONE 'Asia/Riyadh')::date AS renewed_on, m.member_no, m.full_name, mt.name_ar AS type_name,
              mp.start_date, mp.end_date, sb.amount_due, sb.paid, sb.payment_status
       FROM membership_periods mp JOIN members m ON m.id=mp.member_id JOIN membership_types mt ON mt.id=mp.membership_type_id
       LEFT JOIN subscription_balances sb ON sb.period_id=mp.id WHERE ${p.join(' AND ')} ORDER BY mp.created_at, mp.id LIMIT 50000`, params)).rows;
    const cols = [col('renewed_on', 'تاريخ التجديد', 'date', 14), col('member_no', 'رقم العضوية', 'text', 14), col('full_name', 'الاسم الكامل', 'text', 28),
      col('type_name', 'نوع العضوية', 'text', 14), col('start_date', 'بداية الدورة', 'date', 14), col('end_date', 'نهاية الدورة', 'date', 14),
      col('amount_due', 'قيمة الاشتراك', 'money', 14), col('paid', 'المسدد', 'money', 14), col('payment_status', 'حالة السداد', 'payment_status', 16)];
    result = { id, title: SPECIAL.renewals.title, columns: cols, rows, totals: { amount_due: N.fromCents(money(rows, 'amount_due')), paid: N.fromCents(money(rows, 'paid')) }, count: rows.length, financial: false };
  } else throw bad('تقرير غير معروف');
  return { ...result, filters, generated_at: new Date().toISOString() };
}

/** قيمة خلية قابلة للعرض النصي (PDF) */
function cellText(c, v) {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.type) {
    case 'money': return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'membership_status': return L.membership_status[v] || v;
    case 'payment_status': return L.payment_status[v] || v;
    case 'payment_method': return L.payment_method[v] || v;
    default: return String(v);
  }
}
/** تصدير نتائج قائمة الأعضاء الحالية (بحسب المرشحات) بنفس قالب التقارير */
async function membersExport(filters, includeFinancial) {
  const rows = await members.listAll({ ...filters, sort: filters.sort || 'member_no', dir: filters.dir });
  const cols = [...MEMBER_COLS, col('email', 'البريد', 'text', 24), ...(includeFinancial ? [...FIN_COLS, col('total_remaining', 'إجمالي المتبقي', 'money', 15)] : [])];
  const totals = {};
  if (includeFinancial) for (const c of cols) if (c.type === 'money') totals[c.key] = N.fromCents(money(rows, c.key));
  return { id: 'members', title: 'قائمة الأعضاء', columns: cols, rows, totals, count: rows.length, financial: includeFinancial, filters: { from: null, to: null }, generated_at: new Date().toISOString() };
}
module.exports = { membersExport, catalog, run, cellText, DEFS, SPECIAL };
