const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_SNAPSHOT_BYTES,
  createSnapshotStore,
  sanitizeSnapshotPayload,
} = require("../server/user-snapshot-store");

function createFakeSupabase() {
  const rows = new Map();

  return {
    rows,
    client: {
      from(table) {
        assert.equal(table, "user_snapshots");
        let selectedUserId = "";
        let pendingRow = null;
        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            assert.equal(column, "user_id");
            selectedUserId = value;
            return builder;
          },
          async maybeSingle() {
            return { data: rows.get(selectedUserId) || null, error: null };
          },
          upsert(row) {
            pendingRow = row;
            return builder;
          },
          async single() {
            if (pendingRow) {
              const stored = {
                user_id: pendingRow.user_id,
                payload: pendingRow.payload,
                updated_at: pendingRow.updated_at,
              };
              rows.set(pendingRow.user_id, stored);
              return { data: stored, error: null };
            }
            return { data: null, error: null };
          },
        };
        return builder;
      },
    },
  };
}

test("Supabase snapshot store keeps users isolated", async () => {
  const fake = createFakeSupabase();
  const store = createSnapshotStore({
    supabase: fake.client,
    sqliteGet: () => null,
    sqliteUpsert: () => {
      throw new Error("SQLite should not be used.");
    },
  });

  await store.upsertSnapshot("ALICE@example.com", {
    "todo-app-v2": JSON.stringify({ todos: [{ id: "a" }] }),
  });
  await store.upsertSnapshot("bob@example.com", {
    "todo-app-v2": JSON.stringify({ todos: [{ id: "b" }] }),
  });

  const alice = await store.getSnapshot("alice@example.com");
  const bob = await store.getSnapshot("bob@example.com");
  assert.match(alice.payload["todo-app-v2"], /"a"/);
  assert.match(bob.payload["todo-app-v2"], /"b"/);
  assert.equal(fake.rows.size, 2);

  const restartedStore = createSnapshotStore({
    supabase: fake.client,
    sqliteGet: () => null,
  });
  const restored = await restartedStore.getSnapshot("alice@example.com");
  assert.match(restored.payload["todo-app-v2"], /"a"/);
});

test("missing Supabase row migrates the legacy SQLite snapshot", async () => {
  const fake = createFakeSupabase();
  const store = createSnapshotStore({
    supabase: fake.client,
    sqliteGet: () => ({
      payload: { "tally-book-v1": JSON.stringify({ budget: 800, records: [] }) },
      updatedAt: "2026-07-13T08:00:00.000Z",
    }),
  });

  const snapshot = await store.getSnapshot("legacy@example.com");
  assert.equal(snapshot.migrated, true);
  assert.equal(snapshot.updatedAt, "2026-07-13T08:00:00.000Z");
  assert.ok(fake.rows.has("legacy@example.com"));
});

test("unconfigured Supabase uses the SQLite development fallback", async () => {
  let saved = null;
  const store = createSnapshotStore({
    config: { url: "", serviceRoleKey: "" },
    sqliteGet: (userId) => ({ payload: { "todo-theme": userId }, updatedAt: "now" }),
    sqliteUpsert: (userId, payload) => {
      saved = { userId, payload };
      return { userId, updatedAt: "now" };
    },
  });

  assert.equal(store.configured, false);
  assert.equal((await store.getSnapshot("local@example.com")).payload["todo-theme"], "local@example.com");
  await store.upsertSnapshot("local@example.com", { "todo-theme": "dark" });
  assert.deepEqual(saved, {
    userId: "local@example.com",
    payload: { "todo-theme": "dark" },
  });
});

test("snapshot validation filters unknown keys and rejects unsafe payloads", () => {
  assert.deepEqual(
    sanitizeSnapshotPayload({ "todo-theme": "dark", unexpected: "ignored" }),
    { "todo-theme": "dark" }
  );
  assert.throws(
    () => sanitizeSnapshotPayload({ "todo-app-v2": { todos: [] } }),
    /must be a string/
  );
  assert.throws(
    () => sanitizeSnapshotPayload({ "todo-app-v2": "x".repeat(MAX_SNAPSHOT_BYTES + 1) }),
    /too large/
  );
});
