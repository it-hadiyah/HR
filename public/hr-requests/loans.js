// طلبات السلف (واجهة): رفع الطلب مع الكفيل، تتبّع الحالة (للموظف)، اعتماد الكفيل بإدخال بياناته، ومراجعة الموارد البشرية بكل البيانات.
// الموظف والكفيل لا يريان إلا الحالة؛ بيانات الكفيل والنموذج للموارد البشرية فقط (يفرض ذلك الخادم).
export const OUTCOME = {
  pending_guarantor: 'بانتظار اعتماد الكفيل', pending_hr: 'اعتمده الكفيل — بانتظار الموارد البشرية', approved: 'اعتُمد من الكفيل ومن الموارد البشرية',
  rejected_by_guarantor: 'رُفض من الكفيل', rejected_by_hr: 'رُفض من الموارد البشرية', cancelled: 'مُلغى',
};
const TONE = { pending_guarantor: 'pending', pending_hr: 'pending', approved: 'approved', rejected_by_guarantor: 'rejected', rejected_by_hr: 'rejected', cancelled: 'cancelled' };

export function createLoans(ctx) {
  const { h, api, toast, guard, modal, closeModal, confirmBox, fmt, view, S } = ctx;
  const sar = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const badge = o => h('span', { class: 'st ' + TONE[o] }, OUTCOME[o] || o);
  const fieldBox = (label, el, req) => h('div', null, h('label', { class: 'f' + (req ? ' req' : '') }, label), el);
  const norm = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  // ---- خطوات الحالة (للموظف): الكفيل ثم الموارد البشرية ----
  const STEP = { pending: ['…', 'بانتظار الرد'], waiting: ['○', 'لم تصل بعد'], approved: ['✔', 'اعتمد'], rejected: ['✖', 'رفض'] };
  const steps = x => h('div', { class: 'steps' },
    h('div', { class: 'step approved' }, h('b', null, '✔'), h('span', null, 'رُفع الطلب')),
    ...[['الكفيل', x.steps.guarantor], ['الموارد البشرية', x.steps.hr]].map(([l, s]) => h('div', { class: 'step ' + s }, h('b', null, STEP[s][0]), h('span', null, `${l}: ${STEP[s][1]}`))));

  // ---- نموذج رفع طلب سلفة ----
  function newLoanForm(onDone) {
    const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'مثال: 5000', autocomplete: 'off' });
    const months = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'عدد الأقساط بالأشهر', autocomplete: 'off' });
    const reason = h('textarea', { rows: 2, maxlength: 300, placeholder: 'سبب الطلب (اختياري)' });
    let guarantor = null, timer;
    const gBox = h('div');
    const draw = () => {
      if (guarantor) { gBox.replaceChildren(h('div', { class: 'emp-card' }, h('div', { class: 'meta' }, h('b', null, guarantor.full_name), h('small', null, [guarantor.emp_no ? `رقم ${guarantor.emp_no}` : '', guarantor.job_title].filter(Boolean).join(' · '))), h('button', { class: 'btn sm', type: 'button', onclick: () => { guarantor = null; draw(); } }, 'تغيير'))); return; }
      const list = h('div', { class: 'emp-list', hidden: true });
      const input = h('input', { type: 'search', placeholder: 'ابحث عن الكفيل بالاسم أو الرقم الوظيفي…', autocomplete: 'off', 'aria-label': 'الكفيل' });
      const search = guard(async () => {
        const { guarantors } = await api('/loans/guarantors?q=' + encodeURIComponent(input.value.trim()));
        list.replaceChildren(...(guarantors.length ? guarantors.map(g => h('button', { class: 'emp-opt', type: 'button', onclick: () => { guarantor = g; draw(); } }, h('b', null, g.full_name), h('small', null, [g.emp_no ? `رقم ${g.emp_no}` : '', g.job_title].filter(Boolean).join(' · ')))) : [h('div', { class: 'emp-opt' }, 'لا نتائج (الكفيل يلزم أن يكون له حساب على المنصة)')]));
        list.hidden = false;
      });
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); }); input.addEventListener('focus', search);
      gBox.replaceChildren(h('div', { class: 'emp-pick' }, input, list));
    };
    draw();
    const submit = guard(async () => {
      if (!guarantor) throw new Error('اختر الكفيل');
      const out = await api('/loans', { method: 'POST', body: { amount: norm(amount.value), months: norm(months.value), reason: reason.value, guarantor_staff_id: guarantor.id } });
      toast(`تم رفع الطلب ${out.loan.ref_no} وأُرسل للكفيل`); await onDone();
    });
    const noSig = !S.meta.has_signature;
    return h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'طلب سلفة'),
      noSig ? h('div', { class: 'note' }, 'لرفع طلب السلفة أضف توقيعك أولاً: ', h('a', { href: '/my-profile/', target: '_top' }, 'ملفي الشخصي ← توقيعي الخاص')) : null,
      h('div', { class: 'note' }, 'يُرسل طلبك أولاً إلى الكفيل ليعتمده ويضع بياناته، ثم يذهب إلى الموارد البشرية. ستتابع هنا حالة الطلب فقط.'),
      h('div', { class: 'f2' }, fieldBox('مبلغ السلفة (ريال)', amount, true), fieldBox('عدد الأقساط (أشهر)', months, true), h('div', { class: 'full' }, fieldBox('الكفيل', gBox, true)), h('div', { class: 'full' }, fieldBox('السبب', reason))),
      h('div', { class: 'actions', style: 'margin-top:10px' }, h('button', { class: 'btn primary', type: 'button', disabled: noSig, onclick: submit }, 'رفع الطلب' + (noSig ? ' (يلزم التوقيع)' : ''))));
  }

  // ---- طلباتي من السلف (حالة فقط) ----
  async function mineSection() {
    const { loans } = await api('/loans/mine');
    const reload = async () => { const n = await mineSection(); box.replaceWith(n); };
    const box = h('div', null, h('h2', { class: 'sec', style: 'margin-top:14px' }, 'طلبات السلف'),
      loans.length ? loans.map(x => h('div', { class: 'card loan' },
        h('div', { class: 'bar' }, h('b', null, x.ref_no), h('span', { class: 'hint' }, `${sar(x.amount)} ر.س · ${x.months} ${x.months === 1 ? 'قسط' : 'أقساط'} · الكفيل: ${x.guarantor_name}`), h('div', { class: 'sp' }), badge(x.outcome),
          x.can_cancel ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmBox(`إلغاء الطلب ${x.ref_no}؟`, async () => { await api(`/loans/${x.id}/cancel`, { method: 'POST' }); toast('أُلغي الطلب'); await reload(); }) }, 'إلغاء') : null),
        steps(x), h('div', { class: 'hint' }, `رُفع ${fmt(x.created_at)}`))) : h('div', { class: 'empty' }, 'لا طلبات سلف بعد.'));
    return box;
  }

  // ---- الكفيل ----
  async function guaranteeView() {
    const box = h('div');
    const load = guard(async () => {
      const { loans } = await api('/loans/guarantee');
      box.replaceChildren(loans.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['الرقم', 'طالب السلفة', 'المبلغ', 'الأقساط', 'السبب', 'تاريخ الطلب', 'الحالة', ''].map(t => h('th', null, t)))),
        h('tbody', null, loans.map(x => h('tr', null, h('td', null, h('b', null, x.ref_no)), h('td', null, h('b', null, x.requester_name), h('div', { class: 'hint' }, [x.requester_emp_no ? `رقم ${x.requester_emp_no}` : '', x.requester_job].filter(Boolean).join(' · '))),
          h('td', { class: 'n' }, sar(x.amount) + ' ر.س'), h('td', null, `${x.months} × ${sar(x.installment)}`), h('td', null, x.reason || '—'), h('td', { style: 'white-space:nowrap' }, fmt(x.created_at)),
          h('td', null, x.my_decision === 'pending' ? h('span', { class: 'st pending' }, 'بانتظار قرارك') : x.my_decision === 'rejected' ? h('span', { class: 'st rejected' }, 'رفضت') : x.my_decision === 'cancelled' ? h('span', { class: 'st cancelled' }, 'أُلغي') : [h('span', { class: 'st approved' }, 'اعتمدت'), h('div', { class: 'hint' }, OUTCOME[x.overall])]),
          h('td', null, x.my_decision === 'pending' ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => guaranteeDialog(x.id, load) }, 'مراجعة') : null)))))) : h('div', { class: 'empty' }, 'لا توجد طلبات كفالة.'));
    });
    view.replaceChildren(h('div', { class: 'note' }, 'تظهر هنا طلبات السلف التي اختارك أصحابها كفيلاً لهم. باعتمادك تُقرّ بضمان المستفيد ضماناً شاملاً في مبلغ السلفة، وتضع بياناتك للموارد البشرية فقط.'), box);
    await load();
  }
  async function guaranteeDialog(id, onDone) {
    const { loan: x, prefill } = await api('/loans/guarantee/' + id);
    const inp = (v, o = {}) => h('input', { type: 'text', value: v ?? '', autocomplete: 'off', ...o });
    const nid = inp(prefill.national_id, { dir: 'ltr', placeholder: '10 أرقام' }), hire = inp(prefill.hire_date, { type: 'date' }), phone = inp(prefill.phone, { dir: 'ltr', placeholder: '05xxxxxxxx' }), salary = inp('', { inputmode: 'decimal', placeholder: 'راتبك الشهري' });
    const note = inp('', { placeholder: 'ملاحظة (اختياري)', maxlength: 300 }), ack = h('input', { type: 'checkbox' });
    const noSig = !S.meta.has_signature;
    const approve = guard(async () => { await api(`/loans/guarantee/${id}/approve`, { method: 'POST', body: { national_id: nid.value, hire_date: hire.value, phone: phone.value, salary: norm(salary.value), acknowledge: ack.checked, note: note.value } }); closeModal(); toast('تم اعتماد الكفالة وإرسال الطلب للموارد البشرية'); await onDone(); });
    const reject = guard(async () => { await api(`/loans/guarantee/${id}/reject`, { method: 'POST', body: { note: note.value } }); closeModal(); toast('تم رفض الكفالة'); await onDone(); });
    modal(`طلب كفالة — ${x.ref_no}`, h('div', null,
      h('div', { class: 'note' }, `طالب السلفة: ${x.requester_name}${x.requester_emp_no ? ` (رقم ${x.requester_emp_no})` : ''} · المبلغ ${sar(x.amount)} ر.س على ${x.months} أشهر (القسط ${sar(x.installment)} ر.س)${x.reason ? ` · السبب: ${x.reason}` : ''}`),
      noSig ? h('div', { class: 'note' }, 'لتوقّع كفالتك أضف توقيعك أولاً: ', h('a', { href: '/my-profile/', target: '_top' }, 'ملفي الشخصي ← توقيعي الخاص')) : null,
      h('h3', { style: 'font-size:1rem' }, 'بياناتك كضامن'),
      h('div', { class: 'f2' }, fieldBox('رقم الهوية', nid, true), fieldBox('تاريخ بداية العمل', hire, true), fieldBox('رقم الجوال', phone, true), fieldBox('الراتب الشهري (ريال)', salary, true), h('div', { class: 'full' }, fieldBox('ملاحظة', note))),
      h('label', { class: 'ackrow' }, ack, ' أوافق على ضمان المستفيد من السلفة ضماناً شاملاً في مبلغ السلفة المذكور أعلاه، وأقرّ بصحة بياناتي.')),
    [h('button', { class: 'btn primary', type: 'button', disabled: noSig, onclick: approve }, noSig ? 'اعتماد الكفالة (يلزم توقيعك)' : 'اعتماد الكفالة'), h('button', { class: 'btn danger', type: 'button', onclick: reject }, 'رفض')]);
  }

  // ---- الموارد البشرية ----
  async function inboxView() {
    const box = h('div'); const f = S.loanFilter ||= { status: 'pending_hr', q: '' };
    const search = h('input', { type: 'search', placeholder: 'بحث بالموظف أو الكفيل أو رقم الطلب…', value: f.q, 'aria-label': 'بحث' });
    const sel = h('select', { 'aria-label': 'الحالة', onchange: ev => { f.status = ev.target.value; load(); } }, [['pending_hr', 'بانتظار الموارد'], ['pending_guarantor', 'بانتظار الكفيل'], ['approved', 'المعتمدة'], ['rejected', 'المرفوضة'], ['cancelled', 'الملغاة'], ['', 'الكل']].map(([v, l]) => h('option', { value: v, selected: v === f.status }, l)));
    let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = search.value.trim(); load(); }, 300); });
    const load = guard(async () => {
      const { loans } = await api('/loans/review?' + new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}) }));
      box.replaceChildren(loans.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['الرقم', 'الموظف', 'الكفيل', 'المبلغ', 'الأقساط', 'تاريخ الطلب', 'الحالة', ''].map(t => h('th', null, t)))),
        h('tbody', null, loans.map(x => h('tr', null, h('td', null, h('b', null, x.ref_no)), h('td', null, h('b', null, x.employee_name), x.emp_no ? h('div', { class: 'hint' }, 'رقم ' + x.emp_no) : null), h('td', null, x.guarantor_name),
          h('td', { class: 'n' }, sar(x.approved_amount ?? x.amount) + ' ر.س'), h('td', null, String(x.approved_months ?? x.months)), h('td', { style: 'white-space:nowrap' }, fmt(x.created_at)), h('td', null, badge(x.outcome)),
          h('td', null, h('div', { class: 'row-acts' }, h('button', { class: 'btn sm' + (x.status === 'pending_hr' ? ' primary' : ''), type: 'button', onclick: () => reviewDialog(x.id, load) }, x.status === 'pending_hr' ? 'مراجعة' : 'عرض'),
            x.status === 'approved' ? h('button', { class: 'btn sm', type: 'button', onclick: () => window.open(`/hr-requests/doc.html?loan=${x.id}`, '_blank', 'noopener') }, 'النموذج') : null))))))) : h('div', { class: 'empty' }, 'لا طلبات مطابقة.'));
    });
    view.replaceChildren(h('div', { class: 'bar' }, search, sel), box); await load();
  }
  async function reviewDialog(id, onDone) {
    const d = await api('/loans/review/' + id);
    const x = d.loan, e = d.employee, g = x.guarantor_data;
    const row = (l, v) => h('div', { class: 'kv' }, h('span', null, l), h('b', null, v ?? '—'));
    const info = h('div', { class: 'review' },
      h('div', null, h('h3', { style: 'font-size:1rem' }, 'طالب السلفة'), row('الاسم', e.name), row('الرقم الوظيفي', e.emp_no), row('الوظيفة', e.job_title), row('الإدارة / القسم', [e.department, e.section].filter(Boolean).join(' ‹ ')), row('بداية العمل', e.hire_date), row('الراتب الأساسي', sar(e.basic)), row('الراتب الإجمالي', sar(e.gross)),
        row('المبلغ المطلوب', `${sar(x.amount)} ر.س`), row('الأقساط', `${x.months} أشهر`), row('السبب', x.reason)),
      h('div', null, h('h3', { style: 'font-size:1rem' }, 'الكفيل'), row('الاسم', x.guarantor_name), row('الرقم الوظيفي', x.guarantor_emp_no), row('الوظيفة', x.guarantor_job),
        g ? [row('رقم الهوية', g.national_id), row('بداية العمل', g.hire_date), row('الجوال', g.phone), row('الراتب الشهري', sar(g.salary)), row('اعتمد في', fmt(x.guarantor_decided_at)), x.guarantor_note ? row('ملاحظة الكفيل', x.guarantor_note) : null]
          : [h('div', { class: 'hint' }, x.rejected_by === 'guarantor' ? 'رفض الكفيل الطلب.' : 'لم يعتمد الكفيل بعد.'), x.guarantor_note ? row('ملاحظة الكفيل', x.guarantor_note) : null]));
    const kids = [h('div', { class: 'note' }, `${x.ref_no} · ${OUTCOME[x.outcome]}`), info];
    const buttons = [];
    if (x.status === 'pending_hr') {
      const inp = (v, o = {}) => h('input', { type: 'text', value: v ?? '', autocomplete: 'off', inputmode: 'decimal', ...o });
      const amount = inp(d.defaults.amount), months = inp(d.defaults.months, { inputmode: 'numeric' }), ge = inp(0), gg = inp(0), pb = inp(0), first = inp('', { type: 'month' }), note = inp('', { placeholder: 'ملحوظة / سبب الرفض', inputmode: 'text', maxlength: 300 });
      const body = () => ({ amount: norm(amount.value), months: norm(months.value), gratuity_employee: norm(ge.value), gratuity_guarantor: norm(gg.value), previous_balance: norm(pb.value), first_installment: first.value, note: note.value });
      kids.push(h('h3', { style: 'font-size:1rem;margin-top:14px' }, 'قرار الموارد البشرية (يُدرج في النموذج)'),
        h('div', { class: 'f2' }, fieldBox('المبلغ المعتمد (ريال)', amount, true), fieldBox('عدد الأقساط', months, true), fieldBox('إجمالي مكافأة الموظف', ge), fieldBox('إجمالي مكافأة الضامن', gg), fieldBox('رصيد السلف السابقة', pb), fieldBox('بداية أول قسط', first, true), h('div', { class: 'full' }, fieldBox('ملحوظة / سبب الرفض', note))));
      buttons.push(h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await api(`/loans/review/${id}/approve`, { method: 'POST', body: body() }); closeModal(); toast('تم اعتماد السلفة وإصدار النموذج للموارد البشرية'); await onDone(); }) }, 'اعتماد وإصدار النموذج'),
        h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { await api(`/loans/review/${id}/reject`, { method: 'POST', body: { note: note.value } }); closeModal(); toast('تم رفض الطلب'); await onDone(); }) }, 'رفض'));
    } else if (x.status === 'approved') {
      kids.push(h('div', { class: 'kv' }, h('span', null, 'المعتمد'), h('b', null, `${sar(x.approved_amount)} ر.س على ${x.approved_months} أشهر`)), x.hr_note ? row('ملحوظة', x.hr_note) : null);
      buttons.push(h('button', { class: 'btn primary', type: 'button', onclick: () => window.open(`/hr-requests/doc.html?loan=${id}`, '_blank', 'noopener') }, 'فتح النموذج'));
    } else if (x.hr_note) kids.push(row('سبب رفض الموارد', x.hr_note));
    modal(`مراجعة السلفة — ${x.ref_no}`, h('div', null, ...kids.filter(Boolean)), buttons);
  }
  return { newLoanForm, mineSection, guaranteeView, inboxView };
}
