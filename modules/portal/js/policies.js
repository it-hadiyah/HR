// ========== Policies page: browse every policy / regulation, view PDFs in a modal ==========
// Data: data/PoliciesLibrary.json -> { categories: { "التصنيف": [ { name, file, description, type?, updated? } ] } }
// A PDF lives in policies/<file>. An item without a file is shown as "قيد الإعداد" (not clickable).
(() => {
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const CATEGORY_ICONS = {
    "التقنية": "fa-laptop-code", "الموارد البشرية": "fa-users", "المالية": "fa-coins",
    "الإعلام": "fa-bullhorn", "الحوكمة": "fa-scale-balanced", "القانونية": "fa-gavel",
  };

  let docs = [];
  const state = { category: "all", query: "" };

  const clean = value => String(value ?? "").replace(/ /g, " ").trim();

  function normaliseData(data) {
    const list = [];
    Object.entries(data?.categories || {}).forEach(([rawCategory, items]) => {
      if (!Array.isArray(items)) return;
      const category = clean(rawCategory);
      items.forEach(item => {
        const name = clean(item.name);
        if (!name) return; // empty placeholder rows
        const file = clean(item.file);
        list.push({
          name, category, file,
          url: file ? `policies/${encodeURI(file)}` : "",
          description: clean(item.description),
          type: clean(item.type) || "سياسة",
          updated: clean(item.updated),
          search: normalizeArabic(`${name} ${item.description || ""} ${category} ${item.type || ""}`),
        });
      });
    });
    return list;
  }

  const categories = () => [...new Set(docs.map(d => d.category))];

  function visibleDocs() {
    const term = normalizeArabic(state.query);
    return docs
      .filter(d => (state.category === "all" || d.category === state.category) && (!term || d.search.includes(term)))
      // Available documents first, then alphabetical.
      .sort((a, b) => (!!b.url - !!a.url) || a.name.localeCompare(b.name, "ar"));
  }

  function renderPills() {
    const box = $("#policyPills");
    const pill = (id, label, count, icon) => `
      <button type="button" class="pol-pill${state.category === id ? " is-active" : ""}" data-category="${h(id)}" aria-pressed="${state.category === id}">
        ${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i>` : ""}<span>${h(label)}</span><span class="pol-pill-n">${count}</span>
      </button>`;
    box.innerHTML = pill("all", "الكل", docs.length, "")
      + categories().map(c => pill(c, c, docs.filter(d => d.category === c).length, CATEGORY_ICONS[c] || "fa-folder")).join("");
  }

  function cardHtml(doc, index) {
    const ready = !!doc.url;
    const actions = ready
      ? `<button type="button" class="pol-btn pol-btn--primary" data-action="view" data-index="${index}"><i class="fa-regular fa-eye" aria-hidden="true"></i> عرض</button>
         <a class="pol-btn pol-btn--ghost" href="${h(doc.url)}" download aria-label="تحميل ${h(doc.name)}"><i class="fa-solid fa-download" aria-hidden="true"></i><span>تحميل</span></a>`
      : `<span class="pol-soon"><i class="fa-regular fa-clock" aria-hidden="true"></i> قيد الإعداد</span>`;
    return `
      <article class="pol-card${ready ? "" : " is-pending"}" style="--i:${Math.min(index, 12)}">
        <div class="pol-card-top">
          <span class="pol-icon" aria-hidden="true"><i class="fa-solid ${ready ? "fa-file-pdf" : "fa-file-circle-question"}"></i></span>
          <span class="pol-type">${h(doc.type)}</span>
        </div>
        <h3 class="pol-name">${h(doc.name)}</h3>
        ${doc.description ? `<p class="pol-desc">${h(doc.description)}</p>` : ""}
        <p class="pol-cat"><i class="fa-solid ${CATEGORY_ICONS[doc.category] || "fa-folder"}" aria-hidden="true"></i>${h(doc.category)}${doc.updated ? ` <span class="pol-date">· آخر تحديث ${h(doc.updated)}</span>` : ""}</p>
        <div class="pol-actions">${actions}</div>
      </article>`;
  }

  function render() {
    renderPills();
    const list = visibleDocs();
    const container = $("#policy-categories");
    $("#policyCount").textContent = list.length === docs.length ? `${docs.length} وثيقة` : `عرض ${list.length} من ${docs.length} وثيقة`;
    container.setAttribute("aria-busy", "false");
    if (!list.length) {
      container.innerHTML = `<div class="pol-empty"><span aria-hidden="true"><i class="fa-solid fa-folder-open"></i></span><h2>لا توجد نتائج</h2><p>جرّب كلمات بحث أخرى أو اختر تصنيفًا مختلفًا.</p></div>`;
      return;
    }
    container.innerHTML = `<div class="pol-grid">${list.map(cardHtml).join("")}</div>`;
    container._list = list;
  }

  function openViewer(doc) {
    const modalEl = $("#pdfModal");
    if (!modalEl || !doc?.url) return;
    $("#pdfModalTitle").textContent = doc.name;
    $("#pdfOpen").href = doc.url;
    const download = $("#pdfDownload");
    download.href = doc.url;
    download.setAttribute("download", doc.file);
    const frame = $("#pdfFrame");
    frame.src = doc.url;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    modalEl.addEventListener("hidden.bs.modal", () => { frame.src = "about:blank"; }, { once: true });
  }

  async function init() {
    const container = $("#policy-categories");
    if (!container) return;
    try {
      const res = await fetch("data/PoliciesLibrary.json");
      docs = normaliseData(await res.json());
    } catch (err) {
      console.error("تعذر تحميل بيانات السياسات:", err);
      container.innerHTML = `<div class="pol-empty"><h2>تعذر تحميل السياسات</h2><p>حدّث الصفحة أو حاول لاحقًا.</p></div>`;
      return;
    }
    $("#polStatDocs").textContent = docs.length;
    $("#polStatCats").textContent = categories().length;

    $("#policyPills").addEventListener("click", e => {
      const pill = e.target.closest("[data-category]");
      if (!pill) return;
      state.category = pill.dataset.category;
      render();
    });
    $("#policySearch").addEventListener("input", e => { state.query = e.target.value; render(); });
    container.addEventListener("click", e => {
      const button = e.target.closest("[data-action='view']");
      if (button) openViewer(container._list[Number(button.dataset.index)]);
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
