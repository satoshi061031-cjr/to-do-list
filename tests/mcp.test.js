const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createMcp, nextOccurrence, serverOrigins, PROTOCOL_VERSIONS, TOOL_DEFINITIONS } = require("../server/mcp");
const { createQuickAdd } = require("../server/quick-add");
const { encodeValue, readStore, PREFIX } = require("../server/snapshot-values");
const { version } = require("../package.json");

const USER = "a@example.test";
// 23:30 UTC on Jan 31 is already Feb 1 in Shanghai, the time zone captured with the key.
const NOW = Date.UTC(2026, 0, 31, 23, 30);

function memoryStore() {
  const rows = new Map();
  let conflictsLeft = 0, onConflict = null;
  return {
    rows, failNext(count, change = null) { conflictsLeft = count; onConflict = change; },
    async getSnapshot(userId) { const row = rows.get(userId); return row ? { payload: { ...row.payload }, revision: row.revision } : null; },
    async upsertSnapshot(userId, payload, baseRevision) {
      const row = rows.get(userId);
      if (conflictsLeft > 0 || (row?.revision || 0) !== baseRevision) {
        if (conflictsLeft > 0) { conflictsLeft -= 1; if (row) { row.revision += 1; onConflict?.(row); } }
        throw Object.assign(new Error("conflict"), { statusCode: 409, code: "SNAPSHOT_CONFLICT" });
      }
      rows.set(userId, { payload, revision: baseRevision + 1 }); return { userId, revision: baseRevision + 1 };
    },
  };
}

const tasksFixture = () => ({ custom: "keep", selectedCategoryKey: "__all__", categories: [{ id: "work", name: "Work" }, { id: "home", name: "Home" }], todos: [
  { id: "today-1", text: "Send the invoice", completed: false, dueDate: "2026-02-01", dueTime: "09:30", categoryId: "work", priority: "high", notes: "Keep these notes", sourceMailId: "mail:keep" },
  { id: "today-2", text: "Water the plants", completed: false, dueDate: "2026-02-01", dueTime: null, categoryId: "home", repeat: "weekly" },
  { id: "done-1", text: "Book flights", completed: true, completedAt: NOW - 1000, dueDate: "2026-02-01", categoryId: null },
  { id: "late-1", text: "Renew passport", completed: false, dueDate: "2026-01-20", categoryId: null },
  { id: "soon-1", text: "Dentist follow-up", completed: false, dueDate: "2026-02-03", dueTime: "14:00", categoryId: null },
  { id: "inbox-1", text: "Research standing desks", completed: false, dueDate: null, inbox: true },
  { id: "month-end", text: "Pay rent", completed: false, dueDate: "2026-01-31", repeat: "monthly" },
] });

function fixture({ keyId, extra = {}, secret = "fixture-secret", fetchRate = async () => 7 } = {}) {
  const store = memoryStore(), logs = [];
  const mcp = createMcp({ getSecret: () => secret, getSnapshotStore: () => store, fetchRate, now: () => NOW, log: (...args) => logs.push(args) });
  const issued = mcp.issueKey("A@example.test", "Asia/Shanghai");
  store.rows.set(USER, { revision: 3, payload: {
    "dayfly-connections-v1": JSON.stringify({ version: 1, mcpKeyId: keyId === undefined ? issued.keyId : keyId }),
    "todo-app-v2": JSON.stringify(tasksFixture()),
    "tally-book-v1": JSON.stringify({ baseCurrency: "CNY", quickAddKeyId: "quick-add-key-identifier", records: [
      { id: "e1", date: "2026-01-30", amount: 30, category: "Lunch", note: "noodles" },
      { id: "e2", date: "2026-01-31", amount: 10, currency: "USD", fxRate: 7.2, category: "Coffee" },
      { id: "e3", date: "2026-01-15", amount: 300, category: "Dinner", scope: "shared" },
      { id: "e4", date: "2025-12-31", amount: 99, category: "Lunch" },
    ] }),
    "calendar-app-v1": JSON.stringify({ version: 1, selectedDate: "2026-02-01", reminders: [
      { id: "rem-1", date: "2026-02-02", text: "Team standup", startTime: "10:00", endTime: "10:30", priority: "high", linkedTodoId: "linked-1" },
      { id: "rem-2", date: "2026-02-05", text: "Mum's birthday", startTime: null, endTime: null, priority: "medium" },
    ] }),
    "todo-theme": "dark",
    ...extra,
  } });
  const send = async (message, { headers = {}, pathKey, method, ip = "203.0.113.5", raw } = {}) => {
    const result = await mcp.handle({ method, pathKey, ip, allowedOrigins: ["https://dayfly.example"],
      headers: { authorization: `Bearer ${issued.token}`, ...headers }, body: raw ?? JSON.stringify(message) });
    return { ...result, json: result.body ? JSON.parse(result.body) : null };
  };
  let nextId = 1;
  const rpc = async (method, params, options) => (await send({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }, options)).json;
  const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;
  const stored = key => readStore(store.rows.get(USER).payload, key);
  const revision = () => store.rows.get(USER).revision;
  return { store, mcp, issued, send, rpc, call, stored, revision, logs };
}

