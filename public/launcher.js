const $ = id => document.getElementById(id);
const api = async (path, opt) => {
  const res = await fetch('/api' + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opt });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'حدث خطأ'), { status: res.status });
  return data;
};
// يمنع إعادة التوجيه إلى مواقع خارجية بعد الدخول
const nextUrl = () => {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
};

function showLogin() {
  $('home').hidden = true; $('who').hidden = true; $('login').hidden = false;
}

async function showHome() {
  const { user, apps } = await api('/launcher');
  $('login').hidden = true; $('home').hidden = false; $('who').hidden = false;
  $('whoName').textContent = `${user.person?.full_name || user.full_name} — ${user.role_label}`;
  $('hello').textContent = `مرحباً ${user.person?.full_name || user.full_name}، اختر النظام الذي تريد الدخول إليه:`;
  const box = $('apps');
  box.replaceChildren();
  if (!apps.length) { box.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'لا توجد أنظمة متاحة لحسابك. تواصل مع مدير النظام.' })); }
  for (const a of apps) {
    const el = Object.assign(document.createElement('a'), { className: 'app', href: a.path });
    const ic = Object.assign(document.createElement('div'), { className: 'ic', textContent: a.icon || '📁' });
    el.append(ic, Object.assign(document.createElement('h3'), { textContent: a.title }), Object.assign(document.createElement('p'), { textContent: a.description || '' }));
    box.append(el);
  }
  if (['admin', 'hr'].includes(user.role)) { $('linkBox').hidden = false; refreshLinks(); }
}

async function refreshLinks() {
  try {
    const s = await api('/people/link-status');
    $('linkStat').textContent = `مربوط: ${s.linked} — موظفون بلا ربط: ${s.unlinked_employees.length} — أشخاص في الدليل بلا ربط: ${s.unlinked_people.length}`;
  } catch { $('linkStat').textContent = ''; }
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('err').textContent = '';
  try {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    const next = nextUrl();
    if (next) { location.href = next; return; }
    await showHome();
  } catch (err) { $('err').textContent = err.message; }
});
$('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); showLogin(); });
$('autoLink').addEventListener('click', async () => {
  const r = await api('/people/auto-link', { method: 'POST', body: '{}' });
  $('linkMsg').textContent = `تم ربط ${r.linked} موظفاً، وبقي ${r.unmatched_employees} بلا تطابق (يمكن ربطهم يدوياً).`;
  refreshLinks();
});

try { await api('/auth/me'); const next = nextUrl(); if (next) location.href = next; else await showHome(); }
catch { showLogin(); }
