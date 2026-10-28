import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { pool } from '../db/pool.js';
import { requirePerm, audit, wrap } from '../lib/auth.js';
import { loadPolicy, loadHolidays } from '../lib/context.js';
import { countLeaveDays, overlaps } from '../lib/engine.js';
import { httpError, isDate } from '../lib/util.js';
import { normalizeName } from '../lib/text.js';
import { resetOrgGraph } from '../lib/orggraph.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const STATUS = { 'نشط': 'active', 'موقوف': 'suspended', 'معطّل': 'suspended', 'معطل': 'suspended', 'منتهي': 'terminated', 'منتهي الخدمة': 'terminated', active: 'active', suspended: 'suspended', terminated: 'terminated' };
const TXTYPE = { 'إجازة': 'leave', 'تسوية': 'adjustment', 'تسوية نقدية': 'settlement', leave: 'leave', adjustment: 'adjustment', settlement: 'settlement' };
const TXSTATUS = { 'معتمدة': 'approved', 'معلقة': 'pending', 'معلّقة': 'pending', approved: 'approved', pending: 'pending' };
const TTYPE = { 'أقصى رصيد نهاية السنة': 'max_year_end_balance', 'أيام مطلوب استخدامها': 'days_to_use', 'نسبة تخفيض': 'reduction_pct', 'قيمة مالية مستهدفة': 'financial_target', 'نسبة التزام بالخطة': 'usage_plan_pct' };

const KINDS = {
  employees: {
    title: 'نموذج استيراد الموظفين',
    cols: [['emp_no', 'الرقم الوظيفي', 'E1001'], ['full_name', 'الاسم الكامل', 'مثال: محمد أحمد'], ['job_title', 'المسمى الوظيفي', 'محاسب'], ['sector', 'القطاع', 'قطاع التشغيل'],
      ['department', 'الإدارة', 'إدارة المالية'], ['section', 'القسم', 'قسم الحسابات'], ['hire_date', 'تاريخ التعيين', '2021-03-01'], ['status', 'الحالة', 'نشط'], ['basic_salary', 'الراتب الأساسي', 9000],
      ['leave_allowances', 'بدلات داخلة في احتساب الإجازة', 2000], ['leave_salary_override', 'الراتب المعتمد للإجازات (اختياري)', ''], ['annual_entitlement_days', 'الاستحقاق السنوي بالأيام (اختياري)', ''],
      ['opening_balance', 'الرصيد الافتتاحي', 20], ['opening_date', 'تاريخ الرصيد الافتتاحي', '2025-12-31']],
  },
  tracking: {
    title: 'نموذج متابعة أرصدة الإجازات',
    cols: [['emp_no', 'الرقم الوظيفي', 'E1001'], ['full_name', 'الاسم', 'محمد أحمد'], ['job_title', 'المسمى', 'محاسب'], ['year', 'السنة', 2026], ['hire_date', 'تاريخ التعيين', '2021-03-01'], ['gross_salary', 'الراتب الإجمالي', 12000], ['annual_balance', 'الرصيد السنوي', 21],
      ['total_balance', 'الرصيد الكلي', 45], ['target_days', 'المستهدف', 15], ['used_days', 'المستخدم', 6], ['notes', 'ملاحظات', '']],
  },
  opening_balances: {
    title: 'نموذج استيراد الأرصدة الافتتاحية',
    cols: [['emp_no', 'الرقم الوظيفي', 'E1001'], ['opening_balance', 'الرصيد الافتتاحي', 20], ['opening_date', 'تاريخ الرصيد الافتتاحي', '2025-12-31']],
  },
  transactions: {
    title: 'نموذج استيراد حركات الإجازات',
    cols: [['emp_no', 'الرقم الوظيفي', 'E1001'], ['tx_type', 'النوع (إجازة/تسوية/تسوية نقدية)', 'إجازة'], ['start_date', 'من تاريخ', '2026-03-01'], ['end_date', 'إلى تاريخ', '2026-03-05'],
      ['days', 'عدد الأيام (اختياري للإجازة)', 5], ['status', 'الحالة (معتمدة/معلقة)', 'معتمدة'], ['notes', 'ملاحظات', '']],
  },
  targets: {
    title: 'نموذج استيراد المستهدفات',
    cols: [['scope', 'النطاق (وحدة/موظف)', 'وحدة'], ['name', 'اسم الوحدة أو الرقم الوظيفي', 'قطاع التشغيل'], ['year', 'السنة', 2026],
      ['target_type', 'نوع المستهدف', 'أقصى رصيد نهاية السنة'], ['value', 'القيمة', 400]],
  },
};

