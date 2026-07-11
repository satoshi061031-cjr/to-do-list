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
  const DARK = "dark";
  const LIGHT = "light";

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

    authButton.append(authLabel, authHint);
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
        <p class="auth-copy">Choose a login method to personalize this app on this device.</p>
        <div class="auth-provider-list">
          <button type="button" class="auth-provider" data-provider="google">Continue with Google</button>
          <button type="button" class="auth-provider" data-provider="meta">Continue with Meta</button>
        </div>
        <form class="auth-phone-form">
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

    function renderAuth() {
      const state = readAuthState();
      authLabel.textContent = state ? state.label : "Sign in";
      authHint.textContent = state ? state.provider : "Google, Meta, phone";
      authButton.classList.toggle("is-signed-in", !!state);
      if (logoutButton) logoutButton.hidden = !state;
      renderGreeting();
    }

    window.addEventListener("daily-space-auth-updated", renderAuth);

    function openModal() {
      renderAuth();
      modal.hidden = false;
      document.body.classList.add("auth-modal-open");
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

    async function startMetaSignIn() {
      const response = await fetch("/api/auth/meta/start", {
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
        throw new Error((payload && payload.error) || "Meta sign-in failed.");
      }
      if (!payload.authUrl) throw new Error("Missing Meta authorization URL.");
      window.location.href = payload.authUrl;
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

    function applyUserAuthResultFromUrl() {
      const url = new URL(window.location.href);
      const status = url.searchParams.get("userauth");
      if (!status) return;

      const provider = url.searchParams.get("provider") || "Google";
      const label = url.searchParams.get("label") || "Google user";
      const email = url.searchParams.get("email") || "";
      const message = url.searchParams.get("message") || "";
      if (status === "success") {
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
      renderAuth();
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
          startMetaSignIn().catch(function (error) {
            window.alert(error instanceof Error ? error.message : "Meta sign-in failed.");
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

    if (logoutButton) {
      logoutButton.addEventListener("click", async function () {
        logoutButton.setAttribute("disabled", "true");
        try {
          await disconnectLinkedMailbox(readAuthState());
        } catch (_) {
          /* linked mailbox disconnect is best-effort */
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

  function setupWelcomeSticker() {
    const sticker = document.querySelector(".welcome-sticker");
    const card = document.querySelector(".welcome-card");
    const stage = document.querySelector(".welcome-screen");
    if (!sticker || !stage || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let moveTimer = 0;

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function overlapsCard(x, y, width, height) {
      if (!card) return false;
      const stageRect = stage.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const gap = 36;
      const stickerRect = {
        left: stageRect.left + x,
        right: stageRect.left + x + width,
        top: stageRect.top + y,
        bottom: stageRect.top + y + height,
      };

      return (
        stickerRect.left < cardRect.right + gap &&
        stickerRect.right > cardRect.left - gap &&
        stickerRect.top < cardRect.bottom + gap &&
        stickerRect.bottom > cardRect.top - gap
      );
    }

    function randomTarget() {
      const width = sticker.offsetWidth || 120;
      const height = sticker.offsetHeight || 120;
      const maxX = Math.max(0, stage.clientWidth - width);
      const maxY = Math.max(0, stage.clientHeight - height);

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const x = randomBetween(0, maxX);
        const y = randomBetween(0, maxY);
        if (!overlapsCard(x, y, width, height)) {
          return { x, y, rotation: randomBetween(-16, 16) };
        }
      }

      const edgeX = Math.random() > 0.5 ? randomBetween(maxX * 0.72, maxX) : randomBetween(0, maxX * 0.18);
      const edgeY = Math.random() > 0.5 ? randomBetween(maxY * 0.72, maxY) : randomBetween(0, maxY * 0.18);
      return { x: edgeX, y: edgeY, rotation: randomBetween(-16, 16) };
    }

    function moveSticker() {
      const target = randomTarget();
      sticker.style.transitionDuration = `${randomBetween(4.4, 7.2).toFixed(2)}s`;
      sticker.style.transform = `translate3d(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px, 0) rotate(${target.rotation.toFixed(1)}deg)`;
      moveTimer = window.setTimeout(moveSticker, randomBetween(4600, 7800));
    }

    function restartMotion() {
      window.clearTimeout(moveTimer);
      moveSticker();
    }

    if (sticker.complete) {
      restartMotion();
    } else {
      sticker.addEventListener("load", restartMotion, { once: true });
    }

    window.addEventListener("resize", restartMotion);
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

  function collectSyncPayload() {
    const payload = {};
    SYNC_KEYS.forEach(function (key) {
      try {
        const value = localStorage.getItem(key);
        if (value != null) payload[key] = value;
      } catch (_) {
        /* ignore inaccessible keys */
      }
    });
    return payload;
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
    setupSyncPanel();
    setupGreeting();
    setupWelcomeSticker();
  }

  applyTheme(storedTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSharedUi);
  } else {
    setupSharedUi();
  }
})();
