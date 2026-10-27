import { icon } from '/shared/icons.js';
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

const TARGETS = { '/hr/': 'نظام الأرصدة', '/report/': 'نظام التقارير', '/card/': 'بطاقة الموظف', '/portal/admin/': 'لوحة تحكم البوابة', '/admin/': 'الإدارة المركزية' };

function showLogin() {
  $('home').hidden = true; $('login').hidden = false;
  const n = nextUrl();
  const name = n && Object.entries(TARGETS).find(([k]) => n.startsWith(k))?.[1];
  $('target').hidden = !name;
  if (name) $('target').textContent = `الدخول إلى: ${name}`;
}

async function showHome() {
  const { user, apps } = await api('/launcher');
  $('login').hidden = true; $('home').hidden = false;
  $('whoName').textContent = `${user.employee?.full_name || user.full_name} — ${user.role_label}`;
  $('hello').textContent = `مرحباً ${user.employee?.full_name || user.full_name}، اختر النظام الذي تريد الدخول إليه:`;
  const box = $('apps');
  box.replaceChildren();
  if (!apps.length) { box.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'لا توجد أنظمة متاحة لحسابك. تواصل مع مدير النظام.' })); }
  for (const a of apps) {
    const el = Object.assign(document.createElement('a'), { className: 'app', href: a.path });
    const ic = Object.assign(document.createElement('div'), { className: 'ic' });
    ic.innerHTML = icon(a.icon, 26);
    el.append(ic, Object.assign(document.createElement('h3'), { textContent: a.title }), Object.assign(document.createElement('p'), { textContent: a.description || '' }));
    box.append(el);
  }
}

$('showPw').addEventListener('click', () => {
  const show = $('p').type === 'password';
  $('p').type = show ? 'text' : 'password';
  $('showPw').textContent = show ? 'إخفاء' : 'إظهار';
  $('showPw').setAttribute('aria-pressed', show);
});

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('err').textContent = '';
  const btn = e.submitter || document.querySelector('.primary');
  btn.disabled = true;
  try {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    const next = nextUrl();
    if (next) { location.href = next; return; }
    await showHome();
  } catch (err) { $('err').textContent = err.message; } finally { btn.disabled = false; }
});
$('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); showLogin(); });
try { await api('/auth/me'); const next = nextUrl(); if (next) location.href = next; else await showHome(); }
catch { showLogin(); }
