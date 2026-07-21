const crypto = require("node:crypto");
const { getDb } = require("./db");

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function uid(prefix) {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix || "id"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureNotificationTables(database = getDb()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      entity_type TEXT,
      entity_id TEXT,
      meta_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications(user_id, read_at);
  `);
}

function mapNotification(row) {
  if (!row) return null;
  let meta = null;
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json);
    } catch (_) {
      meta = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body || "",
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    meta,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

function createNotification({ userId, type, title, body, entityType, entityId, meta }) {
  ensureNotificationTables();
  const id = uid("notif");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO notifications (
        id, user_id, type, title, body, entity_type, entity_id, meta_json, read_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      id,
      normalizeUserId(userId),
      String(type || "info").slice(0, 64),
      String(title || "").trim().slice(0, 200) || "Notification",
      String(body || "").trim().slice(0, 500),
      entityType ? String(entityType).slice(0, 64) : null,
      entityId ? String(entityId).slice(0, 128) : null,
      meta ? JSON.stringify(meta) : null,
      now
    );
  return mapNotification(getDb().prepare(`SELECT * FROM notifications WHERE id = ?`).get(id));
}

function listNotificationsForUser(userId, { limit = 40 } = {}) {
  ensureNotificationTables();
  const id = normalizeUserId(userId);
  if (!id) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  return getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(id, safeLimit)
    .map(mapNotification);
}

function countUnreadNotifications(userId) {
  ensureNotificationTables();
  const id = normalizeUserId(userId);
  if (!id) return 0;
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(id);
  return Number(row?.c) || 0;
}

function markNotificationRead(notificationId, userId) {
  ensureNotificationTables();
  const row = getDb().prepare(`SELECT * FROM notifications WHERE id = ?`).get(notificationId);
  if (!row || row.user_id !== normalizeUserId(userId)) {
    const error = new Error("Notification not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!row.read_at) {
    getDb()
      .prepare(`UPDATE notifications SET read_at = ? WHERE id = ?`)
      .run(nowIso(), notificationId);
  }
  return mapNotification(getDb().prepare(`SELECT * FROM notifications WHERE id = ?`).get(notificationId));
}

function markAllNotificationsRead(userId) {
  ensureNotificationTables();
  const id = normalizeUserId(userId);
  const now = nowIso();
  const result = getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
    .run(now, id);
  return { updated: Number(result.changes) || 0 };
}

/**
 * Notify when a task is newly assigned to someone other than the actor.
 */
function notifyTaskAssigned({
  assigneeUserId,
  actorUserId,
  actorLabel,
  task,
  boardName,
  workspaceName,
}) {
  const assignee = normalizeUserId(assigneeUserId);
  const actor = normalizeUserId(actorUserId);
  if (!assignee || !task?.id) return null;
  if (assignee === actor) return null;

  const taskTitle = String(task.title || "").trim() || "Untitled";
  const who = String(actorLabel || actor || "Someone").trim() || "Someone";
  const board = String(boardName || "Team board").trim() || "Team board";
  const workspace = String(workspaceName || "Workspace").trim() || "Workspace";

  return createNotification({
    userId: assignee,
    type: "task_assigned",
    title: `${who} assigned you a task`,
    body: `"${taskTitle}" on ${workspace} · ${board}`,
    entityType: "task",
    entityId: task.id,
    meta: {
      taskId: task.id,
      boardId: task.boardId || null,
      workspaceId: task.workspaceId || null,
      href: "/todo.html#assigned",
    },
  });
}

module.exports = {
  countUnreadNotifications,
  createNotification,
  ensureNotificationTables,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  notifyTaskAssigned,
};
