// نماذج الموارد البشرية: اختر القالب والموظف، يُملأ النموذج تلقائياً، ثم انسخه أو اطبعه. وسجل بما صدر وإدارة القوالب.
import { renderTemplate, buildVars, defaultValues, suggestValue, missingRequired, textToHtml, plainText, todayISO } from '/hr-forms/engine.js';
if (window.top !== window.self) document.documentElement.classList.add('embedded');   // داخل بوابة الموارد البشرية: يُخفى الشعار والعنوان المكرران

// ---------- أدوات ----------
const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') n[k] = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
async function api(path, { method = 'GET', body } = {}) {
  const override = ['PUT', 'DELETE', 'PATCH'].includes(method);   // يتجاوز حجب IIS/WebDAV لهذه الأفعال
  const res = await fetch('/api/hr-forms' + path, { method: override ? 'POST' : method, credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(override ? { 'X-HTTP-Method-Override': method } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('انتهت الجلسة'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
const toast = (msg, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3500); };
const fmtTime = s => new Date(s).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

async function copyText(text) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove();
  if (!ok) throw new Error('تعذّر النسخ؛ حدّد النص وانسخه يدوياً');
}
async function copyRich(html, text, node) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return;
  }
  const sel = getSelection(); const range = document.createRange(); range.selectNodeContents(node); sel.removeAllRanges(); sel.addRange(range);
  const ok = document.execCommand('copy'); sel.removeAllRanges();
  if (!ok) throw new Error('تعذّر النسخ المنسّق؛ استخدم «نسخ النص»');
}

// يبني الورقة بعُقد DOM نصية فقط (بلا innerHTML)
function fillPaper(el, text) {
  el.replaceChildren(...text.split('\n').map(line => (line.startsWith('# ') ? h('h2', null, line.slice(2)) : line.trim() ? h('p', null, line) : h('div', { class: 'gap' }))));
  if (state.stamp?.enabled) el.append(h('img', { class: 'stamp', src: stampUrl(), alt: 'الختم الرسمي' }));   // ثابت في كل النماذج
}
const stampUrl = () => '/api/hr-forms/stamp?v=' + (state.stamp?.version || 0);

const state = { templates: [], canManage: false, canUse: false, tab: 'create', stamp: { enabled: true, custom: false, version: 0 } };
const view = document.getElementById('view');

// ---------- صفحة الإنشاء ----------
async function createView() {
  const S = { tpl: null, cat: 'الكل', emp: null, manual: false, values: {}, touched: new Set(), issueDate: todayISO(), summary: [], lastLog: { key: '', t: 0 } };
  const paper = h('div', { class: 'paper empty' });
  const actions = h('div', { class: 'actions' });
  const tplBox = h('div'), empBox = h('div'), fieldsBox = h('div'), missingBox = h('div');

  const employeeObj = () => (S.manual ? S.manualEmp : S.emp) || null;
  S.manualEmp = { full_name: '', emp_no: '', department: '' };

  const compose = () => {
    if (!S.tpl) return '';
    const vars = buildVars({ employee: employeeObj() || {}, values: S.values, issueDate: S.issueDate });
    try { return renderTemplate(S.tpl.body, { vars, fields: S.tpl.fields }); } catch (e) { return `خطأ في القالب: ${e.message}`; }
  };

  function refresh() {
    const emp = employeeObj();
    const miss = S.tpl ? missingRequired(S.tpl.fields, S.values) : [];
    const ready = !!S.tpl && !!emp?.full_name && miss.length === 0;
    if (!S.tpl || !emp?.full_name) {
      paper.className = 'paper empty'; paper.replaceChildren(h('div', null, !S.tpl ? 'اختر النموذج' : 'اختر الموظف', h('br'), h('small', null, 'ثم يظهر النموذج مملوءاً هنا')));
    } else { paper.className = 'paper'; fillPaper(paper, compose()); }
    missingBox.replaceChildren(miss.length && emp?.full_name ? h('div', { class: 'missing' }, 'حقول مطلوبة: ' + miss.join('، ')) : null);
    for (const b of actions.querySelectorAll('button')) b.disabled = !ready || !state.canUse;
  }

  async function issue(action) {
    const emp = employeeObj(); const text = plainText(compose());
    const key = action + '|' + text;
    if (S.lastLog.key !== key || Date.now() - S.lastLog.t > 20000) {
      await api('/log', { method: 'POST', body: { template_id: S.tpl.id, employee_id: S.manual ? null : emp.id, employee_name: emp.full_name, emp_no: emp.emp_no, department: emp.department || emp.section || emp.sector || '',
        values: { ...S.values, issue_date: S.issueDate }, body_text: text, action } });
      S.lastLog = { key, t: Date.now() };
      if (!S.manual && emp.id) loadSummary();
    }
  }
  const act = (label, cls, fn) => h('button', { class: 'btn ' + cls, type: 'button', onclick: guard(fn) }, label);
  actions.append(
    act('نسخ النص', 'primary', async () => { await copyText(plainText(compose())); await issue('copy'); toast('تم النسخ — الصقه في واتساب أو البريد'); }),
    act('نسخ منسّق (للـ Word والبريد)', '', async () => { const text = plainText(compose()); await copyRich(`<div dir="rtl" style="font-family:Tahoma,Arial;font-size:14px;line-height:1.9">${textToHtml(compose())}</div>`, text, paper); await issue('copy_rich'); toast('تم النسخ المنسّق'); }),
    act('طباعة / حفظ PDF', '', async () => { await issue('print'); window.print(); }),
    act('حفظ في السجل فقط', '', async () => { await issue('save'); toast('حُفظ في السجل'); }));

  // --- القوالب ---
  function drawTemplates() {
    const cats = ['الكل', ...new Set(state.templates.map(t => t.category))];
    tplBox.replaceChildren(
      h('div', { class: 'cats' }, cats.map(c => h('button', { class: 'chip' + (S.cat === c ? ' on' : ''), type: 'button', onclick: () => { S.cat = c; drawTemplates(); } }, c))),
      h('div', { class: 'tpls' }, state.templates.filter(t => S.cat === 'الكل' || t.category === S.cat).map(t => h('button', { class: 'tpl' + (S.tpl?.id === t.id ? ' on' : ''), type: 'button', onclick: () => pickTemplate(t) },
        h('b', null, t.title, h('span', { class: 'tag' }, t.category)), t.description ? h('span', null, t.description) : null))));
  }
  // يعبّئ حقول النموذج المطابقة لبيانات الموظف المسجلة في «إدارة الموظفين» (التعيين والجنسية والهوية والآيبان) ما لم يعدّلها المستخدم
  const PREFILL = ['hire_date', 'nationality', 'national_id', 'iban'];
  function prefillFromEmployee() {
    const e = employeeObj(); if (!e || !S.tpl) return;
    for (const f of S.tpl.fields) if (PREFILL.includes(f.key) && !S.touched.has(f.key) && e[f.key] && !String(e[f.key]).startsWith('••')) S.values[f.key] = e[f.key];
  }
  function pickTemplate(t) {
    S.tpl = t; S.values = defaultValues(t.fields); S.touched = new Set(); prefillFromEmployee(); applySuggestions();
    drawTemplates(); drawFields(); refresh();
  }

  // --- الموظف ---
  let timer;
  function drawEmployee() {
    const list = h('div', { class: 'emp-list', hidden: true });
    const input = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الرقم الوظيفي…', 'aria-label': 'بحث عن موظف', autocomplete: 'off' });
    const search = guard(async () => {
      const { employees } = await api('/employees?q=' + encodeURIComponent(input.value.trim()));
      list.replaceChildren(...(employees.length ? employees.map(e => h('button', { class: 'emp-opt', type: 'button', onclick: () => { S.emp = e; list.hidden = true; prefillFromEmployee(); drawFields(); loadSummary(); drawEmployee(); refresh(); } },
        h('b', null, e.full_name), h('small', null, [e.emp_no ? `رقم ${e.emp_no}` : '', e.job_title, e.department || e.section || e.sector].filter(Boolean).join(' · '))))
        : [h('div', { class: 'emp-opt' }, 'لا نتائج')]));
      list.hidden = false;
    });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    input.addEventListener('focus', search);
    document.addEventListener('click', e => { if (!list.hidden && !empBox.contains(e.target)) list.hidden = true; });
    const me = S.manualEmp;
    const man = h('div', { class: 'manual' },
      h('div', { class: 'full' }, h('input', { type: 'text', placeholder: 'اسم الموظف *', value: me.full_name, oninput: e => { me.full_name = e.target.value; refresh(); } })),
      h('input', { type: 'text', placeholder: 'الرقم الوظيفي', value: me.emp_no, oninput: e => { me.emp_no = e.target.value; refresh(); } }),
      h('input', { type: 'text', placeholder: 'الإدارة', value: me.department, oninput: e => { me.department = e.target.value; refresh(); } }));
    empBox.replaceChildren(
      S.manual ? man : h('div', { class: 'emp-pick' }, input, list),
      !S.manual && S.emp ? h('div', { class: 'emp-card' }, h('div', { class: 'meta' }, h('b', null, S.emp.full_name), h('small', null, [S.emp.emp_no ? `الرقم الوظيفي ${S.emp.emp_no}` : '', S.emp.job_title].filter(Boolean).join(' · ')),
        h('small', null, [S.emp.sector, S.emp.department, S.emp.section].filter(Boolean).join(' ‹ ') || 'بلا وحدة تنظيمية')), h('button', { class: 'btn sm', type: 'button', onclick: () => { S.emp = null; S.summary = []; drawEmployee(); refresh(); } }, 'تغيير')) : null,
      !S.manual && S.emp ? h('div', { class: 'hist' + (S.summary.length ? '' : ' none') }, S.summary.length ? 'نماذج سابقة لهذا الموظف: ' + S.summary.map(s => `${s.template_title} ×${s.n} (آخرها ${fmtTime(s.last_at)})`).join(' — ') : 'لا توجد نماذج سابقة لهذا الموظف.') : null,
      h('button', { class: 'btn sm', type: 'button', style: 'margin-top:8px', onclick: () => { S.manual = !S.manual; drawEmployee(); refresh(); } }, S.manual ? 'اختيار من قائمة الموظفين' : 'الموظف غير موجود؟ أدخله يدوياً'));
  }
  const loadSummary = guard(async () => { if (S.manual || !S.emp?.id || !state.canUse) return; S.summary = (await api(`/employee/${S.emp.id}/summary`)).summary; drawEmployee(); });

  // --- الحقول ---
  function applySuggestions() {
    for (const f of S.tpl?.fields || []) if (f.suggest && !S.touched.has(f.key)) { const v = suggestValue(f, S.values); if (v) S.values[f.key] = v; }
  }
  function control(f) {
    const set = v => { S.values[f.key] = v; S.touched.add(f.key); const before = JSON.stringify(S.values); applySuggestions(); if (JSON.stringify(S.values) !== before) drawFields(); refresh(); };
    if (f.type === 'textarea') return h('textarea', { rows: 3, value: S.values[f.key] ?? '', placeholder: f.placeholder, oninput: e => set(e.target.value) });
    if (f.type === 'select') return h('select', { onchange: e => set(e.target.value) }, (f.options || []).map(o => h('option', { value: o.value, selected: o.value === S.values[f.key] }, o.label || o.value || '—')));
    if (f.type === 'date' || f.type === 'month' || f.type === 'number') return h('input', { type: f.type, value: S.values[f.key] ?? '', placeholder: f.placeholder, oninput: e => set(e.target.value) });
    if (f.type === 'dates') {
      const arr = S.values[f.key] || [];
      const box = h('div', { class: 'dates' });
      const draw = () => {
        box.replaceChildren(...arr.map((d, i) => h('div', { class: 'row' }, h('input', { type: 'date', value: d, oninput: e => { arr[i] = e.target.value; set(arr.slice()); } }), h('button', { class: 'btn sm danger', type: 'button', onclick: () => { arr.splice(i, 1); set(arr.slice()); draw(); } }, '×'))),
          h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: () => { arr.push(''); S.values[f.key] = arr; draw(); } }, '+ إضافة تاريخ')));
      };
      S.values[f.key] = arr; draw(); return box;
    }
    return h('input', { type: 'text', value: S.values[f.key] ?? '', placeholder: f.placeholder, oninput: e => set(e.target.value) });
  }
  function drawFields() {
    if (!S.tpl) { fieldsBox.replaceChildren(h('p', { class: 'hint' }, 'اختر نموذجاً أولاً.')); return; }
    fieldsBox.replaceChildren(
      ...S.tpl.fields.map(f => h('div', null, h('label', { class: 'f' + (f.required ? ' req' : '') }, f.label), control(f))),
      h('div', null, h('label', { class: 'f' }, 'تاريخ النموذج'), h('input', { type: 'date', value: S.issueDate, oninput: e => { S.issueDate = e.target.value || todayISO(); refresh(); } })));
  }

  const card = (n, title, ...kids) => h('div', { class: 'card' }, h('h2', { class: 'sec' }, h('span', { class: 'n' }, n), title), ...kids);
  view.replaceChildren(h('div', { class: 'create' },
    h('div', { class: 'col-inputs' }, card('١', 'اختر النموذج', tplBox), card('٢', 'اختر الموظف', empBox), card('٣', 'عبّئ التفاصيل', fieldsBox, missingBox)),
    h('div', { class: 'paper-wrap' }, actions, paper, h('p', { class: 'hint no-print' }, 'يُسجَّل كل نموذج تنسخه أو تطبعه في «السجل». للنسخ إلى واتساب استخدم «نسخ النص».'))));
  drawTemplates(); drawEmployee(); drawFields(); refresh();
  if (state.templates.length === 1) pickTemplate(state.templates[0]);
  // رابط مباشر من «إدارة الموظفين»: ?emp=ID يختار الموظف مسبقاً
  const pre = new URLSearchParams(location.search).get('emp');
  if (pre && /^\d+$/.test(pre)) {
    const { employees } = await api('/employees?id=' + pre);
    if (employees[0]) { S.emp = employees[0]; prefillFromEmployee(); drawFields(); loadSummary(); drawEmployee(); refresh(); }
  }
}

