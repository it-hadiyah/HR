// بوابة الموارد البشرية: تبويبات تجمع أنظمة الموارد البشرية في صفحة واحدة (كل نظام يعمل بصلاحياته الخاصة)
const $ = id => document.getElementById(id);
const frame = $('frame'), msg = $('msg'), tabs = $('tabs');
let sections = [];

function show(hash) {
  const [slug, qs] = String(hash || '').split('?');   // #hr-forms?emp=12 يفتح النظام مع وسيط (اختيار موظف مسبقاً)
  const s = sections.find(x => x.slug === slug) || sections[0];
  if (!s) return;
  const key = s.slug + (qs ? '?' + qs : '');
  history.replaceState(null, '', '#' + key);
  document.title = `${s.title} | بوابة الموارد البشرية`;
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.slug === s.slug);
  if (frame.dataset.key !== key) { frame.dataset.key = key; frame.src = s.path + (qs && /^[\w=&.-]+$/.test(qs) ? '?' + qs : ''); }
  frame.hidden = false; msg.hidden = true;
}

try {
  const res = await fetch('/api/hr-portal/sections', { credentials: 'same-origin' });
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname); }
  else {
    sections = (await res.json()).sections || [];
    if (!sections.length) { msg.textContent = 'لا تملك صلاحية الدخول لأي نظام من أنظمة الموارد البشرية. تواصل مع مدير النظام.'; msg.hidden = false; }
    else {
      for (const s of sections) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'tab', textContent: s.title });
        b.dataset.slug = s.slug; b.addEventListener('click', () => show(s.slug)); tabs.append(b);
      }
      addEventListener('hashchange', () => { const hh = location.hash.slice(1); if (hh !== (frame.dataset.key || '')) show(hh); });
      show(location.hash.slice(1));
    }
  }
} catch { msg.textContent = 'تعذّر تحميل البوابة. أعد المحاولة.'; msg.hidden = false; }
