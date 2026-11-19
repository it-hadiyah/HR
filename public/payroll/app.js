// الرواتب والإضافي: رواتب الموظفين وتجميعها، وإدخال الإضافي (ساعات) والانتدابات (أيام) بحساب تلقائي من نسب الإعدادات.
import { round2, grossOf, baseOf, dailyWage, hourlyWage, entryAmount, groupRows, buildTree, findRate, assignmentByRate } from '/payroll/calc.js';

// ---------- أدوات ----------
const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') n.value = v;
    else if (['checked', 'disabled', 'hidden', 'selected'].includes(k)) n[k] = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
async function api(path, { method = 'GET', body, form } = {}) {
  const override = ['PUT', 'DELETE', 'PATCH'].includes(method);   // يتجاوز حجب IIS/WebDAV لهذه الأفعال
  const res = await fetch('/api/payroll' + path, { method: override ? 'POST' : method, credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(override ? { 'X-HTTP-Method-Override': method } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('انتهت الجلسة'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
const toast = (msg, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nq = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const sar = v => nf.format(Number(v) || 0);
const qty = v => nq.format(Number(v) || 0);
const normNum = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[,٬،\s]/g, '');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const UNIT_LABEL = { sector: 'قطاع', department: 'إدارة', section: 'قسم' };
const kpi = (l, v, u, { hint, tone } = {}) => h('div', { class: 'kpi ' + (tone || '') }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v, u ? h('span', { class: 'u' }, u) : null), hint ? h('div', { class: 'h' }, hint) : null);
const download = url => { location.href = url; };

const S = { jobTitles: [], settings: null, units: [], can: {}, month: '', tab: 'salaries' };
const view = document.getElementById('view');

// نافذة
let currentModal = null;
const closeModal = () => { currentModal?.remove(); currentModal = null; };
function modal(title, content, footBtns = []) {
  closeModal();
  currentModal = h('div', { class: 'modal-bg', onclick: e => { if (e.target === currentModal) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', null, title), content, h('div', { class: 'foot' }, ...footBtns, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'إغلاق'))));
  document.body.append(currentModal);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const confirmBox = (msg, onYes, danger = true) => modal('تأكيد', h('p', null, msg), [h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: guard(async () => { closeModal(); await onYes(); }) }, 'تأكيد')]);

const monthBar = (onChange) => {
  const m = h('input', { type: 'month', value: S.month, 'aria-label': 'شهر الصرف', style: 'max-width:190px', onchange: e => { if (e.target.value) { S.month = e.target.value; onChange(); } } });
  return h('label', { class: 'f', style: 'margin:0;display:flex;gap:8px;align-items:center' }, 'شهر الصرف', m);
};

// ---------- الرواتب ----------
async function salariesView() {
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم الوظيفي أو المسمى…', 'aria-label': 'بحث' });
  const kpis = h('div', { class: 'kpis' }), box = h('div');
  const edit = S.can.edit_salaries;
  let data = null, timer;
  const unitOpts = [['', '— بدون وحدة —'], ...S.units.filter(u => u.unit_type !== 'org').map(u => [u.id, `${UNIT_LABEL[u.unit_type] || ''}: ${u.name}`])];
  const num = (e, key) => {
    if (!edit || (S.settings.allowances_auto && (key === 'housing' || key === 'transport'))) return h('span', { class: 'auto-' + key }, sar(e[key]));
    const el = h('input', { type: 'text', inputmode: 'decimal', value: e[key] ? String(e[key]) : '', class: 'cell-in', autocomplete: 'off', 'aria-label': key });
    el.addEventListener('change', () => save(e, { [key]: normNum(el.value) }, el));
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
    return el;
  };
  async function save(e, body, el) {
    const tr = el?.closest('tr'); tr?.classList.add('saving');
    try {
      const out = await api('/salaries/' + e.employee_id, { method: 'PUT', body });
      Object.assign(e, out.row); tr?.classList.remove('saving'); tr?.classList.add('saved'); setTimeout(() => tr?.classList.remove('saved'), 1200);
      tr.querySelector('.g').textContent = sar(e.gross); tr.querySelector('.ins').textContent = sar(e.insurance_amount); for (const k of ['housing', 'transport']) { const c = tr.querySelector('.auto-' + k); if (c) c.textContent = sar(e[k]); } recompute();
    } catch (err) { tr?.classList.remove('saving'); el?.classList.add('bad'); toast(err.message, true); }
  }
  function recompute() {
    const rows = data.rows, sum = k => round2(rows.reduce((a, x) => a + x[k], 0));
    data.totals = { employees: rows.length, with_salary: rows.filter(x => x.gross > 0).length, basic: sum('basic'), housing: sum('housing'), transport: sum('transport'), other: sum('other'), gross: sum('gross'), insurance: sum('insurance_amount') };
    drawKpis(); const ft = box.querySelector('tfoot'); if (ft) ft.replaceWith(foot());
  }
  const foot = () => { const t = data.totals; return h('tfoot', null, h('tr', null, h('td'), h('td', null, 'الإجمالي'), h('td'), ...['basic', 'housing', 'transport', 'other', 'gross'].map(k => h('td', { class: 'n' }, sar(t[k]))), h('td'), h('td', { class: 'n' }, sar(t.insurance)), h('td'))); };
  function drawKpis() {
    const t = data.totals;
    kpis.replaceChildren(kpi('الموظفون', String(t.employees), 'موظف', { hint: `${t.with_salary} لهم راتب مسجّل`, tone: t.with_salary < t.employees ? 'warn' : 'ok' }), kpi('إجمالي الرواتب الشهرية', sar(t.gross), 'ر.س', { tone: 'ok' }),
      kpi('إجمالي الأساسي', sar(t.basic), 'ر.س'), kpi('إجمالي البدلات', sar(t.housing + t.transport + t.other), 'ر.س', { hint: `سكن ${sar(t.housing)} · نقل ${sar(t.transport)} · أخرى ${sar(t.other)}` }),
      kpi('إجمالي استقطاع التأمينات', sar(t.insurance), 'ر.س'), kpi('متوسط الراتب', sar(t.with_salary ? t.gross / t.with_salary : 0), 'ر.س'));
  }
  function draw() {
    drawKpis();
    box.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'pay' },
      h('thead', null, h('tr', null, ['#', 'الموظف', 'الوحدة', 'الأساسي', S.settings.allowances_auto ? `السكن (${S.settings.housing_percent}%)` : 'السكن', S.settings.allowances_auto ? `النقل (${S.settings.transport_percent}%)` : 'النقل', 'أخرى', 'الإجمالي', 'نسبة الاستقطاع %', 'استقطاع التأمينات', 'ملاحظات'].map(t => h('th', { class: ['#', 'الإجمالي', 'نسبة الاستقطاع %', 'استقطاع التأمينات'].includes(t) ? 'n' : '' }, t)))),
      h('tbody', null, data.rows.length ? data.rows.map((e, i) => h('tr', null, h('td', { class: 'n' }, String(i + 1)),
        h('td', { class: 'who' }, h('b', null, e.full_name), h('small', null, [e.emp_no ? `رقم ${e.emp_no}` : '', e.job_title].filter(Boolean).join(' · '))),
        h('td', null, edit ? h('select', { class: 'cell-sel', onchange: ev => save(e, { org_unit_id: ev.target.value }, ev.target) }, unitOpts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(e.org_unit_id ?? '') }, l)))
          : h('span', null, [e.sector, e.department, e.section].filter(Boolean).join(' ‹ ') || '—')),
        h('td', { class: 'n' }, num(e, 'basic')), h('td', { class: 'n' }, num(e, 'housing')), h('td', { class: 'n' }, num(e, 'transport')), h('td', { class: 'n' }, num(e, 'other')),
        h('td', { class: 'n' }, h('b', { class: 'g' }, sar(e.gross))),
        h('td', { class: 'n' }, edit ? (() => { const el = h('input', { type: 'text', inputmode: 'decimal', class: 'cell-in', style: 'max-width:80px', value: e.insurance_percent ? String(e.insurance_percent) : '', placeholder: '0', autocomplete: 'off', 'aria-label': 'نسبة الاستقطاع' }); el.addEventListener('change', () => save(e, { insurance_percent: normNum(el.value) }, el)); el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } }); return el; })() : h('span', null, e.insurance_percent ? e.insurance_percent + '%' : '—')),
        h('td', { class: 'n' }, h('b', { class: 'ins' }, sar(e.insurance_amount))),
        h('td', null, edit ? (() => { const el = h('input', { type: 'text', value: e.notes || '', class: 'cell-in wide', 'aria-label': 'ملاحظات' }); el.addEventListener('change', () => save(e, { notes: el.value }, el)); return el; })() : (e.notes || '')))) : [h('tr', null, h('td', { colspan: 11, class: 'hint' }, 'لا يوجد موظفون. أضف الموظفين من «متابعة الأرصدة» أو استورد ملف الرواتب.'))]),
      foot())));
  }
  const load = guard(async () => { data = await api('/salaries?q=' + encodeURIComponent(search.value.trim())); draw(); });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  const importDialog = () => {
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' }); const create = h('input', { type: 'checkbox' }); const skip = h('input', { type: 'checkbox' }); const out = h('div');
    const send = mode => { if (!file.files[0]) throw new Error('اختر ملفاً أولاً'); const fd = new FormData(); fd.append('file', file.files[0]); return api(`/salaries/import?mode=${mode}${create.checked ? '&create_missing=1' : ''}${skip.checked ? '&skip_invalid=1' : ''}`, { method: 'POST', form: fd }); };
    const preview = guard(async () => {
      const d = await send('preview');
      out.replaceChildren(h('div', { class: 'bar' }, h('span', { class: 'badge' }, `${d.total} صف`), h('span', { class: 'badge ok' }, `${d.valid} صالح`), d.invalid ? h('span', { class: 'badge off' }, `${d.invalid} به أخطاء`) : null,
        d.invalid ? h('label', null, skip, ' تجاهل الصفوف الخاطئة') : null,
        h('button', { class: 'btn primary', type: 'button', disabled: d.valid === 0, onclick: guard(async () => { const r = await send('commit'); closeModal(); toast(`تم اعتماد ${r.applied} راتباً`); await load(); }) }, 'اعتماد الاستيراد')),
      h('div', { class: 'tbl-wrap', style: 'max-height:320px' }, h('table', null, h('thead', null, h('tr', null, ['الصف', 'الموظف', 'الإجراء', 'الإجمالي', 'النتيجة'].map(t => h('th', null, t)))),
        h('tbody', null, d.rows.map(r => h('tr', null, h('td', null, String(r.row)), h('td', null, r.label), h('td', null, r.action), h('td', { class: 'n' }, sar(r.gross)),
          h('td', null, r.ok ? h('span', { class: 'badge ok' }, 'صالح') : h('span', { class: 'badge off' }, r.errors.join('؛ ')), r.warnings.length ? h('div', { class: 'hint' }, r.warnings.join('؛ ')) : null)))))));
    });
    modal('استيراد الرواتب من Excel', h('div', null, h('p', { class: 'hint' }, 'أعمدة الملف: الرقم الوظيفي، الاسم، الراتب الأساسي، بدل السكن، بدل النقل، بدلات أخرى. لا يُكتب شيء قبل الاعتماد.'),
      h('div', { class: 'bar' }, h('button', { class: 'btn sm', type: 'button', onclick: () => download('/api/payroll/salaries/template') }, 'تنزيل النموذج'), file, h('button', { class: 'btn primary', type: 'button', onclick: preview }, 'معاينة')),
      h('label', null, create, ' إنشاء الموظفين غير الموجودين (في موظفي المتابعة)'), out));
  };
  view.replaceChildren(h('div', { class: 'bar' }, search, h('div', { class: 'sp' }),
    edit ? h('button', { class: 'btn', type: 'button', onclick: () => confirmBox('جلب الراتب الإجمالي من «متابعة الأرصدة» (السنة الحالية) لمن ليس له راتب هنا؟ يُسجَّل كراتب أساسي ويمكنك توزيعه على البدلات لاحقاً.', guard(async () => { const r = await api('/salaries/pull-from-tracking', { method: 'POST', body: { year: new Date().getFullYear() } }); toast(`تم جلب ${r.imported} راتباً`); await load(); }), false) }, 'جلب من متابعة الأرصدة') : null,
    edit ? h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'استيراد Excel') : null),
  kpis, box);
  await load();
}

