/**
 * Shared undo bar for instant deletes (Todo, Tally, Calendar).
 * One bar at a time; a new offer replaces the pending one.
 */
(function () {
  const VISIBLE_MS = 6000;

  let bar = null;
  let textEl = null;
  let actionEl = null;
  let timer = null;
  /** @type {null | (() => void)} */
  let pendingUndo = null;

  function ensureBar() {
    if (bar && bar.isConnected) return bar;
    bar = document.createElement("div");
    bar.id = "undo-bar";
    bar.className = "undo-bar";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.hidden = true;

    textEl = document.createElement("span");
    textEl.className = "undo-bar-text";

    actionEl = document.createElement("button");
    actionEl.type = "button";
    actionEl.className = "btn btn-primary undo-bar-action";
    actionEl.textContent = "Undo";
    actionEl.addEventListener("click", runUndo);

    bar.append(textEl, actionEl);
    document.body.appendChild(bar);
    return bar;
  }

  function clearTimer() {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  }

  /**
   * Sit above the dock when it is in phone mode. Measuring beats a breakpoint:
   * the dock flips to a side rail at a width the bar would otherwise guess at.
   */
  function clearBottomChrome() {
    let chromeTop = window.innerHeight;
    for (const element of document.querySelectorAll(".bento-rail, .m-add-bar, .calendar-capture-bar, #tally-add-open, .mail-batch-bar, .task-batch-bar")) {
      if (getComputedStyle(element).visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.height > 0 && rect.height < window.innerHeight * 0.4 && window.innerHeight - rect.bottom < 180) {
        chromeTop = Math.min(chromeTop, rect.top);
      }
    }
    bar.style.bottom = chromeTop < window.innerHeight ? `${window.innerHeight - chromeTop + 21}px` : "";
  }

  function hide() {
    clearTimer();
    pendingUndo = null;
    if (!bar) return;
    bar.hidden = true;
  }

  function runUndo() {
    const undo = pendingUndo;
    hide();
    if (typeof undo === "function") undo();
  }

  /**
   * @param {string} message English message; translated through DailySpaceI18n.
   * @param {() => void} onUndo Restores whatever was just removed.
   */
  function offer(message, onUndo) {
    if (typeof onUndo !== "function") return;
    ensureBar();
    clearTimer();
    const owner = window.DailySpaceView?.owner();
    pendingUndo = () => { if (window.DailySpaceView?.owner() === owner) onUndo(); };
    textEl.textContent = message;
    bar.hidden = false;
    clearBottomChrome();
    if (window.DailySpaceI18n && typeof window.DailySpaceI18n.apply === "function") {
      window.DailySpaceI18n.apply(bar);
    }
    timer = window.setTimeout(hide, VISIBLE_MS);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !pendingUndo) return;
    hide();
  });

  window.addEventListener("resize", () => {
    if (bar && !bar.hidden) clearBottomChrome();
  });

  window.addEventListener("daily-space-auth-updated", hide);

  window.DailySpaceUndo = { offer, hide };
})();
