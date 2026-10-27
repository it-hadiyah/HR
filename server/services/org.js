// خدمة الهيكل التنظيمي المركزية: وحدات هرمية (منشأة ← قطاع ← إدارة ← قسم) يستخدمها كل النظام.
// أي إضافة أو إعادة تسمية أو نقل تنعكس فوراً في كل المنصات؛ والتاريخ يُحفظ في db_change_log (قبل/بعد) وفي سجل التدقيق.
import { q, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { httpError } from '../lib/util.js';
import { resetOrgGraph } from '../lib/orggraph.js';

export const CHILD_TYPE = { org: 'sector', sector: 'department', department: 'section' };
export const TYPE_LABEL = { org: 'المنشأة', sector: 'قطاع', department: 'إدارة', section: 'قسم' };

export async function unitTree() {
  const units = (await q(`SELECT o.id, o.parent_id, o.unit_type, o.name, o.code, o.active, o.slug, o.sort_order,
      (SELECT count(*)::int FROM employees e WHERE e.org_unit_id = o.id AND e.status <> 'terminated') AS headcount
    FROM org_units o ORDER BY o.sort_order, o.id`)).rows;
  const heads = (await q("SELECT id, full_name, org_unit_id FROM employees WHERE unit_role = 'head' AND org_unit_id IS NOT NULL AND status <> 'terminated' ORDER BY unit_order, id")).rows;
  const byId = new Map(units.map(u => [u.id, { ...u, heads: heads.filter(h => h.org_unit_id === u.id).map(h => ({ id: h.id, name: h.full_name })), children: [] }]));
  let root = null;
  for (const u of byId.values()) { if (u.parent_id && byId.has(u.parent_id)) byId.get(u.parent_id).children.push(u); else root = root || u; }
  return root;
}

export async function createUnit({ parent_id, name, code }, req) {
  if (!name?.trim()) throw httpError(400, 'اسم الوحدة مطلوب');
  const p = (await q('SELECT id, unit_type FROM org_units WHERE id = $1', [parent_id])).rows[0];
  if (!p) throw httpError(400, 'الوحدة الأم غير موجودة');
  const type = CHILD_TYPE[p.unit_type];
  if (!type) throw httpError(400, 'لا يمكن إضافة وحدة تحت القسم');
  const order = (await q('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM org_units WHERE parent_id = $1', [parent_id])).rows[0].n;
  const row = (await q('INSERT INTO org_units(parent_id, unit_type, name, code, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *', [parent_id, type, name.trim(), code || null, order])).rows[0];
  resetOrgGraph();
  await audit(req, 'create', 'org_unit', row.id, null, row);
  return row;
}

/** إعادة تسمية / تعطيل / نقل وحدة إلى أم جديدة من النوع نفسه */
export async function updateUnit(id, patch, req) {
  const row = await withTx(async c => {
    const old = (await c.query('SELECT * FROM org_units WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!old) throw httpError(404, 'الوحدة غير موجودة');
    const next = { ...old };
    if (patch.name !== undefined) { if (!String(patch.name).trim()) throw httpError(400, 'اسم الوحدة مطلوب'); next.name = String(patch.name).trim(); }
    if (patch.code !== undefined) next.code = patch.code || null;
    if (patch.active !== undefined) {
      if (!old.parent_id && !patch.active) throw httpError(400, 'لا يمكن تعطيل جذر المنشأة');
      next.active = !!patch.active;
    }
    if (patch.sort_order !== undefined) next.sort_order = Number(patch.sort_order) || 0;
    if (patch.parent_id !== undefined && Number(patch.parent_id) !== old.parent_id) {
      if (!old.parent_id) throw httpError(400, 'لا يمكن نقل جذر المنشأة');
      const np = (await c.query('SELECT id, unit_type FROM org_units WHERE id = $1', [patch.parent_id])).rows[0];
      if (!np) throw httpError(400, 'الوحدة الأم الجديدة غير موجودة');
      if (CHILD_TYPE[np.unit_type] !== old.unit_type) throw httpError(400, 'لا يمكن النقل إلا تحت وحدة من المستوى نفسه');
      // منع الحلقات: الأم الجديدة يجب ألا تكون من فروع هذه الوحدة
      const loop = (await c.query(`WITH RECURSIVE t AS (SELECT id FROM org_units WHERE id = $1 UNION ALL SELECT o.id FROM org_units o JOIN t ON o.parent_id = t.id) SELECT 1 FROM t WHERE id = $2`, [id, np.id])).rows.length;
      if (loop) throw httpError(400, 'لا يمكن نقل الوحدة تحت أحد فروعها');
      next.parent_id = np.id;
    }
    await c.query('UPDATE org_units SET name=$2, code=$3, active=$4, sort_order=$5, parent_id=$6 WHERE id=$1', [id, next.name, next.code, next.active, next.sort_order, next.parent_id]);
    return { old, row: (await c.query('SELECT * FROM org_units WHERE id = $1', [id])).rows[0] };
  });
  resetOrgGraph();
  const moved = row.old.parent_id !== row.row.parent_id;
  await audit(req, moved ? 'move' : 'update', 'org_unit', id, row.old, row.row);
  return row.row;
}

export async function deleteUnit(id, req) {
  const old = (await q('SELECT * FROM org_units WHERE id = $1', [id])).rows[0];
  if (!old) throw httpError(404, 'الوحدة غير موجودة');
  if (!old.parent_id) throw httpError(400, 'لا يمكن حذف جذر المنشأة');
  const kids = (await q('SELECT 1 FROM org_units WHERE parent_id = $1 LIMIT 1', [id])).rows.length;
  const emps = (await q('SELECT 1 FROM employees WHERE org_unit_id = $1 LIMIT 1', [id])).rows.length;
  if (kids || emps) throw httpError(409, 'الوحدة تحتوي وحدات أو موظفين؛ انقلهم أولاً (أو عطّل الوحدة بدل حذفها)');
  await withTx(async c => {
    await c.query('DELETE FROM targets WHERE scope_type = $1 AND scope_id = $2', ['unit', id]);
    await c.query('UPDATE users SET org_unit_id = NULL WHERE org_unit_id = $1', [id]);
    await c.query('DELETE FROM org_units WHERE id = $1', [id]);
  });
  resetOrgGraph();
  await audit(req, 'delete', 'org_unit', id, old, null);
}

/** تاريخ وحدة: كل تغييراتها (من سجل تغييرات القاعدة) وتنقلات الموظفين منها وإليها */
export async function unitHistory(id) {
  const changes = (await q(`SELECT at, op, changed_cols, old_row, new_row, db_user, direct FROM db_change_log WHERE table_name = 'org_units' AND row_id = $1 ORDER BY id DESC LIMIT 200`, [String(id)])).rows;
  const moves = (await q(`SELECT h.moved_on, h.moved_by, h.reason, e.full_name, fu.name AS from_unit, tu.name AS to_unit
    FROM org_history h JOIN employees e ON e.id = h.employee_id LEFT JOIN org_units fu ON fu.id = h.from_unit_id LEFT JOIN org_units tu ON tu.id = h.to_unit_id
    WHERE h.from_unit_id = $1 OR h.to_unit_id = $1 ORDER BY h.id DESC LIMIT 200`, [id])).rows;
  return { changes, moves };
}
