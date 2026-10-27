// ========== Links library page: every system / site, grouped by category, searchable ==========
// Data: data/linksLibrary.json -> { categories: { "التصنيف": [ { name, description, url } ] } }
(() => {
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const ICONS = {
    "الروابط العامة": "fa-globe", "التطوع": "fa-hand-holding-heart", "الاعلام": "fa-photo-film", "التقنية": "fa-laptop-code",
    "البرامج": "fa-diagram-project", "تنمية الموارد": "fa-seedling", "الموارد البشرية": "fa-users", "المالية": "fa-coins",
    "الخطط والاستراتيجية": "fa-bullseye", "المساعدات": "fa-handshake-angle",
  };
  const clean = value => String(value ?? "").replace(/ /g, " ").trim();
  const iconOf = category => ICONS[category] || "fa-folder";

  let links = [];
  const state = { category: "all", query: "" };

  function normalise(data) {
    const list = [];
    Object.entries(data?.categories || {}).forEach(([rawCategory, items]) => {
      const category = clean(rawCategory);
      (items || []).forEach(item => {
        const name = clean(item.name);
        const url = clean(item.url);
        if (!name || !/^https?:\/\//i.test(url)) return;
        let host = "";
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (err) { host = ""; }
        list.push({
          name, category, url, host, description: clean(item.description),
          search: normalizeArabic(`${name} ${item.description || ""} ${category} ${host}`),
        });
      });
    });
    return list;
  }

  const categories = () => [...new Set(links.map(l => l.category))];
  const visible = () => {
    const term = normalizeArabic(state.query);
    return links.filter(l => (state.category === "all" || l.category === state.category) && (!term || l.search.includes(term)));
  };

  function renderPills() {
    const pill = (id, label, count, icon) => `
      <button type="button" class="lnk-pill${state.category === id ? " is-active" : ""}" data-category="${h(id)}" aria-pressed="${state.category === id}">
        ${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i>` : ""}<span>${h(label)}</span><span class="lnk-pill-n">${count}</span>
      </button>`;
    $("#linkPills").innerHTML = pill("all", "الكل", links.length, "")
      + categories().map(c => pill(c, c, links.filter(l => l.category === c).length, iconOf(c))).join("");
  }

  let cardIndex = 0;
  function cardHtml(link) {
    return `
      <article class="lnk-card" style="--i:${Math.min(cardIndex++, 12)}">
        <div class="lnk-card-top">
          <span class="lnk-icon" aria-hidden="true"><i class="fa-solid ${iconOf(link.category)}"></i></span>
          <button type="button" class="lnk-copy" data-copy="${h(link.url)}" aria-label="نسخ رابط ${h(link.name)}" title="نسخ الرابط"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
        </div>
        <h3 class="lnk-name">${h(link.name)}</h3>
        ${link.description ? `<p class="lnk-desc">${h(link.description)}</p>` : ""}
        <p class="lnk-host" dir="ltr">${h(link.host)}</p>
        <a class="lnk-open" href="${h(link.url)}" target="_blank" rel="noopener noreferrer">فتح الرابط <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
      </article>`;
  }

  function render() {
    renderPills();
    const list = visible();
    const box = $("#categories");
    box.setAttribute("aria-busy", "false");
    $("#linksNoResults").hidden = list.length > 0;
    $("#linksCount").textContent = list.length === links.length ? `${links.length} رابط` : `عرض ${list.length} من ${links.length} رابط`;
    cardIndex = 0;
    // "الكل" groups the cards under their category; a single category is just a grid.
    if (state.category === "all") {
      box.innerHTML = categories().map(category => {
        const items = list.filter(l => l.category === category);
        return items.length ? `
          <section class="lnk-group" aria-label="${h(category)}">
            <h2 class="lnk-group-title"><i class="fa-solid ${iconOf(category)}" aria-hidden="true"></i>${h(category)}<span>${items.length}</span></h2>
            <div class="lnk-grid">${items.map(cardHtml).join("")}</div>
          </section>` : "";
      }).join("");
    } else {
      box.innerHTML = list.length ? `<div class="lnk-grid">${list.map(cardHtml).join("")}</div>` : "";
    }
  }

  // Copy works on plain http too (navigator.clipboard needs https).
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (err) { /* fall back */ }
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
    let el = $("#lnkToast");
    if (!el) { el = document.createElement("div"); el.id = "lnkToast"; el.className = "lnk-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = message;
    el.classList.add("is-shown");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("is-shown"), 2000);
  }

  async function init() {
    const box = $("#categories");
    if (!box) return;
    try {
      const res = await fetch("data/linksLibrary.json");
      links = normalise(await res.json());
    } catch (err) {
      console.error("تعذر تحميل بيانات مكتبة الروابط", err);
      box.innerHTML = `<div class="lnk-empty"><h2>تعذر تحميل الروابط</h2><p>حدّث الصفحة أو حاول لاحقًا.</p></div>`;
      return;
    }
    $("#lnkStatLinks").textContent = links.length;
    $("#lnkStatCats").textContent = categories().length;
    $("#linkPills").addEventListener("click", e => {
      const pill = e.target.closest("[data-category]");
      if (pill) { state.category = pill.dataset.category; render(); }
    });
    $("#linksFilter").addEventListener("input", e => { state.query = e.target.value; render(); });
    box.addEventListener("click", async e => {
      const button = e.target.closest("[data-copy]");
      if (button) toast((await copyText(button.dataset.copy)) ? "تم نسخ الرابط" : "تعذّر النسخ");
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