// ---------- الإضافي والانتدابات ----------
async function entriesView(kind) {
  const isOt = kind === 'overtime';
  const labels = isOt ? { unit: 'الساعات', one: 'ساعة', types: S.settings.overtime_types, title: 'إضافي', wage: 'الأجر الساعي' } : { unit: 'الأيام', one: 'يوم', types: S.settings.assignment_types, title: 'انتداب', wage: 'الأجر اليومي' };
  let emp = null, list = null;
  const calcBox = h('div'), listBox = h('div'), empBox = h('div');
  const dateIn = h('input', { type: 'date', value: todayISO() });
  const typeSel = h('select', null, labels.types.map(t => h('option', { value: t.id }, `${t.name} (${t.percent}%)`)));
  const qtyIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: isOt ? 'مثال: 3.5' : 'مثال: 2', autocomplete: 'off' });
  const notes = h('input', { type: 'text', placeholder: 'ملاحظات (اختياري)' });
  const addBtn = h('button', { class: 'btn primary', type: 'button', onclick: guard(add) }, '+ إضافة');
  const monthInput = monthBar(() => { loadList(); });

  const typeOf = () => labels.types.find(t => t.id === typeSel.value);
  function drawCalc() {
    if (!emp) { calcBox.replaceChildren(h('p', { class: 'hint' }, 'اختر الموظف ثم أدخل ' + labels.unit + ' ليظهر المبلغ المستحق تلقائياً.')); addBtn.disabled = true; return; }
    const rate = !isOt ? findRate(S.settings.assignment_rates, emp.job_title) : null, n0 = Number(normNum(qtyIn.value));
    if (rate) {
      const a = assignmentByRate(n0 > 0 ? n0 : 0, rate);
      calcBox.replaceChildren(h('div', { class: 'calc' },
        h('div', null, h('span', null, 'المسمى الوظيفي'), h('b', null, rate.title)),
        h('div', null, h('span', null, 'أجر المعيشة / يوم'), h('b', null, sar(rate.living) + ' ر.س')), h('div', null, h('span', null, 'أجر الانتداب / يوم'), h('b', null, sar(rate.assignment) + ' ر.س')),
        h('div', null, h('span', null, 'الأيام'), h('b', null, n0 > 0 ? qty(n0) : '—')), h('div', null, h('span', null, 'أجر النقل (ثابت)'), h('b', null, sar(rate.transport) + ' ر.س')),
        h('div', { class: 'amount' }, h('span', null, 'المبلغ المستحق'), h('b', null, n0 > 0 ? sar(a.amount) + ' ر.س' : '—'))));
      addBtn.disabled = !(n0 > 0); return;
    }
    const base = baseOf(emp, S.settings), t = typeOf(), n = Number(normNum(qtyIn.value));
    if (!(base > 0)) { calcBox.replaceChildren(h('div', { class: 'missing' }, `لا يوجد راتب مسجّل لـ «${emp.full_name}». أدخله من تبويب الرواتب.`)); addBtn.disabled = true; return; }
    const unit = isOt ? hourlyWage(base, S.settings) : dailyWage(base, S.settings);
    const r = n > 0 ? entryAmount(kind, n, t.percent, base, S.settings) : { amount: 0 };
    calcBox.replaceChildren(h('div', { class: 'calc' },
      h('div', null, h('span', null, S.settings.salary_basis === 'basic' ? 'الراتب الأساسي' : 'الراتب الإجمالي'), h('b', null, sar(base) + ' ر.س')),
      h('div', null, h('span', null, labels.wage), h('b', null, sar(unit) + ' ر.س')), h('div', null, h('span', null, 'النسبة'), h('b', null, t.percent + '%')),
      h('div', null, h('span', null, labels.unit), h('b', null, n > 0 ? qty(n) : '—')), h('div', { class: 'amount' }, h('span', null, 'المبلغ المستحق'), h('b', null, n > 0 ? sar(r.amount) + ' ر.س' : '—'))));
    addBtn.disabled = !(n > 0);
  }
  for (const el of [typeSel, qtyIn]) el.addEventListener('input', drawCalc);

  let timer;
  function drawEmp() {
    const list = h('div', { class: 'emp-list', hidden: true });
    const input = h('input', { type: 'search', placeholder: 'ابحث عن الموظف بالاسم أو الرقم…', autocomplete: 'off', 'aria-label': 'موظف' });
    const search = guard(async () => {
      const { employees } = await api('/staff?q=' + encodeURIComponent(input.value.trim()));
      list.replaceChildren(...(employees.length ? employees.map(e => h('button', { class: 'emp-opt', type: 'button', onclick: () => { emp = e; list.hidden = true; drawEmp(); drawCalc(); loadList(); } },
        h('b', null, e.full_name), h('small', null, [e.emp_no ? `رقم ${e.emp_no}` : '', e.department || e.section || e.sector, e.has_salary ? '' : 'بلا راتب'].filter(Boolean).join(' · ')))) : [h('div', { class: 'emp-opt' }, 'لا نتائج')]));
      list.hidden = false;
    });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); }); input.addEventListener('focus', search);
    document.addEventListener('click', ev => { if (!list.hidden && !empBox.contains(ev.target)) list.hidden = true; });
    empBox.replaceChildren(emp ? h('div', { class: 'emp-card' }, h('div', { class: 'meta' }, h('b', null, emp.full_name), h('small', null, [emp.emp_no ? `رقم ${emp.emp_no}` : '', [emp.sector, emp.department, emp.section].filter(Boolean).join(' ‹ ')].filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { emp = null; drawEmp(); drawCalc(); loadList(); } }, 'تغيير')) : h('div', { class: 'emp-pick' }, input, list));
  }

  async function add() {
    const out = await api('/entries', { method: 'POST', body: { kind, employee_id: emp.id, entry_date: dateIn.value, pay_month: S.month, type_id: typeSel.value, quantity: normNum(qtyIn.value), notes: notes.value } });
    qtyIn.value = ''; notes.value = ''; drawCalc();
    toast(`تمت الإضافة: ${sar(out.row.amount)} ر.س`);
    if (out.warning) toast(`تنبيه: إجمالي ساعات الإضافي لهذا الموظف في الشهر ${qty(out.warning.hours)} ساعة وتجاوز الحد (${out.warning.cap})`, true);
    await loadList();
  }
  const loadList = guard(async () => {
    list = await api(`/entries?kind=${kind}&month=${S.month}${emp ? '&employee_id=' + emp.id : ''}`);
    const t = list.totals;
    listBox.replaceChildren(h('div', { class: 'kpis' }, kpi(`إجمالي ${labels.title} الشهر`, sar(t.amount), 'ر.س', { tone: 'ok', hint: `${t.count} بند` }), kpi(isOt ? 'إجمالي الساعات' : 'إجمالي الأيام', qty(t.quantity), labels.one)),
      h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['التاريخ', 'الموظف', 'النوع', labels.unit, 'النسبة', labels.wage, ...(isOt ? [] : ['أجر النقل']), 'المبلغ', 'ملاحظات', ''].map(x => h('th', null, x)))),
        h('tbody', null, list.rows.length ? list.rows.map(e => h('tr', null, h('td', { class: 'n' }, e.entry_date.slice(0, 10)), h('td', null, h('b', null, e.full_name), e.emp_no ? h('div', { class: 'hint' }, 'رقم ' + e.emp_no) : null), h('td', null, e.type_name),
          h('td', { class: 'n' }, qty(e.quantity)), h('td', { class: 'n' }, e.percent + '%'), h('td', { class: 'n' }, sar(e.unit_wage)), ...(isOt ? [] : [h('td', { class: 'n' }, e.fixed_amount ? sar(e.fixed_amount) : '—')]), h('td', { class: 'n' }, h('b', null, sar(e.amount))), h('td', null, e.notes || ''),
          h('td', null, S.can.entries ? h('div', { class: 'row-acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => editEntry(e) }, 'تعديل'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmBox(`حذف بند ${e.full_name} (${sar(e.amount)} ر.س)؟`, async () => { await api('/entries/' + e.id, { method: 'DELETE' }); toast('تم الحذف'); await loadList(); }) }, 'حذف')) : null)))
          : [h('tr', null, h('td', { colspan: 10, class: 'hint' }, 'لا توجد بنود في هذا الشهر.'))]))));
  });
  function editEntry(e) {
    const d = h('input', { type: 'date', value: e.entry_date.slice(0, 10) }), q = h('input', { type: 'text', inputmode: 'decimal', value: String(e.quantity) }), pm = h('input', { type: 'month', value: e.pay_month });
    const ty = h('select', null, labels.types.map(t => h('option', { value: t.id, selected: t.id === e.type_id }, `${t.name} (${t.percent}%)`))); const nt = h('input', { type: 'text', value: e.notes || '' });
    modal(`تعديل بند — ${e.full_name}`, h('div', { class: 'form-2' }, h('div', null, h('label', { class: 'f' }, 'التاريخ'), d), h('div', null, h('label', { class: 'f' }, 'شهر الصرف'), pm), h('div', null, h('label', { class: 'f' }, 'النوع'), ty), h('div', null, h('label', { class: 'f' }, labels.unit), q), h('div', null, h('label', { class: 'f' }, 'ملاحظات'), nt)),
      [h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { const out = await api('/entries/' + e.id, { method: 'PUT', body: { entry_date: d.value, pay_month: pm.value, type_id: ty.value, quantity: normNum(q.value), notes: nt.value } }); closeModal(); toast(`تم الحفظ: ${sar(out.row.amount)} ر.س (تُحسب بالراتب والنسبة الحاليين)`); await loadList(); }) }, 'حفظ')]);
  }
  const form = S.can.entries ? h('div', { class: 'card' }, h('h2', { class: 'sec' }, `إضافة ${labels.title}`), empBox,
    h('div', { class: 'entry-form', style: 'margin-top:10px' }, h('div', null, h('label', { class: 'f' }, 'التاريخ'), dateIn), h('div', null, h('label', { class: 'f' }, 'النوع'), typeSel), h('div', null, h('label', { class: 'f' }, labels.unit), qtyIn), h('div', null, h('label', { class: 'f' }, 'ملاحظات'), notes), h('div', null, addBtn)),
    calcBox) : null;
  const importDialog = () => {
    const file = h('input', { type: 'file', accept: '.xlsx,.csv' }); const skip = h('input', { type: 'checkbox' }); const out = h('div');
    const send = mode => { if (!file.files[0]) throw new Error('اختر ملفاً أولاً'); const fd = new FormData(); fd.append('file', file.files[0]); return api(`/entries/import?kind=${kind}&mode=${mode}&month=${S.month}${skip.checked ? '&skip_invalid=1' : ''}`, { method: 'POST', form: fd }); };
    const preview = guard(async () => {
      const d = await send('preview');
      out.replaceChildren(h('div', { class: 'bar' }, h('span', { class: 'badge' }, `${d.total} صف`), h('span', { class: 'badge ok' }, `${d.valid} صالح · ${sar(d.amount)} ر.س`), d.invalid ? h('span', { class: 'badge off' }, `${d.invalid} به أخطاء`) : null,
        d.invalid ? h('label', null, skip, ' تجاهل الصفوف الخاطئة') : null,
        h('button', { class: 'btn primary', type: 'button', disabled: d.valid === 0, onclick: guard(async () => { const r = await send('commit'); closeModal(); toast(`تم اعتماد ${r.applied} بنداً بمبلغ ${sar(r.amount)} ر.س`); await loadList(); }) }, 'اعتماد الاستيراد')),
      h('div', { class: 'tbl-wrap', style: 'max-height:320px' }, h('table', null, h('thead', null, h('tr', null, ['الصف', 'الموظف', 'التاريخ', 'النوع', labels.unit, 'شهر الصرف', 'المبلغ', 'النتيجة'].map(t => h('th', null, t)))),
        h('tbody', null, d.rows.map(r => h('tr', null, h('td', null, String(r.row)), h('td', null, r.label), h('td', { class: 'n' }, r.date), h('td', null, r.type_name), h('td', { class: 'n' }, r.quantity === null ? '—' : qty(r.quantity)), h('td', { class: 'n' }, r.pay_month), h('td', { class: 'n' }, sar(r.amount)),
          h('td', null, r.ok ? h('span', { class: 'badge ok' }, 'صالح') : h('span', { class: 'badge off' }, r.errors.join('؛ ')))))))));
    });
    modal(`استيراد ${labels.title} من Excel`, h('div', null, h('p', { class: 'hint' }, `أعمدة الملف: الرقم الوظيفي (أو الاسم)، التاريخ، النوع (كما في الإعدادات)، ${labels.unit}، وشهر الصرف اختياري (إن تُرك يُؤخذ الشهر المختار: ${S.month}). المبلغ يُحسب تلقائياً من الراتب والنسبة. لا يُكتب شيء قبل الاعتماد، والبند المطابق المسجّل مسبقاً يُرفض لمنع التكرار.`),
      h('div', { class: 'bar' }, h('button', { class: 'btn sm', type: 'button', onclick: () => download(`/api/payroll/entries/template?kind=${kind}`) }, 'تنزيل النموذج'), file, h('button', { class: 'btn primary', type: 'button', onclick: preview }, 'معاينة')), out));
  };
  view.replaceChildren(h('div', { class: 'bar' }, monthInput, emp ? h('span', { class: 'hint' }, 'مصفّى حسب الموظف المختار') : null, h('div', { class: 'sp' }), S.can.entries ? h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'استيراد Excel') : null), form, listBox);
  drawEmp(); drawCalc(); await loadList();
}

