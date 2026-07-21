const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const tls = require("node:tls");
const {
  consumeOauthState,
  createOauthState,
  getDb,
  getMailAccountById,
  listMailAccounts,
  removeMailAccount,
  removeMailAccountByProviderEmail,
  upsertMailAccount,
} = require("./db");
const { isAgentConfigured, runTodoAgent } = require("./agent");
const { runGlobalAgent } = require("./global-agent");
const { summarizeInboxMessages } = require("./mail-digest");
const {
  getDefaultStore: getUserSnapshotStore,
  isSupabaseSnapshotStoreConfigured,
} = require("./user-snapshot-store");
const {
  acceptWorkspaceInvite,
  createWorkspace,
  createWorkspaceInvite,
  deleteWorkspace,
  getInviteByToken,
  leaveWorkspace,
  listPendingInvitesForWorkspace,
  listWorkspaceMembers,
  listWorkspacesForUser,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateMemberRole,
} = require("./workspace-store");
const {
  addColumn,
  addTask,
  createBoard,
  deleteBoard,
  deleteColumn,
  deleteTask,
  ensureDefaultBoardForWorkspace,
  getBoard,
  listAssignedTasksForUser,
  listBoardsForWorkspace,
  listWorkspaceTaskSummary,
  updateColumn,
  updateTask,
} = require("./board-store");
const {
  countUnreadNotifications,
  ensureNotificationTables,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} = require("./notification-store");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = "daily_space_session";

loadEnv();
getDb();

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendError(response, error);
  });
});

