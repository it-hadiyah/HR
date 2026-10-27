// تفاعل مساحة التصميم: تحديد العناصر، السحب، تغيير الحجم، المحاذاة الذكية، تحرير النص، تحريك الصورة داخل الإطار وتكبيرها
const D = window.RBD, S = window.RBS;

export const getPath = (slide, path) => {
  if (!path) return '';
  if (path === 'bullets') return (slide.bullets || []).filter((x) => String(x).trim()).join('\n\n');
  const m = path.split('.');
  if (m[0] === 'extra') { const e = (slide.extra || []).find((x) => x.id === m[1]); return e ? e.text || '' : ''; }
  let v = slide; for (const k of m) { v = v == null ? v : v[k]; } return v == null ? '' : String(v);
};
export function setPath(slide, path, value) {
  if (path === 'bullets') { slide.bullets = String(value).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean); return; }
  const m = path.split('.');
  if (m[0] === 'extra') { const e = (slide.extra || []).find((x) => x.id === m[1]); if (e) e.text = value; return; }
  if (m[0] === 'items') { slide.items = slide.items || []; while (slide.items.length <= +m[1]) slide.items.push({ t: '', d: '', v: '' }); slide.items[+m[1]][m[2]] = value; return; }
  if (m[0] === 'bullets') { slide.bullets = slide.bullets || []; slide.bullets[+m[1]] = value; return; }
  slide[m[0]] = value;
}

