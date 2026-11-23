// ملفي الشخصي: بياناتي كما عبّأتها الموارد البشرية (قراءة فقط) + توقيعي الخاص (رسماً أو رفع صورة) للتوقيع داخل المنصة.
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
  const override = ['PUT', 'DELETE', 'PATCH'].includes(method);
  const res = await fetch('/api/my-profile' + path, { method: override ? 'POST' : method, credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(override ? { 'X-HTTP-Method-Override': method } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('انتهت الجلسة'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
const toast = (msg, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : 3500); };
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const view = document.getElementById('view');
const fmt = s => (s ? new Date(s).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ---------- معالجة صورة التوقيع: قصّ الهوامش، شفافية الخلفية، تصغير ----------
function trimAndExport(src, { removeWhite = false } = {}) {
  const w = src.width, ht = src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = ht;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, ht), d = img.data;
  let x0 = w, y0 = ht, x1 = -1, y1 = -1;
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (removeWhite) { const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const a = lum > 235 ? 0 : lum > 190 ? Math.round((235 - lum) / 45 * 255) : 255; d[i + 3] = Math.min(d[i + 3], a); if (a) { d[i] = d[i + 1] = d[i + 2] = Math.min(lum, 40); } }
    if (d[i + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  g.putImageData(img, 0, 0);
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(ht - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, 600 / cw, 220 / ch);
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(cw * k)); o.height = Math.max(1, Math.round(ch * k));
  o.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

function signaturePad(onSave) {
  const canvas = h('canvas', { class: 'pad', width: 900, height: 285, 'aria-label': 'ارسم توقيعك هنا' });
  const g = canvas.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0b2a6f'; g.lineWidth = 4.5;
  let drawing = false, dirty = false, last = null;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; dirty = true; canvas.setPointerCapture(e.pointerId); last = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(last.x + .01, last.y + .01); g.stroke(); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }; g.quadraticCurveTo(last.x, last.y, mid.x, mid.y); g.stroke(); g.beginPath(); g.moveTo(mid.x, mid.y); last = p; });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
  const clear = () => { g.clearRect(0, 0, canvas.width, canvas.height); dirty = false; };
  const save = () => { if (!dirty) return toast('ارسم توقيعك أولاً', true); const url = trimAndExport(canvas); if (!url) return toast('ارسم توقيعك أولاً', true); onSave(url); };
  return h('div', null, canvas, h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'حفظ التوقيع'), h('button', { class: 'btn', type: 'button', onclick: clear }, 'مسح')));
}

function uploadBox(onSave) {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const prev = h('div', { class: 'hint' }, 'اختر صورة لتوقيعك مكتوباً بقلم داكن على ورقة بيضاء، وسنقصّها ونجعل خلفيتها شفافة.');
  let result = null;
  file.addEventListener('change', () => {
    const f = file.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => { const url = trimAndExport(img, { removeWhite: true }); URL.revokeObjectURL(img.src); if (!url) { prev.textContent = 'لم نجد توقيعاً في الصورة'; result = null; return; } result = url; prev.replaceChildren(h('div', { class: 'sigprev' }, h('img', { src: url, alt: 'معاينة التوقيع' }))); };
    img.onerror = () => { prev.textContent = 'تعذّرت قراءة الصورة'; };
    img.src = URL.createObjectURL(f);
  });
  return h('div', null, file, h('div', { style: 'margin:10px 0' }, prev), h('button', { class: 'btn primary', type: 'button', onclick: () => (result ? onSave(result) : toast('اختر صورة أولاً', true)) }, 'حفظ التوقيع'));
}

