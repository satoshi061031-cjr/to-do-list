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
  let cloud = { revision: 1, payload: { "todo-app-v2": "original" }, updatedAt: "first" };
  const window = { dispatchEvent() {}, location: { reload() {} } };
  const context = vm.createContext({
    window, navigator: { onLine: true }, Blob,
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
      state: () => ({ status: userSnapshotStatus, revision: userSnapshotRevision }) };
    applyTheme(storedTheme());\n\n  if (document.readyState`
  );
  vm.runInContext(source, context);
  return { sync: window.sync, values, requests, context,
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