r.get('/template/:kind', requirePerm('import'), wrap(async (req, res) => {
  const k = KINDS[req.params.kind];
  if (!k) throw httpError(404, 'نموذج غير معروف');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(k.title.slice(0, 30), { views: [{ rightToLeft: true }] });
  const head = ws.addRow(k.cols.map(c => c[1]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { horizontal: 'center', wrapText: true }; });
  const ex = ws.addRow(k.cols.map(c => c[2]));
  ex.font = { italic: true, color: { argb: 'FF888888' } };
  ws.addRow(['↑ صف مثال: احذفه قبل الرفع']).font = { color: { argb: 'FFC00000' } };
  ws.columns.forEach(c => { c.width = 24; });
  if (req.params.kind === 'targets') {
    const info = wb.addWorksheet('أنواع المستهدفات', { views: [{ rightToLeft: true }] });
    Object.keys(TTYPE).forEach(t => info.addRow([t]));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template-${req.params.kind}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// ---- قراءة الملف ----
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.', '،': ',' };
const normStr = v => String(v).replace(/[٠-٩٫،]/g, c => AR_DIGITS[c]).trim();
function cellVal(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') { if (v.result !== undefined) return cellVal(v.result); if (v.text) return String(v.text).trim(); if (v.richText) return v.richText.map(x => x.text).join('').trim(); }
  return typeof v === 'string' ? normStr(v) : v;
}
const toDate = v => {
  if (v === '' || v === undefined) return '';
  const s = String(v).replace(/\//g, '-');
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
};
const toNum = v => (v === '' ? null : Number(String(v).replace(/,/g, '')));

async function readRows(file, kind) {
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || '').toLowerCase();
  try {
    if (name.endsWith('.csv')) await wb.csv.read(Readable.from(file.buffer));
    else await wb.xlsx.load(file.buffer);
  } catch { throw httpError(400, 'تعذّرت قراءة الملف؛ استخدم نموذج Excel أو CSV'); }
  const ws = wb.worksheets[0];
  if (!ws) throw httpError(400, 'الملف فارغ');
  const labels = new Map(KINDS[kind].cols.flatMap(c => [[c[1], c[0]], [c[0], c[0]]]));
  const headersOf = row => { const hs = []; row.eachCell((c, i) => { hs[i] = labels.get(String(cellVal(c.value)).replace(/\s+/g, ' ').trim()) || null; }); return hs; };
  // الترويسة قد لا تكون في الصف الأول (ملفات التصدير تبدأ بصف عنوان): نختار أفضل صف مطابقاً بين أول 10 صفوف
  let headerRow = 1, headers = headersOf(ws.getRow(1)), best = headers.filter(Boolean).length;
  for (let n = 2; n <= Math.min(10, ws.rowCount); n++) { const hs = headersOf(ws.getRow(n)); const c = hs.filter(Boolean).length; if (c > best) { best = c; headers = hs; headerRow = n; } }
  if (!headers.some(Boolean)) throw httpError(400, 'لم تُطابق أعمدة الملف النموذج؛ حمّل النموذج الرسمي (يجب أن يحوي عمود «الرقم الوظيفي» على الأقل)');
  // السنة من عنوان الملف أو اسم الورقة إن لم يوجد عمود للسنة
  let metaYear = null;
  for (const t of [ws.name, ...Array.from({ length: headerRow - 1 }, (_, k) => String(cellVal(ws.getRow(k + 1).getCell(1).value)))]) { const m = String(t).match(/(20\d\d)/); if (m) { metaYear = +m[1]; break; } }
  const out = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const o = { _row: n }; let any = false;
    row.eachCell({ includeEmpty: false }, (c, i) => { if (headers[i]) { o[headers[i]] = cellVal(c.value); if (o[headers[i]] !== '') any = true; } });
    const first = String(o[Object.values(headers).find(Boolean)] || '');
    if (first.startsWith('↑') || first === 'الإجمالي' || String(o.full_name || '') === 'الإجمالي') return;
    if (kind === 'tracking' && metaYear && (o.year === undefined || o.year === '')) o.year = metaYear;
    if (any) out.push(o);
  });
  return out;
}

// ---- التحقق والتنفيذ لكل نوع ----
async function findUnit(client, cache, parentId, type, name) {
  if (!name) return parentId;
  const key = `${parentId}|${type}|${name}`;
  if (cache.has(key)) return cache.get(key);
  let { rows } = await client.query('SELECT id FROM org_units WHERE parent_id = $1 AND unit_type = $2 AND name = $3', [parentId, type, name]);
  let id = rows[0]?.id ?? null;
  cache.set(key, id);
  return id;
}

const processors = {
  async employees(rows, apply, client) {
    const results = []; const seen = new Set(); const cache = new Map();
    const root = (await client.query("SELECT id FROM org_units WHERE unit_type = 'org' LIMIT 1")).rows[0]?.id;
    const existing = new Map((await client.query('SELECT emp_no, id FROM employees WHERE emp_no IS NOT NULL')).rows.map(e => [e.emp_no, e.id]));
    // موظفو الدليل بلا ملف إجازات: يُفعَّل لهم الملف بدل إنشاء سجل مكرر (الجدول المركزي واحد)
    const portalOnly = new Map();
    for (const e of (await client.query('SELECT id, full_name FROM employees WHERE NOT leave_enabled AND emp_no IS NULL')).rows) {
      const k = normalizeName(e.full_name); portalOnly.set(k, [...(portalOnly.get(k) || []), e.id]);
    }
    for (const r0 of rows) {
      const errs = []; const warn = [];
      const emp_no = String(r0.emp_no || '').trim();
      if (!emp_no) errs.push('الرقم الوظيفي مفقود');
      if (seen.has(emp_no)) errs.push('رقم وظيفي مكرر داخل الملف');
      seen.add(emp_no);
      if (!r0.full_name) errs.push('الاسم مفقود');
      const hire = toDate(r0.hire_date);
      if (!isDate(hire)) errs.push('تاريخ التعيين غير صالح');
      const status = r0.status ? STATUS[r0.status] : 'active';
      if (!status) errs.push('حالة غير معروفة');
      const basic = toNum(r0.basic_salary ?? 0);
      if (!(basic >= 0)) errs.push('الراتب الأساسي غير صالح');
      const ob = toNum(r0.opening_balance ?? 0);
      if (Number.isNaN(ob)) errs.push('الرصيد الافتتاحي غير صالح');
      const od = r0.opening_date ? toDate(r0.opening_date) : hire;
      if (!isDate(od)) errs.push('تاريخ الرصيد الافتتاحي غير صالح');
      const ent = toNum(r0.annual_entitlement_days ?? ''); const lso = toNum(r0.leave_salary_override ?? '');
      const lallow = toNum(r0.leave_allowances ?? 0);
      if ((ent !== null && !(ent >= 0)) || (lso !== null && !(lso >= 0)) || !(lallow >= 0)) errs.push('قيمة رقمية غير صالحة');
      if (!r0.sector && !r0.department && !r0.section) errs.push('حدد القطاع أو الإدارة أو القسم');
      let unitId = null;
      if (!errs.length) {
        if (apply) {
          // إنشاء الوحدات الناقصة عند الاعتماد فقط
          let parent = root;
          for (const [type, nm] of [['sector', r0.sector], ['department', r0.department], ['section', r0.section]]) {
            if (!nm) continue;
            let id = await findUnit(client, cache, parent, type, String(nm));
            if (!id) {
              id = (await client.query('INSERT INTO org_units(parent_id, unit_type, name) VALUES ($1,$2,$3) RETURNING id', [parent, type, String(nm)])).rows[0].id;
              cache.set(`${parent}|${type}|${nm}`, id);
            }
            parent = id;
          }
          unitId = parent;
        } else {
          let parent = root; let missing = false;
          for (const [type, nm] of [['sector', r0.sector], ['department', r0.department], ['section', r0.section]]) {
            if (!nm) continue;
            const id = missing ? null : await findUnit(client, cache, parent, type, String(nm));
            if (!id) { missing = true; warn.push(`سيُنشأ ${nm}`); } else parent = id;
          }
        }
      }
      const isUpdate = existing.has(emp_no);
      const adoptList = !isUpdate && r0.full_name ? portalOnly.get(normalizeName(r0.full_name)) : null;
      const adoptId = adoptList?.length === 1 ? adoptList[0] : null;
      if (adoptId) warn.push('سيُربط بالموظف الموجود في دليل الموظفين (بدون إنشاء سجل مكرر)');
      if (!errs.length && apply) {
        const vals = [emp_no, String(r0.full_name).trim(), r0.job_title || null, unitId, hire, status, basic ?? 0, lso, ent, ob ?? 0, od];
        let id = existing.get(emp_no);
        if (isUpdate) {
          await client.query(`UPDATE employees SET full_name=$2, job_title=$3, org_unit_id=$4, hire_date=$5, status=$6, basic_salary=$7, leave_salary_override=$8,
            annual_entitlement_days=$9, opening_balance=$10, opening_date=$11, version=version+1, updated_at=now() WHERE emp_no=$1`, vals);
        } else if (adoptId) {
          id = adoptId; existing.set(emp_no, id); portalOnly.delete(normalizeName(r0.full_name));
          await client.query(`UPDATE employees SET emp_no=$2, full_name=coalesce(nullif(full_name,''), $3), job_title=coalesce(job_title, $4), org_unit_id=$5, hire_date=$6, status=$7,
            basic_salary=$8, leave_salary_override=$9, annual_entitlement_days=$10, opening_balance=$11, opening_date=$12, leave_enabled=TRUE, version=version+1, updated_at=now() WHERE id=$1`, [id, ...vals]);
          await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on, moved_by, reason) VALUES ($1,NULL,$2,$3,$4,$5)', [id, unitId, hire, null, 'استيراد: تفعيل نظام الإجازات لموظف موجود في الدليل']);
        } else {
          id = (await client.query(`INSERT INTO employees(emp_no, full_name, job_title, org_unit_id, hire_date, status, basic_salary, leave_salary_override,
            annual_entitlement_days, opening_balance, opening_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, vals)).rows[0].id;
          existing.set(emp_no, id);
          await client.query('INSERT INTO org_history(employee_id, from_unit_id, to_unit_id, moved_on) VALUES ($1,NULL,$2,$3)', [id, unitId, hire]);
        }
        if (lallow > 0) {
          await client.query('DELETE FROM employee_allowances WHERE employee_id = $1', [id]);
          await client.query("INSERT INTO employee_allowances(employee_id, name, amount, include_in_leave) VALUES ($1,'بدلات داخلة في الإجازة',$2,TRUE)", [id, lallow]);
        }
      }
      results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: warn, action: isUpdate ? 'تحديث' : adoptId ? 'ربط بموظف الدليل' : 'إضافة', label: `${emp_no} — ${r0.full_name || ''}` });
    }
    return results;
  },

  async tracking(rows, apply, client, opts = {}) {
    const results = [];
    const emps = (await client.query('SELECT id, emp_no, full_name FROM employees')).rows.map(e => ({ ...e, norm: normalizeName(e.full_name), tokens: new Set(normalizeName(e.full_name).split(' ').filter(Boolean)) }));
    const byNo = new Map(emps.filter(e => e.emp_no).map(e => [String(e.emp_no), e]));
    const usedNo = new Set(byNo.keys()); const seen = new Set(); let tmp = 0;
    const num = (v, label, errs, min = 0) => { if (v === '' || v === undefined) return undefined; const n = toNum(v); if (!Number.isFinite(n) || (min !== null && n < min)) { errs.push(`${label} غير صالح`); return undefined; } return n; };
    // مطابقة بالاسم: تطابق تام أو احتواء كلمات الاسم الأقصر في الأطول (مثل «اسماعيل اليزيد» داخل الاسم الرباعي)
    const matchName = name => {
      const norm = normalizeName(name); if (!norm) return { none: true };
      const toks = new Set(norm.split(' ').filter(Boolean));
      const exact = emps.filter(e => e.norm === norm); if (exact.length === 1) return { emp: exact[0] }; if (exact.length > 1) return { many: exact.length };
      const sub = emps.filter(e => e.tokens.size >= 2 && toks.size >= 2 && ([...e.tokens].every(t => toks.has(t)) || [...toks].every(t => e.tokens.has(t))));
      return sub.length === 1 ? { emp: sub[0] } : sub.length > 1 ? { many: sub.length } : { none: true };
    };
    for (const r0 of rows) {
      const errs = []; const warn = []; const emp_no = String(r0.emp_no ?? '').trim(); const fname = String(r0.full_name || '').trim();
      let emp = emp_no ? byNo.get(emp_no) : null; let how = 'تحديث'; let create = false; let setNo = null;
      if (!emp && fname) {
        const m = matchName(fname);
        if (m.emp) {
          emp = m.emp; how = `ربط بالاسم بـ «${emp.full_name}»`;
          if (!emp.emp_no && emp_no) { if (usedNo.has(emp_no)) errs.push('الرقم الوظيفي مستخدم لموظف آخر'); else setNo = emp_no; }
          else if (emp.emp_no && emp_no && String(emp.emp_no) !== emp_no) warn.push(`الرقم في النظام (${emp.emp_no}) يختلف عن الملف (${emp_no}) ولن يتغير`);
        } else if (m.many) errs.push(`الاسم يطابق ${m.many} موظفين؛ استخدم الرقم الوظيفي`);
        else if (opts.createMissing && emp_no) { create = true; how = 'إنشاء موظف جديد'; if (usedNo.has(emp_no)) errs.push('الرقم الوظيفي مستخدم لموظف آخر'); }
        else errs.push(emp_no ? 'الموظف غير موجود في النظام (فعّل «إنشاء الموظفين غير الموجودين» لإضافته)' : 'الرقم الوظيفي غير موجود');
      } else if (!emp) errs.push(emp_no ? 'الرقم الوظيفي غير موجود' : 'الرقم الوظيفي والاسم فارغان');
      const year = r0.year === '' || r0.year === undefined ? new Date().getFullYear() : Number(r0.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) errs.push('السنة غير صالحة');
      const key = `${emp?.id ?? `new:${emp_no || fname}`}|${year}`;
      if (seen.has(key)) errs.push(emp && how.startsWith('ربط بالاسم') ? 'يطابق نفس الموظف الذي طابقه صف آخر بالاسم؛ استخدم الرقم الوظيفي أو أنشئه موظفاً جديداً' : 'مكرر داخل الملف'); seen.add(key);
      const hire = r0.hire_date === '' || r0.hire_date === undefined ? undefined : toDate(r0.hire_date);
      if (hire !== undefined && !isDate(hire)) errs.push('تاريخ التعيين غير صالح');
      const v = { gross_salary: num(r0.gross_salary, 'الراتب الإجمالي', errs), annual_balance: num(r0.annual_balance, 'الرصيد السنوي', errs), total_balance: num(r0.total_balance, 'الرصيد الكلي', errs, null),
        target_days: num(r0.target_days, 'المستهدف', errs), used_days: num(r0.used_days, 'المستخدم', errs), notes: r0.notes ? String(r0.notes).slice(0, 500) : undefined };
      const ks = Object.keys(v).filter(k => v[k] !== undefined);
      if (!errs.length && !ks.length && hire === undefined) warn.push('لا توجد قيم للتحديث');
      if (create && !errs.length) warn.push('سيُنشأ الموظف بلا وحدة تنظيمية (عيّنها من الإدارة المركزية)');
      if (!errs.length && apply) {
        let eid = emp?.id;
        if (create) {
          eid = (await client.query("INSERT INTO employees(emp_no, full_name, job_title, hire_date, status, leave_enabled) VALUES ($1,$2,$3,$4,'active',FALSE) RETURNING id", [emp_no, fname, r0.job_title ? String(r0.job_title).trim() : null, hire && isDate(hire) ? hire : null])).rows[0].id;
          usedNo.add(emp_no);
        } else {
          if (setNo) { await client.query('UPDATE employees SET emp_no = $2, version = version + 1, updated_at = now() WHERE id = $1', [eid, setNo]); usedNo.add(setNo); }
          if (hire !== undefined) await client.query('UPDATE employees SET hire_date = $2, version = version + 1, updated_at = now() WHERE id = $1', [eid, hire]);
        }
        if (ks.length) await client.query(`INSERT INTO leave_tracking(employee_id, year, ${ks.join(', ')}) VALUES ($1, $2, ${ks.map((_, i) => `$${i + 3}`).join(', ')})
          ON CONFLICT (employee_id, year) DO UPDATE SET ${ks.map(k => `${k} = EXCLUDED.${k}`).join(', ')}, updated_at = now()`, [eid, year, ...ks.map(k => v[k])]);
      }
      results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: warn, action: how, label: `${emp_no || '—'} ${fname ? '· ' + fname : ''} — ${year}`.trim() });
    }
    return results;
  },

  async opening_balances(rows, apply, client) {
    const results = []; const emps = new Map((await client.query('SELECT emp_no, id FROM employees WHERE emp_no IS NOT NULL')).rows.map(e => [e.emp_no, e.id])); const seen = new Set();
    for (const r0 of rows) {
      const errs = []; const emp_no = String(r0.emp_no || '').trim();
      if (!emps.has(emp_no)) errs.push('الرقم الوظيفي غير موجود');
      if (seen.has(emp_no)) errs.push('مكرر داخل الملف'); seen.add(emp_no);
      const ob = toNum(r0.opening_balance); const od = toDate(r0.opening_date);
      if (ob === null || Number.isNaN(ob)) errs.push('الرصيد غير صالح');
      if (!isDate(od)) errs.push('التاريخ غير صالح');
      if (!errs.length && apply) await client.query('UPDATE employees SET opening_balance=$2, opening_date=$3, updated_at=now() WHERE id=$1', [emps.get(emp_no), ob, od]);
      results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: [], action: 'تحديث', label: `${emp_no}: ${r0.opening_balance}` });
    }
    return results;
  },

  async transactions(rows, apply, client) {
    const results = []; const emps = new Map((await client.query('SELECT emp_no, id FROM employees WHERE emp_no IS NOT NULL')).rows.map(e => [e.emp_no, e.id]));
    const policy = await loadPolicy(); const hol = await loadHolidays();
    const existing = (await client.query('SELECT * FROM leave_transactions')).rows;
    const byEmp = new Map(); for (const t of existing) { if (!byEmp.has(t.employee_id)) byEmp.set(t.employee_id, []); byEmp.get(t.employee_id).push(t); }
    for (const r0 of rows) {
      const errs = []; const warn = []; const emp_no = String(r0.emp_no || '').trim();
      const eid = emps.get(emp_no);
      if (!eid) errs.push('الرقم الوظيفي غير موجود');
      const type = TXTYPE[r0.tx_type]; if (!type) errs.push('نوع الحركة غير معروف');
      const start = toDate(r0.start_date); const end = r0.end_date ? toDate(r0.end_date) : start;
      if (!isDate(start) || !isDate(end) || end < start) errs.push('التواريخ غير صالحة');
      const status = r0.status ? TXSTATUS[r0.status] : 'approved'; if (!status) errs.push('حالة غير معروفة');
      let days = toNum(r0.days ?? '');
      if (!errs.length && (days === null)) { if (type === 'leave') days = countLeaveDays(start, end, policy, hol); else errs.push('عدد الأيام مطلوب'); }
      if (!errs.length && (!Number.isFinite(days) || (type !== 'adjustment' && days <= 0) || days === 0)) errs.push('عدد الأيام غير صالح');
      let dup = false;
      if (!errs.length) {
        const list = byEmp.get(eid) || [];
        dup = list.some(t => t.tx_type === type && t.start_date === start && t.end_date === end && Number(t.days) === days && t.status === status);
        if (dup) warn.push('حركة مطابقة موجودة مسبقاً (ستُتجاهل)');
        else if (type === 'leave' && overlaps(list, start, end)) errs.push('تتداخل مع إجازة أخرى');
      }
      if (!errs.length && apply && !dup) {
        const row = (await client.query('INSERT INTO leave_transactions(employee_id, tx_type, start_date, end_date, days, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [eid, type, start, end, days, status, r0.notes || null])).rows[0];
        if (!byEmp.has(eid)) byEmp.set(eid, []); byEmp.get(eid).push(row);
      } else if (!errs.length && !dup) {
        // المعاينة: تُسجَّل الحركة افتراضياً حتى يُكشف التداخل والتكرار بين صفوف الملف نفسه
        if (!byEmp.has(eid)) byEmp.set(eid, []); byEmp.get(eid).push({ id: -(results.length + 1), employee_id: eid, tx_type: type, start_date: start, end_date: end, days, status });
      }
      results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: warn, action: dup ? 'تجاهل (مكرر)' : 'إضافة', label: `${emp_no} ${r0.start_date}` });
    }
    return results;
  },

  async targets(rows, apply, client) {
    const results = [];
    const units = (await client.query('SELECT id, name FROM org_units')).rows; const emps = (await client.query('SELECT id, emp_no FROM employees')).rows;
    for (const r0 of rows) {
      const errs = []; const scope = String(r0.scope || '').trim();
      let scope_type = scope === 'وحدة' || scope === 'unit' ? 'unit' : scope === 'موظف' || scope === 'employee' ? 'employee' : null;
      if (!scope_type) errs.push('النطاق يجب أن يكون وحدة أو موظف');
      const nm = String(r0.name || '').trim();
      let sid = null;
      if (scope_type === 'unit') { const m = units.filter(u => u.name === nm); if (m.length !== 1) errs.push(m.length ? 'اسم الوحدة غير فريد' : 'الوحدة غير موجودة'); else sid = m[0].id; }
      if (scope_type === 'employee') { const m = emps.find(e => e.emp_no === nm); if (!m) errs.push('الموظف غير موجود'); else sid = m.id; }
      const year = Number(r0.year); const tt = TTYPE[r0.target_type] || (Object.values(TTYPE).includes(r0.target_type) ? r0.target_type : null);
      const value = toNum(r0.value);
      if (!Number.isInteger(year)) errs.push('السنة غير صالحة'); if (!tt) errs.push('نوع المستهدف غير معروف'); if (!(value >= 0)) errs.push('القيمة غير صالحة');
      if (!errs.length && apply) {
        await client.query(`INSERT INTO targets(scope_type, scope_id, year, target_type, value) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (scope_type, scope_id, year) DO UPDATE SET target_type=EXCLUDED.target_type, value=EXCLUDED.value, updated_at=now()`, [scope_type, sid, year, tt, value]);
      }
      results.push({ row: r0._row, ok: !errs.length, errors: errs, warnings: [], action: 'إضافة/تحديث', label: `${nm} ${r0.year}` });
    }
    return results;
  },
};

r.post('/:kind', requirePerm('import'), upload.single('file'), wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) throw httpError(404, 'نوع الاستيراد غير معروف');
  if (!req.file) throw httpError(400, 'لم يُرفع ملف');
  const commit = req.query.mode === 'commit';
  const opts = { createMissing: req.query.create_missing === '1' };
  const rows = await readRows(req.file, kind);
  if (!rows.length) throw httpError(400, 'لا توجد صفوف بيانات في الملف');
  if (rows.length > 5000) throw httpError(400, 'الحد الأقصى 5000 صف في الملف الواحد');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // معاينة أولاً دائماً؛ الاعتماد لا يتم إلا إذا خلت النتائج من الأخطاء (أو طُلب تجاهل الصفوف الخاطئة)
    const preview = await processors[kind](rows, false, client, opts);
    const bad = preview.filter(x => !x.ok);
    let result = { mode: commit ? 'commit' : 'preview', total: rows.length, valid: preview.length - bad.length, invalid: bad.length, rows: preview };
    if (commit) {
      if (bad.length && req.query.skip_invalid !== '1') throw httpError(400, `يوجد ${bad.length} صفاً غير صالح؛ صحّحها أو اختر تجاهل الصفوف الخاطئة`);
      const good = rows.filter((_, i) => preview[i].ok);
      await processors[kind](good, true, client, opts);
      result = { ...result, applied: good.length };
    }
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    if (commit) resetOrgGraph();
    if (commit) await audit(req, 'import', kind, '', null, { file: req.file.originalname, applied: result.applied, skipped: bad.length });
    res.json(result);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

export default r;
