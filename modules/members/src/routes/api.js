'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { pool, tx } = require('../db/pool');
const sec = require('../middleware/security');
const { AppError, bad, notFound, conflict } = require('../lib/errors');
const L = require('../lib/labels');
const N = require('../lib/normalize');
const audit = require('../services/audit');
const settings = require('../services/settings');
const access = require('../services/access');
const members = require('../services/members');
const payments = require('../services/payments');
const attachments = require('../services/attachments');
const dashboard = require('../services/dashboard');
const notifications = require('../services/notifications');
const reports = require('../services/reports');
const exporter = require('../services/exporter');
const importer = require('../services/importer');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 } });
const id = (req, name = 'id') => { const n = Number(req.params[name]); if (!Number.isInteger(n) || n < 1) throw bad('معرّف غير صالح'); return n; };
const has = (req, p) => req.ctx.perms.has(p);

const FIN_KEYS = ['amount_due', 'paid', 'remaining', 'due_date', 'last_paid_at', 'is_exempt', 'latest_payment_status', 'is_partial', 'total_due',
  'total_paid', 'total_remaining', 'any_overdue', 'max_overdue_days', 'cov_due', 'cov_paid', 'cov_exempt', 'payment_status', 'subscription_id'];
const stripFin = (row) => { const o = { ...row }; for (const k of FIN_KEYS) delete o[k]; return o; };

const api = express.Router();

// ───────── الجلسة (الدخول يتم في بوابة المنصة؛ هنا ملخص المستخدم والصلاحيات) ─────────
api.get('/auth/me', (req, res) => {
  const u = req.ctx.user;
  res.json({ user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role_code, role_name: u.role_name, hr_role: u.hr_role, must_change_password: false },
    permissions: u.permissions, csrf: sec.csrfFor(req) });
});

api.get('/meta', wrap(async (req, res) => {
  const types = (await pool.query('SELECT id, code, name_ar, default_fee, default_duration_months, fee_exempt, is_active FROM membership_types ORDER BY sort_order, id')).rows;
  const all = await settings.getAll();
  res.json({ labels: L, payment_methods: payments.METHODS, user_methods: payments.USER_METHODS, notification_types: notifications.TYPES,
    placeholders: notifications.PLACEHOLDERS, membership_types: types, org: { name: all['org.name'], logo: all['org.logo'], brand: all['brand.primary'] },
    defaults: { duration_months: all['membership.default_duration_months'], expiry_warning_days: all['rules.expiry_warning_days'] }, today: N.todayRiyadh() });
}));

// ───────── لوحة التحكم ─────────
api.get('/dashboard', sec.requirePerm('dashboard.view'), wrap(async (req, res) => {
  const d = await dashboard.summary(req.query);
  if (!has(req, 'payments.view')) {
    for (const k of ['total_due', 'total_collected', 'total_remaining', 'overdue_amount']) delete d.kpis[k];
    delete d.charts.collections;
  }
  res.json(d);
}));

// ───────── الأعضاء ─────────
api.get('/members', sec.requirePerm('members.view'), wrap(async (req, res) => {
  const r = await members.list(req.query);
  if (!has(req, 'payments.view')) r.rows = r.rows.map(stripFin);
  res.json(r);
}));

api.get('/members/export', sec.requirePerm('members.export'), wrap(async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
  const rep = await reports.membersExport(req.query, has(req, 'payments.view'));
  const out = await exporter.exportReport('members', {}, format, rep);
  await tx((c) => audit.log(c, req.ctx, { action: 'export.members', entity: 'export', entityId: 'members', after: { format, count: rep.count } }));
  sendFile(res, out, 'members');
}));

api.post('/members', sec.requirePerm('members.create'), wrap(async (req, res) => {
  const mid = await members.create(req.ctx, req.body || {}, has(req, 'subscriptions.edit'));
  res.status(201).json({ id: mid });
}));

api.get('/members/:id', sec.requirePerm('members.view'), wrap(async (req, res) => {
  const p = await members.profile(id(req));
  const fin = has(req, 'payments.view');
  if (!fin) { p.member = stripFin(p.member); p.periods = p.periods.map(stripFin); p.payments = []; }
  p.attachments = p.attachments.filter((a) => (a.kind === 'receipt' ? has(req, 'receipts.view') : has(req, 'documents.view')));
  if (!has(req, 'audit.view') && !has(req, 'members.edit')) p.history = [];
  if (!has(req, 'notifications.view')) p.notifications = [];
  res.json(p);
}));

api.put('/members/:id', sec.requirePerm('members.edit'), wrap(async (req, res) => {
  await members.update(req.ctx, id(req), req.body || {});
  res.json({ id: id(req) });
}));

