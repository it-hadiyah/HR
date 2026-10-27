// تهيئة النظام: المنشأة والمدير. مع --demo تُضاف بيانات توضيحية مميزة (is_demo) لعرض إمكانات النظام.
import bcrypt from 'bcryptjs';
import { pool, q } from './pool.js';
import { initSchema } from './init.js';

const demo = process.argv.includes('--demo');
await initSchema();

const orgName = process.env.ORG_NAME || 'المنشأة';
let root = (await q("SELECT id FROM org_units WHERE unit_type = 'org' LIMIT 1")).rows[0];
if (!root) root = (await q("INSERT INTO org_units(unit_type, name) VALUES ('org', $1) RETURNING id", [orgName])).rows[0];

const adminPass = process.env.ADMIN_PASSWORD || 'ChangeMe#2026';
if (!(await q("SELECT 1 FROM users WHERE username = 'admin'")).rows.length) {
  await q("INSERT INTO users(username, full_name, password_hash, role) VALUES ('admin','مدير النظام',$1,'admin')", [await bcrypt.hash(adminPass, 10)]);
  console.log(`أُنشئ المستخدم admin بكلمة المرور: ${adminPass} (غيّرها بعد أول دخول)`);
}

const hols = [['2026-02-22', 'يوم التأسيس'], ['2026-09-23', 'اليوم الوطني']];
for (const [d, n] of hols) await q('INSERT INTO holidays(day, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [d, n]);

if (demo) {
  if ((await q('SELECT 1 FROM employees WHERE is_demo LIMIT 1')).rows.length) { console.log('البيانات التوضيحية موجودة مسبقاً'); await pool.end(); process.exit(0); }
  // مولّد حتمي حتى تتكرر الأرقام
  let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const mk = async (parent, type, name) => (await q("INSERT INTO org_units(parent_id, unit_type, name, code) VALUES ($1,$2,$3,'DEMO') RETURNING id", [parent, type, name])).rows[0].id;
  const structure = {
    'قطاع التشغيل': { 'إدارة العمليات': ['قسم الإنتاج', 'قسم الجودة'], 'إدارة الصيانة': ['قسم الصيانة الوقائية'] },
    'قطاع الخدمات': { 'إدارة خدمة العملاء': ['قسم الدعم', 'قسم الشكاوى'], 'إدارة المبيعات': ['قسم المبيعات المباشرة'] },
    'القطاع الإداري': { 'إدارة الموارد البشرية': ['قسم التوظيف', 'قسم شؤون الموظفين'], 'إدارة المالية': ['قسم الحسابات', 'قسم المشتريات'] },
    'قطاع التقنية': { 'إدارة تقنية المعلومات': ['قسم التطوير', 'قسم الدعم الفني'], 'إدارة الأمن السيبراني': ['قسم العمليات الأمنية'] },
  };
  const first = ['محمد', 'أحمد', 'عبدالله', 'خالد', 'فهد', 'سعود', 'نورة', 'سارة', 'هند', 'ريم', 'ماجد', 'تركي', 'لطيفة', 'منى', 'يوسف', 'إبراهيم'];
  const last = ['العتيبي', 'القحطاني', 'الشمري', 'الدوسري', 'الغامدي', 'الحربي', 'الزهراني', 'المطيري', 'السبيعي', 'العنزي'];
  const titles = ['أخصائي', 'محلل', 'منسق', 'مهندس', 'مشرف', 'مدير فريق', 'مساعد إداري'];
  const sectorMult = { 'قطاع التشغيل': 1.4, 'قطاع الخدمات': 1.0, 'القطاع الإداري': 0.8, 'قطاع التقنية': 1.2 };
  let n = 1000;
  const sectorIds = {}; const deptIds = {};
  for (const [sec, depts] of Object.entries(structure)) {
    const sid = await mk(root.id, 'sector', sec); sectorIds[sec] = sid;
    for (const [dep, secs] of Object.entries(depts)) {
      const did = await mk(sid, 'department', dep); deptIds[dep] = did;
      for (const sc of secs) {
        const scid = await mk(did, 'section', sc);
        const count = 3 + Math.floor(rnd() * 4);
        for (let i = 0; i < count; i++) {
          const hireYear = 2012 + Math.floor(rnd() * 14);
          const hire = `${hireYear}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
          const basic = Math.round((5000 + rnd() * 14000) / 100) * 100;
          const opening = Math.round(rnd() * 55 * sectorMult[sec] * 2) / 2;
          const emp = (await q(`INSERT INTO employees(emp_no, full_name, job_title, org_unit_id, hire_date, status, basic_salary, opening_balance, opening_date, is_demo)
            VALUES ($1,$2,$3,$4,$5,'active',$6,$7,'2025-12-31',TRUE) RETURNING id`,
          [`D${++n}`, `${pick(first)} ${pick(last)}`, pick(titles), scid, hire > '2025-12-31' ? '2020-01-01' : hire, basic, opening])).rows[0];
          await q("INSERT INTO employee_allowances(employee_id, name, amount, include_in_leave) VALUES ($1,'بدل سكن',$2,TRUE), ($1,'بدل نقل',$3,FALSE)", [emp.id, Math.round(basic * 0.25), Math.round(basic * 0.1)]);
          // إجازات مستخدمة في 2026
          const usedBlocks = Math.floor(rnd() * 3);
          let cursor = 20 + Math.floor(rnd() * 100);
          for (let b = 0; b < usedBlocks; b++) {
            const len = 3 + Math.floor(rnd() * 8);
            const start = new Date(Date.UTC(2026, 0, 1) + cursor * 86400000); const end = new Date(start.getTime() + (len - 1) * 86400000);
            if (end > new Date('2026-12-31')) break;
            await q("INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days, status, notes) VALUES ($1,'leave',$2,$3,$4,'approved','بيانات توضيحية')",
              [emp.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), len]);
            cursor += len + 25 + Math.floor(rnd() * 30);
          }
          if (rnd() < 0.5) { // إجازة مجدولة لاحقاً
            const start = new Date(Date.UTC(2026, 8 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 20))); const len = 5 + Math.floor(rnd() * 10);
            const end = new Date(start.getTime() + (len - 1) * 86400000);
            await q("INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days, status, notes) VALUES ($1,'leave',$2,$3,$4,'approved','مجدولة - بيانات توضيحية')",
              [emp.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), len]);
          }
        }
      }
    }
  }
  // مستهدف المنشأة وبعض القطاعات (المنشأة: أقصى رصيد بنهاية السنة بالأيام)
  const total = (await q('SELECT COUNT(*)::int AS c FROM employees WHERE is_demo')).rows[0].c;
  await q("INSERT INTO targets(scope_type, scope_id, year, target_type, value, notes) VALUES ('unit',$1,2026,'max_year_end_balance',$2,'بيانات توضيحية')", [root.id, total * 25]);
  await q("INSERT INTO targets(scope_type, scope_id, year, target_type, value, notes) VALUES ('unit',$1,2026,'reduction_pct',30,'بيانات توضيحية')", [sectorIds['قطاع التشغيل']]);
  // مستخدمو عرض: مدير قطاع، مالية، موارد بشرية، إدارة عليا
  const pw = await bcrypt.hash('Demo#2026pass', 10);
  for (const [u, nm, role, unit] of [['hr', 'موارد بشرية (تجريبي)', 'hr', null], ['finance', 'مالية (تجريبي)', 'finance', null], ['exec', 'إدارة عليا (تجريبي)', 'executive', null], ['ops.manager', 'مدير قطاع التشغيل (تجريبي)', 'sector_manager', sectorIds['قطاع التشغيل']]]) {
    await q('INSERT INTO users(username, full_name, password_hash, role, org_unit_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [u, nm, pw, role, unit]);
  }
  console.log(`أُضيفت بيانات توضيحية (${total} موظفاً). حسابات العرض بكلمة المرور Demo#2026pass: hr, finance, exec, ops.manager`);
}
await pool.end();