// ---------- السجل ----------
async function historyView() {
  const q = h('input', { type: 'search', placeholder: 'بحث باسم الموظف أو رقمه أو النموذج…', 'aria-label': 'بحث' });
  const box = h('div');
  const ACT = { copy: 'نسخ', copy_rich: 'نسخ منسّق', print: 'طباعة', save: 'حفظ' };
  const load = guard(async () => {
    const { log } = await api('/log?limit=200&q=' + encodeURIComponent(q.value.trim()));
    box.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['التاريخ', 'الموظف', 'النموذج', 'الإجراء', 'بواسطة', ''].map(t => h('th', null, t)))),
      h('tbody', null, log.length ? log.map(l => h('tr', null, h('td', null, fmtTime(l.issued_at)), h('td', null, h('b', null, l.employee_name), l.emp_no ? h('div', { class: 'hint' }, 'رقم ' + l.emp_no) : null), h('td', null, l.template_title),
        h('td', null, h('span', { class: 'badge' }, ACT[l.action] || l.action)), h('td', null, l.issued_by), h('td', null, h('button', { class: 'btn sm', type: 'button', onclick: () => showLog(l.id) }, 'عرض')))) : [h('tr', null, h('td', { colspan: 6, class: 'hint' }, 'لا يوجد سجل بعد.'))]))));
  });
  let timer; q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  view.replaceChildren(h('div', { class: 'bar' }, q), box);
  await load();
}
const showLog = guard(async id => {
  const l = await api('/log/' + id);
  const ta = h('textarea', { class: 'code', readonly: true, style: 'min-height:360px;font-family:inherit;direction:rtl' }); ta.value = l.body_text;
  modal(`${l.template_title} — ${l.employee_name}`, h('div', null, h('p', { class: 'hint' }, `${fmtTime(l.issued_at)} · بواسطة ${l.issued_by}`), ta),
    [h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await copyText(l.body_text); toast('تم النسخ'); }) }, 'نسخ النص')]);
});