api.put('/periods/:id', sec.requirePerm('members.edit'), wrap(async (req, res) => {
  const mid = await members.updatePeriod(req.ctx, id(req), req.body || {}, req.ctx.perms);
  res.json({ member_id: mid });
}));

api.post('/members/:id/renew', sec.requirePerm('members.renew'), wrap(async (req, res) => {
  res.status(201).json(await members.renew(req.ctx, id(req), req.body || {}, has(req, 'subscriptions.edit')));
}));
api.post('/members/:id/status', sec.requirePerm('members.status'), wrap(async (req, res) => {
  await members.setAdminStatus(req.ctx, id(req), req.body?.status, req.body?.reason);
  res.json({ ok: true });
}));
api.post('/members/:id/archive', sec.requirePerm('members.archive'), wrap(async (req, res) => { await members.setArchived(req.ctx, id(req), true); res.json({ ok: true }); }));
api.post('/members/:id/restore', sec.requirePerm('members.archive'), wrap(async (req, res) => { await members.setArchived(req.ctx, id(req), false); res.json({ ok: true }); }));

api.get('/members/:id/summary.pdf', sec.requirePerm('members.view'), wrap(async (req, res) => {
  const p = await members.profile(id(req));
  if (!has(req, 'payments.view')) { p.member = stripFin(p.member); p.periods = []; p.payments = []; }
  const all = await settings.getAll();
  const buffer = await exporter.memberSummaryPdf(p, all['org.name'], all['brand.primary']);
  sendFile(res, { buffer, mime: 'application/pdf', ext: 'pdf' }, `member-${p.member.member_no}`);
}));

api.post('/members/:id/documents', sec.requirePerm('documents.manage'), upload.single('file'), wrap(async (req, res) => {
  res.status(201).json(await attachments.save(req.ctx, { memberId: id(req), kind: 'document', file: req.file }));
}));

api.get('/membership-types', wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM membership_types ORDER BY sort_order, id')).rows);
}));

// ───────── المالية ─────────
api.get('/payments', sec.requirePerm('payments.view'), wrap(async (req, res) => res.json(await payments.list(req.query))));
api.get('/subscriptions', sec.requirePerm('payments.view'), wrap(async (req, res) => res.json(await payments.listSubscriptions(req.query))));
api.post('/subscriptions/:id/payments', sec.requirePerm('payments.create'), wrap(async (req, res) => {
  const r = await payments.create(req.ctx, id(req), req.body || {});
  res.status(r.replayed ? 200 : 201).json(r);
}));
api.put('/payments/:id', sec.requirePerm('payments.edit'), wrap(async (req, res) => res.json(await payments.update(req.ctx, id(req), req.body || {}))));
api.post('/payments/:id/void', sec.requirePerm('payments.void'), wrap(async (req, res) => res.json(await payments.voidPayment(req.ctx, id(req), req.body?.reason))));
api.post('/payments/:id/receipts', sec.requirePerm('payments.create'), upload.single('file'), wrap(async (req, res) => {
  const p = (await pool.query('SELECT member_id FROM payments WHERE id=$1', [id(req)])).rows[0];
  if (!p) throw notFound('عملية السداد غير موجودة');
  res.status(201).json(await attachments.save(req.ctx, { memberId: p.member_id, paymentId: id(req), kind: 'receipt', file: req.file }));
}));

// ───────── المرفقات (وصول مضبوط بالصلاحيات) ─────────
api.get('/attachments/:id', wrap(async (req, res) => {
  const { att, full } = await attachments.open(id(req));
  if (att.kind === 'receipt' ? !has(req, 'receipts.view') : !has(req, 'documents.view')) throw new AppError(403, 'ليست لديك صلاحية لعرض هذا المرفق', 'forbidden');
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
  res.type(att.mime_type);
  const inline = req.query.inline === '1';
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
}));
api.delete('/attachments/:id', sec.requirePerm('documents.manage'), wrap(async (req, res) => { await attachments.remove(req.ctx, id(req)); res.json({ ok: true }); }));

// ───────── التنبيهات ─────────
api.get('/notifications', sec.requirePerm('notifications.view'), wrap(async (req, res) => res.json(await notifications.list(req.query))));
api.get('/notifications/unread-count', sec.requirePerm('notifications.view'), wrap(async (req, res) => res.json({ unread: await notifications.unreadCount() })));
api.post('/notifications/status', sec.requirePerm('notifications.view'), wrap(async (req, res) => res.json(await notifications.setStatus(req.ctx, req.body?.ids, req.body?.status))));
api.post('/notifications/generate', sec.requirePerm('notifications.manage'), wrap(async (req, res) => res.json(await notifications.generate(req.ctx))));
api.get('/notification-templates', sec.requirePerm('notifications.view'), wrap(async (req, res) => res.json(await notifications.listTemplates())));
api.put('/notification-templates/:id', sec.requirePerm('notifications.manage'), wrap(async (req, res) => { await notifications.updateTemplate(req.ctx, id(req), req.body || {}); res.json({ ok: true }); }));
api.post('/notification-templates/:id/approve', sec.requirePerm('notifications.manage'), wrap(async (req, res) => { await notifications.approveTemplate(req.ctx, id(req), req.body?.approved !== false); res.json({ ok: true }); }));

