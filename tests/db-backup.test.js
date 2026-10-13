const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

test("backup includes live WAL writes, restores data, and refuses overwrites", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-space-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.sqlite");
  const target = path.join(dir, "backup.sqlite");
  const database = new DatabaseSync(source);
  t.after(() => database.close());
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('saved');");
  const run = destination => spawnSync(process.execPath, ["--experimental-sqlite",
    "--disable-warning=ExperimentalWarning", path.resolve(__dirname, "../scripts/backup-db.js"), destination],
  { env: { ...process.env, DAILY_SPACE_DB_PATH: source }, encoding: "utf8" });
  const result = run(target);
  assert.equal(result.status, 0, result.stderr);
  const restored = new DatabaseSync(target);
  try {
    assert.equal(restored.prepare("SELECT value FROM records").get().value, "saved");
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { restored.close(); }
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  const original = fs.readFileSync(target);
  assert.equal(run(target).status, 1);
  assert.deepEqual(fs.readFileSync(target), original);
  assert.equal(run(source).status, 1);
  assert.equal(database.prepare("SELECT value FROM records").get().value, "saved");
});

test("legacy SQLite snapshots migrate without data loss and reject stale revisions", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-space-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "legacy.sqlite");
  const database = new DatabaseSync(source);
  database.exec(`CREATE TABLE user_snapshots (user_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO user_snapshots VALUES ('legacy@example.com', '{"todo-theme":"dark"}', 'legacy');`);
  database.close();
  const result = spawnSync(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "-e", `
    const assert = require('node:assert/strict');
    const { getDb, getUserSnapshot, upsertUserSnapshot } = require('./server/db');
    const snapshot = getUserSnapshot('legacy@example.com');
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.payload['todo-theme'], 'dark');
    assert.equal(upsertUserSnapshot('legacy@example.com', {'todo-theme':'light'}, 1).revision, 2);
    assert.throws(() => upsertUserSnapshot('legacy@example.com', {}, 1), e => e.statusCode === 409);
    getDb().close();
  `], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, DAILY_SPACE_DB_PATH: source }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
