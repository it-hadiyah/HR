// ========== Locations page: branches grouped by city, searchable, with map directions ==========
// Data: data/locations.json -> [ { branch, branchPhoto, mapLink, city?, type?, address?, phone?, hours? } ]
// "city" / "type" are optional: when missing the city is read from the name ("الفرع الإداري - مكة") and the type from keywords.
(() => {
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const clean = value => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const TYPES = [[/الإداري|الاداري/, "إداري"], [/تحصيل/, "تحصيل"], [/كشك/, "كشك"], [/معرض/, "معرض"]];

  let places = [];
  const state = { city: "all", query: "" };

  function normalise(raw) {
    return raw.map(item => {
      const full = clean(item.branch);
      const cut = full.lastIndexOf(" - ");
      const city = clean(item.city) || (cut > 0 ? full.slice(cut + 3) : "");
      const name = cut > 0 && !item.city ? full.slice(0, cut).trim() : full;
      const type = clean(item.type) || (TYPES.find(([re]) => re.test(full)) || [0, "فرع"])[1];
      return {
        name, city, type, mapLink: clean(item.mapLink), photo: clean(item.branchPhoto),
        address: clean(item.address), phone: clean(item.phone), hours: clean(item.hours),
        search: normalizeArabic(`${full} ${city} ${type} ${item.address || ""}`),
      };
    }).filter(p => p.name);
  }

  const cities = () => [...new Set(places.map(p => p.city).filter(Boolean))];
  const visible = () => {
    const term = normalizeArabic(state.query);
    return places.filter(p => (state.city === "all" || p.city === state.city) && (!term || p.search.includes(term)));
  };

  function renderPills() {
    const pill = (id, label, count) => `
      <button type="button" class="loc-pill${state.city === id ? " is-active" : ""}" data-city="${h(id)}" aria-pressed="${state.city === id}">
        <span>${h(label)}</span><span class="loc-pill-n">${count}</span>
      </button>`;
    $("#locationPills").innerHTML = pill("all", "كل المدن", places.length)
      + cities().map(c => pill(c, c, places.filter(p => p.city === c).length)).join("");
  }

  function cardHtml(p, i) {
    const detail = (icon, text) => text ? `<li><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${h(text)}</span></li>` : "";
    return `
      <article class="loc-card" style="--i:${Math.min(i, 12)}">
        <div class="loc-photo">
          ${p.photo ? `<img src="${h(p.photo)}" alt="${h(p.name)}" loading="lazy">` : ""}
          <span class="loc-type">${h(p.type)}</span>
        </div>
        <div class="loc-info">
          <h3 class="loc-name">${h(p.name)}</h3>
          <ul class="loc-details">
            ${detail("fa-location-dot", p.city)}${detail("fa-map", p.address)}${detail("fa-phone", p.phone)}${detail("fa-clock", p.hours)}
          </ul>
          <div class="loc-actions">
            ${p.mapLink ? `<a class="loc-btn loc-btn--primary" href="${h(p.mapLink)}" target="_blank" rel="noopener"><i class="fa-solid fa-location-arrow" aria-hidden="true"></i> الاتجاهات</a>
            <button type="button" class="loc-btn loc-btn--ghost" data-copy="${h(p.mapLink)}" aria-label="نسخ رابط الموقع"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>` : ""}
          </div>
        </div>
      </article>`;
  }

  function render() {
    renderPills();
    const list = visible();
    const box = $("#locations-container");
    box.setAttribute("aria-busy", "false");
    $("#locationCount").textContent = list.length === places.length ? `${places.length} موقع` : `عرض ${list.length} من ${places.length} موقع`;
    box.innerHTML = list.length
      ? `<div class="loc-grid">${list.map(cardHtml).join("")}</div>`
      : `<div class="loc-empty"><span aria-hidden="true"><i class="fa-solid fa-map-location-dot"></i></span><h2>لا توجد نتائج</h2><p>جرّب كلمات بحث أخرى أو اختر مدينة مختلفة.</p></div>`;
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
    let el = $("#locToast");
    if (!el) { el = document.createElement("div"); el.id = "locToast"; el.className = "loc-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = message;
    el.classList.add("is-shown");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("is-shown"), 2000);
  }

  async function init() {
    const box = $("#locations-container");
    if (!box) return;
    try {
      const res = await fetch("data/locations.json");
      places = normalise(await res.json());
    } catch (err) {
      console.error("فشل تحميل الفروع:", err);
      box.innerHTML = `<div class="loc-empty"><h2>تعذر تحميل المواقع</h2><p>حدّث الصفحة أو حاول لاحقًا.</p></div>`;
      return;
    }
    $("#locStatCount").textContent = places.length;
    $("#locStatCities").textContent = cities().length;
    $("#locationPills").addEventListener("click", e => {
      const pill = e.target.closest("[data-city]");
      if (pill) { state.city = pill.dataset.city; render(); }
    });
    $("#locationSearch").addEventListener("input", e => { state.query = e.target.value; render(); });
    box.addEventListener("click", async e => {
      const button = e.target.closest("[data-copy]");
      if (button) toast((await copyText(button.dataset.copy)) ? "تم نسخ رابط الموقع" : "تعذّر النسخ");
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
