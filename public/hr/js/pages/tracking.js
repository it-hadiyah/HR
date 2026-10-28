// متابعة أرصدة الإجازات: جدول يعبّئه المسؤول لكل موظف، وتُحسب منه التكلفة المالية والمؤشرات تلقائياً.
import { h, api, qs, state, fmt, num, select, toast, guard, confirmBox, EMP_STATUS, download } from '../core.js';
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
  const yearSel = select([thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(y => [y, y]), thisYear, { 'aria-label': 'السنة' });
  const statusSel = select([['active', 'نشط'], ['suspended', 'معطّل'], ['all', 'الكل']], 'active', { 'aria-label': 'الحالة' });
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
      kpi('إجمالي الرصيد الكلي', fmt.days(s.total_balance), 'يوم', { hint: `الرصيد السنوي: ${fmt.days(s.annual_balance)} يوم` }),
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
    c.progress.replaceChildren(e.progress_pct === null ? '—' : h('div', { class: 'pbar', title: fmt.pct(e.progress_pct) }, h('i', { style: { width: e.progress_pct + '%' } })));
    c.status.replaceChildren(statusBadge(e));
    if (data.fin) { c.rate.replaceChildren(num(fmtMoney(e.day_rate))); c.cost.replaceChildren(num(fmtMoney(e.cost_now))); c.cTarget.replaceChildren(num(fmtMoney(e.cost_target))); c.cRemT.replaceChildren(num(fmtMoney(e.cost_remaining_target))); c.cRemTot.replaceChildren(num(fmtMoney(e.cost_remaining_total))); c.after.replaceChildren(num(fmtMoney(e.cost_after_target))); c.saving.replaceChildren(num(fmtMoney(e.saving))); }
  }
  function recomputeSummary() {
    const rows = data.rows, s = data.summary, fin = data.fin, sum = k => Math.round(rows.reduce((a, x) => a + (x[k] ?? 0), 0) * 100) / 100;
    Object.assign(s, { employees: rows.length, complete: rows.filter(x => x.complete).length, incomplete: rows.filter(x => !x.complete).length, annual_balance: sum('annual_balance'), total_balance: sum('total_balance'),
      target_days: sum('target_days'), used_days: sum('used_days'), remaining_to_target: sum('remaining_to_target'), remaining_total: sum('remaining_total'), high_balance: rows.filter(x => x.high_balance).length, target_met: rows.filter(x => x.target_met).length });
    if (fin) Object.assign(s, { cost_now: sum('cost_now'), cost_target: sum('cost_target'), cost_remaining_target: sum('cost_remaining_target'), cost_remaining_total: sum('cost_remaining_total'), cost_after_target: sum('cost_after_target'), saving: sum('saving') });
  }

  function drawTable() {
    const fin = data.fin;
    const head = ['#', 'الموظف', 'الرقم الوظيفي', 'تاريخ التعيين', ...(fin ? ['الراتب الإجمالي'] : []), 'الرصيد السنوي', 'الرصيد الكلي', 'المستهدف', 'المستخدم', 'المتبقي للمستهدف', 'المتبقي من الكلي', 'التقدم',
      ...(fin ? ['أجر اليوم', 'تكلفة الإجازة الكلية', 'تكلفة المستهدف لنهاية السنة', 'تكلفة المتبقي من المستهدف', 'تكلفة المتبقي من الكلي', 'التكلفة بعد تحقق المستهدف', 'التوفير المتوقع'] : []), 'ملاحظات', 'الحالة', ''];
    const tbody = h('tbody');
    data.rows.forEach((e, i) => {
      const c = calc[e.employee_id] = { save: h('span', { class: 'save-state' }), remaining: h('td', { class: 'n' }), remTotal: h('td', { class: 'n' }), progress: h('td'), status: h('td'), rate: h('td', { class: 'n' }), cost: h('td', { class: 'n strong' }), cTarget: h('td', { class: 'n' }), cRemT: h('td', { class: 'n' }), cRemTot: h('td', { class: 'n' }), after: h('td', { class: 'n' }), saving: h('td', { class: 'n' }) };
      const notes = data.can_edit ? inputFor(e, 'notes', { type: 'text', width: '150px', dir: 'rtl' }) : h('span', null, e.notes || '—');
      const tr = h('tr', null,
        h('td', { class: 'n' }, String(i + 1)),
        h('td', { class: 'who' }, h('a', { href: '#/employee/' + e.employee_id, title: 'فتح الملف التفصيلي' }, e.full_name), h('div', { class: 'sub' }, [e.job_title, unitPath(e), e.service_years !== null ? `خدمة ${fmt.days(e.service_years)} سنة` : ''].filter(Boolean).join(' · '))),
        h('td', null, inputFor(e, 'emp_no', { type: 'text', width: '92px' })),
        h('td', null, inputFor(e, 'hire_date', { type: 'date', width: '138px' })),
        fin ? h('td', null, inputFor(e, 'gross_salary', { step: '0.01', width: '104px' })) : null,
        h('td', null, inputFor(e, 'annual_balance')), h('td', null, inputFor(e, 'total_balance', { min: null })), h('td', null, inputFor(e, 'target_days')), h('td', null, inputFor(e, 'used_days')),
        c.remaining, c.remTotal, c.progress,
        ...(fin ? [c.rate, c.cost, c.cTarget, c.cRemT, c.cRemTot, c.after, c.saving] : []),
        h('td', null, notes), c.status,
        h('td', { style: { whiteSpace: 'nowrap' } }, c.save, ' ', data.can_edit ? h('button', { class: 'btn sm ' + (e.status === 'active' ? 'danger' : 'primary'), title: e.status === 'active' ? 'تعطيل الموظف وإخفاؤه' : 'تنشيط الموظف',
          onclick: () => toggle(e) }, e.status === 'active' ? 'تعطيل' : 'تنشيط') : (e.status !== 'active' ? h('span', { class: 'badge' }, EMP_STATUS[e.status]) : '')));
      tbody.append(tr); refreshRow(tr, e);
    });
    const s = data.summary;
    const foot = h('tfoot', null, h('tr', null, h('td'), h('td', { class: 'strong' }, 'الإجمالي'), h('td'), h('td'), fin ? h('td') : null,
      h('td', { class: 'n strong' }, fmt.days(s.annual_balance)), h('td', { class: 'n strong' }, fmt.days(s.total_balance)), h('td', { class: 'n strong' }, fmt.days(s.target_days)), h('td', { class: 'n strong' }, fmt.days(s.used_days)),
      h('td', { class: 'n strong' }, fmt.days(s.remaining_to_target)), h('td', { class: 'n strong' }, fmt.days(s.remaining_total)), h('td'),
      ...(fin ? [h('td'), h('td', { class: 'n strong' }, fmtMoney(s.cost_now)), h('td', { class: 'n strong' }, fmtMoney(s.cost_target)), h('td', { class: 'n strong' }, fmtMoney(s.cost_remaining_target)), h('td', { class: 'n strong' }, fmtMoney(s.cost_remaining_total)), h('td', { class: 'n strong' }, fmtMoney(s.cost_after_target)), h('td', { class: 'n strong' }, fmtMoney(s.saving))] : []), h('td'), h('td'), h('td')));
    tableBox.replaceChildren(h('div', { class: 'tbl-wrap track-wrap' }, h('table', { class: 'track' }, h('thead', null, h('tr', null, head.map(t => h('th', null, t)))), tbody, data.rows.length ? foot : null)),
      data.rows.length ? null : h('div', { class: 'card', style: { textAlign: 'center', color: 'var(--muted)' } }, 'لا يوجد موظفون مطابقون.'));
  }

  function toggle(e) {
    const off = e.status === 'active';
    const run = async () => { await api('/employees/' + e.employee_id, { method: 'PUT', body: { status: off ? 'suspended' : 'active' } }); toast(off ? 'تم التعطيل' : 'تم التنشيط'); await load(); };
    if (off) confirmBox(`تعطيل ${e.full_name}؟ سيُخفى من هذه القائمة ومن دليل البوابة ويمكن إعادته بتنشيطه.`, run); else guard(run)();
  }

  function draw() { drawSummary(); drawTable(); }

  const canEdit = state.user.perms.includes('employees');
  const copyBtn = canEdit ? h('button', { class: 'btn', title: 'ينسخ الراتب الإجمالي والرصيد السنوي من السنة السابقة لمن ليس لهم صف في السنة المختارة', onclick: () => confirmBox(`نسخ بيانات ${f.year - 1} (الراتب والرصيد السنوي) إلى ${f.year} لمن ليس لهم بيانات؟`, async () => {
    const r = await api('/tracking/copy-year', { method: 'POST', body: { from: f.year - 1, to: f.year } }); toast(`تم نسخ ${r.copied} سجل`); await load();
  }, false) }, 'نسخ من السنة السابقة') : null;

  for (const el of [yearSel, unitSel, statusSel, incomplete]) el.addEventListener('change', guard(load));
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(guard(load), 300); });

  root.append(
    h('div', { class: 'card filters' }, h('div', { class: 'row center' },
      h('label', { class: 'f' }, 'السنة', yearSel), h('label', { class: 'f' }, 'الوحدة', unitSel), h('label', { class: 'f' }, 'الحالة', statusSel), search,
      h('label', { class: 'row center', style: { gap: '6px' } }, incomplete, 'الناقص فقط'), h('div', { class: 'spacer' }),
      copyBtn, canEdit ? h('a', { class: 'btn', href: '#/import' }, 'استيراد من Excel') : null,
      h('button', { class: 'btn', onclick: () => download('/tracking/export' + qs({ year: f.year, unit: f.unit, status: f.status, search: f.search, incomplete: f.incomplete ? 1 : '' })) }, 'تصدير Excel'))),
    summaryBox,
    h('p', { style: { color: 'var(--muted)', fontSize: '12.5px', margin: '0 0 8px' } },
      'عبّئ الحقول مباشرة في الجدول وتُحفظ تلقائياً عند الانتقال من الخانة. أجر اليوم = الراتب الإجمالي ÷ قاسم اليوم في السياسة. تكلفة الإجازة الكلية = الرصيد الكلي × أجر اليوم. تكلفة المستهدف = المستهدف × أجر اليوم. المتبقي للمستهدف = المستهدف − المستخدم وتكلفته × أجر اليوم. المتبقي من الكلي = الرصيد الكلي − المستخدم وتكلفته × أجر اليوم.'),
    tableBox);
  await load();
  return root;
}