test("initialize negotiates the protocol version and describes the tools", async () => {
  const { rpc } = fixture();
  for (const requested of PROTOCOL_VERSIONS) assert.equal((await rpc("initialize", { protocolVersion: requested, capabilities: {}, clientInfo: { name: "test", version: "1" } })).result.protocolVersion, requested);
  const init = (await rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {} })).result;
  assert.equal(init.protocolVersion, "2025-06-18");
  assert.deepEqual(init.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(init.serverInfo, { name: "dayfly", version });
  assert.match(init.instructions, /Asia\/Shanghai; today is 2026-02-01/);
  assert.equal((await rpc("initialize", { capabilities: {} })).error.code, -32602);
  assert.deepEqual((await rpc("ping")).result, {});

  const { tools } = (await rpc("tools/list", {})).result;
  assert.deepEqual(tools.map(tool => tool.name), ["list_tasks", "add_task", "complete_task", "update_task", "list_expenses", "add_expense", "list_events", "add_reminder"]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object"); assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.description.length > 40 && tool.title, tool.name);
    assert.equal(tool.annotations.readOnlyHint, tool.name.startsWith("list_"));
  }
  assert.deepEqual(tools, TOOL_DEFINITIONS);
});

test("JSON-RPC framing: notifications, errors, batches, versions and methods", async () => {
  const { send, rpc } = fixture();
  const notification = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notification.status, 202); assert.equal(notification.body, "");
  assert.equal((await send({ jsonrpc: "2.0", id: 9, result: {} })).status, 202, "a client's response needs no answer");

  const unknown = await send({ jsonrpc: "2.0", id: 1, method: "resources/list" });
  assert.equal(unknown.status, 200); assert.deepEqual(unknown.json.error.code, -32601); assert.equal(unknown.json.id, 1);
  const badJson = await send(null, { raw: "{not json" });
  assert.equal(badJson.status, 400); assert.equal(badJson.json.error.code, -32700); assert.equal(badJson.json.id, null);
  for (const message of [{ id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: { nested: true }, method: "ping" }, 42]) {
    const invalid = await send(message);
    assert.equal(invalid.status, 400, JSON.stringify(message)); assert.equal(invalid.json.error.code, -32600);
  }
  assert.equal((await rpc("tools/list", ["array"])).error.code, -32602);

  const batch = await send([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "nope" }]);
  assert.equal(batch.status, 200); assert.deepEqual(batch.json.map(reply => reply.id), ["a", "b"]); assert.equal(batch.json[1].error.code, -32601);
  assert.equal((await send([{ jsonrpc: "2.0", method: "notifications/initialized" }])).status, 202);
  assert.equal((await send([])).json.error.code, -32600);
  assert.equal((await send(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })))).status, 400);

  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "mcp-protocol-version": "2025-06-18" } })).status, 200);
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "mcp-protocol-version": "1999-01-01" } })).status, 400);
  // A newer client may name its own version before the server has answered initialize.
  assert.equal((await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } }, { headers: { "mcp-protocol-version": "2099-01-01" } })).status, 200);

  const get = await send(null, { method: "GET", raw: "" });
  assert.equal(get.status, 405); assert.equal(get.headers.Allow, "POST");
  assert.equal((await rpc("tools/call", { name: "drop_tables", arguments: {} })).error.code, -32602);
  assert.equal((await rpc("tools/call", { arguments: {} })).error.code, -32602);
  assert.equal((await rpc("tools/call", { name: "list_tasks", arguments: [] })).error.code, -32602);
});

test("keys: missing, forged, foreign, inactive and revoked keys are refused; the path key works", async () => {
  const { send, issued, store, mcp } = fixture();
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  const missing = await send(ping, { headers: { authorization: "" } });
  assert.equal(missing.status, 401); assert.equal(missing.json.error.code, -32001); assert.match(missing.headers["WWW-Authenticate"], /^Bearer/);
  assert.equal((await send(ping, { headers: { authorization: `Bearer ${issued.token.slice(0, -2)}xx` } })).status, 401);
  const other = createMcp({ getSecret: () => "another-secret", getSnapshotStore: () => store }).issueKey(USER, "UTC");
  assert.equal((await send(ping, { headers: { authorization: `Bearer ${other.token}` } })).status, 401);
  // Quick-add keys share the secret but not the signing domain.
  const quick = createQuickAdd({ getSecret: () => "fixture-secret", getSnapshotStore: () => store }).issueKey(USER).token;
  for (const token of [quick, quick.replace(/^dfq_/, "dfm_")]) assert.equal((await send(ping, { headers: { authorization: `Bearer ${token}` } })).status, 401);

  assert.equal((await send(ping, { headers: { authorization: "" }, pathKey: issued.token })).status, 200);
  assert.equal((await send(ping, { pathKey: "dfm_not-a-key" })).status, 401, "the path key decides, not the header");
  assert.equal((await send(ping, { pathKey: "" })).status, 401);

  for (const keyId of [null, "someone-elses-key-identifier"]) {
    const stale = fixture({ keyId });
    const refused = await stale.send(ping);
    assert.equal(refused.status, 401); assert.match(refused.json.error.message, /not active/);
  }
  const noStore = fixture({ extra: { "dayfly-connections-v1": undefined } });
  delete noStore.store.rows.get(USER).payload["dayfly-connections-v1"];
  assert.equal((await noStore.send(ping)).status, 401);
  const stranger = mcp.issueKey("b@example.test", "UTC");
  assert.equal((await send(ping, { headers: { authorization: `Bearer ${stranger.token}` } })).status, 401, "an account without a snapshot has no active key");

  // Turning the key off in the synced store revokes it immediately.
  const row = store.rows.get(USER);
  row.payload["dayfly-connections-v1"] = JSON.stringify({ version: 1, mcpKeyId: null });
  assert.equal((await send(ping)).status, 401);

  const unconfigured = createMcp({ getSecret: () => null, getSnapshotStore: () => store });
  const answer = await unconfigured.handle({ headers: { authorization: `Bearer ${issued.token}` }, body: JSON.stringify(ping) });
  assert.equal(answer.status, 503);
});

