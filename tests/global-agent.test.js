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

test("applies Todo, Tally, Calendar, Planner actions; rejects local Teamwork drafts", () => {
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
  assert.equal(applied.filter((item) => item.ok).length, 4);
  assert.equal(applied.filter((item) => item.type.startsWith("teamwork_") && item.ok === false).length, 2);
  const snapshot = api.getSnapshot();
  assert.equal(snapshot.todo.todos[0].text, "Buy milk");
  assert.equal(snapshot.tally.records[0].amount, 28.5);
  assert.equal(snapshot.calendar.reminders[0].startTime, "08:00");
  assert.equal(
    Object.values(snapshot.planner.boards).flatMap((board) => board.entries)[0].title,
    "Prepare review"
  );
  assert.equal(events.at(-1).type, "daily-space-agent-data-updated");
});

test("normalizes flexible clock times and keeps dueTime on todos", () => {
  const { normalizeGlobalResult } = require("../server/global-agent");
  const result = normalizeGlobalResult(
    {
      reply: "ok",
      actions: [
        {
          type: "calendar_add_reminder",
          text: "Call mom",
          date: "2026-07-24",
          startTime: "3:00 PM",
          priority: "medium",
        },
        {
          type: "todo_add",
          text: "Submit report",
          dueDate: "2026-07-24",
          dueTime: "15:00:00",
        },
      ],
    },
    "2026-07-24"
  );
  assert.equal(result.actions[0].startTime, "15:00");
  assert.equal(result.actions[1].dueTime, "15:00");

  const { api } = createAgentData();
  const applied = api.applyActions(result.actions);
  assert.equal(applied.filter((item) => item.ok).length, 2);
  const snapshot = api.getSnapshot();
  assert.equal(snapshot.calendar.reminders[0].startTime, "15:00");
  assert.equal(snapshot.todo.todos[0].dueTime, "15:00");
  assert.match(applied[0].label, /15:00/);
  assert.match(applied[1].label, /15:00/);
});

test("requires confirmation for deletes and budget changes", () => {
  const { api } = createAgentData();
  assert.equal(api.needsConfirmation([{ type: "tally_set_budget", budget: 500 }]), true);
  assert.equal(api.needsConfirmation([{ type: "todo_add", text: "Safe" }]), false);
});

test("preserves a custom Tally currency in snapshots and Agent results", () => {
  const { api, values } = createAgentData();
  values.set(
    "tally-book-v1",
    JSON.stringify({ version: 1, budget: 1200, currency: "USD", records: [] })
  );
  const applied = api.applyActions([
    {
      type: "tally_add_expense",
      amount: 12.5,
      category: "Coffee",
      date: "2026-07-14",
    },
  ]);
  assert.equal(api.getSnapshot().tally.currency, "USD");
  assert.match(applied[0].label, /USD 12\.50/);
});
