'use strict';
// استيراد الأعضاء من Excel/CSV: معاينة ← تحقق ← اكتشاف التكرار ← اعتماد صريح ← ملخص.
// لا حذف ولا استبدال: الصفوف المكررة تُتخطّى فقط، والاعتماد يتم في معاملة واحدة.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const config = require('../config');
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const settings = require('./settings');
const members = require('./members');
const { bad, notFound, conflict } = require('../lib/errors');
const N = require('../lib/normalize');

const MAX_ROWS = 5000;
const FIELDS = [
  { key: 'full_name', label: 'الاسم الكامل', required: true, syn: ['الاسم', 'الاسم الكامل', 'اسم العضو', 'name', 'full name', 'full_name'] },
  { key: 'phone', label: 'رقم الجوال', syn: ['الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف', 'جوال', 'mobile', 'phone'] },
  { key: 'email', label: 'البريد الإلكتروني', syn: ['البريد', 'البريد الإلكتروني', 'البريد الالكتروني', 'ايميل', 'email', 'e-mail'] },
  { key: 'type', label: 'نوع العضوية', syn: ['نوع العضوية', 'النوع', 'الفئة', 'type', 'membership type'] },
  { key: 'start_date', label: 'تاريخ بداية العضوية', required: true, syn: ['تاريخ بداية العضوية', 'بداية العضوية', 'تاريخ البداية', 'تاريخ الانضمام', 'start', 'start date', 'joined'] },
  { key: 'end_date', label: 'تاريخ انتهاء العضوية', syn: ['تاريخ انتهاء العضوية', 'نهاية العضوية', 'تاريخ الانتهاء', 'end', 'end date', 'expiry'] },
  { key: 'amount_due', label: 'قيمة الاشتراك', syn: ['قيمة الاشتراك', 'الاشتراك', 'المبلغ المستحق', 'المستحق', 'amount', 'fee'] },
  { key: 'due_date', label: 'تاريخ الاستحقاق', syn: ['تاريخ الاستحقاق', 'تاريخ استحقاق السداد', 'الاستحقاق', 'due date', 'due'] },
  { key: 'paid_amount', label: 'المبلغ المسدد', syn: ['المبلغ المسدد', 'المسدد', 'المدفوع', 'paid', 'paid amount'] },
  { key: 'paid_at', label: 'تاريخ السداد', syn: ['تاريخ السداد', 'تاريخ آخر سداد', 'تاريخ اخر سداد', 'paid at', 'paid date'] },
  { key: 'notes', label: 'ملاحظات', syn: ['ملاحظات', 'ملاحظة', 'notes'] },
];
const norm = (s) => N.latinDigits(String(s ?? '')).replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const dir = () => { const d = path.join(config.uploadDir, 'imports'); fs.mkdirSync(d, { recursive: true, mode: 0o750 }); return d; };

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    if ('error' in v) return null;
  }
  return v;
}

async function readTable(fullPath, ext) {
  const buf = fs.readFileSync(fullPath);
  let rows;
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw bad('الملف لا يحتوي على أوراق');
    rows = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const arr = [];
      for (let i = 1; i <= width; i++) arr.push(cellValue(row.getCell(i).value));
      rows.push({ n: row.number, cells: arr });
    });
  } else {
    let text = buf.toString('utf8').replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const recs = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true, trim: true });
    rows = recs.map((cells, i) => ({ n: i + 1, cells }));
  }
  if (rows.length < 2) throw bad('الملف فارغ أو لا يحتوي إلا على صف العناوين');
  const header = rows[0].cells.map((c) => String(c ?? '').trim());
  const data = rows.slice(1).filter((r) => r.cells.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  if (data.length > MAX_ROWS) throw bad(`الحد الأقصى ${MAX_ROWS} صف في الدفعة الواحدة`);
  return { header, rows: data };
}

function autoMap(header) {
  const mapping = {};
  for (const f of FIELDS) {
    const idx = header.findIndex((h, i) => !Object.values(mapping).includes(i) && f.syn.map(norm).includes(norm(h)));
    if (idx >= 0) mapping[f.key] = idx;
  }
  return mapping;
}

function sanitizeMapping(mapping, width) {
  const out = {};
  for (const f of FIELDS) {
    const v = mapping?.[f.key];
    if (v === null || v === undefined || v === '') continue;
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= width) throw bad(`عمود غير صالح للحقل ${f.label}`);
    out[f.key] = i;
  }
  return out;
}

