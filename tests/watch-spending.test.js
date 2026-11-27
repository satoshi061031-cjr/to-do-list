const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createWatchSpending } = require("../server/watch-spending");
const { createSnapshotStore } = require("../server/user-snapshot-store");
const { createAppleSender } = require("../server/watch-push");
const { writeStore } = require("../server/snapshot-values");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const time = { value: Date.parse("2026-11-23T16:01:00Z") }, snapshots = new Map();
  const api = createWatchSpending(db, () => ({ getSnapshot: async owner => snapshots.get(owner) }), () => time.value);
  const pair = owner => "Bearer " + api.redeem(api.issue(owner).code, "test").token;
  return { api, time, snapshots, pair };
}

test("native complication timeline, midnight, cached totals and localized amounts", { skip: process.platform !== "darwin" }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dayfly-face-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, "checks");
  execFileSync("xcrun", ["swiftc", "-module-cache-path", path.join(dir, "modules"),
    "watchOS/Shared/Spending.swift", "watchOS/SpendingWidget/SpendingTimeline.swift",
    "watchOS/Tests/SpendingTimelineChecks.swift", "-o", binary], { cwd: path.join(__dirname, "..") });
  execFileSync(binary);
});

test("watch shows only today's personal total at recorded rates in the watch's zone", async t => {
  const { api, time, snapshots, pair } = fixture(t);
  const token = pair("first");
  const day = "2026-11-24";
  const book = { baseCurrency: "CNY", records: [
    { date: day, amount: 54, note: "private", currency: "CNY" },
    { date: day, amount: 3, fxRate: 7.1, currency: "USD" },
    { date: day, amount: 100, scope: "shared" },
    { date: "2026-11-23", amount: 4 }
  ] };
  snapshots.set("first", { payload: writeStore({}, "tally-book-v1", book) });
  const result = await api.today(token, "Asia/Kuala_Lumpur");
  assert.deepEqual(result, { date: day, amount: "75.30", currency: "CNY", checkedAt: time.value });
  assert.equal((await api.today(token, "UTC")).amount, "4.00");
  await assert.rejects(api.today(token, "Bad/Zone"), { statusCode: 400 });
  time.value += 86_400_000;
  assert.equal((await api.today(token, "Asia/Kuala_Lumpur")).amount, "0.00");
  await assert.rejects(api.today(pair("second"), "UTC"), { statusCode: 409 });
});

test("watch pairing codes expire, work once, and a new redemption replaces the prior watch", async t => {
  const { api, time, snapshots, pair } = fixture(t);
  snapshots.set("owner", { payload: writeStore({}, "tally-book-v1", { records: [] }) });
  const old = pair("owner");
  const expired = api.issue("owner").code; time.value += 600_000;
  assert.throws(() => api.redeem(expired, "test"), { statusCode: 401 });
  const { code } = api.issue("owner");
  assert.equal((await api.today(old, "UTC")).amount, "0.00");
  const fresh = "Bearer " + api.redeem(code.toLowerCase(), "test").token;
  assert.throws(() => api.redeem(code, "test"), { statusCode: 401 });
  await assert.rejects(api.today(old, "UTC"), { statusCode: 401 });
  const pending = api.issue("owner").code;
  api.revoke("owner");
  assert.throws(() => api.redeem(pending, "test"), { statusCode: 401 });
  await assert.rejects(api.today(fresh, "UTC"), { statusCode: 401 });
});

