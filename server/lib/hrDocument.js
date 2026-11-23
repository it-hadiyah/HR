// مُصيّر المستندات المعتمدة (طلبات الموظفين): صفحة A4 على الورقة الرسمية بتخطيط منسّق.
//  - خطاب تعريف بالراتب: جداول (بيانات الموظف، بنود الراتب، الإجمالي والتفقيط) وإطار للجهة وكتلة توقيع بالختم.
//  - بقية النماذج (مثل تثبيت الراتب): نص منسّق بفقرات متراصّة مع كتلة توقيع بالختم.
// يُبنى من اللقطة النصية المجمّدة (document_text) فتبقى هي المرجع، ويعود لتخطيط النص العام إن تغيّر القالب فلم يُفهم.
import fs from 'node:fs';
import path from 'node:path';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABELS = ['الاسم', 'الرقم الوظيفي', 'الوظيفة', 'الجنسية', 'تاريخ التعيين', 'رقم الهوية', 'الأساسي', 'بدل سكن', 'بدل مواصلات', 'بدلات أخرى', 'أخرى', 'القرض الحسن', 'صافي الراتب بعد خصم التأمينات الاجتماعية', 'أساسي مع البدلات النظامية', 'الإجمالي', 'الإجمالي كتابةً'];
const TOTAL_KEYS = ['أساسي مع البدلات النظامية', 'الإجمالي'];

