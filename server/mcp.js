/**
 * MCP server: assistants such as Claude or ChatGPT read and manage the owner's
 * tasks, Tally expenses and calendar reminders over the Model Context Protocol
 * (Streamable HTTP, stateless: every POST gets one application/json answer).
 *
 * The key is a signed, stateless token like the Tally quick-add key. Its
 * identifier lives in the owner's synced `dayfly-connections-v1` store, so
 * replacing or clearing it there revokes the key without a server-side table.
 * Changes are written into the same account snapshot every device syncs, with
 * the quick-add compare-and-swap retry when another device syncs in between.
 */
const crypto = require("node:crypto");
const TaskFields = require("../task-fields.js");
const TallyCore = require("../tally-core.js");
const { readStore, writeStore } = require("./snapshot-values");
const Expenses = require("./quick-add");
const { version: SERVER_VERSION } = require("../package.json");

const TOKEN_PREFIX = "dfm_";
const CONNECTIONS_KEY = "dayfly-connections-v1";
const TASKS_KEY = "todo-app-v2";
const TALLY_KEY = "tally-book-v1";
const CALENDAR_KEY = "calendar-app-v1";
const PLANNER_KEY = "planner-app-v1";
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;
const MAX_WRITE_ATTEMPTS = 4;
const MAX_EVENT_DAYS = 100;
const MAX_EVENTS = 200;
const MAX_TEXT_CHARS = 24_000;
const KEY_ID = /^[A-Za-z0-9_-]{16,64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";
const VIEWS = ["today", "overdue", "upcoming", "inbox", "all"];
const PRIORITIES = ["low", "normal", "high"];
const REPEATS = [...TaskFields.REPEAT_UNITS];
const INACTIVE = "This dayfly key is not active. Create a new key in dayfly under Toolbox → Connect an AI assistant.";

/** A problem the assistant can fix or explain: answered as a tool result with isError, never as a protocol error. */
class ToolError extends Error {}

/** An HTTP-level failure with a message that is safe to show. */
function fail(statusCode, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, expose: true, ...extra });
}

const clip = (value, max) => { const text = String(value ?? ""); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const round = value => Math.round(value * 100) / 100;
const money = (value, currency) => `${currency} ${round(value).toFixed(2)}`;
const validTime = value => typeof value === "string" && TIME.test(value) ? value : null;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const quote = value => `“${clip(value, 120)}”`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

function safeEqual(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearer(header) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header || "").trim());
  return match ? match[1] : "";
}

/**
 * The next occurrence of a repeating task, or null when it does not repeat.
 * Mirrors spawnRepeatFrom in app.js, so a task completed by an assistant
 * repeats exactly like one completed in dayfly. Keep recurrence rules here.
 */
function nextOccurrence(task, todayIso) {
  if (!task?.repeat) return null;
  // Rules (every N, weekdays, until, after completion) live in task-fields.js, shared with the app.
  const dueDate = TaskFields.nextOccurrenceDate(task, { today: todayIso, completedOn: todayIso });
  if (!dueDate) return null;
  return {
    ...TaskFields.recurrence(task),
    id: crypto.randomUUID(),
    text: task.text,
    completed: false,
    dueDate,
    dueTime: validTime(task.dueTime),
    categoryId: typeof task.categoryId === "string" && task.categoryId ? task.categoryId : null,
    sourceMailId: null,
    repeat: TaskFields.normalizeRepeat(task.repeat),
  };
}

/**
 * Origins a browser may call the endpoint from. A configured public URL is the
 * server's own origin; the Host-derived origin counts only without one, or for
 * a loopback host in development. A DNS-rebinding page names its own host, so
 * its Origin never matches.
 */
function serverOrigins(request, publicUrl = "") {
  const host = String(request.headers.host || "");
  const forwarded = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const hostOrigin = host ? `${forwarded === "https" || request.socket?.encrypted ? "https" : "http"}://${host}` : "";
  let configured = "";
  try { configured = publicUrl ? new URL(String(publicUrl).trim()).origin : ""; } catch (_) { configured = ""; }
  if (configured === "null") configured = "";
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return { hostOrigin, publicOrigin: configured || hostOrigin, allowed: [configured, !configured || loopback ? hostOrigin : ""].filter(Boolean) };
}

const unreadable = what => new ToolError(`dayfly could not read your ${what}. Open dayfly once so it can repair them, then try again.`);

/** A parsed store object; a fresh empty one when the store is absent; never a damaged one (it would be overwritten). */
function storeObject(payload, key, what, empty) {
  const value = readStore(payload, key);
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (payload?.[key] == null) return empty();
  throw unreadable(what);
}

function readTasks(payload) {
  const store = storeObject(payload, TASKS_KEY, "tasks", () => ({ todos: [], categories: [], selectedCategoryKey: "__all__" }));
  if (store.todos == null) store.todos = [];
  if (!Array.isArray(store.todos)) throw unreadable("tasks");
  const todos = store.todos.filter(task => task && typeof task.id === "string" && typeof task.text === "string" && typeof task.completed === "boolean");
  const categories = (Array.isArray(store.categories) ? store.categories : []).filter(item => item && typeof item.id === "string" && typeof item.name === "string");
  return { store, todos, categories };
}

function readCalendar(payload) {
  const store = storeObject(payload, CALENDAR_KEY, "calendar reminders", () => ({ version: 1, reminders: [] }));
  if (store.reminders == null) store.reminders = [];
  if (!Array.isArray(store.reminders)) throw unreadable("calendar reminders");
  const reminders = store.reminders.filter(item => item && typeof item.id === "string" && typeof item.text === "string" && item.text.trim() && TallyCore.validDate(item.date));
  return { store, reminders };
}

function readLedger(payload) {
  const book = readStore(payload, TALLY_KEY);
  if (book && typeof book === "object" && !Array.isArray(book)) return book;
  if (payload?.[TALLY_KEY] == null) return null;
  throw unreadable("expenses");
}

