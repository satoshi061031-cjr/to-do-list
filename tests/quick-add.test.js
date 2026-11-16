const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createQuickAdd, parseAmount, dateInZone } = require("../server/quick-add");

function memoryStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  let conflictsLeft = 0;
  return {
    rows, failNext(count) { conflictsLeft = count; },
    async getSnapshot(userId) { const row = rows.get(userId); return row ? { payload: { ...row.payload }, revision: row.revision } : null; },
    async upsertSnapshot(userId, payload, baseRevision) {
      const row = rows.get(userId);
      if (conflictsLeft > 0 || (row?.revision || 0) !== baseRevision) {
        if (conflictsLeft > 0) { conflictsLeft -= 1; if (row) row.revision += 1; }
        throw Object.assign(new Error("conflict"), { statusCode: 409, code: "SNAPSHOT_CONFLICT" });
      }
      rows.set(userId, { payload, revision: baseRevision + 1 }); return { userId, revision: baseRevision + 1 };
    },
  };
}
const book = (store, user = "a@example.test") => JSON.parse(store.rows.get(user).payload["tally-book-v1"]);
function fixture({ keyId, extra = {} } = {}) {
  const store = memoryStore();
  const quick = createQuickAdd({ getSecret: () => "fixture-secret", getSnapshotStore: () => store, fetchRate: async () => 7, now: () => Date.UTC(2026, 0, 31, 23, 30) });
  const issued = quick.issueKey("A@example.test", "Asia/Shanghai");
  store.rows.set("a@example.test", { revision: 3, payload: { "todo-app-v2": "{\"todos\":[]}", "tally-book-v1": JSON.stringify({ baseCurrency: "CNY", records: [{ id: "old", date: "2026-01-30", amount: 10, category: "Tea" }], quickAddKeyId: keyId === undefined ? issued.keyId : keyId, ...extra }) } });
  return { store, quick, issued, auth: `Bearer ${issued.token}` };
}

test("amount and date helpers accept what a Shortcut sends", () => {
  assert.equal(parseAmount(32), 32); assert.equal(parseAmount(" ¥1,280.5 "), 1280.5);
  assert.ok(Number.isNaN(parseAmount("abc"))); assert.ok(Number.isNaN(parseAmount("-5"))); assert.ok(Number.isNaN(parseAmount(null)));
  assert.equal(dateInZone(Date.UTC(2026, 0, 31, 23, 30), "Asia/Shanghai"), "2026-02-01");
  assert.equal(dateInZone(Date.UTC(2026, 0, 31, 23, 30), null), "2026-01-31");
});

test("a valid key records an expense into the synced ledger and keeps other data", async () => {
  const { store, quick, auth } = fixture();
  const result = await quick.addExpense({ authorization: auth, body: { amount: "32", category: "Lunch", note: "noodles" } });
  assert.equal(result.ok, true); assert.equal(result.duplicate, false);
  // No date sent: "today" follows the time zone captured when the key was created.
  assert.deepEqual({ ...result.record, id: undefined }, { id: undefined, date: "2026-02-01", amount: 32, currency: "CNY", category: "Lunch", note: "noodles" });
  const saved = book(store);
  assert.equal(saved.records.length, 2); assert.equal(saved.records[0].category, "Lunch"); assert.equal(saved.records[0].scope, "personal");
  assert.equal(saved.records[1].id, "old"); assert.ok(saved.quickAddKeyId);
  assert.equal(store.rows.get("a@example.test").revision, 4);
  assert.equal(store.rows.get("a@example.test").payload["todo-app-v2"], "{\"todos\":[]}");
});

test("amount alone is saved as Other; explicit date, foreign currency and repeated ids are handled", async () => {
  const { store, quick, auth } = fixture();
  assert.equal((await quick.addExpense({ authorization: auth, body: { amount: 5 } })).record.category, "Other");
  const foreign = await quick.addExpense({ authorization: auth, body: { amount: 10, currency: "usd", date: "2026-01-15", id: "shortcut-1" } });
  assert.equal(foreign.record.currency, "USD"); assert.equal(foreign.record.date, "2026-01-15");
  assert.equal(book(store).records[0].fxRate, 7);
  const again = await quick.addExpense({ authorization: auth, body: { amount: 10, currency: "USD", id: "shortcut-1" } });
  assert.equal(again.duplicate, true); assert.equal(book(store).records.length, 3);
});

test("invalid input is rejected without writing", async () => {
  const { store, quick, auth } = fixture();
  for (const body of [{}, { amount: 0 }, { amount: "abc" }, { amount: 5, date: "2026-02-30" }, { amount: 5, currency: "RMBX" }, { amount: 5, id: "bad id!" }, { amount: 5, currency: "USD", fxRate: -1 }]) {
    await assert.rejects(quick.addExpense({ authorization: auth, body }), error => error.statusCode === 400);
  }
  assert.equal(book(store).records.length, 1); assert.equal(store.rows.get("a@example.test").revision, 3);
});

