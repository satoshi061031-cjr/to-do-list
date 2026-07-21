const crypto = require("node:crypto");
const { getDb } = require("./db");
const { assertActiveMember, ensureWorkspaceTables, listWorkspaceMembers } = require("./workspace-store");
const { notifyTaskAssigned } = require("./notification-store");

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix || "id"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureBoardTables(database = getDb()) {
  ensureWorkspaceTables(database);
  database.exec(`
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
  `);
}

function mapBoard(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapColumn(row) {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    emoji: row.emoji || "",
    position: Number(row.position) || 0,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    note: row.note || "",
    assigneeUserId: row.assignee_user_id || null,
    dueDate: row.due_date || null,
    completed: Boolean(row.completed),
    position: Number(row.position) || 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBoardRow(boardId) {
  return getDb().prepare(`SELECT * FROM boards WHERE id = ?`).get(boardId);
}

function assertBoardAccess(boardId, userId, roles = null) {
  ensureBoardTables();
  const board = getBoardRow(boardId);
  if (!board) {
    const error = new Error("Board not found.");
    error.statusCode = 404;
    throw error;
  }
  assertActiveMember(board.workspace_id, userId, roles);
  return board;
}

function createBoard({ workspaceId, name, userId }) {
  ensureBoardTables();
  assertActiveMember(workspaceId, userId, ["owner", "admin"]);
  const id = uid("board");
  const now = nowIso();
  const boardName = String(name || "").trim() || "Team board";
  const database = getDb();
  database
    .prepare(
      `INSERT INTO boards (id, workspace_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, workspaceId, boardName, now, now);

  const defaults = [
    { title: "To do", emoji: "", position: 0 },
    { title: "Doing", emoji: "", position: 1 },
    { title: "Done", emoji: "", position: 2 },
  ];
  const insertCol = database.prepare(
    `INSERT INTO board_columns (id, board_id, title, emoji, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const col of defaults) {
    insertCol.run(uid("col"), id, col.title, col.emoji, col.position, now, now);
  }
  database.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(now, workspaceId);
  return getBoard(id, userId);
}

function deleteBoard(boardId, userId) {
  ensureBoardTables();
  const board = assertBoardAccess(boardId, userId, ["owner", "admin"]);
  const count = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM boards WHERE workspace_id = ?`)
    .get(board.workspace_id).c;
  if (Number(count) <= 1) {
    const error = new Error("Keep at least one team board in the workspace.");
    error.statusCode = 400;
    throw error;
  }
  const database = getDb();
  database.prepare(`DELETE FROM board_tasks WHERE board_id = ?`).run(boardId);
  database.prepare(`DELETE FROM board_columns WHERE board_id = ?`).run(boardId);
  database.prepare(`DELETE FROM boards WHERE id = ?`).run(boardId);
  database.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(nowIso(), board.workspace_id);
  return { removed: true };
}

function listBoardsForWorkspace(workspaceId, userId) {
  ensureBoardTables();
  assertActiveMember(workspaceId, userId);
  return getDb()
    .prepare(
      `SELECT * FROM boards WHERE workspace_id = ? ORDER BY updated_at DESC`
    )
    .all(workspaceId)
    .map(mapBoard);
}

function getBoard(boardId, userId) {
  const board = assertBoardAccess(boardId, userId);
  const columns = getDb()
    .prepare(`SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC, created_at ASC`)
    .all(boardId)
    .map(mapColumn);
  const tasks = getDb()
    .prepare(`SELECT * FROM board_tasks WHERE board_id = ? ORDER BY position ASC, created_at DESC`)
    .all(boardId)
    .map(mapTask);
  return {
    ...mapBoard(board),
    columns,
    tasks,
  };
}

function ensureDefaultBoardForWorkspace(workspaceId, userId) {
  ensureBoardTables();
  const existing = listBoardsForWorkspace(workspaceId, userId);
  if (existing.length) return getBoard(existing[0].id, userId);
  return createBoard({ workspaceId, name: "Team board", userId });
}

function addColumn(boardId, userId, { title, emoji }) {
  const board = assertBoardAccess(boardId, userId);
  const now = nowIso();
  const maxPos = getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) AS maxPos FROM board_columns WHERE board_id = ?`)
    .get(boardId).maxPos;
  const id = uid("col");
  getDb()
    .prepare(
      `INSERT INTO board_columns (id, board_id, title, emoji, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      boardId,
      String(title || "").trim().slice(0, 80) || "Untitled",
      String(emoji || "").trim().slice(0, 8),
      Number(maxPos) + 1,
      now,
      now
    );
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(now, boardId);
  getDb().prepare(`UPDATE workspaces SET updated_at = ? WHERE id = ?`).run(now, board.workspace_id);
  return mapColumn(getDb().prepare(`SELECT * FROM board_columns WHERE id = ?`).get(id));
}

function updateColumn(boardId, columnId, userId, patch) {
  assertBoardAccess(boardId, userId);
  const row = getDb()
    .prepare(`SELECT * FROM board_columns WHERE id = ? AND board_id = ?`)
    .get(columnId, boardId);
  if (!row) {
    const error = new Error("Column not found.");
    error.statusCode = 404;
    throw error;
  }
  const title =
    patch.title !== undefined ? String(patch.title || "").trim().slice(0, 80) || "Untitled" : row.title;
  const emoji =
    patch.emoji !== undefined ? String(patch.emoji || "").trim().slice(0, 8) : row.emoji || "";
  const now = nowIso();
  getDb()
    .prepare(`UPDATE board_columns SET title = ?, emoji = ?, updated_at = ? WHERE id = ?`)
    .run(title, emoji, now, columnId);
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(now, boardId);
  return mapColumn(getDb().prepare(`SELECT * FROM board_columns WHERE id = ?`).get(columnId));
}

function deleteColumn(boardId, columnId, userId) {
  assertBoardAccess(boardId, userId);
  const row = getDb()
    .prepare(`SELECT id FROM board_columns WHERE id = ? AND board_id = ?`)
    .get(columnId, boardId);
  if (!row) {
    const error = new Error("Column not found.");
    error.statusCode = 404;
    throw error;
  }
  const now = nowIso();
  getDb().prepare(`DELETE FROM board_tasks WHERE column_id = ?`).run(columnId);
  getDb().prepare(`DELETE FROM board_columns WHERE id = ?`).run(columnId);
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(now, boardId);
  return { removed: true };
}

function addTask(boardId, userId, input) {
  const board = assertBoardAccess(boardId, userId);
  const columnId = String(input.columnId || "").trim();
  const column = getDb()
    .prepare(`SELECT id FROM board_columns WHERE id = ? AND board_id = ?`)
    .get(columnId, boardId);
  if (!column) {
    const error = new Error("Column not found.");
    error.statusCode = 400;
    throw error;
  }
  let assignee = input.assigneeUserId ? normalizeUserId(input.assigneeUserId) : null;
  if (assignee) {
    const members = listWorkspaceMembers(board.workspace_id, userId);
    if (!members.some((m) => m.userId === assignee && m.status === "active")) {
      const error = new Error("Assignee must be an active workspace member.");
      error.statusCode = 400;
      throw error;
    }
  }
  const now = nowIso();
  const id = uid("task");
  const maxPos = getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) AS maxPos FROM board_tasks WHERE column_id = ?`)
    .get(columnId).maxPos;
  getDb()
    .prepare(
      `INSERT INTO board_tasks (
        id, workspace_id, board_id, column_id, title, note, assignee_user_id, due_date,
        completed, position, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(
      id,
      board.workspace_id,
      boardId,
      columnId,
      String(input.title || "").trim().slice(0, 200) || "Untitled",
      String(input.note || "").slice(0, 4000),
      assignee,
      input.dueDate ? String(input.dueDate).slice(0, 32) : null,
      Number(maxPos) + 1,
      normalizeUserId(userId),
      now,
      now
    );
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(now, boardId);
  const task = mapTask(getDb().prepare(`SELECT * FROM board_tasks WHERE id = ?`).get(id));
  if (assignee) {
    const names = getBoardWorkspaceNames(boardId, board.workspace_id);
    const actorLabel = memberLabel(board.workspace_id, userId);
    notifyTaskAssigned({
      assigneeUserId: assignee,
      actorUserId: userId,
      actorLabel,
      task,
      boardName: names.boardName,
      workspaceName: names.workspaceName,
    });
  }
  return task;
}

function getBoardWorkspaceNames(boardId, workspaceId) {
  const board = getDb().prepare(`SELECT name FROM boards WHERE id = ?`).get(boardId);
  const workspace = getDb().prepare(`SELECT name FROM workspaces WHERE id = ?`).get(workspaceId);
  return {
    boardName: board?.name || "Team board",
    workspaceName: workspace?.name || "Workspace",
  };
}

function memberLabel(workspaceId, userId) {
  const id = normalizeUserId(userId);
  const members = listWorkspaceMembers(workspaceId, userId);
  const me = members.find((m) => m.userId === id);
  return (me && me.label) || id;
}

function updateTask(taskId, userId, patch) {
  ensureBoardTables();
  const row = getDb().prepare(`SELECT * FROM board_tasks WHERE id = ?`).get(taskId);
  if (!row) {
    const error = new Error("Task not found.");
    error.statusCode = 404;
    throw error;
  }
  assertActiveMember(row.workspace_id, userId);

  let columnId = row.column_id;
  if (patch.columnId !== undefined) {
    const nextCol = getDb()
      .prepare(`SELECT id FROM board_columns WHERE id = ? AND board_id = ?`)
      .get(String(patch.columnId), row.board_id);
    if (!nextCol) {
      const error = new Error("Column not found.");
      error.statusCode = 400;
      throw error;
    }
    columnId = nextCol.id;
  }

  let assignee = row.assignee_user_id;
  if (patch.assigneeUserId !== undefined) {
    assignee = patch.assigneeUserId ? normalizeUserId(patch.assigneeUserId) : null;
    if (assignee) {
      const members = listWorkspaceMembers(row.workspace_id, userId);
      if (!members.some((m) => m.userId === assignee && m.status === "active")) {
        const error = new Error("Assignee must be an active workspace member.");
        error.statusCode = 400;
        throw error;
      }
    }
  }

  const title =
    patch.title !== undefined ? String(patch.title || "").trim().slice(0, 200) || "Untitled" : row.title;
  const note = patch.note !== undefined ? String(patch.note || "").slice(0, 4000) : row.note || "";
  const dueDate =
    patch.dueDate !== undefined
      ? patch.dueDate
        ? String(patch.dueDate).slice(0, 32)
        : null
      : row.due_date;
  const completed = patch.completed !== undefined ? (patch.completed ? 1 : 0) : row.completed;
  const now = nowIso();

  const prevAssignee = row.assignee_user_id || null;
  getDb()
    .prepare(
      `UPDATE board_tasks
       SET column_id = ?, title = ?, note = ?, assignee_user_id = ?, due_date = ?, completed = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(columnId, title, note, assignee, dueDate, completed, now, taskId);
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(now, row.board_id);
  const task = mapTask(getDb().prepare(`SELECT * FROM board_tasks WHERE id = ?`).get(taskId));
  if (assignee && assignee !== prevAssignee) {
    const names = getBoardWorkspaceNames(row.board_id, row.workspace_id);
    notifyTaskAssigned({
      assigneeUserId: assignee,
      actorUserId: userId,
      actorLabel: memberLabel(row.workspace_id, userId),
      task,
      boardName: names.boardName,
      workspaceName: names.workspaceName,
    });
  }
  return task;
}

function deleteTask(taskId, userId) {
  ensureBoardTables();
  const row = getDb().prepare(`SELECT * FROM board_tasks WHERE id = ?`).get(taskId);
  if (!row) {
    const error = new Error("Task not found.");
    error.statusCode = 404;
    throw error;
  }
  assertActiveMember(row.workspace_id, userId);
  getDb().prepare(`DELETE FROM board_tasks WHERE id = ?`).run(taskId);
  getDb().prepare(`UPDATE boards SET updated_at = ? WHERE id = ?`).run(nowIso(), row.board_id);
  return { removed: true };
}

function listWorkspaceTaskSummary(workspaceId, userId) {
  ensureBoardTables();
  assertActiveMember(workspaceId, userId);
  const members = listWorkspaceMembers(workspaceId, userId).filter((m) => m.status === "active");
  const openTasks = getDb()
    .prepare(
      `SELECT * FROM board_tasks
       WHERE workspace_id = ? AND completed = 0
       ORDER BY updated_at DESC`
    )
    .all(workspaceId)
    .map(mapTask);

  const byMember = members.map((member) => ({
    userId: member.userId,
    label: member.label || member.userId,
    role: member.role,
    kind: "member",
    tasks: openTasks.filter((task) => task.assigneeUserId === member.userId),
  }));

  const unassigned = openTasks.filter((task) => !task.assigneeUserId);
  return [
    ...byMember,
    {
      userId: "",
      label: "Unassigned",
      role: "inbox",
      kind: "unassigned",
      tasks: unassigned,
    },
  ];
}

function listAssignedTasksForUser(userId) {
  ensureBoardTables();
  const id = String(userId || "")
    .trim()
    .toLowerCase();
  if (!id) return [];
  const rows = getDb()
    .prepare(
      `SELECT t.*, b.name AS board_name, w.name AS workspace_name
       FROM board_tasks t
       INNER JOIN boards b ON b.id = t.board_id
       INNER JOIN workspaces w ON w.id = t.workspace_id
       INNER JOIN workspace_members m
         ON m.workspace_id = t.workspace_id AND m.user_id = ? AND m.status = 'active'
       WHERE t.assignee_user_id = ? AND t.completed = 0
       ORDER BY t.due_date IS NULL, t.due_date ASC, t.updated_at DESC`
    )
    .all(id, id);
  return rows.map((row) => ({
    ...mapTask(row),
    boardName: row.board_name || "Team board",
    workspaceName: row.workspace_name || "Workspace",
  }));
}

module.exports = {
  addColumn,
  addTask,
  createBoard,
  deleteBoard,
  deleteColumn,
  deleteTask,
  ensureBoardTables,
  ensureDefaultBoardForWorkspace,
  getBoard,
  listAssignedTasksForUser,
  listBoardsForWorkspace,
  listWorkspaceTaskSummary,
  updateColumn,
  updateTask,
};
