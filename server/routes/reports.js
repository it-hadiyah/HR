import { Router } from 'express';
import ExcelJS from 'exceljs';
import { wrap, canSeeFinancials } from '../lib/auth.js';
import { buildContext, unitRollups, computeAt } from '../lib/context.js';
import { monthlyTrend, yearlyTrend } from '../lib/analytics.js';
import { fiscalYearOf, round2 } from '../lib/engine.js';
import { httpError } from '../lib/util.js';
import { q } from '../db/pool.js';

const r = Router();
const TYPE_AR = { org: 'المنشأة', sector: 'قطاع', department: 'إدارة', section: 'قسم' };
const STATUS_AR = { achieved: 'محقق', lagging: 'متأخر', at_risk: 'معرّض للخطر', none: 'بلا مستهدف' };

const needFin = user => { if (!canSeeFinancials(user)) throw httpError(403, 'هذا التقرير مالي ولا تتيحه صلاحياتك'); };
const col = (key, label, fmt = 'num') => ({ key, label, fmt });
const empName = e => e.full_name;

const REPORTS = {
  balances: {
    title: 'التقرير الشامل لأرصدة إجازات المنشأة',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const columns = [col('emp_no', 'الرقم الوظيفي', 'text'), col('name', 'الاسم', 'text'), col('sector', 'القطاع', 'text'), col('department', 'الإدارة', 'text'), col('section', 'القسم', 'text'),
        col('baseline', 'الرصيد في بداية السنة'), col('accrued_to_date', 'المستحق خلال الفترة'), col('used', 'المستخدم'), col('adjustments', 'التسويات'), col('available_now', 'الرصيد المتاح'),
        col('scheduled', 'المجدول مستقبلاً'), col('projected_year_end', 'المتوقع نهاية السنة'),
        ...(fin ? [col('value_now', 'القيمة المالية (ر.س)', 'sar'), col('value_year_end', 'القيمة المتوقعة نهاية السنة (ر.س)', 'sar')] : [])];
      const rows = ctx.list.map(e => ({ emp_no: e.emp_no, name: empName(e), sector: e.sector, department: e.department, section: e.section, ...e.m }));
      return { columns, rows, totals: totalsOf(columns, rows) };
    },
  },
  liability: {
    title: 'تقرير الالتزام المالي للإجازات', fin: true,
    build(ctx) {
      const roll = unitRollups(ctx);
      const total = roll.get(ctx.tree.root.id).value_now || 1;
      const rows = [...roll.values()].filter(u => u.headcount).map(u => ({ type: TYPE_AR[u.unit_type], name: u.name, headcount: u.headcount, balance_now: u.balance_now,
        value_now: u.value_now, value_year_end: u.value_year_end, share: round2(u.value_now / total * 100), _t: u.unit_type }));
      const order = { org: 0, sector: 1, department: 2, section: 3 };
      rows.sort((a, b) => order[a._t] - order[b._t] || b.value_now - a.value_now);
      return { columns: [col('type', 'المستوى', 'text'), col('name', 'الوحدة', 'text'), col('headcount', 'الموظفون', 'int'), col('balance_now', 'الرصيد (يوم)'), col('value_now', 'الالتزام الحالي (ر.س)', 'sar'),
        col('value_year_end', 'المتوقع نهاية السنة (ر.س)', 'sar'), col('share', 'النسبة من الإجمالي %', 'pct')], rows,
      notes: ['القيم تقديرية = الأيام × أجر اليوم؛ تختلف عن القيمة المحاسبية الرسمية.'] };
    },
  },
  targets: {
    title: 'تقرير المستهدفات ونسب تحقيقها',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const roll = unitRollups(ctx);
      const rows = [...roll.values()].filter(u => u.has_target).map(u => ({ type: TYPE_AR[u.unit_type], name: u.name, headcount: u.targeted_headcount, baseline: u.targeted_baseline,
        target_days: u.target_days, projected: u.targeted_projected, reduction_needed: u.reduction_needed, achievement: u.achievement, status: STATUS_AR[u.target_status],
        reduction_needed_sar: u.reduction_needed_sar, conflict: u.stated?.conflict_days || 0 }));
      return { columns: [col('type', 'المستوى', 'text'), col('name', 'الوحدة', 'text'), col('headcount', 'موظفون لهم مستهدف', 'int'), col('baseline', 'رصيد بداية السنة'),
        col('target_days', 'المستهدف (يوم)'), col('projected', 'المتوقع نهاية السنة'), col('reduction_needed', 'التخفيض المطلوب (يوم)'), col('achievement', 'نسبة الإنجاز %', 'pct'), col('status', 'الحالة', 'text'),
        ...(fin ? [col('reduction_needed_sar', 'قيمة التخفيض المطلوب (ر.س)', 'sar')] : []), col('conflict', 'فرق مستهدفات الأبناء عن الأب (يوم)')], rows,
      notes: ['نسبة الإنجاز = (رصيد بداية السنة − المتوقع) ÷ (رصيد بداية السنة − المستهدف).'] };
    },
  },
  comparison: {
    title: 'تقرير المقارنة بين القطاعات والإدارات والأقسام',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const roll = unitRollups(ctx);
      const order = { org: 0, sector: 1, department: 2, section: 3 };
      const rows = [...roll.values()].filter(u => u.headcount).sort((a, b) => order[a.unit_type] - order[b.unit_type] || b.balance_now - a.balance_now).map(u => ({
        type: TYPE_AR[u.unit_type], name: u.name, headcount: u.headcount, balance_now: u.balance_now, avg: round2(u.balance_now / u.headcount), used: u.used, projected: u.projected,
        value_now: u.value_now, achievement: u.achievement }));
      return { columns: [col('type', 'المستوى', 'text'), col('name', 'الوحدة', 'text'), col('headcount', 'الموظفون', 'int'), col('balance_now', 'الرصيد'), col('avg', 'متوسط الرصيد للموظف'),
        col('used', 'المستخدم'), col('projected', 'المتوقع نهاية السنة'), ...(fin ? [col('value_now', 'الالتزام (ر.س)', 'sar')] : []), col('achievement', 'نسبة الإنجاز %', 'pct')], rows };
    },
  },
  high_balances: {
    title: 'تقرير الأرصدة المرتفعة',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const rows = ctx.list.filter(e => e.m.available_now > ctx.policy.max_balance_cap).sort((a, b) => b.m.available_now - a.m.available_now)
        .map(e => ({ emp_no: e.emp_no, name: e.full_name, unit: e.section || e.department || e.sector, available_now: e.m.available_now, projected: e.m.projected_year_end, target: e.target_days,
          scheduled: e.m.scheduled, value_now: e.m.value_now }));
      return { columns: [col('emp_no', 'الرقم الوظيفي', 'text'), col('name', 'الاسم', 'text'), col('unit', 'الوحدة', 'text'), col('available_now', 'الرصيد'), col('projected', 'المتوقع نهاية السنة'),
        col('target', 'المستهدف'), col('scheduled', 'المجدول'), ...(fin ? [col('value_now', 'القيمة (ر.س)', 'sar')] : [])], rows,
      notes: [`الحد المعتمد للرصيد: ${ctx.policy.max_balance_cap} يوماً.`] };
    },
  },
  periodic: {
    title: 'التقرير الشهري والسنوي للأرصدة والالتزام',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const mt = monthlyTrend(ctx).map(m => ({ period: m.date, balance_days: m.balance_days, used_cum: m.used_cum, liability_sar: m.liability_sar, liability_change: m.liability_change }));
      const yt = yearlyTrend(ctx).map(y => ({ period: String(y.year), balance_days: y.balance_days, used_cum: y.used_days, liability_sar: y.liability_sar, liability_change: null }));
      return { columns: [col('period', 'الفترة', 'text'), col('balance_days', 'إجمالي الرصيد'), col('used_cum', 'المستخدم (تراكمي)'),
        ...(fin ? [col('liability_sar', 'الالتزام (ر.س)', 'sar'), col('liability_change', 'التغير عن الشهر السابق (ر.س)', 'sar')] : [])], rows: [...mt, ...yt],
      notes: ['الصفوف الأولى شهرية للسنة المحددة، تليها الصفوف السنوية.'] };
    },
  },
  forecast: {
    title: 'تقرير توقعات نهاية السنة',
    build(ctx, user) {
      const fin = canSeeFinancials(user);
      const roll = unitRollups(ctx);
      const rows = [...roll.values()].filter(u => u.unit_type === 'sector' || u.unit_type === 'org').filter(u => u.headcount).map(u => ({ name: u.name, headcount: u.headcount, balance_now: u.balance_now, scheduled: u.scheduled,
        projected: u.projected, value_year_end: u.value_year_end, target_days: u.has_target ? u.target_days : null, status: STATUS_AR[u.target_status] }));
      return { columns: [col('name', 'الوحدة', 'text'), col('headcount', 'الموظفون', 'int'), col('balance_now', 'الرصيد الحالي'), col('scheduled', 'المجدول'), col('projected', 'المتوقع نهاية السنة'),
        ...(fin ? [col('value_year_end', 'القيمة المتوقعة (ر.س)', 'sar')] : []), col('target_days', 'المستهدف'), col('status', 'الحالة', 'text')], rows,
      notes: ['الفرضيات: يُحتسب الاستحقاق المتبقي حتى نهاية السنة وتُخصم الإجازات المعتمدة المجدولة فقط؛ لا تُفترض إجازات إضافية. التقديرات ليست حقائق محاسبية.'] };
    },
  },
};

