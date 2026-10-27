// شريط تنقل عائم يُحقن في كل نظام: العودة إلى الصفحة الموحّدة والتنقل بين الأنظمة وتسجيل الخروج
(async () => {
  if (window.top !== window.self || document.getElementById('hd-appbar')) return;
  let data;
  try {
    const r = await fetch('/api/launcher', { credentials: 'same-origin' });
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }

  const host = document.createElement('div');
  host.id = 'hd-appbar';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    .w{position:fixed;left:14px;bottom:14px;z-index:2147483000;font:14px/1.6 Tahoma,Arial,sans-serif;direction:rtl}
    button{font:inherit;cursor:pointer}
    .fab{background:#0d7868;color:#fff;border:2px solid #bb9a5f;border-radius:999px;padding:8px 16px;box-shadow:0 4px 14px rgba(0,0,0,.25);font-weight:700}
    .menu{position:absolute;left:0;bottom:calc(100% + 8px);min-width:230px;background:#fff;color:#1d2b28;border:1px solid #e3e8e6;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:8px;display:none}
    .menu.open{display:block}
    .who{padding:6px 10px 8px;border-bottom:1px solid #e3e8e6;margin-bottom:6px;font-size:12px;color:#66767a}
    a{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;color:inherit;text-decoration:none}
    a:hover{background:#e9f5f3}
    a.cur{background:#e9f5f3;font-weight:700}
    .out{width:100%;margin-top:6px;border:0;background:none;color:#b3261e;padding:8px 10px;text-align:right;border-radius:8px}
    .out:hover{background:#fdecea}
    @media print{.w{display:none}}
  </style>
  <div class="w">
    <div class="menu" id="m"></div>
    <button class="fab" id="b" aria-haspopup="true" aria-expanded="false">☰ المنصة</button>
  </div>`;
  const menu = root.getElementById('m'), btn = root.getElementById('b');
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = `${data.user.full_name} — ${data.user.role_label}`;
  menu.append(who);
  const home = Object.assign(document.createElement('a'), { href: '/', textContent: '🏠 الصفحة الرئيسية للمنصة' });
  menu.append(home);
  for (const a of data.apps) {
    const el = Object.assign(document.createElement('a'), { href: a.path, textContent: `${a.icon || ''} ${a.title}` });
    if (location.pathname.startsWith(a.path)) el.className = 'cur';
    menu.append(el);
  }
  const out = Object.assign(document.createElement('button'), { className: 'out', textContent: 'تسجيل الخروج' });
  out.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/'; });
  menu.append(out);
  btn.addEventListener('click', () => { const o = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
  document.addEventListener('click', e => { if (!host.contains(e.target)) menu.classList.remove('open'); });
  document.body.append(host);
})();