test("a paired watch receives committed additions, edits and deletions, then clears at midnight", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const rows = new Map();
  const store = createSnapshotStore({ config: {}, sqliteGet: id => rows.get(id),
    sqliteUpsert(id, payload, revision) {
      assert.equal(revision, rows.get(id)?.revision || 0);
      const saved = { payload, revision: revision + 1 };
      rows.set(id, saved);
      return saved;
    } });
  let now = Date.parse("2026-11-27T15:58:00Z");
  const zone = "Asia/Kuala_Lumpur";
  const api = createWatchSpending(db, () => store, () => now);
  const token = "Bearer " + api.redeem(api.issue("a").code, "test").token;
  async function save(owner, amounts) {
    const records = amounts.map((amount, i) => ({ id: String(i), amount, date: "2026-11-27", currency: "CNY" }));
    await store.upsertSnapshot(owner, writeStore({}, "tally-book-v1", { baseCurrency: "CNY", records }), rows.get(owner)?.revision || 0);
  }
  await save("a", []);
  let value = await api.read(token, zone);
  for (const [amounts, expected] of [[[5], "5.00"], [[7.25], "7.25"], [[], "0.00"]]) {
    const pending = api.read(token, zone, api.changeTag(value));
    await save("b", [99]);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(api.read(token, zone, api.changeTag(value)), { statusCode: 429 });
    await save("a", amounts);
    value = await pending;
    assert.equal(value.amount, expected);
  }
  await save("a", [12]);
  const yesterday = await api.read(token, zone);
  now += 120_000;
  value = await api.read(token, zone, api.changeTag(yesterday));
  assert.deepEqual([value.date, value.amount], ["2026-11-28", "0.00"]);
  const controller = new AbortController();
  const abandoned = api.read(token, zone, api.changeTag(value), controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.equal(await abandoned, undefined);
  const revoked = api.read(token, zone, api.changeTag(value));
  api.revoke("a");
  await assert.rejects(revoked, { statusCode: 401 });
});

test("widget pushes carry only an invalidation, coalesce unchanged books and stop after a new pairing", async t => {
  const db = new DatabaseSync(":memory:");
  const store = createSnapshotStore({ config: {}, sqliteUpsert: () => ({ revision: 1 }) });
  const delivered = [];
  const api = createWatchSpending(db, () => store, Date.now, async device => { delivered.push(device); return "sent"; });
  t.after(() => { api.close(); db.close(); });
  const pair = id => "Bearer " + api.redeem(api.issue(id).code, "test").token;
  const a = pair("a"), b = pair("b"), device = "af".repeat(32);
  const payload = writeStore({}, "tally-book-v1", { records: [{ amount: 9 }] });
  assert.throws(() => api.configurePush("Bearer bogus", device), { statusCode: 401 });
  assert.throws(() => api.configurePush(a, "not-a-token"), { statusCode: 400 });
  api.configurePush(a, device);
  await store.upsertSnapshot("b", payload);
  assert.deepEqual(delivered, []);
  await store.upsertSnapshot("a", payload);
  await store.upsertSnapshot("a", { ...payload, "todo-app-v2": "[]" });
  assert.deepEqual(delivered, [device]);
  api.configurePush(b, null);
  const fresh = pair("a");
  assert.throws(() => api.configurePush(a, device), { statusCode: 401 });
  await store.upsertSnapshot("a", {});
  assert.deepEqual(delivered, [device]);
  api.configurePush(fresh, device);
  api.configurePush(fresh, null);
  await store.upsertSnapshot("a", payload);
  assert.deepEqual(delivered, [device]);
});

test("APNs provider sends a signed widget invalidation without ledger data and recognizes an expired token", async t => {
  const crypto = require("node:crypto");
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dayfly-push-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, "fixture.key");
  fs.writeFileSync(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  const device = "ab".repeat(32);
  let result = 200;
  function connect(origin) {
    assert.equal(origin, "https://api.sandbox.push.apple.com");
    const client = new EventEmitter();
    client.close = () => queueMicrotask(() => client.emit("close"));
    client.request = headers => {
      assert.equal(headers[":path"], "/3/device/" + device);
      assert.equal(headers["apns-push-type"], "widgets");
      assert.equal(headers["apns-topic"], "app.dailyspace.watch.push-type.widgets");
      const [header, claims, sig] = headers.authorization.slice(7).split(".");
      assert.ok(crypto.verify("sha256", Buffer.from(header + "." + claims),
        { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
      const stream = new PassThrough();
      stream.end = body => {
        assert.deepEqual(JSON.parse(body), { aps: { "content-changed": true } });
        stream.emit("response", { ":status": result });
        stream.emit("end");
      };
      return stream;
    };
    return client;
  }
  const send = createAppleSender({ DAYFLY_APNS_TEAM_ID: "test-team", DAYFLY_APNS_KEY_ID: "test-key",
    DAYFLY_APNS_KEY_FILE: keyFile, DAYFLY_APNS_WIDGET_TOPIC: "app.dailyspace.watch.push-type.widgets",
    DAYFLY_APNS_ENVIRONMENT: "sandbox" }, connect);
  assert.equal(await send(device), "sent");
  result = 410;
  assert.equal(await send(device), "expired");
});
