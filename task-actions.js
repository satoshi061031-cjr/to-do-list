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
    const phone = document.body.classList.contains("todo-mobile");
    let picker, pickerLabel, dayInput, dayLabel;
    const buttons = ["day", "week"].map((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.taskRange = value;
      button.addEventListener("click", () => {
        api.setRange(value);
        if (picker) {
          picker.open = false;
          pickerLabel.focus({ preventScroll: true });
        }
      });
      range.append(button);
      return button;
    });
    if (phone) {
      picker = document.createElement("details");
      picker.id = "m-task-view-picker";
      picker.className = "task-view-picker";
      picker.dataset.i18nIgnore = "";
      pickerLabel = document.createElement("summary");
      pickerLabel.id = "m-task-view-toggle";
      const content = document.createElement("div");
      content.className = "task-view-options";
      dayLabel = document.createElement("label");
      const labelText = document.createElement("span");
      dayInput = document.createElement("input");
      dayInput.type = "date";
      dayInput.id = "m-task-view-date";
      dayInput.addEventListener("change", () => {
        if (!dayInput.value || !dayInput.checkValidity()) return;
        api.selectDueDay(dayInput.value);
        picker.open = false;
        pickerLabel.focus({ preventScroll: true });
      });
      dayLabel.append(labelText, dayInput);
      content.append(range, dayLabel);
      picker.append(pickerLabel, content);
      const legacyDate = document.getElementById("m-page-date");
      legacyDate.hidden = true;
      legacyDate.after(picker);
      document.addEventListener("pointerdown", (event) => {
        if (!picker.contains(event.target)) picker.open = false;
      });
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape" && picker.open) {
            event.preventDefault();
            event.stopImmediatePropagation();
            picker.open = false;
            pickerLabel.focus({ preventScroll: true });
          }
        },
        true,
      );
      function compactControls() {
        const tabs = document.querySelector(".m-task-tabs");
        const selection = document.querySelector(".task-selection-head");
        if (!tabs || !selection) return false;
        const controls = document.createElement("div");
        controls.className = "m-task-controls";
        tabs.before(controls);
        controls.append(tabs, selection);
        return true;
      }
      if (!compactControls()) {
        const observer = new MutationObserver(() => {
          if (compactControls()) observer.disconnect();
        });
        observer.observe(document.querySelector(".m-shell"), {
          childList: true,
          subtree: true,
        });
      }
    } else {
      (
        document.querySelector(".today-list-actions") ||
        document.getElementById("add-form")
      ).after(range);
    }
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
      if (picker) {
        const view = api.getView();
        picker.hidden = range.hidden;
        if (picker.hidden) picker.open = false;
        pickerLabel.textContent =
          view.range === "week"
            ? t("Next 7 days", "近期 7 天")
            : new Date(`${view.day}T12:00:00`).toLocaleDateString(
                window.DailySpaceI18n?.localeTag?.() || "en-US",
                { weekday: "long", month: "long", day: "numeric" },
              );
        pickerLabel.setAttribute(
          "aria-label",
          `${t("Task date and range", "任务日期与范围")}: ${pickerLabel.textContent}`,
        );
        dayLabel.firstChild.textContent = t("Choose a date", "选择日期");
        dayInput.setAttribute("aria-label", t("Task date", "任务日期"));
        if (document.activeElement !== dayInput) dayInput.value = view.day;
      }
    }
    window.addEventListener("daily-space-todo-view-updated", refresh);
    window.addEventListener("daily-space-locale-changed", refresh);
    refresh();
    if (!phone) return;
    const list = document.getElementById("todo-list");
    let gesture = null,
      suppressUntil = 0,
      opened = null;
    const prepared = new Map();
    const reduced = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function clean(state) {
      clearTimeout(state.timer);
      state.fronts.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      state.actions.remove();
      state.row.classList.remove("task-swipe-ready", "is-swiping");
      state.row.removeAttribute("data-swipe");
      state.row.style.removeProperty("--task-swipe-offset");
      state.row.style.removeProperty("--task-swipe-reveal");
      prepared.delete(state.row);
      if (opened === state) opened = null;
    }
    function settle(state, immediate = false) {
      if (!state) return;
      const focused = state.actions.contains(document.activeElement);
      state.fronts.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      if (focused && state.row.isConnected)
        state.row.querySelector(".todo-main")?.focus({ preventScroll: true });
      state.actions.inert = true;
      state.actions.setAttribute("aria-hidden", "true");
      state.row.classList.remove("is-swiping");
      state.row.removeAttribute("data-swipe");
      state.row.style.setProperty("--task-swipe-offset", "0px");
      state.row.style.setProperty("--task-swipe-reveal", "0px");
      if (opened === state) opened = null;
      clearTimeout(state.timer);
      if (immediate || reduced() || !state.row.isConnected) clean(state);
      else state.timer = setTimeout(() => clean(state), 180);
    }
    function closeActions(immediate = false) {
      for (const state of prepared.values()) settle(state, immediate);
    }
    function reset(immediate = false) {
      if (gesture?.state) settle(gesture.state, immediate);
      gesture = null;
    }
    function prepare(row) {
      if (prepared.has(row)) clean(prepared.get(row));
      const id = row.dataset.id;
      const state = {
        row,
        fronts: [...row.children].map((node) => ({ node, inert: node.inert })),
        actions: document.createElement("div"),
      };
      const actions = state.actions;
      actions.className = "task-swipe-actions";
      actions.dataset.i18nIgnore = "";
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", t("Task actions", "任务操作"));
      actions.setAttribute("aria-hidden", "true");
      actions.inert = true;
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
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          settle(state, false);
          run();
        });
        actions.append(button);
      }
      row.classList.add("task-swipe-ready");
      row.append(actions);
      state.width = Math.min(
        actions.getBoundingClientRect().width,
        row.clientWidth - 44,
      );
      prepared.set(row, state);
      return state;
    }
    function begin(x, y, target, id) {
      if (
        document.body.classList.contains("task-selecting") ||
        api.getView().source !== "personal" ||
        target.closest(
          "button,input,a,.todo-check-target,.task-batch-check,.task-swipe-actions",
        )
      )
        return;
      const row = target.closest(".todo-item");
      if (!row || row.inert) return;
      reset(true);
      closeActions(true);
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
      if (!gesture.state) gesture.state = prepare(gesture.row);
      gesture.dx = dx;
      gesture.row.dataset.swipe = dx > 0 ? "complete" : "options";
      gesture.row.classList.add("is-swiping");
      const offset = Math.max(-gesture.state.width, Math.min(72, dx * 0.65));
      gesture.row.style.setProperty("--task-swipe-offset", `${offset}px`);
      gesture.row.style.setProperty(
        "--task-swipe-reveal",
        `${Math.max(0, -offset)}px`,
      );
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
      if (!valid) {
        reset();
        return;
      }
      gesture = null;
      const id = current.row.dataset.id;
      if (current.dx > 0) {
        settle(current.state);
        const task = api.getTasks().find((task) => task.id === id);
        if (task && !task.completed) api.batchTasks([id], "complete");
        return;
      }
      const state = current.state;
      opened = state;
      state.row.classList.remove("is-swiping");
      state.row.dataset.swipe = "open";
      state.row.style.setProperty("--task-swipe-offset", `${-state.width}px`);
      state.row.style.setProperty("--task-swipe-reveal", `${state.width}px`);
      state.fronts.forEach(({ node }) => {
        node.inert = true;
      });
      state.actions.inert = false;
      state.actions.setAttribute("aria-hidden", "false");
    }
    list.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 1) {
          reset(true);
          closeActions(true);
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
          reset(true);
          closeActions(true);
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
    list.addEventListener("touchcancel", () => {
      reset(true);
      closeActions(true);
    });
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
      if (event.pointerType !== "touch" && gesture?.id === event.pointerId) {
        reset(true);
        closeActions(true);
      }
    });
    list.addEventListener(
      "click",
      (event) => {
        if (
          Date.now() < suppressUntil &&
          !event.target.closest(
            ".task-swipe-actions, .todo-check-target, .todo-check",
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && (opened || gesture)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          reset();
          closeActions();
        }
      },
      true,
    );
    document.addEventListener("pointerdown", (event) => {
      if (opened && !opened.actions.contains(event.target)) closeActions();
    });
    const cancel = () => {
      reset(true);
      closeActions(true);
    };
    window.addEventListener("pagehide", cancel);
    window.addEventListener("resize", cancel);
    let viewKey = JSON.stringify(api.getView());
    window.addEventListener("daily-space-todo-view-updated", () => {
      const nextKey = JSON.stringify(api.getView());
      if (nextKey !== viewKey || (gesture && !gesture.row.isConnected))
        cancel();
      else
        for (const state of prepared.values())
          if (!state.row.isConnected) clean(state);
      viewKey = nextKey;
    });
    window.addEventListener(
      "scroll",
      () => {
        if (opened) closeActions(true);
      },
      true,
    );
    new MutationObserver(() => {
      if (document.body.classList.contains("task-selecting")) cancel();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("daily-space-locale-changed", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("daily-space-auth-updated", () => {
      cancel();
      picker.open = false;
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