// ---------- إدارة القوالب ----------
async function templatesView() {
  const box = h('div');
  const load = guard(async () => {
    const { templates } = await api('/templates?all=1');
    box.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['الترتيب', 'العنوان', 'الفئة', 'الحقول', 'الحالة', ''].map(t => h('th', null, t)))),
      h('tbody', null, templates.map(t => h('tr', null, h('td', null, String(t.sort_order)), h('td', null, h('b', null, t.title), t.description ? h('div', { class: 'hint' }, t.description) : null), h('td', null, t.category), h('td', null, String(t.fields.length)),
        h('td', null, h('span', { class: 'badge ' + (t.active ? 'ok' : 'off') }, t.active ? 'مفعّل' : 'موقوف')),
        h('td', null, h('div', { class: 'row-acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => editTemplate(t, load) }, 'تعديل'),
          h('button', { class: 'btn sm', type: 'button', onclick: guard(async () => { await api('/templates/' + t.id, { method: 'PUT', body: { active: !t.active } }); await load(); toast(t.active ? 'أُوقف' : 'فُعّل'); }) }, t.active ? 'إيقاف' : 'تفعيل')))))))));
  });
  view.replaceChildren(h('div', { class: 'bar' }, h('button', { class: 'btn primary', type: 'button', onclick: () => editTemplate(null, load) }, '+ قالب جديد'), h('span', { class: 'hint' }, 'القوالب الموقوفة لا تظهر في صفحة الإنشاء ويبقى سجلها.')), box);
  await load();
}

