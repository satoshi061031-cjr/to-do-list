const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function client() {
  const values = new Map([["daily-space-auth-v1", JSON.stringify({
    provider: "Google", label: "Alice", email: "alice@example.com",
  })]]);
  const requests = [];
  const events = [], timers = new Map();
  let timerId = 0;
  let cloud = { revision: 1, payload: { "todo-app-v2": "original" }, updatedAt: "first" };
  const window = { dispatchEvent(event) { events.push(event); }, location: { reload() {} }, setInterval: () => 1, clearInterval() {} };
  const context = vm.createContext({
    window, navigator: { onLine: true }, Blob, AbortController,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    document: { readyState: "loading", hidden: false, documentElement: { dataset: {} },
      getElementById: () => null, querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    fetch: async (_, options) => {
      requests.push(options);
      if (options.method === "GET") return { ok: true, json: async () => structuredClone(cloud) };
      const body = JSON.parse(options.body);
      if (body.baseRevision !== cloud.revision) {
        return { ok: false, status: 409, json: async () => ({ code: "SNAPSHOT_CONFLICT", error: "Conflict" }) };
      }
      cloud = { revision: cloud.revision + 1, payload: body.payload, updatedAt: "next" };
      return { ok: true, json: async () => ({ ok: true, ...structuredClone(cloud) }) };
    },
  });
  // Expose the real controller functions only in this VM; production globals stay unchanged.
  const source = fs.readFileSync(path.resolve(__dirname, "../theme.js"), "utf8").replace(
    "\n  applyTheme(storedTheme());\n\n  if (document.readyState",
    `\n  window.sync = { load: loadSnapshotForCurrentUser, tick: userSnapshotTick,
      flush: flushUserSnapshotOnPageHide, keepLocal: keepLocalSnapshotOverCloud,
      useCloud: applyCloudSnapshotPreferringRemote,
      refresh: refreshUserSnapshotSession,
      state: () => ({ status: userSnapshotStatus, revision: userSnapshotRevision }) };
    applyTheme(storedTheme());\n\n  if (document.readyState`
  );
  vm.runInContext(source, context);
  return { sync: window.sync, values, requests, context, events, timers,
    changeCloud: payload => { cloud = { ...cloud, payload, revision: cloud.revision + 1 }; } };
}

test("client keeps local edits when another device advances the cloud revision", async () => {
  const c = client();
  await c.sync.load();
  c.values.set("todo-app-v2", "local edits");
  c.changeCloud({ "todo-app-v2": "other device" });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "local edits");
  const count = c.requests.length;
  await c.sync.tick(); c.sync.flush();
  assert.equal(c.requests.length, count, "conflicts stop automatic writes");
  await c.sync.keepLocal();
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.sync.state().revision, 3);
  assert.equal(JSON.parse(c.requests.at(-1).body).baseRevision, 2);
});

test("cloud selection applies current data and the next edit uses its revision", async () => {
  const c = client();
  await c.sync.load();
  c.changeCloud({ "todo-app-v2": "remote" });
  await c.sync.useCloud();
  assert.equal(c.values.get("todo-app-v2"), "remote");
  c.values.set("todo-app-v2", "next edit");
  await c.sync.tick();
  assert.equal(JSON.parse(c.requests.at(-1).body).baseRevision, 2);
  assert.equal(c.sync.state().revision, 3);
});

test("page-hide writes detect conflict and unknown revisions never write", async () => {
  const c = client();
  c.values.set("todo-app-v2", "offline");
  c.sync.flush();
  assert.equal(c.requests.length, 0);
  await c.sync.load();
  c.values.set("todo-app-v2", "local");
  c.changeCloud({ "todo-app-v2": "remote" });
  c.sync.flush(); c.sync.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.requests.filter(r => r.method === "PUT").length, 1);
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "local");
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test("idle desktop pulls phone updates and removes deleted domains without reloading", async () => {
  const c = client();
  await c.sync.load();
  c.changeCloud({ "calendar-app-v1": "phone calendar" });
  await c.sync.tick();
  assert.equal(c.values.get("todo-app-v2"), undefined);
  assert.equal(c.values.get("calendar-app-v1"), "phone calendar");
  assert.equal(c.sync.state().status, "ok");
  const update = c.events.findLast(event => event.type === "daily-space-agent-data-updated");
  assert.ok(update.detail.domains.includes("todo") && update.detail.domains.includes("calendar"));
});

test("cloud updates wait for an active editor and never overwrite edits during a slow read", async () => {
  const c = client(); await c.sync.load();
  c.context.document.activeElement = { matches: () => true, value: "Unfinished draft" };
  c.changeCloud({ "todo-app-v2": "phone" });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "remote-pending");
  assert.equal(c.values.get("todo-app-v2"), "original");
  c.context.document.activeElement = null;
  await c.sync.tick();
  assert.equal(c.values.get("todo-app-v2"), "phone");
  let release;
  c.context.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = c.sync.tick();
  c.values.set("todo-app-v2", "typed while loading");
  release({ ok: true, json: async () => ({ revision: 3, updatedAt: "latest", payload: { "todo-app-v2": "new phone edit" } }) });
  await pending;
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "typed while loading");
});

