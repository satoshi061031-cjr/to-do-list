(function () {
  const STORAGE_TODO = "todo-app-v2";
  const STORAGE_CALENDAR = "calendar-app-v1";
  const STORAGE_PLANNER = "planner-app-v1";
  const STORAGE_TALLY = "tally-book-v1";
  const STORAGE_TRAVEL = "travel-book-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

  let syncing = false;

  function uid() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function validDate(value) {
    return typeof value === "string" && ISO_DATE.test(value) ? value : null;
  }

  function validTime(value) {
    return typeof value === "string" && TIME_24H.test(value) ? value : null;
  }

  function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function guestHasWorkspaceData() {
    const todos = readJson(STORAGE_TODO, {}).todos;
    if (Array.isArray(todos) && todos.some((item) => item && hasText(item.text))) return true;
    const reminders = readJson(STORAGE_CALENDAR, {}).reminders;
    if (Array.isArray(reminders) && reminders.some((item) => item && hasText(item.text))) return true;
    const planner = readJson(STORAGE_PLANNER, {});
    const boards = planner && planner.boards && typeof planner.boards === "object" ? planner.boards : {};
    for (const board of Object.values(boards)) {
      const entries = board && Array.isArray(board.entries) ? board.entries : [];
      if (entries.some((item) => item && hasText(item.title))) return true;
    }
    const tally = readJson(STORAGE_TALLY, {});
    if (Array.isArray(tally.records) && tally.records.length) return true;
    const travel = readJson(STORAGE_TRAVEL, {});
    if (Array.isArray(travel.trips) && travel.trips.some((item) => item && hasText(item.name))) return true;
    return false;
  }

  function doneColumnId(board) {
    const columns = board && Array.isArray(board.columns) ? board.columns : [];
    const done = columns.find((column) => /done/i.test(String(column && column.title || "")));
    return done && typeof done.id === "string" ? done.id : null;
  }

  function plannedColumnId(board) {
    const columns = board && Array.isArray(board.columns) ? board.columns : [];
    const planned = columns.find((column) => /planned|to.?do|ready/i.test(String(column && column.title || "")));
    return planned && typeof planned.id === "string" ? planned.id : columns[0] && columns[0].id;
  }

  function syncCompletion(from, todo, entry, board) {
    if (from === "todo") entry.completed = Boolean(todo.completed);
    else if (from === "planner") todo.completed = Boolean(entry.completed);
    else if (todo.completed || entry.completed) {
      todo.completed = true;
      entry.completed = true;
    }
    const doneId = doneColumnId(board);
    const plannedId = plannedColumnId(board);
    if (entry.completed && doneId) entry.columnId = doneId;
    if (!entry.completed && doneId && entry.columnId === doneId && plannedId) entry.columnId = plannedId;
  }

  function syncLinkedWork(options) {
    const settings = options || {};
    const from = settings.from || "all";
    if (syncing) return { changed: false };
    syncing = true;
    try {
      const todoState = readJson(STORAGE_TODO, { todos: [], categories: [], selectedCategoryKey: "__all__" });
      const calendarState = readJson(STORAGE_CALENDAR, { version: 1, reminders: [] });
      const plannerState = readJson(STORAGE_PLANNER, { version: 2, planners: [], boards: {} });
      if (!Array.isArray(todoState.todos)) todoState.todos = [];
      if (!Array.isArray(calendarState.reminders)) calendarState.reminders = [];
      if (!plannerState.boards || typeof plannerState.boards !== "object") plannerState.boards = {};

      let changed = false;
      const todos = todoState.todos;

      calendarState.reminders.forEach((reminder) => {
        if (!reminder || typeof reminder !== "object" || !hasText(reminder.text)) return;
        const date = validDate(reminder.date);
        if (!date) return;
        let todo = todos.find(
          (item) =>
            item &&
            (item.sourceReminderId === reminder.id ||
              (reminder.linkedTodoId && item.id === reminder.linkedTodoId))
        );
        if (!todo) {
          todo = {
            id: uid(),
            text: String(reminder.text).trim().slice(0, 500),
            completed: false,
            dueDate: date,
            dueTime: validTime(reminder.startTime),
            categoryId: null,
            sourceMailId: null,
            sourceReminderId: reminder.id,
            repeat: null,
          };
          todos.unshift(todo);
          changed = true;
        }
        if (reminder.linkedTodoId !== todo.id) {
          reminder.linkedTodoId = todo.id;
          changed = true;
        }
        if (todo.sourceReminderId !== reminder.id) {
          todo.sourceReminderId = reminder.id;
          changed = true;
        }
        if (!todo.completed && from !== "todo") {
          if (todo.dueDate !== date) {
            todo.dueDate = date;
            changed = true;
          }
          const nextTime = validTime(reminder.startTime);
          if (todo.dueTime !== nextTime) {
            todo.dueTime = nextTime;
            changed = true;
          }
        }
      });

      Object.values(plannerState.boards).forEach((board) => {
        if (!board || !Array.isArray(board.entries)) return;
        board.entries.forEach((entry) => {
          if (!entry || typeof entry !== "object" || !hasText(entry.title)) return;
          const date = validDate(entry.dueDate);
          if (!date) return;
          let todo = todos.find(
            (item) =>
              item &&
              (item.sourcePlannerId === entry.id || (entry.linkedTodoId && item.id === entry.linkedTodoId))
          );
          if (!todo) {
            todo = {
              id: uid(),
              text: String(entry.title).trim().slice(0, 500),
              completed: Boolean(entry.completed),
              dueDate: date,
              dueTime: null,
              categoryId: null,
              sourceMailId: null,
              sourcePlannerId: entry.id,
              repeat: null,
            };
            todos.unshift(todo);
            changed = true;
          }
          if (entry.linkedTodoId !== todo.id) {
            entry.linkedTodoId = todo.id;
            changed = true;
          }
          if (todo.sourcePlannerId !== entry.id) {
            todo.sourcePlannerId = entry.id;
            changed = true;
          }
          const wasDone = Boolean(todo.completed);
          const cardDone = Boolean(entry.completed);
          syncCompletion(from, todo, entry, board);
          if (Boolean(todo.completed) !== wasDone || Boolean(entry.completed) !== cardDone) changed = true;
          if (!todo.completed && todo.dueDate !== date && from !== "todo") {
            todo.dueDate = date;
            changed = true;
          }
        });
      });

      if (changed) {
        writeJson(STORAGE_TODO, todoState);
        writeJson(STORAGE_CALENDAR, calendarState);
        writeJson(STORAGE_PLANNER, plannerState);
        if (!settings.silent) {
          window.dispatchEvent(
            new CustomEvent("daily-space-agent-data-updated", {
              detail: { domains: ["todo", "calendar", "planner"] },
            })
          );
        }
      }
      return { changed };
    } finally {
      syncing = false;
    }
  }

  async function pushExternalEvent(item) {
    const title = String(item && (item.text || item.title) || "").trim();
    const date = validDate(item && (item.date || item.dueDate));
    if (!title || !date) return null;
    try {
      const response = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          date,
          startTime: validTime(item.startTime || item.dueTime),
          endTime: validTime(item.endTime),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => ({}));
      return payload && payload.event ? payload.event : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchExternalEvents(from, to) {
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/calendar/events?${params.toString()}`);
      if (!response.ok) return { connected: false, events: [] };
      const payload = await response.json().catch(() => ({}));
      return {
        connected: Boolean(payload.connected),
        provider: payload.provider || "",
        events: Array.isArray(payload.events) ? payload.events : [],
      };
    } catch (_) {
      return { connected: false, events: [] };
    }
  }

  window.DailySpaceTasks = {
    guestHasWorkspaceData,
    syncLinkedWork,
    pushExternalEvent,
    fetchExternalEvents,
  };
})();
