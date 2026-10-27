// خدمة الموظفين المركزية: المصدر الوحيد لبيانات الموظفين في كل المنصات (جدول employees).
// كل المنصات (البوابة، البطاقة، الإجازات، لوحة الإدارة) تقرأ وتكتب من هنا؛ التعديل يظهر فوراً في الجميع لأن السجل واحد.
import { q, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { httpError } from '../lib/util.js';
import { normalizeName } from '../lib/text.js';
import { resetOrgGraph } from '../lib/orggraph.js';
import { inScope } from '../lib/rbac.js';

// الحقول المشتركة (بدون أي حقل مالي أو خاص بنظام الإجازات)
export const IDENTITY = ['id', 'emp_no', 'full_name', 'name_en', 'job_title', 'job_title_en', 'email', 'mobile', 'extension', 'photo', 'section', 'org_unit_id', 'manager_id',
  'status', 'hire_date', 'termination_date', 'unit_role', 'unit_order', 'show_in_directory', 'leave_enabled', 'version'];
const PATCHABLE = ['emp_no', 'full_name', 'name_en', 'job_title', 'job_title_en', 'email', 'mobile', 'extension', 'photo', 'section', 'org_unit_id', 'manager_id',
  'status', 'hire_date', 'termination_date', 'unit_role', 'unit_order', 'show_in_directory'];
const pick = (row, keys = IDENTITY) => Object.fromEntries(keys.filter(k => k in row).map(k => [k, row[k]]));
const blank = v => (v === '' || v === undefined ? null : v);

function clean(input) {
  const o = {};
  for (const k of PATCHABLE) if (k in input) o[k] = blank(typeof input[k] === 'string' ? input[k].trim() : input[k]);
  if ('full_name' in o && !o.full_name) throw httpError(400, 'اسم الموظف مطلوب');
  if ('extension' in o && o.extension !== null) {
    const n = Number(o.extension);
    if (!Number.isInteger(n) || n < 0 || n > 99999999) throw httpError(400, 'رقم التحويلة يجب أن يكون رقماً صحيحاً');
    o.extension = n;
  }
  if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) throw httpError(400, 'البريد الإلكتروني غير صالح');
  if (o.status && !['active', 'suspended', 'terminated'].includes(o.status)) throw httpError(400, 'حالة وظيفية غير صالحة');
  if (o.unit_role && !['head', 'member'].includes(o.unit_role)) throw httpError(400, 'دور الوحدة غير صالح');
  for (const k of ['org_unit_id', 'manager_id', 'unit_order']) if (k in o && o[k] !== null) { o[k] = Number(o[k]); if (!Number.isInteger(o[k])) throw httpError(400, `قيمة غير صالحة: ${k}`); }
  if ('show_in_directory' in o) o.show_in_directory = o.show_in_directory === null ? true : !!o.show_in_directory;
  return o;
}

const SELECT = `SELECT e.*, u.name AS unit_name,
    (SELECT s.name FROM org_units s WHERE s.unit_type = 'sector' AND s.id IN (WITH RECURSIVE a AS (SELECT id, parent_id FROM org_units WHERE id = e.org_unit_id UNION ALL SELECT o.id, o.parent_id FROM org_units o JOIN a ON o.id = a.parent_id) SELECT id FROM a)) AS sector_name,
    m.full_name AS manager_name
  FROM employees e LEFT JOIN org_units u ON u.id = e.org_unit_id LEFT JOIN employees m ON m.id = e.manager_id`;

