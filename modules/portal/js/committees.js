// ========== Committees page: every committee with its chair and members ==========
// Data: data/committees.json -> { committees: [ { id, name, kind, description, members: [ { ext, role } ] } ] }
// Members are employees (data/employeeInfo.json); they are assigned from the control panel's employee form.
(() => {
  const h = escapeHtml;
  const $ = (selector, root = document) => root.querySelector(selector);
  const CHAIR = "رئيس اللجنة";
  const ROLE_ORDER = [CHAIR, "نائب الرئيس", "مقرر", "عضو"];

  let committees = [];
  const state = { kind: "all", query: "" };
  const staff = new Map();

  const hasPhoto = emp => !!emp.Photo && !emp.Photo.includes("user-icon");
  const initials = name => String(name).trim().split(/\s+/).filter(w => !/^(م\.?|د\.?|أ\.?|معالي|الدكتور|المهندس)$/.test(w)).slice(0, 2).map(w => Array.from(w.length > 3 ? w.replace(/^ال/, "") : w)[0]).join(" ");
  const avatar = emp => hasPhoto(emp)
    ? `<img class="cmt-av" src="${h(emp.Photo)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="cmt-av cmt-av--initials" aria-hidden="true">${h(initials(emp.Name))}</span>`;

  function normalise(data, employees) {
    employees.forEach(emp => staff.set(String(emp.Extension), emp));
    return (data.committees || []).map(c => {
      const members = (c.members || []).map(m => ({ emp: staff.get(String(m.ext)), role: m.role || "عضو" })).filter(m => m.emp)
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || String(a.emp.Name).localeCompare(String(b.emp.Name), "ar"));
      return {
        id: c.id, name: String(c.name || "").trim(), kind: c.kind || "دائمة", description: String(c.description || "").trim(), members,
        search: normalizeArabic(`${c.name} ${c.description || ""} ${members.map(m => m.emp.Name).join(" ")}`),
      };
    }).filter(c => c.name);
  }

  function visible() {
    const term = normalizeArabic(state.query);
    return committees.filter(c => (state.kind === "all" || c.kind === state.kind) && (!term || c.search.includes(term)));
  }

  function renderPills() {
    const kinds = [...new Set(committees.map(c => c.kind))];
    const box = $("#committeePills");
    box.hidden = kinds.length < 2;
    const pill = (id, label, count) => `<button type="button" class="cmt-pill${state.kind === id ? " is-active" : ""}" data-kind="${h(id)}" aria-pressed="${state.kind === id}"><span>${h(label)}</span><span class="cmt-pill-n">${count}</span></button>`;
    box.innerHTML = pill("all", "الكل", committees.length) + kinds.map(k => pill(k, `لجان ${k}`, committees.filter(c => c.kind === k).length)).join("");
  }

  function cardHtml(c, i) {
    const chair = c.members.find(m => m.role === CHAIR);
    return `
      <article class="cmt-card" style="--i:${Math.min(i, 12)}">
        <div class="cmt-card-top"><span class="cmt-icon" aria-hidden="true"><i class="fa-solid fa-people-group"></i></span><span class="cmt-kind">${h(c.kind)}</span></div>
        <h3 class="cmt-name">${h(c.name)}</h3>
        ${c.description ? `<p class="cmt-desc">${h(c.description)}</p>` : ""}
        ${chair ? `<a class="cmt-chair" href="employee_info.html#emp=${h(chair.emp.Extension)}">${avatar(chair.emp)}<span><small>رئيس اللجنة</small><strong>${h(String(chair.emp.Name).trim())}</strong></span></a>` : ""}
        ${c.members.length
          ? `<button type="button" class="cmt-toggle" data-toggle="${h(c.id)}" aria-expanded="false"><span>الأعضاء (${c.members.length})</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
             <ul class="cmt-members" id="members-${h(c.id)}" hidden>${c.members.map(m => `
               <li><a class="cmt-member" href="employee_info.html#emp=${h(m.emp.Extension)}">${avatar(m.emp)}
                 <span class="cmt-member-text"><strong>${h(String(m.emp.Name).trim())}</strong><small>${h(m.emp.JobName)}</small></span>
                 <span class="cmt-role${m.role === "عضو" ? " cmt-role--plain" : ""}">${h(m.role)}</span></a></li>`).join("")}</ul>`
          : '<p class="cmt-desc">لم يُسنَد أعضاء بعد.</p>'}
      </article>`;
  }

  function render() {
    renderPills();
    const list = visible();
    const box = $("#committees-container");
    box.setAttribute("aria-busy", "false");
    $("#committeeCount").textContent = list.length === committees.length ? `${committees.length} لجنة` : `عرض ${list.length} من ${committees.length} لجنة`;
    box.innerHTML = list.length
      ? `<div class="cmt-grid">${list.map(cardHtml).join("")}</div>`
      : `<div class="cmt-empty"><span aria-hidden="true"><i class="fa-solid fa-people-group"></i></span><h2>${committees.length ? "لا توجد نتائج" : "لا توجد لجان بعد"}</h2><p>${committees.length ? "جرّب كلمات بحث أخرى." : "ستظهر هنا اللجان عند إضافتها."}</p></div>`;
  }

  async function init() {
    const box = $("#committees-container");
    if (!box) return;
    try {
      const [data, employees] = await Promise.all([
        fetch("data/committees.json", { cache: "no-store" }).then(r => r.json()),
        fetch("data/employeeInfo.json").then(r => r.json()),
      ]);
      committees = normalise(data, employees);
    } catch (err) {
      console.error("تعذر تحميل اللجان:", err);
      box.innerHTML = `<div class="cmt-empty"><h2>تعذر تحميل اللجان</h2><p>حدّث الصفحة أو حاول لاحقًا.</p></div>`;
      return;
    }
    $("#cmtStatCount").textContent = committees.length;
    $("#cmtStatPeople").textContent = new Set(committees.flatMap(c => c.members.map(m => m.emp.Extension))).size;
    $("#committeePills").addEventListener("click", e => { const p = e.target.closest("[data-kind]"); if (p) { state.kind = p.dataset.kind; render(); } });
    $("#committeeSearch").addEventListener("input", e => { state.query = e.target.value; render(); });
    box.addEventListener("click", e => {
      const button = e.target.closest("[data-toggle]");
      if (!button) return;
      const list = document.getElementById(`members-${button.dataset.toggle}`);
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      list.hidden = !open;
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
