/** Phone task capture and details, sharing the existing Todo store. */
(function () {
  if (!document.body.classList.contains("todo-mobile")) return;
  function boot() {
    const api = window.DailySpaceTodo;
    if (!api) return;
    const root = document.getElementById("m-task-editor");
    const motion = window.DailySpaceDialogHistory.motion(root);
    const form = document.getElementById("m-task-form");
    const title = document.getElementById("m-task-title");
    const date = document.getElementById("m-task-date");
    const time = document.getElementById("m-task-time");
    const category = document.getElementById("m-task-category");
    const repeat = document.getElementById("m-task-repeat");
    const details = document.getElementById("m-task-details");
    const extraFields = window.DailySpaceTaskDetails.mount(form, document.getElementById("m-task-date"));
    const status = document.getElementById("m-task-status");
    const save = document.getElementById("m-task-save");
    const remove = document.getElementById("m-task-delete");
    const todayButton = document.getElementById("m-task-today");
    const tomorrowButton = document.getElementById("m-task-tomorrow");
    const customButton = document.getElementById("m-task-custom");
    const empty = document.createElement("p");
    empty.className = "m-task-empty";
    document.getElementById("todo-list").after(empty);
    let taskId = null;
    let draftKey = "";
    let composing = false;
    let closingHistory = false;
    let returnScroll = 0;
    const VIEW_KEY = "daily-space-phone-view-v1";

    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const locale = () => window.DailySpaceI18n?.localeTag() || "en";
    function isoLocal(value) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    const today = () => isoLocal(new Date());
    function tomorrow() { const value = new Date(); value.setDate(value.getDate() + 1); return isoLocal(value); }
    function owner() {
      try { return JSON.parse(localStorage.getItem("daily-space-auth-v1") || "null")?.email || "guest"; }
      catch (_) { return "guest"; }
    }
    function read(key) {
      try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (_) { return null; }
    }
    function write(key, value) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Storage may be unavailable. */ }
    }
    function readDraft(key) {
      try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
    }
    function clearDraft() {
      try { localStorage.removeItem(draftKey); } catch (_) {}
    }
    function snapshot() {
      return { ...extraFields.value(), text: title.value, dueDate: date.value, dueTime: time.value,
        categoryId: category.value || null, repeat: repeat.value || null };
    }
    function storeDraft() {
      if (!root.hidden && !motion.closing && draftKey) {
        try { localStorage.setItem(draftKey, JSON.stringify(snapshot())); } catch (_) {}
      }
    }
    function showStatus(en, zh) { status.textContent = t(en, zh); }

    function syncDates() {
      todayButton.setAttribute("aria-pressed", String(date.value === today()));
      tomorrowButton.setAttribute("aria-pressed", String(date.value === tomorrow()));
      const custom = date.value && date.value !== today() && date.value !== tomorrow();
      customButton.setAttribute("aria-pressed", String(Boolean(custom)));
      customButton.textContent = custom
        ? new Date(`${date.value}T12:00:00`).toLocaleDateString(locale(), { month: "short", day: "numeric" })
        : t("Choose date", "选择日期");
      save.disabled = !title.value.trim() || composing;
    }
    function fill(value, source = value) {
      extraFields.fill(value, source);
      title.value = value?.text || "";
      date.value = value?.dueDate || today();
      time.value = value?.dueTime || "";
      repeat.value = value?.repeat || "";
      category.replaceChildren();
      category.add(new Option(t("No category", "无分类"), ""));
      for (const item of api.getCategories()) category.add(new Option(item.name, item.id));
      category.value = value?.categoryId || "";
      date.hidden = date.value === today() || date.value === tomorrow();
      syncDates();
    }
    function syncViewport() {
      if (root.hidden) return;
      const viewport = window.visualViewport;
      root.style.setProperty("--m-editor-height", `${viewport?.height || innerHeight}px`);
      root.style.setProperty("--m-editor-top", `${viewport?.offsetTop || 0}px`);
    }
    function open(id, push = true) {
      if (closingHistory) return;
      const task = id ? api.getTasks().find(item => item.id === id) : null;
      if (id && !task) return;
      taskId = id || null;
      draftKey = `daily-space-phone-draft-v1:${owner()}:${taskId || "new"}`;
      const draft = readDraft(draftKey);
      fill(draft || task, task);
      details.open = false;
      document.getElementById("m-task-editor-title").textContent = taskId ? t("Edit task", "编辑任务") : t("New task", "新建任务");
      save.textContent = taskId ? t("Save changes", "保存更改") : t("Add task", "添加任务");
      remove.hidden = !taskId;
      status.textContent = draft ? t("Draft restored", "已恢复草稿") : "";
      returnScroll = scrollY;
      motion.open();
      document.body.classList.add("m-task-editor-open");
      if (push) history.pushState({ ...history.state, mobileTaskSheet: true, taskId }, "", location.href);
      syncViewport();
      // Focus in the initiating gesture so mobile browsers can show their keyboard.
      title.focus({ preventScroll: true });
      title.setSelectionRange(title.value.length, title.value.length);
    }
    function close({ preserve = true, fromHistory = false, immediate = false } = {}) {
      if (root.hidden || (motion.closing && !immediate)) return false;
      if (preserve) storeDraft();
      const editing = taskId;
      title.blur();
      motion.close(() => {
        document.body.classList.remove("m-task-editor-open");
        window.DailySpaceUndo?.reposition();
        window.scrollTo({ top: returnScroll, behavior: "instant" });
        const row = editing && [...document.querySelectorAll("#todo-list .todo-item")].find(node => node.dataset.id === editing);
        (row?.querySelector(".todo-main") || document.getElementById("m-add-task")).focus({ preventScroll: true });
      }, immediate);
      composing = false;
      if (!fromHistory && history.state?.mobileTaskSheet) {
        closingHistory = true;
        history.back();
      }
      return true;
    }
    document.getElementById("m-add-task").addEventListener("click", () => open(null));
    document.getElementById("m-task-close").addEventListener("click", () => close());
    document.getElementById("m-task-backdrop").addEventListener("click", () => close());
    document.getElementById("m-task-discard").addEventListener("click", () => {
      clearDraft(); fill(taskId ? api.getTasks().find(item => item.id === taskId) : null);
      status.textContent = ""; title.focus();
    });
    remove.addEventListener("click", () => {
      if (!taskId) return;
      api.removeTask(taskId); clearDraft(); close({ preserve: false });
    });
    todayButton.addEventListener("click", () => { date.value = today(); date.hidden = true; syncDates(); storeDraft(); });
    tomorrowButton.addEventListener("click", () => { date.value = tomorrow(); date.hidden = true; syncDates(); storeDraft(); });
    customButton.addEventListener("click", () => {
      date.hidden = false;
      date.focus();
      try { date.showPicker?.(); } catch (_) { /* The visible date field remains usable. */ }
    });
    form.addEventListener("input", () => { status.textContent = ""; syncDates(); storeDraft(); });
    form.addEventListener("change", () => { syncDates(); storeDraft(); });
    title.addEventListener("compositionstart", () => { composing = true; syncDates(); });
    title.addEventListener("compositionend", () => { composing = false; syncDates(); storeDraft(); });
    title.addEventListener("keydown", event => {
      if (event.key === "Enter" && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (motion.closing || composing || !title.value.trim() || !form.reportValidity()) return;
      const saved = api.saveTask(snapshot(), taskId);
      if (!saved) { showStatus("This task is no longer available.", "这条任务已不存在。"); return; }
      clearDraft();
      if (taskId) close({ preserve: false });
      else {
        title.value = ""; extraFields.fill(null); syncDates();
        showStatus(saved.dueDate === today() ? "Task added. Ready for the next one." : "Task added for the selected date.",
          saved.dueDate === today() ? "已添加，可以继续输入下一条。" : "已添加到所选日期。");
        title.focus({ preventScroll: true });
      }
    });
    window.addEventListener("popstate", () => {
      if (closingHistory) { closingHistory = false; return; }
      if (!root.hidden && !history.state?.mobileTaskSheet) close({ fromHistory: true });
      else if (root.hidden && history.state?.mobileTaskSheet) open(history.state.taskId, false);
    });
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.visualViewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("pagehide", () => {
      storeDraft();
      write(`${VIEW_KEY}:${owner()}`, { filter: api.getView().filter, scroll: root.hidden ? scrollY : returnScroll });
    });
    window.addEventListener("daily-space-auth-updated", () => close({ immediate: true }));
    function renderChrome() {
      document.getElementById("m-page-date").textContent = new Date().toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" });
      const view = api.getView();
      const done = view.filter === "completed";
      document.body.classList.toggle("m-show-completed", done);
      document.getElementById("m-filter-active").setAttribute("aria-selected", String(!done));
      document.getElementById("m-filter-completed").setAttribute("aria-selected", String(done));
      const tasks = api.getVisibleTasks();
      empty.hidden = tasks.length > 0 || view.source !== "personal";
      empty.textContent = view.range === "week" ? t("No tasks in the next 7 days.", "近期 7 天没有任务。") : done ? t("No completed tasks yet.", "还没有已完成的任务。") : t("A clear day. Add your first task.", "今天很清爽，添加第一条任务吧。");
    }
    document.getElementById("m-filter-active").addEventListener("click", () => api.setFilter("active"));
    document.getElementById("m-filter-completed").addEventListener("click", () => api.setFilter("completed"));
    window.addEventListener("daily-space-todo-view-updated", renderChrome);
    window.addEventListener("daily-space-locale-changed", renderChrome);
    // The shared greeting is for desktop; the phone keeps its stable Today title.
    document.querySelector(".m-shell .app-greeting")?.remove();
    const view = read(`${VIEW_KEY}:${owner()}`);
    if (view?.filter === "completed") api.setFilter("completed");
    renderChrome();
    if (view?.scroll) requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(0, view.scroll)));
    window.DailySpaceMobileTodo = { openEdit: (id, push = true) => open(id, push), openNew: () => open(null), closeIfOpen: () => close() };
    if (history.state?.mobileTaskSheet) open(history.state.taskId, false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
