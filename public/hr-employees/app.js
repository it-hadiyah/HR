// إدارة الموظفين: سجل واحد لبيانات الموظفين يغذّي أرصدة الإجازات ونماذج الموارد البشرية والرواتب والإضافي.
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
  const override = ['PUT', 'DELETE', 'PATCH'].includes(method);   // يتجاوز حجب IIS/WebDAV لهذه الأفعال
  const res = await fetch('/api/hr-employees' + path, { method: override ? 'POST' : method, credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(override ? { 'X-HTTP-Method-Override': method } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('انتهت الجلسة'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
const toast = (msg, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const view = document.getElementById('view');
const S = { units: [], can: {}, titles: [], status: 'active', q: '', unit: '', missing: '' };
const TYPE = { sector: 'قطاع', department: 'إدارة', section: 'قسم', org: 'المنشأة' };

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

// قائمة الوحدات بمسافة بادئة حسب العمق
function unitOptions() {
  const kids = new Map(); for (const u of S.units) (kids.get(u.parent_id) ?? kids.set(u.parent_id, []).get(u.parent_id)).push(u);
  const out = []; const walk = (pid, d) => { for (const u of kids.get(pid) || []) { out.push([u.id, `${'— '.repeat(d)}${u.name}${u.unit_type !== 'org' ? ` (${TYPE[u.unit_type] || ''})` : ''}`]); walk(u.id, d + 1); } };
  const ids = new Set(S.units.map(u => u.id));
  for (const u of S.units) if (!ids.has(u.parent_id)) { out.push([u.id, u.name]); walk(u.id, 1); }
  return out;
}

function editDialog(emp, onSaved) {
  const e = emp || {};
  const field = (key, label, { type = 'text', placeholder, ltr, list, req, full, disabled } = {}) => {
    const el = h('input', { type, value: e[key] ?? '', placeholder, autocomplete: 'off', list, disabled, ...(ltr ? { dir: 'ltr' } : {}) });
    return { el, node: h('div', { class: full ? 'full' : '' }, h('label', { class: 'f' + (req ? ' req' : '') }, label), el) };
  };
  const name = field('full_name', 'الاسم', { req: true, full: true }), no = field('emp_no', 'الرقم الوظيفي'), title = field('job_title', 'المسمى الوظيفي', { list: 'titles-dl' });
  const hire = field('hire_date', 'تاريخ التعيين', { type: 'date' }), nat = field('nationality', 'الجنسية', { placeholder: 'سعودي' }), phone = field('phone', 'الجوال', { ltr: true, placeholder: '05xxxxxxxx' });
  const sens = S.can.sensitive;
  const nid = field('national_id', 'رقم الهوية', { ltr: true, placeholder: sens ? '10 أرقام' : 'يتطلب صلاحية', disabled: !sens }), iban = field('iban', 'الآيبان (IBAN)', { ltr: true, placeholder: sens ? 'SA…' : 'يتطلب صلاحية', disabled: !sens });
  if (!sens && emp) { nid.el.value = emp.national_id || ''; iban.el.value = emp.iban || ''; }
  const unit = h('select', null, [['', '— بدون وحدة —'], ...unitOptions()].map(([v, l]) => h('option', { value: v, selected: String(v) === String(e.org_unit_id ?? '') }, l)));
  const dl = h('datalist', { id: 'titles-dl' }, S.titles.map(t => h('option', { value: t })));
  const save = guard(async () => {
    const body = { full_name: name.el.value, emp_no: no.el.value, job_title: title.el.value, hire_date: hire.el.value, nationality: nat.el.value, phone: phone.el.value, org_unit_id: unit.value };
    if (sens) { body.national_id = nid.el.value; body.iban = iban.el.value; }
    if (emp) body.version = emp.version;
    const out = await api(emp ? '/' + emp.id : '/', { method: emp ? 'PUT' : 'POST', body });
    closeModal(); toast(emp ? 'تم حفظ التعديلات' : 'تمت إضافة الموظف'); onSaved?.(out.row);
  });
  modal(emp ? `تعديل — ${emp.full_name}` : 'إضافة موظف', h('div', null, dl,
    h('div', { class: 'f2' }, name.node, no.node, title.node, h('div', { class: 'full' }, h('label', { class: 'f' }, 'الوحدة التنظيمية'), unit), hire.node, nat.node, phone.node, nid.node, iban.node),
    !sens ? h('p', { class: 'hint' }, 'رقم الهوية والآيبان لا يُعدَّلان إلا بصلاحية «رؤية وتعديل رقم الهوية والآيبان».') : null),
  [S.can.edit ? h('button', { class: 'btn primary', type: 'button', onclick: save }, 'حفظ') : null]);
}

async function render() {
  const box = h('div'), kpis = h('div', { class: 'kpis' });
  let rows = [];
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرقم الوظيفي أو المسمى أو الهوية…', value: S.q, 'aria-label': 'بحث' });
  const statusSel = h('select', { 'aria-label': 'الحالة', onchange: ev => { S.status = ev.target.value; load(); } }, [['active', 'النشطون'], ['archived', 'المؤرشفون'], ['all', 'الكل']].map(([v, l]) => h('option', { value: v, selected: v === S.status }, l)));
  const unitSel = h('select', { 'aria-label': 'الوحدة', onchange: ev => { S.unit = ev.target.value; load(); } }, [['', 'كل الوحدات'], ...unitOptions()].map(([v, l]) => h('option', { value: v, selected: String(v) === S.unit }, l)));
  const missSel = h('select', { 'aria-label': 'اكتمال البيانات', onchange: ev => { S.missing = ev.target.value; load(); } }, [['', 'كل السجلات'], ['any', 'ناقصة البيانات']].map(([v, l]) => h('option', { value: v, selected: v === S.missing }, l)));
  let timer; search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.q = search.value.trim(); load(); }, 300); });

  function draw(totals) {
    kpis.replaceChildren(
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, 'عدد السجلات'), h('div', { class: 'v' }, String(totals.count))),
      h('div', { class: 'kpi ' + (totals.incomplete ? 'warn' : 'ok') }, h('div', { class: 'l' }, 'ناقصة البيانات'), h('div', { class: 'v' }, String(totals.incomplete)), h('div', { class: 'h' }, 'تنقصها الهوية أو الآيبان أو التعيين أو الوحدة…')));
    const act = x => h('div', { class: 'row-acts' },
      S.can.edit ? h('button', { class: 'btn sm', type: 'button', onclick: () => editDialog(x, load) }, 'تعديل') : null,
      x.status === 'active' ? h('a', { class: 'btn sm', href: '#', title: 'إصدار نموذج لهذا الموظف', onclick: ev => { ev.preventDefault(); const t = window.top; if (t !== window) t.location.hash = `#hr-forms?emp=${x.id}`; else location.href = `/hr-forms/?emp=${x.id}`; } }, 'إصدار نموذج') : null,
      S.can.archive ? h('button', { class: 'btn sm', type: 'button', onclick: () => confirmBox(x.status === 'active' ? `أرشفة «${x.full_name}»؟ يبقى سجله وبياناته ويُستثنى من القوائم النشطة.` : `استعادة «${x.full_name}»؟`, async () => { await api(`/${x.id}/${x.status === 'active' ? 'archive' : 'restore'}`, { method: 'POST' }); toast(x.status === 'active' ? 'تمت الأرشفة' : 'تمت الاستعادة'); await load(); }, false) }, x.status === 'active' ? 'أرشفة' : 'استعادة') : null,
      S.can.delete ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirmBox(`حذف «${x.full_name}» نهائياً؟ لا يُسمح بذلك إن كانت له أرصدة أو رواتب أو إضافي (أرشفه حينها).`, async () => { await api('/' + x.id, { method: 'DELETE' }); toast('تم الحذف'); await load(); }) }, 'حذف') : null);
    box.replaceChildren(rows.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['#', 'الموظف', 'الوحدة', 'تاريخ التعيين', 'الجنسية', 'رقم الهوية', 'الآيبان', 'مرتبط بـ', ''].map(t => h('th', null, t)))),
      h('tbody', null, rows.map((x, i) => h('tr', { class: x.status === 'archived' ? 'arch' : '' },
        h('td', null, String(i + 1)),
        h('td', null, h('b', null, x.full_name), h('span', { class: 'row-sub' }, [x.emp_no ? `رقم ${x.emp_no}` : '', x.job_title].filter(Boolean).join(' · ')), x.lacking.length ? h('div', null, x.lacking.map(l => h('span', { class: 'pill' }, 'ينقص: ' + l))) : null),
        h('td', null, [x.sector, x.department, x.section].filter(Boolean).join(' ‹ ') || '—'),
        h('td', null, x.hire_date || '—'), h('td', null, x.nationality || '—'),
        h('td', null, h('span', { class: x.masked ? 'mask' : '', dir: 'ltr' }, x.national_id || '—')), h('td', null, h('span', { class: x.masked ? 'mask' : '', dir: 'ltr' }, x.iban || '—')),
        h('td', null, [x.has_leave ? h('span', { class: 'badge ok' }, 'أرصدة') : null, x.has_salary ? h('span', { class: 'badge ok' }, 'رواتب') : null]),
        h('td', null, act(x))))))) : h('div', { class: 'empty' }, 'لا توجد سجلات مطابقة.'));
  }
  const load = guard(async () => {
    const qs = new URLSearchParams({ status: S.status, q: S.q, ...(S.unit ? { unit: S.unit } : {}), ...(S.missing ? { missing: S.missing } : {}) });
    const d = await api('/?' + qs); rows = d.rows; draw(d.totals);
  });
  view.replaceChildren(h('div', { class: 'bar' }, search, statusSel, unitSel, missSel, h('div', { class: 'sp' }),
    S.can.edit ? h('button', { class: 'btn primary', type: 'button', onclick: () => editDialog(null, load) }, '+ إضافة موظف') : null,
    h('button', { class: 'btn', type: 'button', onclick: () => { location.href = `/api/hr-employees/export?status=${S.status}`; } }, 'تصدير Excel')), kpis, box);
  await load();
}

try {
  const m = await api('/meta');
  Object.assign(S, { units: m.units, can: m.can, titles: m.job_titles });
  if (!S.can.view) view.replaceChildren(h('div', { class: 'card' }, 'لا تملك صلاحية عرض الموظفين. تواصل مع مدير النظام.'));
  else await render();
} catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