function totalsOf(columns, rows) {
  const t = {};
  for (const c of columns) if (['num', 'sar'].includes(c.fmt) && rows.length) t[c.key] = round2(rows.reduce((s, x) => s + (Number(x[c.key]) || 0), 0));
  return t;
}

async function changeReport(ctx, user, a, b) {
  const fin = canSeeFinancials(user);
  if (!a || !b) throw httpError(400, 'حدد التاريخين a و b');
  const at = date => { const y = fiscalYearOf(date, ctx.policy).year; return Object.fromEntries(ctx.list.map(e => [e.id, computeAt(ctx, e, y, date)])); };
  const A = at(a), B = at(b);
  const groups = new Map();
  for (const e of ctx.list) {
    const key = e.sector || 'بدون قطاع';
    const g = groups.get(key) || { name: key, headcount: 0, bal_a: 0, bal_b: 0, val_a: 0, val_b: 0 };
    g.headcount++; g.bal_a += A[e.id].available_now; g.bal_b += B[e.id].available_now; g.val_a += A[e.id].value_now; g.val_b += B[e.id].value_now;
    groups.set(key, g);
  }
  const rows = [...groups.values()].map(g => ({ ...g, bal_d: g.bal_b - g.bal_a, val_d: g.val_b - g.val_a }));
  return { title: `تغيّر الأرصدة والالتزامات بين ${a} و ${b}`, columns: [col('name', 'القطاع', 'text'), col('headcount', 'الموظفون', 'int'), col('bal_a', `الرصيد ${a}`), col('bal_b', `الرصيد ${b}`), col('bal_d', 'التغير (يوم)'),
    ...(fin ? [col('val_a', `الالتزام ${a}`, 'sar'), col('val_b', `الالتزام ${b}`, 'sar'), col('val_d', 'التغير (ر.س)', 'sar')] : [])],
  rows: rows.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]))) };
}