// ---------- التقارير ----------
async function reportView() {
  let mode = 'tree', rows = [], totals = null;
  const body = h('div'), seg = h('div', { class: 'seg' });
  const expanded = new Set(['root']);
  const COLS = [['الموظفون', 'employees', v => String(v)], ['إجمالي الرواتب', 'salaries', sar], ['ساعات الإضافي', 'overtime_hours', qty], ['مبلغ الإضافي', 'overtime_amount', sar], ['أيام الانتداب', 'assignment_days', qty], ['مبلغ الانتداب', 'assignment_amount', sar], ['الإجمالي المستحق', 'total', sar]];
  const head = first => h('thead', null, h('tr', null, [first, ...COLS.map(c => c[0])].map((t, i) => h('th', { class: i ? 'n' : '' }, t))));
  const cells = o => COLS.map(([, k, f]) => h('td', { class: 'n' }, f(o[k])));
  function treeRows(node, depth, path, out) {
    const id = path + '/' + node.name, open = expanded.has(id);
    const hasKids = node.children?.length || node.employeesList?.length;
    out.push(h('tr', { class: `tree-row l${depth}` }, h('td', null, hasKids ? h('button', { class: 'tg', type: 'button', 'aria-label': 'توسيع', onclick: () => { open ? expanded.delete(id) : expanded.add(id); draw(); } }, open ? '▾' : '▸') : null,
      node.level && node.level !== 'root' ? h('small', { class: 'hint' }, (UNIT_LABEL[node.level] || '') + ': ') : null, node.name), ...cells(node)));
    if (!open) return;
    for (const c of node.children || []) treeRows(c, depth + 1, id, out);
    for (const e of node.employeesList || []) out.push(h('tr', { class: 'tree-row l4' }, h('td', null, e.full_name, h('small', { class: 'hint' }, e.emp_no ? ' · ' + e.emp_no : '')),
      ...COLS.map(([, k, f]) => h('td', { class: 'n' }, k === 'employees' ? '' : f(k === 'salaries' ? e.gross : e[k])))));
  }
  function draw() {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === mode);
    if (mode === 'tree') {
      const tree = buildTree(rows), trs = []; treeRows(tree, 0, '', trs);
      body.replaceChildren(h('div', { class: 'bar' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { expandAll(tree, ''); draw(); } }, 'توسيع الكل'), h('button', { class: 'btn sm', type: 'button', onclick: () => { expanded.clear(); expanded.add('/الإجمالي'); draw(); } }, 'طيّ الكل')),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'pay' }, head('الهيكل (قطاع ← إدارة ← قسم ← موظف)'), h('tbody', null, trs))));
      return;
    }
    if (mode === 'employee') {
      body.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'pay' }, h('thead', null, h('tr', null, ['الموظف', 'القطاع', 'الإدارة', 'القسم', 'الراتب الإجمالي', 'ساعات الإضافي', 'مبلغ الإضافي', 'أيام الانتداب', 'مبلغ الانتداب', 'الإجمالي المستحق'].map((t, i) => h('th', { class: i > 3 ? 'n' : '' }, t)))),
        h('tbody', null, [...rows].sort((a, b) => b.total - a.total).map(e => h('tr', null, h('td', null, h('b', null, e.full_name), e.emp_no ? h('div', { class: 'hint' }, 'رقم ' + e.emp_no) : null), h('td', null, e.sector || '—'), h('td', null, e.department || '—'), h('td', null, e.section || '—'),
          ...['gross', 'overtime_hours', 'overtime_amount', 'assignment_days', 'assignment_amount', 'total'].map(k => h('td', { class: 'n' }, k.endsWith('hours') || k.endsWith('days') ? qty(e[k]) : sar(e[k])))))))));
      return;
    }
    const g = groupRows(rows, mode), tot = {}; for (const [, k] of COLS) tot[k] = round2(g.reduce((a, x) => a + x[k], 0));
    body.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'pay' }, head(UNIT_LABEL[mode]), h('tbody', null, g.map(x => h('tr', null, h('td', null, h('b', null, x.name)), ...cells(x)))),
      h('tfoot', null, h('tr', null, h('td', null, 'الإجمالي'), ...cells(tot))))));
  }
  function expandAll(n, path) { const id = path + '/' + n.name; expanded.add(id); for (const c of n.children || []) expandAll(c, id); }
  const MODES = [['tree', 'الهيكل الكامل'], ['sector', 'حسب القطاع'], ['department', 'حسب الإدارة'], ['section', 'حسب القسم'], ['employee', 'حسب الموظف']];
  seg.append(...MODES.map(([m, l]) => h('button', { type: 'button', 'data-m': m, onclick: () => { mode = m; draw(); } }, l)));
  const kp = h('div', { class: 'kpis' });
  const load = guard(async () => {
    const d = await api('/report?month=' + S.month); rows = d.rows; totals = d.totals;
    kp.replaceChildren(kpi('الموظفون', String(totals.employees), 'موظف', { hint: totals.without_salary ? `${totals.without_salary} بلا راتب مسجّل` : '', tone: totals.without_salary ? 'warn' : '' }), kpi('إجمالي الرواتب', sar(totals.salaries), 'ر.س'),
      kpi('الإضافي', sar(totals.overtime_amount), 'ر.س', { hint: `${qty(totals.overtime_hours)} ساعة` }), kpi('الانتدابات', sar(totals.assignment_amount), 'ر.س', { hint: `${qty(totals.assignment_days)} يوم` }), kpi('الإجمالي المستحق', sar(totals.total), 'ر.س', { tone: 'ok' }));
    expanded.clear(); expanded.add('/الإجمالي'); draw();
  });
  view.replaceChildren(h('div', { class: 'bar' }, monthBar(load), seg, h('div', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: () => download('/api/payroll/export?month=' + S.month) }, 'تصدير Excel'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'طباعة')), kp, body);
  await load();
}

