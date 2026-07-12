(function () {
  const STORAGE_THEME = "todo-theme";
  const STORAGE_AUTH = "daily-space-auth-v1";
  const SYNC_CODE_STORAGE = "daily-space-sync-code-v1";
  const SYNC_META_STORAGE = "daily-space-sync-meta-v1";
  const SYNC_KEYS = [
    "todo-app-v2",
    "planner-app-v1",
    "calendar-app-v1",
    "tally-book-v1",
    "teamwork-page-v1",
    "daily-space-mail-accounts-v1",
    STORAGE_THEME,
    STORAGE_AUTH,
  ];
  const USER_SNAPSHOT_KEYS = SYNC_KEYS.filter(function (key) {
    return key !== STORAGE_AUTH;
  });
  const USER_SNAPSHOT_INTERVAL_MS = 30000;
  const USER_LOCAL_CACHE_PREFIX = "daily-space-user-cache-v1:";
  const USER_LAST_ID_STORAGE = "daily-space-last-user-v1";
  const DARK = "dark";
  const LIGHT = "light";
  let userSnapshotTimer = 0;
  let userSnapshotInFlight = false;
  let userSnapshotUserId = "";
  let userSnapshotBaseline = "";
  let userSnapshotLastSyncedAt = "";
  let userSnapshotStatus = "idle";

  function storedTheme() {
    try {
      return localStorage.getItem(STORAGE_THEME) === DARK ? DARK : LIGHT;
    } catch (_) {
      return LIGHT;
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_THEME, theme);
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
  }

  function setupThemeToggle() {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    applyTheme(storedTheme());
    toggle.addEventListener("click", function () {
      const nextTheme = document.documentElement.dataset.theme === DARK ? LIGHT : DARK;
      persistTheme(nextTheme);
      applyTheme(nextTheme);
    });
  }

  function setupAutoSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar || !window.matchMedia) return;

    const desktopQuery = window.matchMedia("(min-width: 820px)");
    let closeTimer = 0;

    function isDesktop() {
      return desktopQuery.matches;
    }

    function openSidebar() {
      if (!isDesktop()) return;
      window.clearTimeout(closeTimer);
      sidebar.classList.add("is-auto-open");
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

    function syncMode() {
      window.clearTimeout(closeTimer);
      sidebar.classList.remove("is-auto-open");
    }

    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener("change", syncMode);
    } else if (desktopQuery.addListener) {
      desktopQuery.addListener(syncMode);
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

  const DEFAULT_APP_PATH = "/todo.html";

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
    let succeeded = false;

    if (status === "success") {
      succeeded = true;
      saveAuthState({
        provider,
        label: email ? `${label} (${email})` : label,
        email,
        mailProvider: provider.toLowerCase(),
      });
      linkMailAccountFromAuth(provider, email, label).catch(function () {
        /* Best-effort sync so sign-in UX remains smooth. */
      });
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
    modal.hidden = true;
    modal.innerHTML = `
      <div class="auth-modal-backdrop" data-auth-close></div>
      <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" class="auth-close" data-auth-close aria-label="Close login">×</button>
        <p class="auth-kicker">Daily Space</p>
        <h2 class="auth-title" id="auth-title">Sign in</h2>
        <p class="auth-copy">Continue with a provider to keep your workspace synced.</p>
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
          <button type="button" class="auth-provider" data-provider="outlook">
            <span class="auth-provider-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path fill="#f25022" d="M2 2h9.2v9.2H2z" />
                <path fill="#7fba00" d="M12.8 2H22v9.2h-9.2z" />
                <path fill="#00a4ef" d="M2 12.8h9.2V22H2z" />
                <path fill="#ffb900" d="M12.8 12.8H22V22h-9.2z" />
              </svg>
            </span>
            <span>Sign in with Outlook</span>
          </button>
        </div>
        <div class="auth-divider" aria-hidden="true"><span>OR</span></div>
        <button type="button" class="auth-alt-trigger">Continue with phone or email</button>
        <form class="auth-phone-form" hidden>
          <label class="auth-phone-label" for="auth-phone-input">Phone number</label>
          <div class="auth-phone-row">
            <input id="auth-phone-input" class="auth-phone-input" type="tel" inputmode="tel" placeholder="+1 555 000 0000" />
            <button type="submit" class="auth-phone-submit">Continue</button>
          </div>
        </form>
        <button type="button" class="auth-logout" hidden>Sign out</button>
        <p class="auth-note">OAuth needs a backend or auth service before these providers can become real sign-ins.</p>
      </section>
    `;
    document.body.appendChild(modal);

    const phoneForm = modal.querySelector(".auth-phone-form");
    const phoneInput = modal.querySelector(".auth-phone-input");
    const logoutButton = modal.querySelector(".auth-logout");
    const altTrigger = modal.querySelector(".auth-alt-trigger");

    function renderAuth() {
      const state = readAuthState();
      authLabel.textContent = state ? state.label : "Sign in";
      authHint.textContent = state ? state.provider : "Google, Outlook, phone";
      if (!state) {
        authSync.hidden = true;
      } else if (userSnapshotLastSyncedAt) {
        authSync.hidden = false;
        authSync.textContent = `Cloud sync: ${formatSyncTime(userSnapshotLastSyncedAt)}`;
      } else if (userSnapshotStatus === "syncing") {
        authSync.hidden = false;
        authSync.textContent = "Cloud sync: syncing...";
      } else if (userSnapshotStatus === "error") {
        authSync.hidden = false;
        authSync.textContent = "Cloud sync: unavailable";
      } else {
        authSync.hidden = false;
        authSync.textContent = "Cloud sync: ready";
      }
      authButton.classList.toggle("is-signed-in", !!state);
      if (logoutButton) logoutButton.hidden = !state;
      renderGreeting();
    }

    window.addEventListener("daily-space-auth-updated", renderAuth);
    window.addEventListener("daily-space-user-sync-updated", renderAuth);

    function openModal() {
      renderAuth();
      modal.hidden = false;
      document.body.classList.add("auth-modal-open");
      if (phoneForm instanceof HTMLFormElement) phoneForm.hidden = true;
      const firstProvider = modal.querySelector(".auth-provider");
      if (firstProvider) firstProvider.focus();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("auth-modal-open");
      authButton.focus();
    }

    function login(provider, label) {
      saveAuthState({ provider, label });
      renderAuth();
      closeModal();
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

    async function startOutlookSignIn() {
      const response = await fetch("/api/auth/outlook/start", {
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
        throw new Error((payload && payload.error) || "Outlook sign-in failed.");
      }
      if (!payload.authUrl) throw new Error("Missing Outlook authorization URL.");
      window.location.href = payload.authUrl;
    }

    authButton.addEventListener("click", openModal);

    modal.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-auth-close]")) closeModal();
      const providerButton = target.closest(".auth-provider");
      if (providerButton) {
        const provider = providerButton.getAttribute("data-provider") || "provider";
        if (provider === "google") {
          startGoogleSignIn().catch(function (error) {
            window.alert(error instanceof Error ? error.message : "Google sign-in failed.");
          });
        } else {
          startOutlookSignIn().catch(function (error) {
            window.alert(error instanceof Error ? error.message : "Outlook sign-in failed.");
          });
        }
      }
    });

    if (phoneForm && phoneInput) {
      phoneForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const phone = phoneInput.value.trim();
        if (!phone) {
          phoneInput.focus();
          return;
        }
        login("Phone", phone);
      });
    }

    if (altTrigger && phoneForm && phoneInput) {
      altTrigger.addEventListener("click", function () {
        if (!(phoneForm instanceof HTMLFormElement) || !(phoneInput instanceof HTMLInputElement)) return;
        phoneForm.hidden = false;
        phoneInput.focus();
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

  function greetingTextForNow() {
    const hour = new Date().getHours();
    return hour < 12 ? "Good morning" : "Good evening";
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
    if (title) title.textContent = `${greetingTextForNow()}, ${userNameForGreeting()}`;
    if (time) {
      time.textContent = new Date().toLocaleString(undefined, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
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
    window.setInterval(renderGreeting, 60000);
  }

  function setupWelcomeExperience() {
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
    const field = stage?.querySelector(".welcome-ghost-field");
    const ghost = field?.querySelector(".welcome-floating-ghost");
    const lens = stage?.querySelector(".welcome-lens");
    if (
      !(stage instanceof HTMLElement) ||
      !(field instanceof HTMLElement) ||
      !(ghost instanceof HTMLImageElement) ||
      !(lens instanceof HTMLButtonElement)
    ) {
      return;
    }

    let progress = 0;
    let dragStartY = 0;
    let dragStartProgress = 0;
    let dragging = false;
    let moved = false;
    let ghostTimer = 0;

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function moveGhost() {
      window.clearTimeout(ghostTimer);
      const maxX = Math.max(0, field.clientWidth - ghost.offsetWidth);
      const maxY = Math.max(0, field.clientHeight - ghost.offsetHeight);
      const x = randomBetween(maxX * 0.04, maxX * 0.96);
      const y = randomBetween(0, maxY);
      const rotation = randomBetween(-14, 14);
      ghost.style.transitionDuration = `${randomBetween(2.4, 4).toFixed(2)}s`;
      ghost.style.transform =
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ` +
        `rotate(${rotation.toFixed(1)}deg) scale(var(--welcome-ghost-scale))`;
      ghostTimer = window.setTimeout(moveGhost, randomBetween(2800, 4400));
    }

    function setProgress(nextProgress, settle) {
      progress = Math.max(0, Math.min(1, nextProgress));
      if (settle) {
        const expanded = progress >= 0.5;
        progress = expanded ? 1 : 0;
        stage.classList.toggle("is-expanded", expanded);
        lens.setAttribute("aria-expanded", String(expanded));
        lens.setAttribute("aria-label", expanded ? "Collapse welcome screen" : "Drag up to enter");
      }
      stage.style.setProperty("--welcome-progress", progress.toFixed(3));
      stage.style.setProperty("--welcome-ghost-scale", (0.82 + progress * 0.18).toFixed(3));
      stage.style.setProperty("--welcome-intro-opacity", Math.max(0, 1 - progress * 1.6).toFixed(3));
      stage.style.setProperty("--welcome-intro-y", `${(-progress * 3.5).toFixed(3)}rem`);
      stage.style.setProperty("--welcome-reveal-opacity", Math.max(0, Math.min(1, (progress - 0.42) * 2.8)).toFixed(3));
      stage.style.setProperty("--welcome-reveal-y", `${((1 - progress) * 2).toFixed(3)}rem`);
      stage.style.setProperty("--welcome-actions-opacity", Math.max(0, Math.min(1, (progress - 0.55) * 3)).toFixed(3));
      stage.style.setProperty("--welcome-actions-y", `${((1 - progress) * 2.5).toFixed(3)}rem`);
      stage.style.setProperty("--welcome-lens-y", `${(-progress * 60).toFixed(3)}vh`);
      stage.style.setProperty("--welcome-lens-scale", (1 - progress * 0.7).toFixed(3));
      stage.style.setProperty("--welcome-hint-opacity", Math.max(0, 1 - progress * 2).toFixed(3));
    }

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

    lens.addEventListener("pointerdown", function (event) {
      dragging = true;
      moved = false;
      dragStartY = event.clientY;
      dragStartProgress = progress;
      lens.setPointerCapture(event.pointerId);
      stage.classList.add("is-dragging");
    });

    lens.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      const delta = dragStartY - event.clientY;
      if (Math.abs(delta) > 6) moved = true;
      setProgress(dragStartProgress + delta / Math.max(220, stage.clientHeight * 0.48), false);
    });

    function finishDrag(event) {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove("is-dragging");
      if (lens.hasPointerCapture(event.pointerId)) lens.releasePointerCapture(event.pointerId);
      setProgress(progress, true);
    }

    lens.addEventListener("pointerup", finishDrag);
    lens.addEventListener("pointercancel", finishDrag);
    lens.addEventListener("click", function () {
      if (moved) {
        moved = false;
        return;
      }
      setProgress(progress < 0.5 ? 1 : 0, true);
    });

    stage.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const providerButton = target.closest("[data-welcome-provider]");
      if (!providerButton) return;
      const provider = providerButton.getAttribute("data-welcome-provider");
      if (provider !== "google" && provider !== "outlook") return;
      startWelcomeSignIn(provider).catch(function (error) {
        window.alert(error instanceof Error ? error.message : "Sign-in failed.");
      });
    });

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (ghost.complete) moveGhost();
      else ghost.addEventListener("load", moveGhost, { once: true });
      window.addEventListener("resize", moveGhost);
    }
  }

  async function requestSync(method, code, payload) {
    const response = await fetch(`/api/sync/${encodeURIComponent(code)}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      const message = data && typeof data.error === "string" ? data.error : "Sync request failed.";
      throw new Error(message);
    }
    return data;
  }

  async function requestUserSnapshot(method, payload) {
    const response = await fetch("/api/user/snapshot", {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      const message = data && typeof data.error === "string" ? data.error : "User sync request failed.";
      throw new Error(message);
    }
    return data;
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

  function collectSyncPayload() {
    return collectPayloadForKeys(SYNC_KEYS);
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

  function syncSignatureFromPayload(payload) {
    return SYNC_KEYS.map(function (key) {
      const value = payload && typeof payload[key] === "string" ? payload[key] : "";
      return `${key}:${value.length}:${value}`;
    }).join("|");
  }

  function readSyncMeta() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_META_STORAGE) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeSyncMeta(patch) {
    const next = { ...readSyncMeta(), ...patch };
    try {
      localStorage.setItem(SYNC_META_STORAGE, JSON.stringify(next));
    } catch (_) {
      /* ignore metadata failures */
    }
    return next;
  }

  function formatSyncTime(iso) {
    if (!iso) return "Never";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "Never";
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function applySyncPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    Object.keys(payload).forEach(function (key) {
      if (!SYNC_KEYS.includes(key)) return;
      const value = payload[key];
      if (typeof value !== "string") return;
      try {
        localStorage.setItem(key, value);
      } catch (_) {
        /* ignore write failures */
      }
    });
    applyTheme(storedTheme());
    renderGreeting();
  }

  function userSnapshotSignature(payload) {
    return USER_SNAPSHOT_KEYS.map(function (key) {
      const value = payload && typeof payload[key] === "string" ? payload[key] : "";
      return `${key}:${value.length}:${value}`;
    }).join("|");
  }

  function applyUserSnapshotPayload(payload) {
    const nextPayload = payload && typeof payload === "object" ? payload : {};
    USER_SNAPSHOT_KEYS.forEach(function (key) {
      const value = nextPayload[key];
      try {
        if (typeof value === "string") localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch (_) {
        /* ignore write failures */
      }
    });
    applyTheme(storedTheme());
    renderGreeting();
  }

  async function loadSnapshotForCurrentUser() {
    const userId = currentUserId();
    if (!userId) return;
    const previousUserId = userSnapshotUserId || readLastUserId();
    const localPayload = collectUserSnapshotPayload();
    if (previousUserId && previousUserId !== userId) {
      writeUserLocalCache(previousUserId, localPayload);
    }
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    const data = await requestUserSnapshot("GET");
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
      applyUserSnapshotPayload(nextPayload);
    }
    userSnapshotUserId = userId;
    writeLastUserId(userId);
    writeUserLocalCache(userId, collectUserSnapshotPayload());
    userSnapshotBaseline = userSnapshotSignature(collectUserSnapshotPayload());
    userSnapshotLastSyncedAt = syncedAt;
    userSnapshotStatus = "ok";
    emitUserSnapshotUpdate();
  }

  async function userSnapshotTick() {
    if (userSnapshotInFlight || document.hidden) return;
    const userId = currentUserId();
    if (!userId) return;
    userSnapshotInFlight = true;
    userSnapshotStatus = "syncing";
    emitUserSnapshotUpdate();
    try {
      if (userSnapshotUserId !== userId) {
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
        userSnapshotBaseline = signature;
        userSnapshotLastSyncedAt = saved.updatedAt || new Date().toISOString();
        writeUserLocalCache(userId, payload);
      }
      userSnapshotStatus = "ok";
      emitUserSnapshotUpdate();
    } catch (_) {
      userSnapshotStatus = "error";
      emitUserSnapshotUpdate();
    } finally {
      userSnapshotInFlight = false;
    }
  }

  function stopUserSnapshotSync() {
    const previousUserId = userSnapshotUserId || readLastUserId();
    if (previousUserId) {
      writeUserLocalCache(previousUserId, collectUserSnapshotPayload());
      applyUserSnapshotPayload({});
    }
    window.clearInterval(userSnapshotTimer);
    userSnapshotTimer = 0;
    userSnapshotUserId = "";
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
      } catch (_) {
        /* keep UX responsive even if sync unavailable */
        userSnapshotStatus = "error";
        emitUserSnapshotUpdate();
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
      if (!document.hidden) userSnapshotTick();
    });
    refreshUserSnapshotSession(false);
  }

  function setupSyncPanel() {
    const sidebarInner = document.querySelector(".sidebar-inner");
    if (!sidebarInner) return;

    const block = document.createElement("div");
    block.className = "sidebar-sync";
    block.innerHTML = `
      <div class="sidebar-heading">Sync</div>
      <form class="sync-form" autocomplete="off">
        <input class="sync-input" maxlength="32" placeholder="sync code (e.g. team-2026)" aria-label="Sync code" />
        <div class="sync-actions">
          <button class="sync-btn" type="button" data-action="upload">Upload</button>
          <button class="sync-btn" type="button" data-action="download">Download</button>
        </div>
        <p class="sync-last" aria-live="polite"></p>
        <p class="sync-status" aria-live="polite"></p>
      </form>
    `;
    sidebarInner.appendChild(block);

    const input = block.querySelector(".sync-input");
    const last = block.querySelector(".sync-last");
    const status = block.querySelector(".sync-status");
    if (!(input instanceof HTMLInputElement) || !(status instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
    let autoTimer = 0;
    let inFlight = false;
    let syncMeta = readSyncMeta();

    function setStatus(message) {
      status.textContent = message;
    }

    function updateLastSyncText() {
      last.textContent = `Last sync: ${formatSyncTime(syncMeta.lastSyncedAt)}`;
    }

    function normalizedCode() {
      return input.value.trim().toLowerCase();
    }

    try {
      input.value = localStorage.getItem(SYNC_CODE_STORAGE) || "";
    } catch (_) {
      /* ignore */
    }

    input.addEventListener("input", function () {
      try {
        localStorage.setItem(SYNC_CODE_STORAGE, normalizedCode());
      } catch (_) {
        /* ignore */
      }
    });

    async function upload(code, reason) {
      const payload = collectSyncPayload();
      const localSignature = syncSignatureFromPayload(payload);
      const result = await requestSync("PUT", code, { payload: payload });
      const now = new Date().toISOString();
      syncMeta = writeSyncMeta({
        lastSyncedAt: now,
        lastUploadedAt: now,
        baselineSignature: localSignature,
        remoteUpdatedAt: result.updatedAt || now,
      });
      updateLastSyncText();
      if (reason === "auto") setStatus("Auto-sync uploaded.");
      else setStatus("Uploaded successfully.");
    }

    async function download(code, reason) {
      const data = await requestSync("GET", code);
      const remotePayload = data && data.payload && typeof data.payload === "object" ? data.payload : {};
      applySyncPayload(remotePayload);
      const now = new Date().toISOString();
      const remoteSignature = syncSignatureFromPayload(remotePayload);
      syncMeta = writeSyncMeta({
        lastSyncedAt: now,
        lastDownloadedAt: now,
        baselineSignature: remoteSignature,
        remoteUpdatedAt: data.updatedAt || now,
      });
      updateLastSyncText();
      if (reason === "auto") setStatus("Auto-sync downloaded.");
      else setStatus("Downloaded. Refreshing page...");
      window.setTimeout(function () {
        window.location.reload();
      }, 350);
    }

    async function autoSyncTick() {
      if (inFlight || document.hidden) return;
      const code = normalizedCode();
      if (!/^[a-z0-9_-]{4,32}$/.test(code)) return;

      inFlight = true;
      try {
        const localPayload = collectSyncPayload();
        const localSignature = syncSignatureFromPayload(localPayload);
        const data = await requestSync("GET", code);
        const remotePayload = data && data.payload && typeof data.payload === "object" ? data.payload : {};
        const remoteSignature = syncSignatureFromPayload(remotePayload);
        const baselineSignature = syncMeta.baselineSignature || "";
        const localChanged = localSignature !== baselineSignature;
        const remoteChanged = remoteSignature !== baselineSignature;

        if (!localChanged && !remoteChanged) return;
        if (!localChanged && remoteChanged) {
          await download(code, "auto");
          return;
        }
        if (localChanged && !remoteChanged) {
          await upload(code, "auto");
          return;
        }

        setStatus("Conflict detected: local and remote both changed.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Auto-sync failed.");
      } finally {
        inFlight = false;
      }
    }

    function restartAutoSync() {
      window.clearInterval(autoTimer);
      autoTimer = window.setInterval(autoSyncTick, 60_000);
    }

    updateLastSyncText();
    restartAutoSync();

    block.addEventListener("click", async function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(".sync-btn");
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.getAttribute("data-action");
      const code = normalizedCode();
      if (!/^[a-z0-9_-]{4,32}$/.test(code)) {
        setStatus("Use 4-32 letters/numbers for sync code.");
        input.focus();
        return;
      }

      button.disabled = true;
      inFlight = true;
      setStatus(action === "upload" ? "Uploading..." : "Downloading...");
      try {
        if (action === "upload") {
          await upload(code, "manual");
        } else {
          const localPayload = collectSyncPayload();
          const localSignature = syncSignatureFromPayload(localPayload);
          const data = await requestSync("GET", code);
          const remotePayload = data && data.payload && typeof data.payload === "object" ? data.payload : {};
          const remoteSignature = syncSignatureFromPayload(remotePayload);
          const baselineSignature = syncMeta.baselineSignature || "";
          const localChanged = localSignature !== baselineSignature;
          const remoteChanged = remoteSignature !== baselineSignature;
          if (localChanged && remoteChanged) {
            const useRemote = window.confirm(
              "Conflict detected.\nPress OK to use remote data, or Cancel to keep local changes and upload them."
            );
            if (useRemote) {
              await download(code, "manual");
            } else {
              await upload(code, "manual");
            }
          } else {
            await download(code, "manual");
          }
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Sync failed.");
      } finally {
        inFlight = false;
        button.disabled = false;
      }
    });

    window.addEventListener("beforeunload", function () {
      window.clearInterval(autoTimer);
    });
  }

  function setupSharedUi() {
    setupThemeToggle();
    setupAutoSidebar();
    setupAuthEntry();
    setupUserSnapshotSync();
    setupSyncPanel();
    setupGreeting();
    setupWelcomeExperience();
  }

  applyTheme(storedTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSharedUi);
  } else {
    setupSharedUi();
  }
})();
