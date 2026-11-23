// طلبات الموظفين: يرفع الموظف طلب خطاب تعريف بالراتب أو تثبيت بالراتب، وتعتمده الموارد البشرية، ثم يُنزَّل المستند مختوماً.
if (window.top !== window.self) document.documentElement.classList.add('embedded');   // داخل بوابة الموارد البشرية

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
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api/hr-requests' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('انتهت الجلسة'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
const toast = (msg, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
import { createLoans } from '/hr-requests/loans.js';
const view = document.getElementById('view');
const S = { meta: null, tab: 'mine', type: null, filter: { status: 'pending', type: '', q: '' } };
const STATUS = { pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' };
const fmt = s => (s ? new Date(s).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const badge = x => h('span', { class: 'st ' + x.status }, STATUS[x.status] || x.status);
const summary = x => (x.type === 'fixation' ? `البنك: ${x.params.bank || '—'} · الآيبان: ${x.params.iban ? x.params.iban.slice(0, 4) + '…' + x.params.iban.slice(-4) : '—'}` : `موجّه إلى: ${x.params.to || '—'}`);

let currentModal = null;
const closeModal = () => { currentModal?.remove(); currentModal = null; };
function modal(title, content, footBtns = []) {
  closeModal();
  currentModal = h('div', { class: 'modal-bg', onclick: e => { if (e.target === currentModal) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', null, title), content, h('div', { class: 'foot' }, ...footBtns, h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'إغلاق'))));
  document.body.append(currentModal);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const confirmBox = (msg, onYes) => modal('تأكيد', h('p', null, msg), [h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => { closeModal(); await onYes(); }) }, 'تأكيد')]);
let loans = null;   // يُهيَّأ بعد تعريف الأدوات (modal وغيرها)
const openDoc = x => window.open(`/hr-requests/doc.html?id=${x.id}`, '_blank', 'noopener');
const starsText = n => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

// ---------- تقييم الخدمة بالنجوم (شرط لتحميل المستند) ----------
const RATING_LABELS = ['', 'غير راضٍ إطلاقاً', 'غير راضٍ', 'محايد', 'راضٍ', 'راضٍ جداً'];
function starRow(question, onChange) {
  let value = 0, hover = 0;
  const hint = h('div', { class: 'star-hint' }, 'اضغط على النجوم للتقييم');
  const btns = [1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: 'star', role: 'radio', 'aria-checked': 'false', 'aria-label': `${n} من 5 — ${RATING_LABELS[n]}`, title: RATING_LABELS[n],
    onclick: () => { value = n; paint(); onChange(n); }, onmouseenter: () => { hover = n; paint(); }, onmouseleave: () => { hover = 0; paint(); },
    onkeydown: ev => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); const d = ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? 1 : -1; value = Math.min(5, Math.max(1, (value || 3) + d)); paint(); onChange(value); btns[value - 1].focus(); } } }, '★'));
  const paint = () => { const lit = hover || value; btns.forEach((b, i) => { b.classList.toggle('on', i < lit); b.setAttribute('aria-checked', String(i + 1 === value)); b.tabIndex = (value ? i + 1 === value : i === 0) ? 0 : -1; }); hint.textContent = lit ? RATING_LABELS[lit] : 'اضغط على النجوم للتقييم'; };
  paint();
  return h('div', { class: 'qrow' }, h('div', { class: 'q' }, question), h('div', { class: 'stars', role: 'radiogroup', 'aria-label': question }, btns), hint);
}
function ratingDialog(x, onDone) {
  const r = { service: 0, speed: 0 };
  const comment = h('textarea', { rows: 2, maxlength: 300, placeholder: 'ملاحظاتك لتحسين الخدمة (اختياري)' });
  const send = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: guard(async () => {
    await api(`/${x.id}/rating`, { method: 'POST', body: { service: r.service, speed: r.speed, comment: comment.value } });
    closeModal(); toast('شكراً لتقييمك'); await onDone(); openDoc(x);
  }) }, 'إرسال التقييم وفتح المستند');
  const upd = () => { send.disabled = !(r.service && r.speed); };
  modal(`قيّم الخدمة — ${x.ref_no}`, h('div', null,
    h('div', { class: 'note' }, 'لتحميل المستند المعتمد، يرجى تقييم الخدمة أولاً. رأيك يساعدنا على التحسين.'),
    starRow('ما مدى رضاك عن الخدمة المقدمة ؟', n => { r.service = n; upd(); }),
    starRow('ما مدى رضاك عن سرعة التعامل مع طلباتك ؟', n => { r.speed = n; upd(); }),
    h('div', { style: 'margin-top:10px' }, comment)), [send]);
}