async function employeeReport(ctx, user, id) {
  const e = ctx.all.find(x => x.id === +id);
  if (!e || (ctx.allowedUnits && !ctx.allowedUnits.has(e.org_unit_id))) throw httpError(404, 'الموظف غير موجود');
  const { rows } = await q("SELECT * FROM leave_transactions WHERE employee_id = $1 AND status IN ('approved','pending') ORDER BY start_date, id", [e.id]);
  const T = { leave: 'إجازة', adjustment: 'تسوية', settlement: 'تسوية نقدية' };
  const S = { approved: 'معتمدة', pending: 'معلّقة' };
  return { title: `التقرير التفصيلي للموظف: ${e.full_name} (${e.emp_no})`,
    columns: [col('type', 'النوع', 'text'), col('start_date', 'من', 'text'), col('end_date', 'إلى', 'text'), col('days', 'الأيام'), col('status', 'الحالة', 'text'), col('notes', 'ملاحظات', 'text')],
    rows: rows.map(t => ({ type: T[t.tx_type], start_date: t.start_date, end_date: t.end_date, days: t.days, status: S[t.status], notes: t.notes || '' })),
    summary: [['الرصيد في بداية السنة', e.m.baseline], ['المستحق حتى تاريخه', e.m.accrued_to_date], ['المستخدم', e.m.used], ['المجدول', e.m.scheduled], ['الرصيد المتاح', e.m.available_now],
      ['المتوقع نهاية السنة', e.m.projected_year_end], ...(canSeeFinancials(user) ? [['القيمة المالية (ر.س)', e.m.value_now]] : [])] };
}