// ---------- الإعدادات ----------
async function settingsView() {
  const st = JSON.parse(JSON.stringify(S.settings));
  const basis = h('select', null, [['gross', 'الراتب الإجمالي'], ['basic', 'الراتب الأساسي فقط']].map(([v, l]) => h('option', { value: v, selected: st.salary_basis === v }, l)));
  const num = (v, min, max) => h('input', { type: 'text', inputmode: 'decimal', value: String(v) });
  const auto = h('input', { type: 'checkbox', checked: !!st.allowances_auto }), hp = num(st.housing_percent), tp = num(st.transport_percent);
  const days = num(st.days_per_month), hours = num(st.hours_per_day), cap = num(st.overtime_monthly_cap_hours);
  const calcIn = h('input', { type: 'text', inputmode: 'decimal', value: '8000', style: 'max-width:160px' }), calcOut = h('div', { class: 'formula' });
  const typesBox = key => {
    const box = h('div', { class: 'types' });
    const draw = () => box.replaceChildren(...st[key].map((t, i) => h('div', { class: 'trow' }, h('input', { type: 'text', value: t.name, placeholder: 'اسم النوع', oninput: e => { t.name = e.target.value; } }),
      h('input', { type: 'text', inputmode: 'decimal', value: String(t.percent), 'aria-label': 'النسبة %', oninput: e => { t.percent = normNum(e.target.value); preview(); } }), h('button', { class: 'btn sm danger', type: 'button', onclick: () => { st[key].splice(i, 1); draw(); preview(); } }, '×'))),
    h('button', { class: 'btn sm', type: 'button', onclick: () => { st[key].push({ name: '', percent: 100 }); draw(); } }, '+ إضافة نوع'));
    draw(); return box;
  };
  const collect = () => ({ assignment_rates: st.assignment_rates.map(r => ({ title: r.title, living: normNum(r.living), assignment: normNum(r.assignment), transport: normNum(r.transport) })), salary_basis: basis.value, allowances_auto: auto.checked, housing_percent: +normNum(hp.value) || 0, transport_percent: +normNum(tp.value) || 0, days_per_month: +normNum(days.value), hours_per_day: +normNum(hours.value), overtime_monthly_cap_hours: +normNum(cap.value) || 0,
    overtime_types: st.overtime_types.map(t => ({ ...t, percent: +normNum(t.percent) })), assignment_types: st.assignment_types.map(t => ({ ...t, percent: +normNum(t.percent) })) });
  function preview() {
    const c = collect(), s = +normNum(calcIn.value) || 0;
    if (!(c.days_per_month > 0 && c.hours_per_day > 0)) { calcOut.textContent = '—'; return; }
    const gs = c.allowances_auto ? s * (1 + (c.housing_percent + c.transport_percent) / 100) : s;
    const base = c.salary_basis === 'basic' ? s : gs, day = base / c.days_per_month, hr = day / c.hours_per_day;
    calcOut.replaceChildren(c.allowances_auto ? h('div', null, `أساسي ${sar(s)}: سكن ${sar(s * c.housing_percent / 100)} + نقل ${sar(s * c.transport_percent / 100)} = إجمالي ${sar(gs)} ر.س`) : null, h('div', null, `على أساس ${sar(base)} ر.س: الأجر اليومي ${sar(day)} · الأجر الساعي ${sar(hr)}`),
      ...c.overtime_types.map(t => h('div', null, `• ${t.name || '—'}: ساعة إضافي واحدة = ${sar(hr * t.percent / 100)} ر.س`)), ...c.assignment_types.map(t => h('div', null, `• ${t.name || '—'}: يوم انتداب واحد = ${sar(day * t.percent / 100)} ر.س`)));
  }
  for (const el of [days, hours, cap, calcIn, basis, auto, hp, tp]) el.addEventListener('input', preview);
  const otBox = typesBox('overtime_types'), asBox = typesBox('assignment_types');
  st.assignment_rates = st.assignment_rates || [];
  const dl = h('datalist', { id: 'jt-list' }, S.jobTitles.map(t => h('option', { value: t })));
  const ratesBox = h('div', { class: 'types' });
  const drawRates = () => ratesBox.replaceChildren(dl,
    st.assignment_rates.length ? h('div', { class: 'trow hd' }, h('b', null, 'المسمى الوظيفي'), h('b', null, 'أجر المعيشة / يوم'), h('b', null, 'أجر الانتداب / يوم'), h('b', null, 'أجر النقل (ثابت)'), h('span')) : null,
    ...st.assignment_rates.map((r, i) => h('div', { class: 'trow rate' },
      h('input', { type: 'text', list: 'jt-list', value: r.title, placeholder: 'المسمى الوظيفي', oninput: e => { r.title = e.target.value; } }),
      ...['living', 'assignment', 'transport'].map(k => h('input', { type: 'text', inputmode: 'decimal', value: String(r[k] ?? ''), placeholder: '0', 'aria-label': k, oninput: e => { r[k] = e.target.value; } })),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => { st.assignment_rates.splice(i, 1); drawRates(); } }, '×'))),
    h('div', { class: 'bar' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { st.assignment_rates.push({ title: '', living: '', assignment: '', transport: '' }); drawRates(); } }, '+ إضافة مسمى'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { const have = new Set(st.assignment_rates.map(r => r.title.trim())); for (const t of S.jobTitles) if (!have.has(t)) st.assignment_rates.push({ title: t, living: '', assignment: '', transport: '' }); drawRates(); } }, 'إضافة كل المسميات الموجودة')));
  drawRates();
  const save = guard(async () => { const out = await api('/settings', { method: 'PUT', body: collect() }); S.settings = out.settings; toast('تم حفظ الإعدادات'); });
  view.replaceChildren(h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'أساس الاحتساب'),
    h('div', { class: 'form-2' }, h('div', null, h('label', { class: 'f' }, 'تُحسب النسب على'), basis), h('div', null, h('label', { class: 'f' }, 'أيام الشهر'), days), h('div', null, h('label', { class: 'f' }, 'ساعات العمل اليومية'), hours),
      h('div', null, h('label', { class: 'f' }, 'تنبيه عند تجاوز ساعات الإضافي الشهرية (0 = بلا تنبيه)'), cap)),
    h('div', { class: 'formula' }, 'الأجر اليومي = أساس الراتب ÷ أيام الشهر · الأجر الساعي = الأجر اليومي ÷ ساعات اليوم')),
  h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'بدل السكن وبدل النقل'),
    h('label', null, auto, ' احسبهما تلقائياً من الراتب الأساسي بالنسبة أدناه'),
    h('div', { class: 'form-2' }, h('div', null, h('label', { class: 'f' }, 'بدل السكن (% من الأساسي)'), hp), h('div', null, h('label', { class: 'f' }, 'بدل النقل (% من الأساسي)'), tp)),
    h('p', { class: 'hint' }, 'عند التفعيل لا تُدخل البدلين يدوياً: يُحسبان من الأساسي لكل موظف، ويظهران في الرواتب والتقارير. غير المفعّل يعيد الإدخال اليدوي.')),
  h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'نسب الإضافي (من الأجر الساعي)'), h('p', { class: 'hint' }, 'مبلغ الإضافي = الساعات × الأجر الساعي × النسبة ÷ 100. مثال: 150 تعني ساعة ونصف الأجر الساعي.'), otBox),
  h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'نسب الانتداب (من الأجر اليومي)'), h('p', { class: 'hint' }, 'مبلغ الانتداب = الأيام × الأجر اليومي × النسبة ÷ 100.'), asBox),
  h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'أجور الانتداب حسب المسمى الوظيفي'),
    h('p', { class: 'hint' }, 'لكل مسمى وظيفي: أجر المعيشة اليومي وأجر الانتداب اليومي، وأجر النقل مبلغ ثابت يُضاف مرة واحدة لكل انتداب ولا يتغير بعدد الأيام. مبلغ الانتداب = الأيام × (المعيشة + الانتداب) + أجر النقل. الموظف الذي مسماه مسجّل هنا يُحسب انتدابه بهذه الأجور، وغيره يُحسب بنسب الانتداب أعلاه من الأجر اليومي.'), ratesBox),
  h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'حاسبة تجريبية'), h('label', { class: 'f' }, 'راتب أساسي تجريبي (ر.س)'), calcIn, calcOut),
  S.can.settings ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'حفظ الإعدادات'), h('span', { class: 'hint' }, 'التغيير يسري على البنود الجديدة؛ البنود المسجّلة سابقاً تحتفظ بنسبتها وراتبها وقت الإدخال حتى تُعدَّل.')) : h('p', { class: 'hint' }, 'لا تملك صلاحية تعديل الإعدادات.'));
  preview();
}