test("Origin must be the server's own; failures and heavy use are rate limited", async () => {
  const { send } = fixture();
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await send(ping, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await send(ping, { headers: { origin: "null" } })).status, 403);
  assert.equal((await send(ping, { headers: { origin: "https://dayfly.example" } })).status, 200);

  const attacker = fixture();
  for (let i = 0; i < 30; i += 1) assert.equal((await attacker.send(ping, { headers: { authorization: "Bearer dfm_x.y" }, ip: "198.51.100.7" })).status, 401);
  const limited = await attacker.send(ping, { headers: { authorization: "Bearer dfm_x.y" }, ip: "198.51.100.7" });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers["Retry-After"]) > 0);
  assert.equal((await attacker.send(ping, { ip: "198.51.100.7" })).status, 200, "a valid key still works from that address");

  const busy = fixture();
  for (let i = 0; i < 120; i += 1) assert.equal((await busy.send(ping)).status, 200);
  assert.equal((await busy.send(ping)).status, 429);

  // Store failures are logged without the key and answered without internals.
  const broken = fixture();
  broken.store.getSnapshot = async () => { throw Object.assign(new Error("Supabase read failed: boom"), { statusCode: 502 }); };
  const failed = await broken.send(ping);
  assert.equal(failed.status, 502); assert.doesNotMatch(failed.body, /Supabase|boom/);
  const toolFailure = fixture();
  toolFailure.store.upsertSnapshot = async () => { throw new Error("disk full"); };
  const crashed = await toolFailure.call("add_task", { text: "Lost" });
  assert.equal(crashed.isError, true); assert.doesNotMatch(crashed.content[0].text, /disk full/);
  for (const { logs, issued } of [broken, toolFailure]) {
    assert.ok(logs.length > 0);
    for (const entry of logs) assert.ok(!entry.map(value => `${value?.stack || value}`).join(" ").includes(issued.token.slice(4)), "keys are never logged");
  }
});

test("list_tasks uses the key's time zone for today and supports every view", async () => {
  const { call } = fixture();
  const today = await call("list_tasks", {});
  assert.equal(today.isError, undefined);
  assert.deepEqual(today.structuredContent.tasks.map(task => task.id), ["today-1", "today-2"]);
  assert.equal(today.structuredContent.today, "2026-02-01"); assert.equal(today.structuredContent.time_zone, "Asia/Shanghai");
  const first = today.structuredContent.tasks[0];
  assert.deepEqual({ ...first }, { id: "today-1", text: "Send the invoice", completed: false, due_date: "2026-02-01", due_time: "09:30", priority: "high", category: "Work", repeat: null, inbox: false, notes: "Keep these notes" });
  assert.match(today.content[0].text, /Due today \(2026-02-01\): 2 open tasks\.\n- \[ \] Send the invoice \(2026-02-01 09:30 · high priority · Work\) · id today-1/);

  const withDone = await call("list_tasks", { view: "today", include_completed: true });
  assert.deepEqual(withDone.structuredContent.tasks.map(task => task.id), ["today-1", "today-2", "done-1"]);
  assert.ok(withDone.structuredContent.tasks[2].completed_at);
  assert.deepEqual((await call("list_tasks", { view: "overdue", include_completed: true })).structuredContent.tasks.map(task => task.id), ["late-1", "month-end"]);
  assert.deepEqual((await call("list_tasks", { view: "upcoming" })).structuredContent.tasks.map(task => task.id), ["soon-1"]);
  assert.deepEqual((await call("list_tasks", { view: "inbox" })).structuredContent.tasks.map(task => task.id), ["inbox-1"]);
  const all = await call("list_tasks", { view: "all", limit: 3 });
  assert.equal(all.structuredContent.total, 6); assert.equal(all.structuredContent.truncated, true); assert.equal(all.structuredContent.tasks.length, 3);
  assert.deepEqual(all.structuredContent.tasks.map(task => task.id), ["late-1", "month-end", "today-1"]);
  assert.match(all.content[0].text, /showing the first 3/);

  for (const args of [{ view: "week" }, { limit: 0 }, { limit: 101 }, { limit: "5" }, { include_completed: "yes" }, { colour: "red" }]) {
    const refused = await call("list_tasks", args);
    assert.equal(refused.isError, true, JSON.stringify(args)); assert.ok(refused.content[0].text.length > 10);
  }
});

