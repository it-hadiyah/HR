// ========== Control panel: edits the site's JSON files through the platform API (/api/portal-admin, PostgreSQL) ==========
// Every section is a table of rows + a form. Changes stay in memory until "حفظ التغييرات".
(() => {
  const API = "/api/portal-admin";
  const DATA = "../data/";
  const FILES = { employees: "employeeInfo.json", org: "orgStructure.json", links: "linksLibrary.json", policies: "PoliciesLibrary.json", locations: "locations.json", home: "home.json", committees: "committees.json", recognition: "recognition.json" };
  const NO_PHOTO = "images/content/employee-info/user-icon.png";
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = value => String(value ?? "").replace(/ /g, " ").trim();
  const isUrl = value => /^https?:\/\/\S+$/i.test(value);

  const raw = {};      // file name -> working copy
  const saved = {};    // file name -> JSON text as last loaded/saved
  let current = "employees";
  let query = "";

  // ---------- network ----------
  async function api(action, params = {}, options = {}) {
    const url = `${API}?action=${encodeURIComponent(action)}&${new URLSearchParams(params)}`;
    const init = { method: options.body ? "POST" : "GET", credentials: "same-origin", headers: {} };
    if (options.body) { init.body = options.body; init.headers["X-Requested-With"] = "hadiyah-admin"; }
    if (options.json) init.headers["Content-Type"] = "application/json; charset=utf-8";
    let res;
    try { res = await fetch(url, init); } catch (err) { throw new Error("تعذر الاتصال بالخادم."); }
    let data;
    try { data = await res.json(); } catch (err) { throw new Error("استجابة غير متوقعة من الخادم (هل سجّلت الدخول إلى المنصة؟)."); }
    if (!data.ok) throw new Error(data.error || "فشلت العملية.");
    return data;
  }

  async function loadFile(file) {
    let res;
    try { res = await fetch(`${DATA}${file}?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }); }
    catch (err) { throw new Error(`${file}: تعذر الاتصال`); }
    if (!res.ok) throw new Error(`${file}: الخادم أعاد HTTP ${res.status}`);
    const text = await res.text();
    try { raw[file] = JSON.parse(text); } catch (err) { throw new Error(`${file}: الملف ليس JSON صالحًا`); }
    saved[file] = JSON.stringify(raw[file]);
  }

  const dirty = file => JSON.stringify(raw[file]) !== saved[file];
  const anyDirty = () => Object.values(FILES).some(dirty);

  // ---------- UI helpers ----------
  function toast(message, isError = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("is-error", isError);
    node.classList.add("is-shown");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => node.classList.remove("is-shown"), isError ? 5000 : 2200);
  }

  // ---------- organisation structure helpers (employee placement) ----------
  function allUnits() {
    const list = [];
    const walk = (node, trail) => {
      const path = [...trail, node.title];
      list.push({ id: node.id, node, path: path.join(" › ") });
      (node.children || []).forEach(child => walk(child, path));
    };
    (raw[FILES.org].sections || []).forEach(section => walk(section, []));
    return list;
  }

  function findPlacement(ext) {
    for (const unit of allUnits()) {
      if ((unit.node.heads || []).some(e => String(e) === String(ext))) return { unit, role: "head" };
      if ((unit.node.members || []).some(e => String(e) === String(ext))) return { unit, role: "member" };
    }
    return null;
  }

  function removeFromOrg(ext) {
    allUnits().forEach(({ node }) => {
      ["heads", "members"].forEach(key => {
        if (!node[key]) return;
        node[key] = node[key].filter(e => String(e) !== String(ext));
        if (!node[key].length) delete node[key];
      });
    });
  }

  function placeInOrg(ext, unitId, role) {
    const unit = allUnits().find(u => u.id === unitId);
    if (!unit) return;
    const key = role === "head" ? "heads" : "members";
    (unit.node[key] = unit.node[key] || []).push(ext);
  }

  // ---------- committees (membership is assigned from the employee form) ----------
  const ROLES = ["عضو", "رئيس اللجنة", "نائب الرئيس", "مقرر"];
  const committeeList = () => (raw[FILES.committees].committees = raw[FILES.committees].committees || []);
  const membershipsOf = ext => committeeList().filter(c => (c.members || []).some(m => String(m.ext) === String(ext)))
    .map(c => ({ id: c.id, role: c.members.find(m => String(m.ext) === String(ext)).role || "عضو" }));
  const dropFromCommittees = ext => committeeList().forEach(c => { c.members = (c.members || []).filter(m => String(m.ext) !== String(ext)); });

  // ---------- employee of the month / year ----------
  const awardList = () => (raw[FILES.recognition].awards = raw[FILES.recognition].awards || []);
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const periodLabel = (type, period) => {
    if (type !== "month") return period;
    const [y, m] = String(period).split("-");
    return `${MONTHS[Number(m) - 1] || m} ${y}`;
  };

  // ---------- sections ----------
  const sections = {};

  sections.employees = {
    title: "الموظفون", icon: "fa-users", files: [FILES.employees, FILES.org, FILES.committees, FILES.recognition],
    hint: "إضافة موظف أو تعديل بياناته. اختيار الوحدة التنظيمية يحدّث الهيكل التنظيمي تلقائيًا.",
    columns: ["", "التحويلة", "الاسم", "المسمى الوظيفي", "الوحدة التنظيمية"],
    rows() {
      return raw[FILES.employees].map((emp, i) => {
        const place = findPlacement(emp.Extension);
        return {
          key: i, i, emp, place,
          text: `${emp.Name} ${emp.JobName} ${emp.Extension} ${emp.email} ${place ? place.unit.path : ""}`,
          cells: [
            `<img class="thumb" src="../${esc(emp.Photo || NO_PHOTO)}" alt="" loading="lazy">`,
            `<bdi dir="ltr">${esc(emp.Extension)}</bdi>`, esc(String(emp.Name).trim()), esc(emp.JobName),
            place ? `${esc(place.unit.path)}${place.role === "head" ? ' <span class="tag">رئيس</span>' : ""}` : '<span class="tag tag--warn">بدون وحدة (أخرى)</span>',
          ],
        };
      });
    },
    form(row) {
      const emp = row ? row.emp : {};
      const place = row ? row.place : null;
      return [
        { name: "Name", label: "الاسم", value: emp.Name ? String(emp.Name).trim() : "", required: true },
        { name: "JobName", label: "المسمى الوظيفي", value: emp.JobName || "", required: true },
        { name: "Extension", label: "التحويلة (الرقم الداخلي)", type: "number", value: emp.Extension ?? "", required: true, hint: "رقم فريد لكل موظف." },
        { name: "email", label: "البريد الإلكتروني", type: "email", value: emp.email || "", required: true },
        { name: "unit", label: "الوحدة التنظيمية", value: place ? place.unit.id : "", options: [{ v: "", l: "— بدون وحدة (تظهر في «أخرى») —" }, ...allUnits().map(u => ({ v: u.id, l: u.path }))], wide: true },
        { name: "role", label: "الدور في الوحدة", value: place ? place.role : "member", options: [{ v: "member", l: "عضو" }, { v: "head", l: "رئيس الوحدة" }] },
        { name: "committees", label: "اللجان", committees: true, value: JSON.stringify(row ? membershipsOf(emp.Extension) : []), wide: true },
        { name: "Photo", label: "الصورة", value: emp.Photo && emp.Photo !== NO_PHOTO ? emp.Photo : "", upload: "employee-photos", hint: "اتركها فارغة لاستخدام الصورة الافتراضية.", wide: true },
      ];
    },
    commit(v, row) {
      const ext = Number(v.Extension);
      if (!Number.isInteger(ext) || ext <= 0) throw new Error("التحويلة يجب أن تكون رقمًا صحيحًا.");
      if (raw[FILES.employees].some((e, i) => Number(e.Extension) === ext && (!row || i !== row.i))) throw new Error(`التحويلة ${ext} مستخدمة لموظف آخر.`);
      if (!/^\S+@\S+\.\S+$/.test(v.email)) throw new Error("البريد الإلكتروني غير صالح.");
      const emp = { ...(row ? row.emp : { Section: "" }), Extension: ext, Name: v.Name.trim(), JobName: v.JobName.trim(), Photo: v.Photo.trim() || NO_PHOTO, email: v.email.trim() };
      const oldExt = row ? row.emp.Extension : null;
      const old = row ? row.place : null;
      const samePlacement = row && Number(oldExt) === ext && ((old && old.unit.id === v.unit && old.role === v.role) || (!old && !v.unit));
      if (!samePlacement) {
        if (oldExt != null) removeFromOrg(oldExt);
        removeFromOrg(ext);
        if (v.unit) placeInOrg(ext, v.unit, v.role);
      }
      // Committees: replace this person's memberships (only when something changed).
      const wanted = [];
      try { JSON.parse(v.committees || "[]").forEach(m => { if (m.id && !wanted.some(w => w.id === m.id)) wanted.push({ id: m.id, role: ROLES.includes(m.role) ? m.role : "عضو" }); }); } catch (err) { /* ignore */ }
      const before = row ? membershipsOf(row.emp.Extension) : [];
      const same = JSON.stringify(before.map(m => [m.id, m.role]).sort()) === JSON.stringify(wanted.map(m => [m.id, m.role]).sort());
      if (!same || (row && Number(row.emp.Extension) !== ext)) {
        if (row) dropFromCommittees(row.emp.Extension);
        dropFromCommittees(ext);
        wanted.forEach(m => { const c = committeeList().find(x => x.id === m.id); if (c) (c.members = c.members || []).push({ ext, role: m.role }); });
      }
      if (row && Number(row.emp.Extension) !== ext) awardList().forEach(a => { if (String(a.ext) === String(row.emp.Extension)) a.ext = ext; });
      if (row) raw[FILES.employees][row.i] = emp; else raw[FILES.employees].push(emp);
    },
    remove(row) {
      raw[FILES.recognition].awards = awardList().filter(a => String(a.ext) !== String(row.emp.Extension));
      dropFromCommittees(row.emp.Extension);
      removeFromOrg(row.emp.Extension);
      raw[FILES.employees].splice(row.i, 1);
    },
    confirmText: row => `حذف الموظف «${String(row.emp.Name).trim()}» نهائيًا من الدليل والهيكل؟`,
  };

  sections.recognition = {
    title: "موظف الشهر والسنة", icon: "fa-trophy", files: [FILES.recognition],
    hint: "يمكن تسجيل حتى 5 موظفين لنفس الشهر أو السنة. تظهر في الرئيسية بطاقات المتميزين في أحدث فترة لكل نوع، وتتميّز بطاقاتهم في صفحة الموظفين.",
    columns: ["", "النوع", "الفترة", "الموظف", "كلمة التقدير"],
    rows() {
      return awardList().map((a, i) => ({ a, i })).sort((x, y) => String(y.a.period).localeCompare(String(x.a.period))).map(({ a, i }) => {
        const emp = raw[FILES.employees].find(e => String(e.Extension) === String(a.ext));
        return {
          key: a.id, i, a, text: `${a.type} ${a.period} ${emp ? emp.Name : ""} ${a.note || ""}`,
          cells: [emp ? `<img class="thumb" src="../${esc(emp.Photo || NO_PHOTO)}" alt="" loading="lazy">` : "",
            `<span class="tag">${a.type === "year" ? "موظف السنة" : "موظف الشهر"}</span>`, esc(periodLabel(a.type, a.period)),
            emp ? esc(String(emp.Name).trim()) : '<span class="tag tag--warn">موظف محذوف</span>', esc(a.note || "")],
        };
      });
    },
    form(row) {
      const a = row ? row.a : {};
      const now = new Date();
      const people = [...raw[FILES.employees]].sort((x, y) => String(x.Name).trim().localeCompare(String(y.Name).trim(), "ar"));
      return [
        { name: "type", label: "النوع", value: a.type || "month", options: [{ v: "month", l: "موظف الشهر" }, { v: "year", l: "موظف السنة" }] },
        { name: "period", label: "الفترة", type: "month", required: true, value: a.period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, hint: "الشهر للتقدير الشهري، والسنة للتقدير السنوي." },
        { name: "emp", label: "الموظف", value: a.ext != null ? String(a.ext) : "", required: true, wide: true,
          options: [{ v: "", l: "اختر الموظف…" }, ...people.map(e => ({ v: String(e.Extension), l: `${String(e.Name).trim()} — ${e.JobName}` }))] },
        { name: "note", label: "كلمة التقدير / سبب الاختيار", value: a.note || "", area: true, wide: true, hint: "اختياري، تظهر في بطاقة الصفحة الرئيسية." },
      ];
    },
    afterRender(form) {
      const type = form.elements.type;
      const period = form.elements.period;
      const apply = () => {
        const year = type.value === "year";
        const old = period.value;
        period.type = year ? "number" : "month";
        if (year) { period.min = "2000"; period.max = "2100"; period.value = String(old).slice(0, 4) || new Date().getFullYear(); }
        else { period.removeAttribute("min"); period.removeAttribute("max"); period.value = /^\d{4}-\d{2}$/.test(old) ? old : `${String(old).slice(0, 4) || new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`; }
      };
      type.addEventListener("change", apply);
      apply();
    },
    commit(v, row) {
      const type = v.type === "year" ? "year" : "month";
      const period = v.period.trim();
      if (type === "month" ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) : !/^\d{4}$/.test(period)) throw new Error("اختر الفترة بشكل صحيح.");
      if (!v.emp) throw new Error("اختر الموظف.");
      if (awardList().some((a, i) => a.type === type && a.period === period && String(a.ext) === v.emp && (!row || i !== row.i))) throw new Error("هذا الموظف مسجَّل بالفعل لنفس الفترة.");
      const MAX_PER_PERIOD = 5;
      const sameSlot = awardList().filter((a, i) => a.type === type && a.period === period && (!row || i !== row.i)).length;
      if (sameSlot >= MAX_PER_PERIOD) throw new Error(`الحد الأقصى ${MAX_PER_PERIOD} موظفين للفترة الواحدة (${periodLabel(type, period)}). احذف أحدهم أو اختر فترة أخرى.`);
      const award = { ...(row ? row.a : { id: "a" + Date.now().toString(36) }), type, period, ext: Number(v.emp), note: v.note.trim() };
      if (row) awardList()[row.i] = award; else awardList().push(award);
    },
    remove(row) { awardList().splice(row.i, 1); },
    confirmText: row => `حذف تقدير ${periodLabel(row.a.type, row.a.period)}؟`,
  };

  sections.committees = {
    title: "اللجان", icon: "fa-people-group", files: [FILES.committees],
    hint: "أنشئ اللجان هنا. الأعضاء يُسندون من قسم «الموظفون» (حقل اللجان في نموذج الموظف).",
    columns: ["اسم اللجنة", "النوع", "الرئيس", "عدد الأعضاء"],
    movable: true,
    rows() {
      return committeeList().map((c, i) => {
        const chair = (c.members || []).find(m => m.role === "رئيس اللجنة");
        const emp = chair ? raw[FILES.employees].find(e => String(e.Extension) === String(chair.ext)) : null;
        return { key: c.id, i, c, text: `${c.name} ${c.description || ""}`, cells: [esc(c.name), esc(c.kind || "دائمة"), emp ? esc(String(emp.Name).trim()) : "—", String((c.members || []).length)] };
      });
    },
    form(row) {
      const c = row ? row.c : {};
      const names = row ? (c.members || []).map(m => { const e = raw[FILES.employees].find(x => String(x.Extension) === String(m.ext)); return e ? `${String(e.Name).trim()} (${m.role})` : ""; }).filter(Boolean) : [];
      return [
        { name: "name", label: "اسم اللجنة", value: c.name || "", required: true, wide: true },
        { name: "kind", label: "النوع", value: c.kind || "دائمة", options: [{ v: "دائمة", l: "دائمة" }, { v: "مؤقتة", l: "مؤقتة" }] },
        { name: "description", label: "الاختصاصات / نبذة", value: c.description || "", area: true, wide: true },
        { name: "_members", label: "الأعضاء الحاليون", value: names.join("، ") || "لا يوجد أعضاء بعد. أسندهم من قسم الموظفين.", readonly: true, wide: true },
      ];
    },
    commit(v, row) {
      const item = { ...(row ? row.c : { id: "c" + Date.now().toString(36), members: [] }), name: v.name.trim(), kind: v.kind, description: v.description.trim() };
      if (row) committeeList()[row.i] = item; else committeeList().push(item);
    },
    remove(row) { committeeList().splice(row.i, 1); },
    move(row, dir) { swap(committeeList(), row.i, row.i + dir); },
    confirmText: row => `حذف لجنة «${row.c.name}» (${(row.c.members || []).length} عضو)؟ ستُزال عضوية الجميع منها.`,
  };

  // Grouped data ({categories:{name:[items]}}) shared by links and policies.
  function groupedRows(file, cellsOf, textOf, itemKeys) {
    const rows = [];
    Object.entries(raw[file].categories || {}).forEach(([catKey, items]) => {
      (items || []).forEach((item, i) => {
        if (!clean(item.name)) return; // empty placeholder rows keep a category alive
        rows.push({ key: `${catKey}#${i}`, catKey, i, item, text: `${clean(catKey)} ${itemKeys.map(k => item[k] || "").join(" ")}`, cells: cellsOf(clean(catKey), item) });
      });
    });
    return rows;
  }

  function groupedCommit(file, v, row, build) {
    const cats = raw[file].categories;
    const name = clean(v.category);
    if (!name) throw new Error("اختر التصنيف من القائمة أو أضف تصنيفًا جديدًا.");
    const catKey = Object.keys(cats).find(k => clean(k) === name) || name;
    const item = build(row ? row.item : {});
    if (row && clean(row.catKey) === name) { cats[row.catKey][row.i] = item; return; }
    if (row) cats[row.catKey].splice(row.i, 1);
    cats[catKey] = (cats[catKey] || []).filter(x => clean(x.name));
    cats[catKey].push(item);
  }

  const categoryOptions = file => Object.keys(raw[file].categories || {}).map(clean);

  sections.links = {
    title: "الروابط", icon: "fa-link", files: [FILES.links],
    hint: "الروابط الظاهرة في مكتبة الروابط. ترتيب الأسهم يحدد ترتيب الظهور داخل التصنيف.",
    columns: ["التصنيف", "الاسم", "الوصف", "الرابط"],
    movable: true,
    rows() {
      return groupedRows(FILES.links, (cat, l) => [`<span class="tag">${esc(cat)}</span>`, esc(l.name), esc(l.description), `<bdi dir="ltr">${esc(l.url)}</bdi>`], null, ["name", "description", "url"]);
    },
    form(row) {
      const l = row ? row.item : {};
      return [
        { name: "category", label: "التصنيف", value: row ? clean(row.catKey) : "", required: true, datalist: categoryOptions(FILES.links), hint: "اختر تصنيفًا موجودًا أو اكتب اسمًا جديدًا." },
        { name: "name", label: "الاسم", value: l.name || "", required: true },
        { name: "description", label: "الوصف", value: l.description || "", wide: true },
        { name: "url", label: "الرابط", type: "url", value: l.url || "", required: true, ltr: true, wide: true },
      ];
    },
    commit(v, row) {
      if (!isUrl(v.url.trim())) throw new Error("الرابط يجب أن يبدأ بـ http:// أو https://");
      groupedCommit(FILES.links, v, row, () => ({ name: v.name.trim(), description: v.description.trim(), url: v.url.trim() }));
    },
    remove(row) { raw[FILES.links].categories[row.catKey].splice(row.i, 1); },
    move(row, dir) { swap(raw[FILES.links].categories[row.catKey], row.i, row.i + dir); },
    confirmText: row => `حذف الرابط «${row.item.name}»؟`,
  };

  sections.policies = {
    title: "السياسات", icon: "fa-file-lines", files: [FILES.policies],
    hint: "السياسات واللوائح. ارفع ملف PDF من نافذة الإضافة أو اختر ملفًا مرفوعًا سابقًا.",
    columns: ["التصنيف", "الاسم", "النوع", "الملف"],
    movable: true,
    rows() {
      return groupedRows(FILES.policies, (cat, p) => [`<span class="tag">${esc(cat)}</span>`, esc(p.name), esc(p.type || "سياسة"), p.file ? `<bdi dir="ltr">${esc(p.file)}</bdi>` : '<span class="tag tag--warn">قيد الإعداد</span>'], null, ["name", "description", "file", "type"]);
    },
    form(row) {
      const p = row ? row.item : {};
      return [
        { name: "category", label: "التصنيف", value: row ? clean(row.catKey) : "", required: true, datalist: categoryOptions(FILES.policies) },
        { name: "type", label: "النوع", value: p.type || "سياسة", datalist: ["سياسة", "لائحة", "دليل", "نموذج"] },
        { name: "name", label: "الاسم", value: p.name || "", required: true, wide: true },
        { name: "description", label: "الوصف", value: p.description || "", wide: true, area: true },
        { name: "file", label: "ملف PDF", value: p.file || "", upload: "policies", stripPrefix: "policies/", wide: true, hint: "اتركه فارغًا إذا لم يجهز الملف بعد (يظهر «قيد الإعداد»)." },
        { name: "updated", label: "آخر تحديث", value: p.updated || "", hint: "اختياري، مثل 2025-03" },
      ];
    },
    commit(v, row) {
      groupedCommit(FILES.policies, v, row, old => {
        const item = { ...old, name: v.name.trim(), file: v.file.trim(), description: v.description.trim() };
        ["type", "updated"].forEach(k => { if (v[k].trim()) item[k] = v[k].trim(); else delete item[k]; });
        return item;
      });
    },
    remove(row) { raw[FILES.policies].categories[row.catKey].splice(row.i, 1); },
    move(row, dir) { swap(raw[FILES.policies].categories[row.catKey], row.i, row.i + dir); },
    confirmText: row => `حذف «${row.item.name}» من قائمة السياسات؟ (ملف PDF نفسه لا يُحذف من الخادم)`,
  };

  sections.locations = {
    title: "المواقع", icon: "fa-location-dot", files: [FILES.locations],
    hint: "فروع ومكاتب الجمعية. المدينة والنوع تُستنتجان من الاسم إن تُركتا فارغتين.",
    columns: ["", "الفرع", "المدينة", "الرابط"],
    movable: true,
    rows() {
      return raw[FILES.locations].map((l, i) => ({
        key: i, i, l, text: `${l.branch} ${l.city || ""} ${l.address || ""}`,
        cells: [l.branchPhoto ? `<img class="thumb" src="../${esc(l.branchPhoto)}" alt="" loading="lazy">` : "", esc(l.branch), esc(l.city || ""), `<bdi dir="ltr">${esc(l.mapLink || "")}</bdi>`],
      }));
    },
    form(row) {
      const l = row ? row.l : {};
      return [
        { name: "branch", label: "اسم الفرع", value: l.branch || "", required: true, hint: "مثال: الفرع الإداري - مكة", wide: true },
        { name: "city", label: "المدينة", value: l.city || "" },
        { name: "type", label: "النوع", value: l.type || "", datalist: ["إداري", "تحصيل", "كشك", "معرض", "فرع"] },
        { name: "address", label: "العنوان", value: l.address || "", wide: true },
        { name: "phone", label: "الهاتف", value: l.phone || "", ltr: true },
        { name: "hours", label: "ساعات العمل", value: l.hours || "" },
        { name: "mapLink", label: "رابط الخريطة", type: "url", value: l.mapLink || "", required: true, ltr: true, wide: true },
        { name: "branchPhoto", label: "الصورة", value: l.branchPhoto || "", upload: "location-photos", wide: true },
      ];
    },
    commit(v, row) {
      if (!isUrl(v.mapLink.trim())) throw new Error("رابط الخريطة يجب أن يبدأ بـ http:// أو https://");
      const l = { ...(row ? row.l : {}), branch: v.branch.trim(), branchPhoto: v.branchPhoto.trim(), mapLink: v.mapLink.trim() };
      ["city", "type", "address", "phone", "hours"].forEach(k => { if (v[k].trim()) l[k] = v[k].trim(); else delete l[k]; });
      if (row) raw[FILES.locations][row.i] = l; else raw[FILES.locations].push(l);
    },
    remove(row) { raw[FILES.locations].splice(row.i, 1); },
    move(row, dir) { swap(raw[FILES.locations], row.i, row.i + dir); },
    confirmText: row => `حذف الموقع «${row.l.branch}»؟`,
  };


  // ----- home page content -----
  const HOME_GROUPS = { oprations: { title: "الطلبات", limit: 6 }, orders: { title: "التذاكر", limit: 6 }, list: { title: "أهم الروابط", limit: 5 } };

  sections.homeLinks = {
    title: "روابط الرئيسية", icon: "fa-house", files: [FILES.links],
    hint: "البطاقات التي تظهر في الصفحة الرئيسية تحت «الطلبات» و«التذاكر» و«أهم الروابط». يظهر منها عدد محدد لكل مجموعة (حسب الترتيب).",
    columns: ["", "المجموعة", "الاسم", "الرابط", "الظهور"],
    movable: true,
    rows() {
      const mi = raw[FILES.links].most_important || {};
      const rows = [];
      Object.keys(HOME_GROUPS).forEach(group => {
        (mi[group] || []).forEach((item, i) => {
          const shown = i < HOME_GROUPS[group].limit;
          rows.push({
            key: `${group}#${i}`, group, i, item, text: `${HOME_GROUPS[group].title} ${item.name} ${item.url}`,
            cells: [item.image ? `<img class="thumb" src="../${esc(item.image)}" alt="" loading="lazy">` : "", `<span class="tag">${esc(HOME_GROUPS[group].title)}</span>`, esc(item.name), `<bdi dir="ltr">${esc(item.url)}</bdi>`,
              shown ? "ظاهر" : '<span class="tag tag--warn">خارج الحد</span>'],
          });
        });
      });
      return rows;
    },
    form(row) {
      const l = row ? row.item : {};
      return [
        { name: "group", label: "المجموعة", value: row ? row.group : "oprations", options: Object.entries(HOME_GROUPS).map(([v, g]) => ({ v, l: `${g.title} (يظهر أول ${g.limit})` })) },
        { name: "name", label: "الاسم", value: l.name || "", required: true },
        { name: "description", label: "الوصف", value: l.description || "", wide: true },
        { name: "url", label: "الرابط", type: "url", value: l.url || "", required: true, ltr: true, wide: true },
        { name: "image", label: "الصورة (شعار أو أيقونة)", value: l.image || "", upload: "link-images", wide: true },
      ];
    },
    commit(v, row) {
      if (!isUrl(v.url.trim())) throw new Error("الرابط يجب أن يبدأ بـ http:// أو https://");
      const mi = (raw[FILES.links].most_important = raw[FILES.links].most_important || {});
      const item = { ...(row ? row.item : {}), name: v.name.trim(), description: v.description.trim(), url: v.url.trim(), image: v.image.trim() };
      if (row && row.group === v.group) { mi[v.group][row.i] = item; return; }
      if (row) mi[row.group].splice(row.i, 1);
      (mi[v.group] = mi[v.group] || []).push(item);
    },
    remove(row) { raw[FILES.links].most_important[row.group].splice(row.i, 1); },
    move(row, dir) { swap(raw[FILES.links].most_important[row.group], row.i, row.i + dir); },
    confirmText: row => `حذف «${row.item.name}» من الصفحة الرئيسية؟`,
  };

  sections.slides = {
    title: "إعلانات الرئيسية", icon: "fa-images", files: [FILES.home],
    hint: "صور الشريط الإعلاني أعلى الصفحة الرئيسية. بدون صور لا يظهر الشريط. اجعل الصور بنفس المقاس (عريضة، مثل 1600×500).",
    columns: ["", "الوصف", "الرابط عند النقر"],
    movable: true,
    rows() {
      return (raw[FILES.home].slides || []).map((slide, i) => ({
        key: i, i, slide, text: `${slide.alt || ""} ${slide.link || ""}`,
        cells: [`<img class="thumb thumb--wide" src="../${esc(slide.image)}" alt="" loading="lazy">`, esc(slide.alt || ""), slide.link ? `<bdi dir="ltr">${esc(slide.link)}</bdi>` : "—"],
      }));
    },
    form(row) {
      const x = row ? row.slide : {};
      return [
        { name: "image", label: "الصورة", value: x.image || "", upload: "ads", required: true, wide: true },
        { name: "alt", label: "وصف الصورة", value: x.alt || "", wide: true, hint: "يُقرأ لمن يستخدم قارئ الشاشة." },
        { name: "link", label: "رابط عند النقر (اختياري)", type: "url", value: x.link || "", ltr: true, wide: true },
      ];
    },
    commit(v, row) {
      if (v.link.trim() && !isUrl(v.link.trim())) throw new Error("الرابط يجب أن يبدأ بـ http:// أو https://");
      const slide = { image: v.image.trim(), alt: v.alt.trim() };
      if (v.link.trim()) slide.link = v.link.trim();
      const list = (raw[FILES.home].slides = raw[FILES.home].slides || []);
      if (row) list[row.i] = slide; else list.push(slide);
    },
    remove(row) { raw[FILES.home].slides.splice(row.i, 1); },
    move(row, dir) { swap(raw[FILES.home].slides, row.i, row.i + dir); },
    confirmText: () => "حذف هذه الصورة من الشريط؟ (الملف نفسه لا يُحذف من الخادم)",
  };

  sections.welcome = {
    title: "نص الرئيسية", icon: "fa-pen-nib", files: [FILES.home], noAdd: true, noDelete: true,
    hint: "العنوان والجملة التعريفية أعلى الصفحة الرئيسية.",
    columns: ["الحقل", "النص"],
    rows() {
      return [["welcomeTitle", "العنوان"], ["welcomeLead", "الجملة التعريفية"]].map(([key, label]) => ({
        key, field: key, label, text: `${label} ${raw[FILES.home][key] || ""}`, cells: [esc(label), esc(raw[FILES.home][key] || "")],
      }));
    },
    form(row) { return [{ name: "value", label: row.label, value: raw[FILES.home][row.field] || "", required: true, wide: true, area: row.field === "welcomeLead" }]; },
    commit(v, row) { raw[FILES.home][row.field] = v.value.trim(); },
  };

  function swap(list, a, b) {
    if (b < 0 || b >= list.length) return;
    [list[a], list[b]] = [list[b], list[a]];
  }

  // ---------- rendering ----------
  function renderSide() {
    $("#side").innerHTML = Object.entries(sections).map(([id, s]) => {
      const n = s.rows().length;
      const d = s.files.some(dirty);
      return `<button type="button" data-section="${id}" class="${id === current ? "is-active" : ""}"><i class="fa-solid ${s.icon}" aria-hidden="true"></i><span>${s.title}</span>${d ? '<span class="dot" title="تغييرات غير محفوظة"></span>' : ""}<span class="n">${n}</span></button>`;
    }).join("");
  }

  function render() {
    const s = sections[current];
    $("#secTitle").textContent = s.title;
    $("#secHint").textContent = s.hint;
    const term = query.trim().toLowerCase();
    const all = s.rows();
    const rows = term ? all.filter(r => r.text.toLowerCase().includes(term)) : all;
    const canMove = s.movable && !term;
    $("#count").textContent = term ? `${rows.length} من ${all.length}` : `${all.length} عنصر`;
    $("#btnAdd").hidden = !!s.noAdd;
    $("#empty").hidden = rows.length > 0;
    $("#table").hidden = rows.length === 0;
    $("#table").innerHTML = `<thead><tr>${s.columns.map(c => `<th>${c}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map((r, idx) => `
      <tr data-key="${esc(r.key)}">${r.cells.map(c => `<td>${c}</td>`).join("")}
        <td class="actions">
          ${s.movable ? `<button type="button" class="icon-btn" data-act="up" ${canMove && idx > 0 ? "" : "disabled"} aria-label="أعلى"><i class="fa-solid fa-arrow-up"></i></button><button type="button" class="icon-btn" data-act="down" ${canMove && idx < rows.length - 1 ? "" : "disabled"} aria-label="أسفل"><i class="fa-solid fa-arrow-down"></i></button>` : ""}
          <button type="button" class="icon-btn" data-act="edit" aria-label="تعديل"><i class="fa-regular fa-pen-to-square"></i></button>
        </td></tr>`).join("")}</tbody>`;
    renderSide();
    $("#savebar").hidden = !anyDirty();
  }

  // ---------- editor dialog ----------
  function fieldHtml(f, index) {
    const id = `f-${index}`;
    const attrs = `id="${id}" name="${esc(f.name)}"${f.required ? " required" : ""}${f.ltr ? ' dir="ltr"' : ""}`;
    let control;
    if (f.options) control = `<select ${attrs}>${f.options.map(o => `<option value="${esc(o.v)}"${String(o.v) === String(f.value) ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
    else if (f.committees) {
      control = `<div class="cm" data-cm><input type="hidden" id="${id}" name="${esc(f.name)}" value="${esc(f.value)}">
        <div class="cm-rows" data-cm-rows></div>
        <button type="button" class="btn btn--ghost btn--sm" data-cm-add><i class="fa-solid fa-plus" aria-hidden="true"></i> إسناد إلى لجنة</button></div>`;
    }
    else if (f.readonly) control = `<textarea id="${id}" name="${esc(f.name)}" readonly>${esc(f.value)}</textarea>`;
    else if (f.datalist) {
      // A real dropdown of the existing values (a <datalist> only shows values matching the text already typed).
      const list = [...new Set([...f.datalist, ...(f.value && !f.datalist.includes(f.value) ? [f.value] : [])])];
      control = `<select data-combo="${id}">
        <option value="">${f.required ? "اختر…" : "— غير محدد —"}</option>
        ${list.map(o => `<option value="${esc(o)}"${o === f.value ? " selected" : ""}>${esc(o)}</option>`).join("")}
        <option value="__new__">＋ إضافة جديد…</option></select>
        <input type="text" id="${id}" name="${esc(f.name)}" value="${esc(f.value)}" placeholder="اكتب القيمة الجديدة" hidden autocomplete="off">`;
    }
    else if (f.area) control = `<textarea ${attrs}>${esc(f.value)}</textarea>`;
    else if (f.upload) {
      control = `<span class="field-file">${f.upload !== "policies" ? `<img src="${f.value ? "../" + esc(f.value) : ""}" alt="" ${f.value ? "" : "hidden"}>` : ""}
        <input type="text" ${attrs} value="${esc(f.value)}" dir="ltr" list="${id}-list" autocomplete="off">
        <button type="button" class="btn btn--ghost btn--sm" data-upload="${esc(f.upload)}" data-for="${id}" data-strip="${esc(f.stripPrefix || "")}"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> رفع ملف</button>
        <input type="file" hidden data-file-for="${id}"></span><datalist id="${id}-list"></datalist>`;
    } else control = `<input type="${f.type || "text"}" ${attrs} value="${esc(f.value)}" autocomplete="off">`;
    return `<label class="field${f.wide ? " field--wide" : ""}"><span>${esc(f.label)}${f.required ? " *" : ""}</span>${control}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</label>`;
  }

  function openEditor(row) {
    const s = sections[current];
    const dlg = $("#editor");
    const fields = s.form(row);
    $("#editorTitle").textContent = `${row ? "تعديل" : "إضافة"} — ${s.title}`;
    $("#editorFields").innerHTML = fields.map(fieldHtml).join("");
    $("#editorError").hidden = true;
    initCommitteeRows();
    s.afterRender?.($("#editorForm"));
    $("#editorDelete").hidden = !row || !!s.noDelete;
    const form = $("#editorForm");
    form.onsubmit = e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const values = {};
      fields.forEach(f => { values[f.name] = form.elements[f.name].value; });
      try {
        s.commit(values, row);
        dlg.close();
        render();
      } catch (err) {
        $("#editorError").textContent = err.message;
        $("#editorError").hidden = false;
      }
    };
    $("#editorDelete").onclick = () => {
      if (!confirm(s.confirmText(row))) return;
      s.remove(row);
      dlg.close();
      render();
    };
    // Existing uploaded files as suggestions for the policy file field.
    fields.forEach((f, index) => {
      if (f.upload !== "policies") return;
      api("list", { dir: "policies" }).then(data => {
        $(`#f-${index}-list`).innerHTML = data.files.map(file => `<option value="${esc(file.name)}">`).join("");
      }).catch(() => {});
    });
    dlg.showModal();
    form.querySelector("input, select, textarea")?.focus();
  }

  // The "اللجان" field of the employee form: one row per committee (dropdown) + a role dropdown.
  function initCommitteeRows() {
    const box = $("[data-cm]");
    if (!box) return;
    const hidden = $("input[type=hidden]", box);
    const rowsEl = $("[data-cm-rows]", box);
    const list = committeeList();
    let rows = [];
    try { rows = JSON.parse(hidden.value || "[]"); } catch (err) { rows = []; }
    const sync = () => { hidden.value = JSON.stringify(rows.filter(r => r.id)); };
    const draw = () => {
      rowsEl.innerHTML = rows.map((r, i) => `<div class="cm-row" data-i="${i}">
        <select data-cm-committee aria-label="اللجنة"><option value="">اختر اللجنة…</option>${list.map(c => `<option value="${esc(c.id)}"${c.id === r.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <select data-cm-role aria-label="الدور">${ROLES.map(x => `<option${x === r.role ? " selected" : ""}>${x}</option>`).join("")}</select>
        <button type="button" class="icon-btn" data-cm-remove aria-label="إزالة"><i class="fa-regular fa-trash-can"></i></button></div>`).join("")
        || `<p class="muted">${list.length ? "غير مسند إلى أي لجنة." : "لا توجد لجان بعد. أنشئها أولًا من قسم «اللجان»."}</p>`;
      $("[data-cm-add]", box).disabled = !list.length;
      sync();
    };
    box.onclick = e => {
      if (e.target.closest("[data-cm-add]")) { rows.push({ id: "", role: "عضو" }); draw(); }
      const rm = e.target.closest("[data-cm-remove]");
      if (rm) { rows.splice(Number(rm.closest(".cm-row").dataset.i), 1); draw(); }
    };
    box.onchange = e => {
      const row = e.target.closest(".cm-row");
      if (!row) return;
      const r = rows[Number(row.dataset.i)];
      if (e.target.matches("[data-cm-committee]")) r.id = e.target.value; else r.role = e.target.value;
      sync();
    };
    draw();
  }

  async function uploadFor(button) {
    const input = $(`[data-file-for="${button.dataset.for}"]`);
    input.value = "";
    input.onchange = async () => {
      if (!input.files.length) return;
      const body = new FormData();
      body.append("file", input.files[0]);
      button.disabled = true;
      try {
        const data = await api("upload", { dir: button.dataset.upload }, { body });
        const target = $(`#${button.dataset.for}`);
        const strip = button.dataset.strip;
        target.value = strip && data.url.startsWith(strip) ? data.url.slice(strip.length) : data.url;
        const img = target.closest(".field-file").querySelector("img");
        if (img) { img.src = "../" + data.url; img.hidden = false; }
        toast("تم رفع الملف");
      } catch (err) {
        $("#editorError").textContent = err.message;
        $("#editorError").hidden = false;
      } finally { button.disabled = false; }
    };
    input.click();
  }

  // ---------- save / discard / history ----------
  async function saveAll() {
    const button = $("#btnSave");
    button.disabled = true;
    try {
      for (const file of Object.values(FILES).filter(dirty)) {
        await api("save", { file }, { body: JSON.stringify(raw[file], null, 2), json: true });
        saved[file] = JSON.stringify(raw[file]);
      }
      toast("تم حفظ التغييرات");
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      render();
    }
  }

  async function discard() {
    if (!confirm("تجاهل كل التغييرات غير المحفوظة؟")) return;
    await Promise.all(Object.values(FILES).map(loadFile));
    render();
  }

  async function openHistory() {
    const s = sections[current];
    const box = $("#historyList");
    box.innerHTML = '<p class="muted">جارٍ التحميل...</p>';
    $("#history").showModal();
    try {
      const parts = [];
      for (const file of s.files) {
        const data = await api("backups", { file });
        parts.push(`<h3>${esc(file)}</h3>` + (data.backups.length
          ? data.backups.map(b => `<div class="history-row"><span><bdi>${esc(b.modified)}</bdi></span><button type="button" class="btn btn--ghost btn--sm" data-restore="${esc(b.name)}" data-file="${esc(file)}">استعادة</button></div>`).join("")
          : '<p class="muted">لا توجد نسخ بعد.</p>'));
      }
      box.innerHTML = parts.join("");
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }

  async function restore(file, name) {
    if (anyDirty() && !confirm("لديك تغييرات غير محفوظة ستضيع عند الاستعادة. متابعة؟")) return;
    if (!confirm("استعادة هذه النسخة؟ سيُحفظ الملف الحالي كنسخة احتياطية أيضًا.")) return;
    try {
      await api("restore", { file, backup: name }, { body: "x" });
      await Promise.all(Object.values(FILES).map(loadFile));
      $("#history").close();
      render();
      toast("تمت الاستعادة");
    } catch (err) { toast(err.message, true); }
  }

  // ---------- start ----------
  function gate(title, html) {
    $("#gateTitle").textContent = title;
    $("#gateText").innerHTML = html;
    $("#gate").hidden = false;
  }

  function bind() {
    $("#side").addEventListener("click", e => {
      const button = e.target.closest("[data-section]");
      if (!button) return;
      current = button.dataset.section;
      query = "";
      $("#q").value = "";
      render();
    });
    $("#q").addEventListener("input", e => { query = e.target.value; render(); });
    $("#btnAdd").addEventListener("click", () => openEditor(null));
    $("#table").addEventListener("click", e => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const s = sections[current];
      const row = s.rows().find(r => String(r.key) === act.closest("tr").dataset.key);
      if (!row) return;
      if (act.dataset.act === "edit") openEditor(row);
      else { s.move(row, act.dataset.act === "up" ? -1 : 1); render(); }
    });
    $("#editorCancel").addEventListener("click", () => $("#editor").close());
    $("#editorFields").addEventListener("click", e => { const b = e.target.closest("[data-upload]"); if (b) uploadFor(b); });
    $("#editorFields").addEventListener("change", e => {
      const select = e.target.closest("[data-combo]");
      if (!select) return;
      const input = $(`#${select.dataset.combo}`);
      const isNew = select.value === "__new__";
      input.hidden = !isNew;
      input.value = isNew ? "" : select.value;
      if (isNew) input.focus();
    });
    $("#btnSave").addEventListener("click", saveAll);
    $("#btnDiscard").addEventListener("click", discard);
    $("#btnHistory").addEventListener("click", openHistory);
    $("#historyClose").addEventListener("click", () => $("#history").close());
    $("#historyList").addEventListener("click", e => { const b = e.target.closest("[data-restore]"); if (b) restore(b.dataset.file, b.dataset.restore); });
    window.addEventListener("beforeunload", e => { if (anyDirty()) { e.preventDefault(); e.returnValue = ""; } });
  }

  async function init() {
    let who;
    try { who = await api("whoami"); }
    catch (err) { gate("الواجهة الخلفية غير متاحة", `${esc(err.message)}<br>سجّل الدخول من <a href=\"/\">الصفحة الرئيسية للمنصة</a> ثم أعد المحاولة.`); return; }
    if (!who.allowed) {
      gate("غير مصرح", who.user
        ? `تم تسجيل دخولك باسم <code>${esc(who.user)}</code> لكن دورك لا يملك صلاحية لوحة التحكم.<br>اطلب من مدير النظام منحك دور «مدير محتوى البوابة».`
        : "لم يتم التعرف على هويتك. سجّل الدخول من الصفحة الرئيسية للمنصة.");
      return;
    }
    $("#userName").textContent = who.user;
    const results = await Promise.allSettled(Object.values(FILES).map(loadFile));
    const failed = results.filter(r => r.status === "rejected").map(r => esc(r.reason.message));
    if (failed.length) {
      gate("تعذر تحميل البيانات", `${failed.join("<br>")}<br><br>افتح الرابط في المتصفح مباشرة (مثل <code>/data/orgStructure.json</code>) لمعرفة السبب: 404 يعني أن الملف غير موجود على الخادم، و401 يعني أن مجلد <code>data</code> يمنع الزوار (فعّل Anonymous Authentication له).`);
      return;
    }
    bind();
    $("#app").hidden = false;
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
