// خدمة المستخدمين والأدوار والصلاحيات: حساب الدخول (user) منفصل عن الموظف (employee) ويُربط به اختيارياً.
import bcrypt from 'bcryptjs';
import { q, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { httpError } from '../lib/util.js';
import { getSetting } from '../lib/settings.js';
import { invalidateGrants, SCOPES } from '../lib/rbac.js';
import { revokeUserSessions } from '../lib/sessions.js';

const USER_COLS = 'u.id, u.username, u.full_name, u.role, u.org_unit_id, u.employee_id, u.active, u.last_login_at, u.failed_logins, u.locked_until, u.must_change_password, u.created_at';

export async function listUsers() {
  const { rows } = await q(`SELECT ${USER_COLS}, e.full_name AS employee_name, o.name AS unit_name,
      coalesce((SELECT json_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles,
      (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN org_units o ON o.id = u.org_unit_id ORDER BY u.id`);
  return rows;
}

async function passwordPolicy(pw) {
  const min = Number(await getSetting('password_min_length', 8)) || 8;
  if (String(pw).length < min) throw httpError(400, `كلمة المرور ${min} أحرف على الأقل`);
}

async function superCount(c, excludeUserId = null) {
  return (await c.query(`SELECT count(DISTINCT u.id)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.is_super AND u.active AND ($1::int IS NULL OR u.id <> $1)`, [excludeUserId])).rows[0].n;
}

async function setRolesTx(c, userId, roleKeys) {
  const keys = [...new Set(roleKeys)];
  const roles = (await c.query('SELECT id, key FROM roles WHERE key = ANY($1)', [keys])).rows;
  if (roles.length !== keys.length) throw httpError(400, 'دور غير موجود');
  await c.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  for (const r of roles) await c.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)', [userId, r.id]);
  // users.role = الدور الأساسي (للتوافق مع نظام الإجازات)
  if (keys.length) await c.query('UPDATE users SET role = $2 WHERE id = $1', [userId, keys[0]]);
  return keys;
}

export async function createUser(b, req) {
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw httpError(400, 'اسم المستخدم 3 إلى 40 حرفاً إنجليزياً أو أرقاماً أو . _ -');
  await passwordPolicy(b.password || '');
  const roles = b.roles?.length ? b.roles : (b.role ? [b.role] : ['employee']);
  const emp = b.employee_id ? (await q('SELECT id, full_name FROM employees WHERE id = $1', [b.employee_id])).rows[0] : null;
  if (b.employee_id && !emp) throw httpError(400, 'الموظف غير موجود');
  const hash = await bcrypt.hash(String(b.password), 10);
  const row = await withTx(async c => {
    const u = (await c.query(`INSERT INTO users(username, full_name, password_hash, role, org_unit_id, employee_id, active, must_change_password)
      VALUES ($1,$2,$3,'employee',$4,$5,$6,$7) RETURNING id, username, full_name, role, org_unit_id, employee_id, active`,
    [username, b.full_name || emp?.full_name || username, hash, b.org_unit_id || null, emp?.id ?? null, b.active !== false, !!b.must_change_password])).rows[0];
    await setRolesTx(c, u.id, roles);
    return (await c.query('SELECT id, username, full_name, role, org_unit_id, employee_id, active FROM users WHERE id = $1', [u.id])).rows[0];
  });
  invalidateGrants();
  await audit(req, 'create', 'user', row.id, null, { ...row, roles });
  return row;
}

export async function updateUser(id, b, req) {
  const { before, after, roles } = await withTx(async c => {
    const before = (await c.query('SELECT id, username, full_name, role, org_unit_id, employee_id, active FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!before) throw httpError(404, 'المستخدم غير موجود');
    const self = req.user?.id === id;
    if (self && b.active === false) throw httpError(400, 'لا يمكنك تعطيل حسابك');
    if (b.password) await passwordPolicy(b.password);
    if (b.employee_id) { if (!(await c.query('SELECT 1 FROM employees WHERE id = $1', [b.employee_id])).rows.length) throw httpError(400, 'الموظف غير موجود'); }
    let rolesOut;
    if (Array.isArray(b.roles)) {
      rolesOut = await setRolesTx(c, id, b.roles);
      if (!(await superCount(c, null))) throw httpError(400, 'يجب أن يبقى مدير نظام فعّال واحد على الأقل');
    }
    if (b.active === false && (await superCount(c, id)) === 0 && (await c.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.is_super`, [id])).rows.length)
      throw httpError(400, 'يجب أن يبقى مدير نظام فعّال واحد على الأقل');
    const hash = b.password ? await bcrypt.hash(String(b.password), 10) : null;
    await c.query(`UPDATE users SET full_name = coalesce($2, full_name), active = coalesce($3, active), org_unit_id = CASE WHEN $4::boolean THEN $5 ELSE org_unit_id END,
        employee_id = CASE WHEN $6::boolean THEN $7 ELSE employee_id END, password_hash = coalesce($8, password_hash),
        must_change_password = coalesce($9, must_change_password), failed_logins = CASE WHEN $10 THEN 0 ELSE failed_logins END,
        locked_until = CASE WHEN $10 THEN NULL ELSE locked_until END WHERE id = $1`,
    [id, b.full_name || null, b.active ?? null, 'org_unit_id' in b, b.org_unit_id || null, 'employee_id' in b, b.employee_id || null, hash, b.must_change_password ?? null, !!b.unlock || !!b.password]);
    const after = (await c.query('SELECT id, username, full_name, role, org_unit_id, employee_id, active FROM users WHERE id = $1', [id])).rows[0];
    return { before, after, roles: rolesOut };
  });
  invalidateGrants(id);
  // تعطيل الحساب أو تغيير كلمة مروره ينهي كل جلساته فوراً
  let revoked = 0;
  if (b.active === false || b.password) revoked = await revokeUserSessions(id, req.user?.username, b.active === false ? 'تعطيل الحساب' : 'تغيير كلمة المرور', b.password && req.user?.id === id ? req.user.sessionId : null);
  await audit(req, b.active === false ? 'disable' : 'update', 'user', id, before, { ...after, roles, password_changed: !!b.password, sessions_revoked: revoked });
  return after;
}

// ── الأدوار والصلاحيات ──
export async function listRoles() {
  const roles = (await q(`SELECT r.*, (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS users FROM roles r ORDER BY r.is_system DESC, r.id`)).rows;
  const grants = (await q('SELECT role_id, app_slug, action, scope FROM role_grants')).rows;
  return roles.map(r => ({ ...r, grants: grants.filter(g => g.role_id === r.id).map(({ app_slug, action, scope }) => ({ app: app_slug, action, scope })) }));
}

export async function catalog() {
  const apps = (await q('SELECT slug, title, icon, active FROM apps ORDER BY sort_order, slug')).rows;
  const actions = (await q('SELECT app_slug, action, label FROM app_actions ORDER BY app_slug, sort_order')).rows;
  return { scopes: SCOPES, apps: apps.map(a => ({ ...a, actions: actions.filter(x => x.app_slug === a.slug).map(x => ({ action: x.action, label: x.label })) })) };
}

function checkGrants(list) {
  if (!Array.isArray(list)) throw httpError(400, 'قائمة صلاحيات غير صالحة');
  for (const g of list) if (!g.app || !g.action || (g.scope && !SCOPES.includes(g.scope))) throw httpError(400, 'صلاحية غير صالحة');
}

export async function saveRole(id, b, req) {
  const key = b.key ? String(b.key).trim() : null;
  const out = await withTx(async c => {
    let role;
    if (!id) {
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(key || '')) throw httpError(400, 'مفتاح الدور: حروف إنجليزية صغيرة وأرقام و _ (يبدأ بحرف)');
      if (!String(b.name || '').trim()) throw httpError(400, 'اسم الدور مطلوب');
      role = (await c.query('INSERT INTO roles(key, name, description) VALUES ($1,$2,$3) RETURNING *', [key, b.name.trim(), b.description || null])).rows[0];
    } else {
      const old = (await c.query('SELECT * FROM roles WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!old) throw httpError(404, 'الدور غير موجود');
      if (old.is_super && b.grants) throw httpError(400, 'دور مدير النظام يملك كل الصلاحيات ولا تُعدَّل صلاحياته');
      role = (await c.query('UPDATE roles SET name = coalesce($2, name), description = coalesce($3, description) WHERE id = $1 RETURNING *', [id, b.name?.trim() || null, b.description ?? null])).rows[0];
    }
    if (b.grants) {
      checkGrants(b.grants);
      await c.query('DELETE FROM role_grants WHERE role_id = $1', [role.id]);
      for (const g of b.grants) await c.query('INSERT INTO role_grants(role_id, app_slug, action, scope) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [role.id, g.app, g.action, g.scope || 'all']);
    }
    return role;
  });
  invalidateGrants();
  await audit(req, id ? 'update' : 'create', 'role', out.id, null, { key: out.key, name: out.name, grants: b.grants?.length });
  return out;
}

export async function deleteRole(id, req) {
  const role = (await q('SELECT * FROM roles WHERE id = $1', [id])).rows[0];
  if (!role) throw httpError(404, 'الدور غير موجود');
  if (role.is_system) throw httpError(409, 'الأدوار النظامية لا تُحذف');
  const used = (await q('SELECT count(*)::int AS n FROM user_roles WHERE role_id = $1', [id])).rows[0].n;
  if (used) throw httpError(409, `الدور مسند إلى ${used} مستخدم؛ انزعه منهم أولاً`);
  await q('DELETE FROM roles WHERE id = $1', [id]);
  invalidateGrants();
  await audit(req, 'delete', 'role', id, { key: role.key, name: role.name }, null);
}

export async function userGrants(userId) {
  return (await q('SELECT app_slug AS app, action, scope, effect FROM user_grants WHERE user_id = $1 ORDER BY app_slug, action', [userId])).rows;
}

/** استثناءات المستخدم الفردية: تستبدل القائمة كلها */
export async function saveUserGrants(userId, list, req) {
  checkGrants(list);
  const before = await userGrants(userId);
  await withTx(async c => {
    if (!(await c.query('SELECT 1 FROM users WHERE id = $1', [userId])).rows.length) throw httpError(404, 'المستخدم غير موجود');
    await c.query('DELETE FROM user_grants WHERE user_id = $1', [userId]);
    for (const g of list) await c.query('INSERT INTO user_grants(user_id, app_slug, action, scope, effect) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [userId, g.app, g.action, g.scope || 'all', g.effect === 'deny' ? 'deny' : 'allow']);
  });
  invalidateGrants(userId);
  await audit(req, 'update_grants', 'user', userId, before, await userGrants(userId));
}