test("add_task validates strictly, matches categories and keeps the rest of the store", async () => {
  const { call, stored, revision, store } = fixture();
  const added = await call("add_task", { text: "  Prepare the slides  ", due_date: "2026-02-04", due_time: "16:00", priority: "high", category: "WORK", notes: "Ten slides", repeat: "weekly" });
  assert.equal(added.isError, undefined); assert.match(added.content[0].text, /Added task “Prepare the slides”/);
  const saved = stored("todo-app-v2");
  const task = saved.todos[0];
  assert.equal(task.id, added.structuredContent.task.id); assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ text: task.text, dueDate: task.dueDate, dueTime: task.dueTime, categoryId: task.categoryId, priority: task.priority, notes: task.notes, repeat: task.repeat, completed: task.completed, inbox: task.inbox },
    { text: "Prepare the slides", dueDate: "2026-02-04", dueTime: "16:00", categoryId: "work", priority: "high", notes: "Ten slides", repeat: "weekly", completed: false, inbox: false });
  assert.equal(task.createdAt, NOW);
  assert.equal(saved.custom, "keep"); assert.equal(saved.todos.length, 8); assert.equal(saved.todos.find(item => item.id === "today-1").sourceMailId, "mail:keep");
  assert.equal(store.rows.get(USER).payload["todo-theme"], "dark"); assert.equal(revision(), 4);

  const uncategorized = await call("add_task", { text: "Plan the trip", category: "Travel", due_time: "08:00" });
  assert.equal(uncategorized.structuredContent.task.category, null); assert.equal(uncategorized.structuredContent.category_matched, false);
  assert.equal(uncategorized.structuredContent.task.due_date, "2026-02-01", "a time without a date means today in the key's time zone");
  assert.match(uncategorized.content[0].text, /no category named “Travel”, so the task is uncategorized\. Existing categories: Work, Home\./);

  for (const args of [{}, { text: "   " }, { text: "x".repeat(501) }, { text: "Bad date", due_date: "2026-02-30" }, { text: "Bad date", due_date: "02/04/2026" },
    { text: "Bad time", due_time: "25:00" }, { text: "Bad", priority: "urgent" }, { text: "Bad", repeat: "yearly" }, { text: "Bad", due: "2026-02-04" }, { text: 42 }]) {
    const refused = await call("add_task", args);
    assert.equal(refused.isError, true, JSON.stringify(args));
  }
  assert.equal(revision(), 5, "refused calls write nothing");
});

test("complete_task by id or unique match; ambiguity changes nothing; repeats create the next occurrence", async () => {
  const { call, stored, revision } = fixture();
  const ambiguous = await call("complete_task", { match: "e" });
  assert.equal(ambiguous.isError, true); assert.match(ambiguous.content[0].text, /matches \d+ open tasks, so nothing was changed/); assert.match(ambiguous.content[0].text, /id today-1/);
  assert.equal(revision(), 3);
  assert.equal((await call("complete_task", { match: "no such words" })).isError, true);
  assert.equal((await call("complete_task", {})).isError, true);
  assert.equal((await call("complete_task", { id: "today-1", match: "invoice" })).isError, true);
  assert.equal((await call("complete_task", { id: "missing" })).isError, true);

  const done = await call("complete_task", { match: "INVOICE" });
  assert.equal(done.structuredContent.task.id, "today-1"); assert.equal(done.structuredContent.next, null);
  const invoice = stored("todo-app-v2").todos.find(task => task.id === "today-1");
  assert.equal(invoice.completed, true); assert.equal(invoice.completedAt, NOW);
  const again = await call("complete_task", { id: "today-1" });
  assert.equal(again.structuredContent.already_completed, true); assert.equal(revision(), 4, "completing twice writes once");

  const weekly = await call("complete_task", { id: "today-2" });
  assert.equal(weekly.structuredContent.next.due_date, "2026-02-08"); assert.match(weekly.content[0].text, /next one is due 2026-02-08/);
  const rent = await call("complete_task", { id: "month-end" });
  assert.equal(rent.structuredContent.next.due_date, "2026-02-28");
  const saved = stored("todo-app-v2").todos;
  const nextRent = saved.find(task => task.id === rent.structuredContent.next.id);
  assert.equal(nextRent.repeatDay, 31); assert.equal(nextRent.completed, false); assert.equal(saved[0].id, nextRent.id, "next occurrences go first, like in dayfly");

  // An exact title wins over longer titles that also contain the words.
  const exact = fixture({ extra: { "todo-app-v2": JSON.stringify({ todos: [{ id: "a", text: "Call Mum", completed: false }, { id: "b", text: "Call Mum about the trip", completed: false }] }) } });
  assert.equal((await exact.call("complete_task", { match: "call mum" })).structuredContent.task.id, "a");
});

