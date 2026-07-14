(function () {
  const KEYS = {
    todo: "todo-app-v2",
    planner: "planner-app-v1",
    calendar: "calendar-app-v1",
    tally: "tally-book-v1",
    teamwork: "teamwork-page-v1",
  };
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DESTRUCTIVE = new Set([
    "todo_delete",
    "planner_delete_column",
    "planner_delete_card",
    "calendar_delete_reminder",
    "tally_delete_expense",
    "tally_set_budget",
    "teamwork_delete_member",
    "teamwork_delete_task",
  ]);
  const TEAMWORK_FIELDS = new Set([
    "kicker",
    "title",
    "copy",
    "statusLabel",
    "statusMain",
    "statusSub",
    "focusKicker",
    "focusTitle",
    "focusCopy",
    "notesKicker",
    "notesTitle",
    "notes",
    "membersKicker",
    "membersTitle",
    "tasksKicker",
    "tasksTitle",
  ]);
  const TEAMWORK_DEFAULTS = {
    kicker: "Teamwork",
    title: "Shared rhythm for every project",
    copy: "Keep teammates, priorities, and active collaboration notes in one quiet workspace.",
    statusLabel: "Today",
    statusMain: "4 aligned",
    statusSub: "2 blockers to review",
    focusKicker: "Focus",
    focusTitle: "Launch checklist",
    focusCopy: "Finalize visual QA, publish the newest build, and confirm the Pages cache has refreshed.",
    notesKicker: "Sync",
    notesTitle: "Team notes",
    notes: "Design review at 4:30 PM\nConfirm mobile welcome animation\nPush final polish after preview",
    membersKicker: "Members",
    membersTitle: "Availability",
    tasksKicker: "Tasks",
    tasksTitle: "Member task breakdown",
    members: [
      { id: "member-1", name: "Junrong", role: "Design", tasks: ["Review Teamwork layout"] },
      { id: "member-2", name: "LingLong", role: "Build", tasks: ["Prepare preview update"] },
      { id: "member-3", name: "Guest", role: "Review", tasks: ["Check mobile page"] },
    ],
  };

  function uid() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function validDate(value) {
    if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function todayIso() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function clean(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  function tallyAmount(state, amount) {
    const symbol = clean(state.currency, 8) || "¥";
    const separator = /[a-z0-9]$/i.test(symbol) ? " " : "";
    return `${symbol}${separator}${Number(amount || 0).toFixed(2)}`;
  }

  function matchText(items, id, query, getText) {
    if (id) {
      const exactId = items.find((item) => item && item.id === id);
      if (exactId) return exactId;
    }
    const needle = clean(query, 300).toLowerCase();
    if (!needle) return null;
    return (
      items.find((item) => getText(item).trim().toLowerCase() === needle) ||
      items.find((item) => getText(item).toLowerCase().includes(needle)) ||
      null
    );
  }

  function ensureTodoState() {
    const state = read(KEYS.todo, {});
    if (!Array.isArray(state.todos)) state.todos = [];
    if (!Array.isArray(state.categories)) state.categories = [];
    if (typeof state.selectedCategoryKey !== "string") state.selectedCategoryKey = "__all__";
    if (!state.illustrationsByCategory || typeof state.illustrationsByCategory !== "object") {
      state.illustrationsByCategory = {};
    }
    return state;
  }

  function ensurePlannerState() {
    const state = read(KEYS.planner, {});
    if (!Array.isArray(state.planners)) state.planners = [];
    if (!state.boards || typeof state.boards !== "object") state.boards = {};
    if (!state.planners.length) {
      const plannerId = uid();
      state.planners.push({ id: plannerId, name: "My planner" });
      state.selectedPlannerId = plannerId;
      state.boards[plannerId] = { columns: [], entries: [] };
    }
    if (!state.planners.some((planner) => planner.id === state.selectedPlannerId)) {
      state.selectedPlannerId = state.planners[0].id;
    }
    state.planners.forEach((planner) => {
      const board = state.boards[planner.id];
      if (!board || typeof board !== "object") state.boards[planner.id] = { columns: [], entries: [] };
      if (!Array.isArray(state.boards[planner.id].columns)) state.boards[planner.id].columns = [];
      if (!Array.isArray(state.boards[planner.id].entries)) state.boards[planner.id].entries = [];
    });
    state.version = 2;
    return state;
  }

  function ensureCalendarState() {
    const state = read(KEYS.calendar, {});
    if (!Array.isArray(state.reminders)) state.reminders = [];
    if (!validDate(state.selectedDate)) state.selectedDate = todayIso();
    state.version = 1;
    return state;
  }

  function ensureTallyState() {
    const state = read(KEYS.tally, {});
    if (!Array.isArray(state.records)) state.records = [];
    if (!(Number(state.budget) > 0)) state.budget = 1000;
    state.currency = clean(state.currency, 8) || "¥";
    state.version = 1;
    return state;
  }

  function ensureTeamworkState() {
    const state = read(KEYS.teamwork, JSON.parse(JSON.stringify(TEAMWORK_DEFAULTS)));
    if (!Array.isArray(state.members)) state.members = [];
    state.members.forEach((member) => {
      if (!Array.isArray(member.tasks)) member.tasks = [];
    });
    return state;
  }

  function getSnapshot() {
    const todo = ensureTodoState();
    const planner = ensurePlannerState();
    const calendar = ensureCalendarState();
    const tally = ensureTallyState();
    const teamwork = ensureTeamworkState();
    const plannerBoards = {};
    planner.planners.slice(0, 12).forEach((workspace) => {
      const board = planner.boards[workspace.id] || { columns: [], entries: [] };
      plannerBoards[workspace.id] = {
        columns: board.columns.slice(0, 30).map((column) => ({
          id: column.id,
          title: clean(column.title, 80),
          emoji: clean(column.emoji, 8),
        })),
        entries: board.entries.slice(0, 100).map((entry) => ({
          id: entry.id,
          columnId: entry.columnId,
          title: clean(entry.title, 200),
          note: clean(entry.note, 500),
          completed: Boolean(entry.completed),
          tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 12) : [],
        })),
      };
    });
    return {
      todo: {
        categories: todo.categories.slice(0, 40).map((category) => ({
          id: category.id,
          name: clean(category.name, 48),
        })),
        todos: todo.todos.slice(0, 120).map((item) => ({
          id: item.id,
          text: clean(item.text, 300),
          completed: Boolean(item.completed),
          dueDate: validDate(item.dueDate) ? item.dueDate : null,
          categoryId: typeof item.categoryId === "string" ? item.categoryId : null,
        })),
      },
      planner: {
        selectedPlannerId: planner.selectedPlannerId,
        planners: planner.planners.slice(0, 12).map((workspace) => ({
          id: workspace.id,
          name: clean(workspace.name, 48),
        })),
        boards: plannerBoards,
      },
      calendar: {
        selectedDate: calendar.selectedDate,
        reminders: calendar.reminders.slice(0, 120).map((reminder) => ({
          id: reminder.id,
          date: reminder.date,
          text: clean(reminder.text, 200),
          startTime: reminder.startTime || null,
          endTime: reminder.endTime || null,
          priority: reminder.priority || "medium",
        })),
      },
      tally: {
        budget: Number(tally.budget),
        currency: tally.currency,
        records: tally.records.slice(0, 160).map((record) => ({
          id: record.id,
          date: record.date,
          amount: Number(record.amount),
          category: clean(record.category, 40),
          note: clean(record.note, 120),
        })),
      },
      teamwork: {
        members: teamwork.members.slice(0, 40).map((member) => ({
          id: member.id,
          name: clean(member.name, 80),
          role: clean(member.role, 80),
          tasks: Array.isArray(member.tasks) ? member.tasks.slice(0, 80).map((task) => clean(task, 300)) : [],
        })),
      },
    };
  }

  function todoCategory(state, name) {
    const categoryName = clean(name, 48);
    if (!categoryName) return null;
    let category = state.categories.find(
      (item) => clean(item.name, 48).toLowerCase() === categoryName.toLowerCase()
    );
    if (!category) {
      category = { id: uid(), name: categoryName };
      state.categories.push(category);
    }
    return category;
  }

  function plannerWorkspace(state, action) {
    const workspaceName = clean(action.workspaceName, 48).toLowerCase();
    return (
      state.planners.find((item) => action.workspaceId && item.id === action.workspaceId) ||
      state.planners.find((item) => workspaceName && clean(item.name, 48).toLowerCase() === workspaceName) ||
      state.planners.find((item) => item.id === state.selectedPlannerId) ||
      state.planners[0]
    );
  }

  function plannerColumn(board, action) {
    const title = clean(action.columnTitle, 80).toLowerCase();
    return (
      board.columns.find((item) => action.columnId && item.id === action.columnId) ||
      board.columns.find((item) => title && clean(item.title, 80).toLowerCase() === title) ||
      null
    );
  }

  function teamworkMember(state, action) {
    const name = clean(action.memberName, 80).toLowerCase();
    return (
      state.members.find((item) => action.memberId && item.id === action.memberId) ||
      state.members.find((item) => name && clean(item.name, 80).toLowerCase() === name) ||
      null
    );
  }

  function applyActions(actions) {
    const todo = ensureTodoState();
    const planner = ensurePlannerState();
    const calendar = ensureCalendarState();
    const tally = ensureTallyState();
    const teamwork = ensureTeamworkState();
    const changed = new Set();
    const applied = [];

    function success(action, label) {
      applied.push({ type: action.type, ok: true, label });
      changed.add(action.type.split("_")[0]);
    }

    function failure(action, error) {
      applied.push({ type: action.type, ok: false, error });
    }

    (Array.isArray(actions) ? actions : []).forEach((action) => {
      if (!action || typeof action.type !== "string") return;
      try {
        if (action.type === "todo_add") {
          const taskText = clean(action.text, 500);
          if (!taskText) return failure(action, "Task text is required.");
          const category = todoCategory(todo, action.categoryName);
          todo.todos.unshift({
            id: uid(),
            text: taskText,
            completed: false,
            dueDate: validDate(action.dueDate) ? action.dueDate : null,
            categoryId: category ? category.id : null,
          });
          success(action, taskText);
        } else if (action.type === "todo_add_category") {
          const category = todoCategory(todo, action.name);
          if (!category) return failure(action, "Category name is required.");
          success(action, category.name);
        } else if (action.type.startsWith("todo_")) {
          const item = matchText(todo.todos, action.todoId, action.matchText, (value) => value.text || "");
          if (!item) return failure(action, "Todo not found.");
          if (action.type === "todo_complete") item.completed = true;
          if (action.type === "todo_uncomplete") item.completed = false;
          if (action.type === "todo_delete") todo.todos = todo.todos.filter((value) => value.id !== item.id);
          if (action.type === "todo_update") {
            if (clean(action.text, 500)) item.text = clean(action.text, 500);
            if (has(action, "dueDate")) item.dueDate = validDate(action.dueDate) ? action.dueDate : null;
            if (has(action, "categoryName")) {
              const category = todoCategory(todo, action.categoryName);
              item.categoryId = category ? category.id : null;
            }
          }
          success(action, item.text);
        } else if (action.type === "planner_add_workspace") {
          const name = clean(action.name, 48);
          if (!name) return failure(action, "Planner name is required.");
          const workspace = { id: uid(), name };
          planner.planners.push(workspace);
          planner.boards[workspace.id] = { columns: [], entries: [] };
          planner.selectedPlannerId = workspace.id;
          success(action, name);
        } else if (action.type.startsWith("planner_")) {
          const workspace = plannerWorkspace(planner, action);
          if (!workspace) return failure(action, "Planner not found.");
          const board = planner.boards[workspace.id];
          if (action.type === "planner_add_column") {
            const column = {
              id: uid(),
              title: clean(action.title, 80) || "New column",
              emoji: clean(action.emoji, 8) || "📌",
            };
            board.columns.push(column);
            success(action, column.title);
            return;
          }
          let column = plannerColumn(board, action);
          if (action.type === "planner_update_column" || action.type === "planner_delete_column") {
            if (!column) return failure(action, "Planner column not found.");
            if (action.type === "planner_update_column") {
              if (clean(action.title, 80)) column.title = clean(action.title, 80);
              if (clean(action.emoji, 8)) column.emoji = clean(action.emoji, 8);
            } else {
              board.columns = board.columns.filter((item) => item.id !== column.id);
              board.entries = board.entries.filter((item) => item.columnId !== column.id);
            }
            success(action, column.title);
            return;
          }
          if (action.type === "planner_add_card") {
            if (!column) column = board.columns[0];
            if (!column) {
              column = { id: uid(), title: clean(action.columnTitle, 80) || "Tasks", emoji: "📌" };
              board.columns.push(column);
            }
            const card = {
              id: uid(),
              columnId: column.id,
              title: clean(action.title, 200),
              note: clean(action.note, 4000),
              completed: false,
              tags: Array.isArray(action.tags)
                ? action.tags.map((tag) => clean(tag, 32)).filter(Boolean).slice(0, 16)
                : [],
              expanded: true,
            };
            if (!card.title) return failure(action, "Card title is required.");
            board.entries.unshift(card);
            success(action, card.title);
            return;
          }
          const card = matchText(board.entries, action.cardId, action.matchText, (value) => value.title || "");
          if (!card) return failure(action, "Planner card not found.");
          if (action.type === "planner_complete_card") card.completed = true;
          if (action.type === "planner_uncomplete_card") card.completed = false;
          if (action.type === "planner_delete_card") {
            board.entries = board.entries.filter((item) => item.id !== card.id);
          }
          if (action.type === "planner_update_card") {
            if (clean(action.title, 200)) card.title = clean(action.title, 200);
            if (has(action, "note")) card.note = clean(action.note, 4000);
            if (Array.isArray(action.tags)) {
              card.tags = action.tags.map((tag) => clean(tag, 32)).filter(Boolean).slice(0, 16);
            }
          }
          if (action.type === "planner_move_card") {
            column = plannerColumn(board, action);
            if (!column) return failure(action, "Destination column not found.");
            card.columnId = column.id;
          }
          success(action, card.title);
        } else if (action.type.startsWith("calendar_")) {
          if (action.type === "calendar_add_reminder") {
            const reminderText = clean(action.text, 200);
            if (!reminderText || !validDate(action.date)) {
              return failure(action, "Reminder text and date are required.");
            }
            const start = TIME_24H.test(action.startTime || "") ? action.startTime : null;
            const end = TIME_24H.test(action.endTime || "") ? action.endTime : null;
            if (start && end && end < start) return failure(action, "End time must follow start time.");
            calendar.reminders.unshift({
              id: uid(),
              date: action.date,
              text: reminderText,
              startTime: start,
              endTime: end,
              priority: ["high", "low"].includes(action.priority) ? action.priority : "medium",
            });
            success(action, reminderText);
            return;
          }
          const reminder = matchText(
            calendar.reminders,
            action.reminderId,
            action.matchText,
            (value) => value.text || ""
          );
          if (!reminder) return failure(action, "Reminder not found.");
          if (action.type === "calendar_delete_reminder") {
            calendar.reminders = calendar.reminders.filter((item) => item.id !== reminder.id);
          } else {
            if (clean(action.text, 200)) reminder.text = clean(action.text, 200);
            if (has(action, "date") && validDate(action.date)) reminder.date = action.date;
            if (has(action, "startTime")) {
              reminder.startTime = TIME_24H.test(action.startTime || "") ? action.startTime : null;
            }
            if (has(action, "endTime")) {
              reminder.endTime = TIME_24H.test(action.endTime || "") ? action.endTime : null;
            }
            if (has(action, "priority")) {
              reminder.priority = ["high", "low"].includes(action.priority) ? action.priority : "medium";
            }
            if (reminder.startTime && reminder.endTime && reminder.endTime < reminder.startTime) {
              return failure(action, "End time must follow start time.");
            }
          }
          success(action, reminder.text);
        } else if (action.type.startsWith("tally_")) {
          if (action.type === "tally_add_expense") {
            const amount = Number(action.amount);
            const category = clean(action.category, 40);
            if (!(amount > 0) || !category || !validDate(action.date)) {
              return failure(action, "Valid amount, category and date are required.");
            }
            tally.records.unshift({
              id: uid(),
              date: action.date,
              amount,
              category,
              note: clean(action.note, 120),
            });
            success(action, `${category} ${tallyAmount(tally, amount)}`);
            return;
          }
          if (action.type === "tally_set_budget") {
            const budget = Number(action.budget);
            if (!(budget > 0)) return failure(action, "Budget must be positive.");
            tally.budget = budget;
            success(action, `Budget ${tallyAmount(tally, budget)}`);
            return;
          }
          const record =
            tally.records.find((item) => action.recordId && item.id === action.recordId) ||
            tally.records.find((item) => {
              const textNeedle = clean(action.matchText, 120).toLowerCase();
              const textMatches =
                !textNeedle ||
                clean(item.category, 40).toLowerCase().includes(textNeedle) ||
                clean(item.note, 120).toLowerCase().includes(textNeedle);
              const dateMatches = !validDate(action.date) || item.date === action.date;
              const amountMatches =
                !Number.isFinite(Number(action.amount)) || Number(item.amount) === Number(action.amount);
              return textMatches && dateMatches && amountMatches;
            });
          if (!record) return failure(action, "Expense record not found.");
          if (action.type === "tally_delete_expense") {
            tally.records = tally.records.filter((item) => item.id !== record.id);
          } else {
            if (has(action, "amount") && Number(action.amount) > 0) record.amount = Number(action.amount);
            if (clean(action.category, 40)) record.category = clean(action.category, 40);
            if (has(action, "note")) record.note = clean(action.note, 120);
            if (has(action, "date") && validDate(action.date)) record.date = action.date;
          }
          success(action, `${record.category} ${tallyAmount(tally, record.amount)}`);
        } else if (action.type.startsWith("teamwork_")) {
          if (action.type === "teamwork_update_field") {
            if (!TEAMWORK_FIELDS.has(action.field)) return failure(action, "Unsupported Teamwork field.");
            teamwork[action.field] = clean(action.value, action.field === "notes" ? 2000 : 500);
            success(action, action.field);
            return;
          }
          if (action.type === "teamwork_add_member") {
            const name = clean(action.name, 80);
            if (!name) return failure(action, "Member name is required.");
            teamwork.members.push({
              id: uid(),
              name,
              role: clean(action.role, 80) || "Member",
              tasks: [],
            });
            success(action, name);
            return;
          }
          const member = teamworkMember(teamwork, action);
          if (!member) return failure(action, "Team member not found.");
          if (!Array.isArray(member.tasks)) member.tasks = [];
          if (action.type === "teamwork_update_member") {
            if (clean(action.name, 80)) member.name = clean(action.name, 80);
            if (clean(action.role, 80)) member.role = clean(action.role, 80);
            success(action, member.name);
          } else if (action.type === "teamwork_delete_member") {
            teamwork.members = teamwork.members.filter((item) => item.id !== member.id);
            success(action, member.name);
          } else if (action.type === "teamwork_add_task") {
            const task = clean(action.text, 300);
            if (!task) return failure(action, "Task text is required.");
            member.tasks.push(task);
            success(action, `${member.name}: ${task}`);
          } else {
            const needle = clean(action.matchText, 300).toLowerCase();
            let index = Number.isInteger(action.taskIndex) ? action.taskIndex : -1;
            if (index < 0 && needle) {
              index = member.tasks.findIndex((task) => clean(task, 300).toLowerCase().includes(needle));
            }
            if (index < 0 || index >= member.tasks.length) return failure(action, "Team task not found.");
            const oldTask = member.tasks[index];
            if (action.type === "teamwork_update_task") member.tasks[index] = clean(action.text, 300);
            if (action.type === "teamwork_delete_task") member.tasks.splice(index, 1);
            success(action, `${member.name}: ${oldTask}`);
          }
        }
      } catch (_) {
        failure(action, "Action could not be applied.");
      }
    });

    if (changed.has("todo")) write(KEYS.todo, todo);
    if (changed.has("planner")) write(KEYS.planner, planner);
    if (changed.has("calendar")) write(KEYS.calendar, calendar);
    if (changed.has("tally")) write(KEYS.tally, tally);
    if (changed.has("teamwork")) write(KEYS.teamwork, teamwork);
    if (changed.size) {
      window.dispatchEvent(
        new CustomEvent("daily-space-agent-data-updated", {
          detail: { domains: Array.from(changed), applied },
        })
      );
    }
    return applied;
  }

  function needsConfirmation(actions) {
    return (Array.isArray(actions) ? actions : []).some((action) => DESTRUCTIVE.has(action?.type));
  }

  function confirmationText(actions) {
    const risky = (Array.isArray(actions) ? actions : []).filter((action) => DESTRUCTIVE.has(action?.type));
    if (!risky.length) return "";
    return `Confirm ${risky.length} sensitive change${risky.length === 1 ? "" : "s"}?\n\n${risky
      .map((action) => `• ${action.type.replaceAll("_", " ")}`)
      .join("\n")}`;
  }

  window.DailySpaceAgentData = {
    getSnapshot,
    applyActions,
    needsConfirmation,
    confirmationText,
    todayIso,
  };
})();
