// ========== Brand identity page: logos, colours, fonts, patterns, icons, templates, sound ==========
// Data: data/brand.json. The files themselves live in Hadiyah-id/ (served from the same site).
(() => {
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DIR = "Hadiyah-id/";
  const url = name => DIR + encodeURI(name);

  const fmtSize = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  const dl = (href, label, icon = "fa-download") =>
    `<a class="br-dl" href="${h(href)}" download><i class="fa-solid ${icon}" aria-hidden="true"></i>${label}</a>`;

  function logos(items) {
    const card = item => `
      <article class="br-card br-asset">
        <div class="br-stage ${item.group === "dark" ? "br-stage--dark" : ""}"><img src="${url(item.file + ".png")}" alt="شعار ${h(item.name)}" loading="lazy"></div>
        <h4>${h(item.name)}</h4>
        <div class="br-dls">${dl(url(item.file + ".svg"), "SVG")}${dl(url(item.file + ".pdf"), "PDF")}${dl(url(item.file + ".png"), "PNG")}</div>
      </article>`;
    $("#logosLight").innerHTML = items.filter(i => i.group === "light").map(card).join("");
    $("#logosDark").innerHTML = items.filter(i => i.group === "dark").map(card).join("");
  }

  const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const isDark = hex => { const [r, g, b] = rgbOf(hex); return (r * 299 + g * 587 + b * 114) / 1000 < 150; };

  function colors(items) {
    $("#colorsGrid").innerHTML = items.map(c => `
      <button type="button" class="br-color" data-copy="${h(c.hex)}" aria-label="نسخ كود اللون ${h(c.name)} ${h(c.hex)}">
        <span class="br-swatch" style="background:${h(c.hex)};color:${isDark(c.hex) ? "#fff" : "#0f172a"}"><i class="fa-regular fa-copy" aria-hidden="true"></i></span>
        <span class="br-color-name">${h(c.name)}</span>
        <span class="br-color-role">${h(c.role)}</span>
        <span class="br-color-codes"><bdi dir="ltr">${h(c.hex)}</bdi><bdi dir="ltr">RGB ${rgbOf(c.hex).join(", ")}</bdi></span>
      </button>`).join("");
  }

  function fonts(data) {
    const face = data.weights.map(w => `@font-face{font-family:"HadiyahBrand";font-weight:${w.w};src:url("${url(w.file)}") format("opentype");font-display:swap}`).join("");
    const style = document.createElement("style");
    style.textContent = face;
    document.head.appendChild(style);
    $("#fontsGrid").innerHTML = data.weights.map(w => `
      <article class="br-card br-font">
        <span class="br-font-label">${h(w.label)} · ${h(w.name)}</span>
        <p class="br-font-sample" style="font-weight:${w.w}" data-sample>جمعية هدية الحاج والمعتمر</p>
        <p class="br-font-abc" style="font-weight:${w.w}">أ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي ٠١٢٣٤٥٦٧٨٩</p>
        ${dl(url(w.file), "تحميل الخط")}
      </article>`).join("");
    $("#fontsZip").href = url(data.zip);
    $("#fontSample").addEventListener("input", e => {
      $$("[data-sample]").forEach(node => { node.textContent = e.target.value || "جمعية هدية الحاج والمعتمر"; });
    });
  }

  function patterns(items) {
    $("#patternsGrid").innerHTML = items.map(p => `
      <article class="br-card br-asset">
        <div class="br-stage br-stage--pattern ${p.dark ? "br-stage--dark" : ""}"><img src="${url(p.file + ".png")}" alt="${h(p.name)}" loading="lazy"></div>
        <h4>${h(p.name)}</h4>
        <div class="br-dls">${dl(url(p.file + ".svg"), "SVG")}${dl(url(p.file + ".png"), "PNG")}</div>
      </article>`).join("");
  }

  function icons(data) {
    $("#iconPacks").innerHTML = data.packs.map(pack => `
      <article class="br-card br-pack">
        <img src="${url(data.preview[data.packs.indexOf(pack)])}" alt="${h(pack.name)}" loading="lazy">
        <div><h4>${h(pack.name)}</h4>${dl(url(pack.zip), `تحميل الحزمة (.zip · ${fmtSize(pack.size)})`)}</div>
      </article>`).join("");
    $("#iconsGrid").innerHTML = data.items.map(name => `
      <a class="br-icon" href="${url(`${data.folder}/${name}.svg`)}" download title="تحميل ${h(name)}">
        <img src="${url(`${data.folder}/${name}.svg`)}" alt="" loading="lazy" width="56" height="56"><span>${h(name)}</span>
      </a>`).join("");
  }

  function templates(items) {
    $("#templatesGrid").innerHTML = items.map(t => `
      <article class="br-card br-asset">
        <div class="br-stage br-stage--wide"><img src="${h(t.thumb)}" alt="${h(t.name)}" loading="lazy"></div>
        <h4>${h(t.name)}</h4>
        <div class="br-dls">${dl(url(t.file), `تحميل القالب (.pptx · ${fmtSize(t.size)})`)}</div>
      </article>`).join("");
  }

  function sound(items) {
    $("#soundGrid").innerHTML = items.map(s => `
      <article class="br-card br-sound">
        <h4><i class="fa-solid fa-music" aria-hidden="true"></i> ${h(s.name)}</h4>
        ${s.mp3 ? `<audio controls preload="none" src="${url(s.mp3)}"></audio>` : ""}
        ${dl(url(s.mp3 || s.wav), `تحميل (${fmtSize(s.size)})`)}
      </article>`).join("");
  }

  // Copy works on plain http too (navigator.clipboard needs https).
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (err) { /* fall back */ }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  function toast(message) {
    let el = $("#brToast");
    if (!el) { el = document.createElement("div"); el.id = "brToast"; el.className = "br-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = message;
    el.classList.add("is-shown");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("is-shown"), 2000);
  }

  function initSpy() {
    const links = new Map($$("#brNav a").map(a => [a.getAttribute("href").slice(1), a]));
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.filter(e => e.isIntersecting).forEach(entry => {
        links.forEach(link => link.classList.remove("is-active"));
        const link = links.get(entry.target.id);
        link?.classList.add("is-active");
        link?.scrollIntoView({ inline: "center", block: "nearest" });
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    links.forEach((_, id) => { const section = document.getElementById(id); if (section) observer.observe(section); });
  }

  async function init() {
    if (!$(".br")) return;
    try {
      const data = await fetch("data/brand.json").then(r => r.json());
      logos(data.logos); colors(data.colors); fonts(data.fonts); patterns(data.patterns);
      icons(data.icons); templates(data.templates); sound(data.sound);
    } catch (err) {
      console.error("تعذر تحميل بيانات الهوية:", err);
      $(".br-body").insertAdjacentHTML("beforeend", `<p class="br-sub">تعذر تحميل ملفات الهوية. حدّث الصفحة أو حاول لاحقًا.</p>`);
    }
    $("#colorsGrid")?.addEventListener("click", async e => {
      const button = e.target.closest("[data-copy]");
      if (button) toast((await copyText(button.dataset.copy)) ? `تم نسخ ${button.dataset.copy}` : "تعذّر النسخ");
    });
    initSpy();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
