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
    searchHome = null,
    companionView = null,
    messageContext = null;
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
    syncDaySelect(select, trip, day);
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
  function text(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function tripRef(trip, shared) {
    return shared ? `shared:${trip.id}` : trip.id;
  }
  function clearMessage() {
    message.hidden = true;
    message.replaceChildren();
    messageContext = null;
  }
  function placeOutsideCompanion() {
    const controls = document.querySelector(".travel-view-switch");
    // Moving a connected input or disclosure can drop its focus. Leave it in
    // place when the current view already has the requested ordering.
    if (
      storage.parentNode !== controls.parentNode ||
      storage.nextSibling !== controls
    )
      controls.before(storage);
    if (
      message.parentNode !== controls.parentNode ||
      message.previousSibling !== controls
    )
      controls.after(message);
  }
  function clearCompanion() {
    placeOutsideCompanion();
    companion.replaceChildren();
    companionView = null;
  }
  function syncChildren(parent, children) {
    const expected = new Set(children),
      focused = document.activeElement;
    for (const child of [...parent.children])
      if (!expected.has(child)) child.remove();
    children.forEach((child, index) => {
      if (parent.children[index] !== child)
        parent.insertBefore(child, parent.children[index] || null);
    });
    if (
      focused?.isConnected &&
      parent.contains(focused) &&
      document.activeElement !== focused
    )
      focused.focus({ preventScroll: true });
  }
  function syncDaySelect(select, trip, day) {
    const count = Math.min(366, totalDays(trip));
    for (let index = 0; index < count; index++) {
      const value = String(index + 1),
        label = `${dateAt(trip, index + 1)} · ${t("Day", "第")}${index + 1}${t("", "天")}`;
      let option = select.options[index];
      if (!option) {
        option = new Option(label, value);
        select.add(option);
      } else {
        if (option.value !== value) option.value = value;
        text(option, label);
      }
    }
    while (select.options.length > count)
      select.remove(select.options.length - 1);
    select.setAttribute("aria-label", t("Trip day", "行程日期"));
    if (select.value !== String(day)) select.value = String(day);
  }
  function buildCompanion(trip, shared) {
    const view = {
      owner: owner(),
      ref: tripRef(trip, shared),
      stops: new Map(),
      bookings: new Map(),
      head: node("header"),
      name: node("h2"),
      select: node("select"),
      nextTitle: node("h3"),
      next: node("a", "", "travel-next-stop"),
      list: node("ol", "", "travel-day-stops"),
      emptyStops: node("p"),
      bookingTitle: node("h3"),
      emptyBookings: node("p"),
      bookingList: node("div"),
      expenseTitle: node("h3"),
      amount: node("p", "", "travel-day-amount"),
      budget: node("p", "", "travel-day-budget"),
      expense: node("a"),
      privacy: node("p", "", "trip-expense-note"),
      actions: node("div", "", "travel-tools"),
    };
    view.select.id = "travel-day-select";
    view.select.addEventListener("change", () => {
      if (companionView === view && view.owner === owner())
        api.setDay(view.select.value);
    });
    view.next.target = "_blank";
    view.next.rel = "noopener noreferrer";
    view.head.append(view.name, view.select);
    view.edit = button("", () => open("trip"));
    view.add = button("", () => open("places"));
    view.actions.append(view.edit, view.add);
    companion.replaceChildren(
      view.head,
      view.nextTitle,
      view.list,
      view.emptyStops,
      view.bookingTitle,
      view.emptyBookings,
      view.bookingList,
      view.expenseTitle,
      view.amount,
      view.budget,
      view.expense,
      view.privacy,
      view.actions,
      storage,
      message,
    );
    companionView = view;
    return view;
  }
  function updateCompanionExpenses(view, trip, day, shared) {
    if (
      !view ||
      view !== companionView ||
      view.owner !== owner() ||
      view.ref !== tripRef(trip, shared)
    )
      return;
    const state = window.DailySpaceTallyCore.readState(),
      stats = window.DailySpaceTripExpenses.stats(state, view.ref),
      amount = new Map(stats.days).get(dateAt(trip, day)) || 0,
      money = (value) =>
        window.DailySpaceTallyCore.formatAmount(
          state,
          value,
          state.baseCurrency,
        ),
      budget = window.DailySpaceTripExpenses.budget(state, view.ref);
    text(view.expenseTitle, t("This day’s expenses", "当天花费"));
    text(view.amount, money(amount));
    view.budget.hidden = budget?.currency !== state.baseCurrency;
    text(
      view.budget,
      !view.budget.hidden
        ? `${stats.total > budget.amount ? t("Over budget", "已超预算") : t("Remaining budget", "剩余预算")} · ${money(Math.abs(budget.amount - stats.total))}`
        : "",
    );
    text(view.expense, t("Add trip expense", "记一笔旅行费用"));
    view.expense.href = `tally.html?${new URLSearchParams({ trip: view.ref, tripName: trip.name, date: dateAt(trip, day) })}`;
    text(
      view.privacy,
      t(
        "Your ledger only. Other trip members cannot see these amounts.",
        "仅来自你的个人账本，其他行程成员无法查看。",
      ),
    );
  }
  function renderCompanion(trip, day, shared) {
    let view = companionView;
    if (!view || view.owner !== owner() || view.ref !== tripRef(trip, shared))
      view = buildCompanion(trip, shared);
    if (storage.parentNode !== companion) companion.append(storage);
    if (message.parentNode !== companion) companion.append(message);
    text(view.name, trip.name);
    syncDaySelect(view.select, trip, day);
    const key = `travel-progress:${view.ref}`,
      visited = new Set(window.DailySpaceView.read(key).visited || []),
      stops = trip.stops.filter((stop) => stop.day === day),
      next = stops.find((stop) => !visited.has(stop.id));
    text(
      view.nextTitle,
      next ? t("Next stop", "下一站") : t("This day’s route", "当天路线"),
    );
    if (next) {
      text(view.next, `${t("Navigate", "导航")} · ${next.title}`);
      view.next.href = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${next.lat},${next.lng}`, travelmode: "transit" })}`;
      if (view.next.nextSibling !== view.list)
        companion.insertBefore(view.next, view.list);
    } else view.next.remove();
    const stopIds = new Set(stops.map((stop) => stop.id));
    for (const [id] of view.stops) if (!stopIds.has(id)) view.stops.delete(id);
    const rows = stops.map((stop) => {
      let row = view.stops.get(stop.id);
      if (!row) {
        row = {
          item: node("li"),
          copy: node("div"),
          title: node("strong"),
          note: node("p"),
        };
        row.done = button("", () => {
          const current = api.state();
          if (
            view !== companionView ||
            view.owner !== owner() ||
            !current.trip ||
            view.ref !== tripRef(current.trip, current.shared) ||
            !current.trip.stops.some(
              (item) => item.id === stop.id && item.day === current.day,
            )
          )
            return;
          const saved = new Set(window.DailySpaceView.read(key).visited || []);
          saved.has(stop.id) ? saved.delete(stop.id) : saved.add(stop.id);
          window.DailySpaceView.write(key, { visited: [...saved] });
          renderCompanion(current.trip, current.day, current.shared);
        });
        row.copy.append(row.title, row.note);
        row.item.append(row.copy, row.done);
        view.stops.set(stop.id, row);
      }
      text(row.title, stop.title);
      text(row.note, stop.note || "");
      text(
        row.done,
        visited.has(stop.id)
          ? t("Visited · Undo", "已到达 · 撤销")
          : t("Mark visited", "标记到达"),
      );
      row.done.setAttribute("aria-pressed", String(visited.has(stop.id)));
      return row.item;
    });
    syncChildren(view.list, rows);
    view.emptyStops.hidden = stops.length > 0;
    text(
      view.emptyStops,
      t(
        "No places yet. Add your first stop.",
        "还没有地点，添加当天的第一站吧。",
      ),
    );
    text(view.bookingTitle, t("Bookings", "预订"));
    const bookings = trip.reservations.filter((item) => item.day === day),
      bookingIds = new Set();
    view.emptyBookings.hidden = bookings.length > 0;
    text(view.emptyBookings, t("No bookings on this day.", "当天没有预订。"));
    const bookingRows = bookings.map((booking, index) => {
      const id = booking.id || `booking-${index}`;
      bookingIds.add(id);
      let row = view.bookings.get(id);
      if (!row) {
        row = {
          item: node("article", "", "travel-day-booking"),
          title: node("strong"),
          details: node("p"),
          confirmation: node("p"),
        };
        row.item.append(row.title, row.details, row.confirmation);
        view.bookings.set(id, row);
      }
      text(row.title, booking.title);
      text(
        row.details,
        [
          booking.startTime,
          booking.location,
          booking.origin && `${booking.origin} → ${booking.destination || ""}`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      row.confirmation.hidden = !booking.confirmationCode;
      text(
        row.confirmation,
        booking.confirmationCode
          ? `${t("Confirmation", "确认号")} · ${booking.confirmationCode}`
          : "",
      );
      return row.item;
    });
    for (const [id] of view.bookings)
      if (!bookingIds.has(id)) view.bookings.delete(id);
    syncChildren(view.bookingList, bookingRows);
    updateCompanionExpenses(view, trip, day, shared);
    text(view.edit, t("Edit trip", "编辑行程"));
    text(view.add, t("＋ Add a place", "＋ 添加地点"));
  }
  function refresh() {
    if (!dayView) placeOutsideCompanion();
    const { trip, day, shared, invitation } = api.state();
    const available =
      trip &&
      !invitation &&
      document.body.classList.contains("travel-has-trip");
    if (
      messageContext &&
      (messageContext.owner !== owner() ||
        !available ||
        messageContext.ref !== tripRef(trip, shared))
    )
      clearMessage();
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
    if (!available) {
      if (companionView) clearCompanion();
      return;
    }
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
            const context = { owner: owner(), ref: tripRef(trip, shared) };
            control.disabled = true;
            try {
              await api.moveStop(stop.id, delta);
            } catch (error) {
              const current = api.state();
              if (
                context.owner === owner() &&
                current.trip &&
                context.ref === tripRef(current.trip, current.shared)
              ) {
                messageContext = context;
                message.hidden = false;
                message.textContent = error.message;
              }
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
    renderCompanion(trip, day, shared);
  }
  window.addEventListener("daily-space-travel-view-updated", refresh);
  window.addEventListener("daily-space-travel-stop-added", () => {
    if (editor?.mode === "places") close();
  });
  window.addEventListener("daily-space-travel-saved", () => {
    const { trip, shared } = api.state();
    if (!trip) return;
    messageContext = { owner: owner(), ref: tripRef(trip, shared) };
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
    if (
      !event.detail?.domains?.includes("tally") ||
      !dayView ||
      companion.hidden
    )
      return;
    const { trip, day, shared, invitation } = api.state();
    if (trip && !invitation)
      updateCompanionExpenses(companionView, trip, day, shared);
  });
  window.addEventListener("daily-space-locale-changed", () => {
    if (editor) close();
    refresh();
  });
  window.addEventListener("daily-space-auth-updated", () => {
    close(true, true);
    clearMessage();
    setDayView(false);
    clearCompanion();
  });
  refresh();
})();
