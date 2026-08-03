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
  /** @typedef {{ id: string; columnId: string; title: string; note: string; completed: boolean; tags: string[]; expanded: boolean; assigneeUserId?: string|null; dueDate?: string|null }} PlannerEntry */

  /** @type {PlannerColumn[]} */
  let plannerColumns = [];
  /** @type {PlannerEntry[]} */
  let plannerEntries = [];

  /** @type {"personal"|"team"} */
  let boardMode = "personal";
  /** @type {string} */
  let selectedTeamBoardId = "";
  /** @type {{ id: string; name: string; workspaceId: string }[]} */
  let teamBoards = [];
  /** @type {{ userId: string; label: string; role: string }[]} */
  let teamMembers = [];
  let teamStatusMessage = "";
  let sessionUserId = "";
  /** @type {string} */
  let selectedWorkspaceId = "";
  /** @type {string} */
  let selectedWorkspaceName = "";
  /** @type {string} */
  let selectedWorkspaceRole = "";
  let canManageTeamBoards = false;

  const STORAGE_SELECTED_WORKSPACE = "daily-space-selected-workspace-v1";
  const sidebarEl = document.getElementById("sidebar");
  const sidebarTrigger = document.getElementById("sidebar-trigger");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const plannerWorkspaceListEl = document.getElementById("planner-workspace-list");
  const plannerTeamBoardListEl = document.getElementById("planner-team-board-list");
  const plannerTeamHintEl = document.getElementById("planner-team-hint");
  const plannerTeamBoardActionsEl = document.getElementById("planner-team-board-actions");
  const plannerNewTeamBoardBtn = document.getElementById("planner-new-team-board");
  const toggleNewPlannerBtn = document.getElementById("toggle-new-planner");
  const newPlannerPanel = document.getElementById("new-planner-panel");
  const newPlannerNameInput = document.getElementById("new-planner-name");
  const savePlannerBtn = document.getElementById("save-planner");
  const plannerBoardScrollEl = document.querySelector(".planner-board-scroll");
  const plannerBoardEl = document.getElementById("planner-board");
  const plannerBoardEmptyEl = document.getElementById("planner-board-empty");
  const plannerBoardEmptyTitleEl = document.getElementById("planner-board-empty-title");
  const plannerBoardEmptyCopyEl = document.getElementById("planner-board-empty-copy");
  const plannerEmptyAddColumnBtn = null;
  const plannerMonthTitleEl = document.getElementById("planner-month-title");
  const plannerModeBadgeEl = document.getElementById("planner-mode-badge");
  const plannerCrumbBoardEl = document.getElementById("planner-crumb-board");
  const plannerMetaLineEl = document.getElementById("planner-meta-line");
  const plannerFilterBtn = document.getElementById("planner-filter-btn");
  const plannerShareBtn = document.getElementById("planner-share-btn");
  const plannerAddColumnBtn = document.getElementById("planner-add-column");
  const plannerClearDoneBtn = document.getElementById("planner-clear-done");
  const plannerSearchInput = document.getElementById("planner-search");
  let plannerSearchQuery = "";

  function isZhLocale() {
    return window.DailySpaceI18n?.locale?.() === "zh";
  }
  const plannerTeamStatusEl = document.createElement("p");
  plannerTeamStatusEl.className = "planner-team-status";
  plannerTeamStatusEl.hidden = true;
  if (plannerMetaLineEl && plannerMetaLineEl.parentElement) {
    plannerMetaLineEl.parentElement.appendChild(plannerTeamStatusEl);
  }
  let dealingColumnId = "";
  let columnDealAnimation = null;

  function id() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  function defaultKanbanColumns() {
    return [
      { id: id(), title: "Planned", emoji: "○" },
      { id: id(), title: "In Progress", emoji: "◎" },
      { id: id(), title: "Done", emoji: "✓" },
      { id: id(), title: "On Hold", emoji: "◌" },
    ];
  }

  const FIXED_COLUMN_SPECS = [
    { title: "Planned", emoji: "○" },
    { title: "In Progress", emoji: "◎" },
    { title: "Done", emoji: "✓" },
    { title: "On Hold", emoji: "◌" },
  ];

  function ensureFixedKanbanColumns() {
    if (isTeamMode()) return false;
    const byTitle = new Map(
      plannerColumns.map((col) => [String(col.title || "").trim().toLowerCase(), col])
    );
    const next = FIXED_COLUMN_SPECS.map((spec) => {
      const existing = byTitle.get(spec.title.toLowerCase());
      if (existing) {
        existing.title = spec.title;
        if (!existing.emoji) existing.emoji = spec.emoji;
        return existing;
      }
      return { id: id(), title: spec.title, emoji: spec.emoji };
    });
    const fixedIds = new Set(next.map((col) => col.id));
    const plannedId = next[0].id;
    let changed = next.length !== plannerColumns.length;
    plannerColumns.forEach((col) => {
      if (fixedIds.has(col.id)) return;
      changed = true;
      plannerEntries.forEach((entry) => {
        if (entry.columnId === col.id) entry.columnId = plannedId;
      });
    });
    FIXED_COLUMN_SPECS.forEach((spec, index) => {
      if (!byTitle.has(spec.title.toLowerCase())) changed = true;
      if (plannerColumns[index]?.id !== next[index].id) changed = true;
    });
    plannerColumns = next;
    return changed;
  }

  function entryMatchesSearch(entry) {
    const q = plannerSearchQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [entry.title, entry.note, ...(entry.tags || [])].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function seedKanbanIfEmpty() {
    if (isTeamMode()) return false;
    return ensureFixedKanbanColumns();
  }

  function todayIso() {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDaysIso(iso, days) {
    const [y, mo, da] = iso.split("-").map(Number);
    const dt = new Date(y, mo - 1, da);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function columnTitleById(columnId) {
    const col = plannerColumns.find((c) => c.id === columnId);
    return col ? col.title : "Column";
  }

  function columnStatusKey(col) {
    const title = String(col?.title || "").toLowerCase();
    if (title.includes("progress")) return "progress";
    if (title.includes("done")) return "done";
    if (title.includes("hold")) return "hold";
    return "planned";
  }

  function initialsFromLabel(label) {
    const parts = String(label || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function avatarTone(seed) {
    const tones = [
      "color-mix(in srgb, var(--secondary) 75%, var(--primary))",
      "color-mix(in srgb, var(--tertiary) 55%, var(--secondary))",
      "color-mix(in srgb, var(--success) 55%, var(--secondary))",
      "color-mix(in srgb, var(--danger) 40%, var(--secondary))",
      "color-mix(in srgb, var(--accent) 70%, var(--primary))",
    ];
    let hash = 0;
    String(seed || "").split("").forEach((ch) => {
      hash = (hash + ch.charCodeAt(0) * 17) % tones.length;
    });
    return tones[hash];
  }

  function entryAvatarLabels(entry) {
    if (isTeamMode()) {
      const member = teamMembers.find((item) => item.userId === entry.assigneeUserId);
      if (member?.label) return [member.label];
      if (entry.assigneeUserId) return [entry.assigneeUserId];
      return [];
    }
    const tags = Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [];
    if (tags.length) return tags.slice(0, 3).map((t) => t.replace(/^#/, ""));
    if (entry.title) return [entry.title];
    return [];
  }

  function boardAssigneeLabels() {
    const labels = [];
    const seen = new Set();
    plannerEntries.forEach((entry) => {
      entryAvatarLabels(entry).forEach((label) => {
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        labels.push(label);
      });
    });
    return labels;
  }

  function appendAvatarStack(container, labels, className) {
    container.innerHTML = "";
    const shown = labels.slice(0, 3);
    shown.forEach((label) => {
      const avatar = document.createElement("span");
      avatar.className = className;
      avatar.textContent = initialsFromLabel(label);
      avatar.title = label;
      avatar.style.background = avatarTone(label);
      container.appendChild(avatar);
    });
    if (labels.length > 3) {
      const more = document.createElement("span");
      more.className = `${className} is-more`;
      more.textContent = `+${labels.length - 3}`;
      container.appendChild(more);
    }
  }

  function renderAssigneeBar() {
    /* Assignees live on cards; shell header stays greeting + title only. */
  }

  function calendarHrefForDay(iso) {
    return iso ? `calendar.html#${iso}` : "calendar.html";
  }

  function sendEntryToTodoToday(entry) {
    if (!entry || !window.DailySpaceAgentData || typeof window.DailySpaceAgentData.applyActions !== "function") {
      window.location.href = "todo.html#today";
      return;
    }
    window.DailySpaceAgentData.applyActions([
      {
        type: "todo_add",
        text: String(entry.title || "Planner card").slice(0, 500),
        dueDate: entry.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) ? entry.dueDate : todayIso(),
      },
    ]);
    window.location.href = "todo.html#today";
  }

  function focusPlannerEntry(entryId) {
    const entry = plannerEntries.find((e) => e.id === entryId);
    if (!entry) return;
    if (!entry.expanded) {
      entry.expanded = true;
      if (!isTeamMode()) savePlannerState();
      renderPlanner();
    }
    queueMicrotask(() => {
      const card = plannerBoardEl?.querySelector(`[data-entry-id="${entryId}"]`);
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        card.classList.add("is-due-focus");
        setTimeout(() => card.classList.remove("is-due-focus"), 1200);
      }
    });
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
        emoji: typeof x.emoji === "string" && x.emoji.trim() ? String(x.emoji).trim().slice(0, 8) : "",
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
      const expanded = typeof x.expanded === "boolean" ? x.expanded : false;
      out.push({
        id: x.id,
        columnId: x.columnId,
        title: typeof x.title === "string" ? x.title.slice(0, 200) : "",
        note: typeof x.note === "string" ? x.note.slice(0, 4000) : "",
        completed: !!x.completed,
        tags,
        expanded,
        assigneeUserId: typeof x.assigneeUserId === "string" ? x.assigneeUserId : null,
        dueDate: typeof x.dueDate === "string" ? x.dueDate : null,
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
    const columns = defaultKanbanColumns();
    planners = [{ id: pid, name: "My board" }];
    selectedPlannerId = pid;
    boards = { [pid]: { columns, entries: [] } };
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
      } else if (Array.isArray(p.plannerColumns) || Array.isArray(p.plannerEntries)) {
        const v2 = legacyFlatToV2(p);
        localStorage.setItem(STORAGE_PLANNER, JSON.stringify(v2));
        hydrateV2(v2);
      } else {
        ensureDefaultV2();
      }
    } catch {
      ensureDefaultV2();
    }
    if (seedKanbanIfEmpty()) {
      /* filled empty board with demo columns/cards */
    }
    savePlannerState();
  }

  function isTeamMode() {
    return boardMode === "team";
  }

  function setTeamStatus(message, isError) {
    teamStatusMessage = message || "";
    plannerTeamStatusEl.hidden = !teamStatusMessage;
    plannerTeamStatusEl.textContent = teamStatusMessage;
    plannerTeamStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  async function apiRequest(path, init) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }

  function taskFromApi(task) {
    return {
      id: task.id,
      columnId: task.columnId,
      title: task.title || "",
      note: task.note || "",
      completed: Boolean(task.completed),
      tags: [],
      expanded: false,
      assigneeUserId: task.assigneeUserId || null,
      dueDate: task.dueDate || null,
    };
  }

  function applyTeamBoardPayload(board) {
    selectedTeamBoardId = board.id;
    plannerColumns = (board.columns || []).map((col) => ({
      id: col.id,
      title: col.title,
      emoji: col.emoji || "",
    }));
    plannerEntries = (board.tasks || []).map(taskFromApi);
  }

  async function loadTeamMembers(workspaceId) {
    const payload = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
    teamMembers = (payload.members || [])
      .filter((m) => m.status === "active")
      .map((m) => ({ userId: m.userId, label: m.label || m.userId, role: m.role }));
  }

  async function reloadSelectedTeamBoard() {
    if (!selectedTeamBoardId) return;
    const payload = await apiRequest(`/api/boards/${encodeURIComponent(selectedTeamBoardId)}`);
    applyTeamBoardPayload(payload.board);
  }

  async function loadTeamBoards() {
    try {
      const me = await apiRequest("/api/auth/me");
      if (!me.user) {
        sessionUserId = "";
        selectedWorkspaceId = "";
        selectedWorkspaceName = "";
        selectedWorkspaceRole = "";
        canManageTeamBoards = false;
        teamBoards = [];
        teamMembers = [];
        if (plannerTeamHintEl) {
          plannerTeamHintEl.hidden = false;
          plannerTeamHintEl.textContent =
            "Sign in and create a workspace in Teamwork to open shared boards.";
        }
        return;
      }
      sessionUserId = String(me.user.userId || me.user.email || "").trim().toLowerCase();
      const workspacesPayload = await apiRequest("/api/workspaces");
      const workspaces = Array.isArray(workspacesPayload.workspaces) ? workspacesPayload.workspaces : [];
      if (!workspaces.length) {
        teamBoards = [];
        selectedWorkspaceId = "";
        selectedWorkspaceName = "";
        selectedWorkspaceRole = "";
        canManageTeamBoards = false;
        if (plannerTeamHintEl) {
          plannerTeamHintEl.hidden = false;
          plannerTeamHintEl.textContent = "Create a workspace in Teamwork to unlock shared boards.";
        }
        return;
      }
      let workspaceId = "";
      try {
        workspaceId = String(localStorage.getItem(STORAGE_SELECTED_WORKSPACE) || "").trim();
      } catch (_) {
        workspaceId = "";
      }
      const activeWorkspace = workspaces.find((w) => w.id === workspaceId) || workspaces[0];
      workspaceId = activeWorkspace.id;
      selectedWorkspaceId = workspaceId;
      selectedWorkspaceName =
        typeof activeWorkspace.name === "string" && activeWorkspace.name.trim()
          ? activeWorkspace.name.trim()
          : "Workspace";
      selectedWorkspaceRole = activeWorkspace.role || "member";
      canManageTeamBoards = Boolean(
        activeWorkspace.capabilities?.manageBoards ||
          selectedWorkspaceRole === "owner" ||
          selectedWorkspaceRole === "admin"
      );
      try {
        localStorage.setItem(STORAGE_SELECTED_WORKSPACE, workspaceId);
      } catch (_) {
        /* ignore */
      }
      const boardsPayload = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/boards`);
      let boardsList = Array.isArray(boardsPayload.boards) ? boardsPayload.boards : [];
      if (!boardsList.length && canManageTeamBoards) {
        const created = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/boards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Team board" }),
        });
        boardsList = [created.board];
      }
      teamBoards = boardsList.map((b) => ({
        id: b.id,
        name: b.name,
        workspaceId: b.workspaceId || workspaceId,
      }));
      await loadTeamMembers(workspaceId);
      if (plannerTeamHintEl) {
        if (teamBoards.length) {
          plannerTeamHintEl.hidden = true;
        } else {
          plannerTeamHintEl.hidden = false;
          plannerTeamHintEl.textContent = canManageTeamBoards
            ? "No team boards yet. Create one below."
            : "No team boards yet. Ask an owner or admin to create one.";
        }
      }
      setTeamStatus("");
    } catch (error) {
      teamBoards = [];
      setTeamStatus(error.message || "Failed to load team boards.", true);
    }
  }

  async function selectTeamBoard(boardId) {
    boardMode = "team";
    selectedTeamBoardId = boardId;
    setTeamStatus("Loading board…");
    try {
      await reloadSelectedTeamBoard();
      setTeamStatus("");
      renderPlannerSidebar();
      renderPlanner();
      closeSidebar();
    } catch (error) {
      setTeamStatus(error.message || "Failed to open team board.", true);
    }
  }

  function selectPersonalPlanner(pid) {
    boardMode = "personal";
    selectedTeamBoardId = "";
    setTeamStatus("");
    selectPlanner(pid);
  }

  function savePlannerState() {
    if (isTeamMode()) return;
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

  function patchToApi(patch) {
    /** @type {Record<string, unknown>} */
    const body = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.note !== undefined) body.note = patch.note;
    if (patch.completed !== undefined) body.completed = patch.completed;
    if (patch.columnId !== undefined) body.columnId = patch.columnId;
    if (patch.assigneeUserId !== undefined) body.assigneeUserId = patch.assigneeUserId;
    if (patch.dueDate !== undefined) body.dueDate = patch.dueDate;
    return body;
  }

  function syncTeamTask(entryId, patch) {
    apiRequest(`/api/tasks/${encodeURIComponent(entryId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchToApi(patch)),
    }).catch(async (error) => {
      setTeamStatus(error.message || "Failed to update task.", true);
      try {
        await reloadSelectedTeamBoard();
        renderPlanner();
      } catch (_) {
        /* ignore */
      }
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
    if (isTeamMode()) {
      syncTeamTask(entryId, patch);
      return;
    }
    savePlannerState();
  }

  function movePlannerEntry(entryId, columnId) {
    if (!plannerColumns.some((c) => c.id === columnId)) return;
    const e = plannerEntries.find((x) => x.id === entryId);
    if (!e || e.columnId === columnId) return;
    e.columnId = columnId;
    if (isTeamMode()) {
      syncTeamTask(entryId, { columnId });
      renderPlanner();
      return;
    }
    savePlannerState();
    renderPlanner();
  }

  function updatePlannerColumn(columnId, partial) {
    const c = plannerColumns.find((x) => x.id === columnId);
    if (!c) return;
    Object.assign(c, partial);
    if (isTeamMode()) {
      apiRequest(`/api/boards/${encodeURIComponent(selectedTeamBoardId)}/columns/${encodeURIComponent(columnId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      }).catch((error) => setTeamStatus(error.message || "Failed to update column.", true));
      return;
    }
    savePlannerState();
  }

  function addPlannerColumn() {
    if (isTeamMode()) return;
    if (ensureFixedKanbanColumns()) {
      savePlannerState();
      renderPlannerSidebar();
      renderPlanner();
    }
  }

  function removePlannerColumn() {
    /* Fixed Planned / In Progress / Done / On Hold columns cannot be removed. */
  }

  function addPlannerEntry(columnId) {
    if (!plannerColumns.some((c) => c.id === columnId)) return;
    if (isTeamMode()) {
      apiRequest(`/api/boards/${encodeURIComponent(selectedTeamBoardId)}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnId,
          title: "New card",
          note: "",
          assigneeUserId: sessionUserId || null,
        }),
      })
        .then(async () => {
          await reloadSelectedTeamBoard();
          renderPlannerSidebar();
          renderPlanner();
        })
        .catch((error) => setTeamStatus(error.message || "Failed to add card.", true));
      return;
    }
    plannerEntries.unshift({
      id: id(),
      columnId,
      title: "",
      note: "",
      completed: false,
      tags: [],
      expanded: true,
      assigneeUserId: null,
      dueDate: null,
    });
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function removePlannerEntry(entryId) {
    if (isTeamMode()) {
      apiRequest(`/api/tasks/${encodeURIComponent(entryId)}`, { method: "DELETE" })
        .then(async () => {
          await reloadSelectedTeamBoard();
          renderPlannerSidebar();
          renderPlanner();
        })
        .catch((error) => setTeamStatus(error.message || "Failed to delete card.", true));
      return;
    }
    plannerEntries = plannerEntries.filter((e) => e.id !== entryId);
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function togglePlannerEntry(entryId) {
    const e = plannerEntries.find((x) => x.id === entryId);
    if (!e) return;
    e.completed = !e.completed;
    if (isTeamMode()) {
      syncTeamTask(entryId, { completed: e.completed });
      renderPlannerSidebar();
      renderPlanner();
      return;
    }
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function clearPlannerCompleted() {
    if (isTeamMode()) {
      const done = plannerEntries.filter((e) => e.completed);
      Promise.all(
        done.map((entry) =>
          apiRequest(`/api/tasks/${encodeURIComponent(entry.id)}`, { method: "DELETE" })
        )
      )
        .then(async () => {
          await reloadSelectedTeamBoard();
          renderPlannerSidebar();
          renderPlanner();
        })
        .catch((error) => setTeamStatus(error.message || "Failed to clear completed.", true));
      return;
    }
    plannerEntries = plannerEntries.filter((e) => !e.completed);
    savePlannerState();
    renderPlannerSidebar();
    renderPlanner();
  }

  function selectPlanner(pid) {
    const switchingFromTeam = boardMode === "team";
    boardMode = "personal";
    selectedTeamBoardId = "";
    setTeamStatus("");
    if (pid === selectedPlannerId && !switchingFromTeam) {
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
    boards[pid] = { columns: defaultKanbanColumns(), entries: [] };
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
    const target = planners.find((p) => p.id === plannerId);
    const name = target ? target.name : "planner";
    if (!window.confirm(`Delete planner “${name}”?`)) return;
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
    return entry.expanded === true;
  }

  function buildPlannerCardEl(entry) {
    const expanded = entryIsExpanded(entry);
    const card = document.createElement("article");
    card.className =
      "planner-card" +
      (entry.completed ? " is-done" : "") +
      (expanded ? "" : " is-collapsed") +
      (entryMatchesSearch(entry) ? "" : " is-filtered-out");
    card.dataset.entryId = entry.id;
    card.addEventListener("click", (ev) => {
      if (expanded) return;
      if (ev.target.closest("a, button, input, textarea, select, label")) return;
      patchPlannerEntry(entry.id, { expanded: true });
      renderPlanner();
    });

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
    del.setAttribute("aria-label", "Remove card");
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removePlannerEntry(entry.id);
    });

    top.append(check, titleWrap, toggle, del);

    const face = document.createElement("div");
    face.className = "planner-card-face";
    const faceTitle = document.createElement("h3");
    faceTitle.className = "planner-card-face-title";
    faceTitle.textContent = entry.title || "Untitled";
    face.appendChild(faceTitle);
    const notePreview = (entry.note || "").trim();
    if (notePreview) {
      const preview = document.createElement("p");
      preview.className = "planner-card-preview";
      preview.textContent = notePreview;
      face.appendChild(preview);
    }

    const foot = document.createElement("div");
    foot.className = "planner-card-foot";
    const avatars = document.createElement("div");
    avatars.className = "planner-card-avatars";
    appendAvatarStack(avatars, entryAvatarLabels(entry).slice(0, 3), "planner-card-avatar");
    foot.appendChild(avatars);

    const drawer = document.createElement("div");
    drawer.className = "planner-card-drawer";
    if (expanded) {
      const drawerInner = document.createElement("div");
      drawerInner.className = "planner-card-drawer-inner";

      if (plannerColumns.length > 1) {
        const moveLabel = document.createElement("label");
        moveLabel.className = "planner-card-move-label";
        moveLabel.textContent = "Column";
        const moveSelect = document.createElement("select");
        moveSelect.className = "planner-card-move";
        moveSelect.setAttribute("aria-label", "Move to column");
        plannerColumns.forEach((col) => {
          const opt = document.createElement("option");
          opt.value = col.id;
          opt.textContent = `${col.emoji ? col.emoji + " " : ""}${col.title}`.trim();
          if (col.id === entry.columnId) opt.selected = true;
          moveSelect.appendChild(opt);
        });
        moveSelect.addEventListener("change", () => {
          movePlannerEntry(entry.id, moveSelect.value);
        });
        moveLabel.appendChild(moveSelect);
        drawerInner.appendChild(moveLabel);
      }

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

      drawerInner.append(noteTa);
      if (isTeamMode()) {
        const assignee = document.createElement("select");
        assignee.className = "planner-card-assignee";
        assignee.setAttribute("aria-label", "Assignee");
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "Unassigned";
        assignee.appendChild(emptyOpt);
        teamMembers.forEach((member) => {
          const opt = document.createElement("option");
          opt.value = member.userId;
          opt.textContent = member.label;
          if (entry.assigneeUserId === member.userId) opt.selected = true;
          assignee.appendChild(opt);
        });
        assignee.addEventListener("change", () => {
          patchPlannerEntry(entry.id, { assigneeUserId: assignee.value || null });
        });
        drawerInner.append(assignee);
      } else {
        drawerInner.append(tagsInp);
      }

      const dueRow = document.createElement("div");
      dueRow.className = "planner-card-due-row";
      const due = document.createElement("input");
      due.type = "date";
      due.className = "planner-card-due";
      due.setAttribute("aria-label", "Due date");
      due.value = entry.dueDate || "";
      due.addEventListener("change", () => {
        patchPlannerEntry(entry.id, { dueDate: due.value || null });
      });
      dueRow.appendChild(due);
      if (entry.dueDate) {
        const openCal = document.createElement("a");
        openCal.className = "planner-card-open-cal";
        openCal.href = calendarHrefForDay(entry.dueDate);
        openCal.textContent = "Calendar";
        dueRow.appendChild(openCal);
        const toTodo = document.createElement("button");
        toTodo.type = "button";
        toTodo.className = "planner-card-to-todo";
        toTodo.textContent = "To Todo";
        toTodo.addEventListener("click", () => sendEntryToTodoToday(entry));
        dueRow.appendChild(toTodo);
      }
      drawerInner.appendChild(dueRow);
      drawer.appendChild(drawerInner);
    }

    card.append(face, foot, top, drawer);
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
      row.className =
        "category-btn planner-sidebar-row" +
        (boardMode === "personal" && pl.id === selectedPlannerId ? " is-active" : "");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Planner ${pl.name}`);
      row.setAttribute(
        "aria-pressed",
        boardMode === "personal" && pl.id === selectedPlannerId ? "true" : "false"
      );

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
        selectPersonalPlanner(pl.id);
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target === nameInput) return;
          e.preventDefault();
          selectPersonalPlanner(pl.id);
        }
      });

      li.appendChild(row);
      plannerWorkspaceListEl.appendChild(li);
    });

    if (plannerTeamBoardListEl) {
      plannerTeamBoardListEl.innerHTML = "";
      teamBoards.forEach((board) => {
        const li = document.createElement("li");
        li.className = "category-item";
        const row = document.createElement("div");
        row.className =
          "category-btn planner-sidebar-row" +
          (boardMode === "team" && board.id === selectedTeamBoardId ? " is-active" : "");
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label", `Team board ${board.name}`);
        row.setAttribute(
          "aria-pressed",
          boardMode === "team" && board.id === selectedTeamBoardId ? "true" : "false"
        );
        const label = document.createElement("span");
        label.className = "planner-team-board-label";
        label.textContent = board.name;
        row.appendChild(label);
        if (canManageTeamBoards && teamBoards.length > 1) {
          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "category-remove";
          rm.textContent = "×";
          rm.setAttribute("aria-label", `Delete team board ${board.name}`);
          rm.addEventListener("click", (evt) => {
            evt.stopPropagation();
            removeTeamBoard(board.id, board.name);
          });
          row.appendChild(rm);
        }
        row.addEventListener("click", (e) => {
          if (e.target.closest(".category-remove")) return;
          selectTeamBoard(board.id);
        });
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectTeamBoard(board.id);
          }
        });
        li.appendChild(row);
        plannerTeamBoardListEl.appendChild(li);
      });
    }
    if (plannerTeamBoardActionsEl) {
      plannerTeamBoardActionsEl.hidden = !canManageTeamBoards || !selectedWorkspaceId;
    }
  }

  async function removeTeamBoard(boardId, boardName) {
    if (!canManageTeamBoards) return;
    if (!window.confirm(`Delete team board “${boardName || "Board"}”?`)) return;
    try {
      await apiRequest(`/api/boards/${encodeURIComponent(boardId)}`, { method: "DELETE" });
      if (selectedTeamBoardId === boardId) {
        selectedTeamBoardId = "";
        boardMode = "personal";
      }
      await loadTeamBoards();
      if (!selectedTeamBoardId && teamBoards[0]) {
        await selectTeamBoard(teamBoards[0].id);
      } else {
        renderPlannerSidebar();
        renderPlanner();
      }
      setTeamStatus("");
    } catch (error) {
      setTeamStatus(error.message || "Failed to delete board.", true);
    }
  }

  async function createTeamBoard() {
    if (!canManageTeamBoards || !selectedWorkspaceId) return;
    const name = window.prompt("Team board name", "Team board");
    if (name == null) return;
    const trimmed = String(name).trim().slice(0, 80) || "Team board";
    try {
      const created = await apiRequest(`/api/workspaces/${encodeURIComponent(selectedWorkspaceId)}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      await loadTeamBoards();
      if (created.board?.id) await selectTeamBoard(created.board.id);
      else {
        renderPlannerSidebar();
        renderPlanner();
      }
    } catch (error) {
      setTeamStatus(error.message || "Failed to create board.", true);
    }
  }

  function buildPlannerColumnEl(col) {
    const colEl = document.createElement("section");
    colEl.className = "planner-column";
    if (col.id === dealingColumnId) colEl.classList.add("is-dealing");
    colEl.dataset.columnId = col.id;

    const head = document.createElement("header");
    head.className = "planner-column-head";

    const status = document.createElement("span");
    status.className = "planner-column-status";
    status.dataset.status = columnStatusKey(col);
    status.setAttribute("aria-hidden", "true");

    const emojiInp = document.createElement("input");
    emojiInp.type = "text";
    emojiInp.className = "planner-column-emoji";
    emojiInp.value = col.emoji;
    emojiInp.maxLength = 8;
    emojiInp.placeholder = "·";
    emojiInp.setAttribute("aria-label", "Column icon");
    emojiInp.title = "Column icon";
    emojiInp.addEventListener("change", () => {
      updatePlannerColumn(col.id, { emoji: emojiInp.value.trim().slice(0, 8) || "" });
    });

    const titleInp = document.createElement("input");
    titleInp.type = "text";
    titleInp.className = "planner-column-title-input";
    titleInp.value = col.title;
    titleInp.readOnly = true;
    titleInp.setAttribute("aria-label", "Column title");
    titleInp.maxLength = 80;

    head.append(status, emojiInp, titleInp);

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
    addEntryBtn.textContent = "+ Add card";
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
        if (!(columnEl instanceof HTMLElement)) {
          dealingColumnId = "";
          return;
        }
        dealingColumnId = "";
        columnEl.classList.remove("is-dealing");
      });
    });
  }

  function renderPlanner() {
    const boardName = (() => {
      if (isTeamMode()) {
        const board = teamBoards.find((item) => item.id === selectedTeamBoardId);
        return board ? board.name : "Team board";
      }
      const pl = planners.find((x) => x.id === selectedPlannerId);
      return pl ? pl.name : "Planner";
    })();

    if (plannerModeBadgeEl) {
      if (isTeamMode()) {
        plannerModeBadgeEl.textContent = selectedWorkspaceName || "Team";
      } else {
        plannerModeBadgeEl.textContent = "Personal";
      }
    }
    if (plannerCrumbBoardEl) plannerCrumbBoardEl.textContent = boardName;
    if (plannerMonthTitleEl) plannerMonthTitleEl.textContent = boardName;

    const now = new Date();
    const monthLine = now.toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
    const total = plannerEntries.length;
    const done = plannerEntries.filter((e) => e.completed).length;
    if (plannerMetaLineEl) {
      if (plannerColumns.length === 0) {
        plannerMetaLineEl.textContent = isTeamMode()
          ? `${monthLine} · Shared board · add a column, then cards with assignees.`
          : `${monthLine} · Add a column, then put cards inside it.`;
      } else if (total === 0) {
        plannerMetaLineEl.textContent = isTeamMode()
          ? `${monthLine} · Shared board · add cards and assign people.`
          : `${monthLine} · Add cards under each column.`;
      } else {
        plannerMetaLineEl.textContent = `${monthLine} · ${done} completed · ${total - done} open`;
      }
    }
    plannerClearDoneBtn.hidden = done === 0;
    renderAssigneeBar();

    if (plannerBoardScrollEl instanceof HTMLElement) plannerBoardScrollEl.hidden = false;

    const isEmpty = plannerColumns.length === 0;
    if (plannerBoardEmptyEl instanceof HTMLElement) {
      plannerBoardEmptyEl.hidden = !isEmpty;
    }
    if (isEmpty) {
      if (plannerBoardEmptyTitleEl) {
        plannerBoardEmptyTitleEl.textContent = isTeamMode() ? "No shared columns yet" : "No columns yet";
      }
      if (plannerBoardEmptyCopyEl) {
        plannerBoardEmptyCopyEl.textContent = isTeamMode()
          ? "Ask the agent to set up a shared board, or create columns in Teamwork."
          : "Ask the Daily Space agent to set up Planned, In Progress, Done, and On Hold.";
      }
    }

    plannerBoardEl.innerHTML = "";
    if (isEmpty) return;

    plannerColumns.forEach((col) => {
      plannerBoardEl.appendChild(buildPlannerColumnEl(col));
    });
  }

  sidebarTrigger.addEventListener("click", () => toggleSidebar());
  sidebarBackdrop.addEventListener("click", () => closeSidebar());
  plannerClearDoneBtn.addEventListener("click", () => clearPlannerCompleted());
  if (plannerSearchInput) {
    plannerSearchInput.addEventListener("input", () => {
      plannerSearchQuery = plannerSearchInput.value || "";
      renderPlanner();
    });
  }

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

  window.addEventListener("daily-space-auth-updated", () => {
    loadTeamBoards().then(() => {
      renderPlannerSidebar();
      if (isTeamMode() && selectedTeamBoardId) return selectTeamBoard(selectedTeamBoardId);
    });
  });

  if (plannerNewTeamBoardBtn) {
    plannerNewTeamBoardBtn.addEventListener("click", () => {
      createTeamBoard();
    });
  }

  loadPlannerState();
  renderPlannerSidebar();
  renderPlanner();
  loadTeamBoards().then(() => renderPlannerSidebar());
})();
