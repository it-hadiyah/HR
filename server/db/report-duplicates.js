// تقرير التكرارات والتعارضات في بيانات الموظفين (للمراجعة قبل الترحيل وبعده). للقراءة فقط: لا يعدّل شيئاً.
// الاستخدام: npm run db:report
import { pool, q } from './pool.js';
import { normalizeName } from '../lib/text.js';

const hasCentral = (await q("SELECT to_regclass('public.migration_conflicts') IS NOT NULL AS ok")).rows[0].ok;
const section = (title, rows, fmt) => {
  console.log(`\n== ${title} (${rows.length})`);
  for (const r of rows.slice(0, 50)) console.log('  -', fmt(r));
  if (rows.length > 50) console.log(`  … و${rows.length - 50} آخرين`);
};

const emps = (await q('SELECT id, full_name, emp_no, extension, email, org_unit_id' + (hasCentral ? ', leave_enabled' : '') + ' FROM employees ORDER BY id')).rows;
const people = (await q("SELECT to_regclass('public.people') IS NOT NULL AS ok")).rows[0].ok ? (await q('SELECT id, full_name, extension, email FROM people ORDER BY id')).rows : [];
console.log(`موظفون: ${emps.length} — أشخاص في الدليل القديم: ${people.length}`);

const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k) (m.get(k) || m.set(k, []).get(k)).push(r); } return [...m.values()].filter(g => g.length > 1); };
section('أسماء متطابقة بعد التطبيع داخل جدول الموظفين', group(emps, r => normalizeName(r.full_name)), g => g.map(x => `#${x.id} ${x.full_name}`).join(' | '));
section('بريد مكرر', group(emps.filter(e => e.email), r => r.email.toLowerCase()), g => g.map(x => `#${x.id} ${x.email}`).join(' | '));
section('موظفون بلا وحدة تنظيمية', emps.filter(e => !e.org_unit_id), e => `#${e.id} ${e.full_name}`);
const byExt = new Map(emps.filter(e => e.extension).map(e => [String(e.extension), e]));
section('رقم وظيفي يساوي تحويلة موظف آخر (قد يدل على خلط)', emps.filter(e => e.emp_no && byExt.has(e.emp_no) && byExt.get(e.emp_no).id !== e.id), e => `#${e.id} ${e.full_name}: رقم وظيفي ${e.emp_no} = تحويلة #${byExt.get(e.emp_no).id}`);
if (people.length) {
  const norm = new Map(emps.map(e => [normalizeName(e.full_name), e]));
  section('أشخاص في الدليل القديم لا يقابلهم موظف بالاسم نفسه', people.filter(p => !norm.has(normalizeName(p.full_name))), p => `#${p.id} ${p.full_name}`);
}
if (hasCentral) {
  const c = (await q('SELECT c.kind, c.details, c.resolved, e.full_name FROM migration_conflicts c LEFT JOIN employees e ON e.id = c.employee_id WHERE NOT c.resolved ORDER BY c.id')).rows;
  section('تعارضات الترحيل المفتوحة', c, r => `${r.kind} — ${r.full_name ?? ''} ${JSON.stringify(r.details)}`);
}
await pool.end();
