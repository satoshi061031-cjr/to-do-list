/** Persistent personal-workbench choices, shared by cloud sync and file transfer. */
(function (global) {
  const KEY = "daily-space-workbench-v1";
  const SECTIONS = ["agenda", "tasks", "shortcuts", "spend", "travel"];
  const SHORTCUTS = ["planner", "mail", "tally", "travel", "calendar"];

  function defaults() {
    return { version: 1, name: "", displayName: "", sections: [...SECTIONS], hidden: [], shortcuts: ["planner", "mail", "travel"] };
  }
  function title(value) {
    return typeof value === "string" ? Array.from(value.replace(/\s+/gu, " ").trim()).slice(0, 40).join("") : "";
  }
  function choices(value, allowed) {
    return [...new Set((Array.isArray(value) ? value.slice(0, 100) : []).filter(item => allowed.includes(item)))];
  }
  function normalize(raw) {
    const fallback = defaults();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const ordered = choices(raw.sections, SECTIONS);
    return {
      version: 1,
      name: title(raw.name),
      displayName: title(raw.displayName),
      sections: [...ordered, ...SECTIONS.filter(id => !ordered.includes(id))],
      hidden: choices(raw.hidden, SECTIONS).filter(id => id !== "tasks"),
      shortcuts: Array.isArray(raw.shortcuts) ? choices(raw.shortcuts, SHORTCUTS).slice(0, 4) : fallback.shortcuts,
    };
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
  const api = { KEY, defaults, normalize, ready, read, save };
  if (global) global.DailySpaceWorkbenchPreferences = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : null);
