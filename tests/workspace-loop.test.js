const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { sanitizeSnapshotPayload } = require("../server/user-snapshot-store");

function loadScript(filename, extra = {}) {
  const values = extra.values || new Map();
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
  class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }
  const window = extra.window || {
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window,
    document: extra.document,
    localStorage,
    CustomEvent,
    crypto,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Array,
    Number,
    String,
    Object,
    Boolean,
  });
  window.localStorage = localStorage;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", filename), "utf8"), context);
  return { window, values };
}

test("personal travel snapshots are accepted for cloud sync", () => {
  const payload = sanitizeSnapshotPayload({
    "travel-book-v1": JSON.stringify({ trips: [] }),
    "travel-shared-v1": JSON.stringify({ mappings: {} }),
    unexpected: "nope",
  });
  assert.equal(Boolean(payload["travel-book-v1"]), true);
  assert.equal(Boolean(payload["travel-shared-v1"]), true);
  assert.equal(payload.unexpected, undefined);
});

test("completing a weekly task creates the next occurrence", () => {
  const { window, values } = loadScript("agent-data.js");
  const api = window.DailySpaceAgentData;
  api.applyActions([
    { type: "todo_add", text: "Water plants", dueDate: "2026-08-17", repeat: "weekly" },
  ]);
  const first = api.getSnapshot().todo.todos[0];
  api.applyActions([{ type: "todo_complete", todoId: first.id }]);
  const todos = api.getSnapshot().todo.todos;
  assert.equal(todos.length, 2);
  const open = todos.find((item) => !item.completed);
  const done = todos.find((item) => item.completed);
  assert.equal(done.text, "Water plants");
  assert.equal(open.dueDate, "2026-08-24");
  assert.equal(open.repeat, "weekly");
  assert.equal(values.get("todo-app-v2").includes("Water plants"), true);
});

test("calendar reminders and planner due cards become todos", () => {
  const values = new Map();
  values.set(
    "calendar-app-v1",
    JSON.stringify({
      version: 1,
      reminders: [{ id: "rem-1", date: "2026-08-17", text: "Dentist", startTime: "15:00", endTime: "16:00" }],
    })
  );
  values.set(
    "planner-app-v1",
    JSON.stringify({
      version: 2,
      planners: [{ id: "p1", name: "Work" }],
      boards: {
        p1: {
          columns: [{ id: "c1", title: "Planned" }],
          entries: [{ id: "card-1", columnId: "c1", title: "Ship landing", dueDate: "2026-08-17", completed: false }],
        },
      },
    })
  );
  values.set("todo-app-v2", JSON.stringify({ todos: [], categories: [], selectedCategoryKey: "__all__" }));
  const { window } = loadScript("workspace-tasks.js", { values });
  const result = window.DailySpaceTasks.syncLinkedWork({ silent: true });
  assert.equal(result.changed, true);
  const todos = JSON.parse(values.get("todo-app-v2")).todos;
  assert.ok(todos.some((item) => item.sourceReminderId === "rem-1" && item.dueTime === "15:00"));
  assert.ok(todos.some((item) => item.sourcePlannerId === "card-1" && item.dueDate === "2026-08-17"));
  assert.equal(window.DailySpaceTasks.guestHasWorkspaceData(), true);
});

test("workspace search finds todos, trips, and expenses", () => {
  const values = new Map();
  values.set(
    "todo-app-v2",
    JSON.stringify({ todos: [{ id: "t1", text: "Pack camera", completed: false, dueDate: "2026-08-18" }] })
  );
  values.set(
    "travel-book-v1",
    JSON.stringify({ trips: [{ id: "trip-1", name: "Kyoto", destination: "Japan" }] })
  );
  values.set(
    "tally-book-v1",
    JSON.stringify({ records: [{ id: "r1", category: "Lunch", note: "Ramen", date: "2026-08-17", amount: 12 }] })
  );
  const { window } = loadScript("workspace-search.js", { values });
  const camera = window.DailySpaceSearch.search("camera");
  assert.ok(camera.some((item) => item.label === "Pack camera"));
  const trip = window.DailySpaceSearch.search("kyoto");
  assert.ok(trip.some((item) => item.href === "travel.html?focus=trip&id=trip-1"));
  const spend = window.DailySpaceSearch.search("ramen");
  assert.ok(spend.some((item) => /Tally/.test(item.hint)));
});


