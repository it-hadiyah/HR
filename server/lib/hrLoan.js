// نموذج طلب السلفة (للموارد البشرية فقط) على هيئة النموذج المعتمد: 1 بيانات طالب السلفة · 2 بيانات الضامن · 3 إدارة رأس المال البشري ·
// 4 الإدارة المالية · 5 اعتماد الرئيس التنفيذي. تُعبَّأ البيانات والأسماء والتواريخ آلياً وتبقى خانات التوقيع للتوقيع بالحبر.
import fs from 'node:fs';
import path from 'node:path';
import { tafqeet } from '../../public/hr-forms/engine.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yn = v => (v ? 'نعم' : 'لا');

/** نص مجمّد مقروء للنموذج (يُحسب منه رمز التحقق ويُحفظ للأرشفة) */
export function loanText(d) {
  const e = d.employee, g = d.guarantor, l = d.loan, h = d.hr;
  return [
    `# نموذج طلب سلفة — ${d.ref_no}`, `التاريخ: ${d.issue_date}`, '',
    '1) بيانات طالب السلفة', `الاسم: ${e.name}`, `الرقم الوظيفي: ${e.emp_no || ''}`, `المسمى الوظيفي: ${e.job_title || ''}`, `الإدارة: ${e.department || ''}`, `القسم: ${e.section || ''}`, `بداية العمل: ${e.hire_date || ''}`,
    `الراتب الأساسي: ${money(e.basic)}`, `الراتب الإجمالي: ${money(e.gross)}`, `مبلغ السلفة المطلوب: ${money(l.requested_amount)}`, `سبب الطلب: ${l.reason || ''}`, '',
    '2) بيانات الضامن', `الاسم: ${g.name}`, `الرقم الوظيفي: ${g.emp_no || ''}`, `الوظيفة: ${g.job_title || ''}`, `الإدارة: ${g.department || ''}`, `القسم: ${g.section || ''}`, `الراتب: ${money(g.salary)}`, `بداية العمل: ${g.hire_date}`, `رقم الهوية: ${g.national_id}`, `الجوال: ${g.phone}`, '',
    '3) إدارة رأس المال البشري', `هل تغطي مستحقات الموظف المالية مبلغ السلفة: ${yn(h.covers_employee)}`, `إجمالي مكافأة الموظف: ${money(h.gratuity_employee)}`, `إجمالي مكافأة الضامن: ${money(h.gratuity_guarantor)}`,
    `هل تغطي مجموع مستحقات الموظف والضامن مبلغ السلفة: ${yn(h.covers_both)}`, `ملحوظة: ${h.note || ''}`, `المعتمد: ${h.name}`, '',
    '4) الإدارة المالية', `المبلغ المعتمد: ${money(l.amount)} (${tafqeet(l.amount)})`, `القسط الشهري: ${money(l.installment)}`, `رصيد السلف السابقة: ${money(h.previous_balance)}`, `فترة التسديد (أشهر): ${l.months}`, `بداية أول قسط: ${h.first_installment || ''}`, '',
    `رُفع الطلب: ${d.timeline.requested}`, `اعتمده الكفيل: ${d.timeline.guarantor}`, `اعتمدته الموارد البشرية: ${d.timeline.hr}`,
  ].join('\n');
}

