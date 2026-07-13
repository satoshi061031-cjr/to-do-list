(function () {
  const STORAGE_TODO_APP = "todo-app-v2";
  const STORAGE_CALENDAR = "calendar-app-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  /** @type {{ id: string; text: string; completed: boolean; dueDate: string | null; categoryId: string | null }[]} */
  let todos = [];
  /** @type {{ id: string; name: string }[]} */
  let categories = [];
  /** @type {Record<string, any>} */
  let todoStore = {};

  /** @type {{ id: string; date: string; text: string; startTime: string | null; endTime: string | null; priority: "high" | "medium" | "low" }[]} */
  let reminders = [];
  let selectedDate = todayIso();
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth() + 1;

  const sidebarEl = document.getElementById("sidebar");
  const sidebarTrigger = document.getElementById("sidebar-trigger");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const calendarTitleEl = document.getElementById("calendar-title");
  const calendarMetaEl = document.getElementById("calendar-meta");
  const calendarGridEl = document.getElementById("calendar-grid");
  const prevBtn = document.getElementById("calendar-prev");
  const nextBtn = document.getElementById("calendar-next");
  const todayBtn = document.getElementById("calendar-today");
  const selectedDayTitleEl = document.getElementById("selected-day-title");
  const selectedDayMetaEl = document.getElementById("selected-day-meta");
  const reminderForm = document.getElementById("reminder-form");
  const reminderInput = document.getElementById("reminder-input");
  const reminderStartInput = document.getElementById("reminder-start-time");
  const reminderEndInput = document.getElementById("reminder-end-time");
  const reminderPriorityInput = document.getElementById("reminder-priority");
  const reminderListEl = document.getElementById("reminder-list");
  const reminderEmptyEl = document.getElementById("reminder-empty");
  const taskListEl = document.getElementById("task-list");
  const taskEmptyEl = document.getElementById("task-empty");
  const unscheduledListEl = document.getElementById("unscheduled-list");
  const unscheduledEmptyEl = document.getElementById("unscheduled-empty");

  function id() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIsoYmd(y, mo, d) {
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  function dateToIso(date) {
    return toIsoYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function parseIso(iso) {
    const [y, mo, d] = iso.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }

  function todayIso() {
    return dateToIso(new Date());
  }

  function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function formatLongDate(iso) {
    return parseIso(iso).toLocaleDateString(uiLocale(), {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatMonthTitle(year, month) {
    return new Date(year, month - 1, 1).toLocaleDateString(uiLocale(), {
      month: "long",
      year: "numeric",
    });
  }

  function formatShortDate(iso) {
    return parseIso(iso).toLocaleDateString(uiLocale(), {
      month: "short",
      day: "numeric",
    });
  }

  function normalizeTime(value) {
    return typeof value === "string" && TIME_24H.test(value) ? value : null;
  }

  function formatTimeRange(startTime, endTime) {
    if (startTime && endTime) return `${startTime} - ${endTime}`;
    if (startTime) return `Starts ${startTime}`;
    if (endTime) return `Due ${endTime}`;
    return "";
  }

  function normalizePriority(value) {
    return value === "high" || value === "low" ? value : "medium";
  }

  function formatPriorityLabel(priority) {
    if (priority === "high") return "High priority";
    if (priority === "low") return "Low priority";
    return "Medium priority";
  }

  function reminderChipText(reminder) {
    const time = formatTimeRange(reminder.startTime, reminder.endTime);
    return time ? `${time} ${reminder.text}` : reminder.text;
  }

  /** @param {unknown} raw */
  function normalizeCategories(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => c && typeof c === "object" && typeof /** @type {any} */ (c).id === "string")
      .map((c) => {
        const x = /** @type {any} */ (c);
        return {
          id: x.id,
          name: typeof x.name === "string" ? x.name.trim().slice(0, 48) || "Untitled" : "Untitled",
        };
      });
  }

  /** @param {unknown} raw */
  function normalizeTodos(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (t) =>
          t &&
          typeof t === "object" &&
          typeof /** @type {any} */ (t).id === "string" &&
          typeof /** @type {any} */ (t).text === "string" &&
          typeof /** @type {any} */ (t).completed === "boolean"
      )
      .map((t) => {
        const x = /** @type {any} */ (t);
        return {
          id: x.id,
          text: x.text.slice(0, 500),
          completed: x.completed,
          dueDate: typeof x.dueDate === "string" && ISO_DATE.test(x.dueDate) ? x.dueDate : null,
          categoryId: typeof x.categoryId === "string" ? x.categoryId : null,
        };
      });
  }

  /** @param {unknown} raw */
  function normalizeReminders(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (r) =>
          r &&
          typeof r === "object" &&
          typeof /** @type {any} */ (r).id === "string" &&
          typeof /** @type {any} */ (r).date === "string" &&
          ISO_DATE.test(/** @type {any} */ (r).date) &&
          typeof /** @type {any} */ (r).text === "string"
      )
      .map((r) => {
        const x = /** @type {any} */ (r);
        return {
          id: x.id,
          date: x.date,
          text: x.text.trim().slice(0, 200),
          startTime: normalizeTime(x.startTime),
          endTime: normalizeTime(x.endTime),
          priority: normalizePriority(x.priority),
        };
      })
      .filter((r) => r.text);
  }

  function loadTodoState() {
    try {
      const raw = localStorage.getItem(STORAGE_TODO_APP);
      const parsed = raw ? JSON.parse(raw) : {};
      todoStore = parsed && typeof parsed === "object" ? parsed : {};
      todos = normalizeTodos(todoStore.todos);
      categories = normalizeCategories(todoStore.categories);
    } catch (_) {
      todoStore = {};
      todos = [];
      categories = [];
    }
  }

  function saveTodoState() {
    const payload = {
      ...todoStore,
      todos,
      categories,
      selectedCategoryKey:
        typeof todoStore.selectedCategoryKey === "string" ? todoStore.selectedCategoryKey : "__all__",
      illustrationsByCategory:
        todoStore.illustrationsByCategory && typeof todoStore.illustrationsByCategory === "object"
          ? todoStore.illustrationsByCategory
          : {},
    };
    todoStore = payload;
    localStorage.setItem(STORAGE_TODO_APP, JSON.stringify(payload));
  }

  function loadCalendarState() {
    try {
      const raw = localStorage.getItem(STORAGE_CALENDAR);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      reminders = normalizeReminders(/** @type {any} */ (parsed).reminders);
      if (typeof /** @type {any} */ (parsed).selectedDate === "string" && ISO_DATE.test(/** @type {any} */ (parsed).selectedDate)) {
        selectedDate = /** @type {any} */ (parsed).selectedDate;
      }
      const selected = parseIso(selectedDate);
      calYear = selected.getFullYear();
      calMonth = selected.getMonth() + 1;
    } catch (_) {
      reminders = [];
    }
  }

  function saveCalendarState() {
    localStorage.setItem(
      STORAGE_CALENDAR,
      JSON.stringify({
        version: 1,
        selectedDate,
        reminders,
      })
    );
  }

  function categoryName(categoryId) {
    const c = categories.find((cat) => cat.id === categoryId);
    return c ? c.name : "Uncategorized";
  }

  function activeTasks() {
    return todos.filter((todo) => !todo.completed);
  }

  function activeTasksForDate(iso) {
    return activeTasks().filter((todo) => todo.dueDate === iso);
  }

  function remindersForDate(iso) {
    return reminders
      .filter((reminder) => reminder.date === iso)
      .sort((a, b) => (a.startTime || a.endTime || "99:99").localeCompare(b.startTime || b.endTime || "99:99"));
  }

  function unscheduledActiveTasks() {
    return activeTasks().filter((todo) => !todo.dueDate);
  }

  function selectDate(iso) {
    selectedDate = iso;
    const dt = parseIso(iso);
    calYear = dt.getFullYear();
    calMonth = dt.getMonth() + 1;
    saveCalendarState();
    render();
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
    render();
  }

  function goToday() {
    selectDate(todayIso());
  }

  function addReminder(text, startTime, endTime, priority) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const start = normalizeTime(startTime);
    const end = normalizeTime(endTime);
    if (start && end && end < start) {
      window.alert("End time should be later than start time.");
      reminderEndInput.focus();
      return;
    }
    reminders.unshift({
      id: id(),
      date: selectedDate,
      text: trimmed.slice(0, 200),
      startTime: start,
      endTime: end,
      priority: normalizePriority(priority),
    });
    saveCalendarState();
    reminderInput.value = "";
    reminderStartInput.value = "";
    reminderEndInput.value = "";
    if (reminderPriorityInput instanceof HTMLSelectElement) reminderPriorityInput.value = "medium";
    render();
  }

  function removeReminder(reminderId) {
    reminders = reminders.filter((reminder) => reminder.id !== reminderId);
    saveCalendarState();
    render();
  }

  function completeTask(todoId) {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;
    todo.completed = true;
    saveTodoState();
    render();
  }

  function renderCalendarGrid() {
    calendarTitleEl.textContent = formatMonthTitle(calYear, calMonth);
    const totalActive = activeTasks().length;
    const scheduledActive = activeTasks().filter((todo) => todo.dueDate).length;
    calendarMetaEl.textContent = `${reminders.length} reminders · ${scheduledActive} scheduled active tasks · ${totalActive} active total`;

    const monthStart = new Date(calYear, calMonth - 1, 1);
    const gridStart = addDays(monthStart, -mondayIndex(monthStart));
    const today = todayIso();

    calendarGridEl.innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const dt = addDays(gridStart, i);
      const iso = dateToIso(dt);
      const dayReminders = remindersForDate(iso);
      const dayTasks = activeTasksForDate(iso);
      const itemCount = dayReminders.length + dayTasks.length;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-day-cell";
      cell.setAttribute(
        "aria-label",
        `${formatLongDate(iso)}. ${dayReminders.length} reminders, ${dayTasks.length} active tasks.`
      );
      if (iso === today) cell.classList.add("is-today");
      if (iso === selectedDate) cell.classList.add("is-selected");
      if (dt.getMonth() !== calMonth - 1) cell.classList.add("is-outside");
      cell.addEventListener("click", () => selectDate(iso));

      const number = document.createElement("span");
      number.className = "calendar-day-number";
      number.textContent = String(dt.getDate());

      const items = document.createElement("span");
      items.className = "calendar-day-items";

      const chips = [
        ...dayReminders.map((reminder) => ({
          type: "reminder",
          text: reminderChipText(reminder),
          priority: reminder.priority,
        })),
        ...dayTasks.map((todo) => ({ type: "task", text: todo.text })),
      ].slice(0, 4);

      chips.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = `calendar-chip is-${item.type}`;
        if (item.type === "reminder") chip.classList.add(`is-priority-${item.priority || "medium"}`);
        chip.textContent = item.text;
        items.appendChild(chip);
      });

      if (itemCount > chips.length) {
        const more = document.createElement("span");
        more.className = "calendar-chip is-more";
        more.textContent = `+${itemCount - chips.length} more`;
        items.appendChild(more);
      }

      cell.append(number, items);
      calendarGridEl.appendChild(cell);
    }
  }

  function renderSelectedDay() {
    const dayReminders = remindersForDate(selectedDate);
    const dayTasks = activeTasksForDate(selectedDate);
    selectedDayTitleEl.textContent = formatLongDate(selectedDate);
    selectedDayMetaEl.textContent = `${dayReminders.length} reminders · ${dayTasks.length} active tasks`;

    reminderListEl.innerHTML = "";
    dayReminders.forEach((reminder) => {
      reminderListEl.appendChild(buildReminderItem(reminder));
    });
    reminderListEl.hidden = dayReminders.length === 0;
    reminderEmptyEl.hidden = dayReminders.length !== 0;
    reminderEmptyEl.textContent = "No reminders on this day.";

    taskListEl.innerHTML = "";
    dayTasks.forEach((todo) => {
      taskListEl.appendChild(buildTaskItem(todo, true));
    });
    taskListEl.hidden = dayTasks.length === 0;
    taskEmptyEl.hidden = dayTasks.length !== 0;
    taskEmptyEl.textContent = "No active tasks due on this day.";

    const unscheduled = unscheduledActiveTasks();
    unscheduledListEl.innerHTML = "";
    unscheduled.forEach((todo) => {
      unscheduledListEl.appendChild(buildTaskItem(todo, false));
    });
    unscheduledListEl.hidden = unscheduled.length === 0;
    unscheduledEmptyEl.hidden = unscheduled.length !== 0;
    unscheduledEmptyEl.textContent = "Every active task has a due date.";
  }

  function buildReminderItem(reminder) {
    const li = document.createElement("li");
    li.className = "calendar-list-item";

    const main = document.createElement("div");
    main.className = "calendar-item-main";

    const text = document.createElement("div");
    text.className = "calendar-item-text";
    text.textContent = reminder.text;
    main.appendChild(text);

    const time = formatTimeRange(reminder.startTime, reminder.endTime);
    const parts = [];
    if (time) parts.push(time);
    parts.push(formatPriorityLabel(reminder.priority));
    if (parts.length) {
      const sub = document.createElement("div");
      sub.className = "calendar-item-sub";
      sub.textContent = parts.join(" · ");
      main.appendChild(sub);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "calendar-item-delete";
    del.textContent = "×";
    del.setAttribute("aria-label", "Delete reminder");
    del.addEventListener("click", () => removeReminder(reminder.id));

    li.append(main, del);
    return li;
  }

  function buildTaskItem(todo, showDateContext) {
    const li = document.createElement("li");
    li.className = "calendar-list-item";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "calendar-item-check";
    check.setAttribute("aria-label", "Mark task as done");
    check.addEventListener("change", () => completeTask(todo.id));

    const main = document.createElement("div");
    main.className = "calendar-item-main";

    const text = document.createElement("div");
    text.className = "calendar-item-text";
    text.textContent = todo.text;
    main.appendChild(text);

    const details = [];
    if (todo.categoryId) details.push(categoryName(todo.categoryId));
    if (showDateContext && todo.dueDate) details.push(`Due ${formatShortDate(todo.dueDate)}`);
    if (!showDateContext) details.push("No due date");

    if (details.length > 0) {
      const sub = document.createElement("div");
      sub.className = "calendar-item-sub";
      sub.textContent = details.join(" · ");
      main.appendChild(sub);
    }

    li.append(check, main);
    return li;
  }

  function render() {
    renderCalendarGrid();
    renderSelectedDay();
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
  prevBtn.addEventListener("click", () => shiftMonth(-1));
  nextBtn.addEventListener("click", () => shiftMonth(1));
  todayBtn.addEventListener("click", () => goToday());

  reminderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addReminder(
      reminderInput.value,
      reminderStartInput.value,
      reminderEndInput.value,
      reminderPriorityInput instanceof HTMLSelectElement ? reminderPriorityInput.value : "medium"
    );
  });

  window.addEventListener("resize", () => {
    if (!isMobileSidebar()) closeSidebar();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_TODO_APP) {
      loadTodoState();
      render();
    }
    if (e.key === STORAGE_CALENDAR) {
      loadCalendarState();
      render();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadTodoState();
    loadCalendarState();
    render();
  });

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("calendar") && !domains.includes("todo")) return;
    loadTodoState();
    loadCalendarState();
    render();
  });

  window.addEventListener("daily-space-locale-changed", () => render());

  loadTodoState();
  loadCalendarState();
  render();
})();
