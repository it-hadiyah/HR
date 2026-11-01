// متابعة أرصدة الإجازات: جدول يعبّئه المسؤول لكل موظف، وتُحسب منه التكلفة المالية والمؤشرات تلقائياً.
import { h, api, qs, state, fmt, num, select, toast, guard, confirmBox, EMP_STATUS, download, modal, field } from '../core.js';
import { getUnits } from '../filters.js';

const UNIT_LABEL = { sector: 'قطاع', department: 'إدارة', section: 'قسم' };
const unitPath = e => [e.sector, e.department, e.section].filter(Boolean).join(' ‹ ') || '—';

function kpi(label, value, unit, { hint, tone } = {}) {
  return h('div', { class: 'card kpi ' + (tone || '') }, h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value, unit ? h('span', { class: 'unit' }, unit) : null), hint ? h('div', { class: 'hint' }, hint) : null);
}

export default async function tracking() {
  const root = h('div');
  const thisYear = new Date().getFullYear();
  const f = { year: thisYear, unit: '', search: '', status: 'active', incomplete: false };
  const units = await getUnits();
  const unitSel = select([['', 'كل الوحدات'], ...units.filter(u => u.unit_type !== 'org').map(u => [u.id, `${UNIT_LABEL[u.unit_type] || ''}: ${u.name}`])], '', { 'aria-label': 'الوحدة' });
  const yearsInfo = await api('/tracking/years');
  const yearList = () => yearsInfo.years.map(y => y.year);
  const mkYearSel = cur => select(yearList().map(y => { const i = yearsInfo.years.find(x => x.year === y); return [y, i && i.employees ? `${y}  (${i.employees} موظف)` : `${y}  (فارغة)`]; }), cur, { 'aria-label': 'السنة' });
  let yearSel = mkYearSel(thisYear);
  const statusSel = select([['active', 'نشط'], ['archived', 'مؤرشف'], ['all', 'الكل']], 'active', { 'aria-label': 'الحالة' });
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم الوظيفي أو المسمى', style: { minWidth: '260px' }, 'aria-label': 'بحث' });
  const incomplete = h('input', { type: 'checkbox' });
  const summaryBox = h('div'), tableBox = h('div');
  let data = null;

  const fmtMoney = v => (v === null || v === undefined ? '—' : fmt.sar(v));

  async function load() {
    Object.assign(f, { year: +yearSel.value, unit: unitSel.value, status: statusSel.value, search: search.value.trim(), incomplete: incomplete.checked });
    data = await api('/tracking' + qs({ year: f.year, unit: f.unit, status: f.status, search: f.search, incomplete: f.incomplete ? 1 : '' }));
    draw();
  }

  function drawSummary() {
    const s = data.summary, fin = data.fin;
    summaryBox.replaceChildren(h('div', { class: 'grid kpis', style: { marginBottom: '14px' } },
      kpi('الموظفون', fmt.int(s.employees), 'موظف', { hint: `${fmt.int(s.complete)} مكتملة البيانات · ${fmt.int(s.incomplete)} ناقصة`, tone: s.incomplete ? 'warn' : 'ok' }),
      kpi('إجمالي الأرصدة الموجبة', fmt.days(s.total_balance), 'يوم', { hint: `الرصيد السنوي: ${fmt.days(s.annual_balance)} يوم` }),
      kpi('مستحق على الموظفين (رصيد سالب)', fmt.days(s.owed_days), 'يوم', { tone: s.owed_count ? 'bad' : '', hint: `${fmt.int(s.owed_count)} موظف${fin ? ' · ' + fmtMoney(s.owed_cost) + ' ر.س' : ''}` }),
      kpi('المستهدف لهذه السنة', fmt.days(s.target_days), 'يوم', { hint: `المستخدم: ${fmt.days(s.used_days)} · المتبقي للمستهدف: ${fmt.days(s.remaining_to_target)}` }),
      kpi('حققوا المستهدف', fmt.int(s.target_met), 'موظف', { tone: 'ok' }),
      kpi('أرصدة مرتفعة', fmt.int(s.high_balance), 'موظف', { tone: s.high_balance ? 'bad' : '', hint: `أكثر من ${fmt.days(data.max_balance_cap ?? 30)} يوماً` }),
      ...(fin ? [
        kpi('تكلفة الإجازة الكلية', fmtMoney(s.cost_now), 'ر.س', { hint: 'الرصيد الكلي × أجر اليوم', tone: 'bad' }),
        kpi('تكلفة المستهدف لنهاية السنة', fmtMoney(s.cost_target), 'ر.س', { hint: 'المستهدف × أجر اليوم' }),
        kpi('تكلفة المتبقي من المستهدف', fmtMoney(s.cost_remaining_target), 'ر.س', { hint: '(المستهدف − المستخدم) × أجر اليوم', tone: 'warn' }),
        kpi('تكلفة المتبقي من الكلي', fmtMoney(s.cost_remaining_total), 'ر.س', { hint: '(الرصيد الكلي − المستخدم) × أجر اليوم' }),
        kpi('التكلفة بعد تحقق المستهدف', fmtMoney(s.cost_after_target), 'ر.س'),
        kpi('التوفير المتوقع', fmtMoney(s.saving), 'ر.س', { tone: 'ok' })] : [])));
  }

  function inputFor(e, key, { type = 'number', step = '0.5', width = '86px', min = '0', dir = 'ltr' } = {}) {
    const editable = data.can_edit && (key !== 'gross_salary' || data.fin);
    const v = e[key] ?? '';
    if (!editable) return h('span', { class: 'num' }, v === '' ? '—' : (type === 'date' ? fmt.date(v) : String(v)));
    // الأرقام حقول نصية بلوحة أرقام: تقبل الأرقام العربية والهندية (type=number يفرغها فلا يُحفظ شيء)
    const el = h('input', { type: type === 'number' ? 'text' : type, inputmode: type === 'number' ? 'decimal' : undefined, autocomplete: 'off', value: v, class: 'cell-in', style: { width }, dir, 'aria-label': key });
    const save = async () => {
      const c = calc[e.employee_id]; const tr = el.closest('tr');
      let val = el.value;
      if (type === 'number') val = val.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[,٬،\s]/g, '');
      if (String(val) === String(e[key] ?? '')) return;             // لا تغيير
      el.classList.remove('bad'); setState(c, 'saving');
      try {
        const out = await api('/tracking/' + e.employee_id, { method: 'PUT', body: { year: f.year, [key]: val } });
        Object.assign(e, out.row);
        if (type === 'number') el.value = e[key] ?? '';
        setState(c, 'saved'); refreshRow(tr, e); recomputeSummary(); drawSummary();
      } catch (err) { el.classList.add('bad'); setState(c, 'error', err.message); toast(err.message, true); }
    };
    el.addEventListener('change', save);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
    return el;
  }

  const calc = {};   // خلايا المشتقات لكل صف لتُحدَّث دون إعادة رسم الجدول
  function setState(c, kind, msg) {
    if (!c) return; clearTimeout(c.timer);
    const L = { saving: ['… جارٍ الحفظ', 'muted'], saved: ['✓ تم الحفظ', 'ok'], error: ['⚠ لم يُحفظ', 'bad'] }[kind];
    c.save.className = 'save-state ' + L[1]; c.save.textContent = L[0]; c.save.title = msg || '';
    if (kind === 'saved') c.timer = setTimeout(() => { c.save.textContent = ''; }, 2500);
  }
  function statusBadge(e) {
    if (!e.complete) return h('span', { class: 'badge warn', title: 'ناقص: ' + e.missing.join('، ') }, `ناقص (${e.missing.length})`);
    if (e.target_met) return h('span', { class: 'badge ok' }, 'حقق المستهدف');
    if (e.high_balance) return h('span', { class: 'badge bad' }, 'رصيد مرتفع');
    return h('span', { class: 'badge info' }, 'قيد المتابعة');
  }
  function refreshRow(tr, e) {
    const c = calc[e.employee_id]; if (!c) return;
    c.remaining.replaceChildren(num(fmt.days(e.remaining_to_target)));
    c.remTotal.replaceChildren(num(fmt.days(e.remaining_total)));
    c.owed.replaceChildren(e.owed_days > 0 ? h('b', { class: 'owed' }, fmt.days(e.owed_days)) : '—');
    if (data.fin) c.owedCost.replaceChildren(e.owed_days > 0 ? h('b', { class: 'owed' }, fmtMoney(e.owed_cost)) : '—');
    c.progress.replaceChildren(e.progress_pct === null ? '—' : h('div', { class: 'pbar', title: fmt.pct(e.progress_pct) }, h('i', { style: { width: e.progress_pct + '%' } })));
    c.status.replaceChildren(statusBadge(e));
    if (data.fin) { c.rate.replaceChildren(num(fmtMoney(e.day_rate))); c.cost.replaceChildren(num(fmtMoney(e.cost_now))); c.cTarget.replaceChildren(num(fmtMoney(e.cost_target))); c.cRemT.replaceChildren(num(fmtMoney(e.cost_remaining_target))); c.cRemTot.replaceChildren(num(fmtMoney(e.cost_remaining_total))); c.after.replaceChildren(num(fmtMoney(e.cost_after_target))); c.saving.replaceChildren(num(fmtMoney(e.saving))); }
  }
  function recomputeSummary() {
    const rows = data.rows, s = data.summary, fin = data.fin, sum = k => Math.round(rows.reduce((a, x) => a + (x[k] ?? 0), 0) * 100) / 100;
    Object.assign(s, { employees: rows.length, complete: rows.filter(x => x.complete).length, incomplete: rows.filter(x => !x.complete).length, annual_balance: sum('annual_balance'), total_balance: Math.round(rows.reduce((a, x) => a + Math.max(0, x.total_balance ?? 0), 0) * 100) / 100,
      target_days: Math.round(rows.reduce((a, x) => a + Math.max(0, x.target_days ?? 0), 0) * 100) / 100, owed_days: sum('owed_days'), owed_count: rows.filter(x => x.owed_days > 0).length, used_days: sum('used_days'), remaining_to_target: sum('remaining_to_target'), remaining_total: sum('remaining_total'), high_balance: rows.filter(x => x.high_balance).length, target_met: rows.filter(x => x.target_met).length });
    if (fin) Object.assign(s, { owed_cost: sum('owed_cost'), cost_now: sum('cost_now'), cost_target: sum('cost_target'), cost_remaining_target: sum('cost_remaining_target'), cost_remaining_total: sum('cost_remaining_total'), cost_after_target: sum('cost_after_target'), saving: sum('saving') });
  }

  function drawTable() {
    const fin = data.fin;
    const selAll = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل', title: 'تحديد كل المعروضين', onchange: ev => { sel.clear(); if (ev.target.checked) data.rows.forEach(r => sel.add(r.employee_id)); tbody.querySelectorAll('input.rowsel').forEach(c => { c.checked = ev.target.checked; }); updateBulk(); } });
    const head = [data.can_edit ? selAll : '#', 'الموظف', 'الرقم الوظيفي', 'تاريخ التعيين', ...(fin ? ['الراتب الإجمالي'] : []), 'الرصيد السنوي', 'الرصيد الكلي', 'المستهدف', 'المستخدم', 'المتبقي للمستهدف', 'المتبقي من الكلي', 'مستحق على الموظف (يوم)', 'التقدم',
      ...(fin ? ['أجر اليوم', 'مبلغ مستحق على الموظف', 'تكلفة الإجازة الكلية', 'تكلفة المستهدف لنهاية السنة', 'تكلفة المتبقي من المستهدف', 'تكلفة المتبقي من الكلي', 'التكلفة بعد تحقق المستهدف', 'التوفير المتوقع'] : []), 'ملاحظات', 'الحالة', ''];
    const tbody = h('tbody');
    sel.clear(); updateBulk();
    data.rows.forEach((e, i) => {
      const c = calc[e.employee_id] = { save: h('span', { class: 'save-state' }), remaining: h('td', { class: 'n' }), remTotal: h('td', { class: 'n' }), owed: h('td', { class: 'n' }), owedCost: h('td', { class: 'n' }), progress: h('td'), status: h('td'), rate: h('td', { class: 'n' }), cost: h('td', { class: 'n strong' }), cTarget: h('td', { class: 'n' }), cRemT: h('td', { class: 'n' }), cRemTot: h('td', { class: 'n' }), after: h('td', { class: 'n' }), saving: h('td', { class: 'n' }) };
      const notes = data.can_edit ? inputFor(e, 'notes', { type: 'text', width: '150px', dir: 'rtl' }) : h('span', null, e.notes || '—');
      const tr = h('tr', null,
        h('td', { class: 'n' }, data.can_edit ? h('input', { type: 'checkbox', class: 'rowsel', 'aria-label': 'تحديد', onchange: ev => { ev.target.checked ? sel.add(e.employee_id) : sel.delete(e.employee_id); updateBulk(); } }) : null, ' ', String(i + 1)),
        h('td', { class: 'who' }, h('b', null, e.full_name), e.status === 'archived' ? h('span', { class: 'badge', style: { marginInlineStart: '6px' } }, 'مؤرشف') : null, h('div', { class: 'sub' }, [e.job_title, unitPath(e), e.service_years !== null ? `خدمة ${fmt.days(e.service_years)} سنة` : ''].filter(Boolean).join(' · '))),
        h('td', null, inputFor(e, 'emp_no', { type: 'text', width: '92px' })),
        h('td', null, inputFor(e, 'hire_date', { type: 'date', width: '138px' })),
        fin ? h('td', null, inputFor(e, 'gross_salary', { step: '0.01', width: '104px' })) : null,
        h('td', null, inputFor(e, 'annual_balance')), h('td', null, inputFor(e, 'total_balance', { min: null })), h('td', null, inputFor(e, 'target_days')), h('td', null, inputFor(e, 'used_days')),
        c.remaining, c.remTotal, c.owed, c.progress,
        ...(fin ? [c.rate, c.owedCost, c.cost, c.cTarget, c.cRemT, c.cRemTot, c.after, c.saving] : []),
        h('td', null, notes), c.status,
        h('td', { style: { whiteSpace: 'nowrap' } }, c.save, ' ', data.can_edit ? h('span', { class: 'row-acts' },
          h('button', { class: 'btn sm', title: 'تعديل بيانات الموظف', onclick: () => staffDialog(e) }, 'تعديل'),
          h('button', { class: 'btn sm', title: e.status === 'archived' ? 'إعادة الموظف إلى القائمة النشطة' : 'إخفاء الموظف مع حفظ بياناته', onclick: () => bulk([e.employee_id], e.status === 'archived' ? 'restore' : 'archive', e.full_name) }, e.status === 'archived' ? 'استعادة' : 'أرشفة'),
          h('button', { class: 'btn sm danger', title: 'حذف الموظف وكل بيانات متابعته نهائياً', onclick: () => bulk([e.employee_id], 'delete', e.full_name) }, 'حذف')) : null));
      tbody.append(tr); refreshRow(tr, e);
    });
    const s = data.summary;
    const foot = h('tfoot', null, h('tr', null, h('td'), h('td', { class: 'strong' }, 'الإجمالي'), h('td'), h('td'), fin ? h('td') : null,
      h('td', { class: 'n strong' }, fmt.days(s.annual_balance)), h('td', { class: 'n strong' }, fmt.days(s.total_balance)), h('td', { class: 'n strong' }, fmt.days(s.target_days)), h('td', { class: 'n strong' }, fmt.days(s.used_days)),
      h('td', { class: 'n strong' }, fmt.days(s.remaining_to_target)), h('td', { class: 'n strong' }, fmt.days(s.remaining_total)), h('td', { class: 'n strong' }, fmt.days(s.owed_days)), h('td'),
      ...(fin ? [h('td'), h('td', { class: 'n strong' }, fmtMoney(s.owed_cost)), h('td', { class: 'n strong' }, fmtMoney(s.cost_now)), h('td', { class: 'n strong' }, fmtMoney(s.cost_target)), h('td', { class: 'n strong' }, fmtMoney(s.cost_remaining_target)), h('td', { class: 'n strong' }, fmtMoney(s.cost_remaining_total)), h('td', { class: 'n strong' }, fmtMoney(s.cost_after_target)), h('td', { class: 'n strong' }, fmtMoney(s.saving))] : []), h('td'), h('td'), h('td')));
    tableBox.replaceChildren(h('div', { class: 'tbl-wrap track-wrap' }, h('table', { class: 'track' }, h('thead', null, h('tr', null, head.map(t => h('th', null, t)))), tbody, data.rows.length ? foot : null)),
      data.rows.length ? null : h('div', { class: 'card', style: { textAlign: 'center', color: 'var(--muted)' } }, 'لا يوجد موظفون مطابقون.'));
  }

  // ---- إدارة موظفي المتابعة: إضافة / تعديل / أرشفة / استعادة / حذف (جدول مستقل عن دليل البوابة) ----
  const sel = new Set();
  const bulkBox = h('div', { class: 'bulk-bar no-print', hidden: true });
  function updateBulk() {
    bulkBox.hidden = sel.size === 0; if (!sel.size) return;
    const ids = [...sel];
    bulkBox.replaceChildren(h('b', null, `${sel.size} محدد`), h('button', { class: 'btn sm', onclick: () => bulk(ids, 'archive') }, 'أرشفة المحدد'), h('button', { class: 'btn sm', onclick: () => bulk(ids, 'restore') }, 'استعادة المحدد'),
      h('button', { class: 'btn sm danger', onclick: () => bulk(ids, 'delete') }, 'حذف المحدد نهائياً'), h('button', { class: 'btn sm', onclick: () => { sel.clear(); tableBox.querySelectorAll('input[type=checkbox]').forEach(c => { c.checked = false; }); updateBulk(); } }, 'إلغاء التحديد'));
  }
  function bulk(ids, action, name) {
    const what = name ? `«${name}»` : `${ids.length} موظف`;
    const MSG = { archive: `أرشفة ${what}؟ يُخفون من القوائم والمؤشرات وتبقى بياناتهم ويمكن استعادتهم.`, restore: `استعادة ${what} إلى القائمة النشطة؟`,
      delete: `حذف ${what} نهائياً مع كل بيانات متابعتهم في كل السنوات؟ لا يمكن التراجع. (للإخفاء المؤقت استخدم الأرشفة)` };
    const run = async () => { const r = await api('/tracking/staff/bulk', { method: 'POST', body: { ids, action, year: f.year } }); toast({ archive: 'تمت الأرشفة', restore: 'تمت الاستعادة', delete: 'تم الحذف' }[action] + ` (${r.affected})`); Object.assign(yearsInfo, await api('/tracking/years')); await load(); };
    if (action === 'restore') guard(run)(); else confirmBox(MSG[action], run, action === 'delete');
  }
  function staffDialog(e) {
    const inp = (v, extra = {}) => h('input', { type: 'text', value: v ?? '', class: 'cell-in', style: { width: '100%', textAlign: 'start' }, autocomplete: 'off', ...extra });
    const name = inp(e?.full_name), no = inp(e?.emp_no, { dir: 'ltr' }), title = inp(e?.job_title);
    const hire = h('input', { type: 'date', value: e?.hire_date || '', class: 'cell-in', style: { width: '100%' } });
    const unit = select([['', 'بدون وحدة'], ...units.filter(u => u.unit_type !== 'org').map(u => [u.id, `${UNIT_LABEL[u.unit_type] || ''}: ${u.name}`])], e?.org_unit_id ?? '');
    modal(e ? `تعديل ${e.full_name}` : 'إضافة موظف إلى المتابعة', h('div', null,
      h('p', { style: { color: 'var(--muted)', fontSize: '12.5px', marginTop: 0 } }, 'موظفو المتابعة جدول مستقل عن دليل موظفي البوابة؛ ما تضيفه هنا لا يظهر في البوابة ولا يتأثر بتعديلاتها.'),
      h('div', { class: 'form-grid' }, field('الاسم *', name), field('الرقم الوظيفي', no), field('المسمى الوظيفي', title), field('الوحدة التنظيمية', unit), field('تاريخ التعيين', hire))),
    { saveText: e ? 'حفظ' : 'إضافة', onSave: async () => {
      const body = { year: f.year, full_name: name.value, job_title: title.value, org_unit_id: unit.value };
      if (no.value.trim()) body.emp_no = no.value.trim(); if (hire.value) body.hire_date = hire.value;
      if (e) await api('/tracking/' + e.employee_id, { method: 'PUT', body }); else await api('/tracking/staff', { method: 'POST', body });
      toast(e ? 'تم حفظ التعديل' : 'تمت الإضافة'); Object.assign(yearsInfo, await api('/tracking/years')); await load();
    } });
  }

  function draw() { drawSummary(); drawTable(); }

  const canEdit = state.user.perms.includes('employees');
  // إنشاء/تحديث مستهدف سنة لمجموعة موظفين (المعروضين حسب الفلاتر الحالية)
  const targetBtn = canEdit ? h('button', { class: 'btn primary', title: 'إنشاء مستهدف سنة جديدة أو تحديثه للموظفين المعروضين', onclick: () => {
    const yr = h('input', { type: 'number', min: 2000, max: 2100, value: f.year, class: 'cell-in', style: { width: '100%' } });
    const rule = select([['fixed', 'قيمة ثابتة لكل موظف (يوم)'], ['pct_total', 'نسبة من الرصيد الكلي %'], ['pct_annual', 'نسبة من الرصيد السنوي %'], ['copy_prev', 'نسخ مستهدف سنة سابقة']], 'fixed');
    const val = h('input', { type: 'text', inputmode: 'decimal', class: 'cell-in', style: { width: '100%' }, placeholder: 'مثال: 15' });
    const src = h('input', { type: 'number', min: 2000, max: 2100, value: f.year - 1, class: 'cell-in', style: { width: '100%' } });
    const empty = h('input', { type: 'checkbox', checked: true }), base = h('input', { type: 'checkbox', checked: true });
    const valF = field('القيمة', val), srcF = field('السنة المنسوخ منها', src);
    const sync = () => { valF.hidden = rule.value === 'copy_prev'; srcF.hidden = rule.value !== 'copy_prev' && !base.checked; };
    rule.addEventListener('change', sync); base.addEventListener('change', sync); sync();
    modal('إعداد مستهدف سنة', h('div', null,
      h('p', { style: { color: 'var(--muted)', fontSize: '12.5px', marginTop: 0 } }, `يُطبَّق على الموظفين المعروضين حالياً (${data.rows.length} موظف حسب الوحدة والحالة والبحث المحددة). تُنشأ للسنة صفوف جديدة عند الحاجة، ويمكن بعدها مقارنتها بالسنوات الأخرى.`),
      h('div', { class: 'form-grid' }, field('السنة', yr), field('طريقة التحديد', rule), valF, srcF),
      h('label', { class: 'row center', style: { gap: '6px', margin: '8px 0 0' } }, empty, 'تحديث من ليس له مستهدف فقط (لا يستبدل المُدخَل)'),
      h('label', { class: 'row center', style: { gap: '6px', margin: '4px 0 0' } }, base, 'نسخ الراتب والرصيد السنوي من سنة المصدر لمن ليس لهم بيانات في هذه السنة')), { saveText: 'تطبيق', onSave: async () => {
      const body = { year: +yr.value, mode: rule.value, value: val.value.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.'), source_year: +src.value, only_empty: empty.checked, copy_base: base.checked,
        unit: f.unit, status: f.status, f: { q: f.search, segments: f.incomplete ? ['incomplete'] : [] } };
      const r = await api('/tracking/year-target', { method: 'POST', body });
      toast(`تم تحديث مستهدف ${r.year} لـ ${r.updated} موظف${r.skipped ? ` (تخطّي ${r.skipped})` : ''}`);
      Object.assign(yearsInfo, await api('/tracking/years'));
      const nv = mkYearSel(r.year); yearSel.replaceWith(nv); yearSel = nv; nv.addEventListener('change', guard(load)); await load();
    } });
  } }, 'إعداد مستهدف سنة') : null;
  const copyBtn = canEdit ? h('button', { class: 'btn', title: 'ينسخ الراتب الإجمالي والرصيد السنوي من السنة السابقة لمن ليس لهم صف في السنة المختارة', onclick: () => confirmBox(`نسخ بيانات ${f.year - 1} (الراتب والرصيد السنوي) إلى ${f.year} لمن ليس لهم بيانات؟`, async () => {
    const r = await api('/tracking/copy-year', { method: 'POST', body: { from: f.year - 1, to: f.year } }); toast(`تم نسخ ${r.copied} سجل`); await load();
  }, false) }, 'نسخ من السنة السابقة') : null;

  for (const el of [yearSel, unitSel, statusSel, incomplete]) el.addEventListener('change', guard(load));
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(guard(load), 300); });

  root.append(
    h('div', { class: 'card filters' }, h('div', { class: 'row center' },
      h('label', { class: 'f' }, 'السنة', yearSel), h('label', { class: 'f' }, 'الوحدة', unitSel), h('label', { class: 'f' }, 'الحالة', statusSel), search,
      h('label', { class: 'row center', style: { gap: '6px' } }, incomplete, 'الناقص فقط'), h('div', { class: 'spacer' }),
      canEdit ? h('button', { class: 'btn primary', onclick: () => staffDialog() }, '+ إضافة موظف') : null, targetBtn, copyBtn, canEdit ? h('a', { class: 'btn', href: '#/import' }, 'استيراد من Excel') : null,
      h('button', { class: 'btn', onclick: () => download('/tracking/export' + qs({ year: f.year, unit: f.unit, status: f.status, search: f.search, incomplete: f.incomplete ? 1 : '' })) }, 'تصدير Excel'))),
    summaryBox,
    h('p', { style: { color: 'var(--muted)', fontSize: '12.5px', margin: '0 0 8px' } },
      'عبّئ الحقول مباشرة في الجدول وتُحفظ تلقائياً عند الانتقال من الخانة. الرصيد الكلي السالب = مستحق على الموظف (لا يُحسب التزاماً على الجهة ولا يدخل في إجمالي الأرصدة). أجر اليوم = الراتب الإجمالي ÷ قاسم اليوم في السياسة. تكلفة الإجازة الكلية = الرصيد الكلي × أجر اليوم. تكلفة المستهدف = المستهدف × أجر اليوم. المتبقي للمستهدف = المستهدف − المستخدم وتكلفته × أجر اليوم. المتبقي من الكلي = الرصيد الكلي − المستخدم وتكلفته × أجر اليوم.'),
    bulkBox, tableBox);
  await load();
  return root;
}
