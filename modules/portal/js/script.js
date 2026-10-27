// ========== Home Page Script (Prayer Times & Most Important Links from Link Library) ==========

// Current time in Makkah as seconds since midnight (prayer times are Makkah local time).
function makkahSecondsNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type).value);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

// "16:05" -> "4:05 م" (12-hour clock with ص / م).
function to12Hour(time24) {
  const [h, m] = String(time24).split(":").map(Number);
  const suffix = h >= 12 ? "م" : "ص";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

async function fetchPrayerTimes() {
  const weekdays = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const now = new Date();
  document.getElementById("today-date").textContent =
    `${weekdays[now.getDay()]}، ${now.toLocaleDateString('En-EG')}`;

  const container = document.getElementById("prayer-container");
  const nextLabel = document.getElementById("prayer-next-label");
  const countdown = document.getElementById("prayer-countdown");

  const city = "Makkah";
  const country = "SA";
  const method = 4;
  const url = `https://api.aladhan.com/v1/timingsByCity?city=${city}&country=${country}&method=${method}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const timings = data.data.timings;

    const prayers = [
      { name: "الفجر", key: "Fajr", icon: "fa-moon" },
      { name: "الظهر", key: "Dhuhr", icon: "fa-sun" },
      { name: "العصر", key: "Asr", icon: "fa-cloud-sun" },
      { name: "المغرب", key: "Maghrib", icon: "fa-cloud-moon" },
      { name: "العشاء", key: "Isha", icon: "fa-star" },
    ].map(p => {
      const [h, m] = timings[p.key].split(" ")[0].split(":").map(Number);
      const time24 = timings[p.key].split(" ")[0];
      return { ...p, time: to12Hour(time24), seconds: h * 3600 + m * 60 };
    });

    container.innerHTML = "";
    const chips = prayers.map(prayer => {
      const chip = document.createElement("div");
      chip.className = "prayer-chip";

      const icon = document.createElement("i");
      icon.className = `fas ${prayer.icon}`;
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "prayer-chip-name";
      name.textContent = prayer.name;
      const time = document.createElement("span");
      time.className = "prayer-chip-time";
      time.textContent = prayer.time;

      chip.append(icon, name, time);
      container.appendChild(chip);
      return chip;
    });

    function update() {
      const nowSec = makkahSecondsNow();
      let idx = prayers.findIndex(p => p.seconds > nowSec);
      let remaining;
      if (idx === -1) {          // after Isha: next is tomorrow's Fajr
        idx = 0;
        remaining = prayers[0].seconds + 86400 - nowSec;
      } else {
        remaining = prayers[idx].seconds - nowSec;
      }
      chips.forEach((chip, i) => chip.classList.toggle("is-next", i === idx));
      nextLabel.textContent = `الصلاة القادمة: ${prayers[idx].name} ${prayers[idx].time}`;
      countdown.textContent = ` · بعد ${formatCountdown(remaining)}`;
    }
    update();
    setInterval(update, 1000);
  } catch (e) {
    console.error("خطأ في جلب المواقيت:", e);
    nextLabel.textContent = "تعذر تحميل مواقيت الصلاة";
  }
}

// Renders one "most important" group from linksLibrary.json into a container.
async function renderImportantLinks(containerId, groupKey, limit, colClass) {
  try {
    const res = await fetch("data/linksLibrary.json");
    const data = await res.json();
    const importantLinks = data.most_important?.[groupKey];

    const container = document.getElementById(containerId);
    if (!container || !Array.isArray(importantLinks)) return;

    container.innerHTML = "";

    importantLinks.slice(0, limit).forEach(link => {
      const col = document.createElement("div");
      col.className = colClass;

      const card = document.createElement("a");
      card.className = "link-card";
      card.href = link.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.style.backgroundImage = `url('${link.image}')`;

      const overlay = document.createElement("div");
      overlay.className = "link-card-content";

      const title = document.createElement("h5");
      title.textContent = link.name;
      title.title = link.name;
      const desc = document.createElement("p");
      desc.textContent = link.description;
      overlay.append(title, desc);

      card.appendChild(overlay);
      col.appendChild(card);
      container.appendChild(col);
    });
  } catch (err) {
    console.error("فشل تحميل الروابط الهامة:", err);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<div class="col-12 text-center ">تعذر تحميل الروابط الهامة</div>`;
    }
  }
}

const loadImportantLinksOnHome = () => renderImportantLinks("important-links-home", "list", 5, "col-6 col-md mb-4");
const loadImportantLinksOnHome2 = () => renderImportantLinks("important-links-home2", "orders", 6, "col mb-4");
const loadImportantLinksOnHome3 = () => renderImportantLinks("important-links-home3", "oprations", 6, "col-6 col-md-3 mb-4");