export function initCanvas(api) {
  // api: { stage(), scale(), deck(), slide(), ctx(), commit(fn, key), onSelect(id), pickPhoto(id), selected }
  let sel = null, drag = null, sels = null;
  const q = (sl) => api.stage().querySelector(sl);
  const elOf = (id) => api.stage().querySelector(`[data-eid="${CSS.escape(id)}"]`);
  const els = () => D.elementsOf(api.deck(), api.slide(), api.ctx());
  const find = (id) => els().find((e) => e.id === id);
  const k = () => api.scale();

  function clearOverlay() { api.stage().querySelectorAll('.dk-sel,.dk-guide').forEach((n) => n.remove()); }
  function drawSel() {
    api.stage().querySelectorAll('.dk-sel').forEach((n) => n.remove());
    if (!sel) return;
    const e = find(sel); if (!e) { sel = null; return; }
    const s = k(), box = document.createElement('div'); box.className = 'dk-sel';
    box.style.cssText = `left:${e.x * s}px;top:${e.y * s}px;width:${e.w * s}px;height:${e.h * s}px`;
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((h) => {
      const i = document.createElement('i'); i.dataset.h = h;
      i.style.cssText = `${h.includes('n') ? 'top' : h.includes('s') ? 'bottom' : 'top'}:${h.includes('n') || h.includes('s') ? '-7px' : 'calc(50% - 6px)'};${h.includes('w') ? 'left' : h.includes('e') ? 'right' : 'left'}:${h.includes('w') || h.includes('e') ? '-7px' : 'calc(50% - 6px)'};cursor:${{ nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' }[h]}-resize`;
      box.append(i);
    });
    api.stage().append(box);
  }
  function select(id) { sel = id; drawSel(); api.onSelect(id); }
  function guides(list) {
    api.stage().querySelectorAll('.dk-guide').forEach((n) => n.remove());
    const s = k();
    list.forEach((g) => { const d = document.createElement('div'); d.className = 'dk-guide'; d.style.cssText = g.v ? `left:${g.p * s}px;top:0;width:1px;height:100%` : `top:${g.p * s}px;left:0;height:1px;width:100%`; api.stage().append(d); });
  }
  // التقاط الحواف والمراكز
  function snap(r, others, W, H, moveX, moveY) {
    const th = 6 / k(), gl = []; const out = { x: r.x, y: r.y };
    const xs = [0, W / 2, W, 64, W - 64], ys = [0, H / 2, H, 64, H - 64];
    others.forEach((o) => { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); });
    if (moveX) { let best = null; [r.x, r.x + r.w / 2, r.x + r.w].forEach((v, i) => xs.forEach((t) => { const d = t - v; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; })); if (best) { out.x = r.x + best.d; gl.push({ v: 1, p: best.t }); } }
    if (moveY) { let best = null; [r.y, r.y + r.h / 2, r.y + r.h].forEach((v) => ys.forEach((t) => { const d = t - v; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; })); if (best) { out.y = r.y + best.d; gl.push({ v: 0, p: best.t }); } }
    return { out, gl };
  }
  function applyLive(id, r) {
    const n = elOf(id); if (n) { n.style.left = r.x + 'px'; n.style.top = r.y + 'px'; n.style.width = r.w + 'px'; n.style.height = r.h + 'px'; }
    const b = q('.dk-sel'); if (b) { const s = k(); b.style.left = r.x * s + 'px'; b.style.top = r.y * s + 'px'; b.style.width = r.w * s + 'px'; b.style.height = r.h * s + 'px'; }
  }
  function commitRect(id, r) {
    api.commit((sl) => {
      const ex = (sl.extra || []).find((x) => x.id === id);
      const v = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      if (ex) Object.assign(ex, v); else { sl.ov = sl.ov || {}; sl.ov[id] = v; }
    }, 'mv' + id);
  }
  function commitPhoto(id, p) {
    api.commit((sl) => {
      const ex = (sl.extra || []).find((x) => x.id === id);
      if (ex) { ex.photo = Object.assign({}, ex.photo, p); return; }
      const e = (D.elementsOf(api.deck(), sl, api.ctx()) || []).find((x) => x.id === id);
      if (e && e.type === 'photo') { sl.photos = sl.photos || []; while (sl.photos.length <= e.pi) sl.photos.push({}); sl.photos[e.pi] = Object.assign({}, S.normPhoto(sl.photos[e.pi], (S.LAYOUTS[sl.layout].photos || [])[e.pi]), p); }
    }, 'ph' + id);
  }

  const stage = () => api.stage();
  stage().addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest('.dk-sel i'), n = ev.target.closest('.el[data-eid]');
    if (!h && !n) { if (!ev.target.closest('.dk-sel')) { sel = null; clearOverlay(); api.onSelect(null); } return; }
    const id = h ? sel : n.dataset.eid; const e = find(id); if (!e) return;
    if (!h && sel !== id) select(id);
    ev.preventDefault();
    const photo = e.type === 'photo' && e.photo.src && !h && !ev.altKey;
    drag = { id, e: { x: e.x, y: e.y, w: e.w, h: e.h }, x0: ev.clientX, y0: ev.clientY, mode: h ? 'resize' : photo ? 'pan' : 'move', h: h && h.dataset.h, moved: false, photo: e.photo && Object.assign({}, e.photo), others: els().filter((o) => o.id !== id) };
    stage().setPointerCapture(ev.pointerId);
  });
  stage().addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const s = k(), dx = (ev.clientX - drag.x0) / s, dy = (ev.clientY - drag.y0) / s;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; if (!drag.moved) return;
    const dims = D.RATIOS[api.deck().ratio] || D.RATIOS['16:9'], r = Object.assign({}, drag.e);
    if (drag.mode === 'move') {
      r.x += dx; r.y += dy; const sn = snap(r, drag.others, dims.w, dims.h, true, true); r.x = sn.out.x; r.y = sn.out.y; guides(sn.gl);
      applyLive(drag.id, r); drag.cur = r;
    } else if (drag.mode === 'resize') {
      const h = drag.h; if (h.includes('e')) r.w = Math.max(20, drag.e.w + dx); if (h.includes('w')) { r.w = Math.max(20, drag.e.w - dx); r.x = drag.e.x + drag.e.w - r.w; }
      if (h.includes('s')) r.h = Math.max(20, drag.e.h + dy); if (h.includes('n')) { r.h = Math.max(20, drag.e.h - dy); r.y = drag.e.y + drag.e.h - r.h; }
      const sn = snap(r, drag.others, dims.w, dims.h, h.includes('w') || h.includes('e'), h.includes('n') || h.includes('s'));
      if (h.includes('w')) { const nx = sn.out.x; r.w += r.x - nx; r.x = nx; } else if (h.includes('e')) r.w = r.w + (sn.out.x - r.x);
      if (h.includes('n')) { const ny = sn.out.y; r.h += r.y - ny; r.y = ny; } else if (h.includes('s')) r.h = r.h + (sn.out.y - r.y);
      guides(sn.gl); applyLive(drag.id, r); drag.cur = r;
    } else if (drag.mode === 'pan') {
      const p = S.normPhoto(drag.photo), g = S.photoGeom(p, drag.e.w, drag.e.h);
      if (!p.nw) return;
      const spanX = g.w - drag.e.w, spanY = g.h - drag.e.h;
      const nx = spanX > 1 ? Math.max(0, Math.min(100, p.x - (dx / spanX) * 100)) : p.x, ny = spanY > 1 ? Math.max(0, Math.min(100, p.y - (dy / spanY) * 100)) : p.y;
      drag.pan = { x: Math.round(nx), y: Math.round(ny) };
      const n = elOf(drag.id), img = n && n.querySelector('img');
      if (img) { const g2 = S.photoGeom(Object.assign({}, p, drag.pan), drag.e.w, drag.e.h); img.style.left = g2.l + 'px'; img.style.top = g2.t + 'px'; }
    }
  });
  const finish = () => {
    if (!drag) return; const d = drag; drag = null; guides([]);
    const e = find(d.id);
    if (!d.moved) { if (e && e.type === 'photo' && !e.photo.src) api.pickPhoto(d.id); return; }
    if (d.mode === 'pan' && d.pan) commitPhoto(d.id, d.pan); else if (d.cur) commitRect(d.id, d.cur);
  };
  stage().addEventListener('pointerup', finish); stage().addEventListener('pointercancel', finish);

  // تكبير الصورة بعجلة الفأرة عندما تكون محددة
  stage().addEventListener('wheel', (ev) => {
    if (!sel) return; const e = find(sel); if (!e || e.type !== 'photo' || !e.photo.src || !ev.target.closest('.dk-stage')) return;
    if (!ev.target.closest(`[data-eid="${CSS.escape(sel)}"]`)) return;
    ev.preventDefault(); const sc = Math.max(1, Math.min(4, +(e.photo.scale + (ev.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))); commitPhoto(sel, { scale: sc });
  }, { passive: false });

  // تحرير النص مباشرة بالنقر المزدوج
  stage().addEventListener('dblclick', (ev) => {
    const n = ev.target.closest('.el-text.editable'); const ph = ev.target.closest('.el-photo');
    if (ph && ph.dataset.eid) { const e = find(ph.dataset.eid); if (e && e.photo.src) api.pickPhoto(ph.dataset.eid); return; }
    if (!n) return;
    const e = find(n.dataset.eid); if (!e || !e.field) return;
    const tx = n.querySelector('.tx'); n.classList.remove('ph'); tx.textContent = getPath(api.slide(), e.field); tx.contentEditable = 'plaintext-only'; tx.focus();
    const range = document.createRange(); range.selectNodeContents(tx); const sg = getSelection(); sg.removeAllRanges(); sg.addRange(range);
    const done = () => { tx.contentEditable = 'false'; const val = tx.innerText.replace(/ /g, ' ').trim(); api.commit((sl) => setPath(sl, e.field, val), 'tx' + e.id); };
    tx.addEventListener('blur', done, { once: true });
    tx.addEventListener('keydown', (kv) => { if (kv.key === 'Escape') { tx.textContent = getPath(api.slide(), e.field); tx.blur(); } else if (kv.key === 'Enter' && !kv.shiftKey && !/bullets$/.test(e.field)) { kv.preventDefault(); tx.blur(); } kv.stopPropagation(); });
  });

  // لوحة المفاتيح: تحريك بالأسهم وحذف العناصر الحرة
  document.addEventListener('keydown', (ev) => {
    if (!sel || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
    const e = find(sel); if (!e) return; const st = ev.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[ev.key];
    if (mv) { ev.preventDefault(); ev.stopImmediatePropagation(); commitRect(sel, { x: e.x + mv[0], y: e.y + mv[1], w: e.w, h: e.h }); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && e.extra) { ev.preventDefault(); api.removeExtra(sel); sel = null; }
    else if (ev.key === 'Escape') { sel = null; clearOverlay(); api.onSelect(null); }
  }, true);

  return { patchPhoto: commitPhoto, select, drawSel, current: () => sel, clear: () => { sel = null; clearOverlay(); } };
}