// ───────── التقارير ─────────
function sendFile(res, out, base) {
  res.set({ 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${base}.${out.ext}"; filename*=UTF-8''${encodeURIComponent(base)}.${out.ext}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(out.buffer);
}
api.get('/reports', sec.requirePerm('reports.view'), wrap(async (req, res) => {
  res.json(reports.catalog().filter((r) => !r.financial || has(req, 'reports.financial')));
}));
api.get('/reports/:rid', sec.requirePerm('reports.view'), wrap(async (req, res) => {
  const def = reports.catalog().find((r) => r.id === req.params.rid);
  if (!def) throw notFound('تقرير غير معروف');
  if (def.financial && !has(req, 'reports.financial')) throw new AppError(403, 'التقارير المالية تتطلب صلاحية خاصة', 'forbidden');
  const format = ['xlsx', 'pdf'].includes(req.query.format) ? req.query.format : 'json';
  if (format === 'json') return res.json(await reports.run(def.id, req.query));
  const out = await exporter.exportReport(def.id, req.query, format);
  await tx((c) => audit.log(c, req.ctx, { action: 'export.report', entity: 'export', entityId: def.id, after: { format, count: out.rep.count } }));
  sendFile(res, out, def.id);
}));

// ───────── الاستيراد ─────────
api.get('/import/template', sec.requirePerm('members.import'), wrap(async (req, res) => {
  sendFile(res, { buffer: await importer.template(), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }, 'members-import-template');
}));
const parseJsonField = (v) => { if (!v) return undefined; try { return JSON.parse(v); } catch { throw bad('صيغة الإعدادات غير صالحة'); } };
api.post('/import/preview', sec.requirePerm('members.import'), upload.single('file'), wrap(async (req, res) => {
  res.json(await importer.preview(req.ctx, { file: req.file, mapping: parseJsonField(req.body?.mapping), options: parseJsonField(req.body?.options) || {} }));
}));
api.post('/import/:id/preview', sec.requirePerm('members.import'), wrap(async (req, res) => {
  res.json(await importer.preview(req.ctx, { batchId: id(req), mapping: req.body?.mapping, options: req.body?.options || {} }));
}));
api.post('/import/:id/commit', sec.requirePerm('members.import'), wrap(async (req, res) => res.json(await importer.commit(req.ctx, id(req), { confirm: req.body?.confirm }))));
api.delete('/import/:id', sec.requirePerm('members.import'), wrap(async (req, res) => { await importer.cancel(req.ctx, id(req)); res.json({ ok: true }); }));

// ───────── الإعدادات ─────────
api.get('/settings', sec.requirePerm('settings.view'), wrap(async (req, res) => res.json({ settings: await settings.getAll() })));
api.put('/settings', sec.requirePerm('settings.manage'), wrap(async (req, res) => {
  res.json({ applied: await tx((c) => settings.update(c, req.ctx, req.body || {})) });
}));

function parseType(b, partial) {
  const o = {}, errs = {};
  const set = (k, fn) => { if (partial && !(k in b)) return; try { o[k] = fn(b[k]); } catch (e) { errs[k] = e.message; } };
  set('name_ar', (v) => { const s = N.clean(v); if (!s || s.length < 2 || s.length > 60) throw new Error('الاسم مطلوب'); return s; });
  set('default_fee', (v) => N.normalizeMoney(v ?? 0));
  set('default_duration_months', (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error('المدة بين 1 و120 شهرًا'); return n; });
  set('fee_exempt', (v) => v === true || v === 'true');
  set('is_active', (v) => (v === undefined ? true : v === true || v === 'true'));
  set('sort_order', (v) => { const n = Number(v ?? 0); if (!Number.isInteger(n)) throw new Error('ترتيب غير صالح'); return n; });
  if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
  return o;
}
api.post('/membership-types', sec.requirePerm('settings.manage'), wrap(async (req, res) => {
  const t = parseType(req.body || {}, false);
  const out = await tx(async (c) => {
    try {
      const r = await c.query(`INSERT INTO membership_types (code, name_ar, default_fee, default_duration_months, fee_exempt, is_active, sort_order)
        VALUES ('t_' || substr(md5(random()::text),1,8), $1,$2,$3,$4,$5,$6) RETURNING *`,
        [t.name_ar, t.default_fee, t.default_duration_months, t.fee_exempt ?? false, t.is_active ?? true, t.sort_order ?? 0]);
      await audit.log(c, req.ctx, { action: 'membership_type.create', entity: 'membership_type', entityId: r.rows[0].id, after: t });
      return r.rows[0];
    } catch (e) { if (e.code === '23505') throw conflict('اسم نوع العضوية مستخدم مسبقًا', 'duplicate', { name_ar: 'مكرر' }); throw e; }
  });
  res.status(201).json(out);
}));
api.put('/membership-types/:id', sec.requirePerm('settings.manage'), wrap(async (req, res) => {
  const t = parseType(req.body || {}, true);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM membership_types WHERE id=$1 FOR UPDATE', [id(req)])).rows[0];
    if (!cur) throw notFound('نوع العضوية غير موجود');
    const keys = Object.keys(t);
    if (!keys.length) return;
    try { await c.query(`UPDATE membership_types SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [cur.id, ...keys.map((k) => t[k])]); }
    catch (e) { if (e.code === '23505') throw conflict('اسم نوع العضوية مستخدم مسبقًا', 'duplicate', { name_ar: 'مكرر' }); throw e; }
    const d = audit.diff(Object.fromEntries(keys.map((k) => [k, cur[k]])), t);
    if (d.changed) await audit.log(c, req.ctx, { action: 'membership_type.update', entity: 'membership_type', entityId: cur.id, before: d.before, after: d.after });
  });
  res.json({ ok: true });
}));

api.post('/settings/logo', sec.requirePerm('settings.manage'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file?.buffer?.length) throw bad('لم يتم اختيار ملف');
  const sig = attachments.detect(req.file.buffer);
  if (sig.mime === 'application/pdf') throw bad('الشعار يجب أن يكون PNG أو JPG');
  if (req.file.buffer.length > 1024 * 1024) throw bad('حجم الشعار يتجاوز 1 ميغابايت');
  const dir = path.join(config.uploadDir, 'branding'); fs.mkdirSync(dir, { recursive: true });
  const name = `logo-${crypto.randomBytes(8).toString('hex')}${sig.ext}`;
  fs.writeFileSync(path.join(dir, name), req.file.buffer);
  await tx(async (c) => {
    const old = await settings.getValue(c, 'org.logo');
    await c.query(`INSERT INTO system_settings (key,value,updated_by) VALUES ('org.logo',$1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [JSON.stringify(name), req.ctx.user.id]);
    await audit.log(c, req.ctx, { action: 'settings.update', entity: 'settings', entityId: 'org.logo', before: { 'org.logo': old }, after: { 'org.logo': name } });
  });
  res.json({ logo: name });
}));

// ───────── الأدوار والصلاحيات (الحسابات تُدار من المنصة الموحّدة) ─────────
api.get('/roles', sec.requireAny('users.manage', 'settings.view'), wrap(async (req, res) => res.json(await access.listRoles())));
api.put('/roles/:id/permissions', sec.requirePerm('users.manage'), wrap(async (req, res) => { await access.setRolePermissions(req.ctx, id(req), req.body?.permission_ids); res.json({ ok: true }); }));
api.put('/role-map/:hrRole', sec.requirePerm('users.manage'), wrap(async (req, res) => { await access.setRoleMap(req.ctx, String(req.params.hrRole), req.body?.role_id ?? null); res.json({ ok: true }); }));

// ───────── سجل التدقيق ─────────
api.get('/audit', sec.requirePerm('audit.view'), wrap(async (req, res) => {
  const w = ['1=1'], p = [];
  const q = req.query;
  if (q.entity) { p.push(String(q.entity)); w.push(`entity=$${p.length}`); }
  if (q.entity_id) { p.push(String(q.entity_id)); w.push(`entity_id=$${p.length}`); }
  if (q.action) { p.push(`${String(q.action).replace(/[\\%_]/g, '\\$&')}%`); w.push(`action LIKE $${p.length}`); }
  if (q.user) { p.push(`%${String(q.user).replace(/[\\%_]/g, '\\$&')}%`); w.push(`username ILIKE $${p.length}`); }
  if (q.from) { p.push(N.normalizeDate(q.from)); w.push(`(created_at AT TIME ZONE 'Asia/Riyadh')::date >= $${p.length}`); }
  if (q.to) { p.push(N.normalizeDate(q.to)); w.push(`(created_at AT TIME ZONE 'Asia/Riyadh')::date <= $${p.length}`); }
  const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 50, 1), 200), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const total = (await pool.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE ${w.join(' AND ')}`, p)).rows[0].n;
  const rows = (await pool.query(`SELECT * FROM audit_logs WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p)).rows;
  res.json({ rows, total, page, pageSize });
}));

api.use((req, res, next) => next(notFound('المسار غير موجود')));
module.exports = api;
