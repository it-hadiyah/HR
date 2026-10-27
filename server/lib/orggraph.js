// رسم خفيف للهيكل والعلاقات الإدارية في الذاكرة (مئات السجلات): يحسب المدير المباشر والتابعين ونطاقات الوحدات
import { q } from '../db/pool.js';

let cache = { at: 0, g: null };
export const resetOrgGraph = () => { cache.at = 0; };

export async function orgGraph() {
  if (cache.g && Date.now() - cache.at < 3000) return cache.g;
  const [u, e] = await Promise.all([
    q('SELECT id, parent_id, unit_type, name FROM org_units WHERE active'),
    q("SELECT id, org_unit_id, unit_role, unit_order, manager_id FROM employees WHERE status <> 'terminated'"),
  ]);
  const units = new Map(u.rows.map(r => [r.id, r]));
  const emps = new Map(e.rows.map(r => [r.id, r]));
  const heads = new Map();                                    // وحدة → رؤساؤها بالترتيب
  for (const r of [...e.rows].sort((a, b) => a.unit_order - b.unit_order || a.id - b.id))
    if (r.unit_role === 'head' && r.org_unit_id) (heads.get(r.org_unit_id) || heads.set(r.org_unit_id, []).get(r.org_unit_id)).push(r.id);

  const managerOf = id => {
    const emp = emps.get(id);
    if (!emp) return null;
    if (emp.manager_id && emps.has(emp.manager_id)) return emp.manager_id;
    let unit = units.get(emp.org_unit_id);
    if (emp.unit_role === 'head') unit = unit && units.get(unit.parent_id);   // رئيس الوحدة يتبع رئيس الوحدة الأعلى
    while (unit) {
      const h = (heads.get(unit.id) || []).find(x => x !== id);
      if (h) return h;
      unit = units.get(unit.parent_id);
    }
    return null;
  };
  const byManager = new Map();
  for (const id of emps.keys()) { const m = managerOf(id); if (m) (byManager.get(m) || byManager.set(m, []).get(m)).push(id); }

  const subordinates = id => {                                // كل التابعين إدارياً (مباشرين وغير مباشرين)
    const out = new Set(); const stack = [id];
    while (stack.length) for (const x of byManager.get(stack.pop()) || []) if (!out.has(x) && x !== id) { out.add(x); stack.push(x); }
    return out;
  };
  const subtree = rootId => {
    const out = new Set(); const stack = [rootId];
    const kids = new Map();
    for (const r of units.values()) (kids.get(r.parent_id) || kids.set(r.parent_id, []).get(r.parent_id)).push(r.id);
    while (stack.length) { const x = stack.pop(); if (out.has(x)) continue; out.add(x); for (const k of kids.get(x) || []) stack.push(k); }
    return out;
  };
  const ancestorOfType = (unitId, type) => {
    for (let u = units.get(unitId); u; u = units.get(u.parent_id)) if (u.unit_type === type) return u.id;
    return null;
  };
  cache = { at: Date.now(), g: { units, emps, heads, managerOf, subordinates, subtree, ancestorOfType } };
  return cache.g;
}