test("local-only offline edits upload on reload and changes during a write remain pending", async () => {
  const c = client(); await c.sync.load();
  c.values.set("todo-app-v2", "offline edit");
  await c.sync.load();
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.values.get("todo-app-v2"), "offline edit");
  const fetch = c.context.fetch;
  let release;
  c.context.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (options.method === "PUT") await new Promise(resolve => { release = resolve; });
    return response;
  };
  c.values.set("todo-app-v2", "submitted edit");
  const pending = c.sync.tick(); await settle();
  c.values.set("todo-app-v2", "later edit"); release(); await pending;
  assert.equal(c.values.get("todo-app-v2"), "later edit");
  c.context.fetch = fetch;
  await c.sync.tick();
  assert.equal(JSON.parse(c.requests.at(-1).body).payload["todo-app-v2"], "later edit");
});

test("expired sessions stop automatic writes, preserve local data and recover after reauthentication", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  c.values.set("todo-app-v2", "private unsynced edit");
  c.context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Please sign in first." }) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "auth-required");
  assert.equal(c.timers.size, 0);
  assert.equal(c.values.get("todo-app-v2"), "private unsynced edit");
  assert.ok(c.values.has("daily-space-auth-v1"));
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "auth-required");
  await c.sync.refresh(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(JSON.parse(c.requests.at(-1).body).payload["todo-app-v2"], "private unsynced edit");
});

test("temporary failures back off and a lost write acknowledgment reconciles without conflict", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  c.context.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "unavailable");
  assert.equal([...c.timers.values()][0].delay, 5000);
  await c.sync.tick(true);
  assert.equal([...c.timers.values()][0].delay, 10000);
  c.context.fetch = fetch;
  const retry = [...c.timers.entries()].find(([,timer])=>timer.delay===10000);
  c.timers.delete(retry[0]); retry[1].fn(); await settle();
  assert.equal(c.sync.state().status,"ok","Scheduled retries resume without a manual click");
  c.context.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (options.method === "PUT") throw new TypeError("Connection dropped after commit");
    return response;
  };
  c.values.set("todo-app-v2", "saved despite lost reply");
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "error");
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.timers.size, 0);
  assert.equal(c.values.get("todo-app-v2"), "saved despite lost reply");
});

test("bounded requests time out even when fetch ignores abort and ignore their late replies", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  let release;
  c.context.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = c.sync.tick();
  const deadline = [...c.timers.entries()].find(([, timer]) => timer.delay === 20000);
  c.timers.delete(deadline[0]); deadline[1].fn(); await pending;
  assert.equal(c.sync.state().status, "timeout");
  release({ ok: true, json: async () => ({ revision: 99, updatedAt: "late", payload: { "todo-app-v2": "late data" } }) });
  await settle();
  assert.equal(c.values.get("todo-app-v2"), "original");
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.sync.state().revision, 1);
});

test("account generations ignore late success and errors even after switching away and back", async () => {
  for (const success of [true, false]) {
    const c = client(); await c.sync.load();
    const fetch = c.context.fetch;
    let release;
    c.context.fetch = () => new Promise(resolve => { release = resolve; });
    const pending = c.sync.tick();
    c.values.set("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Bob", email: "bob@example.com" }));
    c.context.fetch = fetch; await c.sync.refresh(true);
    c.values.set("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Alice", email: "alice@example.com" }));
    await c.sync.refresh(true);
    release({ ok: success, status: success ? 200 : 401, json: async () => ({ revision: 99, updatedAt: "late", payload: { "todo-app-v2": "wrong account response" } }) });
    await pending; await settle();
    assert.equal(c.values.get("todo-app-v2"), "original");
    assert.equal(c.sync.state().status, "ok");
    assert.equal(c.sync.state().revision, 1);
  }
});

test("invalid successful responses are rejected and an oversized local snapshot never uploads", async () => {
  const c = client(); await c.sync.load();
  c.context.fetch = async () => ({ ok: true, json: async () => ({}) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "unavailable");
  c.values.set("todo-app-v2", "x".repeat(1024 * 1024));
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "too-large");
  assert.equal(c.timers.size, 0);
  assert.ok(c.values.get("todo-app-v2").length >= 1024 * 1024);
});

test("an empty second account clears the first account's data before any automatic upload", async () => {
  const c=client(); await c.sync.load();
  c.values.set('todo-app-v2','Alice private pending edit');
  c.values.set('daily-space-auth-v1',JSON.stringify({provider:'Google',label:'Bob',email:'bob@example.com'}));
  let puts=0;
  c.context.fetch=async (_, options)=>{
    if(options.method==='PUT') puts++;
    return {ok:true,json:async()=>({revision:0,payload:{},updatedAt:null,userId:'bob@example.com'})};
  };
  await c.sync.refresh(true); await c.sync.tick();
  assert.equal(c.values.get('todo-app-v2'),undefined);
  assert.equal(puts,0);
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:alice@example.com'))['todo-app-v2'],'Alice private pending edit');
});
