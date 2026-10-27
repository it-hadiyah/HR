const $ = (sel, root = document) => root.querySelector(sel);

async function loadData() {
  const candidates = ["./data/site.json", "data/site.json", "/data/site.json", "./site.json", "/site.json"];
  let lastErr = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();

      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} عند ${url} | preview: ${text.slice(0, 120)}`);
        continue;
      }

      try {
        return JSON.parse(text);
      } catch {
        lastErr = new Error(`فشل JSON.parse عند ${url} | preview: ${text.slice(0, 120)}`);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("تعذر تحميل site.json من جميع المسارات المحتملة.");
}

function setMeta(data) {
  const title = data.site?.title_ar || "هدية الخير للاستثمار";
  document.title = title;

  const desc = data.site?.description || "";
  const meta = document.querySelector('meta[name="description"]');
  if (meta && desc) meta.setAttribute("content", desc);
}

function setBrand(data) {
  const site = data.site || {};

  // Colors (هوية)
  document.documentElement.style.setProperty("--primary", site.primaryColor || "#017768");
  document.documentElement.style.setProperty("--accent", site.accentColor || "#b9995e");

  // Text
//  $("#brandTitle").textContent = site.title_ar || "هدية الخير للاستثمار"; //
//  $("#brandTag").textContent = site.tagline_ar || "ذراع استثماري غير ربحي لخدمة ضيوف الرحمن"; //
  $("#footerBrand").textContent = site.title_ar || "هدية الخير للاستثمار";

  // Logos
  const headerLogo = site.logoHeader || site.logoUrl || "";
  const heroLogo = site.logoHero || site.logoUrl || headerLogo;

  const brandLogoEl = document.getElementById("brandLogo");
  if (brandLogoEl && headerLogo) brandLogoEl.src = headerLogo;

  const heroLogoEl = document.getElementById("heroLogo");
  if (heroLogoEl && heroLogo) heroLogoEl.src = heroLogo;

  // Hero pattern
  const patternHero = site.patternHero || "";
  if (patternHero) document.documentElement.style.setProperty("--hero-pattern", `url("${patternHero}")`);

  // Hero brand texts
  const ar = $("#heroBrandAr");
const en = $("#heroBrandEn");
if (ar) ar.textContent = data.hero?.brand_ar || "";
if (en) en.textContent = data.hero?.brand_en || "";
}

function renderNav(nav) {
  const ul = $("#navMenu");
  ul.innerHTML = (nav || [])
    .map((item) => `<li><a href="#${item.id}" data-section="${item.id}">${item.label}</a></li>`)
    .join("");
}

function renderHero(hero) {
  $("#heroTitlePrimary").textContent = hero.titlePrimary || "نطور الاستثمار";
  $("#heroTitleAccent").textContent = hero.titleAccent || "لنرتقي بالخدمة";
  $("#heroSubtitle").textContent = hero.subtitle || "";

  const outline = $("#heroBtnOutline");
  outline.textContent = hero.btnOutline?.label || "مجالات الاستثمار";
  outline.href = hero.btnOutline?.href || "#services";

  const solid = $("#heroBtnSolid");
  solid.textContent = hero.btnSolid?.label || "عن هدية الخير";
  solid.href = hero.btnSolid?.href || "#about";

  $("#headerCta").textContent = hero.headerCta || "تواصل معنا";
}

function renderServices(services) {
  $("#servicesTitle").textContent = services.title || "مجالات العمل";
  $("#servicesLead").textContent = services.lead || "";

  $("#servicesGrid").innerHTML = (services.items || [])
    .map(
      (s) => `
      <article class="card reveal">
        <h3 class="cardTitle">${s.title}</h3>
        <p class="cardText">${s.text}</p>
      </article>`
    )
    .join("");
}

function renderAbout(about) {
  $("#aboutTitle").textContent = about.title || "من نحن";
  $("#aboutLead").textContent = about.lead || "";

  $("#aboutCards").innerHTML = (about.cards || [])
    .map(
      (c) => `
      <article class="card reveal">
        <h3 class="cardTitle">${c.title}</h3>
        <p class="cardText">${c.text}</p>
      </article>`
    )
    .join("");
}

function renderGovernance(g) {
  $("#governanceTitle").textContent = g.title || "الشراكات والحوكمة";
  $("#governanceLead").textContent = g.lead || "";

  $("#governancePoints").innerHTML = (g.points || []).map((p) => `<li>${p}</li>`).join("");
  $("#governanceLinks").innerHTML = (g.links || []).map((l) => `<a href="${l.href || "#"}">${l.label}</a>`).join("");
}

