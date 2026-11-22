// صفحة المستند المعتمد: ورقة رسمية مختومة جاهزة للطباعة أو الحفظ PDF
const id = new URLSearchParams(location.search).get('id');
const doc = document.getElementById('doc'), bar = document.getElementById('bar');
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
try {
  if (!/^\d+$/.test(id || '')) throw new Error('رقم الطلب غير صالح');
  const [dRes, mRes] = await Promise.all([fetch(`/api/hr-requests/${id}/document`, { credentials: 'same-origin' }), fetch('/api/hr-requests/meta', { credentials: 'same-origin' })]);
  if (dRes.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); }
  const d = await dRes.json(); if (!dRes.ok) throw new Error(d.error || 'تعذّر تحميل المستند');
  const meta = await mRes.json().catch(() => ({}));
  document.title = `${d.type_title} — ${d.ref_no}`;
  const paper = el('div', 'paper');
  for (const line of d.text.split('\n')) paper.append(line.startsWith('# ') ? el('h2', '', line.slice(2)) : line.trim() ? el('p', '', line) : el('div', 'gap'));
  if (d.stamp) { const s = el('img', 'stamp'); s.src = `/api/hr-requests/stamp?v=${d.stamp_version}`; s.alt = 'الختم الرسمي'; paper.append(s); }
  paper.append(el('div', 'ref', `رقم المستند: ${d.ref_no} · رمز التحقق: ${d.code}`));
  doc.replaceChildren(paper);
  const btn = (txt, cls, fn) => { const b = el('button', 'btn ' + cls, txt); b.type = 'button'; b.addEventListener('click', fn); return b; };
  bar.replaceChildren(btn('طباعة / حفظ PDF', 'primary', () => window.print()),
    meta.pdf ? btn('تنزيل PDF', '', () => { location.href = `/api/hr-requests/${id}/pdf`; }) : el('span', 'hint', 'لحفظ ملف PDF: اختر «حفظ كـ PDF» من نافذة الطباعة'),
    btn('رجوع', '', () => { history.length > 1 ? history.back() : (location.href = '/hr-requests/'); }));
} catch (e) { doc.replaceChildren(el('div', 'loading', e.message)); }
