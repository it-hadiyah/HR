'use strict';
const { z } = require('zod');
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const settings = require('./settings');
const { bad, notFound, conflict, forbidden } = require('../lib/errors');
const N = require('../lib/normalize');

const MEMBER_FIELDS = ['full_name', 'phone', 'email', 'joined_at', 'notes'];

// ───── البحث والتصفية (مشتركة بين القائمة والتقارير والتصدير) ─────
const SORTS = {
  member_no: 'member_no', full_name: 'full_name', phone: 'phone', email: 'email', type_name: 'type_name',
  period_start: 'period_start', period_end: 'period_end', amount_due: 'amount_due', due_date: 'due_date',
  paid: 'paid', remaining: 'remaining', membership_status: 'membership_status', payment_status: 'payment_status',
  joined_at: 'joined_at', total_remaining: 'total_remaining', last_paid_at: 'last_paid_at',
};
const csv = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => s.trim()).filter(Boolean);

function buildFilter(f = {}) {
  const w = [], p = [];
  const add = (sql, ...vals) => { let s = sql; for (const v of vals) { p.push(v); s = s.replace('?', `$${p.length}`); } w.push(s); };
  if (f.archived === '1' || f.archived === true) w.push('o.archived_at IS NOT NULL');
  else if (f.archived !== 'all') w.push('o.archived_at IS NULL');
  if (f.q) {
    const q = String(f.q).trim().slice(0, 100);
    const digits = N.latinDigits(q).replace(/\D/g, '');
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const parts = ['o.full_name ILIKE ?', 'o.member_no ILIKE ?', 'o.email ILIKE ?'];
    const vals = [like, like, like];
    if (digits.length >= 3) { parts.push("regexp_replace(COALESCE(o.phone,''),'\\D','','g') LIKE ?"); vals.push(`%${digits.replace(/^0/, '')}%`); }
    add(`(${parts.join(' OR ')})`, ...vals);
  }
  const ms = csv(f.membership_status); if (ms.length) add('o.membership_status = ANY(?)', ms);
  const ps = csv(f.payment_status); if (ps.length) add('o.payment_status = ANY(?)', ps);
  if (f.partial === '1') w.push('(o.total_paid > 0 AND o.total_remaining > 0)');
  if (f.type_id) add('o.membership_type_id = ?', Number(f.type_id));
  if (f.has_balance === '1') w.push('o.total_remaining > 0');
  if (f.joined_from) add('o.joined_at >= ?', N.normalizeDate(f.joined_from));
  if (f.joined_to) add('o.joined_at <= ?', N.normalizeDate(f.joined_to));
  if (f.end_from) add('o.period_end >= ?', N.normalizeDate(f.end_from));
  if (f.end_to) add('o.period_end <= ?', N.normalizeDate(f.end_to));
  if (f.due_from) add('o.due_date >= ?', N.normalizeDate(f.due_from));
  if (f.due_to) add('o.due_date <= ?', N.normalizeDate(f.due_to));
  if (f.renewed_from || f.renewed_to) {
    const from = f.renewed_from ? N.normalizeDate(f.renewed_from) : '1900-01-01';
    const to = f.renewed_to ? N.normalizeDate(f.renewed_to) : '2200-01-01';
    add(`EXISTS (SELECT 1 FROM membership_periods r WHERE r.member_id=o.id AND r.kind='renewal' AND r.status='active'
                 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ? AND ?)`, from, to);
  }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

async function list(f = {}) {
  const { where, params } = buildFilter(f);
  const sortCol = SORTS[f.sort] || 'member_no';
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const pageSize = Math.min(Math.max(parseInt(f.pageSize, 10) || 25, 1), 200);
  const page = Math.max(parseInt(f.page, 10) || 1, 1);
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM member_overview o ${where}`, params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT o.* FROM member_overview o ${where} ORDER BY o.${sortCol} ${dir} NULLS LAST, o.id
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params)).rows;
  return { rows, total, page, pageSize };
}
async function listAll(f = {}, limit = 50000) {
  const { where, params } = buildFilter(f);
  const sortCol = SORTS[f.sort] || 'member_no';
  return (await pool.query(`SELECT o.* FROM member_overview o ${where} ORDER BY o.${sortCol} ${f.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, o.id LIMIT ${limit}`, params)).rows;
}

// ───── التحقق ─────
function parseMemberFields(input, { partial = false } = {}) {
  const out = {};
  const errs = {};
  const set = (k, fn) => {
    if (partial && !(k in input)) return;
    try { out[k] = fn(input[k]); } catch (e) { errs[k] = e.message; }
  };
  set('full_name', (v) => {
    const s = N.clean(v);
    if (!s || s.length < 3) throw new Error('الاسم الكامل مطلوب (3 أحرف على الأقل)');
    if (s.length > 150) throw new Error('الاسم طويل جدًا');
    return s;
  });
  set('phone', N.normalizePhone);
  set('email', N.normalizeEmail);
  set('joined_at', (v) => { const d = N.normalizeDate(v); if (!d) throw new Error('تاريخ الانضمام مطلوب'); return d; });
  set('notes', (v) => { const s = N.clean(v); if (s && s.length > 2000) throw new Error('الملاحظات طويلة جدًا'); return s; });
  if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
  return out;
}

async function getType(client, id) {
  const r = await client.query('SELECT * FROM membership_types WHERE id=$1', [id]);
  if (!r.rows[0]) throw bad('نوع العضوية غير موجود', { membership_type_id: 'نوع العضوية غير موجود' });
  return r.rows[0];
}

/** ينشئ دورة + اشتراكها داخل معاملة قائمة. يعيد { period, subscription } */
async function insertPeriodWithSubscription(client, ctx, memberId, p) {
  let r;
  try {
    r = await client.query(
      `INSERT INTO membership_periods (member_id, membership_type_id, start_date, end_date, kind, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [memberId, p.type_id, p.start_date, p.end_date, p.kind, ctx.user?.id ?? null]);
  } catch (e) {
    if (e.code === '23P01') throw conflict('تتداخل فترة العضوية مع فترة أخرى لنفس العضو', 'period_overlap');
    throw e;
  }
  const period = r.rows[0];
  const s = await client.query(
    `INSERT INTO subscriptions (period_id, member_id, amount_due, due_date, is_exempt, exempt_reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [period.id, memberId, p.is_exempt ? '0.00' : p.amount_due, p.due_date, !!p.is_exempt, p.exempt_reason || null]);
  return { period, subscription: s.rows[0] };
}

function parsePeriodInput(input, type, defaults, { canSetAmount }) {
  const errs = {};
  let start_date, end_date, due_date, amount_due, months;
  try { start_date = N.normalizeDate(input.start_date); if (!start_date) throw new Error('تاريخ البداية مطلوب'); } catch (e) { errs.start_date = e.message; }
  try {
    months = input.duration_months ? Number(input.duration_months) : defaults.duration;
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error('المدة بالأشهر بين 1 و120');
  } catch (e) { errs.duration_months = e.message; }
  try { end_date = input.end_date ? N.normalizeDate(input.end_date) : (start_date && months ? N.periodEnd(start_date, months) : null); } catch (e) { errs.end_date = e.message; }
  if (start_date && end_date && end_date < start_date) errs.end_date = 'تاريخ الانتهاء يسبق تاريخ البداية';
  try { due_date = input.due_date ? N.normalizeDate(input.due_date) : start_date; } catch (e) { errs.due_date = e.message; }
  const wantsCustomAmount = input.amount_due !== undefined && input.amount_due !== null && input.amount_due !== '';
  try {
    if (wantsCustomAmount) {
      if (!canSetAmount) throw forbidden('تحديد قيمة الاشتراك يتطلب صلاحية تعديل الاشتراكات');
      amount_due = N.normalizeMoney(input.amount_due);
    } else amount_due = defaults.fee;
  } catch (e) { if (e.status === 403) throw e; errs.amount_due = e.message; }
  const is_exempt = input.is_exempt === true || input.is_exempt === 'true';
  if (is_exempt && !type.fee_exempt) errs.is_exempt = 'نوع العضوية لا يسمح بالإعفاء من الرسوم';
  if (is_exempt && !canSetAmount) throw forbidden('الإعفاء يتطلب صلاحية تعديل الاشتراكات');
  if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
  return { start_date, end_date, due_date, amount_due, is_exempt, exempt_reason: N.clean(input.exempt_reason) };
}

async function defaultsFor(client, type) {
  const all = await settings.getAll(client);
  const typeFee = type.default_fee;
  return {
    fee: Number(typeFee) > 0 ? typeFee : N.normalizeMoney(all['fees.default_amount'] ?? 0),
    duration: type.default_duration_months || all['membership.default_duration_months'] || 12,
  };
}

// ───── عمليات الأعضاء ─────
async function create(ctx, input, canSetAmount) {
  const fields = parseMemberFields(input);
  return tx(async (c) => {
    if (!input.membership_type_id) throw bad('نوع العضوية مطلوب', { membership_type_id: 'نوع العضوية مطلوب' });
    const type = await getType(c, Number(input.membership_type_id));
    if (!type.is_active) throw bad('نوع العضوية غير مفعّل', { membership_type_id: 'نوع العضوية غير مفعّل' });
    const per = parsePeriodInput({ ...input, start_date: input.start_date || fields.joined_at }, type, await defaultsFor(c, type), { canSetAmount });
    const m = await c.query(
      `INSERT INTO members (full_name, phone, email, joined_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [fields.full_name, fields.phone, fields.email, fields.joined_at, fields.notes, ctx.user.id]);
    const member = m.rows[0];
    const { period, subscription } = await insertPeriodWithSubscription(c, ctx, member.id, { ...per, type_id: type.id, kind: 'initial' });
    await audit.log(c, ctx, { action: 'member.create', entity: 'member', entityId: member.id,
      after: { ...pick(member, [...MEMBER_FIELDS, 'member_no']), period: pick(period, ['membership_type_id', 'start_date', 'end_date']),
        subscription: pick(subscription, ['amount_due', 'due_date', 'is_exempt']) } });
    return member.id;
  });
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

async function lockMember(c, id) {
  const r = await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE', [id]);
  if (!r.rows[0]) throw notFound('العضو غير موجود');
  return r.rows[0];
}

async function update(ctx, id, input) {
  const fields = parseMemberFields(input, { partial: true });
  return tx(async (c) => {
    const before = await lockMember(c, id);
    const keys = Object.keys(fields);
    if (keys.length) {
      await c.query(`UPDATE members SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...keys.map((k) => fields[k])]);
      const d = audit.diff(pick(before, keys), fields);
      if (d.changed) await audit.log(c, ctx, { action: 'member.update', entity: 'member', entityId: id, before: d.before, after: d.after });
    }
    return id;
  });
}

/** تعديل دورة حالية: النوع والتواريخ (members.edit) والمبلغ/الاستحقاق/الإعفاء (subscriptions.edit) */
async function updatePeriod(ctx, periodId, input, perms) {
  return tx(async (c) => {
    const pr = await c.query(
      `SELECT mp.*, s.id AS sub_id, s.amount_due, s.due_date, s.is_exempt, s.exempt_reason FROM membership_periods mp
       JOIN subscriptions s ON s.period_id = mp.id WHERE mp.id=$1 FOR UPDATE OF mp, s`, [periodId]);
    const cur = pr.rows[0];
    if (!cur) throw notFound('الدورة غير موجودة');
    await lockMember(c, cur.member_id);
    const paid = (await c.query(`SELECT COALESCE(SUM(amount),0) AS p FROM payments WHERE subscription_id=$1 AND status='confirmed'`, [cur.sub_id])).rows[0].p;
    const errs = {};
    const next = {};
    const touchesMoney = ['amount_due', 'due_date', 'is_exempt'].some((k) => k in input);
    if (touchesMoney && !perms.has('subscriptions.edit')) throw forbidden('تعديل المبالغ ومواعيد الاستحقاق يتطلب صلاحية تعديل الاشتراكات');
    if ('membership_type_id' in input) { const t = await getType(c, Number(input.membership_type_id)); next.membership_type_id = t.id; next._type = t; }
    for (const k of ['start_date', 'end_date']) {
      if (k in input) { try { next[k] = N.normalizeDate(input[k]); if (!next[k]) throw new Error('مطلوب'); } catch (e) { errs[k] = e.message; } }
    }
    const sd = next.start_date || cur.start_date, ed = next.end_date || cur.end_date;
    if (ed < sd) errs.end_date = 'تاريخ الانتهاء يسبق تاريخ البداية';
    const sub = {};
    if ('amount_due' in input) {
      try { sub.amount_due = N.normalizeMoney(input.amount_due); if (sub.amount_due === null) throw new Error('مطلوب'); } catch (e) { errs.amount_due = e.message; }
    }
    if ('due_date' in input) { try { sub.due_date = N.normalizeDate(input.due_date); if (!sub.due_date) throw new Error('مطلوب'); } catch (e) { errs.due_date = e.message; } }
    if ('is_exempt' in input) sub.is_exempt = input.is_exempt === true || input.is_exempt === 'true';
    if ('exempt_reason' in input) sub.exempt_reason = N.clean(input.exempt_reason);
    if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
    const typeNow = next._type || (await getType(c, cur.membership_type_id));
    if ((sub.is_exempt ?? cur.is_exempt) && !typeNow.fee_exempt) throw bad('نوع العضوية لا يسمح بالإعفاء من الرسوم', { is_exempt: 'غير مسموح لهذا النوع' });
    if (sub.is_exempt && Number(paid) > 0) throw bad('لا يمكن إعفاء اشتراك عليه مدفوعات مؤكدة. ألغِ المدفوعات أولًا أو استخدم التجديد', { is_exempt: 'يوجد مدفوعات' });
    const newDue = sub.amount_due ?? cur.amount_due;
    if (!(sub.is_exempt ?? cur.is_exempt) && N.cents(newDue) < N.cents(paid)) {
      throw bad('قيمة الاشتراك أقل من المبلغ المسدد فعليًا', { amount_due: `المسدد ${paid}` });
    }
    const pUpd = {}; for (const k of ['membership_type_id', 'start_date', 'end_date']) if (k in next) pUpd[k] = next[k];
    try {
      if (Object.keys(pUpd).length) {
        const ks = Object.keys(pUpd);
        await c.query(`UPDATE membership_periods SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [periodId, ...ks.map((k) => pUpd[k])]);
      }
    } catch (e) { if (e.code === '23P01') throw conflict('تتداخل فترة العضوية مع فترة أخرى لنفس العضو', 'period_overlap'); throw e; }
    if (sub.is_exempt === true) sub.amount_due = '0.00';
    if (Object.keys(sub).length) {
      const ks = Object.keys(sub);
      await c.query(`UPDATE subscriptions SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [cur.sub_id, ...ks.map((k) => sub[k])]);
    }
    const d = audit.diff(pick(cur, [...Object.keys(pUpd), ...Object.keys(sub)]), { ...pUpd, ...sub });
    if (d.changed) await audit.log(c, ctx, { action: 'period.update', entity: 'period', entityId: periodId, before: { member_id: cur.member_id, ...d.before }, after: d.after });
    return cur.member_id;
  });
}

/** التجديد: دورة واشتراك جديدان دون المساس بالسابق */
async function renew(ctx, memberId, input, canSetAmount) {
  return tx(async (c) => {
    const member = await lockMember(c, memberId);
    if (member.admin_status === 'cancelled') throw conflict('العضوية ملغاة؛ أعد تفعيلها إداريًا قبل التجديد', 'member_cancelled');
    const last = (await c.query(`SELECT * FROM membership_periods WHERE member_id=$1 AND status='active' ORDER BY end_date DESC LIMIT 1`, [memberId])).rows[0];
    const today = N.todayRiyadh();
    if (last && last.start_date > today && input.confirm_additional !== true) {
      throw conflict('تم تجديد هذه العضوية مسبقًا لفترة قادمة. أكّد إن كنت تريد تجديدًا إضافيًا', 'already_renewed');
    }
    const typeId = Number(input.membership_type_id || last?.membership_type_id);
    const type = await getType(c, typeId);
    if (!type.is_active) throw bad('نوع العضوية غير مفعّل', { membership_type_id: 'غير مفعّل' });
    // افتراضيًا: تبدأ الدورة بعد انتهاء السابقة مباشرة، أو من اليوم إن كانت السابقة منتهية
    const start = input.start_date || (last ? (last.end_date >= today ? N.addDaysISO(last.end_date, 1) : today) : today);
    let defs = await defaultsFor(c, type);
    // لا قيمة افتراضية مضبوطة للنوع: نرحّل قيمة الدورة السابقة (لئلا يظهر التجديد «مسدد بالكامل» بقيمة صفر)
    if (Number(defs.fee) === 0 && last && last.membership_type_id === type.id && input.is_exempt !== true) {
      const prev = (await c.query('SELECT amount_due FROM subscriptions WHERE period_id=$1', [last.id])).rows[0];
      if (prev && Number(prev.amount_due) > 0) defs = { ...defs, fee: prev.amount_due };
    }
    const per = parsePeriodInput({ ...input, start_date: start }, type, defs, { canSetAmount });
    const { period, subscription } = await insertPeriodWithSubscription(c, ctx, memberId, { ...per, type_id: type.id, kind: 'renewal' });
    await audit.log(c, ctx, { action: 'member.renew', entity: 'member', entityId: memberId,
      after: { period_id: period.id, start_date: period.start_date, end_date: period.end_date, amount_due: subscription.amount_due, is_exempt: subscription.is_exempt } });
    return { member_id: memberId, period_id: period.id, subscription_id: subscription.id };
  });
}

async function setAdminStatus(ctx, id, status, reason) {
  if (!['normal', 'suspended', 'cancelled'].includes(status)) throw bad('حالة غير صالحة');
  const why = N.clean(reason);
  if (status !== 'normal' && !why) throw bad('سبب التعليق/الإلغاء مطلوب', { reason: 'مطلوب' });
  return tx(async (c) => {
    const m = await lockMember(c, id);
    if (m.admin_status === status) return id;
    await c.query('UPDATE members SET admin_status=$2, admin_status_reason=$3, updated_at=now() WHERE id=$1', [id, status, status === 'normal' ? null : why]);
    await audit.log(c, ctx, { action: 'member.status', entity: 'member', entityId: id,
      before: { admin_status: m.admin_status }, after: { admin_status: status, reason: why } });
    return id;
  });
}

async function setArchived(ctx, id, archived) {
  return tx(async (c) => {
    const m = await lockMember(c, id);
    if (!!m.archived_at === archived) return id;
    await c.query(`UPDATE members SET archived_at=${archived ? 'now()' : 'NULL'}, updated_at=now() WHERE id=$1`, [id]);
    await audit.log(c, ctx, { action: archived ? 'member.archive' : 'member.restore', entity: 'member', entityId: id });
    return id;
  });
}

async function profile(id) {
  const o = (await pool.query('SELECT * FROM member_overview WHERE id=$1', [id])).rows[0];
  if (!o) throw notFound('العضو غير موجود');
  const periods = (await pool.query(
    `SELECT mp.id, mp.membership_type_id, mt.name_ar AS type_name, mp.start_date, mp.end_date, mp.kind, mp.status, mp.created_at,
            sb.subscription_id, sb.amount_due, sb.due_date, sb.is_exempt, sb.paid, sb.remaining, sb.payment_status, sb.last_paid_at
     FROM membership_periods mp JOIN membership_types mt ON mt.id = mp.membership_type_id
     LEFT JOIN subscription_balances sb ON sb.period_id = mp.id
     WHERE mp.member_id=$1 ORDER BY mp.start_date DESC, mp.id DESC`, [id])).rows;
  const payments = (await pool.query(
    `SELECT p.*, u.full_name AS created_by_name,
            (SELECT COUNT(*)::int FROM payment_attachments a WHERE a.payment_id=p.id AND a.deleted_at IS NULL) AS attachments_count
     FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.member_id=$1 ORDER BY p.paid_at DESC, p.id DESC`, [id])).rows;
  const attachments = (await pool.query(
    `SELECT id, payment_id, kind, original_name, mime_type, size_bytes, uploaded_at FROM payment_attachments
     WHERE member_id=$1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`, [id])).rows;
  const notifications = (await pool.query(`SELECT id, type, channel, title, body, status, created_at FROM notifications WHERE member_id=$1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
  const history = (await pool.query(
    `SELECT id, username, action, entity, entity_id, before, after, created_at FROM audit_logs
     WHERE (entity='member' AND entity_id=$1::text)
        OR (entity='period' AND before->>'member_id' = $1::text)
        OR (entity='payment' AND (after->>'member_id' = $1::text OR before->>'member_id' = $1::text))
     ORDER BY id DESC LIMIT 200`, [id])).rows;
  return { member: o, periods, payments, attachments, notifications, history };
}

module.exports = { buildFilter, list, listAll, create, update, updatePeriod, renew, setAdminStatus, setArchived, profile,
  parseMemberFields, insertPeriodWithSubscription, getType, defaultsFor, lockMember, pick, SORTS };