// ---------- طلباتي ----------
async function mineView() {
  const me = S.meta.me;
  const listBox = h('div'), formBox = h('div'), loanBox = h('div');
  loanBox.refresh = async () => { loanBox.replaceChildren(await loans.mineSection()); };
  const field = (label, el, hint) => h('div', null, h('label', { class: 'f' }, label), el, hint ? h('div', { class: 'hint' }, hint) : null);
  function drawForm() {
    if (!me) { formBox.replaceChildren(h('div', { class: 'note' }, 'حسابك غير مرتبط بسجل موظف، فلا يمكن رفع طلب. تواصل مع الموارد البشرية لربط حسابك برقمك الوظيفي.')); return; }
    const opts = h('div', { class: 'opts' }, [...S.meta.types, { id: 'loan', title: 'طلب سلفة' }].map(t => h('button', { type: 'button', class: 'opt' + (S.type === t.id ? ' on' : ''), onclick: () => { S.type = t.id; drawForm(); } },
      h('b', null, t.title), h('span', null, t.id === 'loan' ? 'سلفة بكفيل من زملائك: يعتمدها الكفيل ثم الموارد البشرية، وتتابع حالتها هنا.' : t.id === 'certificate' ? 'تعريف بك وبراتبك موجّه لجهة تحددها (مثل قسم المساعدات).' : 'تعهد للبنك بتحويل راتبك إلى حسابك ليتم تثبيته.'))));
    let body = null;
    if (S.type === 'loan') body = loans.newLoanForm(async () => { S.type = null; drawForm(); await loanBox.refresh(); });
    else if (S.type) {
      const notes = h('textarea', { rows: 2, placeholder: 'ملاحظات للموارد البشرية (اختياري)', maxlength: 300 });
      let a, b;
      if (S.type === 'certificate') { a = h('input', { type: 'text', value: 'قسم المساعدات', maxlength: 120 }); }
      else { a = h('input', { type: 'text', value: 'بنك الإنماء', maxlength: 80 }); b = h('input', { type: 'text', dir: 'ltr', value: me.iban || '', placeholder: 'SA00 0000 0000 0000 0000 0000', autocomplete: 'off' }); }
      const submit = guard(async () => {
        const payload = S.type === 'certificate' ? { type: 'certificate', to: a.value, notes: notes.value } : { type: 'fixation', bank: a.value, iban: b.value, notes: notes.value };
        const out = await api('/', { method: 'POST', body: payload });
        toast(`تم رفع الطلب برقم ${out.request.ref_no}`); S.type = null; drawForm(); await loadList();
      });
      body = h('div', { class: 'card' }, h('h2', { class: 'sec' }, S.meta.types.find(t => t.id === S.type).title),
        h('div', { class: 'f2' }, S.type === 'certificate' ? field('الجهة الموجّه إليها الخطاب', a) : [field('اسم البنك', a), field('رقم الآيبان (IBAN)', b, 'يجب أن يكون الحساب باسمك')], h('div', { class: 'full' }, field('ملاحظات', notes))),
        h('div', { class: 'actions', style: 'margin-top:10px' }, h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'رفع الطلب'), h('button', { class: 'btn', type: 'button', onclick: () => { S.type = null; drawForm(); } }, 'إلغاء')));
    }
    formBox.replaceChildren(...[h('div', { class: 'note' }, `الموظف: ${me.full_name}${me.emp_no ? ` · رقم ${me.emp_no}` : ''}. بعد اعتماد الطلب من الموارد البشرية يظهر لك المستند المختوم هنا لتنزيله وحفظه.`), opts, body].filter(Boolean));
  }
  const loadList = guard(async () => {
    const { requests } = await api('/mine');
    const want = new URLSearchParams(location.search).get('rate');
    if (want) { history.replaceState(null, '', location.pathname + location.hash); const t = requests.find(z => String(z.id) === want && z.status === 'approved' && !z.rated); if (t) setTimeout(() => ratingDialog(t, loadList), 200); }
    listBox.replaceChildren(h('h2', { class: 'sec', style: 'margin-top:8px' }, 'طلباتي'), requests.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['الرقم', 'النوع', 'التفاصيل', 'تاريخ الرفع', 'الحالة', ''].map(t => h('th', null, t)))),
      h('tbody', null, requests.map(x => h('tr', null, h('td', null, h('b', null, x.ref_no)), h('td', null, x.type_title), h('td', null, summary(x), x.status === 'rejected' && x.decision_note ? h('div', { class: 'hint' }, 'سبب الرفض: ' + x.decision_note) : null),
        h('td', { style: 'white-space:nowrap' }, fmt(x.created_at)), h('td', null, badge(x), x.decided_at ? h('div', { class: 'hint' }, fmt(x.decided_at)) : null),
        h('td', null, h('div', { class: 'row-acts' },
          x.status === 'approved' ? (x.rated ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => openDoc(x) }, 'فتح المستند وتنزيله') : h('button', { class: 'btn sm primary', type: 'button', onclick: () => ratingDialog(x, loadList) }, '★ قيّم الخدمة لتحميل المستند')) : null,
          x.status === 'pending' ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmBox(`إلغاء الطلب ${x.ref_no}؟`, async () => { await api(`/${x.id}/cancel`, { method: 'POST' }); toast('أُلغي الطلب'); await loadList(); }) }, 'إلغاء') : null)))))))
      : h('div', { class: 'empty' }, 'لا توجد طلبات بعد.'));
  });
  view.replaceChildren(formBox, listBox, loanBox); drawForm(); await loadList(); await loanBox.refresh();
}

