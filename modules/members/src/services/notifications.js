'use strict';
// مركز التنبيهات الداخلي. يُولَّد دوريًا (idempotent عبر dedupe_key) ولا يُرسل أي رسالة خارجية.
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const settings = require('./settings');
const { bad, notFound } = require('../lib/errors');
const N = require('../lib/normalize');

const TYPES = {
  due_30: 'قبل الاستحقاق بـ30 يومًا', due_15: 'قبل الاستحقاق بـ15 يومًا', due_7: 'قبل الاستحقاق بـ7 أيام',
  due_today: 'يوم الاستحقاق', overdue: 'تجاوز موعد السداد', expiry_soon: 'قرب انتهاء العضوية', expired: 'انتهاء العضوية',
};
const PLACEHOLDERS = ['member_name', 'member_no', 'amount_remaining', 'due_date', 'end_date', 'org_name'];

function render(tpl, vars) {
  return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (PLACEHOLDERS.includes(k) ? (vars[k] ?? '') : m));
}

async function generate(ctx = null) {
  const all = await settings.getAll();
  const orgName = all['org.name'] || '';
  const tpls = Object.fromEntries((await pool.query(`SELECT type, body, enabled FROM notification_templates WHERE channel='internal'`)).rows.map((r) => [r.type, r]));
  const enabled = (t) => tpls[t]?.enabled;
  const warn = Number(all['rules.expiry_warning_days'] ?? 30);
  let created = 0;

  const insert = async (client, row, type, vars, key) => {
    const body = render(tpls[type].body, { ...vars, org_name: orgName });
    const r = await client.query(
      `INSERT INTO notifications (member_id, subscription_id, period_id, type, channel, title, body, dedupe_key)
       VALUES ($1,$2,$3,$4,'internal',$5,$6,$7) ON CONFLICT (dedupe_key, channel) DO NOTHING`,
      [row.member_id, row.subscription_id ?? null, row.period_id ?? null, type, TYPES[type], body, key]);
    created += r.rowCount;
  };

  await tx(async (c) => {
    // التنبيهات المالية: اشتراكات عليها متبقٍ لأعضاء غير مؤرشفين ولا ملغاة عضويتهم
    const subs = (await c.query(
      `SELECT sb.subscription_id, sb.period_id, sb.member_id, sb.remaining, sb.due_date, (sb.due_date - riyadh_today()) AS days,
              m.full_name, m.member_no
       FROM subscription_balances sb JOIN members m ON m.id=sb.member_id
       WHERE m.archived_at IS NULL AND m.admin_status <> 'cancelled' AND NOT sb.is_exempt AND sb.remaining > 0
         AND sb.due_date - riyadh_today() <= 30`)).rows;
    for (const s of subs) {
      const vars = { member_name: s.full_name, member_no: s.member_no, amount_remaining: s.remaining, due_date: s.due_date };
      let type = null;
      if (s.days < 0) type = 'overdue'; else if (s.days === 0) type = 'due_today';
      else if (s.days <= 7) type = 'due_7'; else if (s.days <= 15) type = 'due_15'; else type = 'due_30';
      if (enabled(type)) await insert(c, s, type, vars, `${type}:sub:${s.subscription_id}`);
    }
    // تنبيهات العضوية: على أحدث دورة للعضو
    const mem = (await c.query(
      `SELECT o.id AS member_id, o.period_id, o.full_name, o.member_no, o.period_end, o.days_to_expiry, o.membership_status
       FROM member_overview o WHERE o.archived_at IS NULL AND o.admin_status = 'normal' AND o.period_id IS NOT NULL`)).rows;
    for (const o of mem) {
      const vars = { member_name: o.full_name, member_no: o.member_no, end_date: o.period_end };
      if (o.membership_status === 'expired' && enabled('expired')) await insert(c, o, 'expired', vars, `expired:period:${o.period_id}`);
      else if (o.membership_status === 'near_expiry' && o.days_to_expiry >= 0 && o.days_to_expiry <= warn && enabled('expiry_soon')) {
        await insert(c, o, 'expiry_soon', vars, `expiry_soon:period:${o.period_id}`);
      }
    }
    if (ctx) await audit.log(c, ctx, { action: 'notifications.generate', entity: 'notification', entityId: 'batch', after: { created } });
  });
  return { created };
}