function renderMedia(m) {
  $("#mediaTitle").textContent = m.title || "المركز الإعلامي";
  $("#mediaLead").textContent = m.lead || "";

  $("#mediaGrid").innerHTML = (m.items || [])
    .map(
      (x) => `
      <article class="card reveal">
        <h3 class="cardTitle">${x.title}</h3>
        <p class="cardText">${x.summary}</p>
        <p class="cardText" style="margin-top:10px;font-weight:900;color:#64748b">${x.date || ""}</p>
      </article>`
    )
    .join("");
}

function renderContact(c) {
  $("#contactTitle").textContent = c.title || "تواصل معنا";
  $("#contactLead").textContent = c.lead || "";

  $("#contactChannels").innerHTML = (c.channels || [])
    .map(
      (x) => `
      <div class="kv__row">
        <div class="kv__k">${x.label}</div>
        <div class="kv__v">${x.value}</div>
      </div>`
    )
    .join("");
}

function renderFooter(f) {
  const year = new Date().getFullYear();
  $("#footerCopy").textContent = `${f?.copyright || "© جميع الحقوق محفوظة"} ${year}`;
}

/* UX */
function initMobileNav() {
  const toggle = $("#navToggle");
  const menu = $("#navMenu");

  toggle?.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  menu?.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    menu.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
  });
}

function initReveal() {
  const els = Array.from(document.querySelectorAll(".reveal"));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  els.forEach((el) => io.observe(el));
}

function initContactForm() {
  const form = $("#contactForm");
  const note = $("#formNote");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const message = String(fd.get("message") || "").trim();

    if (name.length < 2 || !email.includes("@") || message.length < 10) {
      note.textContent = "فضلاً تحقق من البيانات المدخلة ثم أعد المحاولة.";
      return;
    }

    note.textContent = "تم استلام رسالتك (نسخة تجريبية).";
    form.reset();
  });
}

function initScrollProgress() {
  const bar = $("#scrollProgress");
  if (!bar) return;

  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? (doc.scrollTop / max) * 100 : 0;
    bar.style.width = `${p.toFixed(2)}%`;
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function initBackToTop() {
  const btn = $("#toTop");
  if (!btn) return;

  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    btn.classList.toggle("is-visible", y > 520);
  };

  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function initActiveNav() {
  const links = Array.from(document.querySelectorAll("[data-section]"));
  const sections = links.map((a) => document.getElementById(a.dataset.section)).filter(Boolean);

  const setActive = (id) => links.forEach((a) => a.classList.toggle("is-active", a.dataset.section === id));

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.id) setActive(visible.target.id);
    },
    { threshold: [0.18, 0.3, 0.45], rootMargin: "-10% 0px -70% 0px" }
  );

  sections.forEach((s) => io.observe(s));
  if (sections[0]?.id) setActive(sections[0].id);
}

async function main() {
  try {
    const data = await loadData();
    setMeta(data);
    setBrand(data);

    renderNav(data.nav || []);
    renderHero(data.hero || {});
    renderServices(data.services || {});
    renderAbout(data.about || {});
    renderGovernance(data.governance || {});
    renderMedia(data.media || {});
    renderContact(data.contact || {});
    renderFooter(data.footer || {});

    initMobileNav();
    initReveal();
    initContactForm();
    initScrollProgress();
    initBackToTop();
    initActiveNav();
  } catch (err) {
    console.error(err);
    alert("خطأ تحميل البيانات: " + (err?.message || err));
  }
}

main();