// ---------- الطلبات الواردة (الموارد البشرية) ----------
async function inboxView() {
  const box = h('div'), sumBox = h('div');
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم الوظيفي أو رقم الطلب…', value: S.filter.q, 'aria-label': 'بحث' });
  const sel = (key, items) => h('select', { 'aria-label': key, onchange: ev => { S.filter[key] = ev.target.value; load(); } }, items.map(([v, l]) => h('option', { value: v, selected: v === S.filter[key] }, l)));
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.filter.q = search.value.trim(); load(); }, 300); });
  const load = guard(async () => {
    const qs = new URLSearchParams({ ...(S.filter.status ? { status: S.filter.status } : {}), ...(S.filter.type ? { type: S.filter.type } : {}), ...(S.filter.q ? { q: S.filter.q } : {}) });
    const { requests, ratings } = await api('/?' + qs);
    sumBox.replaceChildren(...(ratings?.count ? [h('div', { class: 'kpis' }, h('div', { class: 'kpi ok' }, h('div', { class: 'l' }, 'رضا المستفيدين عن الخدمة'), h('div', { class: 'v' }, starsText(Math.round(ratings.service)), h('span', { class: 'u' }, `${ratings.service} / 5`))),
      h('div', { class: 'kpi ok' }, h('div', { class: 'l' }, 'رضاهم عن سرعة التعامل'), h('div', { class: 'v' }, starsText(Math.round(ratings.speed)), h('span', { class: 'u' }, `${ratings.speed} / 5`)), h('div', { class: 'h' }, `من ${ratings.count} تقييم`)))] : []));
    box.replaceChildren(requests.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['الرقم', 'الموظف', 'النوع', 'التفاصيل', 'تاريخ الرفع', 'الحالة', ''].map(t => h('th', null, t)))),
      h('tbody', null, requests.map(x => h('tr', null, h('td', null, h('b', null, x.ref_no)), h('td', null, h('b', null, x.employee_name), x.emp_no ? h('div', { class: 'hint' }, 'رقم ' + x.emp_no) : null), h('td', null, x.type_title), h('td', null, summary(x), x.params.notes ? h('div', { class: 'hint' }, 'ملاحظة: ' + x.params.notes) : null),
        h('td', { style: 'white-space:nowrap' }, fmt(x.created_at)), h('td', null, badge(x), x.decided_by ? h('div', { class: 'hint' }, 'بواسطة ' + x.decided_by) : null, x.rated ? h('div', { class: 'hint', title: x.rating_comment || '' }, `الخدمة ${starsText(x.rating_service)} · السرعة ${starsText(x.rating_speed)}`) : (x.status === 'approved' ? h('div', { class: 'hint' }, 'لم يُقيَّم بعد') : null)),
        h('td', null, h('div', { class: 'row-acts' }, x.status === 'pending' ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => reviewDialog(x, load) }, 'مراجعة') : null,
          x.status === 'approved' ? h('button', { class: 'btn sm', type: 'button', onclick: () => openDoc(x) }, 'المستند') : null))))))) : h('div', { class: 'empty' }, 'لا طلبات مطابقة.'));
  });
  view.replaceChildren(h('div', { class: 'bar' }, search, sel('status', [['pending', 'قيد المراجعة'], ['approved', 'المعتمدة'], ['rejected', 'المرفوضة'], ['cancelled', 'الملغاة'], ['', 'الكل']]), sel('type', [['', 'كل الأنواع'], ...S.meta.types.map(t => [t.id, t.title])])), sumBox, box);
  await load();
}