/** How a task is shown to the assistant; notes are shortened in lists. */
function taskOut(task, categories) {
  const fields = TaskFields.fields(task);
  const out = {
    id: task.id, text: clip(task.text, 500), completed: task.completed,
    due_date: TaskFields.validDate(task.dueDate), due_time: validTime(task.dueTime),
    priority: fields.priority, category: categories.find(item => item.id === task.categoryId)?.name || null,
    repeat: typeof task.repeat === "string" && task.repeat ? task.repeat : null, inbox: fields.inbox,
  };
  if (fields.notes.trim()) out.notes = clip(fields.notes.trim(), 500);
  if (task.completed && fields.completedAt) out.completed_at = new Date(fields.completedAt).toISOString();
  return out;
}

function taskLine(task) {
  const when = [task.due_date, task.due_time].filter(Boolean).join(" ");
  const details = [when, task.priority !== "normal" && `${task.priority} priority`, task.category, task.repeat && `repeats ${task.repeat}`, task.inbox && "inbox"].filter(Boolean);
  return `- [${task.completed ? "x" : " "}] ${task.text}${details.length ? ` (${details.join(" · ")})` : ""} · id ${task.id}`;
}

function expenseOut(record, state) {
  const out = { id: record.id, date: record.date, amount: record.amount, currency: record.currency,
    base_amount: round(TallyCore.baseAmount(record)), category: record.category, note: record.note, scope: record.scope };
  if (record.currency !== state.baseCurrency) out.fx_rate = record.fxRate;
  if (record.tripName) out.trip = record.tripName;
  return out;
}

function expenseLine(expense, baseCurrency) {
  const converted = expense.currency !== baseCurrency ? ` (${money(expense.base_amount, baseCurrency)})` : "";
  return `- ${expense.date} · ${expense.category} · ${money(expense.amount, expense.currency)}${converted}${expense.note ? ` · ${expense.note}` : ""}${expense.scope === "shared" ? " · shared" : ""}`;
}

function eventLine(event) {
  const time = event.start_time ? `${event.start_time}${event.end_time ? `–${event.end_time}` : ""}` : "all day";
  const done = event.completed ? "done · " : "";
  return `- ${event.date} ${time} ${event.text} (${done}${event.type} · id ${event.id}${event.task_id ? ` · task id ${event.task_id}` : ""})`;
}

const minutes = value => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const clock = total => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * A task that follows a calendar reminder or project card takes its date from
 * that source whenever dayfly syncs linked work, so a new date or time is
 * copied there as well (as editing the task in dayfly does).
 */
function rescheduleLinked(payload, task) {
  if (!TaskFields.validDate(task.dueDate)) return payload;
  let next = payload;
  if (typeof task.sourceReminderId === "string") {
    const calendar = readStore(next, CALENDAR_KEY);
    const reminder = Array.isArray(calendar?.reminders) && calendar.reminders.find(item => item && item.id === task.sourceReminderId);
    if (reminder) {
      reminder.date = task.dueDate;
      const start = validTime(task.dueTime);
      if (validTime(reminder.startTime) !== start) {
        const oldStart = minutes(validTime(reminder.startTime)), oldEnd = minutes(validTime(reminder.endTime));
        const end = start && oldStart !== null && oldEnd !== null && oldEnd > oldStart ? minutes(start) + oldEnd - oldStart : null;
        reminder.startTime = start;
        reminder.endTime = end !== null && end < 1440 ? clock(end) : null;
      }
      reminder.remindAt = task.remindAt || null;
      next = writeStore(next, CALENDAR_KEY, calendar);
    }
  }
  if (typeof task.sourcePlannerId === "string") {
    const planner = readStore(next, PLANNER_KEY);
    const boards = planner?.boards && typeof planner.boards === "object" ? Object.values(planner.boards) : [];
    const entry = boards.flatMap(board => Array.isArray(board?.entries) ? board.entries : []).find(item => item && item.id === task.sourcePlannerId);
    if (entry && entry.dueDate !== task.dueDate) { entry.dueDate = task.dueDate; next = writeStore(next, PLANNER_KEY, planner); }
  }
  return next;
}

