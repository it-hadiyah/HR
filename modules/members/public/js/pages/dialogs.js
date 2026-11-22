// نوافذ مشتركة: نموذج العضو، تسجيل السداد (بخطوة مراجعة)، التجديد، تغيير الحالة الإدارية.
import { h, icon, btn, api, can, state, fmtMoney, fmtDate, fmtDateLong, modal, formModal, fld, toast, errMsg, typeOptions, clear, today, confirmDialog } from '../lib.js';

const pad = (n) => String(n).padStart(2, '0');
function addMonths(iso, m) {
  const [y, mo, d] = iso.split('-').map(Number); const t = y * 12 + (mo - 1) + m;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1, last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const periodEnd = (start, months) => (start && months ? addDays(addMonths(start, Number(months)), -1) : '');
const typeById = (id) => state.meta.membership_types.find((t) => String(t.id) === String(id));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ───────── نموذج العضو (إضافة/تعديل) ─────────
export function memberFormModal({ member = null, onSaved }) {
  const edit = !!member;
  const canMoney = can('subscriptions.edit');
  const t0 = edit ? typeById(member.membership_type_id) : state.meta.membership_types.find((t) => t.is_active);
  const fields = [
    { group: 'البيانات الأساسية', fields: [
      { label: 'الاسم الكامل', name: 'full_name', required: true, value: member?.full_name, wide: true, maxlength: 150, autocomplete: 'off' },
      { label: 'رقم الجوال', name: 'phone', type: 'tel', ltr: true, value: member?.phone || '', hint: 'مثال: 05XXXXXXXX', placeholder: '05XXXXXXXX' },
      { label: 'البريد الإلكتروني', name: 'email', type: 'email', ltr: true, value: member?.email || '' },
      { label: 'تاريخ الانضمام', name: 'joined_at', type: 'date', required: true, value: member?.joined_at || today() },
    ] },
    { group: edit ? 'الدورة الحالية' : 'العضوية والاشتراك', fields: [
      { label: 'نوع العضوية', name: 'membership_type_id', type: 'select', required: true, options: typeOptions(false, member?.membership_type_id), value: edit ? member.membership_type_id : t0?.id },
      { label: 'تاريخ بداية العضوية', name: 'start_date', type: 'date', required: true, value: edit ? member.period_start : today() },
      ...(edit ? [] : [{ label: 'المدة (بالأشهر)', name: 'duration_months', type: 'number', min: 1, max: 120, step: 1, value: t0?.default_duration_months || 12 }]),
      { label: 'تاريخ انتهاء العضوية', name: 'end_date', type: 'date', value: edit ? member.period_end : '', hint: edit ? '' : 'يُحسب تلقائيًا من البداية والمدة' },
      { label: 'قيمة الاشتراك (ر.س)', name: 'amount_due', type: 'text', ltr: true, value: edit ? member.amount_due : '', disabled: !canMoney, hint: canMoney ? (edit ? '' : 'اتركه فارغًا لاعتماد القيمة الافتراضية للنوع') : 'تعديل المبالغ يتطلب صلاحية الاشتراكات' },
      { label: 'تاريخ استحقاق السداد', name: 'due_date', type: 'date', value: edit ? member.due_date : '', disabled: edit && !canMoney, hint: edit ? '' : 'الافتراضي: تاريخ البداية' },
      { label: 'معفى من الرسوم (للأنواع التي تسمح بذلك)', name: 'is_exempt', type: 'checkbox', value: edit ? member.is_exempt : false, disabled: !canMoney },
    ] },
    { label: 'ملاحظات إدارية', name: 'notes', type: 'textarea', value: member?.notes || '', wide: true, maxlength: 2000 },
  ];
  const fm = formModal({ title: edit ? `تعديل بيانات: ${member.full_name}` : 'إضافة عضو جديد', size: 'lg', submitLabel: edit ? 'حفظ التعديلات' : 'إضافة العضو', fields,
    intro: edit ? 'تعديل البيانات لا يحذف سجل المدفوعات ولا الدورات السابقة. تُسجَّل التغييرات في سجل التدقيق.' : 'يُنشأ رقم العضوية تلقائيًا، وتُنشأ أول دورة اشتراك مرتبطة بالعضو.',
    onSubmit: async (v, m) => {
      const personal = { full_name: v.full_name, phone: v.phone, email: v.email, joined_at: v.joined_at, notes: v.notes };
      if (!edit) {
        const body = { ...personal, membership_type_id: v.membership_type_id, start_date: v.start_date, duration_months: v.duration_months, end_date: v.end_date || undefined, due_date: v.due_date || undefined };
        if (canMoney) { if (String(v.amount_due).trim()) body.amount_due = v.amount_due.trim(); body.is_exempt = !!v.is_exempt; }
        const r = await api('/members', { method: 'POST', body });
        m.close(); toast('تمت إضافة العضو', 'ok'); onSaved?.(r.id); return;
      }
      await api(`/members/${member.id}`, { method: 'PUT', body: personal });
      const per = {};
      if (String(v.membership_type_id) !== String(member.membership_type_id)) per.membership_type_id = v.membership_type_id;
      if (v.start_date !== member.period_start) per.start_date = v.start_date;
      if (v.end_date && v.end_date !== member.period_end) per.end_date = v.end_date;
      if (canMoney) {
        if (v.amount_due.trim() && v.amount_due.trim() !== member.amount_due && !v.is_exempt) per.amount_due = v.amount_due.trim();
        if (v.due_date && v.due_date !== member.due_date) per.due_date = v.due_date;
        if (!!v.is_exempt !== !!member.is_exempt) per.is_exempt = !!v.is_exempt;
      }
      if (Object.keys(per).length && member.period_id) await api(`/periods/${member.period_id}`, { method: 'PUT', body: per });
      m.close(); toast('تم حفظ التعديلات', 'ok'); onSaved?.(member.id);
    } });
  const { map } = fm;
  if (!edit) {
    const sync = () => {
      const t = typeById(map.membership_type_id.value);
      if (t) {
        map.amount_due.input.placeholder = `الافتراضي: ${fmtMoney(t.default_fee)}`;
        map.is_exempt.root.hidden = !t.fee_exempt; if (!t.fee_exempt) map.is_exempt.input.checked = false;
      }
      map.end_date.input.placeholder = periodEnd(map.start_date.value, map.duration_months.value) || '';
    };
    map.membership_type_id.input.addEventListener('change', () => { const t = typeById(map.membership_type_id.value); if (t) map.duration_months.input.value = t.default_duration_months; sync(); });
    map.joined_at.input.addEventListener('change', () => { map.start_date.input.value = map.joined_at.value; sync(); });
    ['start_date', 'duration_months'].forEach((k) => map[k].input.addEventListener('input', sync));
    sync();
  } else {
    const sync = () => { const t = typeById(map.membership_type_id.value); map.is_exempt.root.hidden = !(t?.fee_exempt); };
    map.membership_type_id.input.addEventListener('change', sync); sync();
  }
  return fm;
}

// ───────── تسجيل / تعديل السداد ─────────
const methodOptions = () => state.meta.user_methods.map((k) => ({ value: k, label: state.meta.payment_methods[k] }));

export function paymentModal({ member, subscriptions, subscriptionId, payment = null, onSaved }) {
  const edit = !!payment;
  const open = subscriptions.filter((s) => !s.is_exempt && Number(s.remaining) > 0);
  const subSel = edit ? null : fld({ label: 'الاشتراك', name: 'subscription_id', type: 'select', required: true, value: subscriptionId || open[0]?.subscription_id,
    options: open.map((s) => ({ value: s.subscription_id, label: `${s.type_name} · ${fmtDate(s.start_date)} – ${fmtDate(s.end_date)} · المتبقي ${fmtMoney(s.remaining)} ر.س` })) });
  const cur = () => (edit ? null : open.find((s) => String(s.subscription_id) === String(subSel.value)));
  const amount = fld({ label: 'المبلغ (ر.س)', name: 'amount', required: true, ltr: true, value: edit ? payment.amount : (cur()?.remaining || ''), hint: '' });
  const paidAt = fld({ label: 'تاريخ السداد', name: 'paid_at', type: 'date', required: true, value: edit ? payment.paid_at : today(), max: today() });
  const method = fld({ label: 'طريقة السداد', name: 'method', type: 'select', required: true, options: methodOptions(), value: edit ? payment.method : 'bank_transfer' });
  const ref = fld({ label: 'رقم المرجع / الحوالة / الإيصال', name: 'reference', ltr: true, value: edit ? payment.reference || '' : '', hint: 'يُمنع تكرار المرجع نفسه في عمليتين', maxlength: 80 });
  const notes = fld({ label: 'ملاحظات', name: 'notes', type: 'textarea', rows: 2, value: edit ? payment.notes || '' : '', maxlength: 1000 });
  const reason = edit ? fld({ label: 'سبب التعديل', name: 'reason', required: true, type: 'textarea', rows: 2, hint: 'يُحفظ في سجل التدقيق مع القيم قبل التعديل وبعده' }) : null;
  const file = fld({ label: 'إيصال السداد (PDF أو PNG أو JPG، حتى 5 ميغابايت)', name: 'file', type: 'file' });
  file.input.accept = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
  const note = h('p', { class: 'hint small', 'aria-live': 'polite' });
  const refresh = () => { const c = cur(); if (c) { note.textContent = `قيمة الاشتراك ${fmtMoney(c.amount_due)} · المسدد ${fmtMoney(c.paid)} · المتبقي ${fmtMoney(c.remaining)} ر.س`; } };
  subSel?.input.addEventListener('change', () => { amount.input.value = cur()?.remaining || ''; refresh(); });
  refresh();
  const alertBox = h('div');
  const idem = uuid();
  const form = h('form', { novalidate: true, class: 'grid' }, ...(subSel ? [subSel.root, note] : [h('p', { class: 'muted' }, `السداد رقم ${payment.id} · ${fmtDate(payment.paid_at)}`)]),
    h('div', { class: 'grid g2' }, amount.root, paidAt.root, method.root, ref.root), notes.root, reason?.root, edit ? null : file.root);
  const reviewBox = h('div', { hidden: true });
  const primary = h('button', { class: 'btn primary', type: 'button' }, 'مراجعة');
  const backB = btn('رجوع للتعديل', { onClick: () => step(1) }); backB.hidden = true;
  const m = modal({ title: edit ? 'تعديل عملية سداد' : `تسجيل سداد – ${member.full_name}`, size: '', body: [alertBox, form, reviewBox], footer: [primary, backB, btn('إلغاء', { onClick: () => m.close() })] });
  let stage = 1; let confirmDup = false;
  const fields = { amount, paid_at: paidAt, method, reference: ref, notes, reason };
  function step(n) {
    stage = n; form.hidden = n === 2; reviewBox.hidden = n === 1; backB.hidden = n === 1;
    primary.textContent = n === 1 ? 'مراجعة' : (edit ? 'تأكيد حفظ التعديل' : 'تأكيد وتسجيل السداد'); clear(alertBox);
  }
  function validate() {
    let ok = true; Object.values(fields).forEach((f) => f?.setError(''));
    const a = amount.input.value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(a.replace(/,/g, '')) || Number(a) <= 0) { amount.setError('أدخل مبلغًا صحيحًا أكبر من صفر (حتى منزلتين عشريتين)'); ok = false; }
    else if (!edit && cur() && Number(a.replace(/,/g, '')) > Number(cur().remaining)) { amount.setError(`المبلغ يتجاوز المتبقي (${fmtMoney(cur().remaining)})`); ok = false; }
    if (!paidAt.input.value) { paidAt.setError('تاريخ السداد مطلوب'); ok = false; } else if (paidAt.input.value > today()) { paidAt.setError('لا يمكن اختيار تاريخ مستقبلي'); ok = false; }
    if (reason && !reason.input.value.trim()) { reason.setError('سبب التعديل مطلوب'); ok = false; }
    if (!edit && !subSel.value) { subSel.setError('لا يوجد اشتراك عليه متبقٍ'); ok = false; }
    return ok;
  }
  function review() {
    clear(reviewBox);
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    reviewBox.append(h('div', { class: 'alert info' }, icon('alert'), 'راجع البيانات. لا تُعدّ عملية السداد مسجّلة إلا بعد الضغط على «تأكيد».'),
      h('dl', { class: 'dl', style: { marginBlockStart: '16px' } }, ...row('العضو', member.full_name), ...row('المبلغ', h('span', { class: 'num' }, `${fmtMoney(amount.input.value.replace(/,/g, ''))} ر.س`)),
        ...row('تاريخ السداد', fmtDateLong(paidAt.input.value)), ...row('الطريقة', state.meta.payment_methods[method.input.value]), ...row('المرجع', ref.input.value.trim() || '—'),
        ...(!edit && cur() ? row('المتبقي بعد السداد', h('span', { class: 'num' }, `${fmtMoney((Number(cur().remaining) - Number(amount.input.value.replace(/,/g, ''))).toFixed(2))} ر.س`)) : []),
        ...(!edit && file.input.files[0] ? row('الإيصال', file.input.files[0].name) : []), ...(edit ? row('سبب التعديل', reason.input.value.trim()) : [])));
  }
  primary.addEventListener('click', async () => {
    if (stage === 1) { if (!validate()) return; review(); step(2); return; }
    primary.setAttribute('aria-busy', 'true'); clear(alertBox);
    const body = { amount: amount.input.value.trim().replace(/,/g, ''), paid_at: paidAt.input.value, method: method.input.value, reference: ref.input.value.trim(), notes: notes.input.value.trim() };
    try {
      if (edit) { await api(`/payments/${payment.id}`, { method: 'PUT', body: { ...body, reason: reason.input.value.trim() } }); m.close(); toast('تم تعديل عملية السداد', 'ok'); onSaved?.(); return; }
      const res = await api(`/subscriptions/${subSel.value}/payments`, { method: 'POST', body: { ...body, idempotency_key: idem, confirm_duplicate: confirmDup } });
      const f = file.input.files[0];
      if (f && !res.replayed) {
        try { const fd = new FormData(); fd.append('file', f); await api(`/payments/${res.payment.id}/receipts`, { method: 'POST', form: fd }); }
        catch (e) { toast(`سُجّل السداد لكن تعذّر رفع الإيصال: ${errMsg(e)}`, 'bad'); m.close(); onSaved?.(); return; }
      }
      m.close(); toast(res.replayed ? 'هذه العملية سُجّلت مسبقًا' : 'تم تسجيل السداد بنجاح', 'ok'); onSaved?.();
    } catch (e) {
      step(1);
      if (e.code === 'possible_duplicate') {
        const ok = await confirmDialog({ title: 'عملية مطابقة موجودة', message: `${e.message} هل تريد تسجيلها فعلًا؟`, confirmLabel: 'نعم، سجّلها' });
        if (ok) { confirmDup = true; if (validate()) { review(); step(2); } }
        return;
      }
      if (e.details) for (const [k, msg] of Object.entries(e.details)) fields[k]?.setError(msg);
      alertBox.append(h('div', { class: 'alert bad', role: 'alert', style: { marginBlockEnd: '12px' } }, icon('alert'), errMsg(e)));
    } finally { primary.removeAttribute('aria-busy'); }
  });
  return m;
}