async function loadExisting() {
  const rows = (await pool.query('SELECT phone, lower(email) AS email, lower(btrim(full_name)) AS name, member_no FROM members')).rows;
  const idx = { phone: new Map(), email: new Map(), name: new Map() };
  for (const r of rows) {
    if (r.phone) idx.phone.set(r.phone, r.member_no);
    if (r.email) idx.email.set(r.email, r.member_no);
    idx.name.set(r.name, r.member_no);
  }
  return idx;
}

/** يتحقق من كل صف ويكتشف التكرار؛ يعيد النتيجة دون كتابة أي بيانات */
async function validateRows(table, mapping, options) {
  const types = (await pool.query('SELECT * FROM membership_types WHERE is_active')).rows;
  const typeByName = new Map(types.map((t) => [norm(t.name_ar), t]));
  const defType = options.default_type_id ? types.find((t) => t.id === Number(options.default_type_id)) : null;
  const all = await settings.getAll();
  const rules = options.duplicate_rules?.length ? options.duplicate_rules : all['import.duplicate_rules'] || ['phone', 'email'];
  const existing = await loadExisting();
  const seen = { phone: new Map(), email: new Map(), name: new Map() };
  const get = (r, k) => (mapping[k] === undefined ? null : r.cells[mapping[k]] ?? null);
  const out = [];
  for (const r of table.rows) {
    const errors = [], dup = [];
    const d = {};
    const tryField = (k, fn) => { try { d[k] = fn(); } catch (e) { errors.push({ field: k, message: e.message }); } };
    tryField('full_name', () => { const s = N.clean(get(r, 'full_name')); if (!s || s.length < 3) throw new Error('الاسم مطلوب (3 أحرف على الأقل)'); return s; });
    tryField('phone', () => N.normalizePhone(get(r, 'phone')));
    tryField('email', () => N.normalizeEmail(get(r, 'email')));
    tryField('notes', () => N.clean(get(r, 'notes')));
    let type = defType;
    const tn = N.clean(get(r, 'type'));
    if (tn) { type = typeByName.get(norm(tn)); if (!type) errors.push({ field: 'type', message: `نوع العضوية غير معروف: ${tn}` }); }
    else if (!defType) errors.push({ field: 'type', message: 'نوع العضوية مطلوب' });
    d.type = type;
    tryField('start_date', () => { const x = N.normalizeDate(get(r, 'start_date')); if (!x) throw new Error('تاريخ البداية مطلوب'); return x; });
    tryField('end_date', () => N.normalizeDate(get(r, 'end_date')));
    tryField('due_date', () => N.normalizeDate(get(r, 'due_date')));
    tryField('amount_due', () => N.normalizeMoney(get(r, 'amount_due')));
    tryField('paid_amount', () => N.normalizeMoney(get(r, 'paid_amount')));
    tryField('paid_at', () => {
      const x = N.normalizeDate(get(r, 'paid_at'));
      if (x && x > N.todayRiyadh()) throw new Error('تاريخ السداد مستقبلي');
      return x;
    });
    if (type && d.start_date) {
      d.end_date = d.end_date || N.periodEnd(d.start_date, type.default_duration_months);
      if (d.end_date < d.start_date) errors.push({ field: 'end_date', message: 'تاريخ الانتهاء يسبق تاريخ البداية' });
      d.due_date = d.due_date || d.start_date;
      const fee = d.amount_due ?? (Number(type.default_fee) > 0 ? type.default_fee : N.normalizeMoney(all['fees.default_amount'] ?? 0));
      d.exempt = type.fee_exempt && (d.amount_due === null || Number(d.amount_due) === 0);
      d.amount_due = d.exempt ? '0.00' : fee;
      if (d.paid_amount && Number(d.paid_amount) > 0) {
        if (d.exempt) errors.push({ field: 'paid_amount', message: 'لا يمكن تسجيل مبلغ مسدد لعضوية معفاة' });
        else if (N.cents(d.paid_amount) > N.cents(d.amount_due)) errors.push({ field: 'paid_amount', message: 'المبلغ المسدد يتجاوز قيمة الاشتراك' });
        d.paid_at = d.paid_at || d.start_date;
        if (d.paid_at > N.todayRiyadh()) d.paid_at = N.todayRiyadh();
      }
    }
    // التكرار
    const keys = { phone: d.phone, email: d.email, name: d.full_name ? d.full_name.toLowerCase() : null };
    for (const rule of rules) {
      const v = keys[rule];
      if (!v) continue;
      if (existing[rule].has(v)) dup.push({ rule, with: `عضو موجود ${existing[rule].get(v)}` });
      else if (seen[rule].has(v)) dup.push({ rule, with: `الصف ${seen[rule].get(v)} في الملف` });
    }
    if (!errors.length && !dup.length) for (const rule of rules) if (keys[rule]) seen[rule].set(keys[rule], r.n);
    out.push({ row: r.n, data: d, errors, duplicates: dup, status: errors.length ? 'error' : dup.length ? 'duplicate' : 'valid' });
  }
  return { rows: out, rules };
}