async function reviewDialog(x, onDone) {
  const d = await api('/' + x.id);
  const rv = d.review; if (!rv) { toast('الطلب لم يعد قيد المراجعة', true); return onDone(); }
  const vals = { ...rv.values }, inputs = {};
  const prev = h('div', { class: 'prev' }, 'جارٍ التحضير…');
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(guard(async () => { prev.textContent = (await api(`/${x.id}/preview`, { method: 'POST', body: { data: vals } })).text.split('\n').map(l => (l.startsWith('# ') ? l.slice(2) : l)).join('\n'); }), 250); };
  const fieldsUi = h('div', { class: 'f2' }, rv.fields.map(f => {
    const el = f.type === 'select' ? h('select', null, (f.options || []).map(o => h('option', { value: o.value, selected: o.value === vals[f.key] }, o.label || o.value)))
      : h('input', { type: f.type === 'date' ? 'date' : 'text', inputmode: f.type === 'number' ? 'decimal' : null, value: vals[f.key] ?? '', placeholder: f.placeholder || '', ...(['national_id', 'iban'].includes(f.key) ? { dir: 'ltr' } : {}) });
    el.addEventListener('input', () => { vals[f.key] = el.value; refresh(); }); inputs[f.key] = el;
    return h('div', null, h('label', { class: 'f' + (f.required ? ' req' : '') }, f.label), el);
  }));
  const note = h('input', { type: 'text', placeholder: 'ملاحظة داخلية أو سبب الرفض', maxlength: 300 });
  const approve = guard(async () => { await api(`/${x.id}/approve`, { method: 'POST', body: { data: vals, note: note.value } }); closeModal(); toast('تم اعتماد الطلب وإصدار المستند المختوم'); await onDone(); });
  const reject = guard(async () => { if (note.value.trim().length < 3) throw new Error('اكتب سبب الرفض في خانة الملاحظة'); await api(`/${x.id}/reject`, { method: 'POST', body: { note: note.value } }); closeModal(); toast('تم رفض الطلب'); await onDone(); });
  modal(`مراجعة ${x.ref_no} — ${x.type_title}`, h('div', null,
    h('div', { class: 'note' }, `الموظف: ${rv.staff.full_name}${rv.staff.emp_no ? ` · رقم ${rv.staff.emp_no}` : ''}${rv.staff.job_title ? ` · ${rv.staff.job_title}` : ''}. راجع البيانات وعدّلها عند الحاجة قبل الاعتماد؛ تُجلب من سجل الموظف والرواتب.`),
    h('div', { class: 'review' }, h('div', null, fieldsUi, h('div', { style: 'margin-top:10px' }, h('label', { class: 'f' }, 'ملاحظة / سبب الرفض'), note)), h('div', null, h('label', { class: 'f' }, 'معاينة المستند'), prev))),
  [h('button', { class: 'btn primary', type: 'button', onclick: approve }, 'اعتماد وإصدار المستند'), h('button', { class: 'btn danger', type: 'button', onclick: reject }, 'رفض الطلب')]);
  refresh();
}

// ---------- التشغيل ----------
const TABS = () => [['mine', 'طلباتي', true],
  ['guarantee', S.meta?.loans?.guarantee_pending ? `طلبات الكفالة (${S.meta.loans.guarantee_pending})` : 'طلبات الكفالة', S.meta?.loans?.guarantee_total > 0],
  ['inbox', S.meta?.pending ? `الطلبات الواردة (${S.meta.pending})` : 'الطلبات الواردة', S.meta?.can.review],
  ['loans', S.meta?.loans?.pending_hr ? `السلف الواردة (${S.meta.loans.pending_hr})` : 'السلف الواردة', S.meta?.can.review]].filter(t => t[2]);
async function show(tab) {
  S.tab = tab; history.replaceState(null, '', '#' + tab);
  document.getElementById('tabs').replaceChildren(...TABS().map(([k, l]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), type: 'button', onclick: () => show(k) }, l)));
  view.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
  try { await ({ mine: mineView, inbox: inboxView, guarantee: () => loans.guaranteeView(), loans: () => loans.inboxView() }[tab])(); } catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
}
loans = createLoans({ h, api, toast, guard, modal, closeModal, confirmBox, fmt, view, S });
try {
  S.meta = await api('/meta');
  const want = location.hash.slice(1);
  await show(TABS().some(t => t[0] === want) ? want : (S.meta.can.review && S.meta.pending ? 'inbox' : 'mine'));
} catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
