/** Narrow task operations for the notebook and review, over the original store. */
(function () {
  const KEY = 'todo-app-v2';
  const owner = () => window.DailySpaceView?.owner() || 'guest';
  const ready = () => window.DailySpaceWorkbenchPreferences?.ready() === true;
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  function read() {
    if (!ready()) throw new Error(t('Workspace is still loading.', '工作台正在加载。'));
    const state = JSON.parse(localStorage.getItem(KEY) || '{"todos":[],"categories":[]}');
    if (!state || !Array.isArray(state.todos)) throw new Error(t('Task data could not be read. Open the workbench to check it.', '无法读取任务数据，请回工作台检查。'));
    return state;
  }
  function change(operation) {
    const who = owner(), state = read(), before = localStorage.getItem(KEY), result = operation(state);
    if (!result) return false;
    const after = JSON.stringify(state);
    if (!ready() || owner() !== who || localStorage.getItem(KEY) !== before) throw new Error(t('Workspace changed. Please retry.', '工作空间已有更改，请重试。'));
    try {
      localStorage.setItem(KEY, after);
      if (!ready() || owner() !== who || localStorage.getItem(KEY) !== after) throw new Error('Save was not retained.');
    } catch (cause) {
      try { if (owner() === who) { if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before); } } catch (_) {}
      throw new Error(t('Could not save the task. Your previous data is kept.', '任务保存失败，此前数据仍保留。'), { cause });
    }
    try { window.DailySpaceHistory?.capture(KEY, before, after); } catch (_) {}
    try { window.DailySpaceTasks?.syncLinkedWork({ from: 'todo', silent: true }); } catch (_) {}
    window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['todo'] } }));
    return result;
  }
  window.DailySpacePageTasks = {
    getTasks: () => ready() ? read().todos.map(task => ({ ...task, ...window.DailySpaceTaskFields.fields(task) })) : [],
    saveTask(input) {
      return change(state => {
        if (state.todos.length >= 1000) throw new Error(t('Keep at most 1,000 tasks.', '最多保留 1,000 条任务。'));
        const text = String(input.text || '').trim().slice(0, 500);
        if (!text) throw new Error(t('Add a task title.', '请填写任务标题。'));
        const task = { ...window.DailySpaceTaskFields.fields(input), id: crypto.randomUUID(), text, completed: false,
          createdAt: Date.now(), completedAt: null, dueDate: null, dueTime: null, categoryId: null, repeat: null };
        state.todos.unshift(task); return task;
      });
    },
    reviewControls(task, report, changed) {
      const who = owner(), wrap = document.createElement('div');
      wrap.className = 'review-plan-actions';
      const date = document.createElement('input'); date.type = 'date'; date.value = task.plannedDate || '';
      date.setAttribute('aria-label', t('Plan date', '计划日期') + ' · ' + task.text);
      const button = (label, run) => {
        const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
        el.addEventListener('click',run); return el;
      };
      const schedule = value => {
        if (!ready() || who !== owner()) return;
        try {
          change(state => {
            const current = state.todos.find(item => item.id === task.id);
            if (!current || current.completed || (current.plannedDate || null) !== (task.plannedDate || null)) {
              throw new Error(t('Task changed. Refresh to review it.', '任务已变化，请刷新后重新查看。'));
            }
            current.plannedDate = value;
            if (!value) current.plannedTime = null;
            current.planDeferred = !value;
            return current;
          });
          changed();
        } catch (error) { report(error); }
      };
      const today = button(t('Today', '今天'), () => schedule(window.DailySpaceFocusCore.localDate()));
      today.dataset.reviewToday = task.id;
      const apply = button(t('Schedule', '安排到所选日'), () => {
        if (window.DailySpaceTaskFields.validDate(date.value)) schedule(date.value);
        else date.focus();
      });
      const skip = button(t('Leave unscheduled', '暂不安排'), () => schedule(null));
      const state = document.createElement('small');
      state.textContent = [t('Due', '截止') + ' ' + task.dueDate, task.plannedDate || (task.planDeferred ? t('Unscheduled', '暂不安排') : '')].filter(Boolean).join(' · ');
      wrap.append(state,date,apply,today,skip);
      return wrap;
    },
  };
})();