const CSS = `
@page{size:A4;margin:0} *{box-sizing:border-box} html,body{margin:0;background:#fff}
body{font-family:Tahoma,"Segoe UI","Noto Naskh Arabic","Noto Sans Arabic",sans-serif;color:#10302b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper{position:relative;width:210mm;height:297mm;overflow:hidden;direction:rtl;padding:11mm 13mm 10mm;font-size:8.8pt;line-height:1.5;display:flex;flex-direction:column}
.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:3mm;padding-bottom:2mm;border-bottom:2px solid #00a393}
.hd img{height:15mm} .hd .mt{font-size:13pt;font-weight:800;color:#054d45;text-align:center} .hd .mt small{display:block;font-size:7.5pt;font-weight:400;color:#555;direction:ltr} .hd .t{text-align:left;direction:ltr;font-size:8pt;color:#333;line-height:1.35} .hd .t b{display:block;font-size:10pt;color:#054d45;direction:rtl;text-align:left}
.meta{display:flex;justify-content:space-between;font-size:8.5pt;color:#333;margin-bottom:2mm}
.box{display:flex;border:1.2px solid #1b3a35;margin-bottom:2.2mm}
.side{width:9mm;background:#12a05a;color:#fff;font-weight:700;display:flex;flex-direction:column;align-items:center;padding:1mm 0;gap:2mm;flex:none}
.side .n{font-size:10pt;background:#0c7a43;width:100%;text-align:center;padding:.5mm 0} .side .vt{writing-mode:vertical-rl;transform:rotate(180deg);font-size:7.5pt;letter-spacing:.3px;white-space:nowrap;margin:auto 0}
.body{flex:1;padding:1.6mm 3mm;min-width:0}
.ttl{text-align:center;font-weight:800;color:#054d45;font-size:9.5pt;margin-bottom:1mm} .ttl small{font-weight:400;color:#555;margin-inline-start:2mm;font-size:7.5pt}
.g{display:grid;grid-template-columns:repeat(6,1fr);gap:.6mm 3mm}
.f{display:flex;gap:1.5mm;align-items:baseline;border-bottom:1px dotted #7d9a95;padding-bottom:.3mm;min-height:5mm} .f.s2{grid-column:span 2} .f.s3{grid-column:span 3} .f.s6{grid-column:1/-1}
.f span{color:#555;white-space:nowrap;font-size:8pt} .f b{font-weight:700;color:#0a2a26;word-break:break-word}
.ack{margin:1.2mm 0;line-height:1.7;text-align:justify}
.ack u{font-weight:700;text-decoration:none;border-bottom:1px solid #444;padding:0 2mm}
.sg{display:flex;gap:4mm;margin-top:1.2mm}
.sg div{flex:1;border-bottom:1px dotted #7d9a95;min-height:5mm;font-size:8pt;color:#555} .sg b{color:#0a2a26;font-weight:700}
.sgn{position:relative;min-height:12mm} .sigimg{position:absolute;inset-inline-start:10mm;bottom:0;max-height:12mm;max-width:40mm;mix-blend-mode:multiply}
.chk{display:inline-block;width:3.2mm;height:3.2mm;border:1px solid #222;margin:0 1mm;vertical-align:-.5mm;text-align:center;line-height:3mm;font-size:8pt} .chk.on::after{content:"✔"}
table{width:100%;border-collapse:collapse;margin:1mm 0} td,th{border:1px solid #8aa6a1;padding:.8mm 2mm;font-size:8.3pt} th{background:#eaf5f2;width:60%;text-align:right} td.v{text-align:center;font-weight:700}
.ft{margin-top:auto;font-size:7.2pt;color:#444;display:flex;justify-content:space-between;gap:3mm;border-top:1px solid #9fb8b3;padding-top:1.2mm}
`;