const summarize = (rows) => ({
  total: rows.length, valid: rows.filter((r) => r.status === 'valid').length,
  errors: rows.filter((r) => r.status === 'error').length, duplicates: rows.filter((r) => r.status === 'duplicate').length,
});
const publicRow = (r) => ({ row: r.row, status: r.status, errors: r.errors, duplicates: r.duplicates,
  data: { full_name: r.data.full_name, phone: r.data.phone, email: r.data.email, type: r.data.type?.name_ar, start_date: r.data.start_date,
    end_date: r.data.end_date, amount_due: r.data.amount_due, due_date: r.data.due_date, paid_amount: r.data.paid_amount, exempt: r.data.exempt } });

async function preview(ctx, { file, batchId, mapping, options = {} }) {
  let batch;
  if (batchId) {
    batch = (await pool.query('SELECT * FROM import_batches WHERE id=$1', [batchId])).rows[0];
    if (!batch) throw notFound('دفعة الاستيراد غير موجودة');
    if (batch.status !== 'previewed') throw conflict('تم اعتماد هذه الدفعة أو إلغاؤها', 'batch_closed');
  } else {
    if (!file?.buffer?.length) throw bad('لم يتم اختيار ملف');
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!['.xlsx', '.csv'].includes(ext)) throw bad('الصيغ المدعومة: xlsx و csv');
    if (ext === '.xlsx' && file.buffer.slice(0, 2).toString('latin1') !== 'PK') throw bad('ملف Excel غير صالح');
    const stored = path.join(dir(), crypto.randomBytes(20).toString('hex') + ext);
    fs.writeFileSync(stored, file.buffer, { mode: 0o640 });
    const r = await pool.query(`INSERT INTO import_batches (filename, stored_path, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [path.basename(String(file.originalname)).slice(0, 150), stored, ctx.user.id]);
    batch = r.rows[0];
  }
  let table;
  try { table = await readTable(batch.stored_path, path.extname(batch.stored_path)); }
  catch (e) { if (!batchId) { fs.rmSync(batch.stored_path, { force: true }); await pool.query('DELETE FROM import_batches WHERE id=$1', [batch.id]); } throw e.status ? e : bad('تعذّرت قراءة الملف: ' + e.message); }
  const map = mapping ? sanitizeMapping(mapping, table.header.length) : (Object.keys(batch.mapping || {}).length ? batch.mapping : autoMap(table.header));
  const opts = { duplicate_rules: options.duplicate_rules, default_type_id: options.default_type_id };
  const v = await validateRows(table, map, opts);
  await pool.query('UPDATE import_batches SET mapping=$2, options=$3 WHERE id=$1', [batch.id, JSON.stringify(map), JSON.stringify(opts)]);
  const missing = FIELDS.filter((f) => f.required && map[f.key] === undefined).map((f) => f.label);
  return {
    batch_id: batch.id, filename: batch.filename, header: table.header, mapping: map, fields: FIELDS.map(({ key, label, required }) => ({ key, label, required: !!required })),
    missing_required: missing, duplicate_rules: v.rules, summary: summarize(v.rows),
    rows: v.rows.slice(0, 500).map(publicRow),
    problem_rows: v.rows.filter((r) => r.status !== 'valid').slice(0, 1000).map(publicRow),
  };
}

async function commit(ctx, batchId, { confirm }) {
  if (confirm !== true) throw bad('الاعتماد يتطلب تأكيدًا إداريًا صريحًا');
  const batch = (await pool.query('SELECT * FROM import_batches WHERE id=$1', [batchId])).rows[0];
  if (!batch) throw notFound('دفعة الاستيراد غير موجودة');
  if (batch.status !== 'previewed') throw conflict('تم اعتماد هذه الدفعة مسبقًا', 'batch_closed');
  const table = await readTable(batch.stored_path, path.extname(batch.stored_path));
  const missing = FIELDS.filter((f) => f.required && batch.mapping[f.key] === undefined);
  if (missing.length) throw bad('أعمدة مطلوبة غير مطابقة: ' + missing.map((f) => f.label).join('، '));
  const v = await validateRows(table, batch.mapping, batch.options || {});
  const valid = v.rows.filter((r) => r.status === 'valid');
  const result = await tx(async (c) => {
    // قفل الدفعة لمنع الاعتماد المزدوج المتزامن
    const locked = (await c.query('SELECT status FROM import_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0];
    if (locked.status !== 'previewed') throw conflict('تم اعتماد هذه الدفعة مسبقًا', 'batch_closed');
    let payments = 0;
    for (const r of valid) {
      const d = r.data;
      const m = await c.query(`INSERT INTO members (full_name, phone, email, joined_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [d.full_name, d.phone, d.email, d.start_date, d.notes, ctx.user.id]);
      const { subscription } = await members.insertPeriodWithSubscription(c, ctx, m.rows[0].id, {
        type_id: d.type.id, start_date: d.start_date, end_date: d.end_date, due_date: d.due_date, amount_due: d.amount_due, is_exempt: d.exempt, kind: 'initial' });
      if (d.paid_amount && Number(d.paid_amount) > 0) {
        await c.query(`INSERT INTO payments (subscription_id, member_id, amount, paid_at, method, reference, notes, created_by)
                       VALUES ($1,$2,$3,$4,'opening_balance',$5,'مستورد من ملف',$6)`,
          [subscription.id, m.rows[0].id, d.paid_amount, d.paid_at, `IMPORT-${batchId}-${r.row}`, ctx.user.id]);
        payments++;
      }
    }
    const summary = { ...summarize(v.rows), imported: valid.length, opening_payments: payments, skipped: v.rows.length - valid.length };
    await c.query(`UPDATE import_batches SET status='committed', committed_at=now(), summary=$2 WHERE id=$1`, [batchId, JSON.stringify(summary)]);
    await audit.log(c, ctx, { action: 'members.import', entity: 'import', entityId: batchId, after: { filename: batch.filename, ...summary } });
    return summary;
  });
  fs.rmSync(batch.stored_path, { force: true }); // لا نحتفظ بملف يحوي بيانات شخصية بعد الاعتماد
  return { summary: result, skipped_rows: v.rows.filter((r) => r.status !== 'valid').map(publicRow) };
}

async function cancel(ctx, batchId) {
  const b = (await pool.query('SELECT * FROM import_batches WHERE id=$1', [batchId])).rows[0];
  if (!b) throw notFound('دفعة الاستيراد غير موجودة');
  if (b.status === 'previewed') {
    await pool.query("UPDATE import_batches SET status='cancelled' WHERE id=$1", [batchId]);
    fs.rmSync(b.stored_path, { force: true });
  }
}

async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأعضاء', { views: [{ rightToLeft: true }] });
  ws.addRow(FIELDS.map((f) => (f.required ? `${f.label} *` : f.label)));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5C4D' } }; c.alignment = { horizontal: 'center' }; });
  FIELDS.forEach((f, i) => { ws.getColumn(i + 1).width = 22; });
  const types = (await pool.query('SELECT name_ar FROM membership_types WHERE is_active ORDER BY sort_order, id')).rows;
  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  [['تعليمات تعبئة القالب'], [''], ['• الحقول المعلَّمة بـ * إلزامية: الاسم الكامل، تاريخ بداية العضوية (ونوع العضوية إن لم يُحدَّد نوع افتراضي).'],
    ['• الجوال: 05XXXXXXXX أو +9665XXXXXXXX. البريد بصيغة صحيحة.'], ['• التواريخ بصيغة yyyy-mm-dd (مثال 2026-01-31) أو خلايا تاريخ Excel.'],
    ['• تاريخ الانتهاء اختياري: يُحسب من مدة النوع الافتراضية إن تُرك فارغًا. قيمة الاشتراك الفارغة تأخذ القيمة الافتراضية للنوع.'],
    ['• المبلغ المسدد (اختياري) يُسجَّل كرصيد افتتاحي مرتبط بالاشتراك، ولا يتجاوز قيمة الاشتراك.'],
    ['• لا تحذف صف العناوين. الصفوف المكررة (حسب قواعد الإعدادات) تُتخطّى ولا تستبدل بيانات موجودة.'],
    [''], ['أنواع العضوية المتاحة: ' + types.map((t) => t.name_ar).join('، ')]].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 110; help.getRow(1).font = { bold: true, size: 13 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { preview, commit, cancel, template, FIELDS, autoMap, readTable, validateRows };