test("nextOccurrence mirrors dayfly recurrence", () => {
  assert.equal(nextOccurrence({ text: "Once", dueDate: "2026-02-01" }, "2026-02-01"), null);
  const daily = nextOccurrence({ id: "x", text: "Stretch", repeat: "daily", dueDate: null, dueTime: "07:00", categoryId: "home", notes: "Ten minutes", subtasks: [{ id: "s", text: "Neck", completed: true }], priority: "low", sourceMailId: "mail:x" }, "2026-02-01");
  assert.equal(daily.dueDate, "2026-02-02", "an undated repeat continues from today");
  assert.deepEqual({ text: daily.text, dueTime: daily.dueTime, categoryId: daily.categoryId, notes: daily.notes, priority: daily.priority, repeat: daily.repeat, completed: daily.completed, sourceMailId: daily.sourceMailId },
    { text: "Stretch", dueTime: "07:00", categoryId: "home", notes: "Ten minutes", priority: "low", repeat: "daily", completed: false, sourceMailId: null });
  assert.equal(daily.subtasks[0].completed, false); assert.notEqual(daily.subtasks[0].id, "s"); assert.notEqual(daily.id, "x");
  assert.equal(nextOccurrence({ text: "Rent", repeat: "monthly", dueDate: "2026-02-28", repeatDay: 31 }, "2026-02-01").dueDate, "2026-03-31");
  assert.equal(nextOccurrence({ text: "Odd", repeat: "fortnightly", dueDate: "2026-02-01" }, "2026-02-01"), null);
});

test("update_task changes, clears, completes and reopens; linked reminders move with their task", async () => {
  const { call, stored, revision } = fixture();
  const updated = await call("update_task", { id: "today-1", text: "Send the final invoice", due_date: "2026-02-02", due_time: null, priority: "low", notes: "" });
  assert.equal(updated.isError, undefined);
  assert.deepEqual(updated.structuredContent.changed, ["text → “Send the final invoice”", "due date → 2026-02-02", "due time → none", "priority → low", "notes cleared"]);
  const task = stored("todo-app-v2").todos.find(item => item.id === "today-1");
  assert.deepEqual({ text: task.text, dueDate: task.dueDate, dueTime: task.dueTime, priority: task.priority, notes: task.notes, remindAt: task.remindAt, sourceMailId: task.sourceMailId },
    { text: "Send the final invoice", dueDate: "2026-02-02", dueTime: null, priority: "low", notes: "", remindAt: null, sourceMailId: "mail:keep" });
  assert.equal((await call("update_task", { id: "inbox-1", due_date: "2026-02-06" })).structuredContent.task.inbox, false, "a dated task leaves the inbox");
  assert.equal((await call("update_task", { id: "today-1", due_date: null })).structuredContent.task.due_date, null);

  const completed = await call("update_task", { id: "today-2", completed: true });
  assert.equal(completed.structuredContent.next.due_date, "2026-02-08");
  const reopened = await call("update_task", { id: "today-2", completed: false });
  assert.equal(reopened.structuredContent.task.completed, false);
  assert.equal(stored("todo-app-v2").todos.find(item => item.id === "today-2").completedAt, null);

  const before = revision();
  for (const args of [{ id: "today-2" }, { text: "No id" }, { id: "missing", text: "x" }, { id: "today-2", text: null }, { id: "today-2", due_date: "tomorrow" }, { id: "today-2", completed: "true" }, { id: "today-2", category: "Home" }]) {
    assert.equal((await call("update_task", args)).isError, true, JSON.stringify(args));
  }
  assert.equal((await call("update_task", { id: "soon-1", due_date: "2026-02-03" })).structuredContent.changed.length, 0);
  assert.equal(revision(), before, "refused and unchanged updates write nothing");

  // dayfly copies a linked reminder's or project card's date onto its task when it syncs, so a new date goes to the source too.
  const linked = fixture({ extra: {
    "todo-app-v2": JSON.stringify({ todos: [
      { id: "linked-1", text: "Team standup", completed: false, dueDate: "2026-02-02", dueTime: "10:00", sourceReminderId: "rem-1" },
      { id: "card-task", text: "Launch", completed: false, dueDate: "2026-02-10", sourcePlannerId: "card-1" },
    ] }),
    "planner-app-v1": JSON.stringify({ version: 2, planners: [], boards: { b: { columns: [], entries: [{ id: "card-1", title: "Launch", dueDate: "2026-02-10", linkedTodoId: "card-task" }] } } }),
  } });
  await linked.call("update_task", { id: "linked-1", due_date: "2026-02-04", due_time: "15:00" });
  const reminder = linked.stored("calendar-app-v1").reminders.find(item => item.id === "rem-1");
  assert.deepEqual({ date: reminder.date, startTime: reminder.startTime, endTime: reminder.endTime }, { date: "2026-02-04", startTime: "15:00", endTime: "15:30" });
  assert.equal(linked.stored("calendar-app-v1").selectedDate, "2026-02-01");
  await linked.call("update_task", { id: "card-task", due_date: "2026-02-12" });
  assert.equal(linked.stored("planner-app-v1").boards.b.entries[0].dueDate, "2026-02-12");
  const unlinked = await linked.call("update_task", { id: "card-task", due_date: null });
  assert.match(unlinked.content[0].text, /follows a calendar reminder or project card/);
});

