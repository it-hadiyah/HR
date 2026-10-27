import { h } from './core.js';

const live = [];
export function destroyCharts() { while (live.length) { try { live.pop().destroy(); } catch { /* ignore */ } } }

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const palette = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(css);

/** رسم بياني بخيارات متوافقة مع RTL والوضعين الفاتح والداكن */
export function chart(title, type, data, { height = '', options = {}, sub } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': title });
  const box = h('div', { class: 'chart-box ' + height }, canvas);
  const card = h('div', { class: 'card' }, h('h3', null, title), sub && h('div', { class: 'sub' }, sub), box);
  if (!data.labels || data.labels.length === 0) { box.replaceChildren(h('div', { class: 'empty' }, 'لا توجد بيانات للعرض')); return card; }
  queueMicrotask(() => {
    const text = css('--muted'), grid = css('--border');
    const Chart = window.Chart;
    Chart.defaults.font.family = '"Segoe UI","Noto Sans Arabic",Tahoma,Arial,sans-serif';
    Chart.defaults.color = text;
    Chart.defaults.locale = 'en-US';
    const horizontal = options.indexAxis === 'y';
    const base = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, textDirection: 'rtl', callbacks: {} } },
      scales: type === 'doughnut' || type === 'pie' ? {} : {
        x: { reverse: !horizontal, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { reverse: false, position: horizontal ? 'right' : 'right', grid: { color: grid }, beginAtZero: true },
      },
    };
    if (horizontal) { base.scales.x = { grid: { color: grid }, beginAtZero: true, reverse: true }; base.scales.y = { grid: { display: false }, position: 'right' }; }
    const merged = deepMerge(base, options);
    live.push(new Chart(canvas, { type, data, options: merged }));
  });
  return card;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}

export function dataset(label, data, color, extra = {}) {
  return { label, data, backgroundColor: color, borderColor: color, borderRadius: 4, ...extra };
}
