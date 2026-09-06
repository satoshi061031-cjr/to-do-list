/**
 * Mobile Today chrome — week strip, collapsed agent, Done/Today toggle.
 */
(function () {
  if (!document.body.classList.contains("todo-mobile")) return;

  function isoLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function markWeek(iso) {
    const strip = document.getElementById("m-week-strip");
    if (!strip) return;
    strip.querySelectorAll(".m-day").forEach((el) => {
      const on = el.getAttribute("data-iso") === iso;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function selectDay(iso) {
    markWeek(iso);
    const api = window.DailySpaceTodo;
    if (api && typeof api.selectDueDay === "function") {
      api.selectDueDay(iso);
    }
  }

  function buildWeek() {
    const strip = document.getElementById("m-week-strip");
    if (!strip) return;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - 3);
    const todayKey = isoLocal(today);
    strip.innerHTML = "";
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoLocal(d);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "m-day" + (iso === todayKey ? " is-today is-selected" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-iso", iso);
      btn.setAttribute("aria-selected", iso === todayKey ? "true" : "false");
      const wd = d.toLocaleDateString(undefined, { weekday: "short" });
      btn.innerHTML =
        `<span class="m-day-wd">${wd}</span>` +
        `<span class="m-day-num">${d.getDate()}</span>`;
      btn.addEventListener("click", () => selectDay(iso));
      strip.appendChild(btn);
    }
  }

  function syncAgentToggle(open) {
    const btn = document.getElementById("m-agent-toggle");
    const host = document.getElementById("todo-agent-host");
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("is-open", open);
    }
    if (host) host.hidden = !open;
    document.body.classList.toggle("m-agent-sheet-open", open);
  }

  function wireAgent() {
    const btn = document.getElementById("m-agent-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const host = document.getElementById("todo-agent-host");
      const open = Boolean(host && host.hidden);
      if (window.DailySpaceAgentUi && typeof window.DailySpaceAgentUi.setOpen === "function") {
        window.DailySpaceAgentUi.setOpen(open);
      } else {
        syncAgentToggle(open);
      }
    });
    document.addEventListener("daily-space-agent-open", (event) => {
      const detail = event && event.detail;
      syncAgentToggle(Boolean(detail && detail.open));
    });
  }

  function wireDoneToggle() {
    const toggle = document.getElementById("m-done-toggle");
    const api = window.DailySpaceTodo;
    if (!toggle || !api || typeof api.setFilter !== "function") return;

    function showingCompleted() {
      const completed = document.querySelector('.filter-btn[data-filter="completed"]');
      return Boolean(completed && completed.classList.contains("is-active"));
    }

    function sync() {
      const on = showingCompleted();
      toggle.textContent = on ? "Today" : "Done";
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
    }

    toggle.addEventListener("click", () => {
      api.setFilter(showingCompleted() ? "active" : "completed");
      sync();
    });
    sync();
  }

  function placeGreeting() {
    const top = document.querySelector(".m-top-copy");
    const greeting = document.querySelector(".app-greeting");
    if (top && greeting && greeting.parentElement !== top) {
      top.insertBefore(greeting, top.firstChild);
    }
  }

  function watchGreeting() {
    placeGreeting();
    const host = document.querySelector(".m-shell") || document.querySelector(".app");
    if (!host) return;
    const obs = new MutationObserver(() => placeGreeting());
    obs.observe(host, { childList: true });
    window.setTimeout(() => obs.disconnect(), 2500);
  }

  function boot() {
    const title = document.getElementById("m-greet-title");
    if (title) title.textContent = "Today";
    watchGreeting();
    buildWeek();
    wireAgent();
    wireDoneToggle();
    document.addEventListener("dailyspace:view-day", (event) => {
      const iso = event && event.detail && event.detail.iso;
      if (iso) markWeek(iso);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
