import { h, state, api, field, guard } from './core.js';
import { resetUnits } from './filters.js';
import dashboard from './pages/dashboard.js';
import org from './pages/org.js';
import employees, { employeeDetail } from './pages/employees.js';
import leaves from './pages/leaves.js';
import targets from './pages/targets.js';
import analysis from './pages/analysis.js';
import reports from './pages/reports.js';
import importPage from './pages/import.js';
import admin from './pages/admin.js';

const ICONS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  org: 'M12 3v4M5 21v-6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6M12 7v5M3 21h4M17 21h4M10 21h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  calendar: 'M3 8h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  chart: 'M3 3v18h18M7 14l4-4 3 3 5-6',
  report: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ICONS.chart); s.append(p);
  return s;
}

const NAV = [
  ['#/', 'لوحة المعلومات', 'dashboard'],
  ['#/org', 'الهيكل التنظيمي', 'org'],
  ['#/employees', 'الموظفون', 'users'],
  ['#/leaves', 'حركات الإجازات', 'calendar'],
  ['#/targets', 'المستهدفات', 'target'],
  ['#/analysis', 'التحليل والتنبيهات', 'chart'],
  ['#/reports', 'التقارير', 'report'],
  ['#/import', 'الاستيراد والتصدير', 'upload', u => u.perms.includes('import')],
  ['#/admin', 'الإدارة والإعدادات', 'settings'],
];
const TITLES = { '': 'لوحة المعلومات', org: 'الهيكل التنظيمي', employees: 'الموظفون', leaves: 'حركات الإجازات', targets: 'المستهدفات', analysis: 'التحليل والتنبيهات',
  reports: 'التقارير', import: 'الاستيراد والتصدير', admin: 'الإدارة والإعدادات', employee: 'بيانات الموظف' };
const PAGES = { '': dashboard, org, employees, leaves, targets, analysis, reports, import: importPage, admin };

const app = document.getElementById('app');

// ---- المظهر ----
const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
applyTheme(localStorage.getItem('theme'));

function loginView() {
  const u = h('input', { id: 'u', autocomplete: 'username', required: true, autofocus: true });
  const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'err', role: 'alert' });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('/auth/login', { method: 'POST', body: { username: u.value, password: p.value } }); await boot(); location.hash = '#/'; } catch (ex) { err.textContent = ex.message; }
  } },
  h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('calendar')), 'منصة أرصدة الإجازات'),
  h('p', { style: { color: 'var(--muted)', marginTop: 0 } }, 'سجّل الدخول لإدارة أرصدة الإجازات وتحليل التزاماتها المالية'),
  h('div', { class: 'grid', style: { gap: '12px' } }, field('اسم المستخدم', u), field('كلمة المرور', p), err, h('button', { class: 'btn primary', style: { justifyContent: 'center' } }, 'دخول')));
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, form)));
}

function shell() {
  const side = h('aside', { class: 'sidebar', id: 'side' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('calendar')), h('span', null, 'أرصدة الإجازات')),
    h('nav', { class: 'nav' }, NAV.filter(n => !n[3] || n[3](state.user)).map(([href, label, ic]) => h('a', { href, 'data-href': href }, icon(ic), label))),
    h('div', { class: 'spacer' }),
    h('div', { class: 'nav-sep' }),
    h('div', { style: { padding: '4px 10px', fontSize: '12.5px', color: 'var(--muted)' } }, h('b', { style: { color: 'var(--text)', display: 'block' } }, state.user.full_name), state.user.role_label));
  const title = h('h1', { id: 'title' });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'btn icon-btn menu-btn', 'aria-label': 'القائمة', onclick: () => side.classList.toggle('open') }, icon('menu')),
    title, h('div', { class: 'grow' }),
    h('button', { class: 'btn sm', title: 'عرض التواريخ بالهجري/الميلادي', onclick: () => { state.hijri = !state.hijri; localStorage.setItem('hijri', state.hijri ? '1' : '0'); route(); } }, state.hijri ? 'هجري' : 'ميلادي'),
    h('button', { class: 'btn icon-btn', 'aria-label': 'تبديل الوضع الداكن', onclick: () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', n); applyTheme(n); route(); } }, icon('moon')),
    h('button', { class: 'btn icon-btn', 'aria-label': 'تسجيل الخروج', onclick: guard(async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; location.hash = '#/login'; }) }, icon('logout')));
  const page = h('main', { class: 'page', id: 'page' });
  app.replaceChildren(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, page)));
  side.addEventListener('click', e => { if (e.target.closest('a')) side.classList.remove('open'); });
}

let routeSeq = 0;
async function route() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/login')) { loginView(); return; }
  if (!state.user) { try { await boot(); } catch { loginView(); return; } }
  if (!document.getElementById('page')) shell();
  const parts = hash.replace(/^#\/?/, '').split('/');
  const key = parts[0].split('?')[0];
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.href === (key ? '#/' + key : '#/') || (key === 'employee' && a.dataset.href === '#/employees')));
  document.getElementById('title').textContent = TITLES[key] || 'منصة أرصدة الإجازات';
  document.title = (TITLES[key] || '') + ' — منصة أرصدة الإجازات';
  const page = document.getElementById('page');
  const seq = ++routeSeq;
  page.replaceChildren(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
  try {
    const out = key === 'employee' ? await employeeDetail(+parts[1]) : await (PAGES[key] || dashboard)(parts.slice(1));
    if (seq === routeSeq) page.replaceChildren(out);
  } catch (e) {
    if (seq === routeSeq) page.replaceChildren(h('div', { class: 'card err' }, 'تعذّر تحميل الصفحة: ', e.message));
  }
}

async function boot() { state.user = await api('/auth/me'); resetUnits(); shell(); }

window.addEventListener('hashchange', route);
route();
export { route };
