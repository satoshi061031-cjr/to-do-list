/** Optional task focus and a review of recorded work, over the original task store. */
(function () {
  function boot() {
    const Core = window.DailySpaceFocusCore, Tasks = window.DailySpaceTodo, Preferences = window.DailySpaceWorkbenchPreferences;
    const taskSection = document.querySelector('[data-workbench-section="tasks"], [data-module-id="tasks"]');
    if (!Core || !Tasks?.getTasks || !Preferences || !taskSection || !window.DailySpaceDialogHistory) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const owner = () => window.DailySpaceView?.owner() || 'guest';
    const node = (tag, cls = '', text = '') => { const element = document.createElement(tag); element.className = cls; element.textContent = text; return element; };
    const action = (cls, run) => { const button = node('button', cls); button.type = 'button'; button.addEventListener('click', run); return button; };
    const bar = node('div', 'focus-workbench-bar'); bar.dataset.i18nIgnore = '';
    const opener = action('focus-open', () => open('timer')), reviewOpener = action('focus-review-open', () => open('review'));
    opener.dataset.focusOpen = ''; reviewOpener.dataset.focusReview = '';
    const mini = node('span', 'focus-mini'); mini.setAttribute('aria-live', 'off');
    const inlineError = node('p', 'focus-save-error'); inlineError.hidden = true; inlineError.setAttribute('role', 'alert');
    bar.append(opener, reviewOpener, mini, inlineError);
    const list = document.getElementById('todo-list');
    if (list && taskSection.contains(list)) list.before(bar); else taskSection.prepend(bar);

    const root = node('div', 'focus-sheet'); root.id = 'focus-sheet'; root.hidden = true; root.dataset.dialogRoot = ''; root.dataset.i18nIgnore = '';
    const backdrop = action('focus-backdrop', () => close());
    const panel = node('section', 'focus-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'focus-title');
    const head = node('header'), title = node('h2'); title.id = 'focus-title';
    const dismiss = action('focus-dismiss', () => close()); dismiss.dataset.dialogClose = ''; dismiss.textContent = '×'; head.append(title, dismiss);
    const body = node('div', 'focus-body'), timer = node('section', 'focus-timer');
    const taskLabel = node('label', 'focus-task-label'), taskLabelText = node('span'), select = node('select'); select.dataset.focusTask = ''; taskLabel.append(taskLabelText, select);
    const modeLabel = node('label', 'focus-mode-label'), modeLabelText = node('span'), mode = node('select'); mode.dataset.focusMode = '';
    for (const minutes of [25, 50, 0]) mode.add(new Option('', String(minutes)));
    modeLabel.append(modeLabelText, mode);
    const clock = node('strong', 'focus-clock'), timerState = node('p', 'focus-timer-state'); clock.dataset.focusClock = '';
    clock.setAttribute('role', 'timer'); clock.setAttribute('aria-live', 'off'); timerState.setAttribute('role', 'status');
    const controls = node('div', 'focus-controls');
    const start = action('focus-start', startSession), pause = action('focus-pause', pauseSession), resume = action('focus-resume', resumeSession), finish = action('focus-finish', () => finishSession(false));
    start.dataset.focusStart = ''; pause.dataset.focusPause = ''; resume.dataset.focusResume = ''; finish.dataset.focusFinish = '';
    controls.append(start, pause, resume, finish);
    const completeLabel = node('label', 'focus-complete-label'), complete = node('input'), completeText = node('span'); complete.type = 'checkbox'; complete.dataset.focusComplete = ''; completeLabel.append(complete, completeText);
    const limitNote = node('p', 'focus-help');
    timer.append(taskLabel, modeLabel, clock, timerState, controls, completeLabel, limitNote);
    const status = node('p', 'focus-sheet-status'); status.setAttribute('role', 'status'); status.hidden = true;
    const error = node('p', 'focus-save-error'); error.setAttribute('role', 'alert'); error.hidden = true;

    const review = node('section', 'focus-review'); review.dataset.focusReviewBody = '';
    const reviewTitle = node('h3'); reviewTitle.tabIndex = -1;
    const weekNav = node('div', 'focus-week-nav'), previous = action('', () => changeWeek(-1)), week = node('span'), next = action('', () => changeWeek(1)), current = action('', () => { weekOffset = 0; renderReview(); });
    previous.dataset.reviewPrevious = ''; next.dataset.reviewNext = ''; current.dataset.reviewCurrent = ''; week.dataset.reviewRange = '';
    weekNav.append(previous, week, next, current);
    const metrics = node('dl', 'focus-review-metrics');
    const metricFields = ['completed', 'focus', 'overdue', 'inbox'].map(key => {
      const wrapper = node('div'), value = node('dd'), label = node('dt'); value.dataset.reviewMetric = key; wrapper.append(label, value); metrics.append(wrapper); return { key, value, label };
    });
    const completedTitle = node('h4'), doneList = node('ul', 'focus-review-list'), pendingTitle = node('h4'), pendingList = node('ul', 'focus-review-list'), reviewHelp = node('p', 'focus-help');
    doneList.dataset.reviewCompleted = ''; pendingList.dataset.reviewOverdue = '';
    review.append(reviewTitle, weekNav, metrics, completedTitle, doneList, pendingTitle, pendingList, reviewHelp);
    body.append(timer, status, error, review); panel.append(head, body); root.append(backdrop, panel); document.body.append(root);
    window.DailySpaceDialogHistory.fitViewport(root);
    const motion = window.DailySpaceDialogHistory.motion(root);
    const history = window.DailySpaceDialogHistory.create('focus', { isOpen: () => !root.hidden && !motion.closing, restore: data => open(data?.view || 'timer', false), close: () => close(true) });
    let renderedOwner = '', sheetOwner = '', weekOffset = 0, ticker = null, tasksSignature = '', selectedTask = '', finishing = false;
    let lastFinishedTask = null;
    function ready() { return Preferences.ready(); }
    function read() {
      if (!ready()) return Core.defaults();
      try { return Core.normalize(JSON.parse(localStorage.getItem(Core.KEY) || 'null')); } catch (_) { return Core.defaults(); }
    }
    function save(value, expectedOwner = owner()) {
      if (!ready() || owner() !== expectedOwner) throw new Error(t('Your workspace is still loading. Try again shortly.', '工作台正在加载，请稍后重试。'));
      const normalized = Core.normalize(value), serialized = JSON.stringify(normalized), previousValue = localStorage.getItem(Core.KEY);
      try {
        localStorage.setItem(Core.KEY, serialized);
        if (localStorage.getItem(Core.KEY) !== serialized) throw new Error('Storage did not retain the session.');
      } catch (cause) {
        try { if (previousValue === null) localStorage.removeItem(Core.KEY); else localStorage.setItem(Core.KEY, previousValue); } catch (_) {}
        throw new Error(t('Could not save focus on this device. Free space and retry; your previous session is kept.', '无法保存专注记录，请释放设备空间后重试；此前记录仍保留。'), { cause });
      }
      window.dispatchEvent(new CustomEvent('daily-space-focus-updated'));
      window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['focus'] } }));
      return normalized;
    }
    function reportError(failure) { error.textContent = inlineError.textContent = failure?.message || t('Could not save. Please retry.', '保存失败，请重试。'); error.hidden = inlineError.hidden = false; }
    function clearError() { error.hidden = inlineError.hidden = true; }
    function mutate(operation) {
      const expectedOwner = owner();
      if (sheetOwner !== expectedOwner || !ready() || root.hidden || motion.closing) return false;
      try { clearError(); save(operation(read()), expectedOwner); render(); return true; } catch (failure) { reportError(failure); return false; }
    }
    function pickCandidate(tasks) {
      const today = Core.localDate(), weight = value => ({ high: 0, normal: 1, low: 2 }[value] ?? 1);
      return [...tasks].filter(task => !task.completed).sort((a, b) =>
        Number(b.todayPinDate === today) - Number(a.todayPinDate === today) ||
        ((a.todayPinDate === today && b.todayPinDate === today) ? (a.todayPinOrder || 0) - (b.todayPinOrder || 0) : 0) ||
        weight(a.priority) - weight(b.priority) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))[0];
    }
    function startSession() {
      const task = Tasks.getTasks().find(item => item.id === select.value && !item.completed);
      if (mutate(state => Core.start(state, task, Number(mode.value) * 60000))) { complete.checked = false; lastFinishedTask = null; showStatus(t('Focus started. You can close this sheet.', '专注已开始，可以关闭此面板。')); }
    }
    function pauseSession() { mutate(state => Core.pause(state)); }
    function resumeSession() { mutate(state => Core.resume(state)); }
    function finishSession(automatic) {
      if (finishing || !ready() || (sheetOwner && sheetOwner !== owner())) return;
      const state = read(); if (!state.active) return;
      const expectedOwner = owner(); finishing = true;
      try {
        const result = Core.finish(state);
        save(result.state, expectedOwner); clearError();
        lastFinishedTask = result.session?.taskId || null;
        if (!automatic && complete.checked && lastFinishedTask && Tasks.getTasks().some(task => task.id === lastFinishedTask && !task.completed)) {
          Tasks.batchTasks([lastFinishedTask], 'complete');
        }
        complete.checked = false;
        showStatus(automatic ? t('Focus time is complete. Your session has been saved; mark the task complete when ready.', '专注时间已到，记录已保存；任务完成后可手动勾选。') : t('Focus session saved.', '专注记录已保存。'));
        render();
      } catch (failure) { reportError(failure); }
      finally { finishing = false; }
    }
    function showStatus(message) {
      if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(status, message, 'success');
      else status.textContent = message;
      status.hidden = false;
    }
    function formatClock(ms) {
      const seconds = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    function formatMinutes(ms) { const minutes = Math.round(ms / 60000); return t(`${minutes} min`, `${minutes} 分钟`); }
    function open(view = 'timer', push = true, taskId) {
      if (!ready()) return;
      if (push && !history.push({ view })) return;
      sheetOwner = owner(); renderedOwner = owner();
      if (taskId) { selectedTask = taskId; select.value = taskId; }
      else if (!selectedTask) selectedTask = pickCandidate(Tasks.getTasks())?.id || '';
      motion.open(); document.body.classList.add('workspace-tool-open'); render();
      requestAnimationFrame(() => { if (view === 'review') { reviewTitle.focus({ preventScroll: true }); review.scrollIntoView({ block: 'start' }); } else select.focus({ preventScroll: true }); });
    }
    function close(fromHistory = false, immediate = false) { motion.close(() => document.body.classList.remove('workspace-tool-open'), immediate); if (!fromHistory) history.back(); }
    function changeWeek(delta) { weekOffset = Math.max(-520, Math.min(0, weekOffset + delta)); renderReview(); }
    function taskLink(task) {
      const link = node('a', '', task.text || t('Untitled task', '未命名任务'));
      link.href = `${document.body.classList.contains('todo-mobile') ? 'todo-m.html' : 'todo.html'}?focus=todo&id=${encodeURIComponent(task.id)}`;
      return link;
    }
    function renderReview() {
      if (!ready()) { doneList.replaceChildren(); pendingList.replaceChildren(); return; }
      const bounds = Core.weekBounds(Date.now(), weekOffset), summary = Core.review(Tasks.getTasks(), read(), bounds);
      reviewTitle.textContent = t('Weekly review', '每周复盘');
      previous.textContent = '‹'; previous.setAttribute('aria-label', t('Previous week', '上一周'));
      next.textContent = '›'; next.setAttribute('aria-label', t('Next week', '下一周')); next.disabled = weekOffset >= 0;
      current.textContent = t('This week', '本周'); current.hidden = !weekOffset;
      week.textContent = `${summary.start} — ${summary.end}`;
      const values = { completed: summary.completedTasks.length, focus: formatMinutes(summary.focusMs), overdue: summary.overdueTasks.length, inbox: summary.inboxCount };
      const labels = { completed: t('Completed this week', '本周完成'), focus: t('Recorded focus', '已记录专注'), overdue: t('Still overdue', '仍未完成的逾期任务'), inbox: t('Inbox now', '当前待整理') };
      metricFields.forEach(field => { field.label.textContent = labels[field.key]; field.value.textContent = String(values[field.key]); });
      completedTitle.textContent = t('Completed', '已完成'); pendingTitle.textContent = t('Arrange unfinished tasks', '安排未完成任务');
      doneList.replaceChildren(...summary.completedTasks.sort((a, b) => b.completedAt - a.completedAt).slice(0, 20).map(task => {
        const row = node('li'); row.append(taskLink(task)); return row;
      }));
      if (!doneList.childElementCount) doneList.append(node('li', 'focus-review-empty', t('No recorded completions in this week.', '本周还没有已记录的完成事项。')));
      const nowOwner = owner();
      pendingList.replaceChildren(...summary.overdueTasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 20).map(task => {
        const row = node('li'), move = action('', () => {
          if (nowOwner !== owner() || !ready()) return;
          try { Tasks.batchTasks([task.id], 'date', Core.localDate()); renderReview(); } catch (failure) { reportError(failure); }
        });
        move.textContent = t('Today', '移到今天'); move.setAttribute('aria-label', `${t('Move to today', '移到今天')} · ${task.text}`); row.append(taskLink(task), move); return row;
      }));
      if (!pendingList.childElementCount) pendingList.append(node('li', 'focus-review-empty', t('No unfinished overdue tasks.', '没有尚未完成的逾期任务。')));
      reviewHelp.textContent = t('Completion dates are recorded from this version onward. Older completed tasks are not assigned a guessed date. Inbox and overdue counts show the current state; focus totals use recorded days.', '完成日期从此版本起记录，旧任务不会推测历史日期。待整理和逾期数量显示当前状态；专注时间按实际记录日期统计。');
    }
    function render() {
      const currentOwner = owner();
      if (renderedOwner && renderedOwner !== currentOwner) {
        selectedTask = ''; tasksSignature = ''; sheetOwner = ''; complete.checked = false; status.hidden = true; clearError(); lastFinishedTask = null;
        if (!root.hidden) close(true, true);
      }
      renderedOwner = currentOwner;
      const available = ready(), state = read(), active = state.active;
      opener.textContent = active ? t('Current focus', '当前专注') : t('Focus', '专注'); reviewOpener.textContent = t('Weekly review', '每周复盘');
      opener.disabled = reviewOpener.disabled = !available;
      dismiss.setAttribute('aria-label', t('Close focus', '关闭专注面板')); backdrop.setAttribute('aria-label', t('Close focus', '关闭专注面板'));
      mini.textContent = active ? `${active.resumedAt ? t('Focusing', '专注中') : t('Paused', '已暂停')} · ${formatClock(Core.elapsed(active))}` : '';
      if (!available) {
        if (!root.hidden) close(true, true);
        mini.textContent = ''; timerState.textContent = ''; clock.textContent = ''; select.replaceChildren();
        doneList.replaceChildren(); pendingList.replaceChildren(); metricFields.forEach(field => { field.value.textContent = ''; });
        status.hidden = true; complete.checked = false; tasksSignature = '';
        clearInterval(ticker); ticker = null; return;
      }
      title.textContent = t('Focus & review', '专注与复盘'); taskLabelText.textContent = t('Task', '任务'); modeLabelText.textContent = t('Session', '时长');
      select.setAttribute('aria-label', t('Focus task', '专注任务')); mode.setAttribute('aria-label', t('Focus length', '专注时长'));
      [t('25 minutes', '25 分钟'), t('50 minutes', '50 分钟'), t('Free focus', '自由计时')].forEach((text, index) => { mode.options[index].textContent = text; });
      const tasks = Tasks.getTasks().filter(task => !task.completed), signature = JSON.stringify(tasks.map(task => [task.id, task.text]));
      if (signature !== tasksSignature || active?.taskId !== select.dataset.activeTask) {
        const chosen = active?.taskId || select.value || selectedTask || pickCandidate(tasks)?.id || '';
        select.replaceChildren(new Option(t('Choose a task', '选择一个任务'), ''));
        tasks.forEach(task => select.add(new Option(task.text, task.id)));
        if (active && !tasks.some(task => task.id === active.taskId)) select.add(new Option(active.taskTitle || t('Removed task', '已移除的任务'), active.taskId));
        select.value = chosen; select.dataset.activeTask = active?.taskId || ''; tasksSignature = signature;
      }
      if (!select.value && selectedTask) select.value = selectedTask;
      select.disabled = mode.disabled = Boolean(active);
      start.textContent = t('Start focus', '开始专注'); pause.textContent = t('Pause', '暂停'); resume.textContent = t('Resume', '继续'); finish.textContent = t('Finish & save', '结束并保存');
      start.hidden = Boolean(active); start.disabled = !select.value; pause.hidden = !active?.resumedAt; resume.hidden = !active || Boolean(active.resumedAt); finish.hidden = !active;
      completeLabel.hidden = !active; completeText.textContent = t('Also complete the task when I finish', '结束时同时完成这项任务');
      limitNote.textContent = t('Close the panel or reload safely. Paused time is excluded. Free focus is capped at 12 hours; this page does not send a background alarm.', '可关闭面板或刷新，暂停时间不会计入。自由计时最多 12 小时；此页面不提供后台闹钟。');
      const amount = Core.elapsed(active);
      clock.textContent = formatClock(active ? (active.targetMs ? Math.max(0, active.targetMs - amount) : amount) : Number(mode.value) * 60000);
      timerState.textContent = active ? `${active.taskTitle} · ${active.resumedAt ? t('Focusing', '专注中') : t('Paused', '已暂停')}` : t('Choose one task and give it your attention.', '选一件事，留一段专注的时间。');
      if (!root.hidden) renderReview();
      clearInterval(ticker); ticker = null;
      if (active?.resumedAt && !document.hidden) {
        ticker = setInterval(() => {
          if (!ready() || renderedOwner !== owner()) { render(); return; }
          const current = read().active;
          if (current && Core.elapsed(current) >= (current.targetMs || Core.MAX_DURATION)) finishSession(true);
          else render();
        }, 1000);
      }
      if (active?.resumedAt && amount >= (active.targetMs || Core.MAX_DURATION) && !finishing) finishSession(true);
    }
    select.addEventListener('change', () => { selectedTask = select.value; start.disabled = !select.value; });
    mode.addEventListener('change', render);
    // The original card keeps its task-detail action; focus is an explicit second action.
    const focusCard = document.querySelector('.overview-focus-card');
    if (focusCard) {
      const quickStart = action('focus-card-start', () => open('timer', true, pickCandidate(Tasks.getTasks())?.id));
      quickStart.textContent = t('Start focus', '开始专注'); quickStart.dataset.focusCardStart = ''; focusCard.append(quickStart);
      window.addEventListener('daily-space-locale-changed', () => { quickStart.textContent = t('Start focus', '开始专注'); });
    }
    for (const event of ['daily-space-agent-data-updated', 'daily-space-focus-updated', 'daily-space-user-sync-updated', 'daily-space-todo-view-updated', 'daily-space-locale-changed', 'storage']) window.addEventListener(event, render);
    window.addEventListener('daily-space-auth-updated', () => { clearInterval(ticker); ticker = null; sheetOwner = ''; selectedTask = ''; tasksSignature = ''; complete.checked = false; close(true, true); render(); });
    document.addEventListener('visibilitychange', render);
    window.DailySpaceFocus = { read, save, open: taskId => open('timer', true, taskId), openReview: () => open('review'), close, core: Core };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
