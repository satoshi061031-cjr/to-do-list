/** Discover future tasks and provide optional phone-row gestures, separate from the dock. */
(function () {
  function boot() {
    const api = window.DailySpaceTodo;
    if (!api) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const range = document.createElement("div");
    range.className = "task-range";
    range.dataset.i18nIgnore = "";
    range.setAttribute("role", "group");
    const buttons = ["day", "week"].map((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.taskRange = value;
      button.addEventListener("click", () => api.setRange(value));
      range.append(button);
      return button;
    });
    (
      document.getElementById("m-week-strip") ||
      document.querySelector(".today-list-actions") ||
      document.getElementById("add-form")
    ).after(range);
    function refresh() {
      range.hidden = api.getView().source !== "personal";
      buttons[0].textContent = t("Selected day", "所选日期");
      buttons[1].textContent = t("Next 7 days", "近期 7 天");
      buttons.forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.taskRange === api.getView().range),
        ),
      );
    }
    window.addEventListener("daily-space-todo-view-updated", refresh);
    window.addEventListener("daily-space-locale-changed", refresh);
    refresh();
    if (!document.body.classList.contains("todo-mobile")) return;
    const list = document.getElementById("todo-list");
    let gesture = null,
      suppressUntil = 0;
    function closeActions() {
      list
        .querySelectorAll(".task-swipe-actions")
        .forEach((node) => node.remove());
    }
    function reset() {
      if (gesture) {
        gesture.row.querySelector(".todo-main").style.transform = "";
        gesture.row.removeAttribute("data-swipe");
      }
      gesture = null;
    }
    function begin(x, y, target, id) {
      if (
        document.body.classList.contains("task-selecting") ||
        api.getView().source !== "personal" ||
        target.closest("button,input,a,.task-swipe-actions")
      )
        return;
      const row = target.closest(".todo-item");
      if (!row || row.inert) return;
      closeActions();
      gesture = { row, x, y, id, dx: 0, locked: false };
    }
    function move(x, y) {
      if (!gesture) return false;
      const dx = x - gesture.x,
        dy = y - gesture.y;
      if (!gesture.locked && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return false;
      }
      if (
        !gesture.locked &&
        Math.abs(dx) > 14 &&
        Math.abs(dx) > Math.abs(dy) * 1.4
      )
        gesture.locked = true;
      if (!gesture.locked) return false;
      gesture.dx = dx;
      gesture.row.dataset.swipe = dx > 0 ? "complete" : "options";
      gesture.row.querySelector(".todo-main").style.transform =
        `translateX(${Math.max(-72, Math.min(72, dx * 0.5))}px)`;
      return true;
    }
    function finish(x, y, cancel = false) {
      if (!gesture) return;
      const current = gesture,
        bounds = list.getBoundingClientRect();
      const valid =
        !cancel &&
        current.locked &&
        Math.abs(current.dx) > 54 &&
        Math.abs(y - current.y) < 60 &&
        x >= bounds.left - 24 &&
        x <= bounds.right + 24;
      if (current.locked) suppressUntil = Date.now() + 500;
      reset();
      if (!valid) return;
      const id = current.row.dataset.id;
      if (current.dx > 0) {
        if (!api.getTasks().find((task) => task.id === id)?.completed)
          api.batchTasks([id], "complete");
        return;
      }
      const actions = document.createElement("div");
      actions.className = "task-swipe-actions";
      actions.dataset.i18nIgnore = "";
      for (const [label, run] of [
        [
          t("Tomorrow", "移到明天"),
          () => {
            const day = new Date();
            day.setDate(day.getDate() + 1);
            api.batchTasks(
              [id],
              "date",
              `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
            );
          },
        ],
        [t("Delete", "删除"), () => api.removeTask(id)],
        [t("Close", "收起"), () => {}],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => {
          closeActions();
          run();
        });
        actions.append(button);
      }
      current.row.append(actions);
    }
    list.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 1) {
          reset();
          return;
        }
        const p = event.touches[0];
        begin(p.clientX, p.clientY, event.target, p.identifier);
      },
      { passive: true },
    );
    list.addEventListener(
      "touchmove",
      (event) => {
        if (event.touches.length !== 1) {
          reset();
          return;
        }
        const p = event.touches[0];
        if (move(p.clientX, p.clientY) && event.cancelable)
          event.preventDefault();
      },
      { passive: false },
    );
    list.addEventListener("touchend", (event) => {
      const p = Array.from(event.changedTouches).find(
        (p) => p.identifier === gesture?.id,
      );
      if (p) finish(p.clientX, p.clientY);
    });
    list.addEventListener("touchcancel", () => reset());
    list.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" && event.button === 0)
        begin(event.clientX, event.clientY, event.target, event.pointerId);
    });
    list.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" && gesture?.id === event.pointerId)
        move(event.clientX, event.clientY);
    });
    window.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch" && gesture?.id === event.pointerId)
        finish(event.clientX, event.clientY);
    });
    list.addEventListener("pointercancel", (event) => {
      if (event.pointerType !== "touch" && gesture?.id === event.pointerId)
        reset();
    });
    list.addEventListener(
      "click",
      (event) => {
        if (
          Date.now() < suppressUntil &&
          !event.target.closest(".task-swipe-actions")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        reset();
        closeActions();
      }
    });
    window.addEventListener("blur", () => {
      reset();
      closeActions();
    });
    window.addEventListener("daily-space-auth-updated", () => {
      reset();
      closeActions();
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