// ---------- الإعدادات: الختم الرسمي ----------
async function settingsView() {
  const prev = h('div', { class: 'stamp-prev' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const enabled = h('input', { type: 'checkbox', checked: state.stamp.enabled });
  const draw = () => {
    prev.replaceChildren(h('img', { src: stampUrl(), alt: 'الختم الحالي' }), h('div', { class: 'hint' }, state.stamp.custom ? 'ختم مخصص مرفوع' : 'الختم الافتراضي'));
    enabled.checked = state.stamp.enabled;
  };
  const upload = guard(async () => {
    if (!file.files[0]) throw new Error('اختر صورة الختم أولاً');
    const fd = new FormData(); fd.append('file', file.files[0]);
    const res = await fetch('/api/hr-forms/stamp', { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'تعذّر الرفع');
    state.stamp = data.stamp; file.value = ''; draw(); toast('تم تغيير الختم، وسيظهر في كل النماذج');
  });
  enabled.addEventListener('change', guard(async () => { state.stamp = (await api('/stamp/enabled', { method: 'PUT', body: { enabled: enabled.checked } })).stamp; draw(); toast(state.stamp.enabled ? 'الختم مفعّل في النماذج' : 'تم إخفاء الختم من النماذج'); }));
  view.replaceChildren(h('div', { class: 'card', style: 'max-width:640px' }, h('h2', { class: 'sec' }, 'الختم الرسمي'),
    h('p', { class: 'hint' }, 'يظهر الختم في موضع ثابت أسفل كل نموذج (على الشاشة والطباعة). عند تجديد الختم ارفع الصورة الجديدة وستُستخدم في كل النماذج فوراً. يُفضّل PNG بخلفية شفافة وبحجم لا يتجاوز 1 ميجابايت.'),
    prev,
    h('div', { class: 'bar', style: 'margin-top:12px' }, file, h('button', { class: 'btn primary', type: 'button', onclick: upload }, 'رفع الختم الجديد'),
      state.stamp.custom ? h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { state.stamp = (await api('/stamp', { method: 'DELETE' })).stamp; draw(); toast('أُعيد الختم الافتراضي'); }) }, 'العودة للختم الافتراضي') : null),
    h('label', null, enabled, ' إظهار الختم في النماذج')));
  draw();
}

