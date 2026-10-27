// ========== About page: live numbers, goal lists with "show more", section nav highlight ==========
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SHOWN = 6; // goals shown before "عرض المزيد"

  // Numbers come from the same data files the other pages use.
  async function loadNumbers() {
    const set = (id, value) => { const node = document.getElementById(id); if (node && value != null) node.textContent = value; };
    try {
      const [employees, org, locations] = await Promise.all([
        fetch("data/employeeInfo.json").then(r => r.json()),
        fetch("data/orgStructure.json").then(r => r.json()),
        fetch("data/locations.json").then(r => r.json()),
      ]);
      set("abEmployees", employees.length);
      set("abSectors", (org.sections || []).length);
      set("abLocations", locations.length);
    } catch (err) {
      console.error("تعذر تحميل أرقام الجمعية:", err);
    }
  }

  function initGoalLists() {
    $$(".ab-list").forEach(list => {
      const items = $$("li", list);
      const counter = $(`[data-count-for="#${list.id}"]`);
      if (counter) counter.textContent = items.length;
      const button = $(`[data-more-for="#${list.id}"]`);
      if (items.length <= SHOWN) { if (button) button.hidden = true; return; }
      let expanded = false;
      const apply = () => {
        items.forEach((li, i) => { li.hidden = !expanded && i >= SHOWN; });
        if (button) button.textContent = expanded ? "عرض أقل" : `عرض المزيد (${items.length - SHOWN})`;
      };
      apply();
      button?.addEventListener("click", () => { expanded = !expanded; apply(); });
    });
  }

  // Highlights the nav link of the section being read.
  function initSpy() {
    const links = new Map($$("#abNav a").map(a => [a.getAttribute("href").slice(1), a]));
    if (!links.size || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.filter(e => e.isIntersecting).forEach(entry => {
        links.forEach(link => link.classList.remove("is-active"));
        links.get(entry.target.id)?.classList.add("is-active");
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    links.forEach((_, id) => { const section = document.getElementById(id); if (section) observer.observe(section); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$(".about-page")) return;
    loadNumbers();
    initGoalLists();
    initSpy();
  });
})();