async function render() {
  const p = await api('/');
  const welcome = new URLSearchParams(location.search).get('welcome');
  const e = p.employee;
  const item = (label, v) => h('div', { class: 'item' }, h('span', null, label), v ? h('b', { dir: ['رقم الهوية', 'الآيبان', 'الجوال'].includes(label) ? 'ltr' : null }, v) : h('b', { class: 'miss' }, 'لم تُعبَّأ بعد'));
  let mode = 'draw';
  const sigBox = h('div');
  const drawSig = () => {
    const onSave = guard(async url => { await api('/signature', { method: 'POST', body: { image: url } }); toast('تم حفظ توقيعك'); await render(); });
    const tabs = h('div', { class: 'tabs2' }, [['draw', 'رسم التوقيع'], ['upload', 'رفع صورة']].map(([k, l]) => h('button', { type: 'button', class: mode === k ? 'on' : '', onclick: () => { mode = k; drawSig(); } }, l)));
    sigBox.replaceChildren(tabs, mode === 'draw' ? signaturePad(onSave) : uploadBox(onSave));
  };
  const cur = h('div', null, h('div', { class: 'sigprev' }, p.signature.has ? h('img', { src: '/api/my-profile/signature?v=' + Date.parse(p.signature.updated_at || 0), alt: 'توقيعي الحالي' }) : h('span', { class: 'hint' }, 'لم تضف توقيعاً بعد')),
    p.signature.has ? h('div', { class: 'hint', style: 'margin-top:6px' }, `آخر تحديث: ${fmt(p.signature.updated_at)}`) : null,
    p.signature.has ? h('button', { class: 'btn sm danger', type: 'button', style: 'margin-top:8px', onclick: guard(async () => { await api('/signature', { method: 'DELETE' }); toast('حُذف التوقيع'); await render(); }) }, 'حذف التوقيع') : null);
  const nodes = [
    welcome ? h('div', { class: 'welcome' }, `مرحباً ${p.account.full_name} 👋 راجع بياناتك أدناه كما عبّأتها الموارد البشرية، ثم أضف توقيعك الخاص لتوقّع به على طلباتك داخل المنصة.`) : null,
    h('div', { class: 'hero' }, h('div', { class: 'avatar' }, [...(e?.full_name || p.account.full_name)][0] || '؟'), h('div', null, h('h2', null, e?.full_name || p.account.full_name), h('div', { class: 'sub' }, e ? [e.job_title, e.emp_no ? `رقم ${e.emp_no}` : ''].filter(Boolean).join(' · ') : `حساب: ${p.account.username}`))),
    e ? h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'بياناتي الوظيفية والشخصية'),
      h('div', { class: 'grid3' }, item('الاسم', e.full_name), item('الرقم الوظيفي', e.emp_no), item('المسمى الوظيفي', e.job_title), item('القطاع', e.sector), item('الإدارة', e.department), item('القسم', e.section),
        item('تاريخ التعيين', e.hire_date), item('الجنسية', e.nationality), item('رقم الهوية', e.national_id), item('الآيبان', e.iban), item('الجوال', e.phone)),
      h('p', { class: 'hint', style: 'margin-top:10px' }, 'هذه البيانات تعبئها الموارد البشرية وتُستخدم في خطاباتك وطلباتك. إن وجدت خطأً أو نقصاً فتواصل مع الموارد البشرية لتصحيحه.'),
      e.lacking.length ? h('div', { class: 'note' }, 'بيانات ناقصة: ' + e.lacking.join('، ')) : null,
      h('div', { class: 'actions', style: 'margin-top:8px' }, p.confirmed_at ? h('span', { class: 'okline' }, `✔ أكّدتَ صحة بياناتك في ${fmt(p.confirmed_at)}`) : h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { await api('/confirm', { method: 'POST' }); toast('تم تأكيد بياناتك'); await render(); }) }, 'أؤكد صحة بياناتي')))
      : h('div', { class: 'note' }, 'حسابك غير مرتبط بسجل موظف بعد. تواصل مع الموارد البشرية لربط حسابك برقمك الوظيفي لتظهر بياناتك هنا.'),
    h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'توقيعي الخاص'),
      h('p', { class: 'hint' }, 'يُستخدم توقيعك عند توقيعك على الطلبات والخطابات داخل المنصة (مثل طلب السلفة والكفالة)، ويُؤخذ منه نسخة ثابتة عند كل توقيع. لا يراه غيرك إلا على المستندات التي توقّعها.'),
      h('div', { class: 'sigcard' }, sigBox, cur)),
  ].filter(Boolean);
  view.replaceChildren(...nodes);
  drawSig();
}
try { await render(); } catch (e) { view.replaceChildren(h('div', { class: 'card' }, e.message)); }
