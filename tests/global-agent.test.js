const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { normalizeGlobalResult } = require("../server/global-agent");

function createAgentData() {
  const values = new Map();
  const events = [];
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
  const window = {
    dispatchEvent(event) {
      events.push(event);
    },
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
    Array,
    Number,
    String,
    Object,
  });
  const source = fs.readFileSync(path.resolve(__dirname, "../agent-data.js"), "utf8");
  vm.runInContext(source, context);
  return { api: window.DailySpaceAgentData, values, events };
}

test("normalizes allowed cross-domain actions and rejects invalid financial data", () => {
  const result = normalizeGlobalResult({
    reply: "Done",
    actions: [
      {
        type: "tally_add_expense",
        amount: 30,
        category: "Lunch",
        date: "2026-07-13",
      },
      {
        tally_add_expense: {
          amount: 12,
          category: "Coffee",
          date: "2026-07-13",
        },
      },
      {
        type: "tally_add_expense",
        amount: -10,
        category: "Invalid",
        date: "2026-07-13",
      },
      { type: "unknown_action", text: "ignored" },
    ],
  });
  assert.equal(result.actions.length, 2);
  assert.equal(result.actions[0].type, "tally_add_expense");
  assert.equal(result.actions[0].amount, 30);
  assert.equal(result.actions[1].category, "Coffee");
});

test("applies Todo, Tally, Calendar, Planner and Teamwork actions", () => {
  const { api, events } = createAgentData();
  const applied = api.applyActions([
    { type: "todo_add", text: "Buy milk", dueDate: "2026-07-14" },
    {
      type: "tally_add_expense",
      amount: 28.5,
      category: "Lunch",
      date: "2026-07-13",
      note: "Noodles",
    },
    {
      type: "calendar_add_reminder",
      text: "Gym",
      date: "2026-07-14",
      startTime: "08:00",
      priority: "high",
    },
    { type: "planner_add_card", title: "Prepare review", columnTitle: "Next" },
    { type: "teamwork_add_member", name: "Alex", role: "Build" },
    { type: "teamwork_add_task", memberName: "Alex", text: "Ship preview" },
  ]);
  assert.equal(applied.filter((item) => item.ok).length, 6);
  const snapshot = api.getSnapshot();
  assert.equal(snapshot.todo.todos[0].text, "Buy milk");
  assert.equal(snapshot.tally.records[0].amount, 28.5);
  assert.equal(snapshot.calendar.reminders[0].startTime, "08:00");
  assert.equal(
    Object.values(snapshot.planner.boards).flatMap((board) => board.entries)[0].title,
    "Prepare review"
  );
  assert.deepEqual(
    snapshot.teamwork.members.find((member) => member.name === "Alex").tasks,
    ["Ship preview"]
  );
  assert.equal(events.at(-1).type, "daily-space-agent-data-updated");
});

test("requires confirmation for deletes and budget changes", () => {
  const { api } = createAgentData();
  assert.equal(api.needsConfirmation([{ type: "tally_set_budget", budget: 500 }]), true);
  assert.equal(api.needsConfirmation([{ type: "todo_add", text: "Safe" }]), false);
});
