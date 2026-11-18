// حسابات الرواتب والإضافي والانتداب (مصدر واحد للخادم والواجهة).
// الإضافي: الساعات × الأجر الساعي × (النسبة ÷ 100)، الأجر الساعي = أساس الراتب ÷ (أيام الشهر × ساعات اليوم)
// الانتداب: الأيام × الأجر اليومي × (النسبة ÷ 100)، الأجر اليومي = أساس الراتب ÷ أيام الشهر
export const round2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const DEFAULT_SETTINGS = {
  salary_basis: 'gross',            // gross: الراتب الإجمالي | basic: الأساسي فقط
  days_per_month: 30,
  hours_per_day: 8,
  allowances_auto: true,            // السكن والنقل تُحسب تلقائياً من الأساسي بالنسب أدناه
  housing_percent: 25,
  transport_percent: 10,
  overtime_monthly_cap_hours: 0,    // 0 = بلا حد (تنبيه فقط عند التجاوز)
  overtime_types: [
    { id: 'ot-workday', name: 'إضافي أيام العمل', percent: 150 },
    { id: 'ot-weekend', name: 'إضافي نهاية الأسبوع', percent: 150 },
    { id: 'ot-holiday', name: 'إضافي العطل والمناسبات', percent: 200 },
  ],
  assignment_types: [
    { id: 'as-inside', name: 'انتداب داخل المدينة', percent: 100 },
    { id: 'as-outside', name: 'انتداب خارج المدينة', percent: 150 },
  ],
};

/** يطبّق نسب بدل السكن والنقل (من الأساسي) إن كان الاحتساب التلقائي مفعّلاً */
export function withAllowances(s, st) {
  if (!st?.allowances_auto) return s;
  const b = n(s?.basic);
  return { ...s, housing: round2(b * n(st.housing_percent) / 100), transport: round2(b * n(st.transport_percent) / 100) };
}
/** الأساسي المقابل لإجمالي معلوم عند الاحتساب التلقائي */
export const basicFromGross = (gross, st) => (st?.allowances_auto ? round2(n(gross) / (1 + (n(st.housing_percent) + n(st.transport_percent)) / 100)) : round2(gross));

/** الراتب الإجمالي = الأساسي + البدلات */
export const grossOf = s => round2(n(s?.basic) + n(s?.housing) + n(s?.transport) + n(s?.other));
/** أساس الاحتساب حسب الإعداد */
export const baseOf = (s, st) => (st.salary_basis === 'basic' ? round2(n(s?.basic)) : grossOf(s));
export const dailyWage = (base, st) => n(base) / (n(st.days_per_month) || 30);
export const hourlyWage = (base, st) => dailyWage(base, st) / (n(st.hours_per_day) || 8);

/** يحسب مبلغ بند: kind = overtime (ساعات) أو assignment (أيام) */
export function entryAmount(kind, quantity, percent, base, st) {
  const unit = kind === 'overtime' ? hourlyWage(base, st) : dailyWage(base, st);
  return { unit_wage: round2(unit), amount: round2(n(quantity) * unit * n(percent) / 100) };
}

export const LEVELS = ['sector', 'department', 'section'];
const NONE = { sector: 'بدون قطاع', department: 'بدون إدارة', section: 'بدون قسم' };
const ZERO = () => ({ employees: 0, salaries: 0, overtime_hours: 0, overtime_amount: 0, assignment_days: 0, assignment_amount: 0, total: 0 });
function add(t, r) {
  t.employees += 1; t.salaries += n(r.gross); t.overtime_hours += n(r.overtime_hours); t.overtime_amount += n(r.overtime_amount);
  t.assignment_days += n(r.assignment_days); t.assignment_amount += n(r.assignment_amount); t.total += n(r.total);
}
const fix = t => { for (const k of Object.keys(ZERO())) if (k !== 'employees') t[k] = round2(t[k]); return t; };

/** تجميع مسطّح حسب المستوى (القطاع/الإدارة/القسم) */
export function groupRows(rows, level) {
  const m = new Map();
  for (const r of rows) { const key = r[level] || NONE[level]; if (!m.has(key)) m.set(key, { name: key, ...ZERO() }); add(m.get(key), r); }
  return [...m.values()].map(fix).sort((a, b) => b.total - a.total);
}

/** شجرة قطاع ← إدارة ← قسم ← موظفون مع مجاميع كل مستوى */
export function buildTree(rows) {
  const root = { name: 'الإجمالي', level: 'root', ...ZERO(), children: new Map() };
  for (const r of rows) {
    let node = root; add(root, r);
    for (const level of LEVELS) {
      const key = r[level] || NONE[level];
      if (!node.children.has(key)) node.children.set(key, { name: key, level, ...ZERO(), children: new Map(), employeesList: [] });
      node = node.children.get(key); add(node, r);
    }
    node.employeesList.push(r);
  }
  const fin = nd => { fix(nd); nd.children = [...nd.children.values()].map(fin).sort((a, b) => b.total - a.total); return nd; };
  return fin(root);
}
