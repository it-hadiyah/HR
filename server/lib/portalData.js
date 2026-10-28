// بيانات بوابة الموظفين في قاعدة البيانات: التحويل من/إلى نفس صيغة ملفات JSON القديمة،
// فتعمل صفحات البوابة ولوحة التحكم دون تغيير في طريقة قراءتها للبيانات.
import { httpError } from './util.js';
import { normalizeName } from './text.js';

export const FILES = ['employeeInfo.json', 'orgStructure.json', 'linksLibrary.json', 'PoliciesLibrary.json', 'locations.json', 'home.json', 'committees.json', 'recognition.json'];
export const READ_ONLY_FILES = ['brand.json'];
const ARRAY_FILES = ['employeeInfo.json', 'locations.json'];
const DOC_DEFAULTS = { home: {}, committees: { committees: [] }, recognition: { awards: [] }, brand: {} };
const HOME_GROUPS = ['oprations', 'orders', 'list'];
const EMP_KEYS = ['Extension', 'Name', 'Section', 'JobName', 'Photo', 'email'];

const str = v => (v === null || v === undefined ? null : String(v));
const orEmpty = v => v ?? '';
const slugify = s => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `unit-${Date.now()}`;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// ───────────── التصدير (قاعدة البيانات ← JSON) ─────────────
async function exportEmployees(db) {
  const { rows } = await db.query("SELECT * FROM employees WHERE extension IS NOT NULL AND show_in_directory AND status = 'active' ORDER BY sort_order, id");
  return rows.map(p => ({
    Extension: p.extension, Name: p.full_name, Section: orEmpty(p.section), JobName: orEmpty(p.job_title),
    Photo: orEmpty(p.photo), email: orEmpty(p.email), ...p.extra,
  }));
}

async function exportOrg(db) {
  const { rows: units } = await db.query('SELECT id, parent_id, slug, name, portal_kind FROM org_units WHERE slug IS NOT NULL AND active ORDER BY sort_order, id');
  const { rows: ppl } = await db.query("SELECT extension, org_unit_id, unit_role FROM employees WHERE org_unit_id IS NOT NULL AND extension IS NOT NULL AND show_in_directory AND status = 'active' ORDER BY unit_order, id");
  const ids = new Set(units.map(u => u.id));
  const kids = new Map();
  for (const u of units) { const k = ids.has(u.parent_id) ? u.parent_id : 0; (kids.get(k) || kids.set(k, []).get(k)).push(u); }
  const staff = new Map();
  for (const p of ppl) (staff.get(p.org_unit_id) || staff.set(p.org_unit_id, []).get(p.org_unit_id)).push(p);
  const build = u => {
    const node = { id: u.slug, title: u.name };
    if (u.portal_kind) node.kind = u.portal_kind;
    const s = staff.get(u.id) || [];
    const heads = s.filter(p => p.unit_role === 'head').map(p => p.extension);
    const members = s.filter(p => p.unit_role !== 'head').map(p => p.extension);
    if (heads.length) node.heads = heads;
    if (members.length) node.members = members;
    const ch = (kids.get(u.id) || []).map(build);
    if (ch.length) node.children = ch;
    return node;
  };
  return { sections: (kids.get(0) || []).map(build) };
}

async function exportLinks(db) {
  const cats = (await db.query('SELECT id, name FROM link_categories ORDER BY sort_order, id')).rows;
  const links = (await db.query('SELECT * FROM links ORDER BY sort_order, id')).rows;
  const item = (l, full) => {
    const o = { name: l.name, description: orEmpty(l.description), url: orEmpty(l.url) };
    if (l.image || full) o.image = orEmpty(l.image);
    return o;
  };
  const categories = {};
  for (const c of cats) categories[c.name] = links.filter(l => l.category_id === c.id).map(l => item(l));
  const most_important = {};
  for (const g of HOME_GROUPS) most_important[g] = links.filter(l => l.home_group === g).map(l => item(l));
  return { categories, most_important };
}

