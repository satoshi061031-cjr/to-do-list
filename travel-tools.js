/** Trip editing, place capture, and a date-focused travel companion. */
(function () {
  const api = window.DailySpaceTravel;
  if (!api) return;
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const node = (tag, text = "", cls = "") => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const button = (label, run) => {
    const el = node("button", label);
    el.type = "button";
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
    return el;
  };
  const dateAt = (trip, day) =>
    window.DailySpaceWorkspaceCore.addDays(trip.startDate, day - 1);
  const totalDays = (trip) =>
    Math.round(
      (Date.parse(`${trip.endDate}T12:00Z`) -
        Date.parse(`${trip.startDate}T12:00Z`)) /
        86400000,
    ) + 1;
  const owner = () => window.DailySpaceView.owner();
  const toolbar = node("div", "", "travel-tools");
  toolbar.dataset.i18nIgnore = "";
  const edit = button("", () => open("trip")),
    add = button("", () => open("places"));
  toolbar.append(edit, add);
  document.getElementById("travel-side-chrome").after(toolbar);
  const message = node("p", "", "travel-task-status");
  message.dataset.i18nIgnore = "";
  message.setAttribute("role", "status");
  message.hidden = true;
  document.querySelector(".travel-view-switch").after(message);
  const dayButton = button("", () =>
    setDayView(!document.body.classList.contains("travel-day-view")),
  );
  dayButton.dataset.i18nIgnore = "";
  dayButton.id = "travel-day-mode";
  document.querySelector(".travel-view-switch").append(dayButton);
  const companion = node("section", "", "travel-companion");
  companion.id = "travel-companion";
  companion.dataset.i18nIgnore = "";
  companion.hidden = true;
  document.getElementById("travel-workspace").after(companion);
  let dayView = Boolean(window.DailySpaceView.read("travel").companion),
    editor = null,
    searchHome = null;
  const storage = document.querySelector(".travel-info");
  document.body.classList.toggle("travel-day-view", dayView);
  const root = node("div", "", "travel-sheet travel-tools-sheet");
  root.hidden = true;
  root.dataset.dialogRoot = "";
  root.dataset.i18nIgnore = "";
  const backdrop = button("", () => close());
  backdrop.className = "travel-sheet-backdrop";
  backdrop.setAttribute("aria-label", t("Close", "关闭"));
  const panel = node("section", "", "travel-sheet-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "travel-tools-title");
  const heading = node("div", "", "travel-sheet-head"),
    title = node("h2");
  title.id = "travel-tools-title";
  const dismiss = button("×", () => close());
  dismiss.dataset.dialogClose = "";
  dismiss.setAttribute("aria-label", t("Close", "关闭"));
  heading.append(title, dismiss);
  const body = node("div", "", "travel-tools-body"),
    status = node("p", "", "travel-form-note");
  status.setAttribute("role", "status");
  panel.append(heading, body, status);
  root.append(backdrop, panel);
  document.body.append(root);
  window.DailySpaceDialogHistory.fitViewport(root);
  const motion = window.DailySpaceDialogHistory.motion(root);
  const historyController = window.DailySpaceDialogHistory.create(
    "travel-tools",
    {
      isOpen: () => !root.hidden && !motion.closing,
      restore: (data) => open(data.mode, data.id, false),
      close: () => close(true),
    },
  );
  function restoreSearch() {
    if (searchHome) {
      const search = document.querySelector(".travel-search-bar");
      searchHome.parent.insertBefore(
        search,
        searchHome.next?.isConnected ? searchHome.next : null,
      );
      searchHome = null;
    }
  }
  function close(fromHistory = false, immediate = false) {
    if (root.hidden) return;
    motion.close(() => {
      restoreSearch();
      editor = null;
    }, immediate);
    if (!fromHistory) historyController.back();
  }
  function daySelect(trip, day) {
    const select = node("select");
    select.setAttribute("aria-label", t("Trip day", "行程日期"));
    for (let i = 1; i <= Math.min(366, totalDays(trip)); i++)
      select.add(
        new Option(
          `${dateAt(trip, i)} · ${t("Day", "第")}${i}${t("", "天")}`,
          String(i),
        ),
      );
    select.value = String(day);
    return select;
  }
  function field(form, label, type, value, name, max) {
    const wrap = node("label", label);
    const input = node(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    input.name = name;
    input.value = value || "";
    if (max) input.maxLength = max;
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function open(mode, id = null, push = true) {
    const { trip, day, invitation } = api.state();
    if (!trip || invitation) return;
    if (push && !historyController.push({ mode, id })) return;
    restoreSearch();
    editor = {
      mode,
      id,
      tripId: trip.id,
      owner: owner(),
      revision: trip.revision,
    };
    body.replaceChildren();
    status.textContent = "";
    if (mode === "places") {
      title.textContent = t("Add a place", "添加地点");
      const select = daySelect(trip, day);
      select.addEventListener("change", () => api.setDay(select.value));
      body.append(select);
      const search = document.querySelector(".travel-search-bar");
      searchHome = { parent: search.parentNode, next: search.nextSibling };
      body.append(search);
    } else {
      title.textContent =
        mode === "trip"
          ? t("Edit trip", "编辑行程")
          : t("Edit place", "编辑地点");
      const form = node("form", "", "travel-form");
      body.append(form);
      if (mode === "trip") {
        field(
          form,
          t("Trip name", "行程名称"),
          "text",
          trip.name,
          "name",
          60,
        ).required = true;
        field(
          form,
          t("Destination", "目的地"),
          "text",
          trip.destination,
          "destination",
          80,
        ).required = true;
        field(
          form,
          t("Start", "开始"),
          "date",
          trip.startDate,
          "startDate",
        ).required = true;
        field(
          form,
          t("End", "结束"),
          "date",
          trip.endDate,
          "endDate",
        ).required = true;
      } else {
        const stop = trip.stops.find((stop) => stop.id === id);
        if (!stop) {
          close();
          return;
        }
        field(
          form,
          t("Place name", "地点名称"),
          "text",
          stop.title,
          "title",
          80,
        ).required = true;
        field(
          form,
          t("Note / address", "备注 / 地址"),
          "textarea",
          stop.note,
          "note",
          160,
        );
        const label = node("label", t("Trip day", "行程日期")),
          select = daySelect(trip, stop.day);
        select.name = "day";
        label.append(select);
        form.append(label);
      }
      const save = node(
        "button",
        t("Save changes", "保存更改"),
        "btn btn-primary",
      );
      save.type = "submit";
      form.append(save);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (save.disabled || !form.reportValidity()) return;
        const context = editor;
        if (
          !context ||
          context.owner !== owner() ||
          context.tripId !== api.state().trip?.id
        )
          return;
        save.disabled = true;
        status.textContent = t("Saving…", "正在保存…");
        try {
          if (context.revision !== api.state().trip?.revision)
            throw new Error(
              t(
                "This trip changed. Reopen the editor before saving.",
                "行程已被更新，请重新打开编辑后保存。",
              ),
            );
          const values = Object.fromEntries(new FormData(form));
          if (mode === "trip") await api.updateTrip(values);
          else await api.updateStop(id, values);
          if (editor === context) {
            close();
          }
        } catch (error) {
          if (editor === context) status.textContent = error.message;
        } finally {
          save.disabled = false;
        }
      });
    }
    motion.open();
    requestAnimationFrame(() =>
      body.querySelector("input,select")?.focus({ preventScroll: true }),
    );
  }
  function setDayView(on) {
    dayView = on;
    api.setCompanion(on);
    document.body.classList.toggle("travel-day-view", on);
    window.DailySpaceView.write("travel", { companion: on });
    if (on) {
      const { trip } = api.state();
      const today = window.DailySpaceLoop.todayIso();
      if (trip && today >= trip.startDate && today <= trip.endDate)
        api.setDay(
          Math.round(
            (Date.parse(`${today}T12:00Z`) -
              Date.parse(`${trip.startDate}T12:00Z`)) /
              86400000,
          ) + 1,
        );
    }
    refresh();
  }
  document.querySelectorAll("[data-travel-view]").forEach((control) =>
    control.addEventListener("click", () => {
      dayView = false;
      api.setCompanion(false);
      window.DailySpaceView.write("travel", { companion: false });
      document.body.classList.remove("travel-day-view");
      refresh();
    }),
  );
  function refresh() {
    if (!dayView) {
      document.querySelector(".travel-view-switch").before(storage);
      document.querySelector(".travel-view-switch").after(message);
    }
    const { trip, day, shared, invitation } = api.state();
    const available =
      trip &&
      !invitation &&
      document.body.classList.contains("travel-has-trip");
    toolbar.hidden = !available;
    dayButton.hidden = !available;
    companion.hidden = !available || !dayView;
    if (editor && (editor.owner !== owner() || editor.tripId !== trip?.id))
      close(true, true);
    edit.textContent = t("Edit trip", "编辑行程");
    add.textContent = t("＋ Add a place", "＋ 添加地点");
    dayButton.textContent = t("Travel day", "旅行当天");
    dayButton.setAttribute("aria-pressed", String(dayView));
    if (dayView)
      document
        .querySelectorAll("[data-travel-view]")
        .forEach((control) => control.setAttribute("aria-pressed", "false"));
    if (!available) return;
    // Add explicit actions beside route selection; all user strings remain text.
    for (const [selector, desktop] of [
      ["#travel-stop-list .travel-stop", false],
      [".travel-desktop-stop", true],
    ])
      document.querySelectorAll(selector).forEach((row) => {
        if (row.querySelector(".travel-stop-controls")) return;
        let stop;
        if (desktop) {
          const section = row.closest(".travel-desktop-day"),
            index = [
              ...section.querySelectorAll(".travel-desktop-stop"),
            ].indexOf(row),
            dateIndex = [...section.parentNode.children].indexOf(section) + 1;
          stop = trip.stops.filter((stop) => stop.day === dateIndex)[index];
        } else
          stop = trip.stops.filter((stop) => stop.day === day)[
            [...row.parentNode.children].indexOf(row)
          ];
        if (!stop) return;
        const controls = node("div", "", "travel-stop-controls");
        controls.dataset.i18nIgnore = "";
        controls.append(button(t("Edit", "编辑"), () => open("stop", stop.id)));
        const ordered = trip.stops.filter((item) => item.day === stop.day),
          index = ordered.findIndex((item) => item.id === stop.id);
        for (const [delta, label] of [
          [-1, t("Move up", "上移")],
          [1, t("Move down", "下移")],
        ]) {
          const control = button(label, async () => {
            control.disabled = true;
            try {
              await api.moveStop(stop.id, delta);
            } catch (error) {
              message.hidden = false;
              message.textContent = error.message;
            } finally {
              control.disabled = false;
            }
          });
          control.disabled =
            index + delta < 0 || index + delta >= ordered.length;
          controls.append(control);
        }
        row.append(controls);
      });
    if (!dayView) return;
    companion.replaceChildren();
    const head = node("header"),
      name = node("h2", trip.name),
      select = daySelect(trip, day);
    select.id = "travel-day-select";
    select.addEventListener("change", () => api.setDay(select.value));
    head.append(name, select);
    companion.append(head);
    const ref = shared ? `shared:${trip.id}` : trip.id,
      key = `travel-progress:${ref}`,
      saved = window.DailySpaceView.read(key),
      visited = new Set(saved.visited || []);
    const stops = trip.stops.filter((stop) => stop.day === day),
      next = stops.find((stop) => !visited.has(stop.id));
    companion.append(
      node(
        "h3",
        next ? t("Next stop", "下一站") : t("This day’s route", "当天路线"),
      ),
    );
    if (next) {
      const link = node(
        "a",
        `${t("Navigate", "导航")} · ${next.title}`,
        "travel-next-stop",
      );
      link.href = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${next.lat},${next.lng}`, travelmode: "transit" })}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      companion.append(link);
    }
    const list = node("ol", "", "travel-day-stops");
    for (const stop of stops) {
      const item = node("li"),
        copy = node("div");
      copy.append(node("strong", stop.title), node("p", stop.note));
      const done = button(
        visited.has(stop.id)
          ? t("Visited · Undo", "已到达 · 撤销")
          : t("Mark visited", "标记到达"),
        () => {
          visited.has(stop.id) ? visited.delete(stop.id) : visited.add(stop.id);
          window.DailySpaceView.write(key, { visited: [...visited] });
          refresh();
        },
      );
      done.setAttribute("aria-pressed", String(visited.has(stop.id)));
      item.append(copy, done);
      list.append(item);
    }
    companion.append(list);
    if (!stops.length)
      companion.append(
        node(
          "p",
          t(
            "No places yet. Add your first stop.",
            "还没有地点，添加当天的第一站吧。",
          ),
        ),
      );
    const bookings = trip.reservations.filter((item) => item.day === day);
    companion.append(node("h3", t("Bookings", "预订")));
    if (!bookings.length)
      companion.append(
        node("p", t("No bookings on this day.", "当天没有预订。")),
      );
    for (const booking of bookings) {
      const item = node("article", "", "travel-day-booking");
      item.append(
        node("strong", booking.title),
        node(
          "p",
          [
            booking.startTime,
            booking.location,
            booking.origin &&
              `${booking.origin} → ${booking.destination || ""}`,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      if (booking.confirmationCode)
        item.append(
          node(
            "p",
            `${t("Confirmation", "确认号")} · ${booking.confirmationCode}`,
          ),
        );
      companion.append(item);
    }
    const state = window.DailySpaceTallyCore.readState(),
      stats = window.DailySpaceTripExpenses.stats(state, ref),
      amount = new Map(stats.days).get(dateAt(trip, day)) || 0;
    companion.append(
      node("h3", t("This day’s expenses", "当天花费")),
      node(
        "p",
        window.DailySpaceTallyCore.formatAmount(
          state,
          amount,
          state.baseCurrency,
        ),
      ),
    );
    const budget = window.DailySpaceTripExpenses.budget(state, ref);
    if (budget?.currency === state.baseCurrency)
      companion.append(
        node(
          "p",
          `${stats.total > budget.amount ? t("Over budget", "已超预算") : t("Remaining budget", "剩余预算")} · ${window.DailySpaceTallyCore.formatAmount(state, Math.abs(budget.amount - stats.total), state.baseCurrency)}`,
        ),
      );
    const expense = node("a", t("Add trip expense", "记一笔旅行费用"));
    expense.href = `tally.html?${new URLSearchParams({ trip: ref, tripName: trip.name, date: dateAt(trip, day) })}`;
    companion.append(
      expense,
      node(
        "p",
        t(
          "Your ledger only. Other trip members cannot see these amounts.",
          "仅来自你的个人账本，其他行程成员无法查看。",
        ),
        "trip-expense-note",
      ),
    );
    const actions = node("div", "", "travel-tools");
    actions.append(
      button(t("Edit trip", "编辑行程"), () => open("trip")),
      button(t("＋ Add a place", "＋ 添加地点"), () => open("places")),
    );
    companion.append(actions, storage, message);
  }
  window.addEventListener("daily-space-travel-view-updated", refresh);
  window.addEventListener("daily-space-travel-stop-added", () => {
    if (editor?.mode === "places") close();
  });
  window.addEventListener("daily-space-travel-saved", () => {
    const { trip } = api.state();
    if (!trip) return;
    message.hidden = false;
    message.replaceChildren();
    const task = JSON.parse(
      localStorage.getItem("todo-app-v2") || "{}",
    ).todos?.find((item) => item.sourceTripId === trip.id);
    message.append(
      node(
        "span",
        task
          ? `${t("Task scheduled for", "任务已安排到")} ${task.dueDate} · `
          : t("Trip saved", "行程已保存"),
      ),
    );
    if (task) {
      const link = node("a", t("View task", "查看任务"));
      link.href = `${matchMedia("(max-width:819px)").matches ? "todo-m.html" : "todo.html"}?${new URLSearchParams({ focus: "todo", id: task.id })}`;
      message.append(link);
    }
    refresh();
  });
  window.addEventListener("daily-space-agent-data-updated", (event) => {
    if (event.detail?.domains?.includes("tally")) refresh();
  });
  window.addEventListener("daily-space-locale-changed", () => {
    if (editor) close();
    refresh();
  });
  window.addEventListener("daily-space-auth-updated", () => {
    close(true, true);
    message.hidden = true;
    setDayView(false);
  });
  refresh();
})();
