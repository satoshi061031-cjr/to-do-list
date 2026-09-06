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
  assert.doesNotMatch(welcomeHtml, /WeChat|wechat/);

  const todo = await fetch(`${baseUrl}/todo.html`);
  assert.equal(todo.status, 200);
  const todoHtml = await todo.text();
  assert.match(todoHtml, /evening-review/);
  assert.match(todoHtml, /#today|today/i);
  assert.match(todoHtml, /id="add-form"/);
  assert.doesNotMatch(todoHtml, /id="add-form"[^>]*hidden/);
  assert.match(todoHtml, /workspace-tasks\.js/);

  const todoM = await fetch(`${baseUrl}/todo-m.html`);
  assert.equal(todoM.status, 200);
  const todoMHtml = await todoM.text();
  assert.match(todoMHtml, /id="add-form"/);
  assert.match(todoMHtml, /id="m-agent-toggle"/);
  assert.match(todoMHtml, /id="m-done-toggle"/);
  assert.match(todoMHtml, /id="m-dash-add"|m-dash-add/);
  assert.doesNotMatch(todoMHtml, /id="m-fab-add"/);
  assert.match(todoMHtml, /Today’s tasks|Today's tasks/);
  assert.doesNotMatch(todoMHtml, /Pending/);
  assert.match(todoMHtml, /id="count-text"/);

  const calendar = await fetch(`${baseUrl}/calendar.html`);
  assert.equal(calendar.status, 200);
  const calendarHtml = await calendar.text();
  assert.match(calendarHtml, /id="reminder-form"/);
  assert.match(calendarHtml, /id="week-head"/);
  assert.doesNotMatch(calendarHtml, /id="cal-fab-add"/);
  assert.match(calendarHtml, /Schedule/);

  const tally = await fetch(`${baseUrl}/tally.html`);
  assert.equal(tally.status, 200);
  const tallyHtml = await tally.text();
  assert.match(tallyHtml, /id="tally-quick-form"/);

  const mail = await fetch(`${baseUrl}/mail.html`);
  assert.equal(mail.status, 200);
  const mailHtml = await mail.text();
  assert.match(mailHtml, /Add selected to Today|mail-add-selected/);

  const deleteGate = await fetch(`${baseUrl}/api/user/account`, { method: "DELETE" });
  assert.equal(deleteGate.status, 401);

  const exportGate = await fetch(`${baseUrl}/api/user/export`);
  assert.equal(exportGate.status, 401);

  const travelGate = await fetch(`${baseUrl}/api/travel/trips`);
  assert.equal(travelGate.status, 401);

  const invitePreviewGate = await fetch(`${baseUrl}/api/travel/invites/not-a-token/preview`);
  assert.equal(invitePreviewGate.status, 404);

  function sessionCookie(session) {
    const payloadJson = JSON.stringify(session);
    const payload = Buffer.from(payloadJson, "utf8").toString("base64url");
    const secret = crypto.createHash("sha256").update("phase-c-e2e-secret").digest("hex");
    const signature = crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
    return `daily_space_session=${payload}.${signature}`;
  }

  const outlookTrips = await fetch(`${baseUrl}/api/travel/trips`, {
    headers: {
      cookie: sessionCookie({
        userId: "outlook@example.com",
        email: "outlook@example.com",
        provider: "Outlook",
        label: "Outlook user",
      }),
    },
  });
  assert.equal(outlookTrips.status, 403);
  assert.equal((await outlookTrips.json()).code, "GOOGLE_SESSION_REQUIRED");

  const gmailSession = await fetch(`${baseUrl}/api/travel/trips`, {
    headers: {
      cookie: sessionCookie({
        userId: "gmail@example.com",
        email: "gmail@example.com",
        provider: "Gmail",
        label: "Gmail user",
      }),
    },
  });
  assert.equal(gmailSession.status, 200);

  const googleCookie = sessionCookie({
    userId: "owner@example.com",
    email: "owner@example.com",
    provider: "Google",
    label: "Owner",
  });
  const createdTrip = await fetch(`${baseUrl}/api/travel/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: googleCookie },
    body: JSON.stringify({
      title: "Kyoto",
      data: { destination: "Japan", startDate: "2026-09-10", endDate: "2026-09-13" },
    }),
  });
  assert.equal(createdTrip.status, 201);
  const createdPayload = await createdTrip.json();
  assert.equal(createdPayload.trip.title, "Kyoto");
  assert.equal(createdPayload.trip.revision, 1);

  const inviteCreated = await fetch(
    `${baseUrl}/api/travel/trips/${createdPayload.trip.id}/invites`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: googleCookie },
      body: JSON.stringify({ type: "reusable", baseRevision: 1 }),
    }
  );
  assert.equal(inviteCreated.status, 201);
  const invitePayload = await inviteCreated.json();
  const preview = await fetch(
    `${baseUrl}/api/travel/invites/${invitePayload.invite.token}/preview`
  );
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).invite.tripTitle, "Kyoto");

  const editorCookie = sessionCookie({
    userId: "editor@example.com",
    email: "editor@example.com",
    provider: "Google",
    label: "Editor",
  });
  const accepted = await fetch(`${baseUrl}/api/travel/invites/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: editorCookie },
    body: JSON.stringify({ token: invitePayload.invite.token }),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).trip.role, "editor");

  const imported = await fetch(
    `${baseUrl}/api/travel/trips/${createdPayload.trip.id}/reservations/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: editorCookie },
      body: JSON.stringify({
        reservations: [{ sourceId: "mail:1", data: { kind: "flight", title: "JL 12" } }],
      }),
    }
  );
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).imported.length, 1);

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