// ---------- التشغيل ----------
const TABS = () => [['salaries', 'الرواتب', S.can.view], ['overtime', 'الإضافي', S.can.view || S.can.entries], ['assignment', 'الانتدابات', S.can.view || S.can.entries], ['report', 'التقارير', S.can.view], ['settings', 'الإعدادات', S.can.settings || S.can.view]].filter(t => t[2]);
async function show(tab) {
  S.tab = tab; history.replaceState(null, '', '#' + tab);
  document.getElementById('tabs').replaceChildren(...TABS().map(([k, l]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), type: 'button', onclick: () => show(k) }, l)));
  view.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
  try { await ({ salaries: salariesView, overtime: () => entriesView('overtime'), assignment: () => entriesView('assignment'), report: reportView, settings: settingsView }[tab])(); } catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
}
try {
  const m = await api('/meta');
  Object.assign(S, { jobTitles: m.job_titles || [], settings: m.settings, units: m.units, can: m.can, month: m.month });
  const want = location.hash.slice(1);
  if (!TABS().length) view.replaceChildren(h('div', { class: 'card' }, 'لا تملك صلاحية عرض الرواتب. تواصل مع مدير النظام.'));
  else await show(TABS().some(t => t[0] === want) ? want : TABS()[0][0]);
} catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
