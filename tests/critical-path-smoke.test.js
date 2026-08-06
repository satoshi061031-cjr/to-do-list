const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { summarizeInboxMessages, fallbackDigest } = require("../server/mail-digest");

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

test("critical path: add today’s task lands in Todo with due date", () => {
  const today = todayIso();
  const { api } = createAgentData();
  const applied = api.applyActions([{ type: "todo_add", text: "Focus block", dueDate: today }]);
  assert.equal(applied[0].ok, true);
  const todos = api.getSnapshot().todo.todos;
  assert.equal(todos.length, 1);
  assert.equal(todos[0].text, "Focus block");
  assert.equal(todos[0].dueDate, today);
  assert.equal(todos[0].completed, false);
});

test("critical path: today’s Todo is calendar-visible by dueDate", () => {
  const today = todayIso();
  const { api, values } = createAgentData();
  api.applyActions([
    { type: "todo_add", text: "Ship reliability", dueDate: today },
    { type: "todo_add", text: "Later", dueDate: "2099-01-01" },
  ]);

  const raw = values.get("todo-app-v2");
  assert.ok(raw);
  const store = JSON.parse(raw);
  const dueToday = (store.todos || []).filter((todo) => todo.dueDate === today);
  assert.equal(dueToday.length, 1);
  assert.equal(dueToday[0].text, "Ship reliability");

  // Calendar reads the same localStorage key and filters with dueDate === selected day.
  const calendarVisible = dueToday.map((todo) => ({
    id: todo.id,
    text: todo.text,
    dueDate: todo.dueDate,
    completed: Boolean(todo.completed),
  }));
  assert.equal(calendarVisible[0].dueDate, today);
});

test("critical path: mail → Add as today’s task shape", () => {
  const today = todayIso();
  const { api } = createAgentData();
  const mailSubject = "Invoice due Friday";
  const sourceMailId = "mail:acct:msg-1";
  const applied = api.applyActions([
    {
      type: "todo_add",
      text: mailSubject,
      dueDate: today,
      sourceMailId,
    },
  ]);
  assert.equal(applied[0].ok, true);
  const todo = api.getSnapshot().todo.todos[0];
  assert.equal(todo.text, mailSubject);
  assert.equal(todo.dueDate, today);
  assert.equal(todo.sourceMailId, sourceMailId);

  const dup = api.applyActions([
    {
      type: "todo_add",
      text: "Duplicate from same mail",
      dueDate: today,
      sourceMailId,
    },
  ]);
  assert.equal(dup[0].ok, false);
  assert.equal(api.getSnapshot().todo.todos.filter((item) => item.sourceMailId === sourceMailId).length, 1);
});

test("mail digest fallback reports readable reasons", async () => {
  const empty = await summarizeInboxMessages([], "2026-07-21");
  assert.equal(empty.summarized, false);
  assert.equal(empty.fallbackReason, "empty");

  const snippet = fallbackDigest(
    [{ id: "m1", subject: "Hello", snippet: "Please reply today" }],
    "llm_failed"
  );
  assert.equal(snippet.summarized, false);
  assert.equal(snippet.fallbackReason, "llm_failed");
  assert.match(snippet.summaries.m1, /Please reply/);

  const previousKey = process.env.GROQ_API_KEY;
  const previousOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const unconfigured = await summarizeInboxMessages(
      [{ id: "m2", subject: "Ping", snippet: "hi" }],
      "2026-07-21"
    );
    assert.equal(unconfigured.summarized, false);
    assert.equal(unconfigured.fallbackReason, "agent_not_configured");
  } finally {
    if (previousKey != null) process.env.GROQ_API_KEY = previousKey;
    else delete process.env.GROQ_API_KEY;
    if (previousOpenAi != null) process.env.OPENAI_API_KEY = previousOpenAi;
    else delete process.env.OPENAI_API_KEY;
  }
});
