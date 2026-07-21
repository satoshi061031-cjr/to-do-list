const crypto = require("node:crypto");
const { getDb } = require("./db");

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return normalizeUserId(value);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function uid(prefix) {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix || "id"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureWorkspaceTables(database = getDb()) {
  database.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
      ON workspace_invites(email, workspace_id);
  `);
}

function roleCapabilities(role) {
  const normalized = String(role || "");
  return {
    invite: normalized === "owner" || normalized === "admin",
    inviteAdmin: normalized === "owner",
    manageMembers: normalized === "owner" || normalized === "admin",
    changeRoles: normalized === "owner",
    manageBoards: normalized === "owner" || normalized === "admin",
    deleteWorkspace: normalized === "owner",
  };
}

function mapWorkspaceRow(row, extra = {}) {
  if (!row) return null;
  const role = extra.role || row.role || null;
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    role,
    capabilities: roleCapabilities(role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemberRow(row) {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    label: row.label || row.user_id,
    joinedAt: row.joined_at || null,
    createdAt: row.created_at,
  };
}

function getMembership(workspaceId, userId) {
  return getDb()
    .prepare(
      `SELECT workspace_id, user_id, role, status, label, joined_at, created_at
       FROM workspace_members
       WHERE workspace_id = ? AND user_id = ?`
    )
    .get(workspaceId, normalizeUserId(userId));
}

function assertActiveMember(workspaceId, userId, roles = null) {
  const member = getMembership(workspaceId, userId);
  if (!member || member.status !== "active") {
    const error = new Error("Workspace not found or access denied.");
    error.statusCode = 404;
    throw error;
  }
  if (Array.isArray(roles) && roles.length && !roles.includes(member.role)) {
    const error = new Error("You do not have permission for this action.");
    error.statusCode = 403;
    throw error;
  }
  return member;
}

function createWorkspace({ ownerUserId, name, ownerLabel }) {
  ensureWorkspaceTables();
  const ownerId = normalizeUserId(ownerUserId);
  const workspaceName = String(name || "").trim() || "Workspace";
  if (!ownerId) {
    const error = new Error("Owner is required.");
    error.statusCode = 400;
    throw error;
  }
  const id = uid("ws");
  const now = nowIso();
  const database = getDb();
  database
    .prepare(
      `INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, workspaceName, ownerId, now, now);
  database
    .prepare(
      `INSERT INTO workspace_members
        (workspace_id, user_id, role, status, label, joined_at, created_at)
       VALUES (?, ?, 'owner', 'active', ?, ?, ?)`
    )
    .run(id, ownerId, String(ownerLabel || ownerId).trim() || ownerId, now, now);
  return getWorkspaceForUser(id, ownerId);
}

function listWorkspacesForUser(userId) {
  ensureWorkspaceTables();
  const id = normalizeUserId(userId);
  const rows = getDb()
    .prepare(
      `SELECT w.id, w.name, w.owner_user_id, w.created_at, w.updated_at, m.role
       FROM workspaces w
       INNER JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY w.updated_at DESC`
    )
    .all(id);
  return rows.map((row) => mapWorkspaceRow(row, { role: row.role }));
}

function getWorkspaceForUser(workspaceId, userId) {
  ensureWorkspaceTables();
  const member = assertActiveMember(workspaceId, userId);
  const row = getDb().prepare(`SELECT * FROM workspaces WHERE id = ?`).get(workspaceId);
  return mapWorkspaceRow(row, { role: member.role });
}

function listWorkspaceMembers(workspaceId, userId) {
  ensureWorkspaceTables();
  assertActiveMember(workspaceId, userId);
  const rows = getDb()
    .prepare(
      `SELECT workspace_id, user_id, role, status, label, joined_at, created_at
       FROM workspace_members
       WHERE workspace_id = ?
       ORDER BY
         CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         created_at ASC`
    )
    .all(workspaceId);
  return rows.map(mapMemberRow);
}

