// منتقي أيقونات الهوية: نافذة بشبكة أيقونات مع بحث
import { el, btn, modal } from './ui.js';

let cache;
export async function loadIcons() {
  if (!cache) { try { cache = await (await fetch('/report-builder/brand/icons/index.json')).json(); } catch (e) { cache = []; } }
  return cache;
}
export const iconSrc = (slug, v = 'hex') => (slug ? `/report-builder/brand/icons/${v}/${slug}.svg` : '');

export async function pickIcon({ current = '', variant = 'hex', title = 'اختر أيقونة', allowNone = true } = {}) {
  const icons = (await loadIcons()).filter((i) => i[variant]);
  const CATS = [['official', 'أيقونات هدية'], ['unofficial', 'أيقونات غير رسمية']];
  const cur = icons.find((i) => i.id === current);
  let tab = cur && cur.category === 'unofficial' ? 'unofficial' : 'official', q = '';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const grid = el('div', { class: 'icon-grid', role: 'listbox', 'aria-label': 'الأيقونات' });
    const tabs = el('div', { class: 'icon-tabs', role: 'tablist' });
    const opt = (i) => el('button', { type: 'button', role: 'option', class: 'icon-opt' + (i.id === current ? ' on' : ''), 'aria-selected': String(i.id === current), title: i.label, onclick: () => finish(i.id) },
      el('img', { src: iconSrc(i.id, variant), alt: '' }), el('span', {}, i.label));
    const section = (list, heading) => (list.length ? [heading ? el('h4', { class: 'icon-h' }, heading) : null, ...list.map(opt)] : []);
    const draw = () => {
      tabs.replaceChildren(...CATS.map(([k, name]) => el('button', { type: 'button', role: 'tab', class: 'icon-tab' + (!q && k === tab ? ' on' : ''), 'aria-selected': String(!q && k === tab),
        onclick: () => { tab = k; search.value = ''; q = ''; draw(); } }, name + ' ', el('small', {}, String(icons.filter((i) => i.category === k).length)))));
      const match = (i) => !q || i.label.includes(q) || (i.group || '').includes(q);
      const out = [];
      if (q) CATS.forEach(([k, name]) => out.push(...section(icons.filter((i) => i.category === k && match(i)), name)));
      else if (tab === 'unofficial') { const groups = []; icons.filter((i) => i.category === 'unofficial').forEach((i) => { let g = groups.find((x) => x[0] === i.group); if (!g) groups.push(g = [i.group, []]); g[1].push(i); }); groups.forEach(([g, list]) => out.push(...section(list, g))); }
      else out.push(...section(icons.filter((i) => i.category === 'official'), null));
      grid.replaceChildren(...out.filter(Boolean));
      if (!grid.children.length) grid.append(el('p', { class: 'muted' }, 'لا توجد أيقونات مطابقة.'));
    };
    const search = el('input', { type: 'search', placeholder: 'ابحث عن أيقونة (مشروع، ميزانية، تقنية...)', 'aria-label': 'ابحث عن أيقونة', oninput: (e) => { q = e.target.value.trim(); draw(); } });
    const body = el('div', {}, tabs, search, grid, allowNone ? el('div', { class: 'btns' }, btn('بدون أيقونة', { cls: 'ghost sm', onclick: () => finish('') })) : null);
    const m = modal(title, body, { onclose: () => { if (!done) { done = true; resolve(null); } } });
    draw(); search.focus();
  });
}

/* زر معاينة الأيقونة الحالية (يفتح المنتقي) */
export function iconButton(current, onChange, o = {}) {
  const b = el('button', { type: 'button', class: 'icon-btn' + (current ? ' has' : ''), title: o.title || 'اختيار أيقونة', 'aria-label': o.title || 'اختيار أيقونة' });
  const paint = (v) => { b.replaceChildren(v ? el('img', { src: iconSrc(v, o.variant || 'hex'), alt: '' }) : el('span', { class: 'plus' }, '+')); b.classList.toggle('has', !!v); };
  paint(current);
  b.onclick = async () => { const v = await pickIcon({ current, variant: o.variant || 'hex', title: o.dialogTitle }); if (v === null) return; current = v; paint(v); onChange(v); };
  return b;
}