async function exportPolicies(db) {
  const cats = (await db.query('SELECT id, name FROM policy_categories ORDER BY sort_order, id')).rows;
  const pol = (await db.query('SELECT * FROM policies ORDER BY sort_order, id')).rows;
  const categories = {};
  for (const c of cats) categories[c.name] = pol.filter(p => p.category_id === c.id).map(p => ({ name: p.name, file: orEmpty(p.file), description: orEmpty(p.description) }));
  return { categories };
}

async function exportLocations(db) {
  const { rows } = await db.query('SELECT * FROM locations ORDER BY sort_order, id');
  return rows.map(l => ({ branch: l.branch, branchPhoto: orEmpty(l.photo), mapLink: orEmpty(l.map_link) }));
}

export async function exportFile(db, file) {
  switch (file) {
    case 'employeeInfo.json': return exportEmployees(db);
    case 'orgStructure.json': return exportOrg(db);
    case 'linksLibrary.json': return exportLinks(db);
    case 'PoliciesLibrary.json': return exportPolicies(db);
    case 'locations.json': return exportLocations(db);
    default: {
      const name = file.replace(/\.json$/, '');
      if (!(name in DOC_DEFAULTS)) throw httpError(400, 'ملف غير مسموح.');
      const { rows } = await db.query('SELECT data FROM portal_docs WHERE name = $1', [name]);
      return rows[0]?.data ?? DOC_DEFAULTS[name];
    }
  }
}

// ───────────── الحفظ (JSON ← قاعدة البيانات)؛ يُستدعى داخل معاملة ─────────────
// حفظ دليل البوابة في جدول الموظفين المركزي. من حُذف من القائمة يُخفى من الدليل فقط (show_in_directory) ولا يُحذف سجله
async function saveEmployees(c, arr) {
  const seen = new Set();
  // موظف موجود في السجل المركزي بلا تحويلة (مثلاً من استيراد الإجازات) يُربط بالدليل بالاسم بدل إنشاء سجل مكرر
  const noExt = new Map();
  for (const r of (await c.query('SELECT id, full_name FROM employees WHERE extension IS NULL')).rows) { const k = normalizeName(r.full_name); noExt.set(k, [...(noExt.get(k) || []), r.id]); }
  const known = new Set((await c.query('SELECT extension FROM employees WHERE extension IS NOT NULL')).rows.map(r => r.extension));
  for (const [i, e] of arr.entries()) {
    if (!isObj(e)) throw httpError(400, 'بنية الموظفين غير صحيحة.');
    const ext = Number(e.Extension);
    if (!Number.isInteger(ext)) throw httpError(400, `الرقم الداخلي غير صالح للموظف «${e.Name ?? i + 1}».`);
    if (seen.has(ext)) throw httpError(400, `الرقم الداخلي ${ext} مكرر.`);
    if (!String(e.Name ?? '').trim()) throw httpError(400, `اسم الموظف صاحب التحويلة ${ext} فارغ.`);
    seen.add(ext);
    const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !EMP_KEYS.includes(k)));
    if (!known.has(ext)) {
      const cand = noExt.get(normalizeName(e.Name));
      if (cand?.length === 1) {
        await c.query('UPDATE employees SET extension=$2, section=$3, photo=$4, email=coalesce(email,$5), sort_order=$6, extra=$7, show_in_directory=TRUE, version=version+1, updated_at=now() WHERE id=$1',
          [cand[0], ext, str(e.Section), str(e.Photo), str(e.email), i, JSON.stringify(extra)]);
        noExt.delete(normalizeName(e.Name)); known.add(ext);
        continue;
      }
    }
    await c.query(`INSERT INTO employees(extension, full_name, section, job_title, photo, email, sort_order, extra, leave_enabled, status, show_in_directory)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,'active',TRUE)
      ON CONFLICT (extension) WHERE extension IS NOT NULL DO UPDATE SET full_name = EXCLUDED.full_name, section = EXCLUDED.section, job_title = EXCLUDED.job_title,
        photo = EXCLUDED.photo, email = EXCLUDED.email, sort_order = EXCLUDED.sort_order, extra = EXCLUDED.extra, show_in_directory = TRUE, version = employees.version + 1, updated_at = now()
      WHERE (employees.full_name, employees.section, employees.job_title, employees.photo, employees.email, employees.sort_order, employees.extra, employees.show_in_directory)
        IS DISTINCT FROM (EXCLUDED.full_name, EXCLUDED.section, EXCLUDED.job_title, EXCLUDED.photo, EXCLUDED.email, EXCLUDED.sort_order, EXCLUDED.extra, TRUE)`,
    [ext, String(e.Name).trim(), str(e.Section), str(e.JobName), str(e.Photo), str(e.email), i, JSON.stringify(extra)]);
  }
  await c.query('UPDATE employees SET show_in_directory = FALSE, version = version + 1, updated_at = now() WHERE extension IS NOT NULL AND show_in_directory AND status <> \'suspended\' AND extension <> ALL($1::int[])', [[...seen]]);
}

