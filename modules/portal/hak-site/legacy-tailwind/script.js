(function () {
  const $ = (sel) => document.querySelector(sel);

  // year
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // mobile menu
  const btn = $("#mobileMenuBtn");
  const menu = $("#mobileMenu");
  if (btn && menu) {
    btn.addEventListener("click", () => menu.classList.toggle("hidden"));
    menu.addEventListener("click", (e) => {
      if (e.target && e.target.matches("a.nav-link")) menu.classList.add("hidden");
    });
  }

  // Smooth scroll for in-page anchors
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href^='#']");
    if (!a) return;
    const id = a.getAttribute("href");
    const target = id && document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Helpers
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return await res.json();
  }

  // Render Services
  const servicesGrid = $("#servicesGrid");
  if (servicesGrid) {
    loadJson("data/services.json")
      .then((items) => {
        servicesGrid.innerHTML = items
          .map(
            (it) => `
            <div class="p-8 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition">
              <h3 class="text-xl font-extrabold text-[#017768] mb-3">${escapeHtml(it.title)}</h3>
              <p class="text-gray-600 leading-relaxed">${escapeHtml(it.desc)}</p>
            </div>`
          )
          .join("");
      })
      .catch((err) => console.error(err));
  }

  // Render Partnerships
  const partnersGrid = $("#partnersGrid");
  if (partnersGrid) {
    loadJson("data/partnerships.json")
      .then((items) => {
        partnersGrid.innerHTML = items
          .map(
            (it) => `
            <div class="p-7 rounded-2xl bg-gray-50 border border-gray-100">
              <h3 class="text-lg font-extrabold text-[#017768] mb-2">${escapeHtml(it.title)}</h3>
              <p class="text-gray-600 leading-relaxed">${escapeHtml(it.desc)}</p>
            </div>`
          )
          .join("");
      })
      .catch((err) => console.error(err));
  }

  // Render News (home)
  const newsGrid = $("#newsGrid");
  if (newsGrid) {
    loadJson("data/news.json")
      .then((items) => {
        newsGrid.innerHTML = items
          .map(
            (it) => `
            <article class="rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-sm hover:shadow-md transition">
              <div class="h-44 bg-gray-100">
                <img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.title)}" class="w-full h-full object-cover" loading="lazy">
              </div>
              <div class="p-6">
                <div class="flex items-center justify-between gap-3 mb-3 text-sm font-bold">
                  <span class="px-3 py-1 rounded-full bg-[#007361]/10 text-[#007361]">${escapeHtml(it.category || "خبر")}</span>
                  <span class="text-gray-500">${escapeHtml(it.date)}</span>
                </div>
                <h3 class="text-lg font-extrabold text-[#007361] mb-2">${escapeHtml(it.title)}</h3>
                <p class="text-gray-600 leading-relaxed line-clamp-3">${escapeHtml((it.content || "").split("\n")[0])}</p>
                <div class="mt-4">
                  <a href="news.html" class="font-extrabold text-[#007361] hover:underline">اقرأ المزيد</a>
                </div>
              </div>
            </article>`
          )
          .join("");
      })
      .catch((err) => console.error(err));
  }

  // Render News Archive page
  const archive = $("#newsArchive");
  if (archive) {
    loadJson("data/news.json")
      .then((items) => {
        archive.innerHTML = items
          .map(
            (it) => `
            <article class="rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-sm">
              <div class="h-44 bg-gray-100">
                <img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.title)}" class="w-full h-full object-cover" loading="lazy">
              </div>
              <div class="p-6">
                <div class="flex items-center justify-between gap-3 mb-3 text-sm font-bold">
                  <span class="px-3 py-1 rounded-full bg-[#007361]/10 text-[#007361]">${escapeHtml(it.category || "خبر")}</span>
                  <span class="text-gray-500">${escapeHtml(it.date)}</span>
                </div>
                <h2 class="text-xl font-extrabold text-[#007361] mb-4">${escapeHtml(it.title)}</h2>
                <div class="text-gray-700 leading-relaxed space-y-3">
                  ${(it.content || "")
                    .split("\n")
                    .filter(Boolean)
                    .map((p) => `<p>${escapeHtml(p)}</p>`)
                    .join("")}
                </div>
              </div>
            </article>`
          )
          .join("");
      })
      .catch((err) => console.error(err));
  }
})();