/** Strict argument reading: unknown names, wrong types and bad formats become messages the assistant can act on. */
function readArgs(args, allowed) {
  const unknown = Object.keys(args).filter(name => !allowed.includes(name));
  if (unknown.length) throw new ToolError(`Unknown argument ${unknown.slice(0, 5).map(name => JSON.stringify(clip(name, 40))).join(", ")}. This tool accepts: ${allowed.join(", ")}.`);
  const has = name => args[name] !== undefined && args[name] !== null;
  return {
    has,
    cleared: name => args[name] === null,
    text(name, { max, required = false, empty = false } = {}) {
      if (!has(name)) { if (required) throw new ToolError(`${name} is required.`); return undefined; }
      if (typeof args[name] !== "string") throw new ToolError(`${name} must be a string.`);
      const value = args[name].trim();
      if (!value && !empty) throw new ToolError(`${name} must not be empty.`);
      if (value.length > max) throw new ToolError(`${name} is too long: at most ${max} characters.`);
      return value;
    },
    date(name, { required = false } = {}) {
      if (!has(name)) { if (required) throw new ToolError(`${name} is required, written YYYY-MM-DD.`); return undefined; }
      const value = typeof args[name] === "string" ? TallyCore.validDate(args[name].trim()) : null;
      if (!value) throw new ToolError(`${name} must be a real date written YYYY-MM-DD, such as 2026-01-31.`);
      return value;
    },
    time(name) {
      if (!has(name)) return undefined;
      const value = typeof args[name] === "string" ? validTime(args[name].trim()) : null;
      if (!value) throw new ToolError(`${name} must be a 24-hour time written HH:MM, such as 09:30.`);
      return value;
    },
    choice(name, values) {
      if (!has(name)) return undefined;
      if (!values.includes(args[name])) throw new ToolError(`${name} must be one of: ${values.join(", ")}.`);
      return args[name];
    },
    flag(name) {
      if (!has(name)) return undefined;
      if (typeof args[name] !== "boolean") throw new ToolError(`${name} must be true or false.`);
      return args[name];
    },
    integer(name, min, max) {
      if (!has(name)) return undefined;
      if (!Number.isInteger(args[name]) || args[name] < min || args[name] > max) throw new ToolError(`${name} must be a whole number from ${min} to ${max}.`);
      return args[name];
    },
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const date = description => ({ type: "string", format: "date", description });
const TOOL_DEFINITIONS = [
  {
    name: "list_tasks", title: "List tasks",
    description: "List the owner's dayfly tasks. view: today (due today, the default), overdue (open tasks due before today), upcoming (due after today), inbox (captured, not yet planned) or all. Each task has an id for complete_task and update_task.",
    inputSchema: { type: "object", properties: {
      view: { type: "string", enum: VIEWS, description: "Which tasks to list. Default: today." },
      include_completed: { type: "boolean", description: "Also list completed tasks (overdue lists open tasks only). Default: false." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Most tasks to return. Default: 50." },
    }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "add_task", title: "Add a task",
    description: "Add a task to dayfly. Dates are YYYY-MM-DD and times HH:MM (24-hour) in the owner's time zone. category must name an existing category (matched case-insensitively); otherwise the task stays uncategorized.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", minLength: 1, maxLength: 500, description: "What needs doing." },
      due_date: date("Due date, YYYY-MM-DD."),
      due_time: { type: "string", pattern: TIME_PATTERN, description: "Due time, HH:MM (24-hour). Without due_date the task is due today." },
      priority: { type: "string", enum: PRIORITIES, description: "Default: normal." },
      category: { type: "string", maxLength: 48, description: "Name of an existing task category." },
      notes: { type: "string", maxLength: 10000 },
      repeat: { type: "string", enum: REPEATS, description: "Create the next occurrence when this one is completed." },
    }, required: ["text"], additionalProperties: false },
    annotations: ADDS,
  },
  {
    name: "complete_task", title: "Complete a task",
    description: "Mark a task as done, by id (from list_tasks) or by match: part of an open task's text, case-insensitive. When several open tasks match, nothing changes and the candidates are listed. Completing a repeating task creates its next occurrence.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "Task id from list_tasks." },
      match: { type: "string", minLength: 1, maxLength: 500, description: "Part of an open task's text. Use instead of id." },
    }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_task", title: "Update a task",
    description: "Change a task by id: its text, due date, due time, priority, notes or completion. Pass null as due_date or due_time to remove it. completed: true completes the task like complete_task; false reopens it.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "Task id from list_tasks." },
      text: { type: "string", minLength: 1, maxLength: 500 },
      due_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to remove the date." },
      due_time: { type: ["string", "null"], description: "HH:MM (24-hour), or null to remove the time." },
      priority: { type: "string", enum: PRIORITIES },
      notes: { type: "string", maxLength: 10000, description: "Replaces the notes; an empty string clears them." },
      completed: { type: "boolean" },
    }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_expenses", title: "List expenses",
    description: "List Tally expenses from from to to (inclusive; default: this month so far), newest first, with each record's original amount and currency and its value in the ledger's base currency, plus base-currency totals and the biggest categories.",
    inputSchema: { type: "object", properties: {
      from: date("First day, YYYY-MM-DD. Default: the first day of to's month."),
      to: date("Last day, YYYY-MM-DD. Default: today."),
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Most records to list; totals always cover the whole range. Default: 50." },
    }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "add_expense", title: "Record an expense",
    description: "Record an expense in the owner's Tally ledger. amount is in currency (default: the ledger's base currency); a foreign amount is converted at today's exchange rate unless fx_rate is given. date defaults to today.",
    inputSchema: { type: "object", properties: {
      amount: { type: "number", exclusiveMinimum: 0, description: "Amount spent, in currency." },
      currency: { type: "string", pattern: "^[A-Za-z]{3}$", description: "ISO 4217 code such as CNY, USD or JPY. Default: the ledger's base currency." },
      category: { type: "string", maxLength: 40, description: "Such as Lunch, Transport or Groceries. Default: Other." },
      note: { type: "string", maxLength: 120 },
      date: date("Day of the expense, YYYY-MM-DD. Default: today."),
      fx_rate: { type: "number", exclusiveMinimum: 0, description: "Base-currency units per 1 unit of currency, for a foreign amount. Default: today's rate." },
    }, required: ["amount"], additionalProperties: false },
    annotations: ADDS,
  },
  {
    name: "list_events", title: "List calendar events",
    description: "List calendar reminders and timed tasks from from to to (inclusive, at most 100 days), in date and time order.",
    inputSchema: { type: "object", properties: {
      from: date("First day, YYYY-MM-DD."),
      to: date("Last day, YYYY-MM-DD."),
    }, required: ["from", "to"], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "add_reminder", title: "Add a calendar reminder",
    description: "Add a reminder to the owner's dayfly calendar on date, optionally from start_time to end_time (HH:MM, 24-hour). Like every calendar reminder in dayfly, it also appears as a task.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", minLength: 1, maxLength: 200 },
      date: date("YYYY-MM-DD."),
      start_time: { type: "string", pattern: TIME_PATTERN, description: "HH:MM (24-hour)." },
      end_time: { type: "string", pattern: TIME_PATTERN, description: "HH:MM (24-hour), not before start_time." },
    }, required: ["text", "date"], additionalProperties: false },
    annotations: ADDS,
  },
];

