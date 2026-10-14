const { createClient } = require("@supabase/supabase-js");
const {
  getUserSnapshot: getSqliteSnapshot,
  upsertUserSnapshot: upsertSqliteSnapshot,
  deleteUserSnapshot: deleteSqliteSnapshot,
} = require("./db");

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const ALLOWED_SNAPSHOT_KEYS = new Set([
  "todo-app-v2",
  "task-templates-v1",
  "planner-app-v1",
  "calendar-app-v1",
  "tally-book-v1",
  "teamwork-page-v1",
  "travel-book-v1",
  "travel-shared-v1",
  "daily-space-mail-accounts-v1",
  "todo-theme",
]);

let defaultStore;

function normalizeUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

function snapshotError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeSnapshotPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw snapshotError("Snapshot payload must be an object.", 400);
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_SNAPSHOT_KEYS.has(key)) continue;
    if (typeof value !== "string") {
      throw snapshotError(`Snapshot value for ${key} must be a string.`, 400);
    }
    sanitized[key] = value;
  }
  const size = Buffer.byteLength(JSON.stringify(sanitized), "utf8");
  if (size > MAX_SNAPSHOT_BYTES) {
    throw snapshotError("Snapshot payload is too large.", 413);
  }
  return sanitized;
}

function supabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

function createSnapshotStore(options = {}) {
  const config = options.config || supabaseConfig();
  const configured = Boolean(config.url && config.serviceRoleKey);
  const supabase =
    options.supabase ||
    (configured
      ? createClient(config.url, config.serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null);
  const sqliteGet = options.sqliteGet || getSqliteSnapshot;
  const sqliteUpsert = options.sqliteUpsert || upsertSqliteSnapshot;
  const sqliteDelete = options.sqliteDelete || deleteSqliteSnapshot;

  async function migrateLegacySnapshot(userId) {
    const legacy = sqliteGet(userId);
    if (!legacy || !legacy.payload || !Object.keys(legacy.payload).length) return null;
    const payload = sanitizeSnapshotPayload(legacy.payload);
    const updatedAt = legacy.updatedAt || new Date().toISOString();
    const { data, error } = await supabase
      .from("user_snapshots")
      .upsert(
        { user_id: userId, payload, updated_at: updatedAt, revision: 1 },
        { onConflict: "user_id", ignoreDuplicates: true }
      )
      .select("payload, updated_at, revision")
      .maybeSingle();
    if (error) throw snapshotError(`Supabase migration failed: ${error.message}`, 502);
    // Another instance may have already created cloud data; never overwrite it during migration.
    if (!data) return getSnapshot(userId, false);
    return {
      revision: data.revision,
      payload: data?.payload || payload,
      updatedAt: data?.updated_at || updatedAt,
      migrated: true,
    };
  }

  async function getSnapshot(userId, migrate = true) {
    const id = normalizeUserId(userId);
    if (!id) throw snapshotError("userId is required.", 400);
    if (!supabase) return sqliteGet(id);

    const { data, error } = await supabase
      .from("user_snapshots")
      .select("payload, updated_at, revision")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw snapshotError(`Supabase read failed: ${error.message}`, 502);
    if (data) {
      return {
        payload: data.payload && typeof data.payload === "object" ? data.payload : {},
        updatedAt: data.updated_at || null,
        revision: data.revision,
      };
    }
    return migrate ? migrateLegacySnapshot(id) : null;
  }

  async function upsertSnapshot(userId, rawPayload, baseRevision = 0) {
    const id = normalizeUserId(userId);
    if (!id) throw snapshotError("userId is required.", 400);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw snapshotError("baseRevision must be a nonnegative integer.", 400);
    }
    const payload = sanitizeSnapshotPayload(rawPayload);
    if (!supabase) return sqliteUpsert(id, payload, baseRevision);

    // The database performs compare-and-swap atomically, including first creation.
    const { data, error } = await supabase.rpc("save_user_snapshot", {
      p_user_id: id, p_payload: payload, p_base_revision: baseRevision,
    });
    if (error) throw snapshotError(`Supabase write failed: ${error.message}`, 502);
    const saved = data?.[0];
    if (!saved) {
      const conflict = snapshotError("Your cloud data changed. Choose which version to keep.", 409);
      conflict.code = "SNAPSHOT_CONFLICT";
      conflict.currentRevision = (await getSnapshot(id, false))?.revision || 0;
      throw conflict;
    }
    return { userId: id, updatedAt: saved.updated_at, revision: saved.revision };
  }

  async function deleteSnapshot(userId) {
    const id = normalizeUserId(userId);
    if (!id) throw snapshotError("userId is required.", 400);
    const sqliteResult = sqliteDelete(id);
    if (!supabase) return { removed: Boolean(sqliteResult?.removed) };

    const { error, count } = await supabase
      .from("user_snapshots")
      .delete({ count: "exact" })
      .eq("user_id", id);
    if (error) throw snapshotError(`Supabase delete failed: ${error.message}`, 502);
    return { removed: Boolean(sqliteResult?.removed) || Number(count || 0) > 0 };
  }

  return {
    configured: Boolean(supabase),
    getSnapshot,
    upsertSnapshot,
    deleteSnapshot,
  };
}

function getDefaultStore() {
  if (!defaultStore) defaultStore = createSnapshotStore();
  return defaultStore;
}

function isSupabaseSnapshotStoreConfigured() {
  const config = supabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

module.exports = {
  ALLOWED_SNAPSHOT_KEYS,
  MAX_SNAPSHOT_BYTES,
  createSnapshotStore,
  getDefaultStore,
  isSupabaseSnapshotStoreConfigured,
  sanitizeSnapshotPayload,
};
