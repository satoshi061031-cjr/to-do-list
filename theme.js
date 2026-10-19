(function () {
  const STORAGE_THEME = "todo-theme";
  const STORAGE_AUTH = "daily-space-auth-v1";
  const USER_SNAPSHOT_KEYS = [
    "todo-app-v2",
    "task-templates-v1",
    "planner-app-v1",
    "calendar-app-v1",
    "tally-book-v1",
    "teamwork-page-v1",
    "travel-book-v1",
    "travel-shared-v1",
    "daily-space-mail-accounts-v1",
    STORAGE_THEME,
  ];
  const USER_SNAPSHOT_INTERVAL_MS = 30000;

  window.DailySpaceView = {
    owner() {
      try { return JSON.parse(localStorage.getItem(STORAGE_AUTH) || "null")?.email || "guest"; }
      catch (_) { return "guest"; }
    },
    read(page) {
      try { return JSON.parse(sessionStorage.getItem(`daily-space-view:${this.owner()}:${page}`) || "null") || {}; }
      catch (_) { return {}; }
    },
    write(page, value) {
      try { sessionStorage.setItem(`daily-space-view:${this.owner()}:${page}`, JSON.stringify({ ...this.read(page), ...value })); }
      catch (_) { /* Browsing remains available without storage. */ }
    },
  };

  /** Dialog text never passes through the DOM translator, so pick it here. */
  function t(en, zh) {
    const i18n = window.DailySpaceI18n;
    return i18n && typeof i18n.t === "function" ? i18n.t(en, zh) : en;
  }

  const USER_LOCAL_CACHE_PREFIX = "daily-space-user-cache-v1:";
  const USER_BASELINE_PREFIX = "daily-space-user-baseline-v1:";
  const USER_LAST_ID_STORAGE = "daily-space-last-user-v1";
  const DARK = "dark";
  const LIGHT = "light";
  let userSnapshotTimer = 0;
  let userSnapshotInFlight = false;
  let userSnapshotUserId = "";
  let userSnapshotBaseline = "";
  let userSnapshotLastSyncedAt = "";
  let userSnapshotStatus = "idle";
  let userSnapshotRevision = null;
  let userSnapshotWriteInFlight = false;

  function isBrowserOnline() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  function storedTheme() {
    try {
      return localStorage.getItem(STORAGE_THEME) === DARK ? DARK : LIGHT;
    } catch (_) {
      return LIGHT;
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_THEME, theme === DARK ? DARK : LIGHT);
    } catch (_) {
      /* Theme preference is non-critical. */
    }
  }

  function applyTheme(theme) {
    const isDark = theme === DARK;
    document.documentElement.dataset.theme = isDark ? DARK : LIGHT;
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    const label = toggle.querySelector(".theme-toggle-label");
    const icon = toggle.querySelector(".theme-toggle-icon");
    if (label) label.textContent = isDark ? "Light" : "Dark";
    if (icon) icon.textContent = isDark ? "L" : "D";

    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
      const statusBar = cap.Plugins && cap.Plugins.StatusBar;
      if (statusBar) {
        try {
          statusBar.setStyle({ style: isDark ? "LIGHT" : "DARK" });
          if (typeof statusBar.setBackgroundColor === "function") {
            statusBar.setBackgroundColor({ color: isDark ? "#131412" : "#e7e9ea" });
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  function setupThemeToggle() {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    applyTheme(storedTheme());
    toggle.addEventListener("click", function () {
      const nextTheme = document.documentElement.dataset.theme === DARK ? LIGHT : DARK;
      persistTheme(nextTheme);
      applyTheme(nextTheme);
      // Keep account snapshots from replaying an older light theme on the next page.
      if (currentUserId()) {
        userSnapshotBaseline = "";
        flushUserSnapshotOnPageHide();
      }
    });
  }

  function setupAutoSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar || !window.matchMedia) return;

    const desktopQuery = window.matchMedia("(min-width: 820px)");
    let closeTimer = 0;
    const SIDEBAR_HINT_KEY = "daily-space-sidebar-hint-done-v1";

    function isDesktop() {
      return desktopQuery.matches;
    }

    function sidebarHintDone() {
      try {
        return localStorage.getItem(SIDEBAR_HINT_KEY) === "1";
      } catch (_) {
        return true;
      }
    }

    function markSidebarHintDone() {
      try {
        localStorage.setItem(SIDEBAR_HINT_KEY, "1");
      } catch (_) {
        /* ignore */
      }
      const tip = document.getElementById("sidebar-hint");
      if (tip) tip.remove();
    }

    function showSidebarHint() {
      if (sidebarHintDone()) return;
      if (isWelcomePath(window.location.pathname)) return;
      if (!isDesktop()) return;
      if (document.getElementById("sidebar-hint")) return;
      if (document.body.classList.contains("welcome-active")) return;

      const tip = document.createElement("div");
      tip.id = "sidebar-hint";
      tip.className = "sidebar-hint";
      tip.setAttribute("role", "status");
      tip.textContent = document.body.classList.contains("has-bento-rail")
        ? "Use the left rail Menu to open the sidebar"
        : "Move to the left edge to open the menu";
      document.body.appendChild(tip);
    }

    function noteSidebarAwake() {
      if (
        sidebar.classList.contains("is-auto-open") ||
        sidebar.classList.contains("is-open") ||
        document.body.classList.contains("sidebar-drawer-open")
      ) {
        markSidebarHintDone();
      }
    }

    function openSidebar() {
      if (!isDesktop()) return;
      if (document.body.classList.contains("has-bento-rail")) return;
      window.clearTimeout(closeTimer);
      sidebar.classList.add("is-auto-open");
      markSidebarHintDone();
    }

    function closeSidebarSoon(delay) {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(function () {
        if (!isDesktop()) return;
        if (sidebar.matches(":hover") || sidebar.matches(":focus-within")) return;
        sidebar.classList.remove("is-auto-open");
      }, delay);
    }

    document.addEventListener("mousemove", function (event) {
      if (!isDesktop()) return;
      if (event.clientX <= 28) {
        openSidebar();
        return;
      }
      if (!sidebar.classList.contains("is-auto-open")) return;
      const rect = sidebar.getBoundingClientRect();
      if (event.clientX > rect.right + 96 && !sidebar.matches(":hover")) {
        closeSidebarSoon(120);
      }
    });

    sidebar.addEventListener("mouseenter", openSidebar);
    sidebar.addEventListener("mouseleave", function () {
      closeSidebarSoon(180);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isDesktop()) {
        sidebar.classList.remove("is-auto-open");
      }
    });

    const classObserver = new MutationObserver(noteSidebarAwake);
    classObserver.observe(sidebar, { attributes: true, attributeFilter: ["class"] });
    classObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    function syncMode() {
      window.clearTimeout(closeTimer);
      sidebar.classList.remove("is-auto-open");
      if (isDesktop()) showSidebarHint();
      else {
        const tip = document.getElementById("sidebar-hint");
        if (tip) tip.remove();
      }
    }

    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener("change", syncMode);
    } else if (desktopQuery.addListener) {
      desktopQuery.addListener(syncMode);
    }

    showSidebarHint();

    const trigger = document.getElementById("sidebar-trigger");
    if (trigger) {
      trigger.addEventListener(
        "click",
        function (event) {
          if (window.DailySpaceBentoRail) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.DailySpaceBentoRail.toggleSidebar();
            return;
          }
          if (!isDesktop()) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const open = sidebar.classList.contains("is-auto-open");
          if (open) {
            sidebar.classList.remove("is-auto-open");
            trigger.setAttribute("aria-expanded", "false");
          } else {
            openSidebar();
            trigger.setAttribute("aria-expanded", "true");
          }
        },
        true
      );
    }
  }

  function readAuthState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_AUTH) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.provider !== "string" || typeof parsed.label !== "string") return null;
      return {
        provider: parsed.provider,
        label: parsed.label,
        email: typeof parsed.email === "string" ? parsed.email : "",
        mailProvider: typeof parsed.mailProvider === "string" ? parsed.mailProvider : "",
      };
    } catch (_) {
      return null;
    }
  }

  function saveAuthState(state) {
    try {
      localStorage.setItem(STORAGE_AUTH, JSON.stringify(state));
    } catch (_) {
      /* Auth UI state is non-critical for the static app. */
    }
    window.dispatchEvent(new CustomEvent("daily-space-auth-updated"));
  }

  function clearAuthState() {
    try {
      localStorage.removeItem(STORAGE_AUTH);
    } catch (_) {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("daily-space-auth-updated"));
  }

  function currentUserId() {
    const auth = readAuthState();
    const email = String(auth?.email || "").trim().toLowerCase();
    return email;
  }

  function emitUserSnapshotUpdate() {
    window.dispatchEvent(
      new CustomEvent("daily-space-user-sync-updated", {
        detail: {
          status: userSnapshotStatus,
          lastSyncedAt: userSnapshotLastSyncedAt || "",
          userId: userSnapshotUserId || "",
        },
      })
    );
  }

  const DEFAULT_APP_PATH = "/todo.html#today";

  function isWelcomePath(pathname) {
    const path = String(pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/" || path === "/index.html";
  }

  async function linkMailAccountFromAuth(provider, email, label) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    const mailProvider =
      normalizedProvider.includes("google") || normalizedProvider.includes("gmail")
        ? "gmail"
        : normalizedProvider.includes("outlook") || normalizedProvider.includes("microsoft")
          ? "outlook"
          : "";
    if (!mailProvider || !email) return;
    await fetch("/api/mail/accounts/link-from-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: mailProvider,
        email,
        label,
      }),
    });
  }

  function applyUserAuthResultFromUrl(options) {
    const settings = options || {};
    const url = new URL(window.location.href);
    const status = url.searchParams.get("userauth");
    if (!status) return false;

    const provider = url.searchParams.get("provider") || "Google";
    const label = url.searchParams.get("label") || "Google user";
    const email = url.searchParams.get("email") || "";
    const message = url.searchParams.get("message") || "";
    const isWeChat =
      String(provider).toLowerCase() === "wechat" || String(email).toLowerCase().startsWith("wechat:");
    let succeeded = false;

    if (status === "success") {
      succeeded = true;
      saveAuthState({
        provider,
        label: isWeChat || !email ? label : `${label} (${email})`,
        email,
        mailProvider: isWeChat
          ? ""
          : String(provider).toLowerCase().includes("google")
            ? "gmail"
            : String(provider).toLowerCase().includes("outlook")
              ? "outlook"
              : "",
      });
      if (!isWeChat) {
        linkMailAccountFromAuth(provider, email, label).catch(function () {
          /* Best-effort sync so sign-in UX remains smooth. */
        });
      }
    } else if (message) {
      window.alert(message);
    }

    ["userauth", "provider", "label", "email", "message"].forEach(function (key) {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new CustomEvent("daily-space-auth-updated"));

    if (succeeded && settings.redirectToApp && isWelcomePath(url.pathname)) {
      window.location.replace(DEFAULT_APP_PATH);
      return true;
    }

    return succeeded;
  }

  async function redirectSignedInWelcomeUser() {
    if (!isWelcomePath(window.location.pathname)) return false;
    const response = await fetch("/api/auth/me");
    if (!response.ok) return false;
    const payload = await response.json().catch(function () {
      return {};
    });
    const user = payload?.user;
    if (!user || !user.label) return false;
    saveAuthState({
      label: user.label,
      email: user.email || "",
      provider: user.provider || "Account",
      mailProvider: String(user.provider || "").toLowerCase().includes("google")
        ? "gmail"
        : String(user.provider || "").toLowerCase().includes("outlook")
          ? "outlook"
          : "",
    });
    window.location.replace(DEFAULT_APP_PATH);
    return true;
  }

  function setupAuthEntry() {
    const sidebarInner = document.querySelector(".sidebar-inner");
    if (!sidebarInner) return;

    const authBlock = document.createElement("div");
    authBlock.className = "sidebar-auth";

    const heading = document.createElement("div");
    heading.className = "sidebar-heading";
    heading.textContent = "Account";

    const authButton = document.createElement("button");
    authButton.type = "button";
    authButton.className = "sidebar-auth-entry";

    const authLabel = document.createElement("span");
    authLabel.className = "sidebar-auth-label";

    const authHint = document.createElement("span");
    authHint.className = "sidebar-auth-hint";

    const authSync = document.createElement("span");
    authSync.className = "sidebar-auth-sync";

    authButton.append(authLabel, authHint, authSync);
    authBlock.append(heading, authButton);
    sidebarInner.appendChild(authBlock);

    const modal = document.createElement("div");
    modal.className = "auth-modal";
    modal.setAttribute("data-dialog-root", "");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="auth-modal-backdrop" data-auth-close></div>
      <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" class="auth-close" data-auth-close data-dialog-close aria-label="Close login">×</button>
        <p class="auth-kicker">Daily Space</p>
        <h2 class="auth-title" id="auth-title">Sign in</h2>
        <p class="auth-copy">Sign in with Google to sync your workspace, or continue as guest to keep it on this device.</p>
        <div class="auth-provider-list">
          <button type="button" class="auth-provider" data-provider="google">
            <span class="auth-provider-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path
                  fill="#EA4335"
                  d="M12 10.2v3.9h5.4c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.49 0-.72-.06-1.41-.19-2.01H12z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.76 0 5.07-.91 6.76-2.48l-3.3-2.56c-.91.61-2.08.97-3.46.97-2.66 0-4.92-1.79-5.73-4.2l-3.41 2.63C4.57 19.72 8.02 22 12 22z"
                />
                <path
                  fill="#4A90E2"
                  d="M6.27 13.73A5.95 5.95 0 0 1 5.95 12c0-.6.11-1.18.32-1.73L2.86 7.64A9.97 9.97 0 0 0 2 12c0 1.61.39 3.14 1.08 4.47l3.19-2.74z"
                />
                <path
                  fill="#FBBC05"
                  d="M12 6.06c1.5 0 2.85.52 3.91 1.54l2.93-2.93C17.05 3.01 14.74 2 12 2 8.02 2 4.57 4.28 2.86 7.64l3.41 2.63c.81-2.41 3.07-4.21 5.73-4.21z"
                />
              </svg>
            </span>
            <span>Sign in with Google</span>
          </button>
          <button type="button" class="auth-provider" data-auth-guest>
            <span class="auth-provider-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            </span>
            <span>Continue as guest</span>
          </button>
        </div>
        <div class="auth-account-actions" hidden>
          <p class="auth-account-hint">Mail and Calendar use your connected account.</p>
          <button type="button" class="auth-export">Download my data</button>
          <button type="button" class="auth-delete">Delete account</button>
          <p class="auth-install-hint" hidden></p>
        </div>
        <button type="button" class="auth-logout" hidden>Sign out</button>
      </section>
    `;
    document.body.appendChild(modal);

    const logoutButton = modal.querySelector(".auth-logout");
    const accountActions = modal.querySelector(".auth-account-actions");
    const exportButton = modal.querySelector(".auth-export");
    const deleteButton = modal.querySelector(".auth-delete");
    const installHint = modal.querySelector(".auth-install-hint");
    const providerList = modal.querySelector(".auth-provider-list");
    const authTitle = modal.querySelector("#auth-title");
    const authCopy = modal.querySelector(".auth-copy");

    function updateInstallHint() {
      if (!installHint) return;
      const standalone =
        window.matchMedia &&
        (window.matchMedia("(display-mode: standalone)").matches ||
          window.matchMedia("(display-mode: minimal-ui)").matches);
      const native = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor);
      if (standalone || native) {
        installHint.hidden = true;
        installHint.textContent = "";
        return;
      }
      installHint.hidden = false;
      installHint.textContent =
        "Install tip: use your browser’s “Install app” or “Add to Home Screen” for a Daily Loop shortcut.";
    }

    function renderAuth() {
      const state = readAuthState();
      authLabel.textContent = state ? state.label : "Sign in";
      authHint.textContent = state ? state.provider : "Google or local guest";
      if (!state) {
        authSync.hidden = true;
      } else if (userSnapshotStatus === "offline" || !isBrowserOnline()) {
        authSync.hidden = false;
        authSync.textContent = "Offline — saved on this device";
      } else if (userSnapshotStatus === "conflict") {
        authSync.hidden = false;
        authSync.innerHTML =
          'You edited offline — <button type="button" class="sidebar-auth-sync-action" id="auth-sync-keep-local">Keep this device</button> or <button type="button" class="sidebar-auth-sync-action" id="auth-sync-use-cloud">Use cloud</button>';
        const keepLocal = authSync.querySelector("#auth-sync-keep-local");
        const useCloud = authSync.querySelector("#auth-sync-use-cloud");
        if (keepLocal) {
          keepLocal.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            keepLocalSnapshotOverCloud().catch(function (error) {
              handleSnapshotFailure(error);
            });
          });
        }
        if (useCloud) {
          useCloud.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            applyCloudSnapshotPreferringRemote().catch(function () {
              userSnapshotStatus = "error";
              emitUserSnapshotUpdate();
            });
          });
        }
      } else if (userSnapshotStatus === "syncing") {
        authSync.hidden = false;
        authSync.textContent = "Syncing…";
      } else if (userSnapshotStatus === "error") {
        authSync.hidden = false;
        authSync.textContent = "Sync failed — will retry";
      } else if (userSnapshotLastSyncedAt) {
        authSync.hidden = false;
        authSync.textContent = `Synced ${formatSyncTime(userSnapshotLastSyncedAt)}`;
      } else {
        authSync.hidden = false;
        authSync.textContent = "Ready to sync";
      }
      authButton.classList.toggle("is-signed-in", !!state);
      if (logoutButton) logoutButton.hidden = !state;
      if (accountActions) accountActions.hidden = !state;
      if (providerList) providerList.hidden = Boolean(state);
      if (authTitle) authTitle.textContent = state ? "Account" : "Sign in";
      if (authCopy) {
        authCopy.textContent = state
          ? "Download a copy, fix sync conflicts from the Account row, or delete your cloud account."
          : "Sign in with Google to sync your workspace, or continue as guest to keep it on this device.";
      }
      updateInstallHint();
      renderGreeting();
    }

    window.addEventListener("daily-space-auth-updated", renderAuth);
    window.addEventListener("daily-space-user-sync-updated", renderAuth);

    function openModal() {
      renderAuth();
      modal.hidden = false;
      document.body.classList.add("auth-modal-open");
      const state = readAuthState();
      const focusTarget = state
        ? modal.querySelector(".auth-export") || logoutButton
        : modal.querySelector(".auth-provider");
      if (focusTarget) focusTarget.focus();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("auth-modal-open");
      authButton.focus();
    }

    async function disconnectLinkedMailbox(authState) {
      const email = String(authState?.email || "").trim().toLowerCase();
      if (!email) return;
      const normalizedProvider = String(authState?.mailProvider || authState?.provider || "")
        .trim()
        .toLowerCase();
      let provider = "";
      if (normalizedProvider.includes("gmail") || normalizedProvider.includes("google")) provider = "gmail";
      else if (normalizedProvider.includes("outlook") || normalizedProvider.includes("microsoft")) provider = "outlook";
      if (!provider) return;

      await fetch("/api/mail/accounts/disconnect-linked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, email }),
      });
    }

    async function startGoogleSignIn() {
      const response = await fetch("/api/auth/google/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo: window.location.pathname + window.location.search,
        }),
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error((payload && payload.error) || "Google sign-in failed.");
      }
      if (!payload.authUrl) throw new Error("Missing Google authorization URL.");
      window.location.href = payload.authUrl;
    }

    window.DailySpaceAuth = {
      startGoogleSignIn,
    };

    authButton.addEventListener("click", openModal);

    modal.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-auth-close]") || target.closest("[data-auth-guest]")) {
        closeModal();
        return;
      }
      const providerButton = target.closest(".auth-provider");
      if (providerButton) {
        const provider = providerButton.getAttribute("data-provider") || "provider";
        if (provider === "google") {
          startGoogleSignIn().catch(function (error) {
            window.alert(
              error instanceof Error
                ? error.message
                : t("Google sign-in failed.", "Google 登录失败。")
            );
          });
        }
      }
    });

    if (exportButton) {
      exportButton.addEventListener("click", async function () {
        exportButton.setAttribute("disabled", "true");
        try {
          await downloadUserDataExport();
        } catch (error) {
          window.alert(
            error instanceof Error ? error.message : t("Export failed.", "导出失败。")
          );
        } finally {
          exportButton.removeAttribute("disabled");
        }
      });
    }

    if (deleteButton) {
      deleteButton.addEventListener("click", async function () {
        const confirmed = window.confirm(
          t(
            "Delete this Daily Space account?\n\nThis removes your cloud snapshot and connected mailboxes on the server. This device will be signed out.",
            "删除这个 Daily Space 账号？\n\n服务器上的云端备份和已连接的邮箱都会被移除，本设备将退出登录。"
          )
        );
        if (!confirmed) return;
        deleteButton.setAttribute("disabled", "true");
        try {
          const response = await fetch("/api/user/account", { method: "DELETE" });
          const payload = await response.json().catch(function () {
            return {};
          });
          if (!response.ok) {
            throw new Error((payload && payload.error) || "Could not delete account.");
          }
          clearAuthState();
          stopUserSnapshotSync();
          applyUserSnapshotPayload({}, { clearMissing: true });
          renderAuth();
          closeModal();
          window.location.href = "todo.html#today";
        } catch (error) {
          window.alert(
            error instanceof Error
              ? error.message
              : t("Could not delete account.", "无法删除账号。")
          );
        } finally {
          deleteButton.removeAttribute("disabled");
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", async function () {
        logoutButton.setAttribute("disabled", "true");
        try {
          await disconnectLinkedMailbox(readAuthState());
          await fetch("/api/auth/logout", { method: "POST" });
        } catch (_) {
          /* best-effort signout sync */
        } finally {
          clearAuthState();
          renderAuth();
          closeModal();
          logoutButton.removeAttribute("disabled");
        }
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });

    renderAuth();
    applyUserAuthResultFromUrl();
  }

  function userTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch (_) {
      return undefined;
    }
  }

  function hourInTimeZone(date, timeZone) {
    if (!timeZone) return date.getHours();
    try {
      const hourPart = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hourCycle: "h23",
        timeZone,
      })
        .formatToParts(date)
        .find((part) => part.type === "hour");
      const hour = Number(hourPart?.value);
      return Number.isFinite(hour) ? hour : date.getHours();
    } catch (_) {
      return date.getHours();
    }
  }

  function greetingTextForNow(date = new Date(), timeZone = userTimeZone()) {
    const hour = hourInTimeZone(date, timeZone);
    if (hour < 12) return "Good morning";
    if (hour < 14) return "Good noon";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function userNameForGreeting() {
    const state = readAuthState();
    return state && state.label ? state.label : "Guest";
  }

  function renderGreeting() {
    const greeting = document.querySelector(".app-greeting");
    if (!greeting) return;
    const title = greeting.querySelector(".app-greeting-title");
    const time = greeting.querySelector(".app-greeting-time");
    const now = new Date();
    const timeZone = userTimeZone();
    if (timeZone) greeting.dataset.timeZone = timeZone;
    if (title) title.textContent = `${greetingTextForNow(now, timeZone)}, ${userNameForGreeting()}`;
    if (time) {
      time.textContent = now.toLocaleString(window.DailySpaceI18n?.localeTag(), {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      });
    }
  }

  function setupGreeting() {
    const host = document.querySelector(".app, .planner-shell, .calendar-app, .tally-app, .teamwork-app, .mail-app");
    if (!host || host.querySelector(".app-greeting")) return;

    const greeting = document.createElement("section");
    greeting.className = "app-greeting";
    greeting.setAttribute("aria-label", "User greeting");
    greeting.innerHTML = `
      <div class="app-greeting-avatar" aria-hidden="true"></div>
      <div class="app-greeting-copy">
        <p class="app-greeting-title"></p>
        <p class="app-greeting-time"></p>
      </div>
    `;
    host.prepend(greeting);
    renderGreeting();
    window.addEventListener("daily-space-locale-changed", renderGreeting);
    window.setInterval(renderGreeting, 60000);
  }

  function setupWelcomeExperience() {
    if (!document.querySelector(".welcome-screen") || !isWelcomePath(window.location.pathname)) {
      return;
    }

    if (applyUserAuthResultFromUrl({ redirectToApp: true })) {
      return;
    }

    redirectSignedInWelcomeUser()
      .then(function (redirected) {
        if (redirected) return;
        initWelcomeExperience();
      })
      .catch(function () {
        initWelcomeExperience();
      });
  }

  function initWelcomeExperience() {
    const stage = document.querySelector(".welcome-screen");
    if (!(stage instanceof HTMLElement)) return;

    async function startWelcomeSignIn(provider) {
      const response = await fetch(`/api/auth/${provider}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo: DEFAULT_APP_PATH,
        }),
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error((payload && payload.error) || `${provider} sign-in failed.`);
      }
      if (!payload.authUrl) throw new Error("Missing authorization URL.");
      window.location.href = payload.authUrl;
    }

    stage.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const providerButton = target.closest("[data-welcome-provider]");
      if (!providerButton) return;
      const provider = providerButton.getAttribute("data-welcome-provider");
      if (provider !== "google") return;
      startWelcomeSignIn(provider).catch(function (error) {
        window.alert(
          error instanceof Error ? error.message : t("Sign-in failed.", "登录失败。")
        );
      });
    });

  }

  function handleSnapshotFailure(error) {
    userSnapshotStatus = !isBrowserOnline() ? "offline"
      : error?.code === "SNAPSHOT_CONFLICT" ? "conflict" : "error";
    emitUserSnapshotUpdate();
  }

  async function requestUserSnapshot(method, payload) {
    const writing = method === "PUT";
    if (writing && (userSnapshotWriteInFlight || userSnapshotRevision == null)) {
      throw new Error("Wait for cloud data to load before syncing.");
    }
    if (writing) userSnapshotWriteInFlight = true;
    try {
      const response = await fetch("/api/user/snapshot", {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify({ ...payload, baseRevision: userSnapshotRevision }) : undefined,
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw Object.assign(new Error(data.error || "User sync request failed."), {
          code: data.code, status: response.status,
        });
      }
      if (writing) userSnapshotRevision = data.revision;
      return data;
    } finally {
      if (writing) userSnapshotWriteInFlight = false;
    }
  }

  function collectPayloadForKeys(keys) {
    const payload = {};
    keys.forEach(function (key) {
      try {
        const value = localStorage.getItem(key);
        if (value != null) payload[key] = value;
      } catch (_) {
        /* ignore inaccessible keys */
      }
    });
    return payload;
  }

  function collectUserSnapshotPayload() {
    return collectPayloadForKeys(USER_SNAPSHOT_KEYS);
  }

  function readLastUserId() {
    try {
      return String(localStorage.getItem(USER_LAST_ID_STORAGE) || "").trim().toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function writeLastUserId(userId) {
    try {
      if (userId) localStorage.setItem(USER_LAST_ID_STORAGE, userId);
    } catch (_) {
      /* ignore inaccessible local cache */
    }
  }

  function readUserLocalCache(userId) {
    if (!userId) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(`${USER_LOCAL_CACHE_PREFIX}${userId}`) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeUserLocalCache(userId, payload) {
    if (!userId) return;
    try {
      localStorage.setItem(`${USER_LOCAL_CACHE_PREFIX}${userId}`, JSON.stringify(payload || {}));
    } catch (_) {
      /* ignore inaccessible local cache */
    }
  }

  function readPersistedBaseline(userId) {
    if (!userId) return "";
    try {
      return String(localStorage.getItem(`${USER_BASELINE_PREFIX}${userId}`) || "");
    } catch (_) {
      return "";
    }
  }

  function writePersistedBaseline(userId, signature) {
    if (!userId) return;
    try {
      if (signature) localStorage.setItem(`${USER_BASELINE_PREFIX}${userId}`, signature);
      else localStorage.removeItem(`${USER_BASELINE_PREFIX}${userId}`);
    } catch (_) {
      /* ignore inaccessible local cache */
    }
  }

  function setSyncedBaseline(userId, payload) {
    const signature = userSnapshotSignature(payload);
    userSnapshotBaseline = signature;
    writePersistedBaseline(userId, signature);
    return signature;
  }

  function payloadHasAppData(payload) {
    if (!payload || typeof payload !== "object") return false;
    return USER_SNAPSHOT_KEYS.some(function (key) {
      if (key === STORAGE_THEME) return false;
      const value = payload[key];
      return typeof value === "string" && value.length > 2;
    });
  }

  function formatSyncTime(iso) {
    if (!iso) return "Never";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "Never";
    return dt.toLocaleString(window.DailySpaceI18n?.localeTag(), {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function userSnapshotSignature(payload) {
    return USER_SNAPSHOT_KEYS.map(function (key) {
      const value = payload && typeof payload[key] === "string" ? payload[key] : "";
      return `${key}:${value.length}:${value}`;
    }).join("|");
  }

  function applyUserSnapshotPayload(payload, options) {
    const nextPayload = payload && typeof payload === "object" ? payload : {};
    const clearMissing = Boolean(options && options.clearMissing);
    USER_SNAPSHOT_KEYS.forEach(function (key) {
      const value = nextPayload[key];
      try {
        if (typeof value === "string") {
          // Theme is a device preference: never let a missing/empty remote value wipe local dark/light.
          if (key === STORAGE_THEME && value !== DARK && value !== LIGHT) return;
          localStorage.setItem(key, value);
        } else if (clearMissing && key !== STORAGE_THEME) {
          localStorage.removeItem(key);
        }
      } catch (_) {
        /* ignore write failures */
      }
    });
    applyTheme(storedTheme());
    renderGreeting();
  }

  async function applyCloudSnapshotPreferringRemote() {
    const userId = currentUserId();
    if (!userId || !isBrowserOnline()) {
      userSnapshotStatus = isBrowserOnline() ? "error" : "offline";
      emitUserSnapshotUpdate();
      return;
    }
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    const data = await requestUserSnapshot("GET");
    userSnapshotRevision = data.revision;
    const nextPayload = data.payload && typeof data.payload === "object" ? data.payload : {};
    applyUserSnapshotPayload(nextPayload, { clearMissing: true });
    userSnapshotUserId = userId;
    writeLastUserId(userId);
    writeUserLocalCache(userId, collectUserSnapshotPayload());
    setSyncedBaseline(userId, collectUserSnapshotPayload());
    userSnapshotLastSyncedAt = data.updatedAt || new Date().toISOString();
    userSnapshotStatus = "ok";
    emitUserSnapshotUpdate();
    window.location.reload();
  }

  async function keepLocalSnapshotOverCloud() {
    const userId = currentUserId();
    if (!userId || !isBrowserOnline()) {
      userSnapshotStatus = isBrowserOnline() ? "error" : "offline";
      emitUserSnapshotUpdate();
      return;
    }
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    // The user explicitly chose this device; still protect against changes after this read.
    const latest = await requestUserSnapshot("GET");
    userSnapshotRevision = latest.revision;
    const payload = collectUserSnapshotPayload();
    const saved = await requestUserSnapshot("PUT", { payload });
    userSnapshotUserId = userId;
    writeLastUserId(userId);
    writeUserLocalCache(userId, payload);
    setSyncedBaseline(userId, payload);
    userSnapshotLastSyncedAt = (saved && saved.updatedAt) || new Date().toISOString();
    userSnapshotStatus = "ok";
    emitUserSnapshotUpdate();
  }

  async function downloadUserDataExport() {
    const localPayload = collectUserSnapshotPayload();
    let cloudPayload = null;
    let cloudUpdatedAt = null;
    if (currentUserId() && isBrowserOnline()) {
      try {
        const data = await requestUserSnapshot("GET");
        cloudPayload = data.payload && typeof data.payload === "object" ? data.payload : {};
        cloudUpdatedAt = data.updatedAt || null;
      } catch (_) {
        /* fall back to local-only export */
      }
    }
    const exportedAt = new Date().toISOString();
    const body = {
      exportedAt,
      source: "daily-space",
      local: localPayload,
      cloud: cloudPayload,
      cloudUpdatedAt,
    };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-space-export-${exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function loadSnapshotForCurrentUser() {
    const userId = currentUserId();
    if (!userId) return;
    if (!isBrowserOnline()) {
      userSnapshotUserId = userId;
      writeLastUserId(userId);
      userSnapshotBaseline = readPersistedBaseline(userId) || userSnapshotSignature(collectUserSnapshotPayload());
      userSnapshotStatus = "offline";
      emitUserSnapshotUpdate();
      return;
    }
    const previousUserId = userSnapshotUserId || readLastUserId();
    const localPayload = collectUserSnapshotPayload();
    if (previousUserId !== userId) userSnapshotRevision = null;
    if (previousUserId && previousUserId !== userId) {
      writeUserLocalCache(previousUserId, localPayload);
    }
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    const data = await requestUserSnapshot("GET");
    userSnapshotRevision = data.revision;
    let nextPayload = data.payload && typeof data.payload === "object" ? data.payload : {};
    let syncedAt = data.updatedAt || "";
    if (!data.updatedAt) {
      const cachedPayload = readUserLocalCache(userId);
      nextPayload = cachedPayload || (!previousUserId ? localPayload : {});
      applyUserSnapshotPayload(nextPayload);
      if (Object.keys(nextPayload).length) {
        const saved = await requestUserSnapshot("PUT", { payload: nextPayload });
        syncedAt = saved.updatedAt || new Date().toISOString();
      }
    } else {
      const remoteSig = userSnapshotSignature(nextPayload);
      const localSig = userSnapshotSignature(localPayload);
      const baselineSig = readPersistedBaseline(userId) || userSnapshotBaseline;
      const localDirty = Boolean(baselineSig) && localSig !== baselineSig;
      if (localDirty && localSig !== remoteSig && payloadHasAppData(localPayload)) {
        // Local and cloud diverge — keep showing local until the user chooses.
        userSnapshotUserId = userId;
        writeLastUserId(userId);
        writeUserLocalCache(userId, localPayload);
        userSnapshotLastSyncedAt = syncedAt;
        userSnapshotStatus = "conflict";
        emitUserSnapshotUpdate();
        return;
      }
      applyUserSnapshotPayload(nextPayload);
    }
    userSnapshotUserId = userId;
    writeLastUserId(userId);
    writeUserLocalCache(userId, collectUserSnapshotPayload());
    setSyncedBaseline(userId, collectUserSnapshotPayload());
    userSnapshotLastSyncedAt = syncedAt;
    userSnapshotStatus = "ok";
    emitUserSnapshotUpdate();
  }

  async function userSnapshotTick() {
    if (userSnapshotInFlight || document.hidden) return;
    const userId = currentUserId();
    if (!userId) return;
    if (!isBrowserOnline()) {
      writeUserLocalCache(userId, collectUserSnapshotPayload());
      userSnapshotStatus = "offline";
      emitUserSnapshotUpdate();
      return;
    }
    if (userSnapshotStatus === "conflict") {
      writeUserLocalCache(userId, collectUserSnapshotPayload());
      emitUserSnapshotUpdate();
      return;
    }
    userSnapshotInFlight = true;
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    try {
      if (userSnapshotUserId !== userId || userSnapshotRevision == null) {
        await loadSnapshotForCurrentUser();
        return;
      }
      const payload = collectUserSnapshotPayload();
      const signature = userSnapshotSignature(payload);
      if (signature === userSnapshotBaseline) {
        userSnapshotStatus = "ok";
        emitUserSnapshotUpdate();
        return;
      }
      const saved = await requestUserSnapshot("PUT", { payload });
      if (saved && saved.ok) {
        setSyncedBaseline(userId, payload);
        userSnapshotLastSyncedAt = saved.updatedAt || new Date().toISOString();
        writeUserLocalCache(userId, payload);
      }
      userSnapshotStatus = "ok";
      emitUserSnapshotUpdate();
    } catch (error) {
      writeUserLocalCache(userId, collectUserSnapshotPayload());
      handleSnapshotFailure(error);
    } finally {
      userSnapshotInFlight = false;
    }
  }

  function flushUserSnapshotOnPageHide() {
    const userId = currentUserId();
    if (!userId) return;
    if (userSnapshotStatus === "conflict") {
      writeUserLocalCache(userId, collectUserSnapshotPayload());
      return;
    }
    const payload = collectUserSnapshotPayload();
    const signature = userSnapshotSignature(payload);
    if (signature === userSnapshotBaseline) return;
    writeUserLocalCache(userId, payload);
    if (!isBrowserOnline()) {
      userSnapshotStatus = "offline";
      emitUserSnapshotUpdate();
      return;
    }
    if (userSnapshotWriteInFlight || userSnapshotInFlight || userSnapshotRevision == null) return;
    const body = JSON.stringify({ payload, baseRevision: userSnapshotRevision });
    if (new Blob([body]).size > 60 * 1024) return;
    userSnapshotWriteInFlight = true;
    fetch("/api/user/snapshot", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).then(async function (response) {
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error), { code: data.code });
      userSnapshotRevision = data.revision;
      setSyncedBaseline(userId, payload);
      userSnapshotLastSyncedAt = data.updatedAt;
    }).catch(handleSnapshotFailure).finally(function () {
      userSnapshotWriteInFlight = false;
    });
  }

  function stopUserSnapshotSync() {
    const previousUserId = userSnapshotUserId || readLastUserId();
    if (previousUserId) {
      writeUserLocalCache(previousUserId, collectUserSnapshotPayload());
      // Clear synced app data for the signed-out user, but keep local theme preference.
      applyUserSnapshotPayload({}, { clearMissing: true });
    }
    window.clearInterval(userSnapshotTimer);
    userSnapshotTimer = 0;
    userSnapshotUserId = "";
    userSnapshotRevision = null;
    userSnapshotBaseline = "";
    userSnapshotLastSyncedAt = "";
    userSnapshotStatus = "idle";
    emitUserSnapshotUpdate();
  }

  function startUserSnapshotSync() {
    if (userSnapshotTimer) return;
    userSnapshotTimer = window.setInterval(userSnapshotTick, USER_SNAPSHOT_INTERVAL_MS);
  }

  async function refreshUserSnapshotSession(forceLoad) {
    const userId = currentUserId();
    if (!userId) {
      stopUserSnapshotSync();
      return;
    }
    startUserSnapshotSync();
    if (forceLoad || userSnapshotUserId !== userId) {
      try {
        await loadSnapshotForCurrentUser();
      } catch (error) {
        /* keep UX responsive even if sync unavailable */
        writeUserLocalCache(userId, collectUserSnapshotPayload());
        handleSnapshotFailure(error);
      }
    } else {
      emitUserSnapshotUpdate();
    }
  }

  function setupUserSnapshotSync() {
    window.addEventListener("daily-space-auth-updated", function () {
      refreshUserSnapshotSession(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) flushUserSnapshotOnPageHide();
      else userSnapshotTick();
    });
    window.addEventListener("pagehide", flushUserSnapshotOnPageHide);
    window.addEventListener("online", function () {
      if (!currentUserId()) return;
      userSnapshotTick();
    });
    window.addEventListener("offline", function () {
      if (!currentUserId()) return;
      writeUserLocalCache(currentUserId(), collectUserSnapshotPayload());
      userSnapshotStatus = "offline";
      emitUserSnapshotUpdate();
    });
    refreshUserSnapshotSession(false);
  }

  function setupPageScroll(page) {
    const main = document.querySelector(".main-area");
    const owner = window.DailySpaceView.owner();
    const scrollContainer = () => main && /^(auto|scroll)$/.test(getComputedStyle(main).overflowY) ? main : document.scrollingElement;
    window.addEventListener("pagehide", () => {
      if (window.DailySpaceView.owner() === owner) {
        window.DailySpaceView.write(page, { scroll: scrollContainer().scrollTop });
      }
    });
    const saved = window.DailySpaceView.read(page);
    if (new URLSearchParams(location.search).has("focus") || !(saved.scroll > 0)) return;

    let observer, timeout, stopped = false;
    const inputEvents = ["pointerdown", "touchstart", "wheel", "keydown"];
    function stop() {
      stopped = true;
      observer?.disconnect();
      clearTimeout(timeout);
      inputEvents.forEach(type => window.removeEventListener(type, stop, true));
      window.removeEventListener("pagehide", stop);
    }
    function restore() {
      if (stopped) return;
      if (window.DailySpaceView.owner() !== owner) { stop(); return; }
      const container = scrollContainer();
      container.scrollTop = saved.scroll;
      if (Math.abs(container.scrollTop - saved.scroll) <= 1) stop();
    }
    inputEvents.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }));
    window.addEventListener("pagehide", stop);
    timeout = setTimeout(stop, 4000);
    if (main && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(restore);
      observer.observe(main);
      [...main.children].forEach(child => observer.observe(child));
    }
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }

  function setupPageChrome() {
    const header = document.querySelector("[data-page-header]");
    const actions = header?.querySelector(".page-action-cluster");
    if (!actions) return;
    header.classList.add("workspace-page-header");
    const search = document.createElement("button");
    search.type = "button";
    search.className = "workspace-icon-button";
    search.dataset.workspaceSearch = "true";
    search.setAttribute("aria-label", "Search Daily Space");
    search.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
    search.addEventListener("click", () => window.DailySpaceSearchUi?.open());
    actions.prepend(search);
    document.addEventListener("click", event => {
      for (const menu of document.querySelectorAll("[data-page-menu][open]")) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      for (const menu of document.querySelectorAll("[data-page-menu][open]")) {
        const returnFocus = menu.contains(document.activeElement);
        menu.open = false;
        if (returnFocus) {
          event.preventDefault();
          menu.querySelector("summary")?.focus({ preventScroll: true });
        }
      }
    });
    const page = location.pathname.split("/").pop().replace(/\.html$/, "");
    if (!page.startsWith("todo")) setupPageScroll(page);
  }

  function setupNotifications() {
    if (document.getElementById("notif-bell")) return;
    if (document.body.classList.contains("welcome-active")) return;
    if (isWelcomePath(window.location.pathname)) return;

    const root = document.createElement("div");
    root.className = "notif-root";
    root.id = "notif-root";
    root.hidden = true;

    const bell = document.createElement("button");
    bell.type = "button";
    bell.id = "notif-bell";
    bell.className = "notif-bell";
    bell.setAttribute("aria-label", "Notifications");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-haspopup", "true");
    bell.innerHTML =
      '<span class="notif-bell-glyph" aria-hidden="true">N</span><span class="notif-bell-dot" hidden></span>';

    const panel = document.createElement("div");
    panel.className = "notif-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notifications");
    panel.innerHTML = `
      <header class="notif-panel-header">
        <h2 class="notif-panel-title">Notifications</h2>
        <button type="button" class="notif-mark-all" id="notif-mark-all">Mark all read</button>
      </header>
      <ul class="notif-list" id="notif-list"></ul>
      <p class="notif-empty" id="notif-empty" hidden>No notifications yet.</p>
    `;

    root.append(bell, panel);
    const pageActions = document.querySelector(".page-action-cluster");
    if (pageActions) {
      pageActions.insertBefore(root, pageActions.querySelector("details"));
      bell.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notif-bell-dot" hidden></span>';
    } else {
      document.body.appendChild(root);
    }

    const listEl = panel.querySelector("#notif-list");
    const emptyEl = panel.querySelector("#notif-empty");
    const markAllBtn = panel.querySelector("#notif-mark-all");
    const dotEl = bell.querySelector(".notif-bell-dot");

    let items = [];
    let unreadCount = 0;
    let pollTimer = 0;
    let open = false;

    async function apiRequest(path, init) {
      const response = await fetch(path, init);
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) throw new Error(payload.error || "Request failed");
      return payload;
    }

    function formatRelative(iso) {
      const t = Date.parse(iso || "");
      if (!Number.isFinite(t)) return "";
      const diff = Date.now() - t;
      const mins = Math.round(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return mins + "m ago";
      const hours = Math.round(mins / 60);
      if (hours < 24) return hours + "h ago";
      const days = Math.round(hours / 24);
      return days + "d ago";
    }

    function renderList() {
      listEl.innerHTML = "";
      if (!items.length) {
        emptyEl.hidden = false;
        listEl.hidden = true;
        return;
      }
      emptyEl.hidden = true;
      listEl.hidden = false;
      items.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "notif-item" + (item.readAt ? "" : " is-unread");
        li.dataset.id = item.id;
        const href = (item.meta && item.meta.href) || "/todo.html#assigned";
        li.innerHTML =
          '<button type="button" class="notif-item-btn">' +
          '<strong class="notif-item-title"></strong>' +
          '<span class="notif-item-body"></span>' +
          '<span class="notif-item-time"></span>' +
          "</button>";
        li.querySelector(".notif-item-title").textContent = item.title || "Notification";
        li.querySelector(".notif-item-body").textContent = item.body || "";
        li.querySelector(".notif-item-time").textContent = formatRelative(item.createdAt);
        li.querySelector(".notif-item-btn").addEventListener("click", async function () {
          try {
            if (!item.readAt) {
              await apiRequest("/api/me/notifications/" + encodeURIComponent(item.id) + "/read", {
                method: "POST",
              });
              item.readAt = new Date().toISOString();
              unreadCount = Math.max(0, unreadCount - 1);
              updateChrome();
              renderList();
            }
          } catch (_) {
            /* ignore */
          }
          closePanel();
          if (href.indexOf("/") === 0 && href.indexOf("//") !== 0) {
            if (window.location.pathname + window.location.hash === href) {
              window.dispatchEvent(new CustomEvent("daily-space-open-assigned"));
            } else {
              window.location.href = href;
            }
          }
        });
        listEl.appendChild(li);
      });
    }

    function updateChrome() {
      const signedIn = Boolean(currentUserId());
      root.hidden = !signedIn;
      if (!signedIn) {
        closePanel();
        return;
      }
      const hasUnread = unreadCount > 0;
      dotEl.hidden = !hasUnread;
      bell.classList.toggle("has-unread", hasUnread);
      bell.setAttribute(
        "aria-label",
        hasUnread ? "Notifications, " + unreadCount + " unread" : "Notifications"
      );
      document.body.classList.toggle("has-notif-bell", signedIn);
    }

    async function refresh() {
      if (!currentUserId()) {
        items = [];
        unreadCount = 0;
        updateChrome();
        return;
      }
      try {
        const payload = await apiRequest("/api/me/notifications?limit=30");
        items = Array.isArray(payload.notifications) ? payload.notifications : [];
        unreadCount = Number(payload.unreadCount) || 0;
        updateChrome();
        if (open) renderList();
      } catch (_) {
        updateChrome();
      }
    }

    function openPanel() {
      open = true;
      panel.hidden = false;
      bell.setAttribute("aria-expanded", "true");
      renderList();
      refresh();
    }

    function closePanel() {
      open = false;
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }

    bell.addEventListener("click", function (event) {
      event.stopPropagation();
      for (const menu of document.querySelectorAll("[data-page-menu], #mail-tools")) menu.open = false;
      if (open) closePanel();
      else openPanel();
    });

    markAllBtn.addEventListener("click", async function (event) {
      event.stopPropagation();
      try {
        await apiRequest("/api/me/notifications/read-all", { method: "POST" });
        items = items.map(function (item) {
          return Object.assign({}, item, { readAt: item.readAt || new Date().toISOString() });
        });
        unreadCount = 0;
        updateChrome();
        renderList();
      } catch (_) {
        /* ignore */
      }
    });

    document.addEventListener("click", function (event) {
      if (!open) return;
      if (root.contains(event.target)) return;
      closePanel();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && open) closePanel();
    });

    window.addEventListener("daily-space-auth-updated", function () {
      refresh();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });

    function startPoll() {
      window.clearInterval(pollTimer);
      pollTimer = window.setInterval(function () {
        if (document.hidden) return;
        refresh();
      }, 30000);
    }

    updateChrome();
    refresh();
    startPoll();
  }

  function ensurePwaShell() {
    const head = document.head;
    if (!head) return;

    function ensureMeta(name, content) {
      let el = head.querySelector('meta[name="' + name + '"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    ensureMeta("theme-color", "#35322e");
    ensureMeta("mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    ensureMeta("apple-mobile-web-app-title", "Daily Space");

    const viewport = head.querySelector('meta[name="viewport"]');
    if (viewport) {
      const current = String(viewport.getAttribute("content") || "");
      if (!/viewport-fit\s*=/.test(current)) {
        viewport.setAttribute(
          "content",
          (current ? current.replace(/\s*$/, "") + ", " : "") + "viewport-fit=cover"
        );
      }
    }

    if (!head.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement("link");
      manifest.rel = "manifest";
      manifest.href = "manifest.json";
      head.appendChild(manifest);
    }

    if (!head.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement("link");
      icon.rel = "apple-touch-icon";
      icon.href = "android-chrome-192x192.png";
      head.appendChild(icon);
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
      // Native shell already caches via WebView / HTTP; avoid competing SWs.
      return;
    }
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    const run = function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* Offline shell is best-effort. */
      });
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  function setupNativeShell() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
      return;
    }

    document.documentElement.classList.add("is-native-shell");
    document.body?.classList.add("is-native-shell");

    const plugins = cap.Plugins || {};

    try {
      if (plugins.StatusBar) {
        const isDark = document.documentElement.dataset.theme === DARK;
        // Keep WebView below the status bar so Menu / language are tappable.
        if (typeof plugins.StatusBar.setOverlaysWebView === "function") {
          plugins.StatusBar.setOverlaysWebView({ overlay: false });
        }
        plugins.StatusBar.setStyle({ style: isDark ? "LIGHT" : "DARK" });
        if (typeof plugins.StatusBar.setBackgroundColor === "function") {
          plugins.StatusBar.setBackgroundColor({
            color: isDark ? "#131412" : "#e7e9ea",
          });
        }
      }
    } catch (_) {
      /* Status bar is optional polish. */
    }

    try {
      if (plugins.SplashScreen && typeof plugins.SplashScreen.hide === "function") {
        plugins.SplashScreen.hide();
      }
    } catch (_) {
      /* ignore */
    }

    try {
      if (plugins.App && typeof plugins.App.addListener === "function") {
        plugins.App.addListener("backButton", function (event) {
          if (window.DailySpaceMobileTodo?.closeIfOpen()) return;
          if (event && event.canGoBack) {
            window.history.back();
          } else if (plugins.App.exitApp) {
            plugins.App.exitApp();
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  function setupPrimaryNav() {
    const sidebarInner = document.querySelector(".sidebar-inner");
    if (!sidebarInner || sidebarInner.dataset.navReady === "1") return;

    const headings = Array.from(sidebarInner.querySelectorAll(".sidebar-heading"));
    const pagesHeading = headings.find(function (el) {
      return /^(pages|页面)$/i.test(String(el.textContent || "").trim());
    });
    if (!pagesHeading) return;

    const page = (window.location.pathname.split("/").pop() || "todo.html").toLowerCase();
    const primary = [
      { href: "todo.html#today", label: "Todo", match: /^(todo|todo-m)\.html$/ },
      { href: "calendar.html", label: "Calendar", match: /^calendar\.html$/ },
      { href: "planner.html", label: "Projects", match: /^planner\.html$/ },
      { href: "mail.html", label: "Mail", match: /^mail\.html$/ },
      { href: "tally.html", label: "Tally book", match: /^tally\.html$/ },
    ];
    const secondary = [
      { href: "travel.html", label: "Travel", match: /^travel\.html$/ },
      { href: "teamwork.html", label: "Teamwork", match: /^teamwork\.html$/ },
    ];

    let cursor = pagesHeading.nextElementSibling;
    while (cursor) {
      if (cursor.classList.contains("sidebar-heading") || cursor.classList.contains("sidebar-auth")) {
        break;
      }
      const next = cursor.nextElementSibling;
      if (
        cursor.matches("a.sidebar-page-link") ||
        cursor.matches("details.sidebar-more") ||
        cursor.matches(".sidebar-nav-primary")
      ) {
        cursor.remove();
      }
      cursor = next;
    }

    const frag = document.createDocumentFragment();
    primary.forEach(function (item) {
      const a = document.createElement("a");
      a.href = item.href;
      a.className = "sidebar-page-link";
      a.textContent = item.label;
      if (item.match.test(page)) {
        a.classList.add("is-active");
        a.setAttribute("aria-current", "page");
      }
      frag.appendChild(a);
    });

    const more = document.createElement("details");
    more.className = "sidebar-more";
    // Keep More expanded so Travel / Teamwork stay discoverable.
    more.open = true;
    const summary = document.createElement("summary");
    summary.className = "sidebar-more-summary";
    summary.textContent = "More";
    more.appendChild(summary);
    secondary.forEach(function (item) {
      const a = document.createElement("a");
      a.href = item.href;
      a.className = "sidebar-page-link";
      a.textContent = item.label;
      if (item.match.test(page)) {
        a.classList.add("is-active");
        a.setAttribute("aria-current", "page");
      }
      more.appendChild(a);
    });
    frag.appendChild(more);
    pagesHeading.after(frag);
    sidebarInner.dataset.navReady = "1";
  }

  function setupKeyboardShortcuts() {
    const NAV = {
      t: "todo.html#today",
      c: "calendar.html",
      p: "planner.html",
      m: "mail.html",
      a: "tally.html",
      v: "travel.html",
      w: "teamwork.html",
    };
    let pendingGo = false;
    let pendingTimer = 0;

    function clearPendingGo() {
      pendingGo = false;
      window.clearTimeout(pendingTimer);
      document.body.classList.remove("shortcut-go-armed");
    }

    function armGo() {
      pendingGo = true;
      document.body.classList.add("shortcut-go-armed");
      window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(clearPendingGo, 1400);
    }

    function isTypingTarget(target) {
      if (!target || !(target instanceof Element)) return false;
      const el = target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']");
      if (!el) return false;
      if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
      if (el.isContentEditable) return true;
      if (el.tagName === "INPUT") {
        const type = String(el.getAttribute("type") || "text").toLowerCase();
        return (
          [
            "button",
            "submit",
            "checkbox",
            "radio",
            "file",
            "reset",
            "range",
            "color",
            "hidden",
          ].indexOf(type) === -1
        );
      }
      return false;
    }

    function ensureSheet() {
      let sheet = document.getElementById("shortcuts-sheet");
      if (sheet) return sheet;
      sheet = document.createElement("div");
      sheet.id = "shortcuts-sheet";
      sheet.className = "shortcuts-sheet";
      sheet.setAttribute("data-dialog-root", "");
      sheet.hidden = true;
      sheet.innerHTML = `
        <div class="shortcuts-sheet-backdrop" data-shortcuts-close></div>
        <section class="shortcuts-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <button type="button" class="shortcuts-sheet-close" data-shortcuts-close data-dialog-close aria-label="Close shortcuts">×</button>
          <p class="shortcuts-sheet-kicker">Daily Space</p>
          <h2 class="shortcuts-sheet-title" id="shortcuts-title">Keyboard shortcuts</h2>
          <p class="shortcuts-sheet-copy">Press ? anytime to open this list. Keys are ignored while typing.</p>
          <div class="shortcuts-sheet-grid">
            <div class="shortcuts-group">
              <h3 class="shortcuts-group-title">Go</h3>
              <ul class="shortcuts-list">
                <li><kbd>g</kbd> then <kbd>t</kbd><span>Todo · Today</span></li>
                <li><kbd>g</kbd> then <kbd>c</kbd><span>Calendar</span></li>
                <li><kbd>g</kbd> then <kbd>p</kbd><span>Planner</span></li>
                <li><kbd>g</kbd> then <kbd>m</kbd><span>Mail</span></li>
                <li><kbd>g</kbd> then <kbd>a</kbd><span>Tally book</span></li>
                <li><kbd>g</kbd> then <kbd>v</kbd><span>Travel</span></li>
                <li><kbd>g</kbd> then <kbd>w</kbd><span>Teamwork</span></li>
              </ul>
            </div>
            <div class="shortcuts-group">
              <h3 class="shortcuts-group-title">Todo</h3>
              <ul class="shortcuts-list">
                <li><kbd>n</kbd><span>New task</span></li>
                <li><kbd>t</kbd><span>Focus today</span></li>
                <li><kbd>⌘</kbd><kbd>K</kbd><span>Jump palette</span></li>
                <li><kbd>/</kbd><span>Slash commands</span></li>
              </ul>
            </div>
            <div class="shortcuts-group">
              <h3 class="shortcuts-group-title">Anywhere</h3>
              <ul class="shortcuts-list">
                <li><kbd>?</kbd><span>This help</span></li>
                <li><kbd>d</kbd><span>Toggle theme</span></li>
                <li><kbd>Esc</kbd><span>Close panels</span></li>
              </ul>
            </div>
          </div>
        </section>
      `;
      document.body.appendChild(sheet);
      sheet.addEventListener("click", function (event) {
        const closeEl = event.target && event.target.closest("[data-shortcuts-close]");
        if (closeEl) closeSheet();
      });
      return sheet;
    }

    function isOpen() {
      const sheet = document.getElementById("shortcuts-sheet");
      return Boolean(sheet && !sheet.hidden);
    }

    function openSheet() {
      const sheet = ensureSheet();
      sheet.hidden = false;
      clearPendingGo();
      if (window.DailySpaceI18n && typeof window.DailySpaceI18n.apply === "function") {
        try {
          window.DailySpaceI18n.apply(sheet);
        } catch (_) {
          /* optional */
        }
      }
    }

    function closeSheet() {
      const sheet = document.getElementById("shortcuts-sheet");
      if (sheet) sheet.hidden = true;
    }

    function toggleTheme() {
      const nextTheme = document.documentElement.dataset.theme === DARK ? LIGHT : DARK;
      persistTheme(nextTheme);
      applyTheme(nextTheme);
      if (currentUserId()) {
        userSnapshotBaseline = "";
        flushUserSnapshotOnPageHide();
      }
    }

    function go(href) {
      clearPendingGo();
      if (!href) return;
      const here = (window.location.pathname.split("/").pop() || "todo.html").toLowerCase();
      const target = String(href).split("#")[0].toLowerCase();
      if (here === target && String(href).includes("#")) {
        window.location.hash = String(href).split("#")[1] || "";
        return;
      }
      if (here === target) return;
      window.location.href = href;
    }

    document.addEventListener("keydown", function (event) {
      if (document.body.classList.contains("welcome-active")) return;
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        closeSheet();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) {
        if (pendingGo) clearPendingGo();
        return;
      }

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        if (isOpen()) closeSheet();
        else openSheet();
        return;
      }

      if (isOpen()) return;

      const key = String(event.key || "").toLowerCase();

      if (pendingGo) {
        if (NAV[key]) {
          event.preventDefault();
          go(NAV[key]);
          return;
        }
        clearPendingGo();
        return;
      }

      if (key === "g" && !event.repeat) {
        event.preventDefault();
        armGo();
        return;
      }

      if (key === "d" && !event.repeat) {
        event.preventDefault();
        toggleTheme();
        return;
      }

      if (key === "n" || key === "t") {
        window.dispatchEvent(
          new CustomEvent("daily-space-shortcut", {
            detail: { action: key === "n" ? "new-task" : "focus-today" },
          })
        );
      }
    });

    window.DailySpaceShortcuts = {
      openHelp: openSheet,
      closeHelp: closeSheet,
    };
  }

  function setupGuestSavePrompt() {
    if (isWelcomePath(window.location.pathname)) return;
    const DISMISS_KEY = "daily-space-guest-save-dismissed-v1";

    function signedIn() {
      return Boolean(currentUserId());
    }

    function dismissed() {
      try {
        return sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch (_) {
        return false;
      }
    }

    function hasWork() {
      return Boolean(window.DailySpaceTasks && window.DailySpaceTasks.guestHasWorkspaceData());
    }

    function removeBanner() {
      const existing = document.getElementById("guest-save-banner");
      if (existing) existing.remove();
    }

    /** A row-flex main area would lay the banner out as a narrow side column. */
    function bannerHost() {
      const main = document.querySelector(".main-area");
      if (!main) return document.querySelector(".app") || document.body;
      const style = window.getComputedStyle(main);
      const isRow = style.display.includes("flex") && style.flexDirection.startsWith("row");
      return isRow && main.firstElementChild ? main.firstElementChild : main;
    }

    function renderBanner() {
      // Mail already has a single Google connection prompt for guests.
      if (document.body.classList.contains("mail-page")) {
        removeBanner();
        return;
      }
      removeBanner();
      if (signedIn() || dismissed() || !hasWork()) return;
      const banner = document.createElement("aside");
      banner.id = "guest-save-banner";
      banner.className = "guest-save-banner";
      banner.setAttribute("aria-label", "Save your workspace");
      banner.innerHTML =
        '<div class="guest-save-copy">' +
        '<p class="guest-save-kicker">Guest</p>' +
        '<p class="guest-save-title">Sign in to keep this work</p>' +
        '<p class="guest-save-hint">Saved on this device. Sign in to sync.</p>' +
        "</div>" +
        '<div class="guest-save-actions">' +
        '<button type="button" class="btn btn-primary" data-guest-signin="google">Continue with Google</button>' +
        '<button type="button" class="btn btn-ghost" data-guest-save-later>Later</button>' +
        "</div>";
      const host = bannerHost();
      const pageHeader = host.querySelector("[data-page-header]");
      if (pageHeader) pageHeader.insertAdjacentElement("afterend", banner);
      else host.insertBefore(banner, host.firstChild);
      if (window.DailySpaceI18n && typeof window.DailySpaceI18n.apply === "function") {
        window.DailySpaceI18n.apply();
      }
    }

    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-guest-save-later]")) {
        try {
          sessionStorage.setItem(DISMISS_KEY, "1");
        } catch (_) {
          /* ignore */
        }
        removeBanner();
        return;
      }
      const button = target.closest("[data-guest-signin]");
      if (!button) return;
      const provider = button.getAttribute("data-guest-signin");
      const auth = window.DailySpaceAuth;
      if (!auth) return;
      if (provider !== "google") return;
      const start = auth.startGoogleSignIn;
      if (typeof start === "function") {
        start().catch(function (error) {
          window.alert(
            error instanceof Error ? error.message : t("Sign-in failed.", "登录失败。")
          );
        });
      }
    });

    window.addEventListener("daily-space-auth-updated", renderBanner);
    window.addEventListener("daily-space-agent-data-updated", renderBanner);
    renderBanner();
  }

  function setupSharedUi() {
    ensurePwaShell();
    registerServiceWorker();
    setupThemeToggle();
    setupAutoSidebar();
    setupPrimaryNav();
    setupKeyboardShortcuts();
    setupAuthEntry();
    if (window.DailySpaceTasks && typeof window.DailySpaceTasks.syncLinkedWork === "function") {
      try {
        window.DailySpaceTasks.syncLinkedWork({ silent: true });
      } catch (_) {
        /* Keep chrome even if task linking fails. */
      }
    }
    if (window.DailySpaceLoop) {
      try {
        window.DailySpaceLoop.setupSidebarTodayStrip();
        window.DailySpaceLoop.setupReminderNotifications();
        window.DailySpaceLoop.setupWorkspaceSearch();
      } catch (_) {
        /* Keep shared chrome (greeting, sync) even if Today strip fails. */
      }
    }
    setupUserSnapshotSync();
    setupGreeting();
    setupWelcomeExperience();
    setupPageChrome();
    setupNotifications();
    setupGuestSavePrompt();
    setupNativeShell();
  }

  applyTheme(storedTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSharedUi);
  } else {
    setupSharedUi();
  }
})();
