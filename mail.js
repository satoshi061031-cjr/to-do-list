(function () {
  const STORAGE_KEY = "daily-space-mail-accounts-v1";
  let accounts = loadAccounts();

  const form = document.getElementById("mail-connect-form");
  const providerSelect = document.getElementById("mail-provider");
  const addressInput = document.getElementById("mail-address");
  const list = document.getElementById("mail-account-list");
  const empty = document.getElementById("mail-empty");
  const count = document.getElementById("mail-connected-count");
  const summary = document.getElementById("mail-connected-summary");

  function loadAccounts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveAccounts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `mail-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

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
        </div>
        <button class="mail-disconnect" type="button" data-disconnect="${account.id}">Disconnect</button>
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

  if (form && providerSelect && addressInput) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!(providerSelect instanceof HTMLSelectElement) || !(addressInput instanceof HTMLInputElement)) return;
      const email = addressInput.value.trim();
      if (!email) {
        addressInput.focus();
        return;
      }

      const provider = providerSelect.value || "Mail";
      const existing = accounts.find(
        (account) => account.provider === provider && account.email.toLowerCase() === email.toLowerCase()
      );
      if (existing) {
        existing.connectedAt = new Date().toISOString();
      } else {
        accounts.push({
          id: uid(),
          provider,
          email,
          connectedAt: new Date().toISOString(),
        });
      }

      addressInput.value = "";
      saveAccounts();
      render();
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const id = target.getAttribute("data-disconnect");
    if (!id) return;
    accounts = accounts.filter((account) => account.id !== id);
    saveAccounts();
    render();
  });

  render();
})();