async function saveOrg(c, doc, user) {
  const root = (await c.query("SELECT id FROM org_units WHERE unit_type = 'org' ORDER BY id LIMIT 1")).rows[0];
  if (!root) throw httpError(500, 'لا توجد وحدة جذر للمنشأة؛ شغّل db:seed أولاً.');
  const keep = new Set();
  const placements = [];
  let order = 0;
  const walk = async (node, parentId, depth) => {
    if (!isObj(node) || !String(node.title ?? '').trim()) throw httpError(400, 'وحدة تنظيمية بلا اسم.');
    const slug = String(node.id || slugify(node.title));
    if (keep.has(slug)) throw httpError(400, `معرّف الوحدة «${slug}» مكرر.`);
    keep.add(slug);
    const type = depth === 1 ? 'sector' : depth === 2 ? 'department' : 'section';
    const found = (await c.query('SELECT id FROM org_units WHERE slug = $1', [slug])).rows[0];
    let id;
    if (found) {
      id = found.id;
      await c.query('UPDATE org_units SET parent_id=$2, unit_type=$3, name=$4, portal_kind=$5, sort_order=$6, active=TRUE WHERE id=$1',
        [id, parentId, type, String(node.title).trim(), node.kind || null, order++]);
    } else {
      id = (await c.query('INSERT INTO org_units(parent_id, unit_type, name, slug, portal_kind, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [parentId, type, String(node.title).trim(), slug, node.kind || null, order++])).rows[0].id;
    }
    (node.heads || []).forEach((ext, i) => placements.push([id, 'head', i, ext]));
    (node.members || []).forEach((ext, i) => placements.push([id, 'member', i, ext]));
    for (const ch of node.children || []) await walk(ch, id, depth + 1);
  };
  for (const s of doc.sections || []) await walk(s, root.id, 1);

  // الوحدات التي لم تعد في الملف: تُحذف إن لم يرتبط بها موظفون، وإلا تُخفى من البوابة فقط
  const stale = (await c.query('SELECT id FROM org_units WHERE slug IS NOT NULL AND slug <> ALL($1::text[])', [[...keep]])).rows.map(r => r.id);
  const slugged = new Set((await c.query('SELECT id FROM org_units WHERE slug IS NOT NULL')).rows.map(r => r.id));
  const cur = new Map((await c.query('SELECT id, extension, org_unit_id, unit_role, unit_order, leave_enabled FROM employees WHERE extension IS NOT NULL')).rows.map(r => [r.extension, r]));
  const placed = new Set();
  for (const [unit, role, i, extRaw] of placements) {
    const e = cur.get(Number(extRaw));
    if (!e) continue;
    placed.add(e.extension);
    if (e.org_unit_id !== unit) {      // نقل موظف بين الوحدات: ينعكس في كل المنصات ويُسجَّل تاريخه
      await c.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,$2,$3,CURRENT_DATE,$4,$5)', [e.id, e.org_unit_id, unit, user ?? null, 'لوحة تحكم البوابة']);
    }
    await c.query(`UPDATE employees SET org_unit_id = $2, unit_role = $3, unit_order = $4, version = version + 1, updated_at = now() WHERE id = $1
      AND (org_unit_id, unit_role, unit_order) IS DISTINCT FROM ($2::int, $3::text, $4::int)`, [e.id, unit, role, i]);
  }
  // من لم يُذكر في الهيكل: من له ملف إجازات يبقى في وحدته (دون دور)، وغيره يخرج من الوحدة
  for (const e of cur.values()) {
    if (placed.has(e.extension) || !slugged.has(e.org_unit_id)) continue;
    if (e.leave_enabled) await c.query('UPDATE employees SET unit_role = NULL, unit_order = 0, version = version + 1, updated_at = now() WHERE id = $1 AND unit_role IS NOT NULL', [e.id]);
    else await c.query('UPDATE employees SET org_unit_id = NULL, unit_role = NULL, unit_order = 0, version = version + 1, updated_at = now() WHERE id = $1', [e.id]);
  }
  let pending = stale;
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const left = [];
    for (const id of pending) {
      await c.query('SAVEPOINT del');
      try { await c.query('DELETE FROM org_units WHERE id = $1', [id]); await c.query('RELEASE SAVEPOINT del'); }
      catch (err) { await c.query('ROLLBACK TO SAVEPOINT del'); if (err.code !== '23503') throw err; left.push(id); }
    }
    pending = left;
  }
  if (pending.length) await c.query('UPDATE org_units SET slug = NULL, portal_kind = NULL WHERE id = ANY($1::int[])', [pending]);
}

