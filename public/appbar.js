// قائمة التنقل الموحّدة: مكوّن مشترك يُحقن في كل نظام (البوابة، الإجازات، البطاقة، التقارير، الإدارة).
// تعديله هنا مرة واحدة يغيّر القائمة في كل الصفحات. الأيقونات من Lucide عبر /shared/icons.js (بدون emoji).
(async () => {
  if (window.top !== window.self || document.getElementById('hd-appbar')) return;
  let data = null, icons;
  try {
    const [r, mod] = await Promise.all([fetch('/api/launcher', { credentials: 'same-origin' }), import('/shared/icons.js')]);
    icons = mod;
    if (r.ok) data = await r.json();            // بلا جلسة يظهر الزر للزائر ويعرض خيار تسجيل الدخول
    else if (r.status !== 401) return;
  } catch { return; }
  const { icon } = icons;

  const host = document.createElement('div');
  host.id = 'hd-appbar';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    *{box-sizing:border-box}
    .w{position:fixed;left:16px;bottom:16px;z-index:2147483000;font:14px/1.6 "IBM Plex Sans Arabic",Tahoma,"Segoe UI",system-ui,sans-serif;direction:rtl;color:var(--fg)}
    :host,.w{--bg:#fff;--fg:#16302d;--muted:#6b7c79;--line:#e3ebe9;--hover:#eef6f4;--accent:#007a6e;--accent-bg:#e4f4f1;--danger:#b3261e;--danger-bg:#fdecea;--shadow:0 12px 32px rgba(5,40,36,.18),0 2px 6px rgba(5,40,36,.08)}
    @media (prefers-color-scheme:dark){.w{--bg:#14211f;--fg:#e7f0ee;--muted:#93a7a3;--line:#26413d;--hover:#1c302d;--accent:#4fd1bf;--accent-bg:#17332f;--danger:#ff9a90;--danger-bg:#3a1f1d;--shadow:0 12px 32px rgba(0,0,0,.5)}}
    button,a{font:inherit;color:inherit}
    .fab{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 16px 0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:#054d45;color:#fff;cursor:pointer;
      box-shadow:var(--shadow);font-weight:600;transition:background .15s,transform .15s}
    .fab:hover{background:#007a6e}
    .fab:focus-visible,.item:focus-visible{outline:2px solid #4fd1bf;outline-offset:2px}
    .fab svg{flex:none}
    .menu{position:absolute;left:0;bottom:calc(100% + 10px);width:272px;max-height:min(78vh,560px);overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:6px;
      transform-origin:bottom left;opacity:0;transform:translateY(6px) scale(.98);pointer-events:none;visibility:hidden;transition:opacity .12s ease,transform .12s ease,visibility 0s .12s}
    .menu.open{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .12s ease,transform .12s ease}
    .head{display:flex;align-items:center;gap:10px;padding:10px 10px 12px}
    .av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--accent-bg);color:var(--accent);display:grid;place-items:center;font-weight:700}
    .who{min-width:0}
    .who b{display:block;font-size:.95em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .who span{display:block;color:var(--muted);font-size:.82em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cta{display:flex;flex-direction:column;gap:10px;padding:12px 12px 10px;text-align:right}
    .cta p{margin:0;color:var(--muted);font-size:.9em}
    .btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
    .btn:hover{filter:brightness(.92)}
    @media (prefers-color-scheme:dark){.btn{color:#06332d}}
    .sep{height:1px;background:var(--line);margin:4px 6px}
    .lbl{padding:8px 10px 4px;color:var(--muted);font-size:.75em;font-weight:600;letter-spacing:.02em}
    .item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;background:none;border-radius:9px;text-align:right;text-decoration:none;cursor:pointer;color:var(--fg)}
    .item:hover{background:var(--hover)}
    .item .ic{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--hover);color:var(--accent)}
    .item.cur{background:var(--accent-bg);font-weight:600}
    .item.cur .ic{background:var(--bg)}
    .item .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .item .ck{flex:none;color:var(--accent)}
    .item.out{color:var(--danger)}
    .item.out .ic{background:var(--danger-bg);color:var(--danger)}
    .item.out:hover{background:var(--danger-bg)}
    @media (max-width:480px){.w{left:12px;right:12px;bottom:12px}.menu{width:auto;left:0;right:0}.fab{width:100%;justify-content:center}}
    @media (prefers-reduced-motion:reduce){.menu,.menu.open,.fab{transition:none}}
    @media print{.w{display:none}}
  </style>
  <div class="w">
    <div class="menu" id="m" role="menu" aria-label="قائمة المنصات"></div>
    <button class="fab" id="b" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="m">${icon('layout-grid', 18)}<span>المنصة</span></button>
  </div>`;

  const menu = root.getElementById('m'), btn = root.getElementById('b');
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  if (!data) {
    const next = encodeURIComponent(location.pathname + location.search);
    const cta = el('div', 'cta', `<p>سجّل الدخول لرؤية المنصات الأخرى والتنقل بينها.</p><a class="btn" role="menuitem" href="/login/?next=${next}">${icon('log-in', 17)}<span>تسجيل الدخول</span></a>`);
    menu.append(cta);
  } else {
  const u = data.user;
    const name = u.employee?.full_name || u.full_name;
    const head = el('div', 'head', `<div class="av">${esc([...name][0] || '؟')}</div><div class="who"><b>${esc(name)}</b><span>${esc(u.role_label)}</span></div>`);
    menu.append(head, el('div', 'sep'), el('div', 'lbl', 'المنصات'));
  
    const here = [...data.apps].sort((a, b) => b.path.length - a.path.length).find(a => location.pathname.startsWith(a.path));
    for (const a of data.apps) {
      const link = el('a', 'item' + (a === here ? ' cur' : ''), `<span class="ic">${icon(a.icon, 17)}</span><span class="t">${esc(a.title)}</span>${a === here ? `<span class="ck">${icon('check', 16)}</span>` : ''}`);
      link.href = a.path; link.setAttribute('role', 'menuitem'); if (a === here) link.setAttribute('aria-current', 'page');
      menu.append(link);
    }
    menu.append(el('div', 'sep'), el('div', 'lbl', 'الحساب'));
    const home = el('a', 'item', `<span class="ic">${icon('house', 17)}</span><span class="t">الصفحة الرئيسية للمنصة</span>`);
    home.href = '/login/'; home.setAttribute('role', 'menuitem');
    const out = el('button', 'item out', `<span class="ic">${icon('log-out', 17)}</span><span class="t">تسجيل الخروج</span>`);
    out.type = 'button'; out.setAttribute('role', 'menuitem');
    out.addEventListener('click', async () => { try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } finally { location.href = '/portal/'; } });
    menu.append(home, out);
  
    }
  const items = () => [...menu.querySelectorAll('.item')];
  const open = () => { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); (menu.querySelector('.item.cur') || items()[0])?.focus(); };
  const close = (refocus = true) => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); };
  btn.addEventListener('click', () => (menu.classList.contains('open') ? close() : open()));
  document.addEventListener('pointerdown', e => { if (menu.classList.contains('open') && !e.composedPath().includes(host)) close(false); });
  root.addEventListener('keydown', e => {
    if (!menu.classList.contains('open')) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = items(), i = list.indexOf(root.activeElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
    }
  });
  document.body.append(host);
})();