server.listen(PORT, () => {
  console.log(`Daily Space server running at http://localhost:${PORT}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  serveStatic(response, url.pathname);
}

async function handleApi(request, response, url) {
  const method = request.method || "GET";
  const session = readSessionFromRequest(request);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, {
      ok: true,
      now: new Date().toISOString(),
      alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      agentConfigured: isAgentConfigured(),
      supabaseConfigured: isSupabaseSnapshotStoreConfigured(),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/agent/status") {
    sendJson(response, { ok: true, configured: isAgentConfigured() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/agent") {
    const body = await readJson(request);
    const result = await runGlobalAgent({
      message: body.message,
      context: body.context,
      today: body.today,
      currentPage: body.currentPage,
    });
    sendJson(response, { ok: true, ...result });
    return;
  }

  if (method === "POST" && url.pathname === "/api/agent/todo") {
    const body = await readJson(request);
    const result = await runTodoAgent({
      message: body.message,
      todos: body.todos,
      categories: body.categories,
      today: body.today,
    });
    sendJson(response, { ok: true, ...result });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(response, { user: session || null });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    clearSessionCookie(response);
    sendJson(response, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/user/snapshot") {
    enforceUserSession(session);
    const snapshot = await getUserSnapshotStore().getSnapshot(session.userId);
    sendJson(response, {
      ok: true,
      userId: session.userId,
      payload: snapshot?.payload || {},
      updatedAt: snapshot?.updatedAt || null,
    });
    return;
  }

  if (method === "PUT" && url.pathname === "/api/user/snapshot") {
    enforceUserSession(session);
    const body = await readJson(request);
    const payload = body && typeof body.payload === "object" && body.payload ? body.payload : {};
    const saved = await getUserSnapshotStore().upsertSnapshot(session.userId, payload);
    sendJson(response, {
      ok: true,
      userId: saved.userId,
      updatedAt: saved.updatedAt,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/workspaces") {
    enforceUserSession(session);
    sendJson(response, { workspaces: listWorkspacesForUser(session.userId) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspaces") {
    enforceUserSession(session);
    const body = await readJson(request);
    const workspace = createWorkspace({
      ownerUserId: session.userId,
      name: body.name,
      ownerLabel: session.label || session.email || session.userId,
    });
    const board = ensureDefaultBoardForWorkspace(workspace.id, session.userId);
    sendJson(response, { workspace, board }, 201);
    return;
  }

  const workspaceBoardsMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/boards$/);
  if (method === "GET" && workspaceBoardsMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceBoardsMatch[1]);
    sendJson(response, { boards: listBoardsForWorkspace(workspaceId, session.userId) });
    return;
  }

  if (method === "POST" && workspaceBoardsMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceBoardsMatch[1]);
    const body = await readJson(request);
    const board = createBoard({
      workspaceId,
      name: body.name,
      userId: session.userId,
    });
    sendJson(response, { board }, 201);
    return;
  }

  const workspaceTaskSummaryMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/task-summary$/);
  if (method === "GET" && workspaceTaskSummaryMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceTaskSummaryMatch[1]);
    sendJson(response, {
      summary: listWorkspaceTaskSummary(workspaceId, session.userId),
    });
    return;
  }

  const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
  if (method === "GET" && boardMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardMatch[1]);
    sendJson(response, { board: getBoard(boardId, session.userId) });
    return;
  }

  if (method === "DELETE" && boardMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardMatch[1]);
    sendJson(response, deleteBoard(boardId, session.userId));
    return;
  }

  const boardColumnsMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/columns$/);
  if (method === "POST" && boardColumnsMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardColumnsMatch[1]);
    const body = await readJson(request);
    const column = addColumn(boardId, session.userId, body || {});
    sendJson(response, { column }, 201);
    return;
  }

  const boardColumnMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/columns\/([^/]+)$/);
  if (method === "PATCH" && boardColumnMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardColumnMatch[1]);
    const columnId = decodeURIComponent(boardColumnMatch[2]);
    const body = await readJson(request);
    const column = updateColumn(boardId, columnId, session.userId, body || {});
    sendJson(response, { column });
    return;
  }

  if (method === "DELETE" && boardColumnMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardColumnMatch[1]);
    const columnId = decodeURIComponent(boardColumnMatch[2]);
    sendJson(response, deleteColumn(boardId, columnId, session.userId));
    return;
  }

  const boardTasksMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/tasks$/);
  if (method === "POST" && boardTasksMatch) {
    enforceUserSession(session);
    const boardId = decodeURIComponent(boardTasksMatch[1]);
    const body = await readJson(request);
    const task = addTask(boardId, session.userId, body || {});
    sendJson(response, { task }, 201);
    return;
  }

  if (method === "GET" && url.pathname === "/api/me/tasks") {
    enforceUserSession(session);
    sendJson(response, {
      tasks: listAssignedTasksForUser(session.userId),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/me/notifications") {
    enforceUserSession(session);
    ensureNotificationTables();
    const limit = Number(url.searchParams.get("limit") || 40);
    sendJson(response, {
      notifications: listNotificationsForUser(session.userId, { limit }),
      unreadCount: countUnreadNotifications(session.userId),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/me/notifications/read-all") {
    enforceUserSession(session);
    sendJson(response, markAllNotificationsRead(session.userId));
    return;
  }

  const notificationReadMatch = url.pathname.match(/^\/api\/me\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && notificationReadMatch) {
    enforceUserSession(session);
    const notificationId = decodeURIComponent(notificationReadMatch[1]);
    sendJson(response, {
      notification: markNotificationRead(notificationId, session.userId),
    });
    return;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "PATCH" && taskMatch) {
    enforceUserSession(session);
    const taskId = decodeURIComponent(taskMatch[1]);
    const body = await readJson(request);
    const task = updateTask(taskId, session.userId, body || {});
    sendJson(response, { task });
    return;
  }

  if (method === "DELETE" && taskMatch) {
    enforceUserSession(session);
    const taskId = decodeURIComponent(taskMatch[1]);
    sendJson(response, deleteTask(taskId, session.userId));
    return;
  }

  const workspaceMembersMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  if (method === "GET" && workspaceMembersMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceMembersMatch[1]);
    sendJson(response, {
      members: listWorkspaceMembers(workspaceId, session.userId),
    });
    return;
  }

  const workspaceMemberMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/);
  if (method === "PATCH" && workspaceMemberMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceMemberMatch[1]);
    const targetUserId = decodeURIComponent(workspaceMemberMatch[2]);
    const body = await readJson(request);
    sendJson(response, {
      member: updateMemberRole(workspaceId, session.userId, targetUserId, body.role),
    });
    return;
  }

  if (method === "DELETE" && workspaceMemberMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceMemberMatch[1]);
    const targetUserId = decodeURIComponent(workspaceMemberMatch[2]);
    sendJson(response, removeWorkspaceMember(workspaceId, session.userId, targetUserId));
    return;
  }

  const workspaceLeaveMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/leave$/);
  if (method === "POST" && workspaceLeaveMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceLeaveMatch[1]);
    sendJson(response, leaveWorkspace(workspaceId, session.userId));
    return;
  }

  const workspaceDeleteMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (method === "DELETE" && workspaceDeleteMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceDeleteMatch[1]);
    sendJson(response, deleteWorkspace(workspaceId, session.userId));
    return;
  }

  const workspaceInvitesMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/invites$/);
  if (method === "GET" && workspaceInvitesMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceInvitesMatch[1]);
    sendJson(response, {
      invites: listPendingInvitesForWorkspace(workspaceId, session.userId),
    });
    return;
  }

  if (method === "POST" && workspaceInvitesMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceInvitesMatch[1]);
    const body = await readJson(request);
    const invite = createWorkspaceInvite({
      workspaceId,
      invitedBy: session.userId,
      email: body.email,
      role: body.role,
      inviterLabel: session.label || session.email || session.userId,
    });
    sendJson(response, { invite }, 201);
    return;
  }

  const workspaceInviteDeleteMatch = url.pathname.match(
    /^\/api\/workspaces\/([^/]+)\/invites\/([^/]+)$/
  );
  if (method === "DELETE" && workspaceInviteDeleteMatch) {
    enforceUserSession(session);
    const workspaceId = decodeURIComponent(workspaceInviteDeleteMatch[1]);
    const inviteId = decodeURIComponent(workspaceInviteDeleteMatch[2]);
    sendJson(response, revokeWorkspaceInvite(workspaceId, session.userId, inviteId));
    return;
  }

  const inviteTokenMatch = url.pathname.match(/^\/api\/invites\/([^/]+)$/);
  if (method === "GET" && inviteTokenMatch) {
    const token = decodeURIComponent(inviteTokenMatch[1]);
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
    sendJson(response, {
      invite: {
        workspaceId: invite.workspaceId,
        workspaceName: invite.workspaceName,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/invites/accept") {
    enforceUserSession(session);
    const body = await readJson(request);
    const workspace = acceptWorkspaceInvite({
      token: body.token,
      userId: session.userId,
      userLabel: session.label || session.email || session.userId,
    });
    sendJson(response, { workspace });
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/google/start") {
    const body = await readJson(request);
    const returnTo = sanitizeReturnTo(body.returnTo || "/todo.html");
    const state = crypto.randomUUID();
    const providerConfig = getGoogleSignInConfig(request);
    createOauthState({
      state,
      provider: "google-login",
      returnTo,
    });
    sendJson(response, {
      ok: true,
      authUrl: buildSignInAuthUrl("google", providerConfig, state),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/google/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");
    const stateInfo = consumeOauthState(state);
    const returnTo = sanitizeReturnTo(stateInfo?.returnTo || "/todo.html");

    if (!stateInfo || stateInfo.provider !== "google-login") {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "Sign-in state expired. Please try again.",
        })
      );
      return;
    }

    if (oauthError) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: oauthErrorDescription || oauthError,
        })
      );
      return;
    }

    if (!code) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "Missing OAuth code.",
        })
      );
      return;
    }

    try {
      const config = getGoogleSignInConfig(request);
      const token = await exchangeOauthCode("gmail", config, code);
      const profile = await fetchOauthProfile("gmail", token.access_token);
      const tokenClaims = parseJwtClaims(token.id_token);
      const email = String(profile.email || tokenClaims.email || "").trim().toLowerCase();
      const label = resolveDisplayName(profile, tokenClaims, email, "Google user");
      if (isValidEmail(email)) {
        upsertMailAccount({
          userId: email,
          provider: "gmail",
          email,
          profile: {
            source: "linked-user-auth",
            label,
          },
        });
      }
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "success",
          provider: "Google",
          label: label.slice(0, 80),
          email: email.slice(0, 120),
        }),
        302,
        {
          "Set-Cookie": buildSessionCookieValue({
            userId: email,
            email,
            provider: "Google",
            label,
          }),
        }
      );
      return;
    } catch (error) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: error.message || "Google sign-in failed.",
        })
      );
      return;
    }
  }

  if (method === "POST" && url.pathname === "/api/auth/outlook/start") {
    const body = await readJson(request);
    const returnTo = sanitizeReturnTo(body.returnTo || "/todo.html");
    const state = crypto.randomUUID();
    const providerConfig = getOutlookSignInConfig(request);
    createOauthState({
      state,
      provider: "outlook-login",
      returnTo,
    });
    sendJson(response, {
      ok: true,
      authUrl: buildSignInAuthUrl("outlook", providerConfig, state),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/outlook/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");
    const stateInfo = consumeOauthState(state);
    const returnTo = sanitizeReturnTo(stateInfo?.returnTo || "/todo.html");

    if (!stateInfo || stateInfo.provider !== "outlook-login") {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "Outlook sign-in state expired. Please try again.",
        })
      );
      return;
    }

    if (oauthError) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: oauthErrorDescription || oauthError,
        })
      );
      return;
    }

    if (!code) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "Missing Outlook OAuth code.",
        })
      );
      return;
    }

    try {
      const config = getOutlookSignInConfig(request);
      const token = await exchangeOauthCode("outlook", config, code);
      const profile = await fetchOauthProfile("outlook", token.access_token);
      const tokenClaims = parseJwtClaims(token.id_token);
      const email = String(
        profile.mail || profile.userPrincipalName || tokenClaims.email || tokenClaims.preferred_username || ""
      )
        .trim()
        .toLowerCase();
      if (!isValidEmail(email)) {
        throw Object.assign(new Error("Unable to read email from Microsoft profile."), { statusCode: 502 });
      }
      const label = resolveDisplayName(profile, tokenClaims, email, "Outlook user");
      upsertMailAccount({
        userId: email,
        provider: "outlook",
        email,
        profile: {
          source: "linked-user-auth",
          displayName: label,
          id: profile.id || tokenClaims.oid || null,
        },
      });
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "success",
          provider: "Outlook",
          label: label.slice(0, 80),
          email: email.slice(0, 120),
        }),
        302,
        {
          "Set-Cookie": buildSessionCookieValue({
            userId: email,
            email,
            provider: "Outlook",
            label,
          }),
        }
      );
      return;
    } catch (error) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: error.message || "Outlook sign-in failed.",
        })
      );
      return;
    }
  }

  if (method === "POST" && url.pathname === "/api/auth/wechat/start") {
    const body = await readJson(request);
    const returnTo = sanitizeReturnTo(body.returnTo || "/todo.html");
    const state = crypto.randomUUID();
    const providerConfig = getWeChatSignInConfig(request);
    createOauthState({
      state,
      provider: "wechat-login",
      returnTo,
    });
    sendJson(response, {
      ok: true,
      authUrl: buildWeChatAuthUrl(providerConfig, state),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth/wechat/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error") || url.searchParams.get("errcode");
    const oauthErrorDescription =
      url.searchParams.get("error_description") || url.searchParams.get("errmsg") || "";
    const stateInfo = consumeOauthState(state);
    const returnTo = sanitizeReturnTo(stateInfo?.returnTo || "/todo.html");

    if (!stateInfo || stateInfo.provider !== "wechat-login") {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "WeChat sign-in state expired. Please try again.",
        })
      );
      return;
    }

    if (oauthError) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: oauthErrorDescription || String(oauthError),
        })
      );
      return;
    }

    if (!code) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: "Missing WeChat OAuth code.",
        })
      );
      return;
    }

    try {
      const config = getWeChatSignInConfig(request);
      const token = await exchangeWeChatCode(config, code);
      const openid = String(token.openid || "").trim();
      if (!openid) {
        throw Object.assign(new Error("Unable to read WeChat openid."), { statusCode: 502 });
      }
      const profile = await fetchWeChatUserInfo(token.access_token, openid);
      const userId = `wechat:${openid}`.toLowerCase();
      const label =
        String(profile.nickname || "").trim().slice(0, 80) ||
        `WeChat ${openid.slice(0, 6)}`;
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "success",
          provider: "WeChat",
          label: label.slice(0, 80),
          email: userId.slice(0, 120),
        }),
        302,
        {
          "Set-Cookie": buildSessionCookieValue({
            userId,
            email: userId,
            provider: "WeChat",
            label,
          }),
        }
      );
      return;
    } catch (error) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          userauth: "error",
          message: error.message || "WeChat sign-in failed.",
        })
      );
      return;
    }
  }

  if (method === "GET" && url.pathname === "/api/mail/accounts") {
    enforceUserSession(session);
    sendJson(response, {
      accounts: listMailAccounts(session.userId).map((account) => ({
        ...account,
        provider: formatProviderLabel(account.provider),
      })),
    });
    return;
  }

  const mailDeleteMatch = url.pathname.match(/^\/api\/mail\/accounts\/([^/]+)$/);
  if (method === "DELETE" && mailDeleteMatch) {
    enforceUserSession(session);
    const removed = removeMailAccount(session.userId, decodeURIComponent(mailDeleteMatch[1]));
    sendJson(response, { removed });
    return;
  }

  if (method === "POST" && url.pathname === "/api/mail/accounts/disconnect-linked") {
    enforceUserSession(session);
    const body = await readJson(request);
    const provider = normalizeMailProvider(body.provider);
    const email = String(body.email || "").trim().toLowerCase();
    if (!provider || !isValidEmail(email)) {
      const error = new Error("Provider and email are required for linked disconnect.");
      error.statusCode = 400;
      throw error;
    }
    const removed = removeMailAccountByProviderEmail(session.userId, provider, email);
    sendJson(response, { removed });
    return;
  }

  const mailMessagesMatch = url.pathname.match(/^\/api\/mail\/accounts\/([^/]+)\/messages$/);
  if (method === "GET" && mailMessagesMatch) {
    enforceUserSession(session);
    const accountId = decodeURIComponent(mailMessagesMatch[1]);
    const account = getMailAccountById(session.userId, accountId);
    if (!account) {
      const error = new Error("Mail account not found.");
      error.statusCode = 404;
      throw error;
    }
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));
    const messages = await fetchRecentMessagesForAccount(account, limit);
    sendJson(response, {
      account: {
        id: account.id,
        provider: formatProviderLabel(account.provider),
        email: account.email,
      },
      messages,
    });
    return;
  }

  const mailDigestMatch = url.pathname.match(/^\/api\/mail\/accounts\/([^/]+)\/digest$/);
  if (method === "GET" && mailDigestMatch) {
    enforceUserSession(session);
    const accountId = decodeURIComponent(mailDigestMatch[1]);
    const account = getMailAccountById(session.userId, accountId);
    if (!account) {
      const error = new Error("Mail account not found.");
      error.statusCode = 404;
      throw error;
    }
    const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") || 12)));
    const messages = await fetchRecentMessagesForAccount(account, limit);
    const today =
      typeof url.searchParams.get("today") === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("today") || "")
        ? url.searchParams.get("today")
        : new Date().toISOString().slice(0, 10);
    const { digest, summaries, summarized } = await summarizeInboxMessages(messages, today);
    sendJson(response, {
      account: {
        id: account.id,
        provider: formatProviderLabel(account.provider),
        email: account.email,
      },
      digest,
      summarized,
      agentConfigured: isAgentConfigured(),
      messages: messages.map((item) => ({
        ...item,
        summary: summaries[item.id] || item.snippet || item.subject || "",
      })),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/mail/accounts/manual") {
    enforceUserSession(session);
    const body = await readJson(request);
    const provider = normalizeMailProvider(body.provider);
    if (!provider) {
      const error = new Error("Unsupported mail provider.");
      error.statusCode = 400;
      throw error;
    }
    const email = String(body.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      const error = new Error("Please enter a valid email address.");
      error.statusCode = 400;
      throw error;
    }
    const row = upsertMailAccount({
      userId: session.userId,
      provider,
      email,
      profile: { source: "manual" },
    });
    sendJson(
      response,
      {
        account: {
          id: row.id,
          provider: formatProviderLabel(row.provider),
          email: row.email,
          connectedAt: row.connected_at,
          updatedAt: row.updated_at,
        },
      },
      201
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/mail/accounts/link-from-auth") {
    enforceUserSession(session);
    const body = await readJson(request);
    const provider = normalizeMailProvider(body.provider);
    const email = String(body.email || "").trim().toLowerCase();
    const label = String(body.label || "").trim();
    if (!(provider === "gmail" || provider === "outlook") || !isValidEmail(email)) {
      const error = new Error("Valid provider and email are required.");
      error.statusCode = 400;
      throw error;
    }
    const row = upsertMailAccount({
      userId: session.userId,
      provider,
      email,
      profile: {
        source: "linked-user-auth",
        label: label || null,
      },
    });
    sendJson(
      response,
      {
        account: {
          id: row.id,
          provider: formatProviderLabel(row.provider),
          email: row.email,
          connectedAt: row.connected_at,
          updatedAt: row.updated_at,
        },
      },
      201
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/mail/accounts/icloud") {
    enforceUserSession(session);
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const appPassword = String(body.appPassword || "").trim();
    if (!isValidEmail(email)) {
      const error = new Error("Please enter a valid iCloud email address.");
      error.statusCode = 400;
      throw error;
    }
    if (!appPassword || appPassword.replace(/[\s-]/g, "").length < 16) {
      const error = new Error("Please enter a valid iCloud app-specific password.");
      error.statusCode = 400;
      throw error;
    }

    await verifyIcloudImapLogin(email, appPassword);
    const encryptedAppPassword = sealToken(appPassword.replace(/\s+/g, ""));
    const row = upsertMailAccount({
      userId: session.userId,
      provider: "icloud",
      email,
      refreshToken: encryptedAppPassword,
      tokenType: "app-password",
      scope: "imap",
      profile: { source: "icloud-imap", host: "imap.mail.me.com", port: 993 },
    });
    sendJson(
      response,
      {
        account: {
          id: row.id,
          provider: formatProviderLabel(row.provider),
          email: row.email,
          connectedAt: row.connected_at,
          updatedAt: row.updated_at,
        },
      },
      201
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/mail/oauth/start") {
    const body = await readJson(request);
    const provider = normalizeMailProvider(body.provider);
    if (!provider || (provider !== "gmail" && provider !== "outlook")) {
      const error = new Error("OAuth currently supports Gmail and Outlook only.");
      error.statusCode = 400;
      throw error;
    }
    const emailHint = String(body.email || "").trim().toLowerCase();
    if (emailHint && !isValidEmail(emailHint)) {
      const error = new Error("Please enter a valid email address.");
      error.statusCode = 400;
      throw error;
    }
    const providerConfig = getOauthProviderConfig(provider, request);
    const state = crypto.randomUUID();
    const returnTo = sanitizeReturnTo(body.returnTo);
    createOauthState({
      state,
      provider,
      emailHint: emailHint || null,
      returnTo,
    });
    sendJson(response, {
      ok: true,
      authUrl: buildOauthAuthUrl(provider, providerConfig, state, emailHint),
    });
    return;
  }

  const callbackMatch = url.pathname.match(/^\/api\/mail\/oauth\/(google|outlook)\/callback$/);
  if (method === "GET" && callbackMatch) {
    const callbackProvider = callbackMatch[1] === "google" ? "gmail" : "outlook";
    const providerLabel = formatProviderLabel(callbackProvider);
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");

    const stateInfo = consumeOauthState(state);
    const returnTo = sanitizeReturnTo(stateInfo?.returnTo || "/mail.html");
    if (!stateInfo || stateInfo.provider !== callbackProvider) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          oauth: "error",
          provider: providerLabel,
          message: "OAuth state expired. Please retry.",
        })
      );
      return;
    }

    if (oauthError) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          oauth: "error",
          provider: providerLabel,
          message: oauthErrorDescription || oauthError,
        })
      );
      return;
    }

    if (!code) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          oauth: "error",
          provider: providerLabel,
          message: "Missing OAuth code.",
        })
      );
      return;
    }

    try {
      const config = getOauthProviderConfig(callbackProvider, request);
      const token = await exchangeOauthCode(callbackProvider, config, code);
      const profile = await fetchOauthProfile(callbackProvider, token.access_token);
      const email =
        (profile.email || profile.mail || profile.userPrincipalName || stateInfo.emailHint || "").trim().toLowerCase();
      if (!isValidEmail(email)) {
        throw Object.assign(new Error("Unable to read mailbox email from provider profile."), { statusCode: 502 });
      }
      const encryptedAccessToken = sealToken(token.access_token);
      const encryptedRefreshToken = token.refresh_token ? sealToken(token.refresh_token) : null;
      upsertMailAccount({
        userId: email,
        provider: callbackProvider,
        email,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenType: token.token_type || "Bearer",
        scope: token.scope || null,
        expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
        profile: {
          displayName: profile.name || profile.displayName || null,
          id: profile.sub || profile.id || null,
          raw: profile,
        },
      });
      const label = String(profile.name || profile.displayName || email || `${providerLabel} user`).trim();
      sendRedirect(
        response,
        withQuery(returnTo, {
          oauth: "success",
          provider: providerLabel,
          label: label.slice(0, 80),
          email,
        }),
        302,
        {
          "Set-Cookie": buildSessionCookieValue({
            userId: email,
            email,
            provider: providerLabel,
            label,
          }),
        }
      );
      return;
    } catch (error) {
      sendRedirect(
        response,
        withQuery(returnTo, {
          oauth: "error",
          provider: providerLabel,
          message: error.message || "Authorization failed.",
        })
      );
      return;
    }
  }

  const error = new Error("API route not found.");
  error.statusCode = 404;
  throw error;
}

function serveStatic(response, pathname) {
  const cleanPath = decodeURIComponent(pathname.split("?")[0]);
  let relative = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  if (relative === "stocks" || relative === "stocks.html") {
    sendText(response, "Stock signals UI was removed. Use Daily Space productivity pages instead.", 410);
    return;
  }

  const filePath = path.resolve(ROOT_DIR, relative);
  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(response, "Forbidden", 403);
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, "Not found", 404);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendRedirect(response, location, status = 302, extraHeaders = {}) {
  response.writeHead(status, {
    Location: location,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end();
}

function enforceUserSession(session) {
  if (session && session.userId) return;
  const error = new Error("Please sign in first.");
  error.statusCode = 401;
  throw error;
}

function getSessionSecret() {
  const source = String(process.env.APP_SESSION_SECRET || process.env.MAIL_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!source) return null;
  return crypto.createHash("sha256").update(source).digest("hex");
}

function signSessionPayload(payloadJson) {
  const secret = getSessionSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
}

function serializeSession(session) {
  const payloadJson = JSON.stringify(session);
  const payload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = signSessionPayload(payloadJson);
  if (!signature) return "";
  return `${payload}.${signature}`;
}

function parseCookieHeader(header) {
  const raw = String(header || "");
  if (!raw) return {};
  const result = {};
  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    result[key] = value;
  });
  return result;
}

function readSessionFromRequest(request) {
  const cookies = parseCookieHeader(request.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || !token.includes(".")) return null;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  let payloadJson = "";
  try {
    payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8");
  } catch (_) {
    return null;
  }
  const expectedSignature = signSessionPayload(payloadJson);
  if (!expectedSignature || signaturePart !== expectedSignature) return null;
  let parsed;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const userId = String(parsed.userId || "").trim().toLowerCase();
  const email = String(parsed.email || "").trim().toLowerCase();
  if (!userId || !email) return null;
  return {
    userId,
    email,
    provider: String(parsed.provider || "").trim() || "User",
    label: String(parsed.label || "").trim() || email,
  };
}

function sessionCookieSecuritySuffix() {
  const publicUrl = String(process.env.MAIL_OAUTH_BASE_URL || process.env.RENDER_EXTERNAL_URL || "");
  return process.env.NODE_ENV === "production" || publicUrl.startsWith("https://") ? "; Secure" : "";
}

function buildSessionCookieValue(session) {
  const token = serializeSession(session);
  if (!token) return "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${sessionCookieSecuritySuffix()}`;
}

function setSessionCookie(response, session) {
  const cookie = buildSessionCookieValue(session);
  if (!cookie) return;
  response.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${sessionCookieSecuritySuffix()}`
  );
}

function sendError(response, error) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(error);
  sendJson(response, { error: error.message || "Unexpected server error." }, status);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[ext] || "application/octet-stream"
  );
}

function normalizeMailProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "google") return "gmail";
  if (normalized === "microsoft") return "outlook";
  if (normalized === "gmail" || normalized === "outlook" || normalized === "icloud" || normalized === "other")
    return normalized;
  return "";
}

function formatProviderLabel(provider) {
  if (provider === "gmail") return "Gmail";
  if (provider === "outlook") return "Outlook";
  if (provider === "icloud") return "iCloud";
  if (provider === "other") return "Other mail";
  return provider;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function sanitizeReturnTo(input) {
  const raw = String(input || "/mail.html").trim();
  if (!raw.startsWith("/")) return "/mail.html";
  if (raw.startsWith("//")) return "/mail.html";
  return raw;
}

function withQuery(pathname, params) {
  const [base, existingQuery] = String(pathname || "/mail.html").split("?");
  const query = new URLSearchParams(existingQuery || "");
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${base}?${queryString}` : base;
}

function getBaseUrl(request) {
  const host = request.headers.host || "localhost:3000";
  const configured = String(process.env.MAIL_OAUTH_BASE_URL || process.env.RENDER_EXTERNAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  return `http://${host}`;
}

function getOauthProviderConfig(provider, request) {
  const baseUrl = getBaseUrl(request);
  if (provider === "gmail") {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || `${baseUrl}/api/mail/oauth/google/callback`;
    if (!clientId || !clientSecret) {
      const error = new Error("Google OAuth env is missing (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).");
      error.statusCode = 500;
      throw error;
    }
    return {
      clientId,
      clientSecret,
      redirectUri,
      scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }

  if (provider === "outlook") {
    const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI || `${baseUrl}/api/mail/oauth/outlook/callback`;
    if (!clientId || !clientSecret) {
      const error = new Error(
        "Microsoft OAuth env is missing (MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET)."
      );
      error.statusCode = 500;
      throw error;
    }
    return {
      clientId,
      clientSecret,
      redirectUri,
      scope: "offline_access openid profile email https://graph.microsoft.com/Mail.Read",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    };
  }

  const error = new Error("Unsupported OAuth provider.");
  error.statusCode = 400;
  throw error;
}

function getGoogleSignInConfig(request) {
  const baseUrl = getBaseUrl(request);
  const clientId = process.env.GOOGLE_SIGNIN_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SIGNIN_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_SIGNIN_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
  if (!clientId || !clientSecret) {
    const error = new Error(
      "Google sign-in env is missing (GOOGLE_SIGNIN_CLIENT_ID / GOOGLE_SIGNIN_CLIENT_SECRET, or GOOGLE_OAUTH_* fallback)."
    );
    error.statusCode = 500;
    throw error;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    // Identity only — never request Gmail scopes on the login client.
    scope: "openid email profile",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  };
}

function getOutlookSignInConfig(request) {
  const baseUrl = getBaseUrl(request);
  const clientId = process.env.MICROSOFT_SIGNIN_CLIENT_ID || process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_SIGNIN_CLIENT_SECRET || process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_SIGNIN_REDIRECT_URI || `${baseUrl}/api/auth/outlook/callback`;
  if (!clientId || !clientSecret) {
    const error = new Error(
      "Microsoft sign-in env is missing (MICROSOFT_SIGNIN_CLIENT_ID / MICROSOFT_SIGNIN_CLIENT_SECRET, or MICROSOFT_OAUTH_* fallback)."
    );
    error.statusCode = 500;
    throw error;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    // Identity / profile only — Mail.Read stays on the mail OAuth client.
    scope: "openid profile email User.Read",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  };
}

function getWeChatSignInConfig(request) {
  const baseUrl = getBaseUrl(request);
  const clientId = process.env.WECHAT_OAUTH_APP_ID;
  const clientSecret = process.env.WECHAT_OAUTH_APP_SECRET;
  const redirectUri = process.env.WECHAT_SIGNIN_REDIRECT_URI || `${baseUrl}/api/auth/wechat/callback`;
  if (!clientId || !clientSecret) {
    const error = new Error("WeChat OAuth env is missing (WECHAT_OAUTH_APP_ID / WECHAT_OAUTH_APP_SECRET).");
    error.statusCode = 500;
    throw error;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    scope: "snsapi_login",
    authUrl: "https://open.weixin.qq.com/connect/qrconnect",
  };
}

function buildWeChatAuthUrl(config, state) {
  const params = new URLSearchParams({
    appid: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope || "snsapi_login",
    state,
  });
  return `${config.authUrl}?${params.toString()}#wechat_redirect`;
}

async function exchangeWeChatCode(config, code) {
  const params = new URLSearchParams({
    appid: config.clientId,
    secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errcode) {
    const error = new Error(payload.errmsg || "WeChat token exchange failed.");
    error.statusCode = 502;
    throw error;
  }
  if (!payload.access_token || !payload.openid) {
    const error = new Error("WeChat token response missing access_token or openid.");
    error.statusCode = 502;
    throw error;
  }
  return payload;
}

async function fetchWeChatUserInfo(accessToken, openid) {
  if (!accessToken || !openid) return {};
  try {
    const params = new URLSearchParams({
      access_token: accessToken,
      openid,
    });
    const response = await fetch(`https://api.weixin.qq.com/sns/userinfo?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errcode) return {};
    return payload && typeof payload === "object" ? payload : {};
  } catch (_) {
    return {};
  }
}

function parseJwtClaims(jwt) {
  const token = String(jwt || "").trim();
  if (!token || !token.includes(".")) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function resolveDisplayName(profile, tokenClaims, email, fallback) {
  const fromProfile =
    profile?.name ||
    profile?.displayName ||
    [profile?.given_name, profile?.family_name].filter(Boolean).join(" ").trim() ||
    tokenClaims?.name ||
    [tokenClaims?.given_name, tokenClaims?.family_name].filter(Boolean).join(" ").trim();
  if (fromProfile) return String(fromProfile).trim();
  if (email && email.includes("@")) {
    return email.split("@")[0];
  }
  return fallback;
}

function buildSignInAuthUrl(provider, config, state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
  });
  if (provider === "google") {
    // Do not set include_granted_scopes — that would pull prior Gmail grants into login.
    params.set("prompt", "select_account");
  } else if (provider === "outlook") {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
  }
  return `${config.authUrl}?${params.toString()}`;
}

function buildOauthAuthUrl(provider, config, state, emailHint) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
  });
  if (provider === "gmail") {
    params.set("access_type", "offline");
    params.set("include_granted_scopes", "true");
    params.set("prompt", "consent");
    if (emailHint) params.set("login_hint", emailHint);
  } else if (provider === "outlook") {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
    if (emailHint) params.set("login_hint", emailHint);
  }
  return `${config.authUrl}?${params.toString()}`;
}

async function exchangeOauthCode(provider, config, code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || "Token exchange failed.";
    const error = new Error(`${formatProviderLabel(provider)} OAuth token exchange failed: ${message}`);
    error.statusCode = 502;
    throw error;
  }
  return payload;
}

async function fetchOauthProfile(provider, accessToken) {
  if (provider === "gmail") {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_description || "Unable to read Google profile.");
      error.statusCode = 502;
      throw error;
    }
    return payload;
  }
  if (provider === "outlook") {
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || "Unable to read Microsoft profile.");
      error.statusCode = 502;
      throw error;
    }
    return payload;
  }
  const error = new Error("Unsupported OAuth profile provider.");
  error.statusCode = 400;
  throw error;
}

function getTokenEncryptionKey() {
  const encoded = String(process.env.MAIL_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!encoded) {
    const error = new Error("MAIL_TOKEN_ENCRYPTION_KEY is required for secure token storage.");
    error.statusCode = 500;
    throw error;
  }
  let key;
  try {
    key = Buffer.from(encoded, "base64");
  } catch (_) {
    key = null;
  }
  if (!key || key.length !== 32) {
    const error = new Error("MAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    error.statusCode = 500;
    throw error;
  }
  return key;
}

function sealToken(value) {
  const key = getTokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function openToken(value) {
  const raw = String(value || "");
  if (!raw.startsWith("enc:v1:")) {
    const error = new Error("Token format is invalid.");
    error.statusCode = 500;
    throw error;
  }
  const parts = raw.split(":");
  if (parts.length !== 5) {
    const error = new Error("Token format is invalid.");
    error.statusCode = 500;
    throw error;
  }
  const [, , ivBase64, tagBase64, dataBase64] = parts;
  const key = getTokenEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const data = Buffer.from(dataBase64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function escapeImapQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function verifyIcloudImapLogin(email, appPassword) {
  const host = process.env.ICLOUD_IMAP_HOST || "imap.mail.me.com";
  const port = Number(process.env.ICLOUD_IMAP_PORT || 993);
  const timeoutMs = Number(process.env.ICLOUD_IMAP_TIMEOUT_MS || 12_000);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
      },
      () => {
        const loginCommand = `a001 LOGIN "${escapeImapQuoted(email)}" "${escapeImapQuoted(
          appPassword.replace(/\s+/g, "")
        )}"\r\n`;
        socket.write(loginCommand);
      }
    );

    let settled = false;
    let transcript = "";

    const finishOk = () => {
      if (settled) return;
      settled = true;
      socket.end("a002 LOGOUT\r\n");
      resolve();
    };

    const finishError = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      const error = new Error(message);
      error.statusCode = 401;
      reject(error);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => {
      finishError("iCloud IMAP verification timed out. Please try again.");
    });
    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      const wrapped = new Error(`Unable to reach iCloud IMAP: ${error.message || "network error"}`);
      wrapped.statusCode = 502;
      reject(wrapped);
    });
    socket.on("data", (chunk) => {
      transcript += chunk;
      if (/^a001 OK\b/m.test(transcript)) {
        finishOk();
        return;
      }
      if (/^a001 (NO|BAD)\b/m.test(transcript)) {
        finishError("iCloud login rejected. Use your Apple app-specific password.");
      }
    });
  });
}