function editTemplate(t, onSaved) {
  const T = t ? JSON.parse(JSON.stringify(t)) : { title: '', category: 'إنذارات', description: '', body: '', fields: [], sort_order: 10, active: true };
  const inp = (v, extra = {}) => h('input', { type: 'text', value: v ?? '', ...extra });
  const title = inp(T.title), cat = inp(T.category), desc = inp(T.description), order = inp(T.sort_order, { type: 'number' });
  const body = h('textarea', { class: 'code' }); body.value = T.body;
  const rows = h('div');
  const TYPES = [['text', 'نص'], ['textarea', 'نص طويل'], ['date', 'تاريخ'], ['dates', 'قائمة تواريخ'], ['month', 'شهر'], ['number', 'رقم'], ['select', 'قائمة اختيار']];
  const drawRows = () => rows.replaceChildren(...T.fields.map((f, i) => h('div', { class: 'frow' },
    inp(f.key, { dir: 'ltr', placeholder: 'key', oninput: e => { f.key = e.target.value; } }), inp(f.label, { placeholder: 'العنوان', oninput: e => { f.label = e.target.value; } }),
    h('select', { onchange: e => { f.type = e.target.value; drawRows(); } }, TYPES.map(([v, l]) => h('option', { value: v, selected: f.type === v }, l))),
    h('label', null, h('input', { type: 'checkbox', checked: f.required, onchange: e => { f.required = e.target.checked; } }), ' مطلوب'),
    f.type === 'select' ? inp(JSON.stringify(f.options || []), { dir: 'ltr', placeholder: '[{"value":"..."}]', oninput: e => { f._opts = e.target.value; } }) : inp(f.default, { placeholder: 'قيمة افتراضية', oninput: e => { f.default = e.target.value; } }),
    h('button', { class: 'btn sm danger', type: 'button', onclick: () => { T.fields.splice(i, 1); drawRows(); } }, '×'))));
  drawRows();
  const preview = h('pre', { style: 'white-space:pre-wrap;background:#fafcfc;border:1px solid #e3eae8;border-radius:10px;padding:10px;font-family:inherit;direction:rtl', hidden: true });
  const collect = () => {
    const fields = T.fields.map(f => { const o = { ...f }; if (f._opts !== undefined) { try { o.options = JSON.parse(f._opts); } catch { throw new Error(`خيارات الحقل «${f.key}» ليست JSON صالحاً`); } } delete o._opts; return o; });
    return { title: title.value, category: cat.value, description: desc.value, sort_order: +order.value || 0, body: body.value, fields };
  };
  const test = guard(async () => {
    const c = collect();
    const sample = { full_name: 'محمد أحمد العتيبي', emp_no: '1001', job_title: 'محاسب', department: 'إدارة المالية' };
    const vals = defaultValues(c.fields); for (const f of c.fields) { if (f.type === 'dates') vals[f.key] = ['2026-08-06', '2026-08-14']; if (f.type === 'date') vals[f.key] = '2026-08-06'; if (f.type === 'month') vals[f.key] = '2026-09'; if (f.type === 'text' && !vals[f.key]) vals[f.key] = 'نص تجريبي'; }
    preview.hidden = false; preview.textContent = plainText(renderTemplate(c.body, { vars: buildVars({ employee: sample, values: vals }), fields: c.fields }));
  });
  const help = h('div', { class: 'help' }, 'المتغيرات التلقائية: ', ...['employee_name', 'emp_no', 'department', 'job_title', 'issue_date'].map(k => h('code', null, `{{${k}}}`)), ' · حقولك: ', h('code', null, '{{key}}'), ' · ', h('code', null, '{{key|date}}'), ' ', h('code', null, 'date_num'), ' ', h('code', null, 'weekday'), ' ', h('code', null, 'month_ar'), ' ', h('code', null, 'days_construct'),
    ' · شرط: ', h('code', null, '{{#if key}}…{{else}}…{{/if}}'), ' · قائمة: ', h('code', null, '{{#each key}}{{this|date}}{{/each}}'), ' · خاصية خيار: ', h('code', null, '{{key.prop}}'), ' · سطر يبدأ بـ ', h('code', null, '# '), ' يصبح عنواناً.');
  modal(t ? 'تعديل القالب' : 'قالب جديد', h('div', null,
    h('label', { class: 'f req' }, 'العنوان'), title, h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 100px;gap:8px' }, h('div', null, h('label', { class: 'f' }, 'الفئة'), cat), h('div', null, h('label', { class: 'f' }, 'الوصف'), desc), h('div', null, h('label', { class: 'f' }, 'الترتيب'), order)),
    h('label', { class: 'f req' }, 'نص النموذج'), help, body,
    h('label', { class: 'f' }, 'حقول الإدخال'), rows, h('button', { class: 'btn sm', type: 'button', onclick: () => { T.fields.push({ key: '', label: '', type: 'text', required: false }); drawRows(); } }, '+ إضافة حقل'),
    h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn sm', type: 'button', onclick: test }, 'معاينة ببيانات تجريبية')), preview),
  [h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
    const c = collect();
    if (t) await api('/templates/' + t.id, { method: 'PUT', body: c }); else await api('/templates', { method: 'POST', body: c });
    closeModal(); toast('تم الحفظ'); await onSaved();
  }) }, 'حفظ')]);
}