export function renderLoanHtml({ row, d, code, imgDir }) {
  const logoSvg = path.join(imgDir, '../../login/logo-color.svg');
  const logo = fs.existsSync(logoSvg) ? `<img src="data:image/svg+xml;base64,${fs.readFileSync(logoSvg).toString('base64')}" alt="هدية">` : '<b>هدية</b>';
  const e = d.employee, g = d.guarantor, l = d.loan, h = d.hr, t = d.timeline;
  const f = (label, val, cls = '') => `<div class="f ${cls}"><span>${label}:</span><b>${esc(val ?? '')}</b></div>`;
  const sign = (name, date, sig) => `<div class="sg"><div>الاسم: <b>${esc(name)}</b></div><div class="sgn">التوقيع: ${sig ? `<img class="sigimg" src="${esc(sig)}" alt="توقيع">` : ''}</div><div>التاريخ: <b>${esc(date)}</b></div></div>`;
  const box = (n, label, title, en, inner) => `<div class="box"><div class="side"><div class="n">${n}</div><div class="vt">${label}</div></div><div class="body"><div class="ttl">${title}<small>${en}</small></div>${inner}</div></div>`;
  const chk = v => `<span class="chk${v ? ' on' : ''}"></span>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(row.ref_no)}</title><style>${CSS}</style></head><body>
  <div class="paper">
    <div class="hd">${logo}<div class="mt">نموذج طلب سلفة<small>Employee Advance Request</small></div><div class="t"><b>إدارة رأس المال البشري</b>Human Capital Management</div></div>
    <div class="meta"><span>رقم الطلب: <b>${esc(row.ref_no)}</b></span><span>تاريخ الإصدار: <b>${esc(d.issue_date)}</b></span></div>
    ${box(1, 'Employee', 'بيانات طالب السلفة', 'Emp. Advance data', `
      <div class="g">${f('الاسم', e.name, 's3')}${f('الرقم الوظيفي', e.emp_no, 's3')}${f('المسمى الوظيفي', e.job_title, 's3')}${f('الإدارة', e.department, 's3')}${f('القسم', e.section, 's3')}${f('بداية العمل', e.hire_date, 's3')}
        ${f('الراتب الأساسي', money(e.basic), 's2')}${f('الراتب الإجمالي', money(e.gross), 's2')}${f('مبلغ السلفة المطلوب', money(l.requested_amount), 's2')}</div>
      <div class="ack">أقر أنا الموقع أدناه أنني أطلب مبلغاً وقدره <u>${esc(money(l.requested_amount))}</u> ريال فقط لا غير كسلفة يتم تسديدها حسب النظام الداخلي للجمعية.${l.reason ? ` <span style="color:#555">(السبب: ${esc(l.reason)})</span>` : ''}</div>
      ${sign(e.name, t.requested, e.signature)}`)}
    ${box(2, 'Warrantor', 'بيانات الضامن', 'warrantor data', `
      <div class="g">${f('الاسم', g.name, 's3')}${f('الرقم الوظيفي', g.emp_no, 's3')}${f('الوظيفة', g.job_title, 's3')}${f('القسم', g.section, 's3')}${f('الإدارة', g.department, 's3')}${f('الراتب', money(g.salary), 's3')}
        ${f('بداية العمل', g.hire_date, 's2')}${f('رقم الهوية', g.national_id, 's2')}${f('الجوال', g.phone, 's2')}</div>
      <div class="ack">الإقرار: أوافق على ضمان المستفيد من السلفة ضماناً شاملاً في مبلغ السلفة المذكور أعلاه فقط <u>${esc(tafqeet(l.requested_amount))}</u></div>
      ${sign(g.name, t.guarantor, g.signature)}`)}
    ${box(3, 'Human Capital', 'إدارة رأس المال البشري', 'Human Capital Management', `
      <div class="ack">هل تغطي مستحقاته المالية مبلغ السلفة؟ ${chk(h.covers_employee)} نعم ${chk(!h.covers_employee)} لا &nbsp;&nbsp;·&nbsp;&nbsp; بداية العمل: <b>${esc(e.hire_date)}</b></div>
      <table><tbody>
        <tr><th>إجمالي مكافأة طالب السلفة (الموظف)</th><td class="v">${esc(money(h.gratuity_employee))}</td></tr>
        <tr><th>إجمالي مكافأة الضامن</th><td class="v">${esc(money(h.gratuity_guarantor))}</td></tr>
        <tr><th>مجموع إجمالي مكافآت (الموظف والضامن)</th><td class="v">${esc(money(h.gratuity_employee + h.gratuity_guarantor))}</td></tr>
      </tbody></table>
      <div class="ack">هل تغطي مجموع مستحقات الموظف والضامن مبلغ السلفة؟ ${chk(h.covers_both)} نعم ${chk(!h.covers_both)} لا &nbsp;&nbsp;·&nbsp;&nbsp; ملحوظة إن وجد: <b>${esc(h.note || '—')}</b></div>
      ${sign(h.name, t.hr, h.signature)}`)}
    ${box(4, 'Financial', 'الإدارة المالية', 'Financial', `
      <div class="g">${f('القسط الشهري', money(l.installment), 's2')}${f('رصيد السلف السابقة', money(h.previous_balance), 's2')}${f('المبلغ المعتمد', money(l.amount), 's2')}
        ${f('فترة التسديد', l.months + ' شهراً', 's3')}${f('بداية أول قسط', h.first_installment || '', 's3')}</div>
      ${sign('', '')}`)}
    ${box(5, 'Approval', 'اعتماد الرئيس التنفيذي', 'CEO approval', `
      <div class="ack" style="font-size:9.5pt;font-weight:700">الرئيس التنفيذي &nbsp; ${chk(false)} موافق &nbsp; ${chk(false)} غير موافق</div>
      <div class="sg"><div>التوقيع:</div><div>التاريخ:</div></div>`)}
    <div class="ft"><span>الأصل + صورة لشؤون الموظفين · صورة لملف الموظف · صورة لإدارته · صورة لمحاسب الرواتب</span><span>للموارد البشرية فقط · رمز التحقق: <b dir="ltr">${esc(code)}</b></span></div>
  </div></body></html>`;
}
