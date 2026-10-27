// واجهة الإدارة المركزية (/api/core): الموظفون، الهيكل، المستخدمون، الأدوار، المنصات، الجلسات، سجل العمليات، الإعدادات.
// كل مسار يفرض صلاحيته في الخادم (RBAC) ويسجَّل الرفض في سجل التدقيق.
import { Router } from 'express';
import { q } from '../db/pool.js';
import { wrap } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { requireGrant, resolveScope, hasGrant, invalidateGrants, effectiveForUser } from '../lib/rbac.js';
import { listApps, resetAppsCache } from '../lib/apps.js';
import { allSettings, setSetting } from '../lib/settings.js';
import { revokeSession, revokeUserSessions } from '../lib/sessions.js';
import { httpError } from '../lib/util.js';
import { uploadMiddleware, saveUploadedFile } from '../lib/uploads.js';
import * as employees from '../services/employees.js';
import * as org from '../services/org.js';
import * as users from '../services/users.js';

const r = Router();
const G = a => requireGrant('admin', a);
r.use(G('access'));

// ───────────── لوحة المعلومات ─────────────
r.get('/dashboard', wrap(async (req, res) => {
  const one = async (sql, p) => (await q(sql, p)).rows[0];
  const [emp, usr, ses, apps, conflicts] = await Promise.all([
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE leave_enabled)::int AS leave_enabled,
         count(*) FILTER (WHERE extension IS NOT NULL)::int AS in_directory FROM employees`),
    one("SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE locked_until > now())::int AS locked FROM users"),
    one('SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > now()'),
    one('SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active FROM apps'),
    one('SELECT count(*)::int AS n FROM migration_conflicts WHERE NOT resolved'),
  ]);
  const out = { employees: emp, users: usr, active_sessions: ses.n, platforms: apps, open_conflicts: conflicts.n };
  if (hasGrant(req.user, 'admin', 'audit_view')) {
    out.recent = (await q('SELECT id, at, username, platform, action, entity, entity_id, result FROM audit_logs ORDER BY id DESC LIMIT 12')).rows;
    out.security = (await q(`SELECT
        count(*) FILTER (WHERE action = 'login_failed')::int AS failed_logins,
        count(*) FILTER (WHERE result = 'denied')::int AS denied,
        count(*) FILTER (WHERE action = 'login')::int AS logins FROM audit_logs WHERE at > now() - interval '24 hours'`)).rows[0];
    out.security.direct_db_changes = (await q("SELECT count(*)::int AS n FROM db_change_log WHERE direct AND at > now() - interval '7 days'")).rows[0].n;
    out.security_events = (await q(`SELECT id, at, username, platform, action, result, reason, ip FROM audit_logs WHERE (result <> 'success' OR action IN ('disable','update_grants','merge')) ORDER BY id DESC LIMIT 8`)).rows;
  }
  res.json(out);
}));

// ───────────── الموظفون ─────────────
r.get('/employees', G('employees_view'), wrap(async (req, res) => {
  const sc = await resolveScope(req.user, 'admin', 'employees_view');
  res.json(await employees.listEmployees({ search: req.query.q, unit: req.query.unit, status: req.query.status, leave: req.query.leave, page: req.query.page, pageSize: req.query.pageSize, sc }));
}));
r.get('/employees/duplicates', G('employees_edit'), wrap(async (req, res) => res.json({ groups: await employees.findDuplicates() })));
r.post('/employees/merge', G('employees_edit'), wrap(async (req, res) => res.json(await employees.mergeEmployees(+req.body.keep, +req.body.drop, req))));
r.get('/employees/:id', G('employees_view'), wrap(async (req, res) => {
  const e = await employees.getEmployee(+req.params.id);
  if (!e) throw httpError(404, 'الموظف غير موجود');
  const sc = await resolveScope(req.user, 'admin', 'employees_view');
  if (!employees.inScope(sc, e)) throw httpError(403, 'خارج نطاق صلاحياتك');
  const history = (await q(`SELECT h.moved_on, h.moved_by, h.reason, fu.name AS from_unit, tu.name AS to_unit FROM org_history h
    LEFT JOIN org_units fu ON fu.id = h.from_unit_id LEFT JOIN org_units tu ON tu.id = h.to_unit_id WHERE h.employee_id = $1 ORDER BY h.id DESC`, [e.id])).rows;
  const { basic_salary, leave_salary_override, annual_entitlement_days, opening_balance, opening_date, is_demo, person_id, ...pub } = e;   // لا تُعرض البيانات المالية هنا
  res.json({ ...pub, history });
}));
r.post('/employees', G('employees_edit'), wrap(async (req, res) => res.status(201).json(await employees.createEmployee(req.body, req))));
r.put('/employees/:id', G('employees_edit'), wrap(async (req, res) => res.json(await employees.updateEmployee(+req.params.id, req.body, req, { expectedVersion: req.body.version ?? null }))));
r.delete('/employees/:id', G('employees_edit'), wrap(async (req, res) => { await employees.deleteEmployee(+req.params.id, req); res.json({ ok: true }); }));
r.post('/employees/:id/photo', G('employees_edit'), uploadMiddleware, wrap(async (req, res) => {
  const id = +req.params.id;
  if (!(await employees.getEmployee(id))) throw httpError(404, 'الموظف غير موجود');
  const saved = saveUploadedFile('employee-photos', req.file, { stem: `emp-${id}-${Date.now()}` });
  res.json(await employees.updateEmployee(id, { photo: saved.url }, req));
}));

// ───────────── الهيكل التنظيمي ─────────────
r.get('/org/tree', wrap(async (req, res) => res.json({ tree: await org.unitTree(), types: org.TYPE_LABEL })));
r.post('/org/units', G('org_edit'), wrap(async (req, res) => res.status(201).json(await org.createUnit(req.body, req))));
r.put('/org/units/:id', G('org_edit'), wrap(async (req, res) => res.json(await org.updateUnit(+req.params.id, req.body, req))));
r.delete('/org/units/:id', G('org_edit'), wrap(async (req, res) => { await org.deleteUnit(+req.params.id, req); res.json({ ok: true }); }));
r.get('/org/units/:id/history', G('org_edit'), wrap(async (req, res) => res.json(await org.unitHistory(+req.params.id))));

// ───────────── المستخدمون والجلسات ─────────────
r.get('/users', G('users_manage'), wrap(async (req, res) => res.json({ users: await users.listUsers() })));
r.post('/users', G('users_manage'), wrap(async (req, res) => res.status(201).json(await users.createUser(req.body, req))));
r.put('/users/:id', G('users_manage'), wrap(async (req, res) => res.json(await users.updateUser(+req.params.id, req.body, req))));
r.get('/users/:id/grants', G('users_manage'), wrap(async (req, res) => res.json({ grants: await users.userGrants(+req.params.id) })));
r.get('/users/:id/effective', G('users_manage'), wrap(async (req, res) => res.json(await effectiveForUser(+req.params.id))));
r.put('/users/:id/grants', G('roles_manage'), wrap(async (req, res) => { await users.saveUserGrants(+req.params.id, req.body.grants || [], req); res.json({ ok: true }); }));
r.post('/users/:id/revoke-sessions', G('sessions_manage'), wrap(async (req, res) => {
  const n = await revokeUserSessions(+req.params.id, req.user.username, 'إنهاء إداري');
  await audit(req, 'revoke_sessions', 'user', req.params.id, null, { count: n });
  res.json({ revoked: n });
}));
r.get('/sessions', G('sessions_manage'), wrap(async (req, res) => {
  const { rows } = await q(`SELECT s.id, s.user_id, u.username, u.full_name, s.created_at, s.last_seen_at, s.expires_at, s.ip, s.user_agent
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > now() ORDER BY s.last_seen_at DESC LIMIT 500`);
  res.json({ sessions: rows, current: req.user.sessionId });
}));
r.post('/sessions/:id/revoke', G('sessions_manage'), wrap(async (req, res) => {
  const row = await revokeSession(req.params.id, req.user.username, 'إنهاء إداري');
  if (!row) throw httpError(404, 'الجلسة غير موجودة أو منتهية');
  invalidateGrants(row.user_id);
  await audit(req, 'revoke_session', 'session', req.params.id, null, { user_id: row.user_id });
  res.json({ ok: true });
}));

// ───────────── الأدوار والصلاحيات ─────────────
r.get('/roles/brief', G('users_manage'), wrap(async (req, res) => res.json({ roles: (await q('SELECT key, name FROM roles ORDER BY is_system DESC, id')).rows })));
r.get('/roles', G('roles_manage'), wrap(async (req, res) => res.json({ roles: await users.listRoles(), catalog: await users.catalog() })));
r.post('/roles', G('roles_manage'), wrap(async (req, res) => res.status(201).json(await users.saveRole(null, req.body, req))));
r.put('/roles/:id', G('roles_manage'), wrap(async (req, res) => res.json(await users.saveRole(+req.params.id, req.body, req))));
r.delete('/roles/:id', G('roles_manage'), wrap(async (req, res) => { await users.deleteRole(+req.params.id, req); res.json({ ok: true }); }));

// ───────────── المنصات ─────────────
r.get('/platforms', G('platforms_manage'), wrap(async (req, res) => {
  const usage = (await q("SELECT platform, count(*)::int AS n, max(at) AS last FROM audit_logs WHERE at > now() - interval '30 days' GROUP BY platform")).rows;
  res.json({ platforms: (await listApps()).map(a => ({ ...a, activity_30d: usage.find(u => u.platform === a.slug) ?? null })) });
}));
r.put('/platforms/:slug', G('platforms_manage'), wrap(async (req, res) => {
  const slug = req.params.slug;
  const old = (await q('SELECT * FROM apps WHERE slug = $1', [slug])).rows[0];
  if (!old) throw httpError(404, 'المنصة غير موجودة');
  if (slug === 'admin' && req.body.active === false) throw httpError(400, 'لا يمكن تعطيل الإدارة المركزية');
  const row = (await q('UPDATE apps SET active = coalesce($2, active), title = coalesce($3, title), description = coalesce($4, description), sort_order = coalesce($5, sort_order) WHERE slug = $1 RETURNING *',
    [slug, req.body.active ?? null, req.body.title?.trim() || null, req.body.description ?? null, req.body.sort_order ?? null])).rows[0];
  resetAppsCache();
  await audit(req, req.body.active === false ? 'disable' : 'update', 'platform', slug, old, row);
  res.json(row);
}));

// ───────────── سجل العمليات والتدقيق ─────────────
function auditWhere(qs) {
  const w = ['TRUE']; const p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (qs.q) add("(username ILIKE ? OR entity_id ILIKE ? OR reason ILIKE ?)".replace(/\?/g, `$${p.length + 1}`), `%${qs.q}%`);
  if (qs.platform) add('platform = ?', qs.platform);
  if (qs.action) add('action = ?', qs.action);
  if (qs.entity) add('entity = ?', qs.entity);
  if (qs.result) add('result = ?', qs.result);
  if (qs.user_id) add('user_id = ?', +qs.user_id);
  if (qs.from) add('at >= ?', qs.from);
  if (qs.to) add('at < (?::timestamptz + interval \'1 day\')'.replace('?', `$${p.length + 1}`), qs.to);
  return { where: w.join(' AND '), p };
}
r.get('/audit', G('audit_view'), wrap(async (req, res) => {
  const { where, p } = auditWhere(req.query);
  const limit = Math.min(+req.query.pageSize || 50, 200), offset = (Math.max(+req.query.page || 1, 1) - 1) * limit;
  const total = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE ${where}`, p)).rows[0].n;
  const rows = (await q(`SELECT id, at, user_id, username, platform, action, entity, entity_id, result, reason, ip, source FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  const facets = (await q('SELECT array_agg(DISTINCT platform) FILTER (WHERE platform IS NOT NULL) AS platforms, array_agg(DISTINCT action) AS actions, array_agg(DISTINCT entity) FILTER (WHERE entity IS NOT NULL) AS entities FROM audit_logs')).rows[0];
  res.json({ total, page: Math.floor(offset / limit) + 1, pageSize: limit, rows, facets });
}));
const csvCell = v => {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // منع حقن الصيغ في Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
r.get('/audit/export.csv', G('audit_export'), wrap(async (req, res) => {
  const { where, p } = auditWhere(req.query);
  const { rows } = await q(`SELECT id, at, username, platform, action, entity, entity_id, result, reason, ip, session_id, request_id, before, after FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT 50000`, p);
  await audit(req, 'export', 'audit_logs', null, null, { filters: req.query, rows: rows.length });
  const cols = ['id', 'at', 'username', 'platform', 'action', 'entity', 'entity_id', 'result', 'reason', 'ip', 'session_id', 'request_id', 'before', 'after'];
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send('﻿' + [cols.join(','), ...rows.map(r2 => cols.map(c => csvCell(r2[c])).join(','))].join('\r\n'));
}));
r.get('/audit/:id', G('audit_view'), wrap(async (req, res) => {
  const row = (await q('SELECT * FROM audit_logs WHERE id = $1', [req.params.id])).rows[0];
  if (!row) throw httpError(404, 'غير موجود');
  res.json(row);
}));
r.get('/db-changes', G('audit_view'), wrap(async (req, res) => {
  const w = ['TRUE']; const p = [];
  if (req.query.direct === 'true') w.push('direct');
  if (req.query.table) { p.push(req.query.table); w.push(`table_name = $${p.length}`); }
  const limit = Math.min(+req.query.pageSize || 50, 200), offset = (Math.max(+req.query.page || 1, 1) - 1) * limit;
  const total = (await q(`SELECT count(*)::int AS n FROM db_change_log WHERE ${w.join(' AND ')}`, p)).rows[0].n;
  const rows = (await q(`SELECT id, at, table_name, op, row_id, changed_cols, old_row, new_row, db_user, app_name, client_addr, direct FROM db_change_log WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  res.json({ total, page: Math.floor(offset / limit) + 1, pageSize: limit, rows });
}));

// ───────────── الإعدادات وتعارضات الترحيل ─────────────
const SETTING_RULES = {
  portal_public: v => typeof v === 'boolean',
  session_hours: v => Number.isInteger(v) && v >= 1 && v <= 168,
  idle_minutes: v => Number.isInteger(v) && v >= 5 && v <= 1440,
  password_min_length: v => Number.isInteger(v) && v >= 6 && v <= 64,
  max_failed_logins: v => Number.isInteger(v) && v >= 3 && v <= 20,
  lockout_minutes: v => Number.isInteger(v) && v >= 1 && v <= 1440,
};
r.get('/settings', G('settings_edit'), wrap(async (req, res) => res.json({ settings: await allSettings() })));
r.put('/settings', G('settings_edit'), wrap(async (req, res) => {
  const before = await allSettings(); const changed = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!SETTING_RULES[k]) throw httpError(400, `إعداد غير معروف: ${k}`);
    if (!SETTING_RULES[k](v)) throw httpError(400, `قيمة غير صالحة للإعداد ${k}`);
    if (before[k] !== v) { await setSetting(k, v, req.user.username); changed[k] = v; }
  }
  if (Object.keys(changed).length) await audit(req, 'update', 'platform_settings', null, Object.fromEntries(Object.keys(changed).map(k => [k, before[k]])), changed);
  res.json({ settings: await allSettings() });
}));
r.get('/conflicts', G('employees_view'), wrap(async (req, res) => {
  res.json({ conflicts: (await q('SELECT c.*, e.full_name FROM migration_conflicts c LEFT JOIN employees e ON e.id = c.employee_id ORDER BY resolved, id')).rows });
}));
r.put('/conflicts/:id/resolve', G('employees_edit'), wrap(async (req, res) => {
  await q('UPDATE migration_conflicts SET resolved = $2 WHERE id = $1', [req.params.id, req.body.resolved !== false]);
  await audit(req, 'resolve_conflict', 'migration_conflicts', req.params.id, null, { resolved: req.body.resolved !== false });
  res.json({ ok: true });
}));

export default r;
