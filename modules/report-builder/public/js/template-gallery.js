// معرض قوالب موحّد للتقارير والعروض: نفس البطاقات والبحث والتصنيفات والمفضلة وحالات التحميل،
// وتتغير المعاينة (نسبة الأبعاد وطريقة الرسم) بحسب نوع المستند عبر opts.thumb
import { el, btn, modal } from './ui.js';
import { icon } from './icons.js';

export function buildTemplateGallery(root, opts) {
  const { items, categories, user, favPrefix, thumb, onUse, extra, emptyAll, details } = opts;
  const favKey = favPrefix + (user || '');
  const readFavs = () => { try { return new Set(JSON.parse(localStorage.getItem(favKey) || '[]')); } catch (e) { return new Set(); } };
  const favs = readFavs(), writeFavs = () => { try { localStorage.setItem(favKey, JSON.stringify(Array.from(favs))); } catch (e) { /* ignore */ } };
  let cat = 'الكل', q = '';
  const grid = el('div', { class: 'tgrid' });
  const chips = el('div', { class: 'chips', role: 'tablist', 'aria-label': 'تصنيف القوالب' });
  const empty = el('div', { class: 'empty', hidden: true }, el('span', { html: icon('search', 32) }), el('b', {}, 'لا توجد قوالب مطابقة'), el('small', {}, 'جرّب كلمة بحث أخرى أو اختر تصنيف «الكل».'));
  if (!items.length) { root.replaceChildren(el('div', { class: 'empty' }, el('span', { html: icon('folder', 32) }), el('b', {}, emptyAll || 'لا توجد قوالب'))); return; }

  function card(t) {
    const c = el('article', { class: 'tcard', 'data-cat': t.category, 'data-id': t.id });
    const box = el('div', { class: 'thumb', style: `aspect-ratio:${thumb.aspect}`, 'aria-hidden': 'true' }, el('div', { class: 'skel' }));
    let switchTo = null;
    const tabs = el('div', { class: 'thumb-tabs', role: 'group', 'aria-label': 'معاينة القالب' }, thumb.variants.map(([k, label], i) => el('button', { type: 'button', class: i === 0 ? 'on' : '', 'aria-pressed': String(i === 0), onclick: (e) => { if (switchTo) switchTo(k); tabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }); } }, label)));
    const star = el('button', { type: 'button', class: 'fav', 'aria-pressed': String(favs.has(t.id)), title: 'تثبيت في المفضلة', 'aria-label': 'تثبيت ' + t.name + ' في المفضلة', onclick: () => { if (favs.has(t.id)) favs.delete(t.id); else favs.add(t.id); writeFavs(); star.setAttribute('aria-pressed', String(favs.has(t.id))); star.textContent = favs.has(t.id) ? '★' : '☆'; order(); apply(); } }, favs.has(t.id) ? '★' : '☆');
    c.append(box, tabs, el('div', { class: 'tinfo' },
      el('div', { class: 'tmeta' }, el('span', { class: 'tag' }, t.category), el('span', {}, details ? el('button', { type: 'button', class: 'fav', style: 'font-size:13px;margin-inline-end:6px;color:var(--brand)', title: 'تفاصيل القالب', onclick: () => { const body = details(t); modal('تفاصيل القالب: ' + t.name, el('div', { class: 'tdetail' }, el('p', { class: 'muted' }, t.desc), body, el('div', { class: 'dlg-actions' }, btn('استخدم القالب', { cls: 'primary', onclick: (e) => { e.target.closest('dialog').querySelector('button[aria-label="إغلاق"]').click(); onUse(t, false); } })))); } }, 'تفاصيل') : null, star)),
      el('h3', {}, t.name), el('p', {}, t.desc), t.meta ? el('small', { class: 'muted' }, t.meta) : null,
      el('div', { class: 'tact' }, btn('استخدم القالب', { cls: 'primary', onclick: () => onUse(t, false) }), btn('ببيانات تجريبية', { cls: 'ghost', icon: 'sparkle', title: 'يملأ القالب ببيانات توضيحية لتجربة الشكل', onclick: () => onUse(t, true) }))));
    const io = new IntersectionObserver((ents) => { if (!ents[0].isIntersecting) return; io.disconnect(); box.replaceChildren(); switchTo = thumb.mount(box, t, thumb.variants[0][0]) || null; }, { rootMargin: '300px' });
    io.observe(c);
    return c;
  }
  const cards = items.map((t) => ({ t, el: card(t) }));
  const order = () => [...cards].sort((a, b) => (favs.has(b.t.id) ? 1 : 0) - (favs.has(a.t.id) ? 1 : 0)).forEach((c) => grid.append(c.el));
  order();
  const apply = () => {
    let n = 0;
    cards.forEach(({ t, el: e }) => { const ok = (cat === 'الكل' || (cat === '★' ? favs.has(t.id) : t.category === cat)) && (!q || (t.name + ' ' + t.desc + ' ' + t.category).includes(q)); e.hidden = !ok; if (ok) n++; });
    empty.hidden = n > 0;
  };
  const used = new Set(items.map((t) => t.category));
  ['الكل', '★'].concat(categories.filter((c) => c !== 'الكل' && used.has(c))).forEach((c) => chips.append(el('button', { type: 'button', role: 'tab', class: 'chip' + (c === cat ? ' on' : ''), 'aria-selected': String(c === cat), onclick: (e) => { cat = c; chips.querySelectorAll('.chip').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', String(b === e.currentTarget)); }); apply(); } }, c === '★' ? '★ المفضلة' : c)));
  const search = el('div', { class: 'search' }, el('span', { html: icon('search', 16) }), el('input', { type: 'search', placeholder: 'ابحث في القوالب...', 'aria-label': 'ابحث في القوالب', oninput: (e) => { q = e.target.value.trim(); apply(); } }));
  root.replaceChildren(el('div', { class: 'gal-tools' }, search, chips), extra || null, grid, empty);
}