test("search exposes source records once and keeps tasks whose source was removed", () => {
  const values = new Map([
    ["todo-app-v2", JSON.stringify({ todos: [
      { id: "linked-reminder", text: "Linked appointment", sourceReminderId: "r1" },
      { id: "linked-card", text: "Linked project", sourcePlannerId: "c1" },
      { id: "orphan", text: "Removed source task", sourceReminderId: "deleted" },
      { id: "a&b /中文", text: "Encoded destination" },
    ] })],
    ["calendar-app-v1", JSON.stringify({ reminders: [{ id: "r1", text: "Linked appointment" }] })],
    ["planner-app-v1", JSON.stringify({ boards: { "board&1": { entries: [{ id: "c1", title: "Linked project" }] } } })],
  ]);
  const { window } = loadScript("workspace-search.js", { values });
  const search = window.DailySpaceSearch;
  assert.equal(search.search("Linked appointment").length, 1);
  assert.match(search.search("Linked appointment")[0].href, /^calendar\.html\?focus=reminder&id=r1$/);
  assert.equal(search.search("Linked project").length, 1);
  assert.match(search.search("Linked project")[0].href, /board=board%261/);
  assert.equal(search.search("Removed source task").length, 1);
  assert.ok(search.search("Encoded destination")[0].href.includes(encodeURIComponent("a&b /中文")));
  values.set("calendar-app-v1", JSON.stringify({ reminders: [] }));
  assert.match(search.search("Linked appointment")[0].href, /focus=todo/);
});

test('rescheduling linked work updates source dates and preserves task notes and checklist', () => {
  const values = new Map([
    ['todo-app-v2', JSON.stringify({ categories: [], todos: [
      { id: 't1', text: 'Appointment', dueDate: '2026-10-15', dueTime: '11:00', completed: false, sourceReminderId: 'r1', notes: 'Keep note', subtasks: [{ id: 's1', text: 'Prepare', completed: true }] },
      { id: 't2', text: 'Project', dueDate: '2026-10-15', completed: false, sourcePlannerId: 'c1' },
    ] })],
    ['calendar-app-v1', JSON.stringify({ reminders: [{ id: 'r1', text: 'Appointment', date: '2026-10-14', startTime: '09:00', endTime: '10:00', remindAt: 1 }] })],
    ['planner-app-v1', JSON.stringify({ boards: { b1: { columns: [], entries: [{ id: 'c1', title: 'Project', dueDate: '2026-10-14', completed: false }] } } })],
  ]);
  const { window } = loadScript('workspace-tasks.js', { values });
  window.DailySpaceTasks.syncLinkedWork({ from: 'todo', silent: true });
  const reminder = JSON.parse(values.get('calendar-app-v1')).reminders[0];
  assert.equal(reminder.date, '2026-10-15'); assert.equal(reminder.startTime, '11:00'); assert.equal(reminder.endTime, '12:00'); assert.equal(reminder.remindAt, null);
  assert.equal(JSON.parse(values.get('planner-app-v1')).boards.b1.entries[0].dueDate, '2026-10-15');
  const task = JSON.parse(values.get('todo-app-v2')).todos[0]; assert.equal(task.notes, 'Keep note'); assert.equal(task.subtasks[0].completed, true);
});

test('local reminder postponement survives linked-task synchronization and never writes to the server', async () => {
  const values = new Map([
    ['todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'task', text: 'Appointment', dueDate: '2026-10-14', dueTime: '11:00', completed: false, sourceReminderId: 'r1' }] })],
    ['calendar-app-v1', JSON.stringify({ reminders: [{ id: 'r1', text: 'Appointment', date: '2026-10-14', startTime: '11:00', linkedTodoId: 'task' }] })],
  ]);
  const document = { querySelectorAll: () => [] };
  const { window } = loadScript('reminder-client.js', { values, document });
  const before = Date.now(); await window.DailySpaceReminders.defer('reminder', 'r1', 10);
  const reminder = JSON.parse(values.get('calendar-app-v1')).reminders[0]; const task = JSON.parse(values.get('todo-app-v2')).todos[0];
  assert.ok(reminder.remindAt >= before + 600000); assert.equal(task.remindAt, reminder.remindAt);
  loadScript('workspace-tasks.js', { values, window }); window.DailySpaceTasks.syncLinkedWork({ from: 'todo', silent: true });
  assert.equal(JSON.parse(values.get('calendar-app-v1')).reminders[0].remindAt, task.remindAt);
});


test('assistant context bounds rich task details without truncating stored notes', () => {
  const values = new Map([['todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'rich', text: 'Rich task', dueDate: '2026-10-14', completed: false, notes: 'n'.repeat(10000), subtasks: Array.from({ length: 20 }, (_, index) => ({ id: `s${index}`, text: 'x'.repeat(500), completed: false })) }] })]]);
  const { window } = loadScript('task-fields.js', { values }); loadScript('agent-data.js', { values, window });
  const task = window.DailySpaceAgentData.getSnapshot().todo.todos[0];
  assert.equal(task.notes.length, 500); assert.equal(task.subtasks.length, 8); assert.equal(task.subtasks[0].text.length, 120);
  window.DailySpaceAgentData.applyActions([{ type: 'todo_update', todoId: 'rich', text: 'Renamed rich task' }]);
  const stored = JSON.parse(values.get('todo-app-v2')).todos[0]; assert.equal(stored.notes.length, 10000); assert.equal(stored.subtasks.length, 20);
});