async function fetchRecentMessagesForAccount(account, limit) {
  if (account.provider === "gmail") {
    return fetchRecentGmailMessages(account, limit);
  }
  if (account.provider === "outlook") {
    return fetchRecentOutlookMessages(account, limit);
  }
  if (account.provider === "icloud") {
    return fetchRecentIcloudMessages(account, limit);
  }
  return [];
}

async function fetchRecentGmailMessages(account, limit) {
  if (!account.accessToken) {
    const error = new Error("Gmail token missing for this account.");
    error.statusCode = 400;
    throw error;
  }
  const accessToken = openToken(account.accessToken);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(limit));
  listUrl.searchParams.set("q", "in:inbox");
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) {
    const error = new Error(
      listPayload.error?.message || listPayload.error_description || "Unable to read Gmail inbox list."
    );
    error.statusCode = 502;
    throw error;
  }
  const ids = Array.isArray(listPayload.messages) ? listPayload.messages.map((item) => item.id).filter(Boolean) : [];
  const tasks = ids.map(async (id) => {
    const detailResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const detailPayload = await detailResponse.json().catch(() => ({}));
    if (!detailResponse.ok) return null;
    const headers = Array.isArray(detailPayload.payload?.headers) ? detailPayload.payload.headers : [];
    const getHeader = (name) => headers.find((item) => String(item.name || "").toLowerCase() === name)?.value || "";
    return {
      id,
      subject: getHeader("subject") || "(No subject)",
      from: getHeader("from") || "Unknown sender",
      receivedAt: detailPayload.internalDate ? new Date(Number(detailPayload.internalDate)).toISOString() : null,
      snippet: String(detailPayload.snippet || "").trim().slice(0, 280),
    };
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

async function fetchRecentOutlookMessages(account, limit) {
  if (!account.accessToken) {
    const error = new Error("Outlook token missing for this account.");
    error.statusCode = 400;
    throw error;
  }
  const accessToken = openToken(account.accessToken);
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  url.searchParams.set("$top", String(limit));
  url.searchParams.set("$select", "id,subject,receivedDateTime,from,bodyPreview");
  url.searchParams.set("$orderby", "receivedDateTime DESC");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Unable to read Outlook inbox.");
    error.statusCode = 502;
    throw error;
  }
  const rows = Array.isArray(payload.value) ? payload.value : [];
  return rows.map((item) => ({
    id: item.id,
    subject: item.subject || "(No subject)",
    from: item.from?.emailAddress?.address || item.from?.emailAddress?.name || "Unknown sender",
    receivedAt: item.receivedDateTime || null,
    snippet: String(item.bodyPreview || "").trim().slice(0, 280),
  }));
}

async function fetchRecentIcloudMessages(account, limit) {
  if (!account.refreshToken) {
    const error = new Error("iCloud app-specific password missing for this account.");
    error.statusCode = 400;
    throw error;
  }
  const appPassword = openToken(account.refreshToken);
  return fetchIcloudImapEnvelopeList(account.email, appPassword, limit);
}

async function fetchIcloudImapEnvelopeList(email, appPassword, limit) {
  const host = process.env.ICLOUD_IMAP_HOST || "imap.mail.me.com";
  const port = Number(process.env.ICLOUD_IMAP_PORT || 993);
  const timeoutMs = Number(process.env.ICLOUD_IMAP_TIMEOUT_MS || 12_000);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
      },
      () => {
        socket.write(
          `a001 LOGIN "${escapeImapQuoted(email)}" "${escapeImapQuoted(appPassword.replace(/\s+/g, ""))}"\r\n`
        );
      }
    );

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(Object.assign(new Error("iCloud IMAP read timed out."), { statusCode: 504 }));
    });
    socket.on("error", (error) => {
      reject(Object.assign(new Error(`Unable to read iCloud inbox: ${error.message || "network error"}`), { statusCode: 502 }));
    });

    let stage = "login";
    let buffer = "";
    let searchResult = "";
    let fetchResult = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      if (stage === "login") {
        if (/^a001 OK\b/m.test(buffer)) {
          stage = "select";
          buffer = "";
          socket.write("a002 SELECT INBOX\r\n");
          return;
        }
        if (/^a001 (NO|BAD)\b/m.test(buffer)) {
          socket.destroy();
          reject(Object.assign(new Error("iCloud login rejected while reading inbox."), { statusCode: 401 }));
        }
      }
      if (stage === "select") {
        if (/^a002 OK\b/m.test(buffer)) {
          stage = "search";
          buffer = "";
          socket.write("a003 SEARCH ALL\r\n");
          return;
        }
        if (/^a002 (NO|BAD)\b/m.test(buffer)) {
          socket.destroy();
          reject(Object.assign(new Error("Unable to select iCloud INBOX."), { statusCode: 502 }));
        }
      }
      if (stage === "search") {
        const searchMatch = buffer.match(/\* SEARCH ([\d ]*)\r?\n/i);
        if (searchMatch) {
          searchResult = searchMatch[1] || "";
        }
        if (/^a003 OK\b/m.test(buffer)) {
          const ids = searchResult
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));
          const selected = ids.slice(-limit);
          if (!selected.length) {
            socket.end("a999 LOGOUT\r\n");
            resolve([]);
            return;
          }
          stage = "fetch";
          buffer = "";
          socket.write(`a004 FETCH ${selected.join(",")} (ENVELOPE)\r\n`);
          return;
        }
        if (/^a003 (NO|BAD)\b/m.test(buffer)) {
          socket.destroy();
          reject(Object.assign(new Error("Unable to search iCloud inbox."), { statusCode: 502 }));
        }
      }
      if (stage === "fetch") {
        fetchResult += chunk;
        if (/^a004 OK\b/m.test(fetchResult)) {
          const messages = parseImapEnvelopeFetch(fetchResult).slice(-limit).reverse();
          socket.end("a999 LOGOUT\r\n");
          resolve(messages);
        } else if (/^a004 (NO|BAD)\b/m.test(fetchResult)) {
          socket.destroy();
          reject(Object.assign(new Error("Unable to fetch iCloud message envelopes."), { statusCode: 502 }));
        }
      }
    });
  });
}

function parseImapEnvelopeFetch(raw) {
  const matches = [...raw.matchAll(/\* (\d+) FETCH .*?ENVELOPE \("([^"]*)" "([^"]*)" \(\("([^"]*)" (?:NIL|"([^"]*)") "([^"]*)" "([^"]*)"\)\) .*?\)\r?\n/gs)];
  return matches.map((match) => {
    const seq = match[1];
    const dateRaw = match[2];
    const subject = match[3] || "(No subject)";
    const fromName = match[4] && match[4] !== "NIL" ? match[4] : "";
    const mailbox = match[6] || "";
    const host = match[7] || "";
    const fromAddress = mailbox && host ? `${mailbox}@${host}` : fromName || "Unknown sender";
    let receivedAt = null;
    const parsedDate = Date.parse(dateRaw);
    if (Number.isFinite(parsedDate)) receivedAt = new Date(parsedDate).toISOString();
    return {
      id: `imap-${seq}`,
      subject,
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      receivedAt,
      snippet: "",
    };
  });
}

function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}
