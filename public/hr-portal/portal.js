// بوابة الموارد البشرية: تبويبات تجمع أنظمة الموارد البشرية في صفحة واحدة (كل نظام يعمل بصلاحياته الخاصة)
const $ = id => document.getElementById(id);
const frame = $('frame'), msg = $('msg'), tabs = $('tabs');
let sections = [];

function show(slug) {
  const s = sections.find(x => x.slug === slug) || sections[0];
  if (!s) return;
  history.replaceState(null, '', '#' + s.slug);
  document.title = `${s.title} | بوابة الموارد البشرية`;
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.slug === s.slug);
  if (frame.dataset.slug !== s.slug) { frame.dataset.slug = s.slug; frame.src = s.path; }
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
      addEventListener('hashchange', () => show(location.hash.slice(1)));
      show(location.hash.slice(1));
    }
  }
} catch { msg.textContent = 'تعذّر تحميل البوابة. أعد المحاولة.'; msg.hidden = false; }
