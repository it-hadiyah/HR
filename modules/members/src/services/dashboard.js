'use strict';
const { pool } = require('../db/pool');
const N = require('../lib/normalize');

/** كل المؤشرات من قاعدة البيانات. الأعضاء المؤرشفون مستثنون من المؤشرات التشغيلية. */
async function summary({ from, to } = {}) {
  const today = N.todayRiyadh();
  const f = from ? N.normalizeDate(from) : N.addDaysISO(today, -29);
  const t = to ? N.normalizeDate(to) : today;
  const k = (await pool.query(
    `SELECT
       COUNT(*)::int AS total_members,
       COUNT(*) FILTER (WHERE membership_status IN ('active','near_expiry'))::int AS valid_members,
       COUNT(*) FILTER (WHERE membership_status = 'near_expiry')::int AS near_expiry,
       COUNT(*) FILTER (WHERE membership_status = 'expired')::int AS expired,
       COUNT(*) FILTER (WHERE membership_status = 'suspended')::int AS suspended,
       COUNT(*) FILTER (WHERE membership_status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE membership_status = 'cancelled')::int AS cancelled,
       COALESCE(SUM(total_due),0) AS total_due,
       COALESCE(SUM(total_paid),0) AS total_collected,
       COALESCE(SUM(total_remaining),0) AS total_remaining,
       COUNT(*) FILTER (WHERE any_overdue)::int AS overdue_members,
       COUNT(*) FILTER (WHERE joined_at BETWEEN $1 AND $2)::int AS new_members
     FROM member_overview WHERE archived_at IS NULL`, [f, t])).rows[0];
  const od = (await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(sb.remaining),0) AS amount FROM subscription_balances sb
     JOIN members m ON m.id = sb.member_id AND m.archived_at IS NULL WHERE sb.payment_status='overdue'`)).rows[0];
  const renewed = (await pool.query(
    `SELECT COUNT(DISTINCT mp.member_id)::int AS n FROM membership_periods mp JOIN members m ON m.id=mp.member_id AND m.archived_at IS NULL
     WHERE mp.kind='renewal' AND mp.status='active' AND (mp.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2`, [f, t])).rows[0];
  const collections = (await pool.query(
    `SELECT to_char(date_trunc('month', gs), 'YYYY-MM') AS month, COALESCE(SUM(p.amount),0) AS amount
     FROM generate_series(date_trunc('month', $1::date) - interval '11 months', date_trunc('month', $1::date), interval '1 month') gs
     LEFT JOIN payments p ON p.status='confirmed' AND date_trunc('month', p.paid_at) = gs
     GROUP BY gs ORDER BY gs`, [today])).rows;
  const byType = (await pool.query(
    `SELECT COALESCE(type_name,'بدون نوع') AS name, membership_type_id AS type_id, COUNT(*)::int AS count
     FROM member_overview WHERE archived_at IS NULL GROUP BY 1,2 ORDER BY count DESC`)).rows;
  const expiring = (await pool.query(
    `SELECT to_char(date_trunc('month', gs), 'YYYY-MM') AS month, date_trunc('month', gs)::date AS first_day,
            (date_trunc('month', gs) + interval '1 month - 1 day')::date AS last_day,
            COUNT(o.id)::int AS count
     FROM generate_series(date_trunc('month', $1::date), date_trunc('month', $1::date) + interval '5 months', interval '1 month') gs
     LEFT JOIN member_overview o ON o.archived_at IS NULL AND o.membership_status IN ('active','near_expiry')
       AND date_trunc('month', o.period_end) = gs
     GROUP BY gs ORDER BY gs`, [today])).rows;
  return {
    range: { from: f, to: t }, today,
    kpis: { ...k, overdue_subscriptions: od.n, overdue_amount: od.amount, renewed_members: renewed.n },
    charts: { collections, by_type: byType, expiring },
  };
}
module.exports = { summary };