export async function getEmployee(id, db = { query: q }) {
  const { rows } = await db.query(`${SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ?? null;
}

/** قائمة الموظفين مع بحث وترقيم، ضمن نطاق المستخدم (sc من resolveScope) */
export async function listEmployees({ search = '', unit, status, leave, page = 1, pageSize = 50, sc = { all: true } } = {}) {
  const where = ['TRUE']; const p = [];
  if (search) { p.push(`%${search}%`); where.push(`(e.full_name ILIKE $${p.length} OR e.name_en ILIKE $${p.length} OR e.email ILIKE $${p.length} OR e.emp_no ILIKE $${p.length} OR e.extension::text ILIKE $${p.length} OR e.job_title ILIKE $${p.length})`); }
  if (status) { p.push(status); where.push(`e.status = $${p.length}`); }
  if (leave === 'true' || leave === 'false') where.push(`e.leave_enabled = ${leave}`);
  if (unit) { p.push(+unit); where.push(`e.org_unit_id IN (WITH RECURSIVE t AS (SELECT id FROM org_units WHERE id = $${p.length} UNION ALL SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT id FROM t)`); }
  if (!sc.all) {
    const parts = [];
    if (sc.unitIds?.size) { p.push([...sc.unitIds]); parts.push(`e.org_unit_id = ANY($${p.length}::int[])`); }
    if (sc.employeeIds?.size) { p.push([...sc.employeeIds]); parts.push(`e.id = ANY($${p.length}::int[])`); }
    where.push(parts.length ? `(${parts.join(' OR ')})` : 'FALSE');
  }
  const limit = Math.min(Math.max(+pageSize || 50, 1), 1000), offset = (Math.max(+page || 1, 1) - 1) * limit;
  const total = (await q(`SELECT count(*)::int AS n FROM employees e WHERE ${where.join(' AND ')}`, p)).rows[0].n;
  const rows = (await q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.sort_order, e.full_name, e.id LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return { total, page: Math.floor(offset / limit) + 1, pageSize: limit, employees: rows.map(r => pick(r, [...IDENTITY, 'unit_name', 'sector_name', 'manager_name'])) };
}

async function checkRefs(db, o, selfId = null) {
  if (o.org_unit_id) {
    if (!(await db.query('SELECT 1 FROM org_units WHERE id = $1 AND active', [o.org_unit_id])).rows.length) throw httpError(400, 'الوحدة التنظيمية غير موجودة');
  }
  if (o.manager_id) {
    if (o.manager_id === selfId) throw httpError(400, 'لا يمكن أن يكون الموظف مديراً لنفسه');
    if (!(await db.query('SELECT 1 FROM employees WHERE id = $1', [o.manager_id])).rows.length) throw httpError(400, 'المدير المباشر غير موجود');
    // منع الحلقات في سلسلة الإدارة
    let cur = o.manager_id;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === selfId) throw httpError(400, 'هذا الاختيار يُنشئ حلقة في سلسلة الإدارة');
      cur = (await db.query('SELECT manager_id FROM employees WHERE id = $1', [cur])).rows[0]?.manager_id ?? null;
    }
  }
}

export async function createEmployee(input, req) {
  const o = clean(input);
  if (!o.full_name) throw httpError(400, 'اسم الموظف مطلوب');
  const row = await withTx(async c => {
    await checkRefs(c, o);
    const cols = Object.keys(o);
    const { rows } = await c.query(`INSERT INTO employees(${cols.join(',')}, leave_enabled) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, FALSE) RETURNING *`, cols.map(k => o[k]));
    if (rows[0].org_unit_id) await c.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,NULL,$2,CURRENT_DATE,$3,$4)',
      [rows[0].id, rows[0].org_unit_id, req?.user?.username ?? null, 'إضافة موظف']);
    return rows[0];
  });
  resetOrgGraph();
  await audit(req, 'create', 'employee', row.id, null, pick(row));
  return row;
}

/** تعديل موظف. expectedVersion اختياري: إن لم يطابق يُرفض التعديل (تعارض تعديلين متزامنين) */
export async function updateEmployee(id, input, req, { expectedVersion = null } = {}) {
  const o = clean(input);
  const { before, after } = await withTx(async c => {
    const before = (await c.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!before) throw httpError(404, 'الموظف غير موجود');
    if (expectedVersion !== null && Number(expectedVersion) !== before.version) throw httpError(409, 'تم تعديل هذا السجل من مستخدم آخر؛ أعد تحميله ثم عدّل');
    await checkRefs(c, o, id);
    const cols = Object.keys(o).filter(k => o[k] !== before[k] && !(o[k] instanceof Date));
    if (!cols.length) return { before, after: before };
    const set = cols.map((k, i) => `${k} = $${i + 2}`);
    const after = (await c.query(`UPDATE employees SET ${set.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...cols.map(k => o[k])])).rows[0];
    if ('org_unit_id' in o && before.org_unit_id !== after.org_unit_id)
      await c.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,$2,$3,CURRENT_DATE,$4,$5)',
        [id, before.org_unit_id, after.org_unit_id, req?.user?.username ?? null, input.move_reason ?? null]);
    return { before, after };
  });
  if (before !== after) {
    resetOrgGraph();
    const moved = before.org_unit_id !== after.org_unit_id;
    const photo = before.photo !== after.photo;
    await audit(req, moved ? 'move' : photo ? 'update_photo' : 'update', 'employee', id, pick(before), pick(after));
  }
  return after;
}

export async function deleteEmployee(id, req) {
  const before = (await q('SELECT * FROM employees WHERE id = $1', [id])).rows[0];
  if (!before) throw httpError(404, 'الموظف غير موجود');
  const used = (await q('SELECT (SELECT count(*) FROM leave_transactions WHERE employee_id = $1) AS tx, (SELECT count(*) FROM users WHERE employee_id = $1) AS u', [id])).rows[0];
  if (+used.tx) throw httpError(409, 'للموظف حركات إجازات؛ غيّر حالته إلى «منتهي الخدمة» بدل الحذف');
  if (+used.u) throw httpError(409, 'مرتبط بحساب دخول؛ عطّل الحساب أو افصله أولاً');
  await withTx(async c => {
    await c.query('DELETE FROM targets WHERE scope_type = $1 AND scope_id = $2', ['employee', id]);
    await c.query('DELETE FROM employees WHERE id = $1', [id]);
  });
  resetOrgGraph();
  await audit(req, 'delete', 'employee', id, pick(before), null);
}

