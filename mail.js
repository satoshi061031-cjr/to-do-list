(function () {
  const STORAGE_AUTH = "daily-space-auth-v1";
  let accounts = [];

  const form = document.getElementById("mail-connect-form");
  const providerSelect = document.getElementById("mail-provider");
  const addressInput = document.getElementById("mail-address");
  const icloudPasswordField = document.getElementById("mail-icloud-password-field");
  const icloudPasswordInput = document.getElementById("mail-icloud-password");
  const list = document.getElementById("mail-account-list");
  const empty = document.getElementById("mail-empty");
  const count = document.getElementById("mail-connected-count");
  const summary = document.getElementById("mail-connected-summary");

  function formatDate(value) {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function render() {
    if (!list || !empty || !count || !summary) return;
    list.innerHTML = "";
    count.textContent = String(accounts.length);
    summary.textContent = accounts.length
      ? `${accounts.map((account) => account.provider).join(", ")} connected`
      : "No mailbox connected yet";
    empty.hidden = accounts.length > 0;

    accounts.forEach((account) => {
      const row = document.createElement("div");
      row.className = "mail-account-row";
      row.innerHTML = `
        <div>
          <span class="mail-account-provider">${escapeHtml(account.provider)}</span>
          <span class="mail-account-email">${escapeHtml(account.email)}</span>
          <span class="mail-account-meta">Authorized on this device · ${escapeHtml(formatDate(account.connectedAt))}</span>
          <div class="mail-message-list" id="mail-message-list-${escapeHtml(account.id)}"></div>
        </div>
        <div class="mail-account-actions">
          <button class="mail-disconnect" type="button" data-load-messages="${account.id}">Load recent mails</button>
          <button class="mail-disconnect" type="button" data-disconnect="${account.id}">Disconnect</button>
        </div>
      `;
      list.appendChild(row);
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

  async function request(path, init) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function loadFromServer() {
    const payload = await request("/api/mail/accounts");
    accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    render();
  }

  function providerValueToApi(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "gmail") return "gmail";
    if (normalized === "outlook") return "outlook";
    if (normalized === "icloud") return "icloud";
    return "other";
  }

  function updateProviderDependentFields() {
    if (!(providerSelect instanceof HTMLSelectElement)) return;
    const provider = providerValueToApi(providerSelect.value);
    const isIcloud = provider === "icloud";
    if (icloudPasswordField instanceof HTMLElement) {
      icloudPasswordField.hidden = !isIcloud;
    }
    if (icloudPasswordInput instanceof HTMLInputElement) {
      icloudPasswordInput.required = isIcloud;
      if (!isIcloud) icloudPasswordInput.value = "";
    }
  }

  function toast(message) {
    if (!message) return;
    window.alert(message);
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
      toast(`${provider} connected${email ? `: ${email}` : ""}`);
    } else {
      toast(`${provider} authorization failed${message ? `: ${message}` : ""}`);
    }
    url.searchParams.delete("oauth");
    url.searchParams.delete("provider");
    url.searchParams.delete("label");
    url.searchParams.delete("email");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (form && providerSelect && addressInput) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(providerSelect instanceof HTMLSelectElement) || !(addressInput instanceof HTMLInputElement)) return;
      const email = addressInput.value.trim();
      if (!email) {
        addressInput.focus();
        return;
      }

      const provider = providerValueToApi(providerSelect.value);
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;

      try {
        if (provider === "gmail" || provider === "outlook") {
          const payload = await request("/api/mail/oauth/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider,
              email,
              returnTo: "/mail.html",
            }),
          });
          if (payload.authUrl) {
            window.location.href = payload.authUrl;
            return;
          }
          throw new Error(`${provider === "outlook" ? "Outlook" : "Gmail"} authorization URL not returned.`);
        } else if (provider === "icloud") {
          const appPassword =
            icloudPasswordInput instanceof HTMLInputElement ? icloudPasswordInput.value.trim() : "";
          await request("/api/mail/accounts/icloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, email, appPassword }),
          });
          toast("iCloud mailbox connected.");
          addressInput.value = "";
          if (icloudPasswordInput instanceof HTMLInputElement) icloudPasswordInput.value = "";
          await loadFromServer();
        } else {
          await request("/api/mail/accounts/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, email }),
          });
          toast("Mailbox connected.");
          addressInput.value = "";
          await loadFromServer();
        }
      } catch (error) {
        toast(error.message || "Authorization failed.");
      } finally {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
      }
    });
  }

  if (providerSelect instanceof HTMLSelectElement) {
    providerSelect.addEventListener("change", updateProviderDependentFields);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const loadMessagesId = target.getAttribute("data-load-messages");
    if (loadMessagesId) {
      const container = document.getElementById(`mail-message-list-${loadMessagesId}`);
      if (container) container.textContent = "Loading...";
      try {
        const payload = await request(`/api/mail/accounts/${encodeURIComponent(loadMessagesId)}/messages?limit=20`);
        const rows = Array.isArray(payload.messages) ? payload.messages : [];
        if (!container) return;
        if (!rows.length) {
          container.innerHTML = `<p class="mail-message-empty">No recent inbox messages.</p>`;
          return;
        }
        container.innerHTML = rows
          .map((item) => {
            const subject = escapeHtml(item.subject || "(No subject)");
            const from = escapeHtml(item.from || "Unknown sender");
            const time = item.receivedAt ? escapeHtml(formatDate(item.receivedAt)) : "Unknown time";
            return `<article class="mail-message-item"><strong>${subject}</strong><span>${from}</span><span>${time}</span></article>`;
          })
          .join("");
      } catch (error) {
        if (container) container.innerHTML = `<p class="mail-message-empty">${escapeHtml(error.message || "Failed to load messages.")}</p>`;
      }
      return;
    }

    const id = target.getAttribute("data-disconnect");
    if (!id) return;
    try {
      await request(`/api/mail/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadFromServer();
    } catch (error) {
      toast(error.message || "Failed to disconnect account.");
    }
  });

  handleOauthResultFromUrl();
  updateProviderDependentFields();
  loadFromServer().catch((error) => {
    toast(error.message || "Failed to load mail accounts.");
  });
})();
