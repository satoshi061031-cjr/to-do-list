(function () {
  const STORAGE_APP = "todo-app-v2";
  const STORAGE_LEGACY = "todo-list-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  /** @typedef {{ id: string; name: string }} Category */

  /** @type {{ id: string; text: string; completed: boolean; dueDate: string | null; categoryId: string | null }[]} */
  let todos = [];

  /** @type {Category[]} */
  let categories = [];
  /** @type {Record<string, string>} */
  let illustrationsByCategory = {};

  /** `"__all__"` or a category id */
  /** @type {string} */
  let selectedCategoryKey = "__all__";

  /** @type {string | null} ISO YYYY-MM-DD — main calendar day filter */
  let viewDueDateFilter = null;

  /** @type {string | null} ISO — full-screen “tasks due this day” view */
  let dueDayPageDate = null;

  const form = document.getElementById("add-form");
  const input = document.getElementById("todo-input");
  const deadlineInput = document.getElementById("todo-deadline");
  const deadlinePicker = document.querySelector(".deadline-picker");
  const deadlineTrigger = document.getElementById("deadline-trigger");
  const deadlineDisplay = document.getElementById("deadline-display");
  const deadlineClear = document.getElementById("deadline-clear");
  const calendarPanel = document.getElementById("calendar-panel");
  const calPrev = document.getElementById("cal-prev");
  const calNext = document.getElementById("cal-next");
  const calendarTitle = document.getElementById("calendar-title");
  const calendarGrid = document.getElementById("calendar-grid");
  const listEl = document.getElementById("todo-list");
  const emptyEl = document.getElementById("empty-state");
  const countEl = document.getElementById("count-text");
  const clearBtn = document.getElementById("clear-completed");
  const filterBtns = document.querySelectorAll(".filter-btn");

  const sidebarEl = document.getElementById("sidebar");
  const sidebarTrigger = document.getElementById("sidebar-trigger");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const categoryListEl = document.getElementById("category-list");
  const toggleAddCatBtn = document.getElementById("toggle-add-category");
  const addCatPanel = document.getElementById("add-category-panel");
  const newCatInput = document.getElementById("new-category-name");
  const saveCatBtn = document.getElementById("save-category");
  const illustrationUpload = document.getElementById("illustration-upload");
  const chooseIllustrationBtn = document.getElementById("choose-illustration");
  const illustrationImage = document.getElementById("illustration-image");

  const appCalendarLive = document.getElementById("app-calendar-live");
  const appCalendarTitle = document.getElementById("app-calendar-title");
  const appCalendarGrid = document.getElementById("app-calendar-grid");
  const appCalPrev = document.getElementById("app-cal-prev");
  const appCalNext = document.getElementById("app-cal-next");
  const appCalToday = document.getElementById("app-cal-today");
  const dueDayFilterBar = document.getElementById("due-day-filter-bar");
  const dueDayFilterLabel = document.getElementById("due-day-filter-label");
  const dueDayFilterClear = document.getElementById("due-day-filter-clear");

  const dueDayPageRoot = document.getElementById("due-day-page");
  const dueDayPageBackdrop = document.getElementById("due-day-page-backdrop");
  const dueDayPageCloseBtn = document.getElementById("due-day-page-close");
  const dueDayPageTitle = document.getElementById("due-day-page-title");
  const dueDayPageSub = document.getElementById("due-day-page-sub");
  const dueDayPageList = document.getElementById("due-day-page-list");
  const dueDayPageEmpty = document.getElementById("due-day-page-empty");

  /** @type {"all" | "active" | "completed"} */
  let filter = "all";

  function bootstrap() {
    migratePlannerFromTodoAppV2();
    const state = loadState();
    todos = state.todos;
    categories = state.categories;
    selectedCategoryKey = state.selectedCategoryKey;
    illustrationsByCategory = state.illustrationsByCategory;
    if (illustrationsByCategory["__global__"]) {
      if (!illustrationsByCategory["__all__"]) {
        illustrationsByCategory["__all__"] = illustrationsByCategory["__global__"];
      }
      delete illustrationsByCategory["__global__"];
    }
    if (!categoryExists(selectedCategoryKey) && selectedCategoryKey !== "__all__") {
      selectedCategoryKey = "__all__";
    }
    saveAll();
  }

  function categoryExists(cid) {
    return categories.some((c) => c.id === cid);
  }

  function loadState() {
    try {
      const rawApp = localStorage.getItem(STORAGE_APP);
      if (rawApp) {
        const p = JSON.parse(rawApp);
        if (p && Array.isArray(p.todos)) {
          const cats = normalizeCategories(p.categories);
          const migratedTodos = normalizeTodosFromStore(p.todos);
          const migratedIllustrations = normalizeIllustrations(
            p.illustrationsByCategory,
            p.illustrationData
          );
          let sel =
            typeof p.selectedCategoryKey === "string" ? p.selectedCategoryKey : "__all__";
          if (sel !== "__all__" && !cats.some((c) => c.id === sel)) sel = "__all__";
          return {
            todos: migratedTodos,
            categories: cats,
            selectedCategoryKey: sel,
            illustrationsByCategory: migratedIllustrations,
          };
        }
      }

      const rawLegacy = localStorage.getItem(STORAGE_LEGACY);
      if (!rawLegacy) {
        return {
          todos: [],
          categories: [],
          selectedCategoryKey: "__all__",
          illustrationsByCategory: {},
        };
      }
      const parsed = JSON.parse(rawLegacy);
      if (!Array.isArray(parsed)) {
        return {
          todos: [],
          categories: [],
          selectedCategoryKey: "__all__",
          illustrationsByCategory: {},
        };
      }
      const migrated = parsed.filter(isLegacyTodoLike).map(legacyTodoToNew);
      return {
        todos: migrated,
        categories: [],
        selectedCategoryKey: "__all__",
        illustrationsByCategory: {},
      };
    } catch {
      return {
        todos: [],
        categories: [],
        selectedCategoryKey: "__all__",
        illustrationsByCategory: {},
      };
    }
  }

  function normalizeIllustration(value) {
    if (typeof value !== "string") return null;
    if (!value.startsWith("data:image/")) return null;
    return value;
  }

  function normalizeIllustrations(byCategory, legacySingle) {
    const out = {};
    if (byCategory && typeof byCategory === "object") {
      for (const [k, v] of Object.entries(byCategory)) {
        const n = normalizeIllustration(v);
        if (n) out[k] = n;
      }
    }
    const legacy = normalizeIllustration(legacySingle);
    if (legacy && !out["__all__"]) out["__all__"] = legacy;
    return out;
  }

  /** @param {any} t */
  function isLegacyTodoLike(t) {
    return t && typeof t.id === "string" && typeof t.text === "string" && typeof t.completed === "boolean";
  }

  /** @param {any} t */
  function legacyTodoToNew(t) {
    let dueDate = null;
    if (typeof t.dueDate === "string" && ISO_DATE.test(t.dueDate)) dueDate = t.dueDate;
    let categoryId = null;
    if (typeof t.categoryId === "string" || t.categoryId === null)
      categoryId = t.categoryId;
    return { id: t.id, text: t.text, completed: t.completed, dueDate, categoryId };
  }

  /** @param {Array | undefined | null} list */
  function normalizeCategories(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && typeof c.id === "string" && typeof c.name === "string").map((c) => ({
      id: c.id.trim() ? c.id : id(),
      name: String(c.name).trim().slice(0, 48) || "Untitled",
    }));
  }

  /** @param {any[]} raw */
  function normalizeTodosFromStore(raw) {
    return raw
      .filter(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.text === "string" &&
          typeof t.completed === "boolean"
      )
      .map(legacyTodoToNew);
  }

  function saveAll() {
    const payload = {
      todos,
      categories,
      selectedCategoryKey,
      illustrationsByCategory,
    };
    localStorage.setItem(STORAGE_APP, JSON.stringify(payload));
    if (localStorage.getItem(STORAGE_LEGACY)) {
      localStorage.removeItem(STORAGE_LEGACY);
    }
  }

  function refreshIllustration() {
    const illustrationData = illustrationsByCategory[selectedCategoryKey] || null;
    if (!illustrationData) {
      illustrationImage.hidden = true;
      illustrationImage.removeAttribute("src");
      return;
    }
    illustrationImage.src = illustrationData;
    illustrationImage.hidden = false;
  }

  function id() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  const STORAGE_PLANNER_KEY = "planner-app-v1";

  /** @param {unknown} raw */
  function normalizePlannerColumnsForMigrate(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {{ id: string; title: string; emoji: string }[]} */
    const out = [];
    for (const c of raw) {
      if (!c || typeof c !== "object" || typeof /** @type {any} */ (c).id !== "string") continue;
      const x = /** @type {any} */ (c);
      out.push({
        id: x.id,
        title: typeof x.title === "string" ? x.title.trim().slice(0, 80) || "Untitled" : "Untitled",
        emoji: typeof x.emoji === "string" && x.emoji.trim() ? String(x.emoji).trim().slice(0, 8) : "📌",
      });
    }
    return out;
  }

  /**
   * @param {unknown} raw
   * @param {string[]} columnIds
   */
  function normalizePlannerEntriesForMigrate(raw, columnIds) {
    if (!Array.isArray(raw)) return [];
    const set = new Set(columnIds);
    /** @type {{ id: string; columnId: string; title: string; note: string; completed: boolean; tags: string[] }[]} */
    const out = [];
    for (const e of raw) {
      if (!e || typeof e !== "object" || typeof /** @type {any} */ (e).id !== "string") continue;
      const x = /** @type {any} */ (e);
      if (typeof x.columnId !== "string" || !set.has(x.columnId)) continue;
      const tags = Array.isArray(x.tags)
        ? x.tags
            .filter((t) => typeof t === "string")
            .map((t) => String(t).trim().slice(0, 32))
            .filter(Boolean)
            .slice(0, 16)
        : [];
      out.push({
        id: x.id,
        columnId: x.columnId,
        title: typeof x.title === "string" ? x.title.slice(0, 200) : "",
        note: typeof x.note === "string" ? x.note.slice(0, 4000) : "",
        completed: !!x.completed,
        tags,
      });
    }
    return out;
  }

  /** Move planner data from legacy combined `todo-app-v2` into `planner-app-v1`. */
  function migratePlannerFromTodoAppV2() {
    try {
      if (localStorage.getItem(STORAGE_PLANNER_KEY)) return;
      const raw = localStorage.getItem(STORAGE_APP);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      const cols = normalizePlannerColumnsForMigrate(p.plannerColumns);
      if (cols.length === 0) {
        const entRaw = p.plannerEntries;
        if (!Array.isArray(entRaw) || entRaw.length === 0) return;
      }
      const entries = normalizePlannerEntriesForMigrate(p.plannerEntries, cols.map((c) => c.id));
      const plannerId = id();
      localStorage.setItem(
        STORAGE_PLANNER_KEY,
        JSON.stringify({
          version: 2,
          planners: [{ id: plannerId, name: "My planner" }],
          selectedPlannerId: plannerId,
          boards: { [plannerId]: { columns: cols, entries } },
        })
      );
      delete p.plannerColumns;
      delete p.plannerEntries;
      delete p.appView;
      localStorage.setItem(STORAGE_APP, JSON.stringify(p));
    } catch (_) {
      /* ignore */
    }
  }

  function todayIso() {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function isOverdue(dueDate, completed) {
    if (!dueDate || completed) return false;
    return dueDate < todayIso();
  }

  /** @param {string} iso */
  function formatDueDate(iso) {
    const [y, mo, da] = iso.split("-").map(Number);
    const dt = new Date(y, mo - 1, da);
    return dt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIsoYmd(y, mo, d) {
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  function mondayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth() + 1;

  let appCalYear = new Date().getFullYear();
  let appCalMonth = new Date().getMonth() + 1;

  function tickAppCalendarClock() {
    const now = new Date();
    appCalendarLive.dateTime = now.toISOString();
    appCalendarLive.textContent = now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function renderAppCalendar() {
    appCalendarTitle.textContent = new Date(appCalYear, appCalMonth - 1, 1).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });

    const first = new Date(appCalYear, appCalMonth - 1, 1);
    const pad = mondayIndex(first);
    const daysInMonth = new Date(appCalYear, appCalMonth, 0).getDate();
    const selected = deadlineInput.value.trim();
    const today = todayIso();

    appCalendarGrid.innerHTML = "";

    for (let i = 0; i < pad; i++) {
      const hole = document.createElement("div");
      hole.className = "app-cal-pad";
      hole.setAttribute("aria-hidden", "true");
      appCalendarGrid.appendChild(hole);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoYmd(appCalYear, appCalMonth, day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-cal-cell";
      btn.textContent = String(day);
      btn.setAttribute("aria-label", `View tasks due ${formatDueDate(iso)}`);

      if (iso === today) btn.classList.add("is-today");
      if (iso === selected) btn.classList.add("is-selected");
      if (iso === viewDueDateFilter) btn.classList.add("is-day-selected");

      btn.addEventListener("click", () => {
        if (selectedCategoryKey !== "__all__") viewDueDateFilter = iso;
        openDueDayPage(iso);
      });
      appCalendarGrid.appendChild(btn);
    }
  }

  function shiftAppMonth(delta) {
    appCalMonth += delta;
    if (appCalMonth > 12) {
      appCalMonth = 1;
      appCalYear += 1;
    } else if (appCalMonth < 1) {
      appCalMonth = 12;
      appCalYear -= 1;
    }
    renderAppCalendar();
  }

  function goAppCalendarThisMonth() {
    const n = new Date();
    appCalYear = n.getFullYear();
    appCalMonth = n.getMonth() + 1;
    renderAppCalendar();
  }

  function refreshDeadlineChrome() {
    const v = deadlineInput.value.trim();
    if (v && ISO_DATE.test(v)) {
      deadlineDisplay.textContent = formatDueDate(v);
      deadlineDisplay.classList.remove("is-placeholder");
      deadlineClear.hidden = false;
      const [y, mo] = v.split("-").map(Number);
      appCalYear = y;
      appCalMonth = mo;
    } else {
      deadlineDisplay.textContent = "Pick a date…";
      deadlineDisplay.classList.add("is-placeholder");
      deadlineClear.hidden = true;
    }
    renderAppCalendar();
  }

  function closeCalendar() {
    calendarPanel.hidden = true;
    deadlineTrigger.setAttribute("aria-expanded", "false");
  }

  function openCalendar() {
    const v = deadlineInput.value.trim();
    if (ISO_DATE.test(v)) {
      const [y, mo] = v.split("-").map(Number);
      calYear = y;
      calMonth = mo;
    } else {
      const n = new Date();
      calYear = n.getFullYear();
      calMonth = n.getMonth() + 1;
    }
    renderCalendar();
    calendarPanel.hidden = false;
    deadlineTrigger.setAttribute("aria-expanded", "true");
  }

  function renderCalendar() {
    calendarTitle.textContent = new Date(calYear, calMonth - 1, 1).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });

    const first = new Date(calYear, calMonth - 1, 1);
    const pad = mondayIndex(first);
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const selected = deadlineInput.value.trim();
    const today = todayIso();

    calendarGrid.innerHTML = "";

    for (let i = 0; i < pad; i++) {
      const hole = document.createElement("div");
      hole.className = "calendar-pad";
      hole.setAttribute("aria-hidden", "true");
      calendarGrid.appendChild(hole);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoYmd(calYear, calMonth, day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calendar-cell";
      btn.textContent = String(day);
      btn.setAttribute("aria-label", formatDueDate(iso));

      if (iso === today) btn.classList.add("is-today");
      if (iso === selected) btn.classList.add("is-selected");

      btn.addEventListener("click", () => {
        deadlineInput.value = iso;
        refreshDeadlineChrome();
        closeCalendar();
      });
      calendarGrid.appendChild(btn);
    }
  }

  function shiftMonth(delta) {
    calMonth += delta;
    if (calMonth > 12) {
      calMonth = 1;
      calYear += 1;
    } else if (calMonth < 1) {
      calMonth = 12;
      calYear -= 1;
    }
    renderCalendar();
  }

  deadlineTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (calendarPanel.hidden) openCalendar();
    else closeCalendar();
  });

  deadlineClear.addEventListener("click", (e) => {
    e.stopPropagation();
    deadlineInput.value = "";
    refreshDeadlineChrome();
    closeCalendar();
  });

  calPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    shiftMonth(-1);
  });

  calNext.addEventListener("click", (e) => {
    e.stopPropagation();
    shiftMonth(1);
  });

  appCalPrev.addEventListener("click", () => shiftAppMonth(-1));
  appCalNext.addEventListener("click", () => shiftAppMonth(1));
  appCalToday.addEventListener("click", () => goAppCalendarThisMonth());

  document.addEventListener("mousedown", (e) => {
    if (calendarPanel.hidden) return;
    if (deadlinePicker && !deadlinePicker.contains(/** @type {Node} */ (e.target))) {
      closeCalendar();
    }
  });

  refreshDeadlineChrome();

  tickAppCalendarClock();
  setInterval(tickAppCalendarClock, 1000);
  setInterval(renderAppCalendar, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickAppCalendarClock();
  });

  function todoMatchesCategory(t) {
    if (selectedCategoryKey === "__all__") return true;
    return t.categoryId === selectedCategoryKey;
  }

  function countInCategory(cid) {
    if (cid === "__all__") return todos.length;
    return todos.filter((t) => t.categoryId === cid).length;
  }

  function categoryLabelById(cid) {
    const c = categories.find((x) => x.id === cid);
    return c ? c.name : "Uncategorized";
  }

  function setSelectedCategory(next) {
    selectedCategoryKey = next;
    if (next === "__all__") viewDueDateFilter = null;
    saveAll();
    renderCategorySidebar();
    refreshIllustration();
    renderAppCalendar();
    render();
    if (window.matchMedia("(max-width: 819px)").matches) closeSidebar();
  }

  function removeCategory(catId, e) {
    e.stopPropagation();
    todos = todos.map((t) => (t.categoryId === catId ? { ...t, categoryId: null } : t));
    categories = categories.filter((c) => c.id !== catId);
    delete illustrationsByCategory[catId];
    if (selectedCategoryKey === catId) {
      selectedCategoryKey = "__all__";
      viewDueDateFilter = null;
    }
    saveAll();
    renderCategorySidebar();
    refreshIllustration();
    render();
  }

  function renderCategorySidebar() {
    categoryListEl.innerHTML = "";

    const allLi = document.createElement("li");
    allLi.className = "category-item";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "category-btn" + (selectedCategoryKey === "__all__" ? " is-active" : "");
    allBtn.dataset.categoryKey = "__all__";

    const allText = document.createElement("span");
    allText.className = "category-name-text";
    allText.textContent = "All tasks";

    const allBadge = document.createElement("span");
    allBadge.className = "category-badge";
    allBadge.textContent = String(countInCategory("__all__"));

    allBtn.append(allText, allBadge);
    allBtn.addEventListener("click", () => setSelectedCategory("__all__"));
    allLi.appendChild(allBtn);
    categoryListEl.appendChild(allLi);

    categories.forEach((cat) => {
      const li = document.createElement("li");
      li.className = "category-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-btn" + (selectedCategoryKey === cat.id ? " is-active" : "");
      btn.dataset.categoryKey = cat.id;

      const nameSpan = document.createElement("span");
      nameSpan.className = "category-name-text";
      nameSpan.textContent = cat.name;

      const badge = document.createElement("span");
      badge.className = "category-badge";
      badge.textContent = String(countInCategory(cat.id));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "category-remove";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete category ${cat.name}`);
      del.addEventListener("click", (evt) => removeCategory(cat.id, evt));

      btn.append(nameSpan, badge, del);
      btn.addEventListener("click", () => setSelectedCategory(cat.id));
      li.appendChild(btn);
      categoryListEl.appendChild(li);
    });
  }

  function isMobileSidebar() {
    return window.matchMedia("(max-width: 819px)").matches;
  }

  function openSidebar() {
    if (!isMobileSidebar()) return;
    sidebarEl.classList.add("is-open");
    sidebarBackdrop.hidden = false;
    sidebarBackdrop.classList.add("is-visible");
    document.body.classList.add("sidebar-drawer-open");
    sidebarTrigger.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebarEl.classList.remove("is-open");
    sidebarBackdrop.hidden = true;
    sidebarBackdrop.classList.remove("is-visible");
    document.body.classList.remove("sidebar-drawer-open");
    sidebarTrigger.setAttribute("aria-expanded", "false");
  }

  function toggleSidebar() {
    if (!isMobileSidebar()) return;
    if (sidebarEl.classList.contains("is-open")) closeSidebar();
    else openSidebar();
  }

  sidebarTrigger.addEventListener("click", () => toggleSidebar());
  sidebarBackdrop.addEventListener("click", () => closeSidebar());

  chooseIllustrationBtn.addEventListener("click", () => {
    illustrationUpload.click();
  });

  illustrationUpload.addEventListener("change", () => {
    const file = illustrationUpload.files && illustrationUpload.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Please select an image file.");
      illustrationUpload.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert("Please choose an image smaller than 2MB.");
      illustrationUpload.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      const normalized = normalizeIllustration(result);
      if (!normalized) return;
      illustrationsByCategory[selectedCategoryKey] = normalized;
      saveAll();
      refreshIllustration();
      illustrationUpload.value = "";
    };
    reader.readAsDataURL(file);
  });

  function closeAddCategoryPanel() {
    addCatPanel.hidden = true;
    toggleAddCatBtn.setAttribute("aria-expanded", "false");
    newCatInput.value = "";
  }

  toggleAddCatBtn.addEventListener("click", () => {
    const open = addCatPanel.hidden;
    if (open) {
      addCatPanel.hidden = false;
      toggleAddCatBtn.setAttribute("aria-expanded", "true");
      newCatInput.focus();
    } else {
      closeAddCategoryPanel();
    }
  });

  function addCategoryNamed(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const cat = { id: id(), name: trimmed.slice(0, 48) };
    categories.push(cat);
    selectedCategoryKey = cat.id;
    saveAll();
    renderCategorySidebar();
    refreshIllustration();
    render();
    closeAddCategoryPanel();
    closeSidebar();
  }

  saveCatBtn.addEventListener("click", () => {
    addCategoryNamed(newCatInput.value);
  });

  newCatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCategoryNamed(newCatInput.value);
    }
  });

  function visibleTodosPipeline() {
    let list = todos.filter(todoMatchesCategory);
    if (viewDueDateFilter && selectedCategoryKey !== "__all__")
      list = list.filter((t) => t.dueDate === viewDueDateFilter);
    if (filter === "active") list = list.filter((t) => !t.completed);
    if (filter === "completed") list = list.filter((t) => t.completed);
    return list;
  }

  function todosInCategoryAndDayScope() {
    let list = todos.filter(todoMatchesCategory);
    if (viewDueDateFilter && selectedCategoryKey !== "__all__")
      list = list.filter((t) => t.dueDate === viewDueDateFilter);
    return list;
  }

  function syncDueDayFilterBar() {
    if (!viewDueDateFilter || selectedCategoryKey === "__all__") {
      dueDayFilterBar.hidden = true;
      return;
    }
    dueDayFilterBar.hidden = false;
    dueDayFilterLabel.textContent = `Tasks due ${formatDueDate(viewDueDateFilter)}`;
  }

  /**
   * @param {{ id: string; text: string; completed: boolean; dueDate: string | null; categoryId: string | null }} todo
   * @param {{ showCategoryPill: boolean; showDueBadge: boolean }} opts
   */
  function createTodoListItemEl(todo, opts) {
    const li = document.createElement("li");
    li.className = "todo-item" + (todo.completed ? " completed" : "");
    li.dataset.id = todo.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "todo-check";
    check.checked = todo.completed;
    check.setAttribute("aria-label", todo.completed ? "Mark as active" : "Mark as done");
    check.addEventListener("change", () => toggle(todo.id));

    const main = document.createElement("div");
    main.className = "todo-main";

    const label = document.createElement("span");
    label.className = "todo-label";
    label.textContent = todo.text;
    label.addEventListener("click", () => toggle(todo.id));

    main.appendChild(label);

    if (opts.showCategoryPill && todo.categoryId && categoryExists(todo.categoryId)) {
      const pill = document.createElement("span");
      pill.className = "todo-category-pill";
      pill.textContent = categoryLabelById(todo.categoryId);
      main.appendChild(pill);
    }

    if (opts.showDueBadge && todo.dueDate) {
      const dueEl = document.createElement("span");
      dueEl.className = "todo-due";
      const overdue = isOverdue(todo.dueDate, todo.completed);
      if (overdue) dueEl.classList.add("is-overdue");
      dueEl.textContent = overdue
        ? `Overdue · ${formatDueDate(todo.dueDate)}`
        : `Due ${formatDueDate(todo.dueDate)}`;
      main.appendChild(dueEl);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "todo-delete";
    del.setAttribute("aria-label", "Delete task");
    del.textContent = "×";
    del.addEventListener("click", () => remove(todo.id));

    li.append(check, main, del);
    return li;
  }

  function openDueDayPage(iso) {
    dueDayPageDate = iso;
    dueDayPageRoot.hidden = false;
    document.body.classList.add("due-day-page-open");
    renderAppCalendar();
    render();
    queueMicrotask(() => dueDayPageCloseBtn.focus());
  }

  function closeDueDayPage() {
    dueDayPageDate = null;
    dueDayPageRoot.hidden = true;
    document.body.classList.remove("due-day-page-open");
    renderAppCalendar();
    render();
  }

  function renderDueDayPage() {
    if (!dueDayPageDate) return;
    dueDayPageTitle.textContent = `Tasks due ${formatDueDate(dueDayPageDate)}`;
    const list = todos.filter((t) => t.dueDate === dueDayPageDate);
    dueDayPageList.innerHTML = "";
    list.forEach((todo) => {
      dueDayPageList.appendChild(
        createTodoListItemEl(todo, {
          showCategoryPill: !!(todo.categoryId && categoryExists(todo.categoryId)),
          showDueBadge: false,
        })
      );
    });
    const empty = list.length === 0;
    dueDayPageEmpty.hidden = !empty;
    dueDayPageList.hidden = empty;
    dueDayPageEmpty.textContent = `No tasks due on ${formatDueDate(dueDayPageDate)}.`;
    dueDayPageSub.textContent = empty ? "" : `${list.length} ${list.length === 1 ? "task" : "tasks"}`;
  }

  function render() {
    const visible = visibleTodosPipeline();
    listEl.innerHTML = "";
    syncDueDayFilterBar();

    visible.forEach((todo) => {
      listEl.appendChild(
        createTodoListItemEl(todo, {
          showCategoryPill:
            selectedCategoryKey === "__all__" &&
            !!todo.categoryId &&
            categoryExists(todo.categoryId),
          showDueBadge: !!todo.dueDate,
        })
      );
    });

    const inScope = todosInCategoryAndDayScope();
    const activeCountScoped = inScope.filter((t) => !t.completed).length;
    countEl.textContent =
      activeCountScoped === 0
        ? "All caught up"
        : `${activeCountScoped} ${activeCountScoped === 1 ? "task" : "tasks"} left`;

    const hasCompletedScoped = inScope.some((t) => t.completed);
    clearBtn.hidden = !hasCompletedScoped;

    const showEmpty = visible.length === 0;
    emptyEl.classList.toggle("is-visible", showEmpty);
    if (showEmpty) {
      if (viewDueDateFilter && selectedCategoryKey !== "__all__") {
        const onDay = todos.filter((t) => todoMatchesCategory(t) && t.dueDate === viewDueDateFilter);
        emptyEl.textContent =
          onDay.length === 0
            ? `No tasks due on ${formatDueDate(viewDueDateFilter)}.`
            : `No tasks match this view for ${formatDueDate(viewDueDateFilter)}.`;
      } else {
        const scopedTodos = todos.filter(todoMatchesCategory);
        if (scopedTodos.length === 0 && selectedCategoryKey !== "__all__") {
          emptyEl.textContent = categories.find((c) => c.id === selectedCategoryKey)
            ? `No tasks in "${categoryLabelById(selectedCategoryKey)}" yet.`
            : "Nothing in this category.";
        } else if (todos.length === 0) {
          emptyEl.textContent = "No tasks yet—add your first one above.";
        } else if (filter === "active") {
          emptyEl.textContent = "Nothing active right now.";
        } else if (filter === "completed") {
          emptyEl.textContent = "No completed tasks yet.";
        } else {
          emptyEl.textContent = "Nothing to show.";
        }
      }
    }

    if (dueDayPageDate) renderDueDayPage();
  }

  /** @param {string} text @param {string | null} dueDate */
  function add(text, dueDate) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const categoryId =
      selectedCategoryKey === "__all__" || !categoryExists(selectedCategoryKey)
        ? null
        : selectedCategoryKey;

    todos.unshift({
      id: id(),
      text: trimmed,
      completed: false,
      dueDate: dueDate && ISO_DATE.test(dueDate) ? dueDate : null,
      categoryId,
    });
    saveAll();
    renderCategorySidebar();
    render();
  }

  function toggle(todoId) {
    const t = todos.find((x) => x.id === todoId);
    if (!t) return;
    t.completed = !t.completed;
    saveAll();
    renderCategorySidebar();
    render();
  }

  function remove(todoId) {
    todos = todos.filter((x) => x.id !== todoId);
    saveAll();
    renderCategorySidebar();
    render();
  }

  /** Remove completed tasks in the current sidebar category scope. */
  function clearCompletedInScope() {
    const drop = new Set(todosInCategoryAndDayScope().filter((t) => t.completed).map((t) => t.id));
    todos = todos.filter((t) => !drop.has(t.id));
    saveAll();
    renderCategorySidebar();
    render();
  }

  function setFilter(next) {
    filter = next;
    filterBtns.forEach((btn) => {
      const isActive = btn.dataset.filter === next;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    render();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!calendarPanel.hidden) {
      closeCalendar();
      deadlineTrigger.focus();
      return;
    }
    if (!dueDayPageRoot.hidden) {
      closeDueDayPage();
      return;
    }
    if (viewDueDateFilter) {
      viewDueDateFilter = null;
      renderAppCalendar();
      render();
      return;
    }
    if (isMobileSidebar() && sidebarEl.classList.contains("is-open")) closeSidebar();
  });

  window.addEventListener("resize", () => {
    if (!isMobileSidebar()) closeSidebar();
  });

  bootstrap();
  renderCategorySidebar();
  refreshIllustration();
  render();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const due = deadlineInput.value.trim() || null;
    add(input.value, due);
    input.value = "";
    deadlineInput.value = "";
    refreshDeadlineChrome();
    closeCalendar();
    input.focus();
  });

  clearBtn.addEventListener("click", clearCompletedInScope);

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => setFilter(/** @type {any} */ (btn.dataset.filter)));
  });

  dueDayFilterClear.addEventListener("click", () => {
    viewDueDateFilter = null;
    closeDueDayPage();
  });

  dueDayPageCloseBtn.addEventListener("click", () => closeDueDayPage());
  dueDayPageBackdrop.addEventListener("click", () => closeDueDayPage());
})();
