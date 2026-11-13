/** Persistent personal-workbench choices, shared by cloud sync and file transfer. */
(function (global) {
  const KEY = "daily-space-workbench-v1";
  const SECTIONS = ["agenda", "tasks", "shortcuts", "spend", "travel"];
  const SHORTCUTS = ["planner", "mail", "tally", "travel", "calendar"];
  const WIDGETS = ["tasks", "agenda", "focus", "detail"];
  const CONTEXTS = ["default", "work", "life", "travel"];

  function defaults() {
    return { version: 1, name: "", displayName: "", sections: [...SECTIONS], hidden: [], shortcuts: ["planner", "mail", "travel"] };
  }
  function title(value) {
    return typeof value === "string" ? Array.from(value.replace(/\s+/gu, " ").trim()).slice(0, 40).join("") : "";
  }
  function choices(value, allowed) {
    return [...new Set((Array.isArray(value) ? value.slice(0, 100) : []).filter(item => allowed.includes(item)))];
  }
  function clean(value, max) { return typeof value === "string" ? Array.from(value.trim()).slice(0, max).join("") : ""; }
  function safeUrl(value) {
    try {
      const url = new URL(clean(value, 2000));
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function bookmarks(raw) {
    const seen = new Set();
    return (Array.isArray(raw) ? raw.slice(0, 40) : []).flatMap(item => {
      const id = clean(item?.id, 120), name = clean(item?.title, 60), url = safeUrl(item?.url);
      if (!id || ["__proto__", "constructor", "prototype"].includes(id) || seen.has(id) || !name || !url) return [];
      seen.add(id);
      return [{ id, title: name, url, group: clean(item.group, 40), tags: [...new Set((Array.isArray(item.tags) ? item.tags : []).map(tag => clean(tag, 30)).filter(Boolean))].slice(0, 8), icon: clean(item.icon, 8), enabled: item.enabled !== false }];
    });
  }
  function desktopLayout(raw) {
    const order = choices(raw?.order, WIDGETS);
    return { order: [...order, ...WIDGETS.filter(id => !order.includes(id))], wide: ["tasks", "agenda", "focus"].includes(raw?.wide) ? raw.wide : "tasks" };
  }
  function layoutSnapshot(raw, id, name) {
    const fallback = defaults(), order = choices(raw.sections, SECTIONS);
    return { id, name: clean(name, 40), sections: [...order, ...SECTIONS.filter(key => !order.includes(key))], hidden: choices(raw.hidden, SECTIONS).filter(key => key !== "tasks"),
      shortcuts: Array.isArray(raw.shortcuts) ? choices(raw.shortcuts, SHORTCUTS).slice(0, 4) : fallback.shortcuts,
      bookmarkIds: bookmarks(raw.bookmarks).filter(item => item.enabled).map(item => item.id), desktopLayout: desktopLayout(raw.desktopLayout) };
  }
  function normalize(raw) {
    const fallback = defaults();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const ordered = choices(raw.sections, SECTIONS);
    const value = {
      version: 1,
      name: title(raw.name),
      displayName: title(raw.displayName),
      sections: [...ordered, ...SECTIONS.filter(id => !ordered.includes(id))],
      hidden: choices(raw.hidden, SECTIONS).filter(id => id !== "tasks"),
      shortcuts: Array.isArray(raw.shortcuts) ? choices(raw.shortcuts, SHORTCUTS).slice(0, 4) : fallback.shortcuts,
    };
    // Optional fields preserve the original settings shape for existing devices.
    if (Array.isArray(raw.bookmarks)) value.bookmarks = bookmarks(raw.bookmarks);
    if (typeof raw.phoneOverviewExpanded === 'boolean') value.phoneOverviewExpanded = raw.phoneOverviewExpanded;
    if (raw.desktopLayout && typeof raw.desktopLayout === "object") value.desktopLayout = desktopLayout(raw.desktopLayout);
    if (Array.isArray(raw.contexts)) {
      const seen = new Set(), ids = new Set((value.bookmarks || []).map(item => item.id));
      value.contexts = raw.contexts.slice(0, 4).flatMap(item => {
        if (!CONTEXTS.includes(item?.id) || seen.has(item.id)) return [];
        seen.add(item.id);
        const context = layoutSnapshot({ ...item, bookmarks: [] }, item.id, item.name || item.id);
        context.bookmarkIds = choices(item.bookmarkIds, [...ids]); return [context];
      });
      value.activeContext = value.contexts.some(item => item.id === raw.activeContext && item.id !== "default") ? raw.activeContext : "";
    }
    return value;
  }
  function storage() {
    if (typeof localStorage === "undefined") throw new Error("Device storage unavailable.");
    return localStorage;
  }
  function ready() {
    try {
      const store = storage(), dataset = typeof document !== "undefined" ? document.documentElement?.dataset : null;
      if (dataset?.workspaceLocked === "true" || dataset?.workspaceReady === "false" || store.getItem("daily-space-snapshot-recovery-v1") !== null) return false;
      const auth = JSON.parse(store.getItem("daily-space-auth-v1") || "null");
      const account = typeof auth?.email === "string" ? auth.email.trim().toLowerCase() : "";
      const saved = store.getItem("daily-space-workspace-owner-v1");
      if (saved === null) return !account;
      const marker = JSON.parse(saved);
      if (!marker || typeof marker.owner !== "string" || marker.owner.trim().toLowerCase() !== account) return false;
      return !dataset?.workspaceOwner || dataset.workspaceOwner === (account || "guest");
    } catch (_) { return false; }
  }
  function read() {
    if (!ready()) return defaults();
    try { return normalize(JSON.parse(storage().getItem(KEY) || "null")); }
    catch (_) { return defaults(); }
  }
  function save(input) {
    if (!ready()) throw Object.assign(new Error("Workspace is not ready. Try again after account loading finishes."), { code: "WORKSPACE_NOT_READY" });
    const value = normalize(input), serialized = JSON.stringify(value);
    let store, previous;
    try {
      store = storage(); previous = store.getItem(KEY);
      store.setItem(KEY, serialized);
      if (store.getItem(KEY) !== serialized) throw new Error("Storage did not retain settings.");
    } catch (cause) {
      if (store && previous !== undefined) {
        try { if (previous === null) store.removeItem(KEY); else store.setItem(KEY, previous); } catch (_) { /* The UI keeps the unsaved form for retry. */ }
      }
      throw Object.assign(new Error("Could not save workbench settings on this device. Free space and try again."), { code: "WORKBENCH_STORAGE", cause });
    }
    if (global?.dispatchEvent && typeof CustomEvent !== "undefined") {
      global.dispatchEvent(new CustomEvent("daily-space-workbench-updated", { detail: { preferences: value } }));
      global.dispatchEvent(new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["workbench"] } }));
    }
    return value;
  }
  function captureContext(input, id, name) {
    if (!CONTEXTS.includes(id)) throw new Error("Invalid workbench context.");
    const value = normalize(input), contexts = [...(value.contexts || [])];
    if (id !== "default" && !contexts.some(item => item.id === "default")) contexts.unshift(layoutSnapshot(value, "default", "Default"));
    const snapshot = layoutSnapshot(value, id, name || id), existing = contexts.findIndex(item => item.id === id);
    if (existing < 0) contexts.push(snapshot); else contexts[existing] = snapshot;
    return normalize({ ...value, contexts, activeContext: id === "default" ? "" : id });
  }
  function applyContext(id) {
    if (!ready()) throw new Error("Workspace is not ready.");
    const value = read(), context = value.contexts?.find(item => item.id === (id || "default"));
    if (!context && id) throw new Error("This workbench context is no longer available.");
    return save(context ? { ...value, sections: context.sections, hidden: context.hidden, shortcuts: context.shortcuts, desktopLayout: context.desktopLayout,
      bookmarks: (value.bookmarks || []).map(item => ({ ...item, enabled: context.bookmarkIds.includes(item.id) })), activeContext: id || "" } : { ...value, activeContext: "" });
  }
  function getBookmarks(input) { return (input ? normalize(input) : read()).bookmarks?.filter(item => item.enabled) || []; }
  function searchBookmarks(query) {
    if (!ready()) return [];
    const value = clean(query, 200).toLocaleLowerCase();
    return (read().bookmarks || []).filter(item => !value || [item.title, item.url, item.group, ...item.tags].join(" ").toLocaleLowerCase().includes(value));
  }
  const api = { KEY, defaults, normalize, ready, read, save, safeUrl, desktopLayout, captureContext, applyContext, getBookmarks, searchBookmarks };
  if (global) global.DailySpaceWorkbenchPreferences = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : null);