async function saveLinks(c, doc) {
  await c.query('DELETE FROM links');
  await c.query('DELETE FROM link_categories');
  let ci = 0;
  for (const [name, list] of Object.entries(doc.categories || {})) {
    const cat = (await c.query('INSERT INTO link_categories(name, sort_order) VALUES ($1,$2) RETURNING id', [name, ci++])).rows[0];
    for (const [i, l] of (list || []).entries())
      await c.query('INSERT INTO links(category_id, name, description, url, image, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [cat.id, l.name, str(l.description), str(l.url), str(l.image), i]);
  }
  for (const g of HOME_GROUPS)
    for (const [i, l] of ((doc.most_important || {})[g] || []).entries())
      await c.query('INSERT INTO links(home_group, name, description, url, image, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [g, l.name, str(l.description), str(l.url), str(l.image), i]);
}

async function savePolicies(c, doc) {
  await c.query('DELETE FROM policy_categories');
  let ci = 0;
  for (const [name, list] of Object.entries(doc.categories || {})) {
    const cat = (await c.query('INSERT INTO policy_categories(name, sort_order) VALUES ($1,$2) RETURNING id', [name, ci++])).rows[0];
    for (const [i, p] of (list || []).entries())
      await c.query('INSERT INTO policies(category_id, name, file, description, sort_order) VALUES ($1,$2,$3,$4,$5)', [cat.id, p.name, str(p.file), str(p.description), i]);
  }
}

async function saveLocations(c, arr) {
  await c.query('DELETE FROM locations');
  for (const [i, l] of arr.entries())
    await c.query('INSERT INTO locations(branch, photo, map_link, sort_order) VALUES ($1,$2,$3,$4)', [l.branch, str(l.branchPhoto), str(l.mapLink), i]);
}

export async function saveFile(c, file, data, user) {
  if (!FILES.includes(file)) throw httpError(400, 'ملف غير مسموح.');
  if (ARRAY_FILES.includes(file) ? !Array.isArray(data) : !isObj(data)) throw httpError(400, 'بنية البيانات غير صحيحة لهذا الملف، لم يُحفظ شيء.');
  switch (file) {
    case 'employeeInfo.json': return saveEmployees(c, data);
    case 'orgStructure.json': return saveOrg(c, data, user);
    case 'linksLibrary.json': return saveLinks(c, data);
    case 'PoliciesLibrary.json': return savePolicies(c, data);
    case 'locations.json': return saveLocations(c, data);
    default:
      return c.query(`INSERT INTO portal_docs(name, data, updated_by) VALUES ($1,$2,$3)
        ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [file.replace(/\.json$/, ''), JSON.stringify(data), user ?? null]);
  }
}

export async function saveDoc(c, name, data, user) {
  await c.query(`INSERT INTO portal_docs(name, data, updated_by) VALUES ($1,$2,$3)
    ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`, [name, JSON.stringify(data), user ?? null]);
}
