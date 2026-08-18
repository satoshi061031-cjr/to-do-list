/**
 * Mobile Loop chrome for todo-m.html — greeting, week strip, dock, composer FAB.
 */
(function () {
  if (!document.body.classList.contains("todo-mobile")) return;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function isoLocal(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function authName() {
    try {
      const parsed = JSON.parse(localStorage.getItem("daily-space-auth-v1") || "null");
      if (!parsed || typeof parsed !== "object") return "there";
      let name = typeof parsed.label === "string" ? parsed.label.trim() : "";
      name = name.replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim();
      if (!name && typeof parsed.email === "string") {
        name = String(parsed.email).split("@")[0].trim();
      }
      if (!name) return "there";
      const first = name.split(/\s+/)[0];
      return first || "there";
    } catch (_) {
      return "there";
    }
  }

  function syncGreeting() {
    const title = document.getElementById("m-greet-title");
    if (!title) return;
    title.textContent = `Hey, ${authName()}`;
  }

  function selectDay(iso) {
    const api = window.DailySpaceTodo;
    if (api && typeof api.selectDueDay === "function") {
      api.selectDueDay(iso);
      return;
    }
    document.querySelectorAll(".m-day").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-iso") === iso);
    });
  }

  function buildWeek() {
    const strip = document.getElementById("m-week-strip");
    if (!strip) return;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - 3);
    const todayIso = isoLocal(today);
    strip.innerHTML = "";
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoLocal(d);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "m-day" + (iso === todayIso ? " is-today is-selected" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("data-iso", iso);
      btn.setAttribute("aria-selected", iso === todayIso ? "true" : "false");
      const wd = d.toLocaleDateString(undefined, { weekday: "short" });
      btn.innerHTML =
        `<span class="m-day-wd">${wd}</span>` +
        `<span class="m-day-num">${d.getDate()}</span>`;
      btn.addEventListener("click", () => {
        strip.querySelectorAll(".m-day").forEach((el) => {
          const on = el === btn;
          el.classList.toggle("is-selected", on);
          el.setAttribute("aria-selected", on ? "true" : "false");
        });
        selectDay(iso);
      });
      strip.appendChild(btn);
    }
  }

  function openComposer() {
    const sheet = document.getElementById("m-composer");
    const input = document.getElementById("todo-input");
    if (!sheet) return;
    sheet.hidden = false;
    if (input) {
      input.focus();
      input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function closeComposer() {
    /* Add form stays in the page flow on desktop and mobile. */
  }

  function wireDock() {
    const fab = document.getElementById("m-fab-add");
    if (fab) fab.addEventListener("click", openComposer);
    const done = document.getElementById("m-composer-close");
    if (done) done.addEventListener("click", closeComposer);
  }

  function boot() {
    syncGreeting();
    buildWeek();
    wireDock();
    window.addEventListener("daily-space-auth-updated", syncGreeting);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
