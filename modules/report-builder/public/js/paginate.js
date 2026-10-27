/* تقسيم التقرير إلى صفحات A4 حقيقية: يوزّع الأقسام على الصفحات، ويقسم النصوص والقوائم والجداول
   الطويلة بين الصفحات (مع تكرار رأس الجدول)، ويضيف الترويسة والتذييل وترقيم الصفحات وفهرس المحتويات. */
(function () {
  'use strict';
  const pagesEl = document.getElementById('pages');
  const srcEl = document.getElementById('src');
  const isPreview = document.body.classList.contains('preview');
  const isThumb = /[?&]thumb\b/.test(location.search);
  let srcHtml = srcEl ? srcEl.innerHTML : '';
  let activeSid = null;
  let cur = null;

  const over = (b) => b.scrollHeight > b.clientHeight + 1;

  function newSheet(kind, S) {
    const el = document.createElement('div');
    el.className = 'sheet ' + kind;
    if (kind === 'page') {
      const head = document.createElement('div'); head.className = 'sh-wrap';
      const body = document.createElement('div'); body.className = 'sbody';
      const foot = document.createElement('div'); foot.className = 'sf-wrap';
      const th = S.querySelector('#tpl-head'), tf = S.querySelector('#tpl-foot');
      if (th) head.appendChild(th.content.cloneNode(true));
      if (tf) foot.appendChild(tf.content.cloneNode(true));
      el.append(head, body, foot);
      el.body = body;
    } else { el.body = el; }
    pagesEl.appendChild(el);
    return el;
  }

  function splitUnit(unit, S) {
    let current = unit;
    for (;;) {
      const sc = current.querySelector('[data-split]');
      if (!sc) return;
      const moved = [];
      while (over(cur.body) && sc.children.length > 1) { const last = sc.lastElementChild; sc.removeChild(last); moved.unshift(last); }
      if (!moved.length) return;
      const clone = current.cloneNode(true);
      const scc = clone.querySelector('[data-split]');
      scc.innerHTML = '';
      moved.forEach((m) => scc.appendChild(m));
      if (scc.tagName === 'OL') scc.setAttribute('start', String((parseInt(sc.getAttribute('start') || '1', 10) || 1) + sc.children.length));
      clone.classList.add('cont');
      cur = newSheet('page', S);
      cur.body.appendChild(clone);
      current = clone;
      if (!over(cur.body)) return;
    }
  }

  function build() {
    const scrollY = window.scrollY;
    pagesEl.innerHTML = '';
    const S = document.createElement('div');
    S.innerHTML = srcHtml;

    const cover = S.querySelector('.cover-src');
    if (cover) { const s = newSheet('cover', S); cover.className = 'cvr ' + cover.className.replace('cover-src', '').trim(); s.appendChild(cover); }

    let tocSheet = null;
    if (S.querySelector('.toc-src')) { tocSheet = newSheet('page', S); tocSheet.classList.add('toc'); }

    // دمج الأقسام نصف العرض المتجاورة في صف واحد
    const units = [];
    const blocks = Array.from(S.querySelectorAll('.flow > .blk'));
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.classList.contains('w-half') && blocks[i + 1] && blocks[i + 1].classList.contains('w-half')) {
        const row = document.createElement('div'); row.className = 'row2';
        row.append(b, blocks[i + 1]); units.push(row); i++;
      } else { b.classList.remove('w-half'); b.classList.add('w-full'); units.push(b); }
    }

    cur = newSheet('page', S);
    const tocItems = [];
    for (const unit of units) {
      if (unit.classList.contains('pb')) { if (cur.body.children.length) cur = newSheet('page', S); continue; }
      cur.body.appendChild(unit);
      if (over(cur.body)) {
        if (cur.body.children.length > 1) { cur.body.removeChild(unit); cur = newSheet('page', S); cur.body.appendChild(unit); }
      }
      const startSheet = cur;
      if (over(cur.body)) splitUnit(unit, S);
      const owner = unit.classList.contains('row2') ? Array.from(unit.children) : [unit];
      owner.forEach((o) => { if (o.dataset.sid && o.dataset.title && !o.classList.contains('ph')) tocItems.push({ sid: o.dataset.sid, title: o.dataset.title, sheet: startSheet }); });
    }
    if (!cur.body.children.length && pagesEl.querySelectorAll('.sheet.page').length > 1) { pagesEl.removeChild(cur); }

    const closing = S.querySelector('.closing-src');
    if (closing) { const s = newSheet('closing', S); closing.className = 'clr'; s.appendChild(closing); }

    const all = Array.from(pagesEl.children);
    const pageSheets = all.filter((s) => s.classList.contains('page'));
    all.forEach((s, i) => { s.dataset.page = String(i + 1); s.id = 'pg' + (i + 1); });
    pageSheets.forEach((s) => {
      const pn = s.querySelector('.pn'), pt = s.querySelector('.pt');
      if (pn) pn.textContent = fmtN(all.indexOf(s) + 1);
      if (pt) pt.textContent = fmtN(all.length);
    });
    if (tocSheet) {
      const seen = new Set();
      const rows = tocItems.filter((t) => !seen.has(t.sid) && seen.add(t.sid)).map((t) => `<li><span class="tt">${esc(t.title)}</span><i></i><b>${fmtN(all.indexOf(t.sheet) + 1)}</b></li>`).join('');
      tocSheet.body.innerHTML = `<h2 class="toc-h">فهرس المحتويات</h2><ol class="toc-l">${rows}</ol>`;
    }

    const pc = document.getElementById('pcount');
    if (pc) pc.textContent = ' · ' + all.length + ' صفحة';
    if (activeSid) highlight(activeSid, false);
    if (scrollY) window.scrollTo(0, scrollY);
    post({ type: 'pages', n: all.length });
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = (n) => (document.body.classList.contains('ad') ? String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : String(n));
  const post = (m) => { if (window.parent !== window) window.parent.postMessage(m, '*'); };

  function highlight(sid, scroll) {
    activeSid = sid;
    document.querySelectorAll('.active').forEach((e) => e.classList.remove('active'));
    if (!sid) return;
    const els = document.querySelectorAll('[data-sid="' + (window.CSS && CSS.escape ? CSS.escape(sid) : sid) + '"]');
    els.forEach((e) => e.classList.add('active'));
    if (scroll && els[0]) scrollToEl(els[0], 'center', 'smooth');
  }

  // تمرير داخل الإطار فقط (scrollIntoView كان يحرّك الصفحة الأم أيضاً)
  function scrollToEl(el, block, behavior) {
    const z = parseFloat(document.body.style.zoom) || 1;
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY - (block === 'center' ? (window.innerHeight - r.height) / 2 : 0);
    window.scrollTo({ top: Math.max(0, top), behavior });
  }

  function currentPage() {
    const sheets = pagesEl.children; const mid = window.innerHeight * 0.4;
    for (let i = 0; i < sheets.length; i++) { const r = sheets[i].getBoundingClientRect(); if (r.bottom > mid) return i + 1; }
    return sheets.length;
  }

  function ready(fn) {
    const go = () => (document.fonts && document.fonts.ready ? document.fonts.ready.then(fn, fn) : fn());
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  let rebuildTimer;
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'render') {
      srcHtml = m.html;
      document.body.className = 'rpt preview ' + (isThumb ? 'thumb ' : '') + (m.cls || '');
      document.body.setAttribute('style', m.style || '');
      if (m.zoom) document.body.style.zoom = m.zoom;
      activeSid = m.sid || activeSid;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => ready(build), 0);
    } else if (m.type === 'highlight') highlight(m.sid, true);
    else if (m.type === 'zoom') document.body.style.zoom = m.z;
    else if (m.type === 'goto') { const s = document.getElementById('pg' + m.page); if (s) scrollToEl(s, 'start', m.instant ? 'auto' : 'smooth'); }
  });

  pagesEl.addEventListener('click', (e) => {
    if (!isPreview) return;
    const b = e.target.closest('[data-sid]');
    if (b) post({ type: 'select', sid: b.dataset.sid });
  });
  if (isPreview) window.addEventListener('scroll', () => post({ type: 'page', i: currentPage() }), { passive: true });

  window.RBPrint = () => { window.print(); };
  if (isPreview) { post({ type: 'ready' }); }
  else { ready(build); }
})();
