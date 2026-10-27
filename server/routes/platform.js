// الصفحة الموحّدة: قائمة التطبيقات للمستخدم، ودليل الأشخاص، وربط الأشخاص بموظفي الموارد البشرية
import { Router } from 'express';
import { q } from '../db/pool.js';
import { wrap, can, audit, ROLE_LABELS } from '../lib/auth.js';
import { listApps, canUseApp } from '../lib/apps.js';
import { autoLink } from '../lib/people.js';
import { httpError } from '../lib/util.js';

const r = Router();

r.get('/launcher', wrap(async (req, res) => {
  const u = req.user;
  const apps = (await listApps()).filter(a => u.role === 'admin' || a.roles.includes(u.role))
    .map(({ slug, title, description, icon, path }) => ({ slug, title, description, icon, path }));
  const person = u.person_id ? (await q('SELECT id, full_name, job_title, photo FROM people WHERE id = $1', [u.person_id])).rows[0] : null;
  res.json({ user: { username: u.username, full_name: u.full_name, role: u.role, role_label: ROLE_LABELS[u.role], person }, apps });
}));

// دليل الأشخاص (لبطاقة الموظف وغيرها): بحث بالاسم أو الرقم الداخلي أو البريد
r.get('/people', wrap(async (req, res) => {
  if (!(await canUseApp(req.user, 'portal')) && !(await canUseApp(req.user, 'card'))) throw httpError(403, 'غير مسموح');
  const term = `%${String(req.query.q || '').trim()}%`;
  const { rows } = await q(`SELECT p.id, p.extension, p.full_name, p.job_title, p.email, p.photo, u.name AS unit_name, e.id AS employee_id
    FROM people p LEFT JOIN org_units u ON u.id = p.org_unit_id LEFT JOIN employees e ON e.person_id = p.id
    WHERE p.extension IS NOT NULL AND ($1 = '%%' OR p.full_name ILIKE $1 OR p.email ILIKE $1 OR p.extension::text ILIKE $1)
    ORDER BY p.sort_order, p.id LIMIT 300`, [term]);
  res.json({ people: rows.map(p => ({ ...p, photo_url: p.photo ? `/portal/${p.photo}` : null })) });
}));

const hrOnly = (req, res, next) => (can(req.user, 'employees') ? next() : res.status(403).json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' }));

// حالة الربط بين دليل الأشخاص وموظفي الموارد البشرية
r.get('/people/link-status', hrOnly, wrap(async (req, res) => {
  const unlinkedEmployees = (await q('SELECT id, emp_no, full_name FROM employees WHERE person_id IS NULL ORDER BY full_name')).rows;
  const unlinkedPeople = (await q('SELECT p.id, p.extension, p.full_name FROM people p WHERE p.extension IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.person_id = p.id) ORDER BY p.full_name')).rows;
  const linked = (await q('SELECT count(*)::int AS n FROM employees WHERE person_id IS NOT NULL')).rows[0].n;
  res.json({ linked, unlinked_employees: unlinkedEmployees, unlinked_people: unlinkedPeople });
}));

r.post('/people/auto-link', hrOnly, wrap(async (req, res) => {
  const out = await autoLink();
  await audit(req, 'auto_link', 'people', '', null, out);
  res.json(out);
}));

r.put('/people/:id/link', hrOnly, wrap(async (req, res) => {
  const pid = +req.params.id;
  const eid = req.body?.employee_id ?? null;
  await q('UPDATE employees SET person_id = NULL WHERE person_id = $1', [pid]);
  if (eid !== null) await q('UPDATE employees SET person_id = $1 WHERE id = $2', [pid, +eid]);
  await audit(req, 'link', 'people', pid, null, { employee_id: eid });
  res.json({ ok: true });
}));

export default r;
