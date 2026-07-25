/**
 * Route Todo between desktop (todo.html) and mobile (todo-m.html).
 * - Narrow viewport on todo.html → todo-m.html
 * - Direct opens of todo-m.html always stay (so desktop can preview)
 * - ?device=mobile|desktop overrides and sticks for the tab session
 */
(function () {
  const MQ = "(max-width: 819px)";
  const FORCE_KEY = "dailyspace-device-force";
  const LOCK_KEY = "dailyspace-device-route-at";
  const LOCK_MS = 900;

  function fileName() {
    return (location.pathname.split("/").pop() || "").toLowerCase();
  }

  function isMobileTodoPage() {
    const file = fileName();
    return file === "todo-m.html" || file === "todo-m";
  }

  function isDesktopTodoPage() {
    const file = fileName();
    return file === "todo.html" || file === "todo";
  }

  function withSearchHash(base) {
    const params = new URLSearchParams(location.search);
    // Keep override in the URL when forcing a device.
    const force = readForce();
    if (force === "mobile" || force === "desktop") {
      params.set("device", force);
    } else {
      params.delete("device");
    }
    const qs = params.toString();
    return base + (qs ? `?${qs}` : "") + location.hash;
  }

  function readForceFromQuery() {
    try {
      const raw = new URLSearchParams(location.search).get("device");
      if (raw === "mobile" || raw === "desktop") return raw;
    } catch (_) {}
    return "";
  }

  function readForce() {
    const fromQuery = readForceFromQuery();
    if (fromQuery) {
      try {
        sessionStorage.setItem(FORCE_KEY, fromQuery);
      } catch (_) {}
      return fromQuery;
    }
    try {
      const stored = sessionStorage.getItem(FORCE_KEY);
      if (stored === "mobile" || stored === "desktop") return stored;
    } catch (_) {}
    return "";
  }

  function canRedirect() {
    const last = Number(sessionStorage.getItem(LOCK_KEY) || 0);
    return Date.now() - last >= LOCK_MS;
  }

  function go(url) {
    if (!canRedirect()) return;
    sessionStorage.setItem(LOCK_KEY, String(Date.now()));
    location.replace(url);
  }

  function syncRoute() {
    if (!isMobileTodoPage() && !isDesktopTodoPage()) return;

    const force = readForce();
    const narrow = window.matchMedia(MQ).matches;

    if (force === "mobile") {
      if (isDesktopTodoPage()) go(withSearchHash("todo-m.html"));
      return;
    }
    if (force === "desktop") {
      if (isMobileTodoPage()) go(withSearchHash("todo.html"));
      return;
    }

    // Auto: phones hitting desktop Todo land on the mobile shell.
    if (narrow && isDesktopTodoPage()) {
      go(withSearchHash("todo-m.html"));
    }
    // Never bounce todo-m → todo on load; opening the mobile URL must work on desktop.
  }

  syncRoute();
})();
