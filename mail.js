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
    return accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null;
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
    const account = selectedAccount();
    const connected = accounts.length > 0;
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
    if (!text) {
      digestEl.hidden = true;
      digestEl.textContent = "";
      return;
    }
    digestEl.hidden = false;
    digestEl.textContent = text;
  }

  function setAiBanner(show, reason) {
    if (!aiBanner) return;
    aiBanner.hidden = !show;
    if (!show || !aiBannerCopy) return;
    if (reason === "llm_failed") {
      aiBannerCopy.textContent =
        "AI digest failed this time — showing snippets. Refresh to retry, or check the server LLM key.";
    } else {
      aiBannerCopy.innerHTML =
        "Inbox still works with snippets. For richer digests, set <code>GROQ_API_KEY</code> in the server environment (local <code>.env</code> or Render), then restart.";
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
    // Only surface the no-key banner once a mailbox inbox is open.
    if (agentConfigured === false && accounts.length > 0) {
      setAiBanner(true, "agent_not_configured");
    }
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
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.applyActions === "function") {
      window.DailySpaceAgentData.applyActions([
        {
          type: "todo_add",
          text: mailTaskText(message),
          dueDate: todayIso(),
          categoryName: null,
        },
      ]);
      showTodayStatus("Added to today’s to-do list.");
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
    window.DailySpaceAgentData.applyActions(
      selected.map((message) => ({
        type: "todo_add",
        text: mailTaskText(message),
        dueDate: todayIso(),
        categoryName: null,
      }))
    );
    selectedMailIds.clear();
    syncBatchBar();
    renderMessages(latestMessages);
    showTodayStatus(`Added ${selected.length} message${selected.length === 1 ? "" : "s"} to Today.`);
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
    if (accounts.length <= 1) {
      switcher.hidden = true;
      return;
    }
    switcher.hidden = false;
    accounts.forEach((account) => {
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
      const row = document.createElement("div");
      row.className = "mail-account-row";
      row.innerHTML = `
        <div>
          <span class="mail-account-provider">${escapeHtml(account.provider)}</span>
          <span class="mail-account-email">${escapeHtml(account.email)}</span>
          <span class="mail-account-meta">Authorized on this device · ${escapeHtml(formatDate(account.connectedAt))}</span>
        </div>
        <div class="mail-account-actions">
          <button class="mail-disconnect" type="button" data-disconnect="${escapeHtml(account.id)}">Disconnect</button>
        </div>
      `;
      accountList.appendChild(row);
    });
  }

  function renderShell() {
    const connected = accounts.length > 0;
    if (emptyConnect) emptyConnect.hidden = connected;
    if (inboxPanel) inboxPanel.hidden = !connected;
    if (managePanel) managePanel.hidden = !connected;
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
        return `<article class="mail-message-item" data-mail-id="${id}">
          <label class="mail-message-check">
            <input type="checkbox" data-mail-check="${id}" ${checked} aria-label="Select ${subject}" />
          </label>
          <div class="mail-message-main">
            <strong>${subject}</strong>
            <span class="mail-message-from">${from}</span>
            ${summary ? `<p class="mail-message-summary">${summary}</p>` : ""}
            <span class="mail-message-time">${time}</span>
          </div>
          <button type="button" class="btn mail-add-task" data-add-task="${id}">Add as today’s task</button>
        </article>`;
      })
      .join("");
    syncBatchBar();
  }

  async function request(path, init) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function loadMessagesForSelected(options) {
    const silent = Boolean(options && options.silent);
    const account = selectedAccount();
    if (!account || !messageList) return;
    const requestId = ++messagesRequestId;
    if (!silent) setInboxStatus("Pulling inbox and summarizing…");
    try {
      const payload = await request(
        `/api/mail/accounts/${encodeURIComponent(account.id)}/digest?limit=12&today=${encodeURIComponent(todayIso())}`
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
          setInboxStatus("Inbox updated with snippets (AI digest not configured).");
        } else if (payload.fallbackReason === "llm_failed") {
          setAiBanner(true, "llm_failed");
          setInboxStatus("Inbox updated with snippet fallback (AI digest unavailable).");
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
        setInboxStatus("");
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.classList.add("is-error");
          statusEl.textContent = "";
          statusEl.appendChild(document.createTextNode(`${failText} `));
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "mail-retry-btn";
          retry.textContent = "Retry";
          retry.addEventListener("click", () => loadMessagesForSelected());
          statusEl.appendChild(retry);
        }
        messageList.innerHTML = `<p class="mail-message-empty is-error">${escapeHtml(failText)}</p>
          <button type="button" class="btn mail-retry-btn" data-mail-retry>Retry</button>`;
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
    if (!accounts.length) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      loadMessagesForSelected({ silent: true });
    }, POLL_MS);
  }

  function ensureSelectedAccount() {
    if (!accounts.length) {
      writeSelectedId("");
      return;
    }
    const preferred = readSelectedId();
    const match = accounts.find((account) => account.id === preferred);
    writeSelectedId(match ? match.id : accounts[0].id);
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
    if (accounts.length) {
      setPageStatus("");
      await loadMessagesForSelected();
      startMailPolling();
    } else {
      stopMailPolling();
      setDigest("");
      latestMessages = [];
      setPageStatus("No mailbox yet — connect Gmail or Outlook below.");
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

  async function startOauth(provider, button) {
    if (!(provider === "gmail" || provider === "outlook")) return;
    if (button) button.setAttribute("disabled", "true");
    setPageStatus("");
    try {
      const payload = await request("/api/mail/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          email: "",
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
    if (document.hidden || !accounts.length) return;
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
