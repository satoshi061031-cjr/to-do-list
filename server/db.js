const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH =
  process.env.DAILY_SPACE_DB_PATH ||
  process.env.STOCKS_DB_PATH ||
  path.join(DATA_DIR, "daily-space.sqlite");

let db;

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function getDb() {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      email TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      scope TEXT,
      expires_at TEXT,
      profile_json TEXT,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, provider, email)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      email_hint TEXT,
      return_to TEXT,
      user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_snapshots (
      user_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      label TEXT,
      joined_at TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      invited_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_members_user
      ON workspace_members(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_workspace_invites_token
      ON workspace_invites(token);

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS board_columns (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      title TEXT NOT NULL,
      emoji TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS board_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      board_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT,
      assignee_user_id TEXT,
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES board_columns(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_boards_workspace ON boards(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_board_columns_board ON board_columns(board_id, position);
    CREATE INDEX IF NOT EXISTS idx_board_tasks_board ON board_tasks(board_id, column_id, position);
    CREATE INDEX IF NOT EXISTS idx_board_tasks_assignee ON board_tasks(assignee_user_id, completed);

    CREATE TABLE IF NOT EXISTS travel_trips (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS travel_trip_members (
      trip_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
      label TEXT,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, user_id),
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS travel_stops (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS travel_reservations (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      source_id TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE,
      UNIQUE (trip_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS travel_invites (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invite_type TEXT NOT NULL CHECK (invite_type IN ('one_time', 'reusable')),
      email TEXT,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      accepted_at TEXT,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_travel_members_user
      ON travel_trip_members(user_id, trip_id);
    CREATE INDEX IF NOT EXISTS idx_travel_stops_trip
      ON travel_stops(trip_id, position);
    CREATE INDEX IF NOT EXISTS idx_travel_reservations_trip
      ON travel_reservations(trip_id);
    CREATE INDEX IF NOT EXISTS idx_travel_invites_trip
      ON travel_invites(trip_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_travel_invites_token
      ON travel_invites(token_hash);
  `);

  const mailAccountColumns = database.prepare("PRAGMA table_info(mail_accounts)").all();
  if (!mailAccountColumns.some((column) => column.name === "user_id")) {
    database.exec(`
      BEGIN;
      ALTER TABLE mail_accounts RENAME TO mail_accounts_legacy;

      CREATE TABLE mail_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        token_type TEXT,
        scope TEXT,
        expires_at TEXT,
        profile_json TEXT,
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, provider, email)
      );

      INSERT INTO mail_accounts (
        id, user_id, provider, email, access_token, refresh_token, token_type,
        scope, expires_at, profile_json, connected_at, updated_at
      )
      SELECT
        id, lower(email), provider, email, access_token, refresh_token, token_type,
        scope, expires_at, profile_json, connected_at, updated_at
      FROM mail_accounts_legacy;

      DROP TABLE mail_accounts_legacy;
      COMMIT;
    `);
  }

  const oauthStateColumns = database.prepare("PRAGMA table_info(oauth_states)").all();
  if (!oauthStateColumns.some((column) => column.name === "user_id")) {
    database.exec(`ALTER TABLE oauth_states ADD COLUMN user_id TEXT`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

function listMailAccounts(userId) {
  const ownerId = normalizeUserId(userId);
  if (!ownerId) return [];
  return getDb()
    .prepare(
      `SELECT id, provider, email, token_type AS tokenType, scope, expires_at AS expiresAt,
              connected_at AS connectedAt, updated_at AS updatedAt,
              access_token AS accessToken, refresh_token AS refreshToken, profile_json AS profileJson
       FROM mail_accounts
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    )
    .all(ownerId)
    .map((row) => {
      const provider = String(row.provider || "").toLowerCase();
      const hasAccess = Boolean(row.accessToken);
      const hasRefresh = Boolean(row.refreshToken);
      const hasCredentials =
        provider === "icloud" ? hasRefresh : hasAccess || hasRefresh;
      return {
        id: row.id,
        provider: row.provider,
        email: row.email,
        tokenType: row.tokenType,
        scope: row.scope,
        expiresAt: row.expiresAt,
        connectedAt: row.connectedAt,
        updatedAt: row.updatedAt,
        hasCredentials,
        needsMailOAuth: !hasCredentials,
        source: fromJson(row.profileJson, {})?.source || null,
      };
    });
}

function getMailAccountById(userId, id) {
  const ownerId = normalizeUserId(userId);
  if (!ownerId) return null;
  const row = getDb()
    .prepare("SELECT * FROM mail_accounts WHERE user_id = ? AND id = ?")
    .get(ownerId, String(id || ""));
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    email: row.email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenType: row.token_type,
    scope: row.scope,
    expiresAt: row.expires_at,
    profile: fromJson(row.profile_json, {}),
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function upsertMailAccount(input) {
  const userId = normalizeUserId(input.userId);
  const provider = String(input.provider || "").trim().toLowerCase();
  const email = String(input.email || "").trim().toLowerCase();
  if (!userId || !provider || !email) {
    const error = new Error("User, provider, and email are required.");
    error.statusCode = 400;
    throw error;
  }

  const now = nowIso();
  const existing = getDb()
    .prepare(
      "SELECT id, connected_at AS connectedAt FROM mail_accounts WHERE user_id = ? AND provider = ? AND email = ?"
    )
    .get(userId, provider, email);
  const id = existing?.id || `${userId}:${provider}:${email}`;
  const connectedAt = existing?.connectedAt || now;
  getDb()
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, provider, email, access_token, refresh_token, token_type, scope, expires_at,
        profile_json, connected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider, email) DO UPDATE SET
        access_token = COALESCE(excluded.access_token, mail_accounts.access_token),
        refresh_token = COALESCE(excluded.refresh_token, mail_accounts.refresh_token),
        token_type = excluded.token_type,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      userId,
      provider,
      email,
      input.accessToken || null,
      input.refreshToken || null,
      input.tokenType || null,
      input.scope || null,
      input.expiresAt || null,
      toJson(input.profile || {}),
      connectedAt,
      now
    );
  return getDb().prepare("SELECT * FROM mail_accounts WHERE user_id = ? AND id = ?").get(userId, id);
}

function removeMailAccount(userId, id) {
  const ownerId = normalizeUserId(userId);
  if (!ownerId) return false;
  return getDb()
    .prepare("DELETE FROM mail_accounts WHERE user_id = ? AND id = ?")
    .run(ownerId, String(id || "")).changes > 0;
}

function removeMailAccountByProviderEmail(userId, provider, email) {
  const ownerId = normalizeUserId(userId);
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!ownerId || !normalizedProvider || !normalizedEmail) return false;
  return (
    getDb()
      .prepare("DELETE FROM mail_accounts WHERE user_id = ? AND provider = ? AND email = ?")
      .run(ownerId, normalizedProvider, normalizedEmail).changes > 0
  );
}

function getUserSnapshot(userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return null;
  const row = getDb().prepare("SELECT payload_json, updated_at FROM user_snapshots WHERE user_id = ?").get(id);
  if (!row) return null;
  return {
    payload: fromJson(row.payload_json, {}),
    updatedAt: row.updated_at,
  };
}

function deleteUserSnapshot(userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return { removed: false };
  const result = getDb().prepare("DELETE FROM user_snapshots WHERE user_id = ?").run(id);
  return { removed: Number(result.changes || 0) > 0 };
}

function removeAllMailAccountsForUser(userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return { removed: 0 };
  const result = getDb().prepare("DELETE FROM mail_accounts WHERE user_id = ?").run(id);
  return { removed: Number(result.changes || 0) };
}

function upsertUserSnapshot(userId, payload) {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) {
    const error = new Error("userId is required.");
    error.statusCode = 400;
    throw error;
  }
  const timestamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO user_snapshots (user_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    )
    .run(id, toJson(payload && typeof payload === "object" ? payload : {}), timestamp);
  return {
    userId: id,
    updatedAt: timestamp,
  };
}

function createOauthState(input) {
  const state = String(input.state || "").trim();
  if (!state) return;
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO oauth_states (state, provider, email_hint, return_to, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      state,
      String(input.provider || "").trim().toLowerCase(),
      input.emailHint || null,
      input.returnTo || null,
      input.userId ? normalizeUserId(input.userId) : null,
      nowIso()
    );
}

function consumeOauthState(state, maxAgeMinutes = 20) {
  const normalized = String(state || "").trim();
  if (!normalized) return null;
  const row = getDb().prepare("SELECT * FROM oauth_states WHERE state = ?").get(normalized);
  getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(normalized);
  if (!row) return null;
  const ageMs = Date.now() - Date.parse(row.created_at);
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMinutes * 60_000) return null;
  return {
    state: row.state,
    provider: row.provider,
    emailHint: row.email_hint || null,
    returnTo: row.return_to || null,
    userId: row.user_id || null,
    createdAt: row.created_at,
  };
}

module.exports = {
  consumeOauthState,
  createOauthState,
  getDb,
  getMailAccountById,
  listMailAccounts,
  removeMailAccount,
  removeMailAccountByProviderEmail,
  removeAllMailAccountsForUser,
  upsertMailAccount,
  getUserSnapshot,
  deleteUserSnapshot,
  upsertUserSnapshot,
};
