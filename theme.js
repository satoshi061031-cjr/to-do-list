(function () {
  const STORAGE_THEME = "todo-theme";
  const STORAGE_AUTH = "daily-space-auth-v1";
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
  }

  function clearAuthState() {
    try {
      localStorage.removeItem(STORAGE_AUTH);
    } catch (_) {
      /* ignore */
    }
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

    authButton.addEventListener("click", openModal);

    modal.addEventListener("click", function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-auth-close]")) closeModal();
      const providerButton = target.closest(".auth-provider");
      if (providerButton) {
        const provider = providerButton.getAttribute("data-provider") || "provider";
        login(provider === "google" ? "Google" : "Meta", provider === "google" ? "Google user" : "Meta user");
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
      logoutButton.addEventListener("click", function () {
        clearAuthState();
        renderAuth();
        closeModal();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });

    renderAuth();
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
    const host = document.querySelector(".app, .planner-shell, .calendar-app, .tally-app");
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

  function setupSharedUi() {
    setupThemeToggle();
    setupAutoSidebar();
    setupAuthEntry();
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