// ========== Shared helpers (also used by js/employees.js) ==========

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Makes Arabic search forgiving: ignores diacritics and أ/إ/آ، ى/ي، ة/ه differences.
function normalizeArabic(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

// ========== Home page content (data/home.json, edited from the control panel) ==========
async function loadHomeContent() {
  try {
    const res = await fetch("data/home.json", { cache: "no-store" });
    if (!res.ok) return;
    const home = await res.json();
    const title = document.querySelector(".home-title");
    const lead = document.querySelector(".home-lead");
    if (title && home.welcomeTitle) title.textContent = home.welcomeTitle;
    if (lead && home.welcomeLead) lead.textContent = home.welcomeLead;

    const carousel = document.getElementById("mainCarousel");
    const slides = (home.slides || []).filter(slide => slide && slide.image);
    if (!carousel || !slides.length) return;
    const inner = carousel.querySelector(".carousel-inner");
    const dots = carousel.querySelector(".carousel-indicators");
    inner.innerHTML = "";
    dots.innerHTML = "";
    slides.forEach((slide, i) => {
      const item = document.createElement("div");
      item.className = "carousel-item" + (i === 0 ? " active" : "");
      const img = document.createElement("img");
      img.src = slide.image;
      img.alt = slide.alt || `إعلان ${i + 1}`;
      img.className = "d-block w-100";
      if (/^https?:\/\//i.test(slide.link || "")) {
        const a = document.createElement("a");
        a.href = slide.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(img);
        item.appendChild(a);
      } else item.appendChild(img);
      inner.appendChild(item);
      if (slides.length > 1) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.dataset.bsTarget = "#mainCarousel";
        dot.dataset.bsSlideTo = String(i);
        dot.setAttribute("aria-label", `الشريحة ${i + 1}`);
        if (i === 0) dot.className = "active";
        dots.appendChild(dot);
      }
    });
    carousel.hidden = false;
  } catch (err) {
    console.error("تعذر تحميل محتوى الرئيسية:", err);
  }
}

// ========== Employee of the month / year (home page) ==========
const ARABIC_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

async function loadRecognition() {
  const section = document.getElementById("recognition");
  const grid = document.getElementById("recoGrid");
  if (!section || !grid) return;
  try {
    const [recoRes, empRes] = await Promise.all([fetch("data/recognition.json", { cache: "no-store" }), fetch("data/employeeInfo.json")]);
    if (!recoRes.ok) return;
    const awards = (await recoRes.json()).awards || [];
    const employees = new Map((await empRes.json()).map(emp => [String(emp.Extension), emp]));

    // Everyone awarded in the newest period of each kind (several people may share a period).
    const latest = type => {
      const ofType = awards.filter(a => a.type === type && employees.has(String(a.ext)));
      const newest = ofType.map(a => String(a.period)).sort().pop();
      return ofType.filter(a => String(a.period) === newest);
    };
    const picks = [...latest("month"), ...latest("year")];
    if (!picks.length) return;

    const periodText = a => {
      if (a.type !== "month") return a.period;
      const [y, m] = String(a.period).split("-");
      return `${ARABIC_MONTHS[Number(m) - 1] || m} ${y}`;
    };
    const initials = name => String(name).trim().split(/\s+/).filter(w => !/^(م\.?|د\.?|أ\.?|معالي|الدكتور|المهندس)$/.test(w)).slice(0, 2).map(w => Array.from(w.length > 3 ? w.replace(/^ال/, "") : w)[0]).join(" ");

    grid.innerHTML = picks.map(a => {
      const emp = employees.get(String(a.ext));
      const photo = emp.Photo && !emp.Photo.includes("user-icon")
        ? `<img class="reco-photo" src="${escapeHtml(emp.Photo)}" alt="" width="96" height="96" loading="lazy">`
        : `<span class="reco-photo reco-photo--initials" aria-hidden="true">${escapeHtml(initials(emp.Name))}</span>`;
      return `
        <a class="reco-card reco-card--${a.type === "year" ? "year" : "month"}" href="employee_info.html#emp=${escapeHtml(emp.Extension)}">
          ${photo}
          <div class="reco-body">
            <span class="reco-badge"><i class="fa-solid ${a.type === "year" ? "fa-trophy" : "fa-star"}" aria-hidden="true"></i> ${a.type === "year" ? "موظف السنة" : "موظف الشهر"} · ${escapeHtml(periodText(a))}</span>
            <strong class="reco-name">${escapeHtml(String(emp.Name).trim())}</strong>
            <span class="reco-job">${escapeHtml(emp.JobName)}</span>
            ${a.note ? `<p class="reco-note">${escapeHtml(a.note)}</p>` : ""}
          </div>
        </a>`;
    }).join("");
    section.hidden = false;
  } catch (err) {
    console.error("تعذر تحميل موظف الشهر:", err);
  }
}

// ========== Sticky top bar: publish its height so sticky bars below it can sit underneath ==========
function initStickyHeader() {
  const header = document.querySelector(".header");
  if (!header) return;
  const publish = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
  publish();
  window.addEventListener("resize", publish);
  if ("ResizeObserver" in window) new ResizeObserver(publish).observe(header);
}

// ========== Page Detection ==========

document.addEventListener('DOMContentLoaded', () => {
  initStickyHeader();
   // Detect which page you're on
  const isPrayerPage = document.getElementById("prayer-container") !== null;
  const isImportantLinksHome = document.getElementById("important-links-home") !== null;
  const isImportantLinksHome2 = document.getElementById("important-links-home2") !== null;
  const isImportantLinksHome3 = document.getElementById("important-links-home3") !== null;

  if (isPrayerPage) fetchPrayerTimes();
  if (document.getElementById("mainCarousel")) loadHomeContent();
  if (document.getElementById("recognition")) loadRecognition();
  if (isImportantLinksHome) loadImportantLinksOnHome();
  if (isImportantLinksHome2) loadImportantLinksOnHome2();
  if (isImportantLinksHome3) loadImportantLinksOnHome3();


});