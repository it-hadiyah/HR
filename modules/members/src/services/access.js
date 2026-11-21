'use strict';
// الوصول والصلاحيات: حسابات الدخول من المنصة (public.users)، وصلاحيات هذا النظام من أدوار members.roles
// عبر جدول الربط members.role_map (دور المنصة ← دور النظام).
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const { bad, notFound, conflict } = require('../lib/errors');

// أدوار المنصة (public.users.role) وتسمياتها
const HR_ROLES = {
  admin: 'مدير النظام', hr: 'الموارد البشرية', finance: 'الإدارة المالية', executive: 'الإدارة العليا',
  sector_manager: 'مدير قطاع', department_manager: 'مدير إدارة', section_manager: 'مدير قسم', content_admin: 'مدير محتوى البوابة', employee: 'موظف',
};

async function permissionsOf(client, roleId) {
  return (await client.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1', [roleId])).rows.map((r) => r.code);
}

/** يحوّل مستخدم المنصة إلى مستخدم هذا النظام (الدور والصلاحيات) أو null إن لم يكن له دور مربوط */
async function resolveUser(hrUser) {
  const r = (await pool.query(
    `SELECT r.id AS role_id, r.code AS role_code, r.name_ar AS role_name FROM role_map m JOIN roles r ON r.id = m.role_id WHERE m.hr_role = $1`, [hrUser.role])).rows[0];
  if (!r) return null;
  return { id: hrUser.id, username: hrUser.username, full_name: hrUser.full_name, hr_role: hrUser.role,
    role_id: r.role_id, role_code: r.role_code, role_name: r.role_name, permissions: await permissionsOf(pool, r.role_id) };
}

async function listRoles() {
  const roles = (await pool.query('SELECT * FROM roles ORDER BY id')).rows;
  const perms = (await pool.query('SELECT * FROM permissions ORDER BY id')).rows;
  const rp = (await pool.query('SELECT role_id, permission_id FROM role_permissions')).rows;
  const map = (await pool.query('SELECT hr_role, role_id FROM role_map')).rows;
  return {
    roles: roles.map((r) => ({ ...r, permission_ids: rp.filter((x) => x.role_id === r.id).map((x) => x.permission_id) })),
    permissions: perms,
    hr_roles: Object.entries(HR_ROLES).map(([code, name_ar]) => ({ code, name_ar, role_id: map.find((m) => m.hr_role === code)?.role_id ?? null })),
  };
}

async function setRolePermissions(ctx, roleId, permissionIds) {
  return tx(async (c) => {
    const role = (await c.query('SELECT * FROM roles WHERE id=$1 FOR UPDATE', [roleId])).rows[0];
    if (!role) throw notFound('الدور غير موجود');
    if (role.code === 'admin') throw conflict('صلاحيات مدير النظام ثابتة', 'locked_role');
    const ids = [...new Set((permissionIds || []).map(Number).filter(Number.isInteger))];
    const valid = (await c.query('SELECT id, code FROM permissions WHERE id = ANY($1)', [ids])).rows;
    const before = (await permissionsOf(c, roleId)).sort();
    await c.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
    for (const p of valid) await c.query('INSERT INTO role_permissions VALUES ($1,$2)', [roleId, p.id]);
    const after = valid.map((p) => p.code).sort();
    await audit.log(c, ctx, { action: 'role.permissions', entity: 'role', entityId: roleId, before: { role: role.code, permissions: before }, after: { permissions: after } });
  });
}

/** ربط دور من أدوار المنصة بدور في هذا النظام (أو إزالة الربط بـ roleId=null) ويحدّث قائمة أدوار التطبيق في public.apps */
async function setRoleMap(ctx, hrRole, roleId) {
  if (!HR_ROLES[hrRole]) throw bad('دور المنصة غير معروف');
  if (hrRole === 'admin') throw conflict('ربط مدير النظام ثابت', 'locked_role');
  return tx(async (c) => {
    const before = (await c.query('SELECT r.code FROM role_map m JOIN roles r ON r.id=m.role_id WHERE m.hr_role=$1', [hrRole])).rows[0]?.code ?? null;
    let after = null;
    if (roleId === null || roleId === undefined || roleId === '') {
      await c.query('DELETE FROM role_map WHERE hr_role=$1', [hrRole]);
    } else {
      const role = (await c.query('SELECT id, code FROM roles WHERE id=$1', [Number(roleId)])).rows[0];
      if (!role) throw bad('الدور غير موجود');
      await c.query('INSERT INTO role_map (hr_role, role_id) VALUES ($1,$2) ON CONFLICT (hr_role) DO UPDATE SET role_id=EXCLUDED.role_id', [hrRole, role.id]);
      after = role.code;
    }
    const mapped = (await c.query('SELECT hr_role FROM role_map')).rows.map((r) => r.hr_role);
    await c.query(`UPDATE public.apps SET roles = $1 WHERE slug = 'members'`, [[...new Set(['admin', ...mapped])]]);
    await audit.log(c, ctx, { action: 'role.map', entity: 'role', entityId: hrRole, before: { members_role: before }, after: { members_role: after } });
  }).then(resetPlatformAppsCache);
}

/** المنصة تخزّن جدول apps مؤقتًا 15 ثانية؛ نفرّغه ليسري تغيير الربط فورًا */
async function resetPlatformAppsCache() {
  try { (await import('../../../../server/lib/apps.js')).resetAppsCache(); } catch { /* المنصة غير متاحة (مثلاً في أداة مستقلة) */ }
}

module.exports = { HR_ROLES, resolveUser, listRoles, setRolePermissions, setRoleMap, permissionsOf };
