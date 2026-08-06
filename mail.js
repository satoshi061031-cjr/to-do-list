(function () {
  const STORAGE_AUTH = "daily-space-auth-v1";
  const STORAGE_SELECTED = "daily-space-mail-selected-v1";
  let accounts = [];
  let selectedAccountId = "";
  let messagesRequestId = 0;

  const titleEl = document.getElementById("mail-title");
  const copyEl = document.getElementById("mail-copy");
  const pageStatus = document.getElementById("mail-page-status");
  const emptyConnect = document.getElementById("mail-empty-connect");
  const inboxPanel = document.getElementById("mail-inbox");
  const managePanel = document.getElementById("mail-manage");
  const switcher = document.getElementById("mail-account-switcher");
  const statusEl = document.getElementById("mail-status");
  const messageList = document.getElementById("mail-message-list");
  const accountList = document.getElementById("mail-account-list");
  const digestEl = document.getElementById("mail-digest");
  const refreshBtn = document.getElementById("mail-refresh");
  const aiBanner = document.getElementById("mail-ai-banner");
  const aiBannerCopy = document.getElementById("mail-ai-banner-copy");
  const batchBar = document.getElementById("mail-batch-bar");
  const selectAllEl = document.getElementById("mail-select-all");
  const addSelectedBtn = document.getElementById("mail-add-selected");
  const connectTitle = document.getElementById("mail-connect-title");
  const connectHint = document.getElementById("mail-connect-hint");
  const connectKicker = document.getElementById("mail-connect-kicker");
  const signInSpaceBtn = document.getElementById("mail-signin-space");
  const oauthQuick = document.getElementById("mail-oauth-quick");

  const POLL_MS = 120000;
  let pollTimer = null;
  let latestMessages = [];
  let selectedMailIds = new Set();
  let signedIn = false;
  let agentConfigured = null;

  function todayIso() {
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.todayIso === "function") {
      return window.DailySpaceAgentData.todayIso();
    }
    return new Date().toISOString().slice(0, 10);
  }

  function formatDate(value) {
    return new Date(value).toLocaleString(window.DailySpaceI18n?.localeTag(), {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char];
    });
  }

  function readSelectedId() {
    try {
      return String(localStorage.getItem(STORAGE_SELECTED) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeSelectedId(id) {
    selectedAccountId = String(id || "").trim();
    try {
      if (selectedAccountId) localStorage.setItem(STORAGE_SELECTED, selectedAccountId);
      else localStorage.removeItem(STORAGE_SELECTED);
    } catch (_) {
      /* ignore */
    }
  }

  function selectedAccount() {
    const ready = readyAccounts();
    return ready.find((account) => account.id === selectedAccountId) || ready[0] || null;
  }

  function setPageStatus(message, isError) {
    if (!pageStatus) return;
    if (!message) {
      pageStatus.hidden = true;
      pageStatus.textContent = "";
      pageStatus.classList.remove("is-error");
      return;
    }
    pageStatus.hidden = false;
    pageStatus.textContent = message;
    pageStatus.classList.toggle("is-error", Boolean(isError));
  }

  function setInboxStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
    statusEl.hidden = !message;
  }

  function updateHero() {
    const ready = readyAccounts();
    const account = selectedAccount();
    const connected = ready.length > 0;
    if (titleEl) titleEl.textContent = connected ? "Inbox digest" : "Mail";
    if (copyEl) {
      copyEl.textContent = connected
        ? account
          ? `${account.email} · auto-refreshes while this page is open`
          : "Your inbox digest"
        : "Pull your inbox, get a short digest, and turn mail into today’s tasks.";
    }
  }

  function setDigest(text) {
    if (!digestEl) return;
    const digestActions = document.getElementById("mail-digest-actions");
    if (!text) {
      digestEl.hidden = true;
      digestEl.textContent = "";
      if (digestActions) digestActions.hidden = true;
      return;
    }
    digestEl.hidden = false;
    digestEl.textContent = text;
    if (digestActions) digestActions.hidden = false;
  }

  function askAgentAboutMail() {
    const digest = String(digestEl?.textContent || "").trim();
    const openCount = latestMessages.length;
    const preferZh =
      window.DailySpaceI18n && typeof window.DailySpaceI18n.locale === "function"
        ? window.DailySpaceI18n.locale() === "zh"
        : String(document.documentElement.lang || "")
            .toLowerCase()
            .startsWith("zh");
    let seed;
    if (preferZh) {
      seed = digest
        ? `根据我的收件箱摘要：${digest}。请把重要的事项变成今天的待办。`
        : openCount
          ? `我有 ${openCount} 封最近邮件。请帮我把重要的变成今天的待办。`
          : "请帮我把重要邮件变成今天的待办。";
    } else {
      seed = digest
        ? `From my inbox digest: ${digest}. Turn the important ones into today’s tasks.`
        : openCount
          ? `I have ${openCount} recent inbox messages. Help me turn the important ones into today’s tasks.`
          : "Help me turn important mail into today’s tasks.";
    }
    if (window.DailySpaceAgentUi && typeof window.DailySpaceAgentUi.focusComposer === "function") {
      window.DailySpaceAgentUi.focusComposer(seed);
      return;
    }
    setInboxStatus("Open the Daily Space Agent to continue.", true);
  }

  function setAiBanner(show, reason) {
    if (!aiBanner) return;
    aiBanner.hidden = !show;
    if (!show || !aiBannerCopy) return;
    if (reason === "llm_failed") {
      aiBannerCopy.textContent =
        "Smart digest failed this time — showing message snippets. Refresh to retry.";
    } else {
      aiBannerCopy.textContent =
        "Smart digest is off right now. Inbox still works with short snippets.";
    }
  }

  async function refreshAgentStatus() {
    try {
      const response = await fetch("/api/agent/status");
      const data = await response.json().catch(() => ({}));
      agentConfigured = Boolean(data.configured);
    } catch (_) {
      agentConfigured = null;
    }
    if (agentConfigured === false && readyAccounts().length > 0) {
      setAiBanner(true, "agent_not_configured");
    }
  }

  function readyAccounts() {
    return accounts.filter((account) => account && account.hasCredentials !== false && !account.needsMailOAuth);
  }

  function mailTaskKey(message) {
    return `mail:${selectedAccountId || "inbox"}:${String(message?.id || "").trim()}`;
  }

  const MAIL_ADDED_KEY = "daily-space-mail-added-v1";

  function readAddedMailIds() {
    try {
      const raw = JSON.parse(localStorage.getItem(MAIL_ADDED_KEY) || "null");
      if (!raw || raw.date !== todayIso() || !Array.isArray(raw.ids)) return new Set();
      return new Set(raw.ids.map(String));
    } catch (_) {
      return new Set();
    }
  }

  function markMailAdded(message) {
    const key = mailTaskKey(message);
    if (!String(message?.id || "").trim()) return;
    const ids = readAddedMailIds();
    ids.add(key);
    try {
      localStorage.setItem(MAIL_ADDED_KEY, JSON.stringify({ date: todayIso(), ids: [...ids] }));
    } catch (_) {
      /* ignore */
    }
  }

  function alreadyAddedMail(message) {
    const key = mailTaskKey(message);
    if (readAddedMailIds().has(key)) return true;
    try {
      if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.getSnapshot === "function") {
        const snap = window.DailySpaceAgentData.getSnapshot();
        const todos = snap && snap.todo && Array.isArray(snap.todo.todos) ? snap.todo.todos : [];
        return todos.some((item) => item && !item.completed && item.sourceMailId === key);
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function mailTaskText(message) {
    const subject = String(message?.subject || "").trim() || "(No subject)";
    const summary = String(message?.summary || message?.snippet || "").trim();
    return (summary ? `Mail · ${subject} — ${summary}` : `Mail · ${subject}`).slice(0, 500);
  }

  function showTodayStatus(baseMessage) {
    setInboxStatus(baseMessage);
    if (statusEl) {
      const link = document.createElement("a");
      link.href = "todo.html#today";
      link.className = "mail-today-link";
      link.textContent = "Open Today";
      statusEl.appendChild(document.createTextNode(" "));
      statusEl.appendChild(link);
    }
  }

  function addMailAsTodayTask(message) {
    if (!message) return false;
    if (alreadyAddedMail(message)) {
      showTodayStatus("Already on Today.");
      return false;
    }
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.applyActions === "function") {
      const applied = window.DailySpaceAgentData.applyActions([
        {
          type: "todo_add",
          text: mailTaskText(message),
          dueDate: todayIso(),
          categoryName: null,
          sourceMailId: mailTaskKey(message),
        },
      ]);
      const ok = Array.isArray(applied) && applied.some((item) => item && item.ok !== false);
      if (!ok) {
        showTodayStatus("Already on Today.");
        markMailAdded(message);
        renderMessages(latestMessages);
        return false;
      }
      markMailAdded(message);
      showTodayStatus("Added to today’s to-do list.");
      renderMessages(latestMessages);
      return true;
    }
    setInboxStatus("Could not add task on this device.", true);
    return false;
  }

  function addSelectedAsTodayTasks() {
    const selected = latestMessages.filter((item) => selectedMailIds.has(item.id));
    if (!selected.length) {
      setInboxStatus("Select at least one message.", true);
      return;
    }
    if (!(window.DailySpaceAgentData && typeof window.DailySpaceAgentData.applyActions === "function")) {
      setInboxStatus("Could not add tasks on this device.", true);
      return;
    }
    const fresh = selected.filter((message) => !alreadyAddedMail(message));
    if (!fresh.length) {
      showTodayStatus("Selected messages are already on Today.");
      return;
    }
    const applied = window.DailySpaceAgentData.applyActions(
      fresh.map((message) => ({
        type: "todo_add",
        text: mailTaskText(message),
        dueDate: todayIso(),
        categoryName: null,
        sourceMailId: mailTaskKey(message),
      }))
    );
    const added = Array.isArray(applied) ? applied.filter((item) => item && item.ok !== false).length : 0;
    fresh.forEach(markMailAdded);
    selectedMailIds.clear();
    syncBatchBar();
    renderMessages(latestMessages);
    if (!added) {
      showTodayStatus("Selected messages are already on Today.");
      return;
    }
    showTodayStatus(`Added ${added} message${added === 1 ? "" : "s"} to Today.`);
  }

  function syncBatchBar() {
    if (!batchBar || !addSelectedBtn) return;
    const hasRows = latestMessages.length > 0;
    batchBar.hidden = !hasRows;
    const count = selectedMailIds.size;
    addSelectedBtn.disabled = count === 0;
    addSelectedBtn.textContent =
      count > 0 ? `Add ${count} selected to Today` : "Add selected to Today";
    if (selectAllEl) {
      selectAllEl.checked = hasRows && count === latestMessages.length;
      selectAllEl.indeterminate = count > 0 && count < latestMessages.length;
    }
  }

  function renderSwitcher() {
    if (!switcher) return;
    switcher.innerHTML = "";
    const ready = readyAccounts();
    if (ready.length <= 1) {
      switcher.hidden = true;
      return;
    }
    switcher.hidden = false;
    ready.forEach((account) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mail-account-pill";
      button.setAttribute("role", "tab");
      button.setAttribute("data-select-account", account.id);
      button.setAttribute("aria-selected", account.id === selectedAccountId ? "true" : "false");
      if (account.id === selectedAccountId) button.classList.add("is-active");
      button.innerHTML = `<span class="mail-account-pill-provider">${escapeHtml(account.provider)}</span><span class="mail-account-pill-email">${escapeHtml(account.email)}</span>`;
      switcher.appendChild(button);
    });
  }

  function renderManageAccounts() {
    if (!accountList) return;
    accountList.innerHTML = "";
    accounts.forEach((account) => {
      const ready = account.hasCredentials !== false && !account.needsMailOAuth;
      const row = document.createElement("div");
      row.className = "mail-account-row";
      row.innerHTML = `
        <div>
          <span class="mail-account-provider">${escapeHtml(account.provider)}</span>
          <span class="mail-account-email">${escapeHtml(account.email)}</span>
          <span class="mail-account-meta">${
            ready
              ? `Reading on this device · ${escapeHtml(formatDate(account.connectedAt))}`
              : "Needs mailbox authorization"
          }</span>
        </div>
        <div class="mail-account-actions">
          ${
            ready
              ? ""
              : `<button class="btn mail-reauth-btn" type="button" data-reauth-provider="${escapeHtml(
                  String(account.provider || "").toLowerCase()
                )}" data-reauth-email="${escapeHtml(account.email)}">Authorize reading</button>`
          }
          <button class="mail-disconnect" type="button" data-disconnect="${escapeHtml(account.id)}">Disconnect</button>
        </div>
      `;
      accountList.appendChild(row);
    });
  }

  function renderShell() {
    const ready = readyAccounts();
    const connected = ready.length > 0;
    if (emptyConnect) emptyConnect.hidden = connected;
    if (inboxPanel) inboxPanel.hidden = !connected;
    if (managePanel) managePanel.hidden = !(signedIn && accounts.length > 0);
    updateHero();
    renderSwitcher();
    renderManageAccounts();
  }

  function renderMessages(rows) {
    if (!messageList) return;
    latestMessages = Array.isArray(rows) ? rows : [];
    const validIds = new Set(latestMessages.map((item) => item.id).filter(Boolean));
    selectedMailIds = new Set([...selectedMailIds].filter((id) => validIds.has(id)));
    if (!latestMessages.length) {
      messageList.innerHTML = `<p class="mail-message-empty">No recent inbox messages.</p>`;
      syncBatchBar();
      return;
    }
    messageList.innerHTML = latestMessages
      .map((item) => {
        const subject = escapeHtml(item.subject || "(No subject)");
        const from = escapeHtml(item.from || "Unknown sender");
        const time = item.receivedAt ? escapeHtml(formatDate(item.receivedAt)) : "Unknown time";
        const summary = escapeHtml(item.summary || item.snippet || "");
        const id = escapeHtml(item.id || "");
        const checked = selectedMailIds.has(item.id) ? "checked" : "";
        const added = alreadyAddedMail(item);
        return `<article class="mail-message-item" data-mail-id="${id}">
          <label class="mail-message-check">
            <input type="checkbox" data-mail-check="${id}" ${checked} ${added ? "disabled" : ""} aria-label="Select ${subject}" />
          </label>
          <div class="mail-message-main">
            <strong>${subject}</strong>
            <span class="mail-message-from">${from}</span>
            ${summary ? `<p class="mail-message-summary">${summary}</p>` : ""}
            <span class="mail-message-time">${time}</span>
          </div>
          <button type="button" class="btn mail-add-task" data-add-task="${id}" ${added ? "disabled" : ""}>${
            added ? "On Today" : "Add as today’s task"
          }</button>
        </article>`;
      })
      .join("");
    syncBatchBar();
  }

  async function request(path, init) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const offline = new Error("You’re offline. Connect to refresh mail.");
      offline.code = "offline";
      throw offline;
    }
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload.error || "Request failed");
      if (payload.code) err.code = payload.code;
      throw err;
    }
    return payload;
  }

  function showMailLoadError(failText, code) {
    const needsReauth = code === "mail_reauth_required" || /reconnect|token missing|not authorized|expired/i.test(failText);
    setInboxStatus("");
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.classList.add("is-error");
      statusEl.textContent = "";
      statusEl.appendChild(document.createTextNode(`${failText} `));
      if (needsReauth) {
        const reauth = document.createElement("button");
        reauth.type = "button";
        reauth.className = "mail-retry-btn";
        reauth.textContent = "Reconnect mailbox";
        reauth.addEventListener("click", () => {
          const account = selectedAccount() || accounts[0];
          const provider = String(account?.provider || "gmail").toLowerCase();
          const tip = provider.includes("outlook") ? "outlook" : "gmail";
          const btn = document.querySelector(`.mail-oauth-btn[data-quick-provider="${tip}"]`);
          startOauth(tip, btn);
        });
        statusEl.appendChild(reauth);
      } else {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "mail-retry-btn";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => loadMessagesForSelected());
        statusEl.appendChild(retry);
      }
    }
    if (messageList) {
      messageList.innerHTML = `<p class="mail-message-empty is-error">${escapeHtml(failText)}</p>
          <button type="button" class="btn mail-retry-btn" data-mail-${needsReauth ? "reauth" : "retry"}>${
            needsReauth ? "Reconnect mailbox" : "Retry"
          }</button>`;
    }
  }

  async function loadMessagesForSelected(options) {
    const silent = Boolean(options && options.silent);
    const account = selectedAccount();
    if (!account || !messageList) return;
    const requestId = ++messagesRequestId;
    if (!silent) setInboxStatus("Pulling inbox and summarizing…");
    try {
      const lang =
        window.DailySpaceI18n && typeof window.DailySpaceI18n.localeTag === "function"
          ? window.DailySpaceI18n.localeTag()
          : document.documentElement.lang || "en";
      const payload = await request(
        `/api/mail/accounts/${encodeURIComponent(account.id)}/digest?limit=12&today=${encodeURIComponent(
          todayIso()
        )}&lang=${encodeURIComponent(lang)}`
      );
      if (requestId !== messagesRequestId) return;
      const rows = Array.isArray(payload.messages) ? payload.messages : [];
      setDigest(typeof payload.digest === "string" ? payload.digest : "");
      if (window.DailySpaceLoop && typeof window.DailySpaceLoop.writeCachedMailDigest === "function") {
        window.DailySpaceLoop.writeCachedMailDigest(payload.digest || "", Boolean(payload.summarized));
      }
      if (!silent) {
        if (payload.summarized) {
          setAiBanner(false);
          setInboxStatus("Inbox updated with AI digest.");
        } else if (
          payload.fallbackReason === "agent_not_configured" ||
          payload.agentConfigured === false ||
          agentConfigured === false
        ) {
          setAiBanner(true, "agent_not_configured");
          setInboxStatus("Inbox updated with snippets.");
        } else if (payload.fallbackReason === "llm_failed") {
          setAiBanner(true, "llm_failed");
          setInboxStatus("Inbox updated with snippets.");
        } else if (payload.fallbackReason === "empty") {
          setAiBanner(agentConfigured === false);
          setInboxStatus("Inbox is quiet.");
        } else {
          setAiBanner(agentConfigured === false);
          setInboxStatus("Inbox updated.");
        }
      } else {
        setInboxStatus("");
        if (
          payload.fallbackReason === "agent_not_configured" ||
          payload.agentConfigured === false ||
          agentConfigured === false
        ) {
          setAiBanner(true, "agent_not_configured");
        } else if (payload.fallbackReason === "llm_failed") {
          setAiBanner(true, "llm_failed");
        }
      }
      renderMessages(rows);
    } catch (error) {
      if (requestId !== messagesRequestId) return;
      setDigest("");
      selectedMailIds.clear();
      syncBatchBar();
      const failText = error.message || "Failed to load messages.";
      if (!silent) {
        showMailLoadError(failText, error.code);
      } else {
        setInboxStatus(failText, true);
      }
    }
  }

  function stopMailPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startMailPolling() {
    stopMailPolling();
    if (!readyAccounts().length) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      loadMessagesForSelected({ silent: true });
    }, POLL_MS);
  }

  function ensureSelectedAccount() {
    const ready = readyAccounts();
    if (!ready.length) {
      writeSelectedId("");
      return;
    }
    const preferred = readSelectedId();
    const match = ready.find((account) => account.id === preferred);
    writeSelectedId(match ? match.id : ready[0].id);
  }

  function openDailySpaceSignIn() {
    const entry = document.querySelector(".sidebar-auth-entry");
    if (entry instanceof HTMLElement) {
      entry.click();
      return;
    }
    setPageStatus("Open Menu → Sign in, then come back to Mail.", true);
  }

  function renderSignedOutConnect() {
    signedIn = false;
    accounts = [];
    selectedMailIds.clear();
    setAiBanner(false);
    if (batchBar) batchBar.hidden = true;
    if (emptyConnect) emptyConnect.hidden = false;
    if (inboxPanel) inboxPanel.hidden = true;
    if (managePanel) managePanel.hidden = true;
    if (connectKicker) connectKicker.textContent = "Sign in";
    if (connectTitle) connectTitle.textContent = "Sign in to Daily Space first";
    if (connectHint) {
      connectHint.textContent =
        "Mail digest needs a Daily Space account. Sign in, then connect Gmail or Outlook.";
    }
    if (signInSpaceBtn) signInSpaceBtn.hidden = false;
    if (oauthQuick) oauthQuick.hidden = true;
    updateHero();
    setDigest("");
    setPageStatus("Sign in to Daily Space to pull your inbox.");
  }

  function renderConnectMailbox() {
    if (connectKicker) connectKicker.textContent = "Connect";
    if (connectTitle) connectTitle.textContent = "Connect your mailbox";
    if (connectHint) {
      connectHint.textContent =
        "Connect Gmail or Outlook to pull recent mail and build today’s digest.";
    }
    if (signInSpaceBtn) signInSpaceBtn.hidden = true;
    if (oauthQuick) oauthQuick.hidden = false;
  }

  async function loadFromServer() {
    const me = await request("/api/auth/me");
    signedIn = Boolean(me && me.user);
    if (!signedIn) {
      renderSignedOutConnect();
      return;
    }

    const payload = await request("/api/mail/accounts");
    accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    ensureSelectedAccount();
    renderConnectMailbox();
    renderShell();
    if (readyAccounts().length) {
      setPageStatus("");
      await loadMessagesForSelected();
      startMailPolling();
    } else {
      stopMailPolling();
      setDigest("");
      latestMessages = [];
      if (accounts.some((account) => account.needsMailOAuth)) {
        setPageStatus("Mailbox needs authorization — connect Gmail or Outlook to read mail.");
      } else {
        setPageStatus("No mailbox yet — connect Gmail or Outlook below.");
      }
    }
  }

  function syncGlobalAuth(provider, label, email) {
    const providerLabel = String(provider || "Mail").trim();
    const displayLabel = String(label || email || `${providerLabel} user`).trim();
    const decoratedLabel = email ? `${displayLabel} (${email})` : displayLabel;
    const normalizedProvider = providerLabel.toLowerCase();
    const mailProvider =
      normalizedProvider.includes("gmail") || normalizedProvider.includes("google")
        ? "gmail"
        : normalizedProvider.includes("outlook") || normalizedProvider.includes("microsoft")
          ? "outlook"
          : "";
    try {
      localStorage.setItem(
        STORAGE_AUTH,
        JSON.stringify({
          provider: providerLabel,
          label: decoratedLabel,
          email: String(email || "").trim().toLowerCase(),
          mailProvider,
        })
      );
    } catch (_) {
      /* ignore auth sync failures */
    }
    window.dispatchEvent(new CustomEvent("daily-space-auth-updated"));
  }

  function handleOauthResultFromUrl() {
    const url = new URL(window.location.href);
    const oauth = url.searchParams.get("oauth");
    if (!oauth) return;
    const provider = url.searchParams.get("provider") || "Mail";
    const label = url.searchParams.get("label") || "";
    const email = url.searchParams.get("email") || "";
    const message = url.searchParams.get("message") || "";
    if (oauth === "success") {
      if (provider === "Gmail" || provider === "Outlook") {
        syncGlobalAuth(provider, label, email);
      }
      setPageStatus(`${provider} connected${email ? `: ${email}` : ""}`);
    } else {
      setPageStatus(`${provider} authorization failed${message ? `: ${message}` : ""}`, true);
    }
    url.searchParams.delete("oauth");
    url.searchParams.delete("provider");
    url.searchParams.delete("label");
    url.searchParams.delete("email");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function startOauth(provider, button, emailHint) {
    if (!(provider === "gmail" || provider === "outlook")) return;
    if (button) button.setAttribute("disabled", "true");
    setPageStatus("");
    try {
      const payload = await request("/api/mail/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          email: emailHint || "",
          returnTo: "/mail.html",
        }),
      });
      if (!payload.authUrl) throw new Error("Authorization URL not returned.");
      window.location.href = payload.authUrl;
    } catch (error) {
      setPageStatus(error.message || "Authorization failed.", true);
    } finally {
      if (button) button.removeAttribute("disabled");
    }
  }

  document.querySelectorAll(".mail-oauth-btn[data-quick-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      const provider = String(button.getAttribute("data-quick-provider") || "")
        .trim()
        .toLowerCase();
      startOauth(provider, button);
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadMessagesForSelected();
    });
  }

  if (selectAllEl) {
    selectAllEl.addEventListener("change", () => {
      if (selectAllEl.checked) {
        latestMessages.forEach((item) => {
          if (item.id) selectedMailIds.add(item.id);
        });
      } else {
        selectedMailIds.clear();
      }
      renderMessages(latestMessages);
    });
  }

  if (addSelectedBtn) {
    addSelectedBtn.addEventListener("click", () => addSelectedAsTodayTasks());
  }

  const askAgentBtn = document.getElementById("mail-ask-agent");
  if (askAgentBtn) {
    askAgentBtn.addEventListener("click", () => askAgentAboutMail());
  }

  if (signInSpaceBtn) {
    signInSpaceBtn.addEventListener("click", () => openDailySpaceSignIn());
  }

  window.addEventListener("daily-space-auth-updated", () => {
    loadFromServer().catch((error) => {
      setPageStatus(error.message || "Failed to load mail accounts.", true);
    });
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const selectId = target.closest("[data-select-account]")?.getAttribute("data-select-account");
    if (selectId) {
      if (selectId === selectedAccountId) return;
      writeSelectedId(selectId);
      updateHero();
      renderSwitcher();
      await loadMessagesForSelected();
      return;
    }

    const retry = target.closest("[data-mail-retry]");
    if (retry) {
      loadMessagesForSelected();
      return;
    }

    const reauthBtn = target.closest("[data-mail-reauth], [data-reauth-provider]");
    if (reauthBtn) {
      const providerRaw = reauthBtn.getAttribute("data-reauth-provider") || "";
      const emailHint = reauthBtn.getAttribute("data-reauth-email") || "";
      const provider = providerRaw.includes("outlook")
        ? "outlook"
        : providerRaw.includes("gmail") || providerRaw.includes("google")
          ? "gmail"
          : String(selectedAccount()?.provider || "gmail").toLowerCase().includes("outlook")
            ? "outlook"
            : "gmail";
      const tip = provider === "outlook" ? "outlook" : "gmail";
      const btn = document.querySelector(`.mail-oauth-btn[data-quick-provider="${tip}"]`);
      startOauth(tip, btn, emailHint);
      return;
    }

    const checkId = target.closest("[data-mail-check]")?.getAttribute("data-mail-check");
    if (checkId && target instanceof HTMLInputElement && target.type === "checkbox") {
      if (target.checked) selectedMailIds.add(checkId);
      else selectedMailIds.delete(checkId);
      syncBatchBar();
      return;
    }

    const addTaskId = target.closest("[data-add-task]")?.getAttribute("data-add-task");
    if (addTaskId) {
      const message = latestMessages.find((item) => item.id === addTaskId);
      if (message) addMailAsTodayTask(message);
      return;
    }

    const id = target.closest("[data-disconnect]")?.getAttribute("data-disconnect");
    if (!id) return;
    setPageStatus("");
    try {
      await request(`/api/mail/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadFromServer();
      setPageStatus("Mailbox disconnected.");
    } catch (error) {
      setPageStatus(error.message || "Failed to disconnect account.", true);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !readyAccounts().length) return;
    loadMessagesForSelected({ silent: true });
  });

  window.addEventListener("daily-space-locale-changed", () => {
    renderShell();
    if (accounts.length) loadMessagesForSelected();
  });

  handleOauthResultFromUrl();
  refreshAgentStatus().finally(() => {
    loadFromServer().catch((error) => {
      const message = error.message || "Failed to load mail accounts.";
      if (/sign in first/i.test(message)) {
        renderSignedOutConnect();
        return;
      }
      setPageStatus(message, true);
      if (emptyConnect) emptyConnect.hidden = false;
      if (inboxPanel) inboxPanel.hidden = true;
      if (managePanel) managePanel.hidden = true;
    });
  });
})();