function createMcp({ getSecret, getSnapshotStore, fetchRate = Expenses.defaultFetchRate, now = Date.now, log = console.error } = {}) {
  // Assistants make several calls per answer, so the per-user budget is wider than quick add's.
  const limitUser = Expenses.createLimiter({ now, limit: 120, code: "MCP_RATE_LIMITED" });
  const limitFailures = Expenses.createLimiter({ now, limit: 30, code: "MCP_RATE_LIMITED" });

  function sign(payloadJson) {
    const secret = getSecret();
    if (!secret) throw fail(503, "Assistant connections are not configured on this server.");
    // Domain-separated from session cookies and quick-add keys, which use the same secret.
    return crypto.createHmac("sha256", secret).update(`mcp:v1:${payloadJson}`).digest("base64url");
  }

  function issueKey(userId, timeZone) {
    const owner = String(userId || "").trim().toLowerCase();
    if (!owner) throw fail(401, "Please sign in first.");
    const keyId = crypto.randomBytes(18).toString("base64url");
    const payloadJson = JSON.stringify({ u: owner, k: keyId, z: Expenses.validTimeZone(timeZone) });
    return { keyId, token: `${TOKEN_PREFIX}${Buffer.from(payloadJson, "utf8").toString("base64url")}.${sign(payloadJson)}` };
  }

  function verify(token) {
    const raw = typeof token === "string" ? token.trim() : "";
    if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 1024) return null;
    const [payloadPart, signature, extra] = raw.slice(TOKEN_PREFIX.length).split(".");
    if (!payloadPart || !signature || extra !== undefined) return null;
    let payloadJson, parsed;
    try { payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8"); parsed = JSON.parse(payloadJson); } catch (_) { return null; }
    if (!safeEqual(sign(payloadJson), signature)) return null;
    if (!parsed || typeof parsed.u !== "string" || !parsed.u || typeof parsed.k !== "string" || !KEY_ID.test(parsed.k)) return null;
    return { userId: parsed.u, keyId: parsed.k, timeZone: Expenses.validTimeZone(parsed.z) };
  }

  /** Only the identifier saved in the owner's synced connections store is active; anything else reads as revoked. */
  function isActive(snapshot, keyId) {
    const connections = readStore(snapshot?.payload, CONNECTIONS_KEY);
    return typeof connections?.mcpKeyId === "string" && safeEqual(connections.mcpKeyId, keyId);
  }

  async function authenticate(token, ip) {
    const unauthorized = message => fail(401, message, { headers: { "WWW-Authenticate": 'Bearer realm="dayfly"' } });
    const key = verify(token);
    if (!key) { limitFailures(`ip:${ip || "unknown"}`); throw unauthorized("Invalid or missing dayfly key."); }
    limitUser(`user:${key.userId}`);
    const snapshot = await getSnapshotStore().getSnapshot(key.userId);
    if (!isActive(snapshot, key.keyId)) { limitFailures(`ip:${ip || "unknown"}`); throw unauthorized(INACTIVE); }
    return { key, snapshot };
  }

  /** Per-request access to the owner's snapshot: one read for reads, a compare-and-swap loop for writes. */
  function context({ key, snapshot }) {
    const store = getSnapshotStore();
    let current = snapshot;
    const ctx = {
      timeZone: key.timeZone || "UTC",
      today: Expenses.dateInZone(now(), key.timeZone),
      async read() {
        if (!current) {
          const fresh = await store.getSnapshot(key.userId);
          // The key can be turned off while a request runs.
          if (!isActive(fresh, key.keyId)) throw new ToolError(INACTIVE);
          current = fresh;
        }
        return { payload: current.payload || {}, revision: current.revision || 0 };
      },
      /** change(payload) returns { result } to leave data as it is, or { payload, result } to save. */
      async write(change) {
        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
          const { payload, revision } = await ctx.read();
          const outcome = await change(payload);
          if (!outcome.payload) return outcome.result;
          current = null;
          try {
            await store.upsertSnapshot(key.userId, outcome.payload, revision);
            return outcome.result;
          } catch (error) {
            // Another device synced in between: re-read and apply the change on top of it.
            if (error?.code === "SNAPSHOT_CONFLICT") continue;
            if (error?.statusCode === 413) throw new ToolError("Your dayfly account has reached its storage limit, so nothing was saved.");
            throw error;
          }
        }
        throw new ToolError("Your account is syncing right now, so nothing was saved. Try again in a moment.");
      },
    };
    return ctx;
  }

  function findTask(todos, id) {
    const task = todos.find(item => item.id === id);
    if (!task) throw new ToolError(`No task has id ${quote(id)}. Use list_tasks to find the id.`);
    return task;
  }

  function matchTask(todos, categories, match) {
    const needle = match.toLowerCase();
    const open = todos.filter(task => !task.completed && task.text.toLowerCase().includes(needle));
    const exact = open.filter(task => task.text.trim().toLowerCase() === needle);
    const candidates = exact.length === 1 ? exact : open;
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) throw new ToolError(`No open task contains ${quote(match)}. Use list_tasks to see open tasks.`);
    const shown = candidates.slice(0, 10).map(task => taskLine(taskOut(task, categories)));
    throw new ToolError([`${quote(match)} matches ${candidates.length} open tasks, so nothing was changed. Call complete_task again with one id:`,
      ...shown, ...(candidates.length > shown.length ? [`…and ${candidates.length - shown.length} more.`] : [])].join("\n"));
  }

  /** Completes a task in place; returns the next occurrence it adds for a repeating task. */
  function complete(store, task, today) {
    task.completed = true;
    task.completedAt = now();
    const next = nextOccurrence(task, today);
    if (next) store.todos = [next, ...store.todos];
    return next;
  }

  const runners = {
    async list_tasks(raw, ctx) {
      const args = readArgs(raw, ["view", "include_completed", "limit"]);
      const view = args.choice("view", VIEWS) || "today";
      const includeCompleted = args.flag("include_completed") === true && view !== "overdue";
      const limit = args.integer("limit", 1, 100) ?? 50;
      const { todos, categories } = readTasks((await ctx.read()).payload);
      const today = ctx.today, rank = { high: 0, normal: 1, low: 2 };
      const inView = {
        today: task => task.dueDate === today,
        overdue: task => !task.completed && Boolean(TaskFields.validDate(task.dueDate)) && task.dueDate < today,
        upcoming: task => Boolean(TaskFields.validDate(task.dueDate)) && task.dueDate > today,
        inbox: task => task.inbox === true,
        all: () => true,
      }[view];
      const when = task => `${task.due_date || "9999-12-31"} ${task.due_time || "99:99"}`;
      const tasks = todos.filter(task => inView(task) && (includeCompleted || !task.completed)).map(task => taskOut(task, categories))
        .sort((a, b) => Number(a.completed) - Number(b.completed) || (view === "inbox" ? 0 : when(a).localeCompare(when(b)) || rank[a.priority] - rank[b.priority]));
      const shown = tasks.slice(0, limit);
      const label = { today: `Due today (${today})`, overdue: `Overdue (due before ${today})`, upcoming: `Upcoming (due after ${today})`, inbox: "Inbox", all: "All tasks" }[view];
      const kind = includeCompleted ? "task" : "open task";
      const head = tasks.length ? `${label}: ${plural(tasks.length, kind)}${shown.length < tasks.length ? `, showing the first ${shown.length}` : ""}.` : `${label}: no ${kind}s.`;
      return { text: [head, ...shown.map(taskLine)].join("\n"),
        data: { view, today, time_zone: ctx.timeZone, total: tasks.length, truncated: shown.length < tasks.length, tasks: shown } };
    },

    async add_task(raw, ctx) {
      const args = readArgs(raw, ["text", "due_date", "due_time", "priority", "category", "notes", "repeat"]);
      const text = args.text("text", { max: 500, required: true });
      const dueTime = args.time("due_time") || null;
      const dueDate = args.date("due_date") || (dueTime ? ctx.today : null);
      const priority = args.choice("priority", PRIORITIES) || "normal";
      const categoryName = args.text("category", { max: 48 });
      const notes = args.text("notes", { max: 10000, empty: true }) || "";
      const repeat = args.choice("repeat", REPEATS) || null;
      return ctx.write(payload => {
        const { store, categories } = readTasks(payload);
        const category = categoryName ? categories.find(item => item.name.trim().toLowerCase() === categoryName.toLowerCase()) : null;
        const task = { ...TaskFields.fields({ createdAt: now(), priority, notes }), id: crypto.randomUUID(), text, completed: false, dueDate, dueTime, categoryId: category?.id || null, repeat };
        store.todos = [task, ...store.todos];
        const out = taskOut(task, categories);
        const notes_ = [];
        if (categoryName && !category) {
          const names = categories.slice(0, 20).map(item => item.name);
          notes_.push(`There is no category named ${quote(categoryName)}, so the task is uncategorized.${names.length ? ` Existing categories: ${names.join(", ")}.` : ""}`);
        }
        if (dueTime && !raw.due_date) notes_.push(`No due_date was given, so it is due today (${ctx.today}).`);
        return { payload: writeStore(payload, TASKS_KEY, store), result: {
          text: [`Added task ${quote(text)}.`, taskLine(out), ...notes_].join("\n"),
          data: { task: out, category_matched: categoryName ? Boolean(category) : null },
        } };
      });
    },

    async complete_task(raw, ctx) {
      const args = readArgs(raw, ["id", "match"]);
      const id = args.text("id", { max: 200 }), match = args.text("match", { max: 500 });
      if (Boolean(id) === Boolean(match)) throw new ToolError("Pass either id (from list_tasks) or match (part of an open task's text), not both.");
      return ctx.write(payload => {
        const { store, todos, categories } = readTasks(payload);
        const task = id ? findTask(todos, id) : matchTask(todos, categories, match);
        if (task.completed) {
          return { result: { text: `${quote(task.text)} was already completed.`, data: { task: taskOut(task, categories), already_completed: true, next: null } } };
        }
        const next = complete(store, task, ctx.today);
        const nextOut = next && taskOut(next, categories);
        return { payload: writeStore(payload, TASKS_KEY, store), result: {
          text: [`Completed ${quote(task.text)}.`, ...(nextOut ? [`It repeats ${nextOut.repeat}; the next one is due ${nextOut.due_date}:`, taskLine(nextOut)] : [])].join("\n"),
          data: { task: taskOut(task, categories), already_completed: false, next: nextOut || null },
        } };
      });
    },

    async update_task(raw, ctx) {
      const args = readArgs(raw, ["id", "text", "due_date", "due_time", "priority", "notes", "completed"]);
      const id = args.text("id", { max: 200, required: true });
      if (args.cleared("text") || args.cleared("priority") || args.cleared("completed")) throw new ToolError("Only due_date, due_time and notes can be cleared with null.");
      const text = args.text("text", { max: 500 });
      const dueDate = args.cleared("due_date") ? null : args.date("due_date");
      const dueTime = args.cleared("due_time") ? null : args.time("due_time");
      const priority = args.choice("priority", PRIORITIES);
      const notes = args.cleared("notes") ? "" : args.text("notes", { max: 10000, empty: true });
      const completed = args.flag("completed");
      if ([text, dueDate, dueTime, priority, notes, completed].every(value => value === undefined)) {
        throw new ToolError("Nothing to change: pass at least one of text, due_date, due_time, priority, notes or completed.");
      }
      return ctx.write(payload => {
        const { store, todos, categories } = readTasks(payload);
        const task = findTask(todos, id);
        const changes = [];
        let scheduled = false, next = null;
        if (text !== undefined && text !== task.text) { task.text = text; changes.push(`text → ${quote(text)}`); }
        if (dueDate !== undefined && dueDate !== (TaskFields.validDate(task.dueDate) || null)) {
          task.dueDate = dueDate; scheduled = true;
          if (dueDate) task.inbox = false;
          changes.push(`due date → ${dueDate || "none"}`);
        }
        if (dueTime !== undefined && dueTime !== validTime(task.dueTime)) { task.dueTime = dueTime; scheduled = true; changes.push(`due time → ${dueTime || "none"}`); }
        // A new date or time replaces the scheduled alert, as editing in dayfly does.
        if (scheduled) task.remindAt = null;
        if (priority !== undefined && priority !== TaskFields.fields(task).priority) { task.priority = priority; changes.push(`priority → ${priority}`); }
        if (notes !== undefined && notes !== TaskFields.fields(task).notes) { task.notes = notes; changes.push(notes ? "notes updated" : "notes cleared"); }
        if (completed !== undefined && completed !== task.completed) {
          if (completed) next = complete(store, task, ctx.today);
          else { task.completed = false; task.completedAt = null; }
          changes.push(completed ? "completed" : "reopened");
        }
        const out = taskOut(task, categories);
        if (!changes.length) return { result: { text: `${quote(task.text)} already looks like that; nothing changed.`, data: { task: out, changed: [], next: null } } };
        const linked = scheduled && (task.sourceReminderId || task.sourcePlannerId);
        const nextOut = next && taskOut(next, categories);
        const lines = [`Updated ${quote(task.text)}: ${changes.join(", ")}.`, taskLine(out)];
        if (nextOut) lines.push(`It repeats ${nextOut.repeat}; the next one is due ${nextOut.due_date}:`, taskLine(nextOut));
        if (linked && !out.due_date) lines.push("This task follows a calendar reminder or project card, which still has its date; dayfly restores that date when it syncs.");
        return { payload: rescheduleLinked(writeStore(payload, TASKS_KEY, store), task), result: {
          text: lines.join("\n"), data: { task: out, changed: changes, next: nextOut || null },
        } };
      });
    },

    async list_expenses(raw, ctx) {
      const args = readArgs(raw, ["from", "to", "limit"]);
      let from = args.date("from"), to = args.date("to");
      const limit = args.integer("limit", 1, 100) ?? 50;
      to = to || (from && from > ctx.today ? from : ctx.today);
      from = from || `${to.slice(0, 7)}-01`;
      if (from > to) throw new ToolError("from must be on or before to.");
      const book = readLedger((await ctx.read()).payload);
      if (!book) return { text: `No expenses recorded between ${from} and ${to}; the Tally ledger is empty.`, data: { from, to, base_currency: null, count: 0, total: 0, shared_count: 0, shared_total: 0, by_category: [], truncated: false, records: [] } };
      const state = TallyCore.normalizeState(book);
      const records = state.records.map((record, index) => ({ record, index }))
        .filter(({ record }) => record.date >= from && record.date <= to)
        .sort((a, b) => b.record.date.localeCompare(a.record.date) || a.index - b.index).map(({ record }) => record);
      const personal = TallyCore.personalRecords(records), shared = TallyCore.sharedRecords(records);
      const sum = list => round(list.reduce((total, record) => total + TallyCore.baseAmount(record), 0));
      const groups = new Map();
      for (const record of personal) {
        const group = groups.get(record.category.toLowerCase()) || { category: record.category, total: 0, count: 0 };
        group.total += TallyCore.baseAmount(record); group.count += 1; groups.set(record.category.toLowerCase(), group);
      }
      const byCategory = [...groups.values()].map(group => ({ ...group, total: round(group.total) })).sort((a, b) => b.total - a.total).slice(0, 12);
      const shown = records.slice(0, limit).map(record => expenseOut(record, state));
      const base = state.baseCurrency;
      const lines = [`Expenses ${from} to ${to} (base currency ${base}): ${plural(personal.length, "personal expense")}, total ${money(sum(personal), base)}.`];
      if (shared.length) lines.push(`Shared expenses (split with others): ${shared.length}, total ${money(sum(shared), base)}.`);
      if (byCategory.length) lines.push(`By category: ${byCategory.map(group => `${group.category} ${money(group.total, base)}`).join(" · ")}.`);
      lines.push(...shown.map(expense => expenseLine(expense, base)));
      if (shown.length < records.length) lines.push(`…and ${records.length - shown.length} more; raise limit or narrow the dates to see them.`);
      return { text: lines.join("\n"), data: { from, to, base_currency: base, count: personal.length, total: sum(personal), shared_count: shared.length, shared_total: sum(shared),
        by_category: byCategory, truncated: shown.length < records.length, records: shown } };
    },

    async add_expense(raw, ctx) {
      const args = readArgs(raw, ["amount", "currency", "category", "note", "date", "fx_rate"]);
      if (!args.has("amount")) throw new ToolError("amount is required.");
      if (typeof raw.amount !== "number" && typeof raw.amount !== "string") throw new ToolError("amount must be a number such as 32.5.");
      const currency = args.text("currency", { max: 3 }), category = args.text("category", { max: 40 });
      const note = args.text("note", { max: 120, empty: true }), day = args.date("date");
      if (args.has("fx_rate") && !(typeof raw.fx_rate === "number" && raw.fx_rate > 0 && raw.fx_rate <= 1e6)) {
        throw new ToolError("fx_rate must be a positive number: how many units of the base currency one unit of currency is worth.");
      }
      const input = expenseCall(() => Expenses.prepareExpense({ amount: raw.amount, currency, category, note, date: day, fxRate: raw.fx_rate }, { timeZone: ctx.timeZone, now, idPrefix: "" }));
      const rate = Expenses.rateOnce(fetchRate);
      return ctx.write(async payload => {
        const book = readLedger(payload);
        // A first expense starts the ledger in its own currency rather than Tally's JPY default.
        const state = TallyCore.normalizeState(book || { baseCurrency: input.currency || undefined });
        const known = input.category.trim() && state.records.find(record => record.category.toLowerCase() === input.category.trim().toLowerCase());
        const { record } = await expenseCall(() => Expenses.applyExpense(state, known ? { ...input, category: known.category } : input, rate));
        const summary = Expenses.expenseSummary(state, record, false);
        const out = expenseOut(record, state), base = state.baseCurrency;
        const converted = record.currency !== base ? ` (${money(out.base_amount, base)} at ${record.fxRate})` : "";
        const lines = [`Recorded ${money(record.amount, record.currency)}${converted} · ${record.category} · ${record.date}${record.note ? ` · ${record.note}` : ""}. Day total ${money(summary.dayTotal, base)}.`];
        if (!book) lines.push(`This is the first expense, so the Tally ledger now uses ${base} as its base currency.`);
        return { payload: writeStore(payload, TALLY_KEY, state), result: { text: lines.join("\n"), data: { expense: out, day_total: summary.dayTotal, base_currency: base } } };
      });
    },

    async list_events(raw, ctx) {
      const args = readArgs(raw, ["from", "to"]);
      const from = args.date("from", { required: true }), to = args.date("to", { required: true });
      if (from > to) throw new ToolError("from must be on or before to.");
      if (daysBetween(from, to) + 1 > MAX_EVENT_DAYS) throw new ToolError(`Ask for at most ${MAX_EVENT_DAYS} days at a time.`);
      const { payload } = await ctx.read();
      const { reminders } = readCalendar(payload), { todos } = readTasks(payload);
      const reminderIds = new Set(reminders.map(item => item.id));
      // Every reminder has a linked task in dayfly; show that pair once, as the reminder.
      const linkedTask = reminder => todos.find(task => task.sourceReminderId === reminder.id || (reminder.linkedTodoId && task.id === reminder.linkedTodoId));
      const events = [
        ...reminders.filter(item => item.date >= from && item.date <= to).map(item => {
          const task = linkedTask(item);
          return { type: "reminder", id: item.id, date: item.date, start_time: validTime(item.startTime), end_time: validTime(item.endTime),
            text: clip(item.text.trim(), 200), priority: ["high", "low"].includes(item.priority) ? item.priority : "medium",
            ...(task ? { task_id: task.id, completed: task.completed } : {}) };
        }),
        ...todos.filter(task => validTime(task.dueTime) && TaskFields.validDate(task.dueDate) && task.dueDate >= from && task.dueDate <= to &&
          !reminderIds.has(task.sourceReminderId) && !reminders.some(item => item.linkedTodoId === task.id))
          .map(task => ({ type: "task", id: task.id, date: task.dueDate, start_time: task.dueTime, end_time: null, text: clip(task.text, 500), completed: task.completed })),
      ].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || "").localeCompare(b.start_time || "") || a.type.localeCompare(b.type));
      const shown = events.slice(0, MAX_EVENTS);
      const head = events.length ? `Calendar ${from} to ${to}: ${plural(events.length, "event")}${shown.length < events.length ? `, showing the first ${shown.length}` : ""}.` : `Calendar ${from} to ${to}: nothing scheduled.`;
      return { text: [head, ...shown.map(eventLine)].join("\n"), data: { from, to, total: events.length, truncated: shown.length < events.length, events: shown } };
    },

    async add_reminder(raw, ctx) {
      const args = readArgs(raw, ["text", "date", "start_time", "end_time"]);
      const text = args.text("text", { max: 200, required: true });
      const day = args.date("date", { required: true });
      const start = args.time("start_time") || null, end = args.time("end_time") || null;
      if (end && !start) throw new ToolError("end_time needs a start_time.");
      if (start && end && end < start) throw new ToolError("end_time must not be earlier than start_time.");
      return ctx.write(payload => {
        const calendar = readCalendar(payload), tasks = readTasks(payload);
        const reminder = { id: crypto.randomUUID(), date: day, text, startTime: start, endTime: end, priority: "medium", linkedTodoId: null, externalEventId: null, createdAt: now() };
        // dayfly links each calendar reminder to one task; create the pair together so no device creates a second.
        const task = { ...TaskFields.fields({ createdAt: now() }), id: crypto.randomUUID(), text, completed: false, dueDate: day, dueTime: start,
          categoryId: null, sourceMailId: null, sourceReminderId: reminder.id, remindAt: null, repeat: null };
        reminder.linkedTodoId = task.id;
        calendar.store.reminders = [reminder, ...calendar.store.reminders];
        tasks.store.todos = [task, ...tasks.store.todos];
        const event = { type: "reminder", id: reminder.id, date: day, start_time: start, end_time: end, text, priority: "medium", task_id: task.id, completed: false };
        return { payload: writeStore(writeStore(payload, CALENDAR_KEY, calendar.store), TASKS_KEY, tasks.store), result: {
          text: [`Added reminder ${quote(text)} on ${day}${start ? ` at ${start}${end ? `–${end}` : ""}` : ""}.`, eventLine(event)].join("\n"),
          data: { reminder: event },
        } };
      });
    },
  };

  /** Quick-add validation errors become messages for the assistant, named after this tool's arguments. */
  function expenseCall(run) {
    const translate = error => {
      if (error?.code === "FX_UNAVAILABLE") return new ToolError("The exchange rate is unavailable right now. Pass fx_rate (base-currency units per 1 unit of currency), or record the amount in the base currency.");
      if (error?.code === "INVALID_FX_RATE") return new ToolError("fx_rate must be a positive number.");
      if (error?.statusCode === 400) return new ToolError(error.message);
      return error;
    };
    try {
      const result = run();
      return result && typeof result.then === "function" ? result.catch(error => { throw translate(error); }) : result;
    } catch (error) { throw translate(error); }
  }

  function instructions(ctx) {
    return `dayfly is the owner's personal workbench. These tools read and change their tasks, Tally expenses and calendar reminders. ` +
      `Dates are YYYY-MM-DD and times HH:MM (24-hour) in the owner's time zone, ${ctx.timeZone}; today is ${ctx.today}. ` +
      `Use list_tasks to find a task's id. Changes reach the owner's devices when they next sync.`;
  }

  const success = (id, result) => ({ jsonrpc: "2.0", id, result });
  const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  async function callTool(id, params, ctx) {
    if (typeof params.name !== "string" || !params.name) return failure(id, -32602, "Invalid params: tools/call needs a tool name.");
    if (!Object.hasOwn(runners, params.name)) return failure(id, -32602, `Unknown tool: ${clip(params.name, 80)}. Call tools/list to see the tools.`);
    const args = params.arguments ?? {};
    if (typeof args !== "object" || Array.isArray(args)) return failure(id, -32602, "Invalid params: arguments must be an object.");
    try {
      const { text, data } = await runners[params.name](args, ctx);
      return success(id, { content: [{ type: "text", text: clip(text, MAX_TEXT_CHARS) }], structuredContent: data });
    } catch (error) {
      if (!(error instanceof ToolError)) log(`MCP tool ${params.name} failed:`, error);
      const message = error instanceof ToolError ? error.message : "dayfly could not finish this right now. Try again in a moment.";
      return success(id, { content: [{ type: "text", text: message }], isError: true });
    }
  }

  async function dispatch(message, ctx) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return failure(null, -32600, "Invalid Request: each message must be a JSON-RPC 2.0 object.");
    const hasId = Object.hasOwn(message, "id");
    const id = hasId && (typeof message.id === "string" || (typeof message.id === "number" && Number.isFinite(message.id))) ? message.id : null;
    if (message.jsonrpc !== "2.0") return failure(id, -32600, 'Invalid Request: "jsonrpc" must be "2.0".');
    if (typeof message.method !== "string") {
      // A client's answer to a server request: this server never sends any, so there is nothing to do.
      if (hasId && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) return null;
      return failure(id, -32600, "Invalid Request: method must be a string.");
    }
    if (hasId && id === null) return failure(null, -32600, "Invalid Request: id must be a string or a number.");
    // Notifications (initialized, cancelled, …) need no answer.
    if (!hasId) return null;
    const params = message.params ?? {};
    if (typeof params !== "object" || Array.isArray(params)) return failure(id, -32602, "Invalid params: params must be an object.");
    switch (message.method) {
      case "initialize": {
        if (typeof params.protocolVersion !== "string") return failure(id, -32602, "Invalid params: initialize needs a protocolVersion.");
        return success(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "dayfly", version: SERVER_VERSION },
          instructions: instructions(ctx),
        });
      }
      case "ping": return success(id, {});
      case "tools/list": return success(id, { tools: TOOL_DEFINITIONS });
      case "tools/call": return callTool(id, params, ctx);
      default: return failure(id, -32601, `Method not found: ${clip(message.method, 80)}`);
    }
  }

  const answer = (status, payload, headers = {}) => ({ status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(payload) });

  /**
   * One MCP HTTP exchange. `body` is the raw request text, `pathKey` the key
   * from /api/mcp/k/<key> (else the Authorization header is used), and
   * `allowedOrigins` comes from serverOrigins(). Never throws.
   */
  async function handle({ method = "POST", headers = {}, pathKey = null, body = "", ip = "", allowedOrigins = [] } = {}) {
    try {
      if (method !== "POST") throw fail(405, "This MCP endpoint takes JSON-RPC messages by POST.", { headers: { Allow: "POST" } });
      if (headers.origin !== undefined && !allowedOrigins.includes(headers.origin)) throw fail(403, "Requests from other websites are not allowed.");
      const auth = await authenticate(pathKey ?? bearer(headers.authorization), ip);
      let parsed;
      try { parsed = JSON.parse(String(body)); } catch (_) { return answer(400, failure(null, -32700, "Parse error: the request body must be JSON.")); }
      const batch = Array.isArray(parsed), messages = batch ? parsed : [parsed];
      if (batch && !messages.length) return answer(400, failure(null, -32600, "Invalid Request: the batch is empty."));
      if (messages.length > MAX_BATCH) return answer(400, failure(null, -32600, `Invalid Request: send at most ${MAX_BATCH} messages at once.`));
      // Clients name the negotiated version on every request after initialize.
      const version = headers["mcp-protocol-version"];
      if (version !== undefined && !PROTOCOL_VERSIONS.includes(version) && !messages.some(message => message?.method === "initialize")) {
        return answer(400, failure(null, -32600, `Unsupported MCP-Protocol-Version ${clip(version, 40)}; this server supports ${PROTOCOL_VERSIONS.join(", ")}.`));
      }
      const ctx = context(auth), replies = [];
      for (const message of messages) {
        const reply = await dispatch(message, ctx);
        if (reply) replies.push(reply);
      }
      if (!replies.length) return { status: 202, headers: {}, body: "" };
      if (batch) return answer(200, replies);
      return answer(replies[0].error?.code === -32600 ? 400 : 200, replies[0]);
    } catch (error) {
      const status = error?.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
      if (!error?.expose && status >= 500) log("MCP request failed:", error);
      const headers = { ...(error?.headers || {}), ...(error?.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) };
      const message = error?.expose || status < 500 ? error.message : "dayfly could not handle this request right now.";
      return answer(status, failure(null, status === 401 ? -32001 : -32000, message), headers);
    }
  }

  /** Reads at most MAX_BODY_BYTES; a larger body is answered 413 and the connection closed. */
  function readBody(request) {
    return new Promise((resolve, reject) => {
      const declared = Number(request.headers["content-length"]);
      if (declared > MAX_BODY_BYTES) { request.resume(); resolve(null); return; }
      const chunks = [];
      let size = 0, done = false;
      request.on("data", chunk => {
        if (done) return;
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { done = true; resolve(null); return; }
        chunks.push(chunk);
      });
      request.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
      request.on("error", error => { if (!done) { done = true; reject(error); } });
    });
  }

  async function handleHttp(request, response, { pathKey = null, allowedOrigins = [] } = {}) {
    const method = request.method || "GET";
    let result;
    if (method === "POST") {
      const body = await readBody(request);
      result = body === null
        ? answer(413, failure(null, -32600, "The request body is too large (at most 256 KB)."), { Connection: "close" })
        : await handle({ method, headers: request.headers, pathKey, body, ip: request.socket.remoteAddress, allowedOrigins });
    } else {
      request.resume();
      result = await handle({ method, headers: request.headers, pathKey, ip: request.socket.remoteAddress, allowedOrigins });
    }
    response.writeHead(result.status, { "Cache-Control": "no-store", ...result.headers });
    response.end(result.body);
  }

  return { issueKey, verify, handle, handleHttp };
}

module.exports = { createMcp, nextOccurrence, serverOrigins, PROTOCOL_VERSIONS, CONNECTIONS_KEY, MAX_BODY_BYTES, TOOL_DEFINITIONS };
