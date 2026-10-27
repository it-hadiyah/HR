// المعاينة الحية: إطار iframe يعرض التقرير على صفحات A4 حقيقية، ويتواصل مع المحرر عبر postMessage
import { store, select, on } from './store.js';
import { debounce } from './ui.js';

const RBR = window.RBR;
import { loadIndicators, getIndicatorMap } from './indicators-cache.js';
export let config = {};
export const loadConfig = async () => { try { config = await (await fetch('/report-builder/api/config')).json(); } catch (e) { config = {}; } await loadIndicators(); return config; };

export function renderPayload(report, o = {}) {
  const r = RBR.makeRenderer(report, { config, preview: o.preview !== false, workflow: o.workflow, noMark: o.noMark, indicators: getIndicatorMap() });
  const a = r.rootAttrs();
  return { type: 'render', html: r.source(), cls: a.cls, style: a.style, sid: o.sid };
}

let frame, ready = false, zoomMode = 'fit', zoom = 1, pages = 1, page = 1;
const ui = {};

export function init(frameEl, controls) {
  frame = frameEl; Object.assign(ui, controls);
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === 'ready') { ready = true; push(); applyZoom(); }
    else if (m.type === 'select' && m.sid) select('section', m.sid);
    else if (m.type === 'pages') { pages = m.n; page = Math.min(page, pages); showPage(); }
    else if (m.type === 'page') { page = m.i; showPage(); }
  });
  frame.src = '/report-builder/preview.html';
  new ResizeObserver(() => { if (zoomMode === 'fit') applyZoom(); }).observe(frame.parentElement);
  on((kind) => { if (kind === 'select') highlight(); else push(); });
}

export const push = debounce(() => {
  if (!ready || !store.report) return;
  const sid = store.sel.kind === 'section' ? store.sel.id : null;
  frame.contentWindow.postMessage(Object.assign(renderPayload(store.report, { sid, workflow: store.workflow }), { zoom: currentZoom() }), '*');
}, 140);

export function highlight() {
  if (!ready) return;
  frame.contentWindow.postMessage({ type: 'highlight', sid: store.sel.kind === 'section' ? store.sel.id : null }, '*');
}

const currentZoom = () => (zoomMode === 'fit' ? Math.max(0.3, Math.min(1.4, (frame.parentElement.clientWidth - 8) / 794)) : zoom);
function applyZoom() {
  if (!ready) return;
  const z = currentZoom();
  frame.contentWindow.postMessage({ type: 'zoom', z }, '*');
  if (ui.zoomLabel) ui.zoomLabel.textContent = Math.round(z * 100) + '%';
}
export function zoomBy(d) { zoomMode = 'manual'; zoom = Math.max(0.3, Math.min(1.6, Math.round((currentZoom() + d) * 10) / 10)); applyZoom(); }
export function zoomFit() { zoomMode = 'fit'; applyZoom(); }
function showPage() { if (ui.pageLabel) ui.pageLabel.textContent = `صفحة ${page} من ${pages}`; if (ui.prev) ui.prev.disabled = page <= 1; if (ui.next) ui.next.disabled = page >= pages; }
export function gotoPage(n) { if (!ready) return; page = Math.max(1, Math.min(pages, n)); frame.contentWindow.postMessage({ type: 'goto', page }, '*'); showPage(); }
export const pageNow = () => page;
export function printPreview() { frame.contentWindow.focus(); frame.contentWindow.print(); }
