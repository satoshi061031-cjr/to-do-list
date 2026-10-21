/** Minimal, read-only snapshot for the iOS WidgetKit extension. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DailySpaceNativeWidget = api;
})(typeof window === "object" ? window : globalThis, function () {
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  function session() {
    let owner = null, verified = false;
    return ({ userId, snapshotUserId, status }) => {
      const current = userId || "";
      if (current !== owner) { owner = current; verified = false; }
      if (current && current === snapshotUserId && status === "ok") verified = true;
      return !current || verified;
    };
  }

  function snapshot(context, now = new Date()) {
    const locale = context.locale === "zh" ? "zh" : "en";
    const result = { version: 1, updatedAt: now.getTime(), locale, ready: context.ready === true, days: [] };
    if (!result.ready) return result;
    const tasks = Array.isArray(context.todos) ? context.todos : [];
    for (let offset = 0; offset < 8; offset++) {
      // Calendar arithmetic preserves the local date across DST and year boundaries.
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
      const key = dayKey(date);
      const due = tasks.filter(task => task && task.dueDate === key && typeof task.text === "string" && task.text.trim());
      const open = due.filter(task => task.completed !== true);
      const time = task => /^([01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime || "") ? task.dueTime : null;
      const items = open.map((task, index) => ({ task, index, time: time(task) }))
        .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.index - b.index)
        .slice(0, 4).map(({ task, time }) => ({ title: [...task.text.trim()].slice(0, 120).join(""), time }));
      result.days.push({ date: key, total: due.length, completed: due.length - open.length, items });
    }
    return result;
  }

  function connect(cap, context, environment = window) {
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== "ios") return null;
    if (cap.isPluginAvailable && !cap.isPluginAvailable("DailySpaceWidget")) return null;
    const plugin = cap.registerPlugin?.("DailySpaceWidget") || cap.Plugins?.DailySpaceWidget;
    if (!plugin) return null;
    let queued = null, writing = false, previous = "", stopped = false;
    async function drain() {
      if (writing) return;
      writing = true;
      try {
        while (queued && !stopped) {
          const value = queued; queued = null;
          try { await plugin.updateSnapshot({ snapshot: value }); }
          catch (_) { previous = ""; /* Retry on the next app/data event. */ }
        }
      } finally { writing = false; }
    }
    function sync() {
      if (stopped) return;
      let value;
      try { value = snapshot(context()); } catch (_) { value = snapshot({ ready: false }); }
      const signature = JSON.stringify({ ...value, updatedAt: 0 });
      if (signature === previous) return;
      previous = signature;
      queued = value;
      void drain();
    }
    let routing = false, routeRequested = false;
    async function route() {
      routeRequested = true;
      if (routing || stopped) return;
      routing = true;
      try {
        while (routeRequested && !stopped) {
          routeRequested = false;
          const target = await plugin.consumeRoute();
          if (target.route === "today") { environment.location.assign("todo-m.html#today"); return; }
        }
      } catch (_) { /* Older native binaries may not have the widget bridge. */ }
      finally { routing = false; }
    }
    const events = ["daily-space-agent-data-updated", "daily-space-auth-updated", "daily-space-user-sync-updated", "daily-space-locale-changed", "pageshow", "pagehide"];
    events.forEach(event => environment.addEventListener(event, sync));
    const visibility = () => sync();
    environment.document.addEventListener("visibilitychange", visibility);
    let routeListener;
    Promise.resolve().then(() => plugin.addListener("routeAvailable", route)).then(listener => { routeListener = listener; if (stopped) listener.remove(); return route(); }).catch(() => {});
    sync();
    return { sync, stop() {
      stopped = true; queued = null;
      events.forEach(event => environment.removeEventListener(event, sync));
      environment.document.removeEventListener("visibilitychange", visibility);
      routeListener?.remove();
    } };
  }
  return { snapshot, session, connect };
});