async function build(name, req) {
  const ctx = await buildContext(req.user, req.query);
  let rep;
  if (name === 'change') rep = await changeReport(ctx, req.user, req.query.a, req.query.b);
  else if (name === 'employee') rep = await employeeReport(ctx, req.user, req.query.employee);
  else {
    const def = REPORTS[name];
    if (!def) throw httpError(404, 'تقرير غير معروف');
    if (def.fin) needFin(req.user);
    rep = { title: def.title, ...def.build(ctx, req.user) };
  }
  rep.name = name;
  rep.meta = { year: ctx.year, asOf: ctx.asOf, generated: new Date().toISOString().slice(0, 10) };
  return rep;
}

r.get('/list', (req, res) => {
  const fin = canSeeFinancials(req.user);
  res.json([
    ...Object.entries(REPORTS).filter(([, d]) => fin || !d.fin).map(([k, d]) => ({ key: k, title: d.title })),
    { key: 'change', title: 'تقرير تغيّر الأرصدة والالتزامات بين تاريخين', params: ['a', 'b'] },
    { key: 'employee', title: 'التقرير التفصيلي لكل موظف', params: ['employee'] },
  ]);
});

const FMT = { num: '#,##0.00', sar: '#,##0.00', pct: '0.0', int: '0' };

r.get('/:name', wrap(async (req, res) => {
  const rep = await build(req.params.name, req);
  if (req.query.format !== 'xlsx') return res.json(rep);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(rep.title.slice(0, 28).replace(/[\\/?*[\]:]/g, ' '), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
  ws.addRow([rep.title]).font = { bold: true, size: 14 };
  ws.addRow([`السنة: ${rep.meta.year} — حتى تاريخ: ${rep.meta.asOf} — صدر في: ${rep.meta.generated}`]);
  const head = ws.addRow(rep.columns.map(c => c.label));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  for (const row of rep.rows) {
    const rr = ws.addRow(rep.columns.map(c => row[c.key] ?? ''));
    rep.columns.forEach((c, i) => { if (FMT[c.fmt]) rr.getCell(i + 1).numFmt = FMT[c.fmt]; });
  }
  if (rep.totals && Object.keys(rep.totals).length) {
    const tr = ws.addRow(rep.columns.map((c, i) => (i === 0 ? 'الإجمالي' : rep.totals[c.key] ?? '')));
    tr.font = { bold: true };
    rep.columns.forEach((c, i) => { if (FMT[c.fmt]) tr.getCell(i + 1).numFmt = FMT[c.fmt]; });
  }
  if (rep.summary) { ws.addRow([]); for (const [k, v] of rep.summary) ws.addRow([k, v]); }
  for (const n of rep.notes || []) ws.addRow([n]);
  ws.columns.forEach(c => { c.width = 20; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${rep.name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

export default r;