test("missing, forged, replaced and cleared keys are refused", async () => {
  const { quick, issued } = fixture();
  const body = { amount: 5 };
  await assert.rejects(quick.addExpense({ body }), error => error.statusCode === 401);
  await assert.rejects(quick.addExpense({ authorization: `Bearer ${issued.token.slice(0, -2)}xx`, body }), error => error.statusCode === 401);
  const other = createQuickAdd({ getSecret: () => "another-secret", getSnapshotStore: () => memoryStore() }).issueKey("a@example.test");
  await assert.rejects(quick.addExpense({ authorization: `Bearer ${other.token}`, body }), error => error.statusCode === 401);
  for (const keyId of [null, "someone-elses-key-identifier"]) {
    const stale = fixture({ keyId });
    await assert.rejects(stale.quick.addExpense({ authorization: stale.auth, body }), error => error.code === "QUICK_ADD_KEY_INACTIVE");
    assert.equal(book(stale.store).records.length, 1);
  }
  // A key never works for an account that has no ledger.
  const empty = createQuickAdd({ getSecret: () => "fixture-secret", getSnapshotStore: () => memoryStore() });
  await assert.rejects(empty.addExpense({ authorization: `Bearer ${empty.issueKey("b@example.test").token}`, body }), error => error.statusCode === 401);
});

test("a concurrent sync is retried on top of the newer data, and requests are rate limited", async () => {
  const { store, quick, auth } = fixture();
  store.failNext(2);
  assert.equal((await quick.addExpense({ authorization: auth, body: { amount: 8 } })).ok, true);
  assert.equal(book(store).records.length, 2);
  store.failNext(10);
  await assert.rejects(quick.addExpense({ authorization: auth, body: { amount: 8 } }), error => error.statusCode === 503);
  const limited = fixture();
  for (let i = 0; i < 30; i += 1) await limited.quick.addExpense({ authorization: limited.auth, body: { amount: 1 } });
  await assert.rejects(limited.quick.addExpense({ authorization: limited.auth, body: { amount: 1 } }), error => error.statusCode === 429 && error.retryAfter > 0);
});

test("HTTP routes: key creation needs a same-origin session, quick add needs the key", { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dayfly-quick-add-")); const port = 54000 + Math.floor(Math.random() * 3000); const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"], { cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, "db.sqlite"), APP_SESSION_SECRET: "quick-add-fixture-secret", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, stdio: "ignore" });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once("exit", resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false; for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); } assert.equal(ready, true);
  const json = JSON.stringify({ userId: "a@example.test", email: "a@example.test", provider: "Google", label: "a" });
  const secret = crypto.createHash("sha256").update("quick-add-fixture-secret").digest("hex");
  const cookie = `daily_space_session=${Buffer.from(json).toString("base64url")}.${crypto.createHmac("sha256", secret).update(json).digest("base64url")}`;
  const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  assert.equal((await post("/api/tally/quick-add/key", {})).status, 401);
  assert.equal((await post("/api/tally/quick-add/key", {}, { cookie, origin: "https://evil.example" })).status, 403);
  const issued = await (await post("/api/tally/quick-add/key", { timeZone: "Asia/Shanghai" }, { cookie, origin: base })).json();
  assert.ok(issued.token.startsWith("dfq_")); assert.equal(issued.endpoint, `${base}/api/tally/quick-add`);
  const auth = { authorization: `Bearer ${issued.token}` };

  assert.equal((await fetch(`${base}/api/tally/quick-add`)).status, 405);
  assert.equal((await post("/api/tally/quick-add", { amount: 5 })).status, 401);
  // The session cookie alone is not a quick-add key, and the key is inactive until the ledger carries its identifier.
  assert.equal((await post("/api/tally/quick-add", { amount: 5 }, { cookie })).status, 401);
  assert.equal((await post("/api/tally/quick-add", { amount: 5 }, auth)).status, 401);

  const put = await fetch(`${base}/api/user/snapshot`, { method: "PUT", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ baseRevision: 0, payload: { "tally-book-v1": JSON.stringify({ baseCurrency: "CNY", records: [], quickAddKeyId: issued.keyId }) } }) });
  assert.equal(put.status, 200);
  const added = await post("/api/tally/quick-add", { amount: "32.5", category: "Lunch" }, auth);
  assert.equal(added.status, 200); const result = await added.json();
  assert.equal(result.record.amount, 32.5); assert.match(result.message, /Recorded CNY 32\.5 · Lunch/);
  assert.equal((await post("/api/tally/quick-add", { amount: "nope" }, auth)).status, 400);
  const snapshot = await (await fetch(`${base}/api/user/snapshot`, { headers: { cookie } })).json();
  assert.equal(snapshot.revision, 2); assert.equal(JSON.parse(snapshot.payload["tally-book-v1"]).records[0].category, "Lunch");
});