// ───────── التجديد ─────────
export function renewModal({ member, onSaved }) {
  const canMoney = can('subscriptions.edit');
  const t0 = typeById(member.membership_type_id);
  const already = member.next_start;
  const defStart = member.period_end && member.period_end >= today() ? addDays(member.period_end, 1) : today();
  let confirmExtra = false;
  const fm = formModal({ title: `تجديد العضوية – ${member.full_name}`, submitLabel: 'تجديد العضوية',
    intro: 'ينشئ التجديد دورة اشتراك جديدة مرتبطة بالعضو ولا يحذف أو يعدّل الدورات والمدفوعات السابقة.',
    fields: [
      { label: 'نوع العضوية', name: 'membership_type_id', type: 'select', options: typeOptions(false, member.membership_type_id), value: member.membership_type_id },
      { label: 'تاريخ بداية الدورة', name: 'start_date', type: 'date', value: defStart },
      { label: 'المدة (بالأشهر)', name: 'duration_months', type: 'number', min: 1, max: 120, step: 1, value: t0?.default_duration_months || state.meta.defaults.duration_months || 12, hint: 'السنة = 12 شهرًا. يمكن إدخال أي مدة أخرى.' },
      { label: 'تاريخ انتهاء الدورة', name: 'end_date', type: 'date', hint: 'يُحسب تلقائيًا' },
      { label: 'قيمة الاشتراك (ر.س)', name: 'amount_due', ltr: true, disabled: !canMoney, hint: canMoney ? 'اتركه فارغًا لاعتماد القيمة الافتراضية' : 'القيمة الافتراضية للنوع' },
      { label: 'تاريخ الاستحقاق', name: 'due_date', type: 'date', hint: 'الافتراضي: بداية الدورة' },
      { label: 'معفى من الرسوم', name: 'is_exempt', type: 'checkbox', disabled: !canMoney },
    ],
    extra: already ? h('div', { class: 'alert warn', style: { marginBlockStart: '12px' } }, icon('alert'), 'تم تجديد هذه العضوية مسبقًا لفترة قادمة. سيُطلب منك التأكيد لإضافة تجديد آخر.') : null,
    onSubmit: async (v, m) => {
      const body = { membership_type_id: v.membership_type_id, start_date: v.start_date, duration_months: v.duration_months, end_date: v.end_date || undefined, due_date: v.due_date || undefined, confirm_additional: confirmExtra };
      if (canMoney) { if (String(v.amount_due).trim()) body.amount_due = v.amount_due.trim(); body.is_exempt = !!v.is_exempt; }
      try { await api(`/members/${member.id}/renew`, { method: 'POST', body }); }
      catch (e) {
        if (e.code === 'already_renewed') { const ok = await confirmDialog({ title: 'تجديد إضافي', message: e.message, confirmLabel: 'نعم، جدّد' }); if (ok) { confirmExtra = true; body.confirm_additional = true; await api(`/members/${member.id}/renew`, { method: 'POST', body }); } else return; }
        else throw e;
      }
      m.close(); toast('تم تجديد العضوية', 'ok'); onSaved?.();
    } });
  const { map } = fm;
  const sync = () => {
    const t = typeById(map.membership_type_id.value);
    map.amount_due.input.placeholder = t ? `الافتراضي: ${fmtMoney(t.default_fee)}` : '';
    map.is_exempt.root.hidden = !t?.fee_exempt; if (!t?.fee_exempt) map.is_exempt.input.checked = false;
    map.end_date.input.placeholder = periodEnd(map.start_date.value, map.duration_months.value);
  };
  map.membership_type_id.input.addEventListener('change', () => { const t = typeById(map.membership_type_id.value); if (t) map.duration_months.input.value = t.default_duration_months; sync(); });
  ['start_date', 'duration_months'].forEach((k) => map[k].input.addEventListener('input', sync)); sync();
  return fm;
}

// ───────── الحالة الإدارية ─────────
export function statusModal({ member, onSaved }) {
  const opts = [{ value: 'normal', label: 'عادية (تُحسب الحالة من التواريخ)' }, { value: 'suspended', label: 'تعليق إداري' }, { value: 'cancelled', label: 'إلغاء رسمي' }];
  return formModal({ title: `الحالة الإدارية – ${member.full_name}`, size: 'sm', submitLabel: 'حفظ الحالة',
    intro: 'التعليق والإلغاء قراران إداريان يتغلّبان على حالة الصلاحية المحسوبة من التواريخ، ولا يمسّان السجل المالي.',
    fields: [{ label: 'الحالة', name: 'status', type: 'select', options: opts, value: member.admin_status }, { label: 'السبب (إلزامي للتعليق والإلغاء)', name: 'reason', type: 'textarea', value: member.admin_status_reason || '' }],
    onSubmit: async (v, m) => { await api(`/members/${member.id}/status`, { method: 'POST', body: v }); m.close(); toast('تم تحديث الحالة الإدارية', 'ok'); onSaved?.(); } });
}
