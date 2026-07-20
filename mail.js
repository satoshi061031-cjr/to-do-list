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
    if (titleEl) titleEl.textContent = connected ? "Inbox" : "Mail";
    if (copyEl) {
      copyEl.textContent = connected
        ? account
          ? account.email
          : "Your recent messages"
        : "Recent messages will show up here.";
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
    if (!rows.length) {
      messageList.innerHTML = `<p class="mail-message-empty">No recent inbox messages.</p>`;
      return;
    }
    messageList.innerHTML = rows
      .map((item) => {
        const subject = escapeHtml(item.subject || "(No subject)");
        const from = escapeHtml(item.from || "Unknown sender");
        const time = item.receivedAt ? escapeHtml(formatDate(item.receivedAt)) : "Unknown time";
        return `<article class="mail-message-item"><strong>${subject}</strong><span class="mail-message-from">${from}</span><span class="mail-message-time">${time}</span></article>`;
      })
      .join("");
  }

  async function request(path, init) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function loadMessagesForSelected() {
    const account = selectedAccount();
    if (!account || !messageList) return;
    const requestId = ++messagesRequestId;
    setInboxStatus("Loading messages…");
    messageList.innerHTML = "";
    try {
      const payload = await request(
        `/api/mail/accounts/${encodeURIComponent(account.id)}/messages?limit=20`
      );
      if (requestId !== messagesRequestId) return;
      const rows = Array.isArray(payload.messages) ? payload.messages : [];
      setInboxStatus("");
      renderMessages(rows);
    } catch (error) {
      if (requestId !== messagesRequestId) return;
      setInboxStatus(error.message || "Failed to load messages.", true);
      messageList.innerHTML = `<p class="mail-message-empty is-error">${escapeHtml(error.message || "Failed to load messages.")}</p>`;
    }
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

  async function loadFromServer() {
    const payload = await request("/api/mail/accounts");
    accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    ensureSelectedAccount();
    renderShell();
    if (accounts.length) await loadMessagesForSelected();
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

  window.addEventListener("daily-space-locale-changed", () => {
    renderShell();
    if (accounts.length) loadMessagesForSelected();
  });

  handleOauthResultFromUrl();
  loadFromServer().catch((error) => {
    setPageStatus(error.message || "Failed to load mail accounts.", true);
    if (emptyConnect) emptyConnect.hidden = false;
    if (inboxPanel) inboxPanel.hidden = true;
    if (managePanel) managePanel.hidden = true;
  });
})();
