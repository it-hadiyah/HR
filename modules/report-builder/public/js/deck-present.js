// عرض الشرائح: ملاءمة الحجم للشاشة، وضع العرض بملء الشاشة، التنقل بلوحة المفاتيح، وملاحظات المقدّم
(function () {
  var stage = document.getElementById('dv-stage'), pres = document.getElementById('dv-pres'), view = document.getElementById('dp-view');
  if (!stage) return;
  var slides = Array.prototype.slice.call(stage.querySelectorAll('.slide')), notes = window.__NOTES || [], i = 0, showNotes = false;
  var sw = parseFloat(getComputedStyle(document.body).getPropertyValue('--sw')) || 1280, sh = parseFloat(getComputedStyle(document.body).getPropertyValue('--sh')) || 720;
  function fit() { var f = Math.min(1, (window.innerWidth - 24) / sw); document.body.style.setProperty('--fit', f); }
  window.addEventListener('resize', fit); fit();
  function show() {
    var s = slides[i].cloneNode(true); s.style.zoom = ''; s.style.boxShadow = 'none';
    var k = Math.min(window.innerWidth / sw, window.innerHeight / sh);
    s.style.transform = 'scale(' + k + ')'; s.style.transformOrigin = 'top right';
    view.style.width = sw * k + 'px'; view.style.height = sh * k + 'px';
    view.replaceChildren(s);
    document.getElementById('dp-n').textContent = (i + 1) + ' من ' + slides.length;
    var nt = document.getElementById('dp-nt'); nt.textContent = notes[i] || 'لا توجد ملاحظات لهذه الشريحة'; nt.hidden = !showNotes;
  }
  function go(d) { i = Math.max(0, Math.min(slides.length - 1, i + d)); show(); }
  function open(at) { i = at || 0; pres.hidden = false; show(); if (pres.requestFullscreen) pres.requestFullscreen().catch(function () {}); }
  function close() { pres.hidden = true; if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); }
  document.getElementById('dv-present').onclick = function () { open(0); };
  document.getElementById('dp-next').onclick = function () { go(1); }; document.getElementById('dp-prev').onclick = function () { go(-1); };
  document.getElementById('dp-exit').onclick = close;
  document.getElementById('dp-notes').onclick = function () { showNotes = !showNotes; show(); };
  slides.forEach(function (s, n) { s.addEventListener('dblclick', function () { open(n); }); });
  window.addEventListener('resize', function () { if (!pres.hidden) show(); });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && !pres.hidden) pres.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (pres.hidden) { if (e.key === 'F5') { e.preventDefault(); open(0); } return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageUp' || e.key === 'Backspace') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { i = 0; show(); } else if (e.key === 'End') { i = slides.length - 1; show(); }
    else if (e.key === 'n' || e.key === 'N') { showNotes = !showNotes; show(); }
    else if (e.key === 'Escape') close();
  });
  if (/#print/.test(location.hash)) setTimeout(function () { window.print(); }, 700);
  var h = location.hash.match(/#present(?:=(\d+))?/); if (h) open(h[1] ? +h[1] - 1 : 0);
})();
