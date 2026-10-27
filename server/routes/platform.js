// واجهات مشتركة بين المنصات: قائمة المنصات للمستخدم، ودليل الموظفين (للبطاقة)، وتسجيل إصدار البطاقات
import { Router } from 'express';
import { q } from '../db/pool.js';
import { wrap, audit } from '../lib/auth.js';
import { listApps, canUseApp } from '../lib/apps.js';
import { hasGrant, resolveScope } from '../lib/rbac.js';
import { directory } from '../services/employees.js';
import { httpError } from '../lib/util.js';

const r = Router();

r.get('/launcher', wrap(async (req, res) => {
  const u = req.user;
  const apps = [];
  for (const a of await listApps()) if (a.active && hasGrant(u, a.slug, 'access')) apps.push({ slug: a.slug, title: a.title, description: a.description, icon: a.icon, path: a.path });
  const emp = u.employee_id ? (await q('SELECT id, full_name, job_title, photo FROM employees WHERE id = $1', [u.employee_id])).rows[0] : null;
  const roles = (await q('SELECT name FROM roles WHERE key = ANY($1) ORDER BY id', [u.roleKeys])).rows.map(x => x.name);
  res.json({ user: { username: u.username, full_name: u.full_name, role: u.role, role_label: roles.join('، ') || u.role, employee: emp }, apps });
}));

// دليل الموظفين من السجل المركزي (الحقول العامة فقط) ضمن نطاق صلاحية إصدار البطاقة
r.get('/directory', wrap(async (req, res) => {
  if (!(await canUseApp(req.user, 'card')) || !hasGrant(req.user, 'card', 'view')) throw httpError(403, 'لا تملك صلاحية إصدار البطاقات');
  const sc = await resolveScope(req.user, 'card', 'view');
  res.json({ employees: await directory(sc, String(req.query.q || '')) });
}));

// تسجيل إصدار/تصدير بطاقة (التصدير يتم في المتصفح فيُسجَّل هنا)
r.post('/card/log', wrap(async (req, res) => {
  if (!hasGrant(req.user, 'card', 'export')) throw httpError(403, 'لا تملك صلاحية تصدير البطاقات');
  const { employee_id, format } = req.body || {};
  if (employee_id) {
    const sc = await resolveScope(req.user, 'card', 'export');
    const e = (await q('SELECT id, org_unit_id FROM employees WHERE id = $1', [employee_id])).rows[0];
    if (!e) throw httpError(404, 'الموظف غير موجود');
    if (!sc.all && !(sc.unitIds?.has(e.org_unit_id) || sc.employeeIds?.has(e.id))) throw httpError(403, 'خارج نطاق صلاحياتك');
  }
  await audit(req, 'export', 'employee_card', employee_id ?? null, null, { format: String(format || '').slice(0, 10) }, { platform: 'card' });
  res.json({ ok: true });
}));

export default r;