function createWorkspaceInvite({ workspaceId, invitedBy, email, role, inviterLabel }) {
  ensureWorkspaceTables();
  const actor = assertActiveMember(workspaceId, invitedBy, ["owner", "admin"]);
  const inviteEmail = normalizeEmail(email);
  if (!isValidEmail(inviteEmail)) {
    const error = new Error("Please enter a valid email address.");
    error.statusCode = 400;
    throw error;
  }
  const inviteRole = role === "admin" ? "admin" : "member";
  if (inviteRole === "admin" && actor.role !== "owner") {
    const error = new Error("Only owners can invite admins.");
    error.statusCode = 403;
    throw error;
  }

  const existing = getMembership(workspaceId, inviteEmail);
  if (existing && existing.status === "active") {
    const error = new Error("That person is already in this workspace.");
    error.statusCode = 409;
    throw error;
  }

  const database = getDb();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const inviteId = uid("inv");
  const token = crypto.randomBytes(24).toString("hex");

  database
    .prepare(
      `INSERT INTO workspace_invites
        (id, workspace_id, email, role, token, invited_by, expires_at, created_at, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(inviteId, workspaceId, inviteEmail, inviteRole, token, normalizeUserId(invitedBy), expiresAt, now);

  if (existing) {
    database
      .prepare(
        `UPDATE workspace_members
         SET role = ?, status = 'invited', label = COALESCE(label, ?)
         WHERE workspace_id = ? AND user_id = ?`
      )
      .run(inviteRole, inviteEmail, workspaceId, inviteEmail);
  } else {
    database
      .prepare(
        `INSERT INTO workspace_members
          (workspace_id, user_id, role, status, label, joined_at, created_at)
         VALUES (?, ?, ?, 'invited', ?, NULL, ?)`
      )
      .run(workspaceId, inviteEmail, inviteRole, inviteEmail, now);
  }

  database.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(now, workspaceId);

  const workspace = getDb().prepare(`SELECT name FROM workspaces WHERE id = ?`).get(workspaceId);
  return {
    id: inviteId,
    workspaceId,
    workspaceName: workspace?.name || "Workspace",
    email: inviteEmail,
    role: inviteRole,
    token,
    expiresAt,
    invitedBy: normalizeUserId(invitedBy),
    inviterLabel: String(inviterLabel || invitedBy).trim(),
    invitePath: `/teamwork.html?invite=${encodeURIComponent(token)}`,
  };
}

function getInviteByToken(token) {
  ensureWorkspaceTables();
  const normalized = String(token || "").trim();
  if (!normalized) return null;
  const row = getDb()
    .prepare(
      `SELECT i.*, w.name AS workspace_name
       FROM workspace_invites i
       INNER JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token = ?`
    )
    .get(normalized);
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    email: row.email,
    role: row.role,
    token: row.token,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

function acceptWorkspaceInvite({ token, userId, userLabel }) {
  ensureWorkspaceTables();
  const invite = getInviteByToken(token);
  if (!invite || invite.acceptedAt) {
    const error = new Error("Invite not found or already used.");
    error.statusCode = 404;
    throw error;
  }
  if (Date.parse(invite.expiresAt) < Date.now()) {
    const error = new Error("This invite has expired.");
    error.statusCode = 410;
    throw error;
  }
  const actorId = normalizeUserId(userId);
  if (actorId !== invite.email) {
    const error = new Error(`Sign in as ${invite.email} to accept this invite.`);
    error.statusCode = 403;
    throw error;
  }

  const now = nowIso();
  const database = getDb();
  const existing = getMembership(invite.workspaceId, actorId);
  if (existing) {
    database
      .prepare(
        `UPDATE workspace_members
         SET role = ?, status = 'active', label = ?, joined_at = COALESCE(joined_at, ?)
         WHERE workspace_id = ? AND user_id = ?`
      )
      .run(invite.role, String(userLabel || actorId).trim() || actorId, now, invite.workspaceId, actorId);
  } else {
    database
      .prepare(
        `INSERT INTO workspace_members
          (workspace_id, user_id, role, status, label, joined_at, created_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(
        invite.workspaceId,
        actorId,
        invite.role,
        String(userLabel || actorId).trim() || actorId,
        now,
        now
      );
  }
  database.prepare(`UPDATE workspace_invites SET accepted_at = ? WHERE id = ?`).run(now, invite.id);
  database.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(now, invite.workspaceId);

  return getWorkspaceForUser(invite.workspaceId, actorId);
}

function listPendingInvitesForWorkspace(workspaceId, userId) {
  ensureWorkspaceTables();
  assertActiveMember(workspaceId, userId, ["owner", "admin"]);
  return getDb()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, email, role, token, expires_at AS expiresAt, created_at AS createdAt
       FROM workspace_invites
       WHERE workspace_id = ? AND accepted_at IS NULL
       ORDER BY created_at DESC`
    )
    .all(workspaceId);
}

function revokeWorkspaceInvite(workspaceId, actorUserId, inviteId) {
  ensureWorkspaceTables();
  assertActiveMember(workspaceId, actorUserId, ["owner", "admin"]);
  const row = getDb()
    .prepare(
      `SELECT id, email, accepted_at FROM workspace_invites
       WHERE id = ? AND workspace_id = ?`
    )
    .get(inviteId, workspaceId);
  if (!row || row.accepted_at) {
    const error = new Error("Invite not found.");
    error.statusCode = 404;
    throw error;
  }
  const database = getDb();
  database.prepare(`DELETE FROM workspace_invites WHERE id = ?`).run(inviteId);
  const member = getMembership(workspaceId, row.email);
  if (member && member.status === "invited") {
    database
      .prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND status = 'invited'`)
      .run(workspaceId, row.email);
  }
  database.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(nowIso(), workspaceId);
  return { removed: true };
}

