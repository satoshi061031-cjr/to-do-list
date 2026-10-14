(function () {
  const KEYS = {
    todo: "todo-app-v2",
    planner: "planner-app-v1",
    calendar: "calendar-app-v1",
    tally: "tally-book-v1",
    travel: "travel-book-v1",
  };

  const JUMPS = [
    { id: "jump-today", label: "Today", hint: "Todo", href: "todo.html#today", aliases: ["today", "todo"] },
    { id: "jump-calendar", label: "Calendar", hint: "Month", href: "calendar.html", aliases: ["calendar"] },
    { id: "jump-planner", label: "Projects", hint: "Boards", href: "planner.html", aliases: ["planner", "projects", "项目"] },
    { id: "jump-mail", label: "Mail", hint: "Inbox", href: "mail.html", aliases: ["mail", "inbox"] },
    { id: "jump-tally", label: "Tally book", hint: "Spend", href: "tally.html", aliases: ["tally", "money"] },
    { id: "jump-travel", label: "Travel", hint: "Trips", href: "travel.html", aliases: ["travel", "trip"] },
    { id: "jump-teamwork", label: "Teamwork", hint: "Notes", href: "teamwork.html", aliases: ["teamwork"] },
  ];

  function read(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function hay() {
    return Array.from(arguments)
      .flat()
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function targetHref(page, focus, id, extra = {}) {
    const params = { focus, id, ...extra };
    return `${page}?${Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;
  }

  function target() {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus") || "";
    if (!["todo", "reminder", "expense", "card", "trip"].includes(focus)) return null;
    return { focus, id: (params.get("id") || "").slice(0, 200), board: (params.get("board") || "").slice(0, 200) };
  }

  function highlight(node) {
    if (!node) return;
    node.classList.add("workspace-target");
    node.scrollIntoView({ behavior: "instant", block: "center" });
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    node.focus({ preventScroll: true });
  }

  function missing() {
    const existing = document.getElementById("workspace-target-status");
    if (existing) return;
    const status = document.createElement("p");
    status.id = "workspace-target-status";
    status.className = "workspace-target-status";
    status.setAttribute("role", "status");
    status.textContent = window.DailySpaceI18n?.t("This item is no longer available. Search again to find another.", "这条内容已不存在，可以重新搜索。") || "This item is no longer available. Search again to find another.";
    document.querySelector("[data-page-header]")?.insertAdjacentElement("afterend", status);
  }

  function collectEntries() {
    const entries = [];
    const todo = read(KEYS.todo);
    const calendar = read(KEYS.calendar);
    const planner = read(KEYS.planner);
    const reminders = Array.isArray(calendar.reminders) ? calendar.reminders : [];
    const cards = Object.values(planner.boards || {}).flatMap(board => Array.isArray(board?.entries) ? board.entries : []);
    (Array.isArray(todo.todos) ? todo.todos : []).forEach((item) => {
      if (!item || typeof item.text !== "string") return;
      if (item.sourceReminderId && reminders.some(reminder => reminder.id === item.sourceReminderId)) return;
      if (item.sourcePlannerId && cards.some(entry => entry.id === item.sourcePlannerId)) return;
      entries.push({
        id: `todo:${item.id}`,
        label: item.text,
        hint: item.completed ? "Todo · done" : item.dueDate ? `Todo · ${item.dueDate}` : "Todo",
        href: targetHref("todo.html", "todo", item.id),
        hay: hay(item.text, item.dueDate, item.dueTime),
      });
    });

    (Array.isArray(calendar.reminders) ? calendar.reminders : []).forEach((item) => {
      if (!item || typeof item.text !== "string") return;
      entries.push({
        id: `cal:${item.id}`,
        label: item.text,
        hint: item.date ? `Reminder · ${item.date}` : "Reminder",
        href: targetHref("calendar.html", "reminder", item.id),
        hay: hay(item.text, item.date, item.startTime),
      });
    });

    const boards = planner.boards && typeof planner.boards === "object" ? planner.boards : {};
    Object.keys(boards).forEach((plannerId) => {
      const board = boards[plannerId] || {};
      const workspace = (Array.isArray(planner.planners) ? planner.planners : []).find(
        (item) => item && item.id === plannerId
      );
      (Array.isArray(board.entries) ? board.entries : []).forEach((entry) => {
        if (!entry || typeof entry.title !== "string") return;
        entries.push({
          id: `planner:${entry.id}`,
          label: entry.title,
          hint: workspace && workspace.name ? `Planner · ${workspace.name}` : "Planner",
          href: targetHref("planner.html", "card", entry.id, { board: plannerId }),
          hay: hay(entry.title, entry.note, workspace && workspace.name),
        });
      });
    });

    const tally = read(KEYS.tally);
    (Array.isArray(tally.records) ? tally.records : []).forEach((record) => {
      if (!record || typeof record !== "object") return;
      const label = [record.category, record.note].filter(Boolean).join(" · ") || "Expense";
      entries.push({
        id: `tally:${record.id}`,
        label,
        hint: record.date ? `Tally · ${record.date}` : "Tally",
        href: targetHref("tally.html", "expense", record.id),
        hay: hay(record.category, record.note, record.date, record.amount),
      });
    });

    const travel = read(KEYS.travel);
    (Array.isArray(travel.trips) ? travel.trips : []).forEach((trip) => {
      if (!trip || typeof trip.name !== "string") return;
      entries.push({
        id: `travel:${trip.id}`,
        label: trip.name,
        hint: trip.destination ? `Travel · ${trip.destination}` : "Travel",
        href: targetHref("travel.html", "trip", trip.id),
        hay: hay(trip.name, trip.destination, trip.startDate, trip.endDate),
      });
    });
    return entries;
  }

  function matches(item, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const blob = hay(item.label, item.hint, item.hay, ...(item.aliases || []));
    return blob.includes(q);
  }

  function searchWorkspace(query, limit) {
    const capped = Math.max(1, Math.min(20, Number(limit) || 12));
    const q = String(query || "").trim();
    const jumps = JUMPS.filter((item) => matches(item, q)).map((item) => ({ ...item, kind: "jump" }));
    if (!q) return jumps.slice(0, capped);
    const content = collectEntries()
      .filter((item) => matches(item, q))
      .slice(0, capped)
      .map((item) => ({ ...item, kind: "item" }));
    return [...jumps, ...content].slice(0, capped);
  }

  window.DailySpaceSearch = {
    search: searchWorkspace,
    collectEntries,
    target,
    highlight,
    missing,
    JUMPS,
  };
})();