/** يدمج سجلين مكررين: كل ما يرتبط بالمحذوف يُنقل إلى المُبقى ثم يُحذف المكرر. الحقول الفارغة في المُبقى تُملأ من المكرر. */
export async function mergeEmployees(keepId, dropId, req) {
  if (keepId === dropId) throw httpError(400, 'اختر سجلين مختلفين');
  const merged = await withTx(async c => {
    const keep = (await c.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [keepId])).rows[0];
    const drop = (await c.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [dropId])).rows[0];
    if (!keep || !drop) throw httpError(404, 'أحد السجلين غير موجود');
    if (keep.leave_enabled && drop.leave_enabled) throw httpError(409, 'كلا السجلين لهما ملف إجازات؛ لا يمكن الدمج تلقائياً');
    // يجب إفراغ القيم الفريدة في المحذوف قبل نقلها
    await c.query('UPDATE employees SET extension = NULL, emp_no = NULL WHERE id = $1', [dropId]);
    const fill = {};
    for (const k of ['emp_no', 'extension', 'name_en', 'job_title', 'job_title_en', 'email', 'mobile', 'photo', 'section', 'org_unit_id', 'unit_role', 'hire_date']) if (keep[k] === null && drop[k] !== null) fill[k] = drop[k];
    if (drop.leave_enabled) Object.assign(fill, Object.fromEntries(['basic_salary', 'leave_salary_override', 'annual_entitlement_days', 'opening_balance', 'opening_date', 'termination_date', 'org_unit_id', 'hire_date', 'emp_no']
      .filter(k => drop[k] !== null).map(k => [k, drop[k]])), { leave_enabled: true });
    for (const t of ['leave_transactions', 'employee_allowances', 'salary_history', 'org_history']) await c.query(`UPDATE ${t} SET employee_id = $1 WHERE employee_id = $2`, [keepId, dropId]);
    await c.query("UPDATE targets SET scope_id = $1 WHERE scope_type = 'employee' AND scope_id = $2 AND NOT EXISTS (SELECT 1 FROM targets x WHERE x.scope_type = 'employee' AND x.scope_id = $1 AND x.year = targets.year)", [keepId, dropId]);
    await c.query("DELETE FROM targets WHERE scope_type = 'employee' AND scope_id = $1", [dropId]);
    await c.query('UPDATE users SET employee_id = $1 WHERE employee_id = $2', [keepId, dropId]);
    await c.query('UPDATE employees SET manager_id = $1 WHERE manager_id = $2', [keepId, dropId]);
    await c.query('UPDATE snapshot_rows SET employee_id = $1 WHERE employee_id = $2 AND NOT EXISTS (SELECT 1 FROM snapshot_rows x WHERE x.snapshot_id = snapshot_rows.snapshot_id AND x.employee_id = $1)', [keepId, dropId]);
    await c.query('UPDATE people SET migrated_employee_id = $1 WHERE migrated_employee_id = $2', [keepId, dropId]);
    await c.query('DELETE FROM employees WHERE id = $1', [dropId]);
    const cols = Object.keys(fill);
    if (cols.length) await c.query(`UPDATE employees SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() WHERE id = $1`, [keepId, ...cols.map(k => fill[k])]);
    return { keep: pick(keep), drop: pick(drop), filled: cols };
  });
  resetOrgGraph();
  await audit(req, 'merge', 'employee', keepId, merged.drop, { kept: merged.keep.id, filled: merged.filled });
  return merged;
}

/** أسماء متقاربة قد تكون لشخص واحد (للمراجعة قبل الدمج) */
export async function findDuplicates() {
  const { rows } = await q('SELECT id, full_name, emp_no, extension, email, leave_enabled, org_unit_id FROM employees ORDER BY id');
  const by = new Map();
  for (const r of rows) { const k = normalizeName(r.full_name); (by.get(k) || by.set(k, []).get(k)).push(r); }
  const byEmail = new Map();
  for (const r of rows) if (r.email) { const k = r.email.toLowerCase(); (byEmail.get(k) || byEmail.set(k, []).get(k)).push(r); }
  return [...[...by.values()].filter(g => g.length > 1).map(g => ({ reason: 'اسم متطابق', employees: g })),
    ...[...byEmail.values()].filter(g => g.length > 1).map(g => ({ reason: 'بريد متطابق', employees: g }))];
}

/** دليل الموظفين للقراءة (البطاقة والبحث): الحقول العامة فقط ضمن نطاق المستخدم */
export async function directory(sc, search = "", limit = 1000) {
  const { employees } = await listEmployees({ search, sc, pageSize: Math.min(limit, 1000), status: undefined });
  return employees.filter(e => e.status !== 'terminated').map(e => ({
    id: e.id, employee_no: e.emp_no, extension: e.extension, name_ar: e.full_name, name_en: e.name_en, job_title: e.job_title, job_title_en: e.job_title_en,
    unit_name: e.unit_name, sector_name: e.sector_name, photo_url: e.photo ? `/portal/${e.photo}` : null,
  }));
}
export { inScope };
