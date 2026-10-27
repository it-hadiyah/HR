// ========== Employee page: org chart + directory ==========
// Loaded by employee_info.html after js/script.js (uses its escapeHtml / normalizeArabic helpers).
// Everything is built from data/employeeInfo.json + data/orgStructure.json; no employee data lives in the HTML.
(() => {
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOBILE = window.matchMedia("(max-width: 767.98px)");
  const OTHER_SECTION = { id: "other", title: "أخرى", kind: "other" };
  const CARD_W = 168;      // org-chart card width (px), keep in sync with --oc-card in employees.css
  const GAP = 16;          // gap between org-chart cards (px)
  const BUS_Y = 28;        // vertical distance from a parent card to the connector bus (px)
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // ---------- data + state ----------
  let allEmployees = [];
  let orgStructure = { sections: [] };
  let employeesByExt = new Map();

  // Lookups built once after the data loads.
  const model = {
    nodes: new Map(),        // unit id -> node
    sections: [],            // top-level nodes (the pills)
    chartRoots: [],          // roots shown by "الكل"
    chartParent: new Map(),  // unit id -> parent in the "الكل" chart (board > CEO > sectors)
    info: new Map(),         // extension -> { node, isHead, chain, titles, sectorId, sectorTitle, deptTitle, managerExt }
    reports: new Map(),      // extension -> [direct report extensions]
    hasLocation: false,
  };

  const state = {
    view: "org",             // "org" | "directory"
    sector: "all",           // pill: "all" or a top-level section id
    query: "",               // live text filter (directory view)
    filters: { dept: "", job: "", location: "" },
    sort: "default",
    open: new Set(),         // unit ids whose children/people are shown
    multi: false,            // true after "فتح الكل": several units may stay open side by side
    focusId: null,           // last unit the user opened (drives the breadcrumb and the deep link)
    highlightExt: null,      // employee located through the search
    justOpened: null,        // unit that should play the "enter" animation on the next render
    drawerExt: null,
  };

  // ---------- small helpers ----------
  const hasPhoto = emp => !!emp.Photo && !emp.Photo.includes("user-icon");
  const displayName = emp => String(emp.Name ?? "").trim();
  const shortTitle = title => String(title).replace(/^قطاع\s+/, "").replace("الرئيس التنفيذي ومكاتبه", "الرئيس التنفيذي");

  // Initials for employees without a photo (skips titles such as "م." / "د." / "معالي").
  function getInitials(name) {
    const titles = /^(م\.?|د\.?|أ\.?|معالي|الدكتور|المهندس|الاستاذ|الأستاذ|سعادة)$/;
    const words = String(name ?? "").trim().split(/\s+/).filter(w => w && !titles.test(w));
    // Drop the definite article "ال" so "المحمادي" gives "م", not "ا".
    const letters = words.map(w => Array.from(w.length > 3 ? w.replace(/^ال/, "") : w)[0]);
    return letters.slice(0, 2).join(" ");
  }

  function avatarHtml(emp, cls) {
    return hasPhoto(emp)
      ? `<img class="${cls}" src="${h(emp.Photo)}" alt="" width="64" height="64" loading="lazy">`
      : `<span class="${cls} ${cls}--initials" aria-hidden="true">${h(getInitials(emp.Name))}</span>`;
  }

  // Coarse job groups for the "المسمى الوظيفي" filter, derived from the free-text job names.
  function jobCategory(job) {
    const text = String(job ?? "").trim();
    if (/^(رئيس|الرئيس|مدير|نائب|مكتب|امين|أمين)/.test(text)) return "القيادة والإدارة";
    if (/مشرف|مسؤول|مسئول/.test(text)) return "الإشراف والمسؤولون";
    if (/أخصائي|اخصائي|إخصائي|اخصائيه/.test(text)) return "الأخصائيون";
    if (/محاسب|مراجع/.test(text)) return "المحاسبة والمراجعة";
    if (/سكرتير|مساعد/.test(text)) return "السكرتارية والدعم";
    return "أخرى";
  }

  // ---------- toast + copy (works on plain http where navigator.clipboard is unavailable) ----------
  function showToast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-shown");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove("is-shown"), 2200);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fall back below */ }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  async function copyWithToast(text, message) {
    showToast((await copyText(text)) ? message : "تعذّر النسخ، انسخ النص يدويًا");
  }

  // ---------- model ----------
  function countPeople(node) {
    return node.heads.length + node.members.length + node.children.reduce((sum, child) => sum + countPeople(child), 0);
  }

  function forEachUnit(nodes, callback) {
    nodes.forEach(node => { callback(node); forEachUnit(node.children, callback); });
  }

  // Parent in the full chart, falling back to the organisational parent.
  const chartParentOf = node => model.chartParent.get(node.id) || node.parent || null;
  const kidsOf = node => (state.sector === "all" ? node.kids : node.children);
  const peopleOf = node => [...node.heads.slice(1), ...node.members].map(ext => employeesByExt.get(ext)).filter(Boolean);
  const isExpandable = node => kidsOf(node).length > 0 || peopleOf(node).length > 0;

  function buildModel() {
    model.nodes.clear();
    model.chartParent.clear();
    model.info.clear();
    model.reports.clear();
    employeesByExt = new Map(allEmployees.map(emp => [String(emp.Extension), emp]));
    const placed = new Set();
    const exts = list => (list || []).map(String).filter(ext => employeesByExt.has(ext));

    const make = (unit, parent, sectorId) => {
      const node = {
        id: unit.id, title: unit.title, kind: unit.kind || "unit",
        heads: exts(unit.heads), members: exts(unit.members),
        children: [], kids: null, parent, sectorId: sectorId || unit.id, synthetic: false,
      };
      [...node.heads, ...node.members].forEach(ext => placed.add(ext));
      model.nodes.set(node.id, node);
      node.children = (unit.children || []).map(child => make(child, node, node.sectorId));
      node.kids = node.children;
      return node;
    };
    model.sections = orgStructure.sections.map(section => make(section, null, null));

    // Employees missing from orgStructure.json land in an "أخرى" section instead of disappearing.
    const unassigned = allEmployees.filter(emp => !placed.has(String(emp.Extension)));
    if (unassigned.length) {
      const other = make({ ...OTHER_SECTION, members: unassigned.map(emp => emp.Extension) }, null, null);
      model.sections.push(other);
    }

    // "الكل" shows the real reporting line: board > CEO > the sectors (the CEO's own offices grouped first).
    const board = model.nodes.get("board");
    const ceo = model.nodes.get("ceo");
    model.chartRoots = model.sections.filter(s => s.kind !== "sector" && s.kind !== "ceo" && s.kind !== "board");
    if (board && ceo) {
      const offices = {
        id: "ceo-offices", title: "مكاتب الرئيس التنفيذي", kind: "unit", heads: [], members: [],
        children: ceo.children, kids: ceo.children, parent: ceo, sectorId: ceo.id, synthetic: true,
      };
      model.nodes.set(offices.id, offices);
      ceo.kids = [offices, ...model.sections.filter(s => s.kind === "sector")];
      // The company sits directly under the board, next to the CEO.
      const companies = model.chartRoots.filter(r => r.kind === "company");
      board.kids = [...board.children, ceo, ...companies];
      model.chartRoots = model.chartRoots.filter(r => r.kind !== "company");
      model.chartRoots.unshift(board);
      [board, ceo, offices].forEach(node => node.kids.forEach(kid => model.chartParent.set(kid.id, node)));
    } else {
      model.chartRoots = [...model.sections];
    }

    // Who is where, who reports to whom.
    model.hasLocation = allEmployees.some(emp => emp.Location);
    const walk = (node, chain, titles) => {
      const nodeChain = [...chain, node.id];
      const nodeTitles = [...titles, node.title];
      const sector = model.nodes.get(node.sectorId);
      [...node.heads.map(e => [e, true]), ...node.members.map(e => [e, false])].forEach(([ext, isHead]) => {
        model.info.set(ext, {
          node, isHead, chain: nodeChain, titles: nodeTitles,
          sectorId: node.sectorId, sectorTitle: sector.title, deptTitle: node.title, managerExt: null,
        });
      });
      node.children.forEach(child => walk(child, nodeChain, nodeTitles));
    };
    model.sections.forEach(section => walk(section, [], []));

    model.info.forEach((info, ext) => {
      info.managerExt = findManager(ext, info);
      if (info.managerExt) {
        if (!model.reports.has(info.managerExt)) model.reports.set(info.managerExt, []);
        model.reports.get(info.managerExt).push(ext);
      }
    });
  }

  // A member reports to the head of the unit; a head (or a member of a headless unit) to the nearest head above.
  function findManager(ext, info) {
    if (!info.isHead && info.node.heads[0]) return info.node.heads[0];
    let node = chartParentOf(info.node);
    while (node) {
      if (node.heads[0]) return node.heads[0];
      node = chartParentOf(node);
    }
    return null;
  }

  // ---------- search ----------
  // Wraps every match of the (Arabic-normalised) search term in <mark>, returning safe HTML.
  function buildHighlight(rawTerm) {
    const term = normalizeArabic(rawTerm);
    if (!term) return null;
    const letterClasses = { "ا": "[اأإآ]", "ي": "[يى]", "ه": "[هة]" };
    const optionalMarks = "[\\u064B-\\u0652\\u0640]*";
    const pattern = Array.from(term)
      .map(ch => letterClasses[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(optionalMarks);
    let regex;
    try { regex = new RegExp(pattern, "gi"); } catch (err) { return null; }
    return text => {
      const raw = String(text ?? "");
      let html = "";
      let last = 0;
      for (const match of raw.matchAll(regex)) {
        if (!match[0]) continue;
        html += h(raw.slice(last, match.index)) + `<mark class="hl">${h(match[0])}</mark>`;
        last = match.index + match[0].length;
      }
      return html + h(raw.slice(last));
    };
  }

  function matchesQuery(emp, term) {
    if (!term) return true;
    const info = model.info.get(String(emp.Extension));
    const haystack = normalizeArabic([emp.Name, emp.JobName, emp.email, emp.Extension, info?.deptTitle, info?.sectorTitle].join(" "));
    return term.split(/\s+/).every(word => haystack.includes(word));
  }

  let suggestItems = [];
  let suggestIndex = -1;

  function computeSuggestions(raw) {
    const term = normalizeArabic(raw);
    if (!term) return [];
    const people = [];
    allEmployees.forEach(emp => {
      const name = normalizeArabic(emp.Name);
      let score = -1;
      if (name.startsWith(term) || name.split(/\s+/).some(word => word.startsWith(term))) score = 0;
      else if (name.includes(term) || String(emp.Extension).startsWith(term)) score = 1;
      else if (normalizeArabic(emp.JobName).includes(term)) score = 2;
      else if (normalizeArabic(emp.email).includes(term)) score = 3;
      else if (normalizeArabic(model.info.get(String(emp.Extension))?.deptTitle).includes(term)) score = 4;
      if (score >= 0) people.push({ emp, score });
    });
    people.sort((a, b) => a.score - b.score);
    const units = [...model.nodes.values()].filter(node => !node.synthetic && normalizeArabic(node.title).includes(term)).slice(0, 3);
    return [
      ...people.slice(0, 6).map(item => ({ type: "emp", emp: item.emp })),
      ...units.map(node => ({ type: "unit", node })),
    ];
  }

  function closeSuggestions() {
    const list = $("#orgSuggest");
    const input = $("#employeeFilter");
    if (list) list.hidden = true;
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    suggestItems = [];
    suggestIndex = -1;
  }

  function setSuggestIndex(index) {
    const list = $("#orgSuggest");
    if (!list || !suggestItems.length) return;
    suggestIndex = (index + suggestItems.length) % suggestItems.length;
    [...list.children].forEach((li, i) => {
      li.classList.toggle("is-active", i === suggestIndex);
      li.setAttribute("aria-selected", String(i === suggestIndex));
    });
    const active = list.children[suggestIndex];
    $("#employeeFilter")?.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function renderSuggestions() {
    const input = $("#employeeFilter");
    const list = $("#orgSuggest");
    if (!input || !list) return;
    suggestItems = computeSuggestions(input.value);
    suggestIndex = -1;
    if (!suggestItems.length) {
      if (input.value.trim()) {
        list.innerHTML = `<li class="suggest-empty" role="presentation">لا توجد نتائج مطابقة</li>`;
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      } else closeSuggestions();
      return;
    }
    const hl = buildHighlight(input.value) || h;
    list.innerHTML = "";
    suggestItems.forEach((item, i) => {
      const li = document.createElement("li");
      li.id = `sugg-${i}`;
      li.className = "suggest-item";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      if (item.type === "emp") {
        const emp = item.emp;
        const info = model.info.get(String(emp.Extension));
        li.innerHTML = `
          ${avatarHtml(emp, "sg-avatar")}
          <span class="sg-text">
            <span class="sg-main">${hl(displayName(emp))}</span>
            <span class="sg-sub">${hl(emp.JobName)}${info ? " · " + h(info.deptTitle) : ""}</span>
          </span>
          <span class="sg-ext" dir="ltr">${h(emp.Extension)}</span>`;
      } else {
        const node = item.node;
        const parent = node.parent;
        li.innerHTML = `
          <span class="sg-avatar sg-avatar--unit" aria-hidden="true"><i class="fa-solid fa-sitemap"></i></span>
          <span class="sg-text">
            <span class="sg-main">${hl(node.title)}</span>
            <span class="sg-sub">${parent ? "وحدة ضمن " + h(parent.title) : "قطاع / وحدة رئيسية"}</span>
          </span>
          <span class="sg-ext">${countPeople(node)}</span>`;
      }
      // pointerdown + preventDefault keeps the input focused so the list does not close before the click.
      li.addEventListener("pointerdown", e => { e.preventDefault(); selectSuggestion(item); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function selectSuggestion(item) {
    const input = $("#employeeFilter");
    closeSuggestions();
    if (item.type === "emp") {
      if (input) input.value = displayName(item.emp);
      $("#searchClear").hidden = false;
      locateEmployee(String(item.emp.Extension));
    } else {
      if (input) input.value = item.node.title;
      $("#searchClear").hidden = false;
      state.highlightExt = null;
      goToUnit(chainOf(item.node));
    }
  }

  function clearSearch() {
    const input = $("#employeeFilter");
    if (input) input.value = "";
    $("#searchClear").hidden = true;
    state.query = "";
    state.highlightExt = null;
    closeSuggestions();
    render();
  }

  function initSearch() {
    const input = $("#employeeFilter");
    if (!input) return;
    input.addEventListener("input", () => {
      $("#searchClear").hidden = !input.value;
      state.highlightExt = null;
      renderSuggestions();
      if (state.view === "directory") { state.query = normalizeArabic(input.value); render(); }
      else if (state.query) { state.query = ""; }
    });
    input.addEventListener("focus", () => { if (input.value.trim()) renderSuggestions(); });
    input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); if ($("#orgSuggest").hidden) renderSuggestions(); setSuggestIndex(suggestIndex + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIndex(suggestIndex - 1); }
      else if (e.key === "Enter") {
        const item = suggestItems[suggestIndex >= 0 ? suggestIndex : 0];
        if (item) { e.preventDefault(); selectSuggestion(item); }
      } else if (e.key === "Escape") {
        if (!$("#orgSuggest").hidden) closeSuggestions(); else if (input.value) clearSearch();
      }
    });
    $("#searchClear")?.addEventListener("click", () => { clearSearch(); input.focus(); });
    // "/" jumps to the search box from anywhere on the page.
    document.addEventListener("keydown", e => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  // ---------- org-chart navigation ----------
  const chainOf = node => {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.unshift(n.id);
    return chain;
  };

  // Opens a unit together with everything above it (both the organisational and the "الكل" chart ancestors).
  function openPathTo(node) {
    state.open.add(node.id);
    for (let n = node.parent; n; n = n.parent) state.open.add(n.id);
    for (let n = chartParentOf(node); n; n = chartParentOf(n)) state.open.add(n.id);
  }

  function defaultOpen() {
    state.open = new Set();
    state.multi = false;
    state.focusId = null;
    if (state.sector === "all") {
      ["board", "ceo"].forEach(id => model.nodes.has(id) && state.open.add(id));
      if (!state.open.size) model.chartRoots.forEach(root => state.open.add(root.id));
    } else {
      state.open.add(state.sector);
    }
  }

  function descendantsOf(node, into = new Set()) {
    [...node.kids, ...node.children].forEach(kid => { into.add(kid.id); descendantsOf(kid, into); });
    return into;
  }

  function toggleNode(id, parentId) {
    const node = model.nodes.get(id);
    if (!node) return;
    if (state.open.has(id)) {
      state.open.delete(id);
      descendantsOf(node).forEach(d => state.open.delete(d));
      const parent = parentId ? model.nodes.get(parentId) : null;
      state.focusId = parent && !parent.synthetic ? parent.id : null;
      state.justOpened = null;
    } else {
      if (!state.multi && parentId) {
        // One open sibling at a time keeps the chart a single readable path.
        model.nodes.get(parentId)?.[state.sector === "all" ? "kids" : "children"].forEach(sibling => {
          if (sibling.id === id) return;
          state.open.delete(sibling.id);
          descendantsOf(sibling).forEach(d => state.open.delete(d));
        });
      }
      state.open.add(id);
      state.focusId = node.synthetic ? null : id;
      state.justOpened = id;
    }
    renderChartKeepingAnchor(id);
    syncHash();
    renderCrumbs();
  }

  function setAllOpen(open) {
    if (open) {
      state.multi = true;
      const visit = nodes => nodes.forEach(node => {
        if (isExpandable(node)) state.open.add(node.id);
        visit(kidsOf(node));
      });
      visit(currentRoots());
    } else defaultOpen();
    state.justOpened = null;
    renderChart();
    renderCrumbs();
    syncHash();
  }

  function goToUnit(chain) {
    const node = model.nodes.get(chain[chain.length - 1]);
    if (!node) return;
    state.view = "org";
    const under = state.sector !== "all" && node.sectorId === state.sector;
    if (!under) state.sector = "all";
    state.open = new Set();
    state.multi = false;
    openPathTo(node);
    state.focusId = node.synthetic ? null : node.id;
    state.justOpened = node.id;
    render();
    requestAnimationFrame(() => {
      const target = $(`.oc-item[data-id="${CSS.escape(node.id)}"] .oc-card`);
      target?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
    });
  }

  // Search result: show the employee where he sits in the chart (or in the grid) and highlight the card.
  function locateEmployee(ext) {
    const info = model.info.get(ext);
    if (!info) return;
    state.highlightExt = ext;
    if (state.view === "org") {
      if (state.sector !== "all" && info.sectorId !== state.sector) state.sector = "all";
      state.open = new Set();
      state.multi = false;
      openPathTo(info.node);
      state.focusId = info.node.synthetic ? null : info.node.id;
      state.justOpened = info.node.id;
      render();
      requestAnimationFrame(() => {
        const target = $(`#employee-cards [data-ext="${CSS.escape(ext)}"]`);
        target?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
      });
    } else {
      // Make sure the card is not hidden by an active filter.
      const emp = employeesByExt.get(ext);
      const visible = directoryList().includes(emp);
      if (!visible) { state.sector = "all"; state.filters = { dept: "", job: "", location: "" }; state.query = ""; }
      render();
      requestAnimationFrame(() => {
        $(`.emp-card[data-ext="${CSS.escape(ext)}"]`)?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
      });
    }
  }

  // ---------- URL hash: "#directory" or "#section/unit/sub" ----------
  function parseHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
    if (!hash) return null;
    if (hash === "directory") return { view: "directory" };
    const person = hash.match(/^emp=(\d+)$/);
    if (person) return { emp: person[1] };
    const chain = hash.split("/").filter(Boolean);
    return chain.length && chain.every(id => model.nodes.has(id)) ? { chain } : null;
  }

  function syncHash() {
    let hash = "";
    if (state.view === "directory") hash = "#directory";
    else if (state.focusId && model.nodes.has(state.focusId)) hash = "#" + chainOf(model.nodes.get(state.focusId)).join("/");
    if (hash !== location.hash) history.replaceState(null, "", location.pathname + location.search + hash);
  }

  // ---------- rendering: employee card (used by the grid and by the org chart) ----------
  function empCardHtml(emp, index = 0) {
    const ext = String(emp.Extension);
    const info = model.info.get(ext);
    const hl = ext === state.highlightExt ? " is-hl" : "";
    return `
      <article class="emp-card${hl}${starClass(ext)}" data-ext="${h(ext)}" style="--i:${Math.min(index, 14)}">
        ${starBadge(ext)}
        ${avatarHtml(emp, "emp-avatar")}
        <h3 class="emp-name">${h(displayName(emp))}</h3>
        <p class="emp-job">${h(emp.JobName)}</p>
        <p class="emp-meta" title="${h(info?.deptTitle || "")}"><i class="fa-regular fa-building" aria-hidden="true"></i><span>${h(info?.deptTitle || "")}</span></p>
        <p class="emp-meta"><i class="fa-solid fa-phone" aria-hidden="true"></i><bdi dir="ltr">${h(ext)}</bdi></p>
        <button type="button" class="emp-btn" data-action="profile" data-ext="${h(ext)}" aria-label="عرض ملف ${h(displayName(emp))}">عرض الملف</button>
      </article>`;
  }

  // ---------- rendering: org chart ----------
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };

  function currentRoots() {
    if (state.sector === "all") return model.chartRoots;
    const root = model.nodes.get(state.sector);
    return root ? [root] : [];
  }

  function perRow(count, depth) {
    if (MOBILE.matches || depth === 0) return count;
    const width = $("#employee-cards")?.clientWidth || 1100;
    return Math.max(1, Math.min(8, Math.floor((width + GAP) / (CARD_W + GAP))));
  }

  // Even rows (7 + 2 becomes 5 + 4).
  function chunk(list, size) {
    if (!MOBILE.matches && list.length <= size) return [list];
    const rows = Math.ceil(list.length / size);
    const each = Math.ceil(list.length / rows);
    return Array.from({ length: rows }, (_, i) => list.slice(i * each, (i + 1) * each));
  }

  function unitCardHtml(node, parentId) {
    const head = node.heads[0] ? employeesByExt.get(node.heads[0]) : null;
    const total = countPeople(node);
    const expandable = isExpandable(node);
    const isOpen = state.open.has(node.id) && expandable;
    const hl = head && String(head.Extension) === state.highlightExt ? " is-hl" : "";
    const label = total ? `${total} موظف` : "";
    const toggle = expandable
      ? `<button type="button" class="oc-toggle" data-action="toggle" data-id="${h(node.id)}" data-parent="${h(parentId || "")}" aria-expanded="${isOpen}" aria-label="${isOpen ? "طي" : "فتح"} ${h(node.title)}">
           <span>${label}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
         </button>`
      : `<span class="oc-toggle oc-toggle--static"><span>${label}</span></span>`;
    const body = head
      ? `<button type="button" class="oc-person" data-action="profile" data-ext="${h(head.Extension)}" aria-label="عرض ملف ${h(displayName(head))}">
           ${avatarHtml(head, "oc-avatar")}
           <span class="oc-name">${h(displayName(head))}</span>
           <span class="oc-job">${h(head.JobName)}</span>
         </button>
         <span class="oc-unit">${h(node.title)}</span>`
      : `<span class="oc-icon" aria-hidden="true"><i class="fa-solid ${node.synthetic ? "fa-building-user" : "fa-sitemap"}"></i></span>
         <span class="oc-unit oc-unit--main">${h(node.title)}</span>`;
    return `
      <div class="oc-card${isOpen ? " is-open" : ""}${hl}${head ? "" : " oc-card--unit"}${head ? starClass(head.Extension) : ""}"${head ? ` data-ext="${h(head.Extension)}"` : ""}>
        ${head ? starBadge(head.Extension) : ""}
        ${body}${toggle}
      </div>`;
  }

  function levelEl(nodes, parentId, depth, solo) {
    const level = el("div", "oc-level" + (parentId ? " oc-level--child" : ""));
    chunk(nodes, perRow(nodes.length, depth)).forEach((rowNodes, rowIndex) => {
      const row = el("div", "oc-row" + (solo && rowIndex === 0 ? " has-bus" : ""));
      rowNodes.forEach(node => {
        const item = el("div", "oc-item" + (state.open.has(node.id) && isExpandable(node) ? " is-open" : ""), unitCardHtml(node, parentId));
        item.dataset.id = node.id;
        row.appendChild(item);
      });
      level.appendChild(row);

      const openNodes = rowNodes.filter(node => state.open.has(node.id) && isExpandable(node));
      if (openNodes.length) {
        const groups = el("div", "oc-groups");
        const single = openNodes.length === 1;
        groups.dataset.solo = single ? "1" : "0";
        openNodes.forEach(node => groups.appendChild(groupEl(node, depth + 1, single)));
        level.appendChild(groups);
      }
    });
    return level;
  }

  // Members of a unit are drawn as chart cards too (same look as the managers above them).
  function personCardHtml(emp) {
    const ext = String(emp.Extension);
    return `
      <div class="oc-card oc-card--person${ext === state.highlightExt ? " is-hl" : ""}${starClass(ext)}" data-ext="${h(ext)}">
        ${starBadge(ext)}
        <button type="button" class="oc-person" data-action="profile" data-ext="${h(ext)}" aria-label="عرض ملف ${h(displayName(emp))}">
          ${avatarHtml(emp, "oc-avatar")}
          <span class="oc-name">${h(displayName(emp))}</span>
          <span class="oc-job">${h(emp.JobName)}</span>
        </button>
        <span class="oc-ext"><i class="fa-solid fa-phone" aria-hidden="true"></i><bdi dir="ltr">${h(ext)}</bdi></span>
      </div>`;
  }

  function peopleLevelEl(people, parentId, depth, solo) {
    const level = el("div", "oc-level oc-level--people" + (solo ? " oc-level--child" : ""));
    chunk(people, perRow(people.length, depth)).forEach((rowPeople, rowIndex) => {
      const row = el("div", "oc-row" + (solo && rowIndex === 0 ? " has-bus" : ""));
      rowPeople.forEach(emp => {
        const item = el("div", "oc-item", personCardHtml(emp));
        item.dataset.person = emp.Extension;
        row.appendChild(item);
      });
      level.appendChild(row);
    });
    return level;
  }

  function groupEl(node, depth, solo) {
    const group = el("div", "oc-group" + (state.justOpened === node.id && !REDUCED_MOTION ? " is-entering" : ""));
    group.dataset.of = node.id;
    if (!solo) group.appendChild(el("p", "oc-group-label", `<i class="fa-solid fa-turn-down fa-flip-horizontal" aria-hidden="true"></i> ${h(node.title)}`));
    const kids = kidsOf(node);
    if (kids.length) group.appendChild(levelEl(kids, node.id, depth, solo));
    const people = peopleOf(node);
    if (people.length) group.appendChild(peopleLevelEl(people, node.id, depth, solo && !kids.length));
    return group;
  }

  function renderChart() {
    const container = $("#employee-cards");
    container.innerHTML = "";
    const chart = el("div", "oc");
    const roots = currentRoots();
    // The chain from the board down is the main chart; companies / "other" sit apart as separate roots.
    const main = state.sector === "all" ? roots.filter(r => r.kind === "board") : roots;
    const apart = state.sector === "all" ? roots.filter(r => r.kind !== "board") : [];
    if (main.length) chart.appendChild(levelEl(main, null, 0, false));
    else if (state.sector === "all") roots.forEach(root => chart.appendChild(levelEl([root], null, 0, false)));
    if (state.sector === "all" && main.length && apart.length) {
      const extra = el("div", "oc-apart");
      extra.appendChild(el("p", "oc-eyebrow", "جهات خارج الهيكل الرسمي"));
      extra.appendChild(levelEl(apart, null, 0, false));
      chart.appendChild(extra);
    }
    container.appendChild(chart);
    layoutJoints();
    state.justOpened = null;
  }

  // Connector lines: from the opened card down to a horizontal bus above its children's row.
  function layoutJoints() {
    $$(".oc-bus").forEach(bus => bus.remove());
    if (MOBILE.matches) return;
    $$(".oc-groups[data-solo='1']").forEach(groups => {
      const row = groups.previousElementSibling;
      const parentCard = row && $(".oc-item.is-open .oc-card", row);
      const childRow = $(":scope > .oc-group > .oc-level > .oc-row", groups);
      if (!parentCard || !childRow) return;
      const base = groups.getBoundingClientRect();
      const centre = rect => rect.left + rect.width / 2 - base.left;
      const parentX = centre(parentCard.getBoundingClientRect());
      const xs = [parentX, ...[...childRow.children].map(item => centre(item.getBoundingClientRect()))];
      const min = Math.min(...xs);
      const max = Math.max(...xs);
      const line = (left, top, width, height) => {
        const bus = el("span", "oc-bus");
        bus.setAttribute("aria-hidden", "true");
        bus.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
        groups.appendChild(bus);
      };
      line(parentX - 1, 0, 2, BUS_Y + 2);
      if (max - min > 1) line(min - 1, BUS_Y, max - min + 2, 2);
    });
  }

  // Keeps the clicked card where it was on screen while the content around it changes height.
  function renderChartKeepingAnchor(id) {
    const find = () => $(`.oc-item[data-id="${CSS.escape(id)}"] .oc-card`);
    const before = find()?.getBoundingClientRect().top;
    renderChart();
    const after = find()?.getBoundingClientRect().top;
    if (before != null && after != null && Math.abs(after - before) > 0.5) {
      window.scrollTo({ top: window.scrollY + (after - before), behavior: "instant" });
    }
    // If the newly opened content starts below the fold, bring it into view.
    const group = $(`.oc-group[data-of="${CSS.escape(id)}"]`);
    if (group && state.open.has(id)) {
      const top = group.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.75) {
        window.scrollBy({ top: top - window.innerHeight * 0.45, behavior: REDUCED_MOTION ? "auto" : "smooth" });
      }
    }
  }

  // ---------- directory ----------
  const personName = emp => normalizeArabic(displayName(emp).replace(/^(م\.|د\.|معالي|الدكتور|المهندس|الاستاذ|الأستاذ|سعادة)\s*/, ""));
  const arCompare = (a, b) => String(a).localeCompare(String(b), "ar");

  function directoryList() {
    const { dept, job, location } = state.filters;
    const list = allEmployees.filter(emp => {
      const info = model.info.get(String(emp.Extension));
      if (!info) return false;
      if (state.sector !== "all" && info.sectorId !== state.sector) return false;
      if (dept && info.node.id !== dept) return false;
      if (job && jobCategory(emp.JobName) !== job) return false;
      if (location && emp.Location !== location) return false;
      return matchesQuery(emp, state.query);
    });
    const order = new Map(model.sections.map((s, i) => [s.id, i]));
    const byName = (a, b) => arCompare(personName(a), personName(b));
    // Default order: the leadership chain first (board, CEO, sector heads, finance, Madinah, the company), then by extension.
    const leaders = ["board", "ceo", "shared", "comms", "programs", "finance", "madinah", "company"]
      .map(id => model.nodes.get(id)?.heads[0]).filter(Boolean);
    const rank = emp => {
      const i = leaders.indexOf(String(emp.Extension));
      return i < 0 ? leaders.length : i;
    };
    const sorters = {
      default: (a, b) => (rank(a) - rank(b)) || (Number(a.Extension) - Number(b.Extension)),
      name: byName,
      title: (a, b) => arCompare(a.JobName, b.JobName) || byName(a, b),
      department: (a, b) => {
        const ia = model.info.get(String(a.Extension));
        const ib = model.info.get(String(b.Extension));
        return (order.get(ia.sectorId) - order.get(ib.sectorId)) || arCompare(ia.deptTitle, ib.deptTitle) || byName(a, b);
      },
    };
    return list.sort(sorters[state.sort] || byName);
  }

  function renderDirectory() {
    const container = $("#employee-cards");
    const list = directoryList();
    if (!list.length) {
      container.innerHTML = `
        <div class="empty">
          <span class="empty-icon" aria-hidden="true"><i class="fa-solid fa-user-magnifying-glass"></i></span>
          <h2>لا توجد نتائج</h2>
          <p>جرّب كلمات بحث مختلفة أو أعد تعيين الفلاتر.</p>
          <button type="button" class="btn-primary" data-action="reset-all">إعادة تعيين</button>
        </div>`;
      return;
    }
    container.innerHTML = `<div class="dir-grid">${list.map((emp, i) => empCardHtml(emp, i)).join("")}</div>`;
  }

  // ---------- controls: pills, filters, breadcrumb, counts ----------
  function renderPills() {
    const nav = $("#orgNav");
    const inner = $("#orgNavInner");
    if (!nav || !inner) return;
    nav.hidden = false;
    const pill = (id, label, count) => `
      <button type="button" class="pill${state.sector === id ? " is-active" : ""}" data-sector="${h(id)}" aria-pressed="${state.sector === id}">
        <span>${h(label)}</span><span class="pill-n">${count}</span>
      </button>`;
    inner.innerHTML = pill("all", "الكل", allEmployees.length)
      + model.sections.map(section => pill(section.id, shortTitle(section.title), countPeople(section))).join("");
  }

  function renderFilterOptions() {
    const option = (value, label, selected) => `<option value="${h(value)}"${selected ? " selected" : ""}>${h(label)}</option>`;
    $("#filterSector").innerHTML = option("all", "كل القطاعات", state.sector === "all")
      + model.sections.map(s => option(s.id, shortTitle(s.title), state.sector === s.id)).join("");

    const units = [];
    forEachUnit(model.sections, node => {
      if (node.heads.length + node.members.length && (state.sector === "all" || node.sectorId === state.sector)) units.push(node);
    });
    $("#filterDept").innerHTML = option("", "كل الإدارات والأقسام", !state.filters.dept)
      + units.map(node => option(node.id, node.title, state.filters.dept === node.id)).join("");

    const jobs = [...new Set(allEmployees.map(emp => jobCategory(emp.JobName)))].sort(arCompare);
    $("#filterJob").innerHTML = option("", "كل المسميات", !state.filters.job)
      + jobs.map(job => option(job, job, state.filters.job === job)).join("");

    $("#filterLocationField").hidden = !model.hasLocation;
    if (model.hasLocation) {
      const places = [...new Set(allEmployees.map(emp => emp.Location).filter(Boolean))].sort(arCompare);
      $("#filterLocation").innerHTML = option("", "كل المواقع", !state.filters.location)
        + places.map(place => option(place, place, state.filters.location === place)).join("");
    }
    const active = (state.sector !== "all") + !!state.filters.dept + !!state.filters.job + !!state.filters.location;
    const badge = $("#filtersBadge");
    badge.hidden = !active;
    badge.textContent = active;
  }

  function resetFilters() {
    state.sector = "all";
    state.filters = { dept: "", job: "", location: "" };
  }

  function renderCrumbs() {
    const nav = $("#breadcrumb");
    if (!nav) return;
    const items = [{ label: "الرئيسية", href: "index.html" }];
    items.push({ label: state.view === "org" ? "الهيكل التنظيمي" : "دليل الموظفين", go: "root" });
    const sector = state.sector !== "all" ? model.nodes.get(state.sector) : null;
    if (sector) items.push({ label: sector.title, go: "sector:" + sector.id });
    if (state.view === "org" && state.focusId) {
      const focus = model.nodes.get(state.focusId);
      chainOf(focus).map(id => model.nodes.get(id)).forEach(node => {
        if (sector && node.id === sector.id) return;
        items.push({ label: node.title, go: "unit:" + node.id });
      });
    } else if (state.view === "directory" && state.filters.dept) {
      const node = model.nodes.get(state.filters.dept);
      if (node && node.id !== state.sector) items.push({ label: node.title, go: "unit:" + node.id });
    }
    nav.innerHTML = `<ol>${items.map((item, i) => {
      const last = i === items.length - 1;
      const inner = last ? `<span aria-current="page">${h(item.label)}</span>`
        : item.href ? `<a href="${h(item.href)}">${h(item.label)}</a>`
        : `<button type="button" data-go="${h(item.go)}">${h(item.label)}</button>`;
      return `<li>${inner}${last ? "" : '<i class="fa-solid fa-chevron-left crumb-sep" aria-hidden="true"></i>'}</li>`;
    }).join("")}</ol>`;
  }

  function renderCount() {
    const counter = $("#employeeCount");
    if (!counter) return;
    if (state.view === "directory") {
      counter.textContent = `عرض ${directoryList().length} من ${allEmployees.length} موظف`;
    } else {
      const sector = state.sector !== "all" ? model.nodes.get(state.sector) : null;
      counter.textContent = sector ? `${countPeople(sector)} موظف في ${shortTitle(sector.title)}` : `${allEmployees.length} موظف`;
    }
  }

  function render() {
    renderPills();
    renderFilterOptions();
    renderCrumbs();
    renderCount();
    $("#orgTools").hidden = state.view !== "org";
    $("#sortWrap").hidden = state.view !== "directory";
    $$(".seg-btn").forEach(btn => {
      const active = btn.dataset.view === state.view;
      btn.setAttribute("aria-selected", String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    if (state.view === "org") renderChart(); else renderDirectory();
    $("#employee-cards").setAttribute("aria-busy", "false");
    syncHash();
  }

  function setView(view) {
    if (state.view === view) return;
    state.view = view;
    if (view === "directory") {
      // A name picked from the suggestions should not silently filter the grid.
      state.query = "";
      state.highlightExt = null;
      const input = $("#employeeFilter");
      if (input) input.value = "";
      $("#searchClear").hidden = true;
    } else {
      state.query = "";
      if (!state.open.size) defaultOpen();
    }
    render();
  }

  function setSector(id) {
    state.sector = id;
    state.filters.dept = "";
    if (state.view === "org") defaultOpen();
    render();
  }

  function initControls() {
    $$(".seg-btn").forEach(btn => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
      btn.addEventListener("keydown", e => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = $$(".seg-btn").find(b => b !== btn);
        next.focus();
        setView(next.dataset.view);
      });
    });

    $("#orgNavInner")?.addEventListener("click", e => {
      const pill = e.target.closest("[data-sector]");
      if (pill) setSector(pill.dataset.sector);
    });

    const panel = $("#filtersPanel");
    const button = $("#filtersBtn");
    button?.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
    });
    // Filtering is a list operation, so changing a filter from the chart switches to the directory.
    const apply = () => {
      if (state.view === "org") { state.view = "directory"; state.query = normalizeArabic($("#employeeFilter")?.value || ""); }
      render();
    };
    $("#filterSector")?.addEventListener("change", e => { state.sector = e.target.value; state.filters.dept = ""; apply(); });
    $("#filterDept")?.addEventListener("change", e => { state.filters.dept = e.target.value; apply(); });
    $("#filterJob")?.addEventListener("change", e => { state.filters.job = e.target.value; apply(); });
    $("#filterLocation")?.addEventListener("change", e => { state.filters.location = e.target.value; apply(); });
    $("#filtersReset")?.addEventListener("click", () => { resetFilters(); if (state.view === "org") defaultOpen(); render(); });

    $("#sortBy")?.addEventListener("change", e => { state.sort = e.target.value; render(); });
    $("#orgExpandAll")?.addEventListener("click", () => setAllOpen(true));
    $("#orgCollapseAll")?.addEventListener("click", () => setAllOpen(false));

    $("#breadcrumb")?.addEventListener("click", e => {
      const crumb = e.target.closest("[data-go]");
      if (!crumb) return;
      const [kind, id] = crumb.dataset.go.split(":");
      if (kind === "root") { resetFilters(); state.highlightExt = null; defaultOpen(); render(); }
      else if (kind === "sector") { state.filters.dept = ""; state.sector = id; if (state.view === "org") defaultOpen(); render(); }
      else if (kind === "unit") {
        if (state.view === "org") goToUnit(chainOf(model.nodes.get(id)));
        else { state.filters.dept = id; render(); }
      }
    });

    // One delegated listener for everything inside the chart / grid.
    $("#employee-cards")?.addEventListener("click", e => {
      const action = e.target.closest("[data-action]");
      if (action) {
        const { action: name } = action.dataset;
        if (name === "toggle") toggleNode(action.dataset.id, action.dataset.parent || null);
        else if (name === "profile") openDrawer(action.dataset.ext);
        else if (name === "reset-all") { resetFilters(); state.query = ""; const input = $("#employeeFilter"); if (input) input.value = ""; $("#searchClear").hidden = true; render(); }
        return;
      }
      const card = e.target.closest(".emp-card");
      if (card) openDrawer(card.dataset.ext);
    });

    let resizeTimer;
    let lastMobile = MOBILE.matches;
    let lastPerRow = perRow(99, 1);
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.view !== "org") return;
        const per = perRow(99, 1);
        if (lastMobile !== MOBILE.matches || lastPerRow !== per) {
          lastMobile = MOBILE.matches;
          lastPerRow = per;
          renderChart();
        } else layoutJoints();
      }, 120);
    });

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (state.drawerExt) closeDrawer();
      else if (panel && !panel.hidden && !e.defaultPrevented && document.activeElement?.id !== "employeeFilter") {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ---------- profile drawer ----------
  function downloadVCard(emp) {
    const esc = value => String(value ?? "").replace(/\\/g, "\\\\").replace(/[;,]/g, m => "\\" + m).replace(/\r?\n/g, "\\n");
    const name = displayName(emp);
    const lines = [
      "BEGIN:VCARD", "VERSION:3.0", `N:;${esc(name)};;;`, `FN:${esc(name)}`,
      `ORG:${esc("جمعية هدية الحاج والمعتمر")}`, `TITLE:${esc(emp.JobName)}`,
      `EMAIL;TYPE=WORK:${emp.email}`, `NOTE:${esc("التحويلة الداخلية: " + emp.Extension)}`, "END:VCARD",
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/vcard;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    // ASCII file name (from the email) so every browser keeps the .vcf extension; the Arabic name stays inside the file.
    link.download = `${(String(emp.email).split("@")[0] || "contact-" + emp.Extension).replace(/[^\w.-]/g, "_")}.vcf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("تم تجهيز جهة الاتصال");
  }

  // Employee of the month / year: the newest period of each kind (several people may share it).
  const awardsByExt = new Map();
  const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const awardPeriod = (type, period) => {
    if (type !== "month") return String(period);
    const [y, m] = String(period).split("-");
    return `${AR_MONTHS[Number(m) - 1] || m} ${y}`;
  };

  async function loadAwards() {
    try {
      const res = await fetch("data/recognition.json", { cache: "no-store" });
      if (!res.ok) return;
      const awards = (await res.json()).awards || [];
      ["month", "year"].forEach(type => {
        const ofType = awards.filter(a => a.type === type);
        const latest = ofType.map(a => String(a.period)).sort().pop();
        ofType.filter(a => String(a.period) === latest).forEach(a => {
          const entry = awardsByExt.get(String(a.ext)) || {};
          entry[type] = { period: a.period, note: a.note || "" };
          awardsByExt.set(String(a.ext), entry);
        });
      });
    } catch (err) { /* awards are optional */ }
  }

  // Year wins over month for the card style; the badge says what the person was chosen for.
  function starOf(ext) {
    const entry = awardsByExt.get(String(ext));
    if (!entry) return null;
    const kind = entry.year ? "year" : "month";
    const parts = [];
    if (entry.year) parts.push(`موظف السنة ${awardPeriod("year", entry.year.period)}`);
    if (entry.month) parts.push(`موظف الشهر ${awardPeriod("month", entry.month.period)}`);
    return { kind, title: parts.join(" · "), entry };
  }
  const starClass = ext => { const s = starOf(ext); return s ? ` is-star is-star--${s.kind}` : ""; };
  const starBadge = ext => {
    const s = starOf(ext);
    return s ? `<span class="star-badge" title="${h(s.title)}"><i class="fa-solid ${s.kind === "year" ? "fa-trophy" : "fa-star"}" aria-hidden="true"></i>${s.kind === "year" ? "موظف السنة" : "موظف الشهر"}</span>` : "";
  };

  // Committees the person belongs to (data/committees.json is optional; the page works without it).
  let committeeData = [];
  const committeesOf = ext => committeeData
    .filter(c => (c.members || []).some(m => String(m.ext) === String(ext)))
    .map(c => ({ name: c.name, role: c.members.find(m => String(m.ext) === String(ext)).role || "عضو" }));

  const personRow = ext => {
    const emp = employeesByExt.get(ext);
    if (!emp) return "";
    return `<button type="button" class="dp-person" data-action="profile" data-ext="${h(ext)}">
      ${avatarHtml(emp, "dp-mini")}
      <span><strong>${h(displayName(emp))}</strong><small>${h(emp.JobName)}</small></span>
      <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
    </button>`;
  };

  function drawerHtml(emp) {
    const ext = String(emp.Extension);
    const info = model.info.get(ext);
    const reports = model.reports.get(ext) || [];
    const shown = reports.slice(0, 6);
    return `
      <div class="dp-top">
        <button type="button" class="dp-close" data-action="close" aria-label="إغلاق"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div class="dp-body">
        <div class="dp-head">
          ${avatarHtml(emp, "dp-avatar")}
          <h2 id="empDrawerName" class="dp-name">${h(displayName(emp))}</h2>
          <p class="dp-job">${h(emp.JobName)}</p>
          ${info ? `<p class="dp-where"><span>${h(info.sectorTitle)}</span>${info.deptTitle !== info.sectorTitle ? `<i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>${h(info.deptTitle)}</span>` : ""}</p>` : ""}
        </div>

        ${starOf(ext) ? `<div class="dp-star dp-star--${starOf(ext).kind}"><strong><i class="fa-solid ${starOf(ext).kind === "year" ? "fa-trophy" : "fa-star"}" aria-hidden="true"></i> ${h(starOf(ext).title)}</strong>${["year", "month"].map(t => starOf(ext).entry[t]?.note ? `<p>${h(starOf(ext).entry[t].note)}</p>` : "").join("")}</div>` : ""}
        <dl class="dp-list">
          <div><dt><i class="fa-solid fa-building" aria-hidden="true"></i> القطاع</dt><dd>${h(info?.sectorTitle || "—")}</dd></div>
          ${info && info.deptTitle !== info.sectorTitle ? `<div><dt><i class="fa-regular fa-building" aria-hidden="true"></i> الإدارة / القسم</dt><dd>${h(info.deptTitle)}</dd></div>` : ""}
          <div><dt><i class="fa-solid fa-phone" aria-hidden="true"></i> الرقم الداخلي</dt>
            <dd><bdi dir="ltr">${h(ext)}</bdi><button type="button" class="dp-copy" data-action="copy-ext" aria-label="نسخ الرقم الداخلي"><i class="fa-regular fa-copy" aria-hidden="true"></i></button></dd></div>
          <div><dt><i class="fa-solid fa-envelope" aria-hidden="true"></i> البريد الإلكتروني</dt>
            <dd><a dir="ltr" href="mailto:${h(emp.email)}">${h(emp.email)}</a><button type="button" class="dp-copy" data-action="copy-mail" aria-label="نسخ البريد"><i class="fa-regular fa-copy" aria-hidden="true"></i></button></dd></div>
        </dl>

        ${committeesOf(ext).length ? `<section class="dp-section"><h3>اللجان <span>${committeesOf(ext).length}</span></h3><div class="dp-people">${committeesOf(ext).map(c => `<a class="dp-person" href="committees.html"><span><strong>${h(c.name)}</strong><small>${h(c.role)}</small></span><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></a>`).join("")}</div></section>` : ""}
        ${info?.managerExt ? `<section class="dp-section"><h3>المدير المباشر</h3>${personRow(info.managerExt)}</section>` : ""}
        ${reports.length ? `<section class="dp-section"><h3>المرؤوسون المباشرون <span>${reports.length}</span></h3>
          <div class="dp-people">${shown.map(personRow).join("")}</div>
          ${reports.length > shown.length ? `<p class="dp-more">و ${reports.length - shown.length} آخرين</p>` : ""}</section>` : ""}
      </div>
      <div class="dp-actions">
        <button type="button" class="btn-primary" data-action="show-in-chart"><i class="fa-solid fa-sitemap" aria-hidden="true"></i> عرض في الهيكل التنظيمي</button>
        <div class="dp-actions-row">
          <a class="btn-outline" href="mailto:${h(emp.email)}"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> إرسال بريد</a>
          <button type="button" class="btn-outline" data-action="vcard"><i class="fa-regular fa-address-card" aria-hidden="true"></i> حفظ جهة الاتصال</button>
        </div>
      </div>`;
  }

  let lastFocus = null;

  function ensureDrawer() {
    let drawer = $("#empDrawer");
    if (drawer) return drawer;
    const overlay = el("div", "dp-overlay");
    overlay.id = "empDrawerOverlay";
    drawer = el("aside", "dp");
    drawer.id = "empDrawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "empDrawerName");
    drawer.inert = true;
    document.body.append(overlay, drawer);
    overlay.addEventListener("click", closeDrawer);
    drawer.addEventListener("click", e => {
      const action = e.target.closest("[data-action]");
      if (!action) return;
      const emp = employeesByExt.get(state.drawerExt);
      switch (action.dataset.action) {
        case "close": closeDrawer(); break;
        case "profile": openDrawer(action.dataset.ext); break;
        case "copy-ext": copyWithToast(String(emp.Extension), "تم نسخ الرقم الداخلي"); break;
        case "copy-mail": copyWithToast(emp.email, "تم نسخ البريد"); break;
        case "vcard": downloadVCard(emp); break;
        case "show-in-chart": {
          const ext = state.drawerExt;
          closeDrawer(false);
          state.view = "org";
          locateEmployee(ext);
          break;
        }
      }
    });
    // Keep Tab inside the dialog while it is open.
    drawer.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const focusables = $$("button, a[href]", drawer).filter(node => !node.disabled);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return drawer;
  }

  function openDrawer(ext) {
    const emp = employeesByExt.get(String(ext));
    if (!emp) return;
    const drawer = ensureDrawer();
    if (!state.drawerExt) lastFocus = document.activeElement;
    state.drawerExt = String(ext);
    drawer.innerHTML = drawerHtml(emp);
    drawer.scrollTop = 0;
    drawer.inert = false;
    $(".dp-body", drawer).scrollTop = 0;
    drawer.classList.add("is-open");
    $("#empDrawerOverlay").classList.add("is-open");
    $(".dp-close", drawer)?.focus({ preventScroll: true });
  }

  function closeDrawer(restoreFocus = true) {
    const drawer = $("#empDrawer");
    if (!drawer || !state.drawerExt) return;
    state.drawerExt = null;
    drawer.classList.remove("is-open");
    drawer.inert = true;
    $("#empDrawerOverlay")?.classList.remove("is-open");
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  // ---------- hero numbers ----------
  function animateCount(node, target) {
    if (!node) return;
    if (REDUCED_MOTION) { node.textContent = target; return; }
    const start = performance.now();
    const duration = 700;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function initHero() {
    let units = 0;
    forEachUnit(model.sections.filter(s => s.kind !== "other"), () => { units++; });
    animateCount($("#statEmployees"), allEmployees.length);
    animateCount($("#statSections"), model.sections.filter(s => s.kind !== "other").length);
    animateCount($("#statUnits"), units);
  }

  // ---------- start ----------
  async function loadEmployees() {
    try {
      const [empRes, orgRes] = await Promise.all([fetch("data/employeeInfo.json"), fetch("data/orgStructure.json")]);
      allEmployees = await empRes.json();
      // Without a structure file everyone falls into the "other" section instead of breaking the page.
      orgStructure = orgRes.ok ? await orgRes.json() : { sections: [] };

      await loadAwards();
      try {
        const res = await fetch("data/committees.json", { cache: "no-store" });
        if (res.ok) committeeData = (await res.json()).committees || [];
      } catch (err) { /* committees are optional */ }

      buildModel();
      initSearch();
      initControls();
      initHero();
      defaultOpen();

      const start = parseHash();
      if (start?.view === "directory") state.view = "directory";
      render();
      if (start?.chain) setTimeout(() => goToUnit(start.chain), 200);
      if (start?.emp) setTimeout(() => openDrawer(start.emp), 200);
      window.addEventListener("hashchange", () => {
        const target = parseHash();
        if (target?.emp) openDrawer(target.emp);
        else if (target?.view === "directory") setView("directory");
        else if (target?.chain && state.focusId !== target.chain[target.chain.length - 1]) goToUnit(target.chain);
      });
    } catch (err) {
      console.error("فشل تحميل الموظفين:", err);
      const container = $("#employee-cards");
      if (container) container.innerHTML = `<div class="empty"><h2>تعذر تحميل معلومات الموظفين</h2><p>حدّث الصفحة أو حاول لاحقًا.</p></div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("employee-cards")) loadEmployees();
  });
})();
