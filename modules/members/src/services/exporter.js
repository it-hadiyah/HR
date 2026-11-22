'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const reports = require('./reports');
const settings = require('./settings');
const L = require('../lib/labels');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDateTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

function xlsxValue(c, v) {
  if (v === null || v === undefined || v === '') return null;
  if (c.type === 'money') return Number(v);
  if (c.type === 'int') return Number(v);
  if (c.type === 'date') return new Date(v + 'T00:00:00Z');
  if (c.type === 'membership_status') return L.membership_status[v] || v;
  if (c.type === 'payment_status') return L.payment_status[v] || v;
  if (c.type === 'payment_method') return L.payment_method[v] || v;
  return String(v);
}

async function toXlsx(rep, org) {
  const wb = new ExcelJS.Workbook();
  wb.creator = org; wb.created = new Date();
  const ws = wb.addWorksheet(rep.title.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const n = rep.columns.length;
  ws.mergeCells(1, 1, 1, n); ws.getCell(1, 1).value = org; ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, n); ws.getCell(2, 1).value = rep.title; ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.mergeCells(3, 1, 3, n);
  const fl = [rep.filters.from && `من ${rep.filters.from}`, rep.filters.to && `إلى ${rep.filters.to}`].filter(Boolean).join(' ');
  ws.getCell(3, 1).value = `${fl ? fl + ' — ' : ''}عدد السجلات: ${rep.count} — أُنشئ في ${fmtDateTime(rep.generated_at)}`;
  ws.getCell(3, 1).font = { color: { argb: 'FF555555' }, size: 10 };
  const header = ws.getRow(4);
  rep.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5C4D' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width || 16;
  });
  header.height = 24;
  rep.rows.forEach((r) => {
    const row = ws.addRow(rep.columns.map((c) => xlsxValue(c, r[c.key])));
    rep.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.type === 'money') { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; }
      else if (c.type === 'date') { cell.numFmt = 'yyyy-mm-dd'; cell.alignment = { horizontal: 'center' }; }
      else if (c.type === 'phone') { cell.alignment = { horizontal: 'right', readingOrder: 'ltr' }; }
    });
  });
  if (Object.keys(rep.totals).length) {
    const row = ws.addRow(rep.columns.map((c, i) => (i === 0 ? 'الإجمالي' : rep.totals[c.key] !== undefined ? Number(rep.totals[c.key]) : null)));
    row.font = { bold: true };
    rep.columns.forEach((c, i) => { if (rep.totals[c.key] !== undefined) row.getCell(i + 1).numFmt = '#,##0.00'; });
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───── PDF عبر Chromium (تشكيل عربي سليم) ─────
let fontCss;
function fonts() {
  if (fontCss) return fontCss;
  const base = path.join(config.nodeModules, '@fontsource', 'ibm-plex-sans-arabic', 'files');
  const face = (w, subset, range) => {
    const f = path.join(base, `ibm-plex-sans-arabic-${subset}-${w}-normal.woff2`);
    if (!fs.existsSync(f)) return '';
    return `@font-face{font-family:'Plex';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2');unicode-range:${range}}`;
  };
  const AR = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
  fontCss = [400, 700].map((w) => face(w, 'arabic', AR) + face(w, 'latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215')).join('');
  return fontCss;
}

function reportHtml(rep, org, brand) {
  const th = rep.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rep.rows.map((r) => `<tr>${rep.columns.map((c) => {
    const cls = c.type === 'money' || c.type === 'int' ? 'num' : (c.type === 'date' || c.type === 'phone' ? 'ltr' : '');
    return `<td class="${cls}">${esc(reports.cellText(c, r[c.key]))}</td>`;
  }).join('')}</tr>`).join('');
  const tot = Object.keys(rep.totals).length
    ? `<tr class="tot">${rep.columns.map((c, i) => `<td class="${c.type === 'money' ? 'num' : ''}">${i === 0 ? 'الإجمالي' : rep.totals[c.key] !== undefined ? esc(reports.cellText({ type: 'money' }, rep.totals[c.key])) : ''}</td>`).join('')}</tr>` : '';
  const fl = [rep.filters.from && `من ${esc(rep.filters.from)}`, rep.filters.to && `إلى ${esc(rep.filters.to)}`].filter(Boolean).join(' ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${fonts()}
  @page{size:A4 landscape;margin:12mm}
  *{box-sizing:border-box} body{font-family:'Plex',sans-serif;font-size:10pt;color:#1b1f1e;margin:0}
  header{border-block-end:2px solid ${esc(brand)};padding-block-end:8px;margin-block-end:10px;display:flex;justify-content:space-between;align-items:end}
  h1{font-size:15pt;margin:0;color:${esc(brand)}} .org{font-size:10pt;color:#555} .meta{font-size:9pt;color:#555;text-align:end}
  table{width:100%;border-collapse:collapse} thead{display:table-header-group}
  th{background:${esc(brand)};color:#fff;font-weight:700;padding:6px 8px;text-align:start;font-size:9pt}
  td{padding:5px 8px;border-block-end:1px solid #dcdfde;font-size:9pt} tr{break-inside:avoid}
  tbody tr:nth-child(even) td{background:#f5f7f6} td.num{text-align:end;font-variant-numeric:tabular-nums} td.ltr{direction:ltr;text-align:end;unicode-bidi:plaintext}
  tr.tot td{font-weight:700;border-block-start:2px solid ${esc(brand)};background:#eef3f1}
  .empty{padding:30px;text-align:center;color:#777}
  </style></head><body>
  <header><div><div class="org">${esc(org)}</div><h1>${esc(rep.title)}</h1></div>
  <div class="meta">${fl ? fl + '<br>' : ''}عدد السجلات: ${rep.count}<br>أُنشئ في ${esc(fmtDateTime(rep.generated_at))}</div></header>
  ${rep.rows.length ? `<table><thead><tr>${th}</tr></thead><tbody>${body}${tot}</tbody></table>` : '<div class="empty">لا توجد بيانات مطابقة للمعايير المحددة</div>'}
  </body></html>`;
}

let browserPromise = null, queue = Promise.resolve();
async function getBrowser() {
  if (!config.chromePath) throw new Error('لم يتم العثور على متصفح Chromium لتوليد PDF. اضبط CHROME_PATH');
  if (!browserPromise) {
    const puppeteer = require('puppeteer-core');
    browserPromise = puppeteer.launch({ executablePath: config.chromePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
      .then((b) => { b.on('disconnected', () => { browserPromise = null; }); return b; })
      .catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}
async function htmlToPdf(html, opts = {}) {
  const job = queue.then(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => (req.url().startsWith('data:') || req.url() === 'about:blank' ? req.continue() : req.abort())); // لا اتصال خارجي
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', landscape: opts.landscape !== false, printBackground: true, preferCSSPageSize: true }));
    } finally { await page.close().catch(() => {}); }
  });
  queue = job.catch(() => {});
  return job;
}
async function closeBrowser() { if (browserPromise) { const b = await browserPromise.catch(() => null); await b?.close().catch(() => {}); browserPromise = null; } }

async function exportReport(id, q, format, preRun) {
  const rep = preRun || await reports.run(id, q);
  const all = await settings.getAll();
  const org = all['org.name'] || '';
  if (format === 'xlsx') return { buffer: await toXlsx(rep, org), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', rep };
  if (format === 'pdf') return { buffer: await htmlToPdf(reportHtml(rep, org, all['brand.primary'] || '#0F5C4D')), mime: 'application/pdf', ext: 'pdf', rep };
  throw new Error('صيغة غير مدعومة');
}

/** ملخص عضوية للطباعة/PDF */
async function memberSummaryPdf(profile, org, brand) {
  const m = profile.member;
  const money = (v) => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const rowsP = profile.periods.map((p) => `<tr><td>${esc(p.type_name)}</td><td class="ltr">${esc(p.start_date)}</td><td class="ltr">${esc(p.end_date)}</td><td class="num">${esc(p.is_exempt ? 'معفى' : money(p.amount_due))}</td><td class="num">${esc(money(p.paid))}</td><td class="num">${esc(money(p.remaining))}</td><td>${esc(L.payment_status[p.payment_status] || '')}</td></tr>`).join('');
  const rowsPay = profile.payments.filter((p) => p.status === 'confirmed').map((p) => `<tr><td class="ltr">${esc(p.paid_at)}</td><td class="num">${esc(money(p.amount))}</td><td>${esc(L.payment_method[p.method] || p.method)}</td><td>${esc(p.reference || '—')}</td></tr>`).join('');
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${fonts()}
  @page{size:A4;margin:14mm} body{font-family:'Plex',sans-serif;font-size:10pt;color:#1b1f1e}
  h1{font-size:16pt;color:${esc(brand)};margin:0} h2{font-size:11pt;margin:16px 0 6px;color:${esc(brand)}}
  header{border-block-end:2px solid ${esc(brand)};padding-block-end:8px;margin-block-end:10px}
  dl{display:grid;grid-template-columns:140px 1fr 140px 1fr;gap:4px 12px;margin:0} dt{color:#666} dd{margin:0;font-weight:700}
  table{width:100%;border-collapse:collapse} th{background:${esc(brand)};color:#fff;padding:5px 8px;text-align:start;font-size:9pt}
  td{padding:5px 8px;border-block-end:1px solid #dcdfde;font-size:9pt} td.num{text-align:end} td.ltr{direction:ltr;text-align:end}
  </style></head><body>
  <header><div style="color:#555">${esc(org)}</div><h1>ملخص العضوية — ${esc(m.full_name)}</h1></header>
  <dl><dt>رقم العضوية</dt><dd>${esc(m.member_no)}</dd><dt>نوع العضوية</dt><dd>${esc(m.type_name || '—')}</dd>
  <dt>حالة العضوية</dt><dd>${esc(L.membership_status[m.membership_status])}</dd><dt>حالة السداد</dt><dd>${esc(L.payment_status[m.payment_status] || '—')}</dd>
  <dt>الجوال</dt><dd style="direction:ltr;text-align:end">${esc(m.phone || '—')}</dd><dt>البريد</dt><dd>${esc(m.email || '—')}</dd>
  <dt>بداية العضوية</dt><dd>${esc(m.period_start || '—')}</dd><dt>نهاية العضوية</dt><dd>${esc(m.period_end || '—')}</dd>
  <dt>إجمالي المستحق</dt><dd>${esc(money(m.total_due))}</dd><dt>إجمالي المتبقي</dt><dd>${esc(money(m.total_remaining))}</dd></dl>
  <h2>دورات الاشتراك</h2><table><thead><tr><th>النوع</th><th>البداية</th><th>النهاية</th><th>المستحق</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${rowsP}</tbody></table>
  <h2>عمليات السداد</h2>${rowsPay ? `<table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th></tr></thead><tbody>${rowsPay}</tbody></table>` : '<p>لا توجد عمليات سداد.</p>'}
  <p style="color:#777;font-size:8pt;margin-top:18px">أُنشئ في ${esc(fmtDateTime(new Date().toISOString()))}</p></body></html>`;
  return htmlToPdf(html, { landscape: false });
}

module.exports = { exportReport, toXlsx, reportHtml, htmlToPdf, memberSummaryPdf, closeBrowser };
