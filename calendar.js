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
  /** @type {Date} Monday of the visible week (local noon). */
  let weekStart = new Date();

  const HOUR_START = 9;
  const HOUR_END = 18;

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
  const dayTaskForm = document.getElementById("day-task-form");
  const dayTaskInput = document.getElementById("day-task-input");
  const calendarOpenTodo = document.getElementById("calendar-open-todo");
  const calendarAlertsBtn = document.getElementById("calendar-alerts-btn");
  const weekHeadEl = document.getElementById("week-head");
  const weekHoursEl = document.getElementById("week-hours");
  const weekColsEl = document.getElementById("week-cols");
  const calUpcoming = document.getElementById("cal-upcoming");
  const calUpcomingText = document.getElementById("cal-upcoming-text");
  const calUpcomingTime = document.getElementById("cal-upcoming-time");

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

  function startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    d.setDate(d.getDate() - mondayIndex(d));
    return d;
  }

  function weekDays() {
    // Work week Mon–Fri to match the reference board.
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }

  function weekEndIso() {
    const end = new Date(weekStart);
    end.setDate(weekStart.getDate() + 4);
    return dateToIso(end);
  }

  function isoInRange(iso, startIso, endIso) {
    return iso >= startIso && iso <= endIso;
  }

  function minutesFromMidnight(time) {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  function eventTone(index) {
    const tones = ["a", "b", "c"];
    return tones[index % tones.length];
  }

  function formatWeekTitle() {
    const days = weekDays();
    const start = days[0];
    const end = days[days.length - 1];
    const sameMonth = start.getMonth() === end.getMonth();
    const monthYear = start.toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
    const weekNo = Math.ceil(
      ((start.getTime() - new Date(start.getFullYear(), 0, 1).getTime()) / 86400000 +
        mondayIndex(new Date(start.getFullYear(), 0, 1)) +
        1) /
        7
    );
    if (sameMonth) return `${monthYear} / W${weekNo}`;
    const startLabel = start.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" });
    const endLabel = end.toLocaleDateString(uiLocale(), {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }

  function formatDueDate(iso) {
    const [y, mo, da] = iso.split("-").map(Number);
    const dt = new Date(y, mo - 1, da);
    return dt.toLocaleDateString(uiLocale(), {
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

  function normalizeTime(value) {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw) return null;
    if (TIME_24H.test(raw)) return raw;
    const withSec = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if (withSec) {
      return `${String(Number(withSec[1])).padStart(2, "0")}:${withSec[2]}`;
    }
    const ampm = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/i);
    if (ampm) {
      let hour = Number(ampm[1]);
      const minute = ampm[2] || "00";
      const isPm = /^p/i.test(ampm[3]);
      if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null;
      if (hour === 12) hour = isPm ? 12 : 0;
      else if (isPm) hour += 12;
      return `${String(hour).padStart(2, "0")}:${minute}`;
    }
    return null;
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
    };
    delete payload.illustrationsByCategory;
    delete payload.illustrationData;
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
      // Keep month aligned to last selected day for navigation persistence,
      // Selected day may be overridden by URL hash in focusTodayOnOpen().
      if (
        typeof /** @type {any} */ (parsed).selectedDate === "string" &&
        ISO_DATE.test(/** @type {any} */ (parsed).selectedDate)
      ) {
        selectedDate = /** @type {any} */ (parsed).selectedDate;
      }
      const selected = parseIso(selectedDate);
      calYear = selected.getFullYear();
      calMonth = selected.getMonth() + 1;
    } catch (_) {
      reminders = [];
    }
  }

  function focusTodayOnOpen() {
    const raw = String(window.location.hash || "").replace(/^#/, "");
    let iso = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) iso = raw;
    else if (raw.startsWith("day=")) iso = raw.slice(4);
    if (iso && ISO_DATE.test(iso)) {
      selectedDate = iso;
    } else {
      selectedDate = todayIso();
    }
    const selected = parseIso(selectedDate);
    calYear = selected.getFullYear();
    calMonth = selected.getMonth() + 1;
    saveCalendarState();
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
    window.dispatchEvent(
      new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["calendar"] } })
    );
  }

  function categoryExists(categoryId) {
    return categories.some((cat) => cat.id === categoryId);
  }

  function categoryLabelById(categoryId) {
    const c = categories.find((cat) => cat.id === categoryId);
    return c ? c.name : "Uncategorized";
  }

  function todosDueOn(iso) {
    return todos.filter((todo) => todo.dueDate === iso);
  }

  function remindersForDate(iso) {
    return reminders
      .filter((reminder) => reminder.date === iso)
      .sort((a, b) =>
        (a.startTime || a.endTime || "99:99").localeCompare(b.startTime || b.endTime || "99:99")
      );
  }

  function selectDate(iso) {
    selectedDate = iso;
    const dt = parseIso(iso);
    calYear = dt.getFullYear();
    calMonth = dt.getMonth() + 1;
    weekStart = startOfWeek(dt);
    saveCalendarState();
    render();
  }

  function shiftWeek(delta) {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + delta * 7);
    weekStart = startOfWeek(next);
    const days = weekDays();
    const selected = parseIso(selectedDate);
    const inWeek = days.some((d) => dateToIso(d) === selectedDate);
    if (!inWeek) {
      selectedDate = dateToIso(days[0]);
      calYear = days[0].getFullYear();
      calMonth = days[0].getMonth() + 1;
      saveCalendarState();
    }
    render();
  }

  function shiftMonth(delta) {
    shiftWeek(delta * 4);
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

  function toggleTask(todoId) {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;
    todo.completed = !todo.completed;
    saveTodoState();
    render();
  }

  function removeTask(todoId) {
    todos = todos.filter((t) => t.id !== todoId);
    saveTodoState();
    render();
  }

  function renderCalendarGrid() {
    // Month grid kept hidden; week workspace is primary.
    if (!calendarGridEl || calendarGridEl.hidden) return;
    calendarGridEl.innerHTML = "";
  }

  function renderWeekGrid() {
    if (!weekHeadEl || !weekHoursEl || !weekColsEl) return;

    const days = weekDays();
    const today = todayIso();
    const startIso = dateToIso(days[0]);
    const endIso = weekEndIso();

    if (calendarTitleEl) calendarTitleEl.textContent = formatWeekTitle();
    const dueThisWeek = todos.filter(
      (todo) => todo.dueDate && isoInRange(todo.dueDate, startIso, endIso)
    ).length;
    const remindersThisWeek = reminders.filter((reminder) =>
      isoInRange(reminder.date, startIso, endIso)
    ).length;
    if (calendarMetaEl) {
      calendarMetaEl.textContent = `${dueThisWeek} ${dueThisWeek === 1 ? "task" : "tasks"} · ${remindersThisWeek} ${remindersThisWeek === 1 ? "reminder" : "reminders"} this week`;
    }

    weekHeadEl.innerHTML = `<div class="cal-week-corner" aria-hidden="true"></div>`;
    days.forEach((day) => {
      const iso = dateToIso(day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-week-day";
      if (iso === today) btn.classList.add("is-today");
      if (iso === selectedDate) btn.classList.add("is-selected");
      const wd = day.toLocaleDateString(uiLocale(), { weekday: "short" });
      btn.innerHTML =
        `<span class="cal-week-day-wd">${wd}</span>` +
        `<span class="cal-week-day-num">${day.getDate()}</span>`;
      btn.addEventListener("click", () => selectDate(iso));
      weekHeadEl.appendChild(btn);
    });

    const hourCount = HOUR_END - HOUR_START;
    weekHoursEl.style.setProperty("--cal-hour-count", String(hourCount));
    weekHoursEl.innerHTML = "";
    for (let h = HOUR_START; h < HOUR_END; h += 1) {
      const label = document.createElement("div");
      label.className = "cal-hour-label";
      const ampm = h >= 12 ? "pm" : "am";
      const hour12 = ((h + 11) % 12) + 1;
      label.textContent = `${hour12} ${ampm}`;
      weekHoursEl.appendChild(label);
    }

    weekColsEl.style.setProperty("--cal-hour-count", String(hourCount));
    weekColsEl.innerHTML = "";
    const rangeStart = HOUR_START * 60;
    const rangeEnd = HOUR_END * 60;
    const rangeSpan = rangeEnd - rangeStart;

    days.forEach((day, dayIndex) => {
      const iso = dateToIso(day);
      const col = document.createElement("div");
      col.className = "cal-col" + (iso === selectedDate ? " is-selected" : "");
      col.addEventListener("click", (event) => {
        if (event.target !== col) return;
        selectDate(iso);
        if (reminderStartInput instanceof HTMLInputElement && !reminderStartInput.value) {
          reminderStartInput.value = "09:00";
        }
        if (reminderInput) reminderInput.focus();
      });

      const dayTasks = todosDueOn(iso).filter((t) => !t.completed);
      if (dayTasks.length) {
        const chip = document.createElement("div");
        chip.className = "cal-allday";
        chip.textContent =
          dayTasks.length === 1 ? dayTasks[0].text : `${dayTasks.length} tasks due`;
        chip.title = dayTasks.map((t) => t.text).join(", ");
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          selectDate(iso);
        });
        col.appendChild(chip);
      }

      const dayReminders = remindersForDate(iso).filter((r) => r.startTime);
      dayReminders.forEach((reminder, index) => {
        const startMin = minutesFromMidnight(reminder.startTime);
        let endMin = reminder.endTime
          ? minutesFromMidnight(reminder.endTime)
          : startMin + 60;
        if (endMin <= startMin) endMin = startMin + 30;
        const clampedStart = Math.max(startMin, rangeStart);
        const clampedEnd = Math.min(endMin, rangeEnd);
        if (clampedEnd <= rangeStart || clampedStart >= rangeEnd) return;

        const top = ((clampedStart - rangeStart) / rangeSpan) * 100;
        const height = Math.max(((clampedEnd - clampedStart) / rangeSpan) * 100, 4.5);
        const block = document.createElement("button");
        block.type = "button";
        block.className = "cal-event";
        block.dataset.tone = eventTone(index + dayIndex);
        block.style.top = `${top}%`;
        block.style.height = `${height}%`;
        block.innerHTML =
          `<span class="cal-event-title"></span>` +
          `<span class="cal-event-time"></span>`;
        block.querySelector(".cal-event-title").textContent = reminder.text;
        block.querySelector(".cal-event-time").textContent =
          formatTimeRange(reminder.startTime, reminder.endTime) || reminder.startTime;
        block.title = "Click to delete reminder";
        block.addEventListener("click", (e) => {
          e.stopPropagation();
          if (window.confirm(`Delete reminder “${reminder.text}”?`)) {
            removeReminder(reminder.id);
          }
        });
        col.appendChild(block);
      });

      weekColsEl.appendChild(col);
    });
  }

  function fillTodoList(listEl, items) {
    if (!listEl) return;
    listEl.innerHTML = "";
    items.forEach((todo) => listEl.appendChild(buildTodoItem(todo)));
  }

  function renderTodosPanel() {
    // Side Todos rail removed — selected-day tasks render in the composer.
  }

  function renderUpcoming() {
    if (!calUpcoming || !calUpcomingText || !calUpcomingTime) return;
    const startIso = dateToIso(weekStart);
    const endIso = weekEndIso();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = todayIso();
    const upcoming = reminders
      .filter((r) => isoInRange(r.date, startIso, endIso) && r.startTime)
      .filter((r) => {
        if (r.date > today) return true;
        if (r.date < today) return false;
        return minutesFromMidnight(r.startTime) >= nowMin;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0];

    if (!upcoming) {
      calUpcoming.hidden = true;
      return;
    }
    calUpcoming.hidden = false;
    calUpcomingText.textContent = upcoming.text;
    calUpcomingTime.textContent =
      (upcoming.date === today ? "Today" : formatDueDate(upcoming.date)) +
      " · " +
      (formatTimeRange(upcoming.startTime, upcoming.endTime) || upcoming.startTime);
  }

  function addTaskForSelectedDay(text) {
    const trimmed = String(text || "").trim().slice(0, 500);
    if (!trimmed) return;
    todos.unshift({
      id: id(),
      text: trimmed,
      completed: false,
      dueDate: selectedDate,
      categoryId: null,
    });
    saveTodoState();
    render();
  }

  function renderSelectedDay() {
    const dayReminders = remindersForDate(selectedDate);
    const dayTasks = todosDueOn(selectedDate);
    const isToday = selectedDate === todayIso();

    if (selectedDayTitleEl) {
      selectedDayTitleEl.textContent = isToday
        ? `Today · ${formatDueDate(selectedDate)}`
        : formatDueDate(selectedDate);
    }
    if (selectedDayMetaEl) {
      selectedDayMetaEl.textContent = `${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"} · ${dayReminders.length} ${dayReminders.length === 1 ? "reminder" : "reminders"}`;
    }
    if (calendarOpenTodo) calendarOpenTodo.hidden = !isToday;

    if (taskListEl) {
      fillTodoList(taskListEl, dayTasks);
      taskListEl.hidden = dayTasks.length === 0;
    }
    if (taskEmptyEl) {
      taskEmptyEl.hidden = dayTasks.length !== 0;
      taskEmptyEl.textContent = `No tasks due on ${formatDueDate(selectedDate)}.`;
    }

    if (reminderListEl) {
      reminderListEl.innerHTML = "";
      dayReminders.forEach((reminder) => {
        reminderListEl.appendChild(buildReminderItem(reminder));
      });
      reminderListEl.hidden = dayReminders.length === 0;
    }
    if (reminderEmptyEl) {
      reminderEmptyEl.hidden = dayReminders.length !== 0;
      reminderEmptyEl.textContent = "No reminders on this day.";
    }
  }

  function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item" + (todo.completed ? " completed" : "");
    li.dataset.id = todo.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "todo-check";
    check.checked = todo.completed;
    check.setAttribute("aria-label", todo.completed ? "Mark as active" : "Mark as done");
    check.addEventListener("change", () => toggleTask(todo.id));

    const main = document.createElement("div");
    main.className = "todo-main";

    const label = document.createElement("span");
    label.className = "todo-label";
    label.textContent = todo.text;
    label.addEventListener("click", () => toggleTask(todo.id));
    main.appendChild(label);

    if (todo.categoryId && categoryExists(todo.categoryId)) {
      const pill = document.createElement("span");
      pill.className = "todo-category-pill";
      pill.textContent = categoryLabelById(todo.categoryId);
      main.appendChild(pill);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "todo-delete";
    del.setAttribute("aria-label", "Delete task");
    del.textContent = "×";
    del.addEventListener("click", () => removeTask(todo.id));

    li.append(check, main, del);
    return li;
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

  function syncCalendarAlertsButton() {
    if (!calendarAlertsBtn || !window.DailySpaceLoop) {
      if (calendarAlertsBtn) calendarAlertsBtn.hidden = true;
      return;
    }
    const perm = window.DailySpaceLoop.notificationPermission();
    if (perm === "unsupported") {
      calendarAlertsBtn.hidden = true;
      return;
    }
    calendarAlertsBtn.hidden = false;
    if (perm === "granted") {
      calendarAlertsBtn.textContent = "Reminder alerts on";
      calendarAlertsBtn.disabled = true;
      calendarAlertsBtn.title = "Browser will notify you for today’s timed reminders while Daily Space is open.";
    } else if (perm === "denied") {
      calendarAlertsBtn.textContent = "Alerts blocked in browser";
      calendarAlertsBtn.disabled = true;
      calendarAlertsBtn.title = "Enable notifications for this site in browser settings, then reload.";
    } else {
      calendarAlertsBtn.textContent = "Enable reminder alerts";
      calendarAlertsBtn.disabled = false;
      calendarAlertsBtn.title = "Allow notifications so timed reminders can appear.";
    }
  }

  function render() {
    renderCalendarGrid();
    renderWeekGrid();
    renderSelectedDay();
    renderUpcoming();
    syncCalendarAlertsButton();
  }

  function isMobileSidebar() {
    return window.matchMedia("(max-width: 819px)").matches;
  }

  function openSidebar() {
    if (!isMobileSidebar() || !sidebarEl) return;
    sidebarEl.classList.add("is-open");
    if (sidebarBackdrop) {
      sidebarBackdrop.hidden = false;
      sidebarBackdrop.classList.add("is-visible");
    }
    document.body.classList.add("sidebar-drawer-open");
    if (sidebarTrigger) sidebarTrigger.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    if (!sidebarEl) return;
    sidebarEl.classList.remove("is-open");
    if (sidebarBackdrop) {
      sidebarBackdrop.hidden = true;
      sidebarBackdrop.classList.remove("is-visible");
    }
    document.body.classList.remove("sidebar-drawer-open");
    if (sidebarTrigger) sidebarTrigger.setAttribute("aria-expanded", "false");
  }

  function toggleSidebar() {
    if (!isMobileSidebar() || !sidebarEl) return;
    if (sidebarEl.classList.contains("is-open")) closeSidebar();
    else openSidebar();
  }

  if (sidebarTrigger) sidebarTrigger.addEventListener("click", () => toggleSidebar());
  if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => closeSidebar());
  if (prevBtn) prevBtn.addEventListener("click", () => shiftWeek(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => shiftWeek(1));
  if (todayBtn) todayBtn.addEventListener("click", () => goToday());

  if (reminderForm) {
    reminderForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addReminder(
        reminderInput.value,
        reminderStartInput.value,
        reminderEndInput.value,
        reminderPriorityInput instanceof HTMLSelectElement ? reminderPriorityInput.value : "medium"
      );
    });
  }

  if (dayTaskForm && dayTaskInput) {
    dayTaskForm.addEventListener("submit", (e) => {
      e.preventDefault();
      addTaskForSelectedDay(dayTaskInput.value);
      dayTaskInput.value = "";
      dayTaskInput.focus();
    });
  }

  if (calendarAlertsBtn) {
    calendarAlertsBtn.addEventListener("click", async () => {
      if (!window.DailySpaceLoop) return;
      const perm = await window.DailySpaceLoop.requestNotificationPermission();
      if (perm === "granted") window.DailySpaceLoop.tickReminderNotifications();
      syncCalendarAlertsButton();
    });
  }

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
      weekStart = startOfWeek(parseIso(selectedDate));
      render();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadTodoState();
    loadCalendarState();
    weekStart = startOfWeek(parseIso(selectedDate));
    render();
  });

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("calendar") && !domains.includes("todo")) return;
    loadTodoState();
    loadCalendarState();
    weekStart = startOfWeek(parseIso(selectedDate));
    render();
  });

  window.addEventListener("daily-space-locale-changed", () => render());

  loadTodoState();
  loadCalendarState();
  focusTodayOnOpen();
  weekStart = startOfWeek(parseIso(selectedDate));
  render();
})();