function updateMemberRole(workspaceId, actorUserId, targetUserId, nextRole) {
  ensureWorkspaceTables();
  assertActiveMember(workspaceId, actorUserId, ["owner"]);
  const targetId = normalizeUserId(targetUserId);
  const target = getMembership(workspaceId, targetId);
  if (!target || target.status !== "active") {
    const error = new Error("Member not found.");
    error.statusCode = 404;
    throw error;
  }
  if (target.role === "owner") {
    const error = new Error("Owner role cannot be changed.");
    error.statusCode = 400;
    throw error;
  }
  const role = nextRole === "admin" ? "admin" : "member";
  getDb()
    .prepare(`UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?`)
    .run(role, workspaceId, targetId);
  getDb().prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(nowIso(), workspaceId);
  return mapMemberRow(getMembership(workspaceId, targetId));
}

function removeWorkspaceMember(workspaceId, actorUserId, targetUserId) {
  ensureWorkspaceTables();
  const actor = assertActiveMember(workspaceId, actorUserId, ["owner", "admin"]);
  const targetId = normalizeUserId(targetUserId);
  if (targetId === normalizeUserId(actorUserId)) {
    const error = new Error("Use leave workspace to remove yourself.");
    error.statusCode = 400;
    throw error;
  }
  const target = getMembership(workspaceId, targetId);
  if (!target || target.status !== "active") {
    const error = new Error("Member not found.");
    error.statusCode = 404;
    throw error;
  }
  if (target.role === "owner") {
    const error = new Error("Cannot remove the workspace owner.");
    error.statusCode = 403;
    throw error;
  }
  if (target.role === "admin" && actor.role !== "owner") {
    const error = new Error("Only owners can remove admins.");
    error.statusCode = 403;
    throw error;
  }
  getDb()
    .prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
    .run(workspaceId, targetId);
  getDb().prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(nowIso(), workspaceId);
  return { removed: true };
}

function leaveWorkspace(workspaceId, userId) {
  ensureWorkspaceTables();
  const member = assertActiveMember(workspaceId, userId);
  if (member.role === "owner") {
    const error = new Error("Owners cannot leave. Delete the workspace or transfer ownership first.");
    error.statusCode = 400;
    throw error;
  }
  getDb()
    .prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
    .run(workspaceId, normalizeUserId(userId));
  getDb().prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(nowIso(), workspaceId);
  return { left: true };
}

function deleteWorkspace(workspaceId, userId) {
  ensureWorkspaceTables();
  assertActiveMember(workspaceId, userId, ["owner"]);
  const database = getDb();
  const hasBoards = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'boards'`)
    .get();
  if (hasBoards) {
    const boards = database.prepare(`SELECT id FROM boards WHERE workspace_id = ?`).all(workspaceId);
    for (const board of boards) {
      database.prepare(`DELETE FROM board_tasks WHERE board_id = ?`).run(board.id);
      database.prepare(`DELETE FROM board_columns WHERE board_id = ?`).run(board.id);
    }
    database.prepare(`DELETE FROM boards WHERE workspace_id = ?`).run(workspaceId);
  }
  database.prepare(`DELETE FROM workspace_invites WHERE workspace_id = ?`).run(workspaceId);
  database.prepare(`DELETE FROM workspace_members WHERE workspace_id = ?`).run(workspaceId);
  database.prepare(`DELETE FROM workspaces WHERE id = ?`).run(workspaceId);
  return { removed: true };
}

module.exports = {
  acceptWorkspaceInvite,
  assertActiveMember,
  createWorkspace,
  createWorkspaceInvite,
  deleteWorkspace,
  ensureWorkspaceTables,
  getInviteByToken,
  getWorkspaceForUser,
  isValidEmail,
  leaveWorkspace,
  listPendingInvitesForWorkspace,
  listWorkspaceMembers,
  listWorkspacesForUser,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  roleCapabilities,
  updateMemberRole,
};
