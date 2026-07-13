(function () {
  const STORAGE_PLANNER = "planner-app-v1";
  const STORAGE_TODO_APP = "todo-app-v2";

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  /** @type {{ id: string; name: string }[]} */
  let planners = [];
  /** @type {string} */
  let selectedPlannerId = "";
  /** @type {Record<string, { columns: PlannerColumn[]; entries: PlannerEntry[] }>} */
  let boards = {};

  /** @typedef {{ id: string; title: string; emoji: string }} PlannerColumn */
  /** @typedef {{ id: string; columnId: string; title: string; note: string; completed: boolean; tags: string[]; expanded: boolean }} PlannerEntry */

  /** @type {PlannerColumn[]} */
  let plannerColumns = [];
  /** @type {PlannerEntry[]} */
  let plannerEntries = [];

  const sidebarEl = document.getElementById("sidebar");
  const sidebarTrigger = document.getElementById("sidebar-trigger");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const plannerWorkspaceListEl = document.getElementById("planner-workspace-list");
  const toggleNewPlannerBtn = document.getElementById("toggle-new-planner");
  const newPlannerPanel = document.getElementById("new-planner-panel");
  const newPlannerNameInput = document.getElementById("new-planner-name");
  const savePlannerBtn = document.getElementById("save-planner");
  const plannerBoardScrollEl = document.querySelector(".planner-board-scroll");
  const plannerBoardEl = document.getElementById("planner-board");
  const plannerMonthTitleEl = document.getElementById("planner-month-title");
  const plannerMetaLineEl = document.getElementById("planner-meta-line");
  const plannerAddColumnBtn = document.getElementById("planner-add-column");
  const plannerClearDoneBtn = document.getElementById("planner-clear-done");
  let dealingColumnId = "";
  let columnDealAnimation = null;

  function id() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  /** @param {unknown} raw */
  function normalizePlanners(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {{ id: string; name: string }[]} */
    const out = [];
    for (const x of raw) {
      if (!x || typeof x !== "object" || typeof /** @type {any} */ (x).id !== "string") continue;
      const p = /** @type {any} */ (x);
      out.push({
        id: p.id,
        name: typeof p.name === "string" ? p.name.trim().slice(0, 48) || "Untitled" : "Untitled",
      });
    }
    return out;
  }

  /** @param {unknown} raw */
  function normalizePlannerColumns(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {PlannerColumn[]} */
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
  function normalizePlannerEntries(raw, columnIds) {
    if (!Array.isArray(raw)) return [];
    const set = new Set(columnIds);
    /** @type {PlannerEntry[]} */
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
      const expanded = typeof x.expanded === "boolean" ? x.expanded : true;
      out.push({
        id: x.id,
        columnId: x.columnId,
        title: typeof x.title === "string" ? x.title.slice(0, 200) : "",
        note: typeof x.note === "string" ? x.note.slice(0, 4000) : "",
        completed: !!x.completed,
        tags,
        expanded,
      });
    }
    return out;
  }

  /** @param {Record<string, unknown>} boardsRaw @param {string[]} plannerIds */
  function normalizeBoards(boardsRaw, plannerIds) {
    /** @type {Record<string, { columns: PlannerColumn[]; entries: PlannerEntry[] }>} */
    const out = {};
    if (boardsRaw && typeof boardsRaw === "object") {
      for (const pid of plannerIds) {
        const b = /** @type {any} */ (boardsRaw)[pid];
        const cols = normalizePlannerColumns(b && b.columns);
        out[pid] = {
          columns: cols,
          entries: normalizePlannerEntries(b && b.entries, cols.map((c) => c.id)),
        };
      }
    }
    for (const pid of plannerIds) {
      if (!out[pid]) out[pid] = { columns: [], entries: [] };
    }
    return out;
  }

  /** @param {any} p legacy flat */
  function legacyFlatToV2(p) {
    const pid = id();
    const cols = normalizePlannerColumns(p.plannerColumns);
    const entries = normalizePlannerEntries(p.plannerEntries, cols.map((c) => c.id));
    return {
      version: 2,
      planners: [{ id: pid, name: "My planner" }],
      selectedPlannerId: pid,
      boards: { [pid]: { columns: cols, entries } },
    };
  }

  /** Copy planner data out of legacy combined `todo-app-v2` into `planner-app-v1` (v2 shape). */
  function migratePlannerFromTodoAppV2() {
    try {
      if (localStorage.getItem(STORAGE_PLANNER)) return;
      const raw = localStorage.getItem(STORAGE_TODO_APP);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      const cols = normalizePlannerColumns(p.plannerColumns);
      if (cols.length === 0) {
        const entRaw = p.plannerEntries;
        if (!Array.isArray(entRaw) || entRaw.length === 0) return;
      }
      const plannerId = id();
      const entries = normalizePlannerEntries(p.plannerEntries, cols.map((c) => c.id));
      localStorage.setItem(
        STORAGE_PLANNER,
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
      localStorage.setItem(STORAGE_TODO_APP, JSON.stringify(p));
    } catch (_) {
      /* ignore */
    }
  }

  function ensureDefaultV2() {
    const pid = id();
    planners = [{ id: pid, name: "My planner" }];
    selectedPlannerId = pid;
    boards = { [pid]: { columns: [], entries: [] } };
    plannerColumns = boards[pid].columns;
    plannerEntries = boards[pid].entries;
  }

  function hydrateV2(p) {
    planners = normalizePlanners(p.planners);
    if (planners.length === 0) {
      ensureDefaultV2();
      return;
    }
    selectedPlannerId =
      typeof p.selectedPlannerId === "string" && planners.some((x) => x.id === p.selectedPlannerId)
        ? p.selectedPlannerId
        : planners[0].id;
    boards = normalizeBoards(p.boards && typeof p.boards === "object" ? p.boards : {}, planners.map((x) => x.id));
    plannerColumns = boards[selectedPlannerId].columns;
    plannerEntries = boards[selectedPlannerId].entries;
  }

  function loadPlannerState() {
    migratePlannerFromTodoAppV2();
    try {
      const raw = localStorage.getItem(STORAGE_PLANNER);
      if (!raw) {
        ensureDefaultV2();
        savePlannerState();
        return;
      }
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") {
        ensureDefaultV2();
        savePlannerState();
        return;
      }
      if (p.version === 2) {
        hydrateV2(p);
        return;
      }
      if (Array.isArray(p.plannerColumns) || Array.isArray(p.plannerEntries)) {
        const v2 = legacyFlatToV2(p);
        localStorage.setItem(STORAGE_PLANNER, JSON.stringify(v2));
        hydrateV2(v2);
        return;
      }
      ensureDefaultV2();
    } catch {
      ensureDefaultV2();
    }
    savePlannerState();
  }

  function savePlannerState() {
    if (selectedPlannerId && boards[selectedPlannerId]) {
      boards[selectedPlannerId] = { columns: plannerColumns, entries: plannerEntries };
    }
    localStorage.setItem(
      STORAGE_PLANNER,
      JSON.stringify({
        version: 2,
        planners,
        selectedPlannerId,
        boards,
      })
    );
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

  function closeNewPlannerPanel() {
    newPlannerPanel.hidden = true;
    toggleNewPlannerBtn.setAttribute("aria-expanded", "false");
    newPlannerNameInput.value = "";
  }

  function parseTagsInput(raw) {
    return raw
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t.slice(0, 33) : "#" + t.slice(0, 32)))
      .slice(0, 16);
  }

  function patchPlannerEntry(entryId, patch) {
    const e = plannerEntries.find((x) => x.id === entryId);
    if (!e) return;
    Object.assign(e, patch);
    savePlannerState();
  }

  function updatePlannerColumn(columnId, partial) {
    const c = plannerColumns.find((x) => x.id === columnId);
    if (!c) return;
    Object.assign(c, partial);
    savePlannerState();
  }

  function addPlannerColumn() {
    const column = { id: id(), title: "New column", emoji: "📌" };
    plannerColumns.push(column);
    savePlannerState();
    renderPlannerSidebar();
    dealingColumnId = column.id;
    renderPlanner();
    queueColumnDealAnimation(column.id);
  }

  function removePlannerColumn(columnId) {
    plannerColumns = plannerColumns.filter((c) => c.id !== columnId);
    plannerEntries = plannerEntries.filter((e) => e.columnId !== columnId);
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function addPlannerEntry(columnId) {
    if (!plannerColumns.some((c) => c.id === columnId)) return;
    plannerEntries.unshift({
      id: id(),
      columnId,
      title: "",
      note: "",
      completed: false,
      tags: [],
      expanded: false,
    });
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function removePlannerEntry(entryId) {
    plannerEntries = plannerEntries.filter((e) => e.id !== entryId);
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function togglePlannerEntry(entryId) {
    const e = plannerEntries.find((x) => x.id === entryId);
    if (!e) return;
    e.completed = !e.completed;
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function clearPlannerCompleted() {
    plannerEntries = plannerEntries.filter((e) => !e.completed);
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function selectPlanner(pid) {
    if (pid === selectedPlannerId) {
      if (isMobileSidebar()) closeSidebar();
      return;
    }
    if (!boards[pid]) return;
    selectedPlannerId = pid;
    plannerColumns = boards[pid].columns;
    plannerEntries = boards[pid].entries;
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
    if (isMobileSidebar()) closeSidebar();
  }

  function addPlannerWorkspace(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    boards[selectedPlannerId] = { columns: plannerColumns, entries: plannerEntries };
    const pid = id();
    planners.push({ id: pid, name: trimmed.slice(0, 48) });
    boards[pid] = { columns: [], entries: [] };
    selectedPlannerId = pid;
    plannerColumns = boards[pid].columns;
    plannerEntries = boards[pid].entries;
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
    closeNewPlannerPanel();
    if (isMobileSidebar()) closeSidebar();
  }

  function removePlannerWorkspace(plannerId, evt) {
    evt.stopPropagation();
    if (planners.length <= 1) return;
    boards[selectedPlannerId] = { columns: plannerColumns, entries: plannerEntries };
    planners = planners.filter((p) => p.id !== plannerId);
    delete boards[plannerId];
    if (selectedPlannerId === plannerId) {
      selectedPlannerId = planners[0].id;
      plannerColumns = boards[selectedPlannerId].columns;
      plannerEntries = boards[selectedPlannerId].entries;
    }
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function entryIsExpanded(entry) {
    return entry.expanded !== false;
  }

  function buildPlannerCardEl(entry) {
    const expanded = entryIsExpanded(entry);
    const card = document.createElement("article");
    card.className = "planner-card" + (entry.completed ? " is-done" : "") + (expanded ? "" : " is-collapsed");
    card.dataset.entryId = entry.id;

    const top = document.createElement("div");
    top.className = "planner-card-top";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "planner-card-check";
    check.checked = entry.completed;
    check.setAttribute("aria-label", entry.completed ? "Mark as not done" : "Mark as done");
    check.addEventListener("change", () => togglePlannerEntry(entry.id));

    const titleWrap = document.createElement("div");
    titleWrap.className = "planner-card-title-wrap";

    const titleInp = document.createElement("input");
    titleInp.type = "text";
    titleInp.className = "planner-card-title";
    titleInp.value = entry.title;
    titleInp.placeholder = "Title";
    titleInp.maxLength = 200;
    titleInp.addEventListener("change", () => {
      patchPlannerEntry(entry.id, { title: titleInp.value.slice(0, 200) });
    });

    titleWrap.appendChild(titleInp);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "planner-card-toggle";
    toggle.setAttribute("aria-label", expanded ? "Collapse card" : "Expand card");
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.innerHTML = '<span class="planner-card-toggle-icon" aria-hidden="true"></span>';
    toggle.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = entryIsExpanded(entry);
      patchPlannerEntry(entry.id, { expanded: !open });
      renderPlanner();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "planner-card-delete";
    del.textContent = "×";
    del.setAttribute("aria-label", "Remove entry");
    del.addEventListener("click", () => removePlannerEntry(entry.id));

    top.append(check, titleWrap, toggle, del);

    const drawer = document.createElement("div");
    drawer.className = "planner-card-drawer";
    const drawerInner = document.createElement("div");
    drawerInner.className = "planner-card-drawer-inner";

    const noteTa = document.createElement("textarea");
    noteTa.className = "planner-card-note";
    noteTa.value = entry.note;
    noteTa.placeholder = "Notes…";
    noteTa.rows = 3;
    noteTa.addEventListener("change", () => {
      patchPlannerEntry(entry.id, { note: noteTa.value.slice(0, 4000) });
    });

    const tagsInp = document.createElement("input");
    tagsInp.type = "text";
    tagsInp.className = "planner-card-tags";
    tagsInp.value = entry.tags
      .map((t) => (t.startsWith("#") ? t : "#" + t))
      .join(", ");
    tagsInp.placeholder = "Tags: #work, ideas";
    tagsInp.addEventListener("change", () => {
      patchPlannerEntry(entry.id, { tags: parseTagsInput(tagsInp.value) });
    });

    drawerInner.append(noteTa, tagsInp);
    drawer.appendChild(drawerInner);
    card.append(top, drawer);
    return card;
  }

  function renamePlanner(plannerId, rawName) {
    const p = planners.find((x) => x.id === plannerId);
    if (!p) return;
    const name = rawName.trim().slice(0, 48) || "Untitled";
    if (p.name === name) return;
    p.name = name;
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function countEntriesForPlanner(pid) {
    const b = boards[pid];
    return b ? b.entries.length : 0;
  }

  function renderPlannerSidebar() {
    plannerWorkspaceListEl.innerHTML = "";
    planners.forEach((pl) => {
      const li = document.createElement("li");
      li.className = "category-item";

      const row = document.createElement("div");
      row.className = "category-btn planner-sidebar-row" + (pl.id === selectedPlannerId ? " is-active" : "");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Planner ${pl.name}`);
      row.setAttribute("aria-pressed", pl.id === selectedPlannerId ? "true" : "false");

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "planner-name-input";
      nameInput.value = pl.name;
      nameInput.maxLength = 48;
      nameInput.setAttribute("aria-label", "Planner name");
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameInput.blur();
        }
      });
      const commitPlannerName = () => {
        const cur = planners.find((x) => x.id === pl.id);
        if (!cur) return;
        const v = nameInput.value.trim().slice(0, 48) || "Untitled";
        if (v !== cur.name) renamePlanner(pl.id, v);
        else nameInput.value = cur.name;
      };
      nameInput.addEventListener("change", commitPlannerName);
      nameInput.addEventListener("blur", commitPlannerName);

      const badge = document.createElement("span");
      badge.className = "category-badge";
      badge.textContent = String(countEntriesForPlanner(pl.id));

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "category-remove";
      rm.textContent = "×";
      rm.setAttribute("aria-label", `Delete planner ${pl.name}`);
      rm.disabled = planners.length <= 1;
      rm.addEventListener("click", (evt) => removePlannerWorkspace(pl.id, evt));

      row.append(nameInput, badge, rm);
      row.addEventListener("click", (e) => {
        if (e.target.closest(".category-remove")) return;
        if (e.target.closest(".planner-name-input")) return;
        selectPlanner(pl.id);
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target === nameInput) return;
          e.preventDefault();
          selectPlanner(pl.id);
        }
      });

      li.appendChild(row);
      plannerWorkspaceListEl.appendChild(li);
    });
  }

  function buildPlannerColumnEl(col) {
    const colEl = document.createElement("section");
    colEl.className = "planner-column";
    if (col.id === dealingColumnId) colEl.classList.add("is-dealing");
    colEl.dataset.columnId = col.id;

    const head = document.createElement("header");
    head.className = "planner-column-head";

    const emojiInp = document.createElement("input");
    emojiInp.type = "text";
    emojiInp.className = "planner-column-emoji";
    emojiInp.value = col.emoji;
    emojiInp.maxLength = 8;
    emojiInp.setAttribute("aria-label", "Column icon");
    emojiInp.addEventListener("change", () => {
      updatePlannerColumn(col.id, { emoji: emojiInp.value.trim().slice(0, 8) || "📌" });
    });

    const titleInp = document.createElement("input");
    titleInp.type = "text";
    titleInp.className = "planner-column-title-input";
    titleInp.value = col.title;
    titleInp.setAttribute("aria-label", "Column title");
    titleInp.maxLength = 80;
    titleInp.addEventListener("change", () => {
      updatePlannerColumn(col.id, { title: titleInp.value.trim().slice(0, 80) || "Untitled" });
    });

    const delCol = document.createElement("button");
    delCol.type = "button";
    delCol.className = "planner-column-delete";
    delCol.textContent = "×";
    delCol.setAttribute("aria-label", `Delete column ${col.title}`);
    delCol.addEventListener("click", () => removePlannerColumn(col.id));

    head.append(emojiInp, titleInp, delCol);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "planner-cards";
    plannerEntries
      .filter((e) => e.columnId === col.id)
      .forEach((entry) => {
        cardsWrap.appendChild(buildPlannerCardEl(entry));
      });

    const addEntryBtn = document.createElement("button");
    addEntryBtn.type = "button";
    addEntryBtn.className = "planner-add-card";
    addEntryBtn.textContent = "+ Add entry";
    addEntryBtn.addEventListener("click", () => addPlannerEntry(col.id));

    colEl.append(head, cardsWrap, addEntryBtn);
    return colEl;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function playColumnDealAnimation(columnEl, sourceEl) {
    if (columnDealAnimation) {
      columnDealAnimation.cancel();
      columnDealAnimation = null;
    }

    sourceEl.classList.add("is-dealing-source");

    const columnRect = columnEl.getBoundingClientRect();
    const sourceRect = sourceEl.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2 - (columnRect.left + columnRect.width / 2);
    const startY = sourceRect.top + sourceRect.height / 2 - (columnRect.top + columnRect.height / 2);

    columnDealAnimation = columnEl.animate(
      [
        {
          transform: `translate3d(${startX}px, ${startY}px, 0) rotate(-24deg) scale(0.42)`,
          opacity: 0.15,
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
        },
        {
          transform: `translate3d(${startX * 0.42}px, ${startY * 0.18 - 18}px, 0) rotate(-14deg) scale(0.74)`,
          opacity: 0.72,
          boxShadow: "0 10px 22px rgba(0, 0, 0, 0.16)",
          offset: 0.48,
        },
        {
          transform: "translate3d(-5px, 4px, 0) rotate(3deg) scale(1.03)",
          opacity: 1,
          boxShadow: "0 16px 30px rgba(0, 0, 0, 0.2)",
          offset: 0.84,
        },
        {
          transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)",
          opacity: 1,
          boxShadow: "0 8px 18px rgba(0, 0, 0, 0.12)",
        },
      ],
      {
        duration: 620,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      }
    );

    const finishDeal = () => {
      const anim = columnDealAnimation;
      columnDealAnimation = null;
      if (anim) {
        anim.onfinish = null;
        anim.oncancel = null;
        anim.cancel();
      }
      sourceEl.classList.remove("is-dealing-source");
      columnEl.classList.remove("is-dealing");
      dealingColumnId = "";
      columnEl.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
    };

    columnDealAnimation.onfinish = finishDeal;
    columnDealAnimation.oncancel = finishDeal;
  }

  function queueColumnDealAnimation(columnId) {
    if (prefersReducedMotion()) {
      dealingColumnId = "";
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const columnEl = plannerBoardEl.querySelector(`.planner-column[data-column-id="${columnId}"]`);
        if (!(columnEl instanceof HTMLElement) || !(plannerAddColumnBtn instanceof HTMLElement)) {
          dealingColumnId = "";
          return;
        }
        playColumnDealAnimation(columnEl, plannerAddColumnBtn);
      });
    });
  }

  function renderPlanner() {
    const pl = planners.find((x) => x.id === selectedPlannerId);
    plannerMonthTitleEl.textContent = pl ? pl.name : "Planner";

    const now = new Date();
    const monthLine = now.toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
    const total = plannerEntries.length;
    const done = plannerEntries.filter((e) => e.completed).length;
    if (total === 0) {
      plannerMetaLineEl.textContent = `${monthLine} · Add columns, then add cards below each title.`;
    } else {
      plannerMetaLineEl.textContent = `${monthLine} · ${done} completed · ${total - done} open`;
    }
    plannerClearDoneBtn.hidden = done === 0;

    plannerBoardEl.innerHTML = "";
    if (plannerColumns.length === 0) {
      if (plannerBoardScrollEl instanceof HTMLElement) plannerBoardScrollEl.hidden = true;
      return;
    }
    if (plannerBoardScrollEl instanceof HTMLElement) plannerBoardScrollEl.hidden = false;

    plannerColumns.forEach((col) => {
      plannerBoardEl.appendChild(buildPlannerColumnEl(col));
    });
  }

  sidebarTrigger.addEventListener("click", () => toggleSidebar());
  sidebarBackdrop.addEventListener("click", () => closeSidebar());
  plannerAddColumnBtn.addEventListener("click", () => addPlannerColumn());
  plannerClearDoneBtn.addEventListener("click", () => clearPlannerCompleted());

  toggleNewPlannerBtn.addEventListener("click", () => {
    const open = newPlannerPanel.hidden;
    if (open) {
      newPlannerPanel.hidden = false;
      toggleNewPlannerBtn.setAttribute("aria-expanded", "true");
      newPlannerNameInput.focus();
    } else {
      closeNewPlannerPanel();
    }
  });

  savePlannerBtn.addEventListener("click", () => {
    addPlannerWorkspace(newPlannerNameInput.value);
  });

  newPlannerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addPlannerWorkspace(newPlannerNameInput.value);
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobileSidebar()) closeSidebar();
  });

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("planner")) return;
    loadPlannerState();
    renderPlannerSidebar();
    renderPlanner();
  });

  window.addEventListener("daily-space-locale-changed", () => {
    renderPlannerSidebar();
    renderPlanner();
  });

  loadPlannerState();
  renderPlannerSidebar();
  renderPlanner();
})();