/** يستخرج حقول خطاب التعريف من نصه المجمّد؛ يعيد null إن لم يكن بالشكل المعروف */
export function parseCertificate(text) {
  const lines = String(text || '').split('\n').map(l => l.trim());
  const f = {};
  for (const l of lines) {
    const i = l.indexOf(':');
    if (i < 1) continue;
    const k = l.slice(0, i).trim();
    if (LABELS.includes(k) && !(k in f)) f[k] = l.slice(i + 1).trim().replace(/\s*ريال$/, '');
  }
  if (!f['الاسم'] || !f['الأساسي'] || !TOTAL_KEYS.some(k => f[k])) return null;
  const head = lines.find(l => l.startsWith('التاريخ:')) || '';
  const m = /التاريخ:\s*(.+?)هـ\s+الموافق:\s*(.+?)م\s*$/.exec(head);
  const iPara = lines.findIndex(l => l.startsWith('تشهد '));
  const iTo = lines.findIndex(l => l.endsWith('لتقديمه إلى:'));
  if (iPara < 0 || iTo < 0) return null;
  const para = lines.slice(iPara, iTo + 1).join(' ');
  const to = lines.slice(iTo + 1).find(Boolean) || '';
  return { f, hijri: m?.[1]?.trim() || '', greg: m?.[2]?.trim() || '', para, to, tail: lines.slice(iTo + 2).filter(Boolean) };
}

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{font-family:Tahoma,"Segoe UI","Noto Naskh Arabic","Noto Sans Arabic",sans-serif;color:#13302c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper{position:relative;width:210mm;height:297mm;overflow:hidden;direction:rtl;padding:44mm 19mm 54mm;font-size:10.5pt;line-height:1.7;display:flex;flex-direction:column;background-repeat:no-repeat;background-position:center;background-size:100% 100%}
.row{display:flex;justify-content:space-between;align-items:baseline;font-size:9.5pt;color:#333;margin-bottom:5mm}
.title{border:1.4px solid #054d45;border-radius:3mm;text-align:center;padding:2.2mm 4mm;margin:0 auto 6mm;width:108mm;background:#f4faf8}
.title b{display:block;font-size:12.5pt;color:#054d45} .title span{font-size:10.5pt;color:#333}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:5mm}
td,th{border:1px solid #9fb8b3;padding:1.9mm 2.4mm;text-align:center;vertical-align:middle;word-break:break-word}
th{background:#e7f3f0;color:#054d45;font-weight:700;font-size:9pt;line-height:1.35}
td.l{background:#f4faf8;font-weight:700;color:#054d45;width:19%;text-align:right} td.v{text-align:right}
.sec{font-weight:800;color:#054d45;margin:0 0 1.8mm;font-size:11pt}
.num{font-size:10.5pt;font-weight:700;direction:ltr;unicode-bidi:isolate}
.cur{font-size:8.5pt;color:#555;font-weight:400}
.tot td{background:#fff9ec} th.hi{background:#fff1cf} td.hi{background:#fff9ec}
.words{text-align:right;font-weight:700}
.para{text-align:justify;margin:0 0 4mm;line-height:1.9}
.to{border:1.4px solid #054d45;border-radius:2.5mm;text-align:center;padding:1.8mm;font-weight:800;font-size:11.5pt;color:#054d45;margin:0 0 4mm;background:#f4faf8}
.line{margin:0 0 1.5mm}
.sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto}
.sign .who{font-weight:800;font-size:11pt;line-height:1.9} .sign .who small{display:block;font-weight:400;font-size:9pt;color:#555}
.sigimg{display:block;max-height:15mm;max-width:46mm;margin:0 0 1mm;mix-blend-mode:multiply}
.stamp{width:27mm;height:auto;mix-blend-mode:multiply}
.foot{position:absolute;right:19mm;left:19mm;bottom:41mm;font-size:7.5pt;color:#555;display:flex;justify-content:space-between;gap:6mm;border-top:1px solid #cfdcd9;padding-top:1.6mm}
.gen p{margin:0 0 2.2mm;text-align:right;white-space:pre-wrap;word-break:break-word;line-height:1.95} .gen h2{margin:0 0 5mm;font-size:13pt;text-align:center;color:#054d45}
.gen .gap{height:3mm}
`;

const bg = (imgDir, name) => `data:image/png;base64,${fs.readFileSync(path.join(imgDir, name)).toString('base64')}`;

function certificateBody(c) {
  const f = c.f, num = v => `<span class="num">${esc(v)}</span> <span class="cur">ريال</span>`;
  const cell = (l, v) => `<td class="l">${l}</td><td class="v">${esc(v)}</td>`;
  const totalKey = TOTAL_KEYS.find(k => f[k]);
  const other = f['بدلات أخرى'] ?? f['أخرى'] ?? '0.00';
  // أعمدة الراتب: البنود الموجودة في النص بالترتيب، ثم الإجمالي المميّز (القالب القديم يضيف القرض والصافي)
  const cols = [['الأساسي', f['الأساسي']], ['بدل سكن', f['بدل سكن'] ?? '0.00'], ['بدل مواصلات', f['بدل مواصلات'] ?? '0.00'], ['بدلات أخرى', other]];
  if (f['القرض الحسن'] !== undefined) cols.push(['القرض الحسن', f['القرض الحسن']]);
  if (f['صافي الراتب بعد خصم التأمينات الاجتماعية'] !== undefined) cols.push(['الصافي بعد خصم التأمينات الاجتماعية', f['صافي الراتب بعد خصم التأمينات الاجتماعية']]);
  const totalLabel = totalKey === 'الإجمالي' ? 'الإجمالي' : 'أساسي مع البدلات النظامية';
  cols.push([totalLabel, f[totalKey], true]);
  const w = (100 / cols.length).toFixed(2);
  return `
  <div class="row"><span>التاريخ: <b>${esc(c.hijri)}</b> هـ</span><span>الموافق: <b>${esc(c.greg)}</b> م</span></div>
  <div class="title"><b>جمعية هدية الحاج والمعتمر الخيرية</b><span>( خطاب تعريف )</span></div>
  <table><tbody>
    <tr>${cell('الاسم', f['الاسم'])}${cell('الرقم الوظيفي', f['الرقم الوظيفي'])}</tr>
    <tr>${cell('الوظيفة', f['الوظيفة'])}${cell('الجنسية', f['الجنسية'])}</tr>
    <tr>${cell('تاريخ التعيين', f['تاريخ التعيين'])}${cell('رقم الهوية', f['رقم الهوية'])}</tr>
  </tbody></table>
  <div class="sec">اعتماد بيانات الراتب</div>
  <table>
    <thead><tr>${cols.map(([l, , hi]) => `<th style="width:${w}%"${hi ? ' class="hi"' : ''}>${l}</th>`).join('')}</tr></thead>
    <tbody>
      <tr>${cols.map(([, v, hi]) => `<td${hi ? ' class="hi"' : ''}>${num(v)}</td>`).join('')}</tr>
      <tr class="tot"><td colspan="${cols.length}" class="words"><span style="color:#054d45">الإجمالي كتابةً:</span> ${esc(f['الإجمالي كتابةً'] || '')}</td></tr>
    </tbody>
  </table>
  <p class="para">${esc(c.para)}</p>
  <div class="to">${esc(c.to)}</div>
  ${c.tail.filter(l => !/^ص\//.test(l) && !l.startsWith('ملاحظة') && l !== 'إدارة رأس المال البشري').map(l => `<p class="line">${esc(l)}</p>`).join('')}`;
}

/** تخطيط النص العام: عنوان # ثم فقرات؛ ما بعد «الختم الرسمي» (المدير والاسم والتوقيع) ينتقل إلى كتلة التوقيع بجوار الختم */
function genericBody(text) {
  const out = [], sig = []; let inSig = false;
  const fmt = l => esc(l).replace(/(SA\d{22})/g, '<bdi dir="ltr">$1</bdi>');
  for (const raw of String(text).split('\n')) {
    const l = raw.trimEnd();
    if (/^\s*الختم الرسمي\s*$/.test(l)) { inSig = true; continue; }
    if (inSig) { if (l.trim()) sig.push(l.trim()); continue; }
    if (l.startsWith('# ')) out.push(`<h2>${esc(l.slice(2))}</h2>`);
    else if (!l.trim()) out.push('<div class="gap"></div>');
    else out.push(`<p>${fmt(l)}</p>`);
  }
  return { html: `<div class="gen">${out.join('')}</div>`, sig };
}

/** صفحة HTML مستقلة للمستند (تُعرض في إطار وتُحوَّل إلى PDF) */
export function renderDocumentHtml({ row, code, stamp, imgDir }) {
  const cert = row.type === 'certificate' ? parseCertificate(row.document_text) : null;
  const stampImg = stamp?.enabled ? `<img class="stamp" src="data:${stamp.mime};base64,${Buffer.from(stamp.data).toString('base64')}" alt="الختم الرسمي">` : '<span></span>';
  const note = String(row.document_text).split('\n').find(l => l.startsWith('ملاحظة')) || '';
  const gen = cert ? null : genericBody(row.document_text);
  const body = cert ? certificateBody(cert) : gen.html;
  const sigImg = row.document_data?.signature ? `<img class="sigimg" src="${esc(row.document_data.signature)}" alt="التوقيع">` : '';
  const who = cert ? `${sigImg}<div>إدارة رأس المال البشري</div><small>ص/ لملف الموظف.</small>` : sigImg + gen.sig.map((l, k) => (/^(التوقيع|ص\/)/.test(l) ? `<small style="margin-top:2mm">${esc(l)}</small>` : `<div>${esc(l)}</div>`)).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(row.ref_no)}</title><style>${CSS}</style></head><body>
  <div class="paper" style="background-image:url(${bg(imgDir, 'letterhead.png')})">
    ${body}
    <div class="sign"><div class="who">${who}</div>${stampImg}</div>
    <div class="foot"><span>${esc(note)}</span><span>رقم المستند: <b>${esc(row.ref_no)}</b> · رمز التحقق: <b dir="ltr">${esc(code)}</b></span></div>
  </div></body></html>`;
}