async function list(f = {}) {
  const w = ["n.channel='internal'"], p = [];
  if (f.status && f.status !== 'all') { p.push(f.status); w.push(`n.status=$${p.length}`); } else if (!f.status) w.push("n.status IN ('unread','read')");
  if (f.type) { p.push(f.type); w.push(`n.type=$${p.length}`); }
  if (f.member_id) { p.push(Number(f.member_id)); w.push(`n.member_id=$${p.length}`); }
  const pageSize = Math.min(Math.max(parseInt(f.pageSize, 10) || 25, 1), 100), page = Math.max(parseInt(f.page, 10) || 1, 1);
  const where = w.join(' AND ');
  const total = (await pool.query(`SELECT COUNT(*)::int n FROM notifications n WHERE ${where}`, p)).rows[0].n;
  const unread = (await pool.query(`SELECT COUNT(*)::int n FROM notifications WHERE channel='internal' AND status='unread'`)).rows[0].n;
  const rows = (await pool.query(
    `SELECT n.*, m.full_name, m.member_no FROM notifications n JOIN members m ON m.id=n.member_id WHERE ${where}
     ORDER BY n.created_at DESC, n.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p)).rows;
  return { rows, total, unread, page, pageSize };
}
async function unreadCount() { return (await pool.query(`SELECT COUNT(*)::int n FROM notifications WHERE channel='internal' AND status='unread'`)).rows[0].n; }

async function setStatus(ctx, ids, status) {
  if (!['read', 'dismissed', 'unread'].includes(status)) throw bad('حالة غير صالحة');
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  if (!list.length) throw bad('لم يتم تحديد تنبيهات');
  const r = await pool.query(
    `UPDATE notifications SET status=$2, read_at=CASE WHEN $2='unread' THEN NULL ELSE now() END, read_by=CASE WHEN $2='unread' THEN NULL ELSE $3::bigint END
     WHERE id = ANY($1) AND channel='internal'`, [list, status, ctx.user.id]);
  return { updated: r.rowCount };
}

async function listTemplates() {
  return (await pool.query('SELECT * FROM notification_templates ORDER BY channel, id')).rows;
}
async function updateTemplate(ctx, id, input) {
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM notification_templates WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('القالب غير موجود');
    const next = { ...cur };
    if ('body' in input) { const b = N.clean(input.body === undefined ? '' : String(input.body).replace(/\r/g, '').trim()); if (!b || b.length > 1000) throw bad('نص القالب مطلوب (حتى 1000 حرف)'); next.body = String(input.body).trim(); }
    if ('subject' in input) { const s = N.clean(input.subject); if (s && s.length > 200) throw bad('العنوان طويل'); next.subject = s; }
    if ('enabled' in input) next.enabled = input.enabled === true;
    const textChanged = next.body !== cur.body || next.subject !== cur.subject;
    // أي تعديل على النص يُسقط الاعتماد والاختبار
    const approved_at = textChanged ? null : cur.approved_at, tested_at = textChanged ? null : cur.tested_at;
    if ('approved' in input) {
      if (input.approved && cur.channel === 'internal') throw bad('الاعتماد للقوالب الخارجية فقط');
    }
    await c.query(`UPDATE notification_templates SET body=$2, subject=$3, enabled=$4, approved_at=$5, tested_at=$6, updated_by=$7, updated_at=now() WHERE id=$1`,
      [id, next.body, next.subject, next.enabled, approved_at, tested_at, ctx.user.id]);
    await audit.log(c, ctx, { action: 'template.update', entity: 'template', entityId: id,
      before: { type: cur.type, channel: cur.channel, body: cur.body, subject: cur.subject, enabled: cur.enabled },
      after: { body: next.body, subject: next.subject, enabled: next.enabled } });
    return id;
  });
}

async function approveTemplate(ctx, id, approved) {
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM notification_templates WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('القالب غير موجود');
    if (cur.channel === 'internal') throw bad('الاعتماد للقوالب الخارجية (بريد/رسائل) فقط');
    await c.query('UPDATE notification_templates SET approved_at=$2, updated_by=$3, updated_at=now() WHERE id=$1', [id, approved ? new Date() : null, ctx.user.id]);
    await audit.log(c, ctx, { action: approved ? 'template.approve' : 'template.unapprove', entity: 'template', entityId: id, after: { type: cur.type, channel: cur.channel } });
  });
}

module.exports = { approveTemplate, TYPES, PLACEHOLDERS, render, generate, list, unreadCount, setStatus, listTemplates, updateTemplate };
