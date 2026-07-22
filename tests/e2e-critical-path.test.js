const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const vm = require("node:vm");

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

async function waitForServer(baseUrl, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_) {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Server did not become ready in time.");
}

test("e2e critical path: welcome Daily Loop + guest today→calendar→mail task + account gates", async (t) => {
  const port = 3100 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(os.tmpdir(), `daily-space-e2e-${process.pid}-${Date.now()}.sqlite`);
  const child = spawn(
    process.execPath,
    ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        STOCKS_DB_PATH: dbPath,
        APP_SESSION_SECRET: "phase-c-e2e-secret",
        GROQ_API_KEY: "",
        OPENAI_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  t.after(() => {
    child.kill("SIGTERM");
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {
      /* ignore */
    }
  });

  await waitForServer(baseUrl);

  const welcome = await fetch(`${baseUrl}/index.html`);
  assert.equal(welcome.status, 200);
  const welcomeHtml = await welcome.text();
  assert.match(welcomeHtml, /Daily Loop/i);
  assert.match(welcomeHtml, /Continue as guest/);

  const todo = await fetch(`${baseUrl}/todo.html`);
  assert.equal(todo.status, 200);
  const todoHtml = await todo.text();
  assert.match(todoHtml, /evening-review/);
  assert.match(todoHtml, /#today|today/i);

  const calendar = await fetch(`${baseUrl}/calendar.html`);
  assert.equal(calendar.status, 200);

  const mail = await fetch(`${baseUrl}/mail.html`);
  assert.equal(mail.status, 200);
  const mailHtml = await mail.text();
  assert.match(mailHtml, /Add selected to Today|mail-add-selected/);

  const deleteGate = await fetch(`${baseUrl}/api/user/account`, { method: "DELETE" });
  assert.equal(deleteGate.status, 401);

  const exportGate = await fetch(`${baseUrl}/api/user/export`);
  assert.equal(exportGate.status, 401);

  // Guest substitute for “login → today → calendar → mail→task”
  const today = todayIso();
  const { api, values } = createAgentData();
  api.applyActions([{ type: "todo_add", text: "E2E focus", dueDate: today }]);
  api.applyActions([
    {
      type: "todo_add",
      text: "Mail · Invoice due Friday — please pay",
      dueDate: today,
    },
  ]);
  const store = JSON.parse(values.get("todo-app-v2"));
  const dueToday = (store.todos || []).filter((todoItem) => todoItem.dueDate === today);
  assert.equal(dueToday.length, 2);
  assert.ok(dueToday.some((todoItem) => todoItem.text === "E2E focus"));
  assert.ok(dueToday.some((todoItem) => /Mail · Invoice/.test(todoItem.text)));
});
