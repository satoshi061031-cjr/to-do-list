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
  assert.ok(trip.some((item) => item.href === "travel.html"));
  const spend = window.DailySpaceSearch.search("ramen");
  assert.ok(spend.some((item) => /Tally/.test(item.hint)));
});
