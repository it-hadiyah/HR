// معرض القوالب: بطاقات بمعاينة مصغّرة حقيقية لكل قالب، مع بحث وتصنيف
import { el, btn, $ } from './ui.js';
import { icon } from './icons.js';
import * as T from './templates.js';
import { renderPayload, config } from './preview.js';
import { store } from './store.js';
import { buildTemplateGallery } from './template-gallery.js';

const favKey = () => 'rb-fav:' + (store.user || '');
const readFavs = () => { try { return new Set(JSON.parse(localStorage.getItem(favKey()) || '[]')); } catch (e) { return new Set(); } };
const writeFavs = (set) => { try { localStorage.setItem(favKey(), JSON.stringify(Array.from(set))); } catch (e) { /* ignore */ } };

const thumbs = new Map(); // contentWindow -> { tpl, page }
let msgBound = false;

function bindMessages() {
  if (msgBound) return; msgBound = true;
  window.addEventListener('message', (e) => {
    const t = thumbs.get(e.source);
    if (!t || !e.data || e.data.type !== 'ready') return;
    const report = T.createReport(t.tpl.id, { sample: true });
    report.employee = 'اسم الموظف'; report.department = 'اسم الإدارة';
    e.source.postMessage(Object.assign(renderPayload(report, { preview: false, noMark: true }), { zoom: 1 }), '*');
    setTimeout(() => { t.card.classList.add('loaded'); gotoThumb(t); }, 450);
  });
}

const contentPage = (tpl) => 2 + (tpl.toc ? 1 : 0);
function gotoThumb(t) { t.frame.contentWindow.postMessage({ type: 'goto', page: t.page === 'cover' ? 1 : contentPage(t.tpl), instant: true }, '*'); }

function fitThumb(card) {
  const wrap = card.querySelector('.thumb'); const f = card.querySelector('iframe'); if (!f) return;
  f.style.transform = `scale(${wrap.clientWidth / 794})`;
}

// معاينة قالب التقرير: iframe يعرض الصفحة الحقيقية عبر نفس المُصيِّر الذي يستعمله المحرر
function mountReportThumb(box, tpl) {
  const f = el('iframe', { src: '/report-builder/preview.html?thumb=1', title: 'معاينة ' + tpl.name, tabindex: '-1', loading: 'lazy', scrolling: 'no' });
  box.append(f);
  const rec = { tpl, frame: f, card: box, page: 'cover' };
  const fit = () => { f.style.transform = `scale(${box.clientWidth / 794})`; };
  thumbs.set(f.contentWindow, rec); f.addEventListener('load', () => { thumbs.set(f.contentWindow, rec); fit(); });
  new ResizeObserver(fit).observe(box);
  return (variant) => { rec.page = variant; gotoThumb(rec); };
}

export function buildGallery(root, onUse, allowed, onCustom) {
  bindMessages();
  const list = T.TEMPLATES.filter((t) => !Array.isArray(allowed) || allowed.includes(t.id));
  const mine = el('div', { class: 'cust', hidden: true });
  if (onCustom) fetch('/report-builder/api/custom-templates').then((r) => (r.ok ? r.json() : [])).then((rows) => {
    if (!rows.length) return; mine.hidden = false;
    mine.replaceChildren(el('h2', { style: 'margin:8px 0' }, 'القوالب الرسمية وقوالبي'), el('div', { class: 'tgrid' }, rows.map((t) => el('article', { class: 'tcard', style: 'padding:16px;gap:6px' },
      el('div', { class: 'tmeta' }, el('span', { class: 'tag' }, t.official ? 'قالب رسمي' : t.shared ? 'مشترك' : 'قالبي'), el('span', { class: 'muted', style: 'font-size:12px' }, t.sections + ' قسم')),
      el('h3', { style: 'margin:4px 0' }, t.name), el('p', { class: 'muted' }, t.desc || (t.ownerName ? 'بواسطة ' + t.ownerName : '')),
      el('div', { class: 'tact' }, btn('استخدم القالب', { cls: 'primary', onclick: () => onCustom(t) }), t.mine || store.role === 'admin' ? btn('حذف', { cls: 'ghost', onclick: async () => { if (!confirm('حذف القالب «' + t.name + '»؟')) return; const d = await fetch('/report-builder/api/custom-templates/' + t.id, { method: 'DELETE' }); if (d.ok) { rows.splice(rows.indexOf(t), 1); buildGallery(root, onUse, allowed, onCustom); } } }) : null)))));
  }).catch(() => {});
  buildTemplateGallery(root, {
    items: list.map((t) => ({ id: t.id, name: t.name, desc: t.desc, category: t.category, palette: t.palette, raw: t })), categories: T.CATEGORIES, user: store.user, favPrefix: 'rb-fav:', extra: mine,
    emptyAll: 'لا توجد أنواع تقارير مسموحة لحسابك. تواصل مع مسؤول النظام ليحدد لك أنواع التقارير.',
    thumb: { aspect: '210 / 297', variants: [['cover', 'الغلاف'], ['content', 'المحتوى']], mount: (box, item) => { const fn = mountReportThumb(box, item.raw); return (k) => fn(k); } },
    onUse: (item, sample) => onUse(item.raw, sample),
    details: (item) => { const t = item.raw; return el('div', {}, el('h4', {}, 'أقسام القالب'), el('ol', {}, t.sections.map((x) => el('li', {}, el('b', {}, x.title || T.BLOCKS[x.type].name), x.hint ? el('div', { class: 'muted', style: 'font-size:13px' }, x.hint) : null))), el('p', { class: 'muted' }, 'الغلاف: ' + t.cover + ' · الألوان: ' + (T.PALETTES[t.palette] || {}).name + (t.toc ? ' · فهرس تلقائي' : '') + (t.closing ? ' · صفحة ختام' : ''))); },
  });
}