test("list_expenses and add_expense use the ledger's base currency, saved rates and quick-add validation", async () => {
  const { call, stored, revision } = fixture();
  const listed = await call("list_expenses", { from: "2026-01-01", to: "2026-01-31" });
  const data = listed.structuredContent;
  assert.equal(data.base_currency, "CNY"); assert.equal(data.count, 2); assert.equal(data.total, 102); assert.equal(data.shared_count, 1); assert.equal(data.shared_total, 300);
  assert.deepEqual(data.records.map(record => record.id), ["e2", "e1", "e3"]);
  assert.deepEqual(data.records[0], { id: "e2", date: "2026-01-31", amount: 10, currency: "USD", base_amount: 72, category: "Coffee", note: "", scope: "personal", fx_rate: 7.2 });
  assert.deepEqual(data.by_category, [{ category: "Coffee", total: 72, count: 1 }, { category: "Lunch", total: 30, count: 1 }]);
  assert.match(listed.content[0].text, /total CNY 102\.00/); assert.match(listed.content[0].text, /- 2026-01-31 · Coffee · USD 10\.00 \(CNY 72\.00\)/);
  const limited = await call("list_expenses", { from: "2025-12-01", to: "2026-01-31", limit: 1 });
  assert.equal(limited.structuredContent.truncated, true); assert.equal(limited.structuredContent.total, 201, "totals cover the whole range");
  assert.equal((await call("list_expenses", {})).structuredContent.from, "2026-02-01", "the default range is this month so far");
  assert.equal((await call("list_expenses", { from: "2026-02-01", to: "2026-01-01" })).isError, true);

  const lunch = await call("add_expense", { amount: 32.5, category: "lunch", note: "dumplings" });
  assert.equal(lunch.isError, undefined);
  assert.deepEqual({ ...lunch.structuredContent.expense, id: undefined }, { id: undefined, date: "2026-02-01", amount: 32.5, currency: "CNY", base_amount: 32.5, category: "Lunch", note: "dumplings", scope: "personal" });
  assert.match(lunch.content[0].text, /Recorded CNY 32\.50 · Lunch · 2026-02-01 · dumplings\. Day total CNY 32\.50\./);
  const usd = await call("add_expense", { amount: "12", currency: "usd", category: "Taxi", date: "2026-01-31" });
  assert.equal(usd.structuredContent.expense.fx_rate, 7); assert.equal(usd.structuredContent.day_total, 156);
  assert.equal((await call("add_expense", { amount: 3, currency: "EUR", fx_rate: 7.9 })).structuredContent.expense.base_amount, 23.7);
  const book = stored("tally-book-v1");
  assert.equal(book.records.length, 7); assert.equal(book.quickAddKeyId, "quick-add-key-identifier"); assert.match(book.records[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(revision(), 6);

  for (const args of [{}, { amount: 0 }, { amount: -5 }, { amount: "abc" }, { amount: 5, currency: "RMBX" }, { amount: 5, date: "2026-02-30" }, { amount: 5, fx_rate: -1 },
    { amount: 5, category: "x".repeat(41) }, { amount: 5, vendor: "Shop" }, { amount: true }]) {
    assert.equal((await call("add_expense", args)).isError, true, JSON.stringify(args));
  }
  assert.equal(revision(), 6);

  const offline = fixture({ fetchRate: async () => { throw Object.assign(new Error("Exchange rate is unavailable. Send fxRate, or use your ledger's base currency."), { statusCode: 502, code: "FX_UNAVAILABLE" }); } });
  const noRate = await offline.call("add_expense", { amount: 5, currency: "USD" });
  assert.equal(noRate.isError, true); assert.match(noRate.content[0].text, /fx_rate/);

  const fresh = fixture({ extra: { "tally-book-v1": undefined } });
  delete fresh.store.rows.get(USER).payload["tally-book-v1"];
  assert.match((await fresh.call("list_expenses", {})).content[0].text, /ledger is empty/);
  const first = await fresh.call("add_expense", { amount: 20, currency: "EUR", category: "Books" });
  assert.equal(first.structuredContent.base_currency, "EUR"); assert.match(first.content[0].text, /now uses EUR as its base currency/);
});

test("list_events merges reminders and timed tasks; add_reminder creates the linked pair", async () => {
  const { call, stored, revision } = fixture({ extra: { "todo-app-v2": JSON.stringify({ todos: [
    ...tasksFixture().todos,
    { id: "linked-1", text: "Team standup", completed: false, dueDate: "2026-02-02", dueTime: "10:00", sourceReminderId: "rem-1" },
  ] }) } });
  const events = await call("list_events", { from: "2026-02-01", to: "2026-02-07" });
  assert.deepEqual(events.structuredContent.events.map(event => `${event.type}:${event.id}`), ["task:today-1", "reminder:rem-1", "task:soon-1", "reminder:rem-2"]);
  assert.deepEqual(events.structuredContent.events[1], { type: "reminder", id: "rem-1", date: "2026-02-02", start_time: "10:00", end_time: "10:30", text: "Team standup", priority: "high", task_id: "linked-1", completed: false });
  assert.match(events.content[0].text, /- 2026-02-05 all day Mum's birthday \(reminder · id rem-2\)/);
  for (const args of [{ from: "2026-02-01" }, { from: "2026-02-07", to: "2026-02-01" }, { from: "2026-01-01", to: "2026-04-11" }, { from: "2026-02-01", to: "next week" }]) {
    assert.equal((await call("list_events", args)).isError, true, JSON.stringify(args));
  }
  assert.equal((await call("list_events", { from: "2026-01-01", to: "2026-04-10" })).isError, undefined, "100 days is allowed");

  const added = await call("add_reminder", { text: "Pick up the parcel", date: "2026-02-03", start_time: "18:00", end_time: "18:30" });
  assert.equal(added.isError, undefined); assert.match(added.content[0].text, /Added reminder “Pick up the parcel” on 2026-02-03 at 18:00–18:30\./);
  const calendar = stored("calendar-app-v1"), tasks = stored("todo-app-v2");
  const reminder = calendar.reminders[0], task = tasks.todos[0];
  assert.deepEqual({ text: reminder.text, date: reminder.date, startTime: reminder.startTime, endTime: reminder.endTime, priority: reminder.priority, linkedTodoId: reminder.linkedTodoId },
    { text: "Pick up the parcel", date: "2026-02-03", startTime: "18:00", endTime: "18:30", priority: "medium", linkedTodoId: task.id });
  assert.deepEqual({ text: task.text, dueDate: task.dueDate, dueTime: task.dueTime, sourceReminderId: task.sourceReminderId }, { text: "Pick up the parcel", dueDate: "2026-02-03", dueTime: "18:00", sourceReminderId: reminder.id });
  assert.equal(calendar.selectedDate, "2026-02-01"); assert.equal(calendar.reminders.length, 3);
  assert.equal((await call("list_events", { from: "2026-02-03", to: "2026-02-03" })).structuredContent.events.filter(event => event.text === "Pick up the parcel").length, 1);

  const before = revision();
  for (const args of [{ text: "No date" }, { date: "2026-02-03" }, { text: "Late", date: "2026-02-03", start_time: "18:00", end_time: "17:00" }, { text: "End only", date: "2026-02-03", end_time: "17:00" }, { text: "x".repeat(201), date: "2026-02-03" }]) {
    assert.equal((await call("add_reminder", args)).isError, true, JSON.stringify(args));
  }
  assert.equal(revision(), before);
});

test("compressed stores are read and written back through snapshot-values; damaged stores are never overwritten", async () => {
  const many = { ...tasksFixture(), todos: [...tasksFixture().todos, ...Array.from({ length: 60 }, (_, i) => ({ id: `bulk-${i}`, text: `Archived task number ${i}`, completed: true, dueDate: "2025-06-01" }))] };
  const packed = encodeValue(JSON.stringify(many));
  assert.ok(packed.startsWith(PREFIX));
  const { call, store, stored } = fixture({ extra: { "todo-app-v2": packed } });
  assert.deepEqual((await call("list_tasks", {})).structuredContent.tasks.map(task => task.id), ["today-1", "today-2"]);
  await call("add_task", { text: "Compressed write" });
  assert.ok(store.rows.get(USER).payload["todo-app-v2"].startsWith(PREFIX));
  assert.equal(stored("todo-app-v2").todos.length, 68);

  const damaged = fixture({ extra: { "todo-app-v2": "{not json" } });
  const refused = await damaged.call("add_task", { text: "Would overwrite" });
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /could not read your tasks/);
  assert.equal(damaged.store.rows.get(USER).payload["todo-app-v2"], "{not json");
});

test("a concurrent sync is retried on top of the newer data; a revoked key stops the retry", async () => {
  const { call, store, stored, revision } = fixture();
  store.failNext(2, row => { // Another device adds a task in between.
    const tasks = JSON.parse(row.payload["todo-app-v2"]); tasks.todos.push({ id: "from-phone", text: "Added on the phone", completed: false });
    row.payload = { ...row.payload, "todo-app-v2": JSON.stringify(tasks) };
  });
  const added = await call("add_task", { text: "Added by the assistant" });
  assert.equal(added.isError, undefined);
  const ids = stored("todo-app-v2").todos.map(task => task.id);
  assert.ok(ids.includes("from-phone") && ids.includes(added.structuredContent.task.id)); assert.equal(revision(), 6);

  store.failNext(10);
  const busy = await call("add_task", { text: "Never saved" });
  assert.equal(busy.isError, true); assert.match(busy.content[0].text, /syncing right now/);
  assert.ok(!stored("todo-app-v2").todos.some(task => task.text === "Never saved"));

  const revoked = fixture();
  revoked.store.failNext(1, row => { row.payload = { ...row.payload, "dayfly-connections-v1": JSON.stringify({ version: 1, mcpKeyId: null }) }; });
  const stopped = await revoked.call("add_expense", { amount: 5 });
  assert.equal(stopped.isError, true); assert.match(stopped.content[0].text, /not active/);
  assert.equal(revoked.stored("tally-book-v1").records.length, 4);
});

test("serverOrigins accepts the configured origin and, without one or on loopback, the request's own", () => {
  const request = (host, extra = {}) => ({ headers: { host, ...extra }, socket: {} });
  assert.deepEqual(serverOrigins(request("localhost:3000")), { hostOrigin: "http://localhost:3000", publicOrigin: "http://localhost:3000", allowed: ["http://localhost:3000"] });
  assert.deepEqual(serverOrigins(request("dayfly.example", { "x-forwarded-proto": "https" }), "https://dayfly.example/").allowed, ["https://dayfly.example"]);
  // DNS rebinding: the attacker's name resolves to this server, but it is not the configured origin.
  assert.deepEqual(serverOrigins(request("rebind.attacker.example"), "https://dayfly.example").allowed, ["https://dayfly.example"]);
  assert.deepEqual(serverOrigins(request("127.0.0.1:3000"), "https://dayfly.example").allowed, ["https://dayfly.example", "http://127.0.0.1:3000"]);
  assert.equal(serverOrigins(request("dayfly.example"), "not a url").publicOrigin, "http://dayfly.example");
});

test("HTTP: key creation needs a same-origin session; the endpoint speaks MCP with the key", { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dayfly-mcp-")); const port = 56000 + Math.floor(Math.random() * 3000); const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"], { cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, "db.sqlite"), APP_SESSION_SECRET: "mcp-fixture-secret", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", MAIL_OAUTH_BASE_URL: "", RENDER_EXTERNAL_URL: "" }, stdio: "ignore" });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once("exit", resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false; for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); } assert.equal(ready, true);
  const json = JSON.stringify({ userId: USER, email: USER, provider: "Google", label: "a" });
  const secret = crypto.createHash("sha256").update("mcp-fixture-secret").digest("hex");
  const cookie = `daily_space_session=${Buffer.from(json).toString("base64url")}.${crypto.createHmac("sha256", secret).update(json).digest("base64url")}`;
  const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  assert.equal((await post("/api/mcp/key", {})).status, 401);
  assert.equal((await post("/api/mcp/key", {}, { cookie, origin: "https://evil.example" })).status, 403);
  const issued = await (await post("/api/mcp/key", { timeZone: "Asia/Shanghai" }, { cookie, origin: base })).json();
  assert.ok(issued.token.startsWith("dfm_")); assert.equal(issued.endpoint, `${base}/api/mcp`); assert.equal(issued.pathEndpoint, `${base}/api/mcp/k/${issued.token}`);
  const auth = { authorization: `Bearer ${issued.token}`, accept: "application/json, text/event-stream" };
  const rpc = (body, headers = auth, route = "/api/mcp") => post(route, body, headers);

  const get = await fetch(`${base}/api/mcp`, { headers: auth });
  assert.equal(get.status, 405); assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, {})).status, 401);
  // The session cookie is not a key, and the key is inactive until the synced store carries its identifier.
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { cookie })).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);

  const snapshot = payload => fetch(`${base}/api/user/snapshot`, { method: "PUT", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(payload) });
  assert.equal((await snapshot({ baseRevision: 0, payload: { "dayfly-connections-v1": JSON.stringify({ version: 1, mcpKeyId: issued.keyId }), "todo-app-v2": JSON.stringify({ todos: [], categories: [{ id: "c", name: "Errands" }] }) } })).status, 200);

  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(init.status, 200); assert.match(init.headers.get("content-type"), /^application\/json/); assert.equal(init.headers.get("cache-control"), "no-store");
  assert.equal((await init.json()).result.serverInfo.name, "dayfly");
  const versioned = { ...auth, "mcp-protocol-version": "2025-06-18" };
  const initialized = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, versioned);
  assert.equal(initialized.status, 202); assert.equal(await initialized.text(), "");
  assert.equal((await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, versioned)).json()).result.tools.length, 8);
  const added = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "add_task", arguments: { text: "Buy stamps", category: "errands" } } }, versioned)).json();
  assert.match(added.result.content[0].text, /Added task “Buy stamps”/);
  const viaPath = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_tasks", arguments: { view: "all" } } }, {}, `/api/mcp/k/${issued.token}`)).json();
  assert.equal(viaPath.result.structuredContent.tasks[0].text, "Buy stamps"); assert.equal(viaPath.result.structuredContent.tasks[0].category, "Errands");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 5, method: "ping" }, {}, "/api/mcp/k/dfm_wrong.key")).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 6, method: "ping" }, { ...auth, origin: "https://evil.example" })).status, 403);
  assert.equal((await rpc("{broken", auth)).status, 400);
  const huge = await rpc(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping", params: { pad: "x".repeat(300 * 1024) } }));
  assert.equal(huge.status, 413);

  const current = await (await fetch(`${base}/api/user/snapshot`, { headers: { cookie } })).json();
  assert.equal(current.revision, 2); assert.equal(readStore(current.payload, "todo-app-v2").todos[0].text, "Buy stamps");
  // Turning the connection off on any device revokes the key on its next sync.
  assert.equal((await snapshot({ baseRevision: 2, payload: { ...current.payload, "dayfly-connections-v1": JSON.stringify({ version: 1, mcpKeyId: null }) } })).status, 200);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 8, method: "ping" })).status, 401);
});