// ---------- نافذة ----------
let currentModal = null;
function closeModal() { currentModal?.remove(); currentModal = null; }
function modal(title, content, footerBtns = []) {
  closeModal();
  currentModal = h('div', { class: 'modal-bg', onclick: e => { if (e.target === currentModal) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', null, title), content, h('div', { class: 'foot' }, ...footBtnsWith(footerBtns))));
  document.body.append(currentModal);
}
const footBtnsWith = btns => [...btns, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'إغلاق')];
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- التشغيل ----------
const TABS = () => [['create', 'إنشاء نموذج', state.canUse], ['history', 'سجل الصادر', state.canUse], ['templates', 'إدارة القوالب', state.canManage], ['settings', 'الإعدادات', state.canManage]].filter(t => t[2]);
async function show(tab) {
  state.tab = tab; history.replaceState(null, '', '#' + tab);
  document.getElementById('tabs').replaceChildren(...TABS().map(([k, l]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), type: 'button', onclick: () => show(k) }, l)));
  view.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
  try { await ({ create: createView, history: historyView, templates: templatesView, settings: settingsView }[tab])(); } catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
}
try {
  const d = await api('/templates');
  Object.assign(state, { templates: d.templates, canManage: d.can_manage, canUse: d.can_use, stamp: d.stamp || state.stamp });
  const want = location.hash.slice(1);
  await show(TABS().some(t => t[0] === want) ? want : (TABS()[0]?.[0] || 'create'));
  if (!state.canUse && !state.canManage) view.replaceChildren(h('div', { class: 'card' }, 'لا تملك صلاحية إصدار النماذج. تواصل مع مدير النظام.'));
} catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
