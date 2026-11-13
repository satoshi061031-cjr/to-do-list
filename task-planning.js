/** Inbox, daily priorities and named filters over the original Todo list. */
(function () {
  function boot() {
    const api = window.DailySpaceTodo, Core = window.DailySpaceTaskViewsCore;
    const list = document.getElementById('todo-list');
    if (!api?.getPlanningView || !Core || !list) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const owner = () => window.DailySpaceView?.owner() || 'guest';
    const ready = () => window.DailySpaceWorkbenchPreferences?.ready() !== false && document.documentElement.dataset.workspaceLocked !== 'true' && document.documentElement.dataset.workspaceReady !== 'false';
    const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
    const action = (text, run) => { const el = node('button', '', text); el.type = 'button'; el.addEventListener('click', run); return el; };
    function day(offset = 0) { const now = new Date(); now.setDate(now.getDate() + offset); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
    function read() { try { return Core.normalize(JSON.parse(localStorage.getItem(Core.KEY) || 'null')); } catch (_) { return Core.normalize(null); } }
    let renderOwner = owner(), selectedViewId = '', composing = false, queued = false;
    const root = node('section', 'task-planning'); root.dataset.i18nIgnore = '';
    root.classList.add('task-planning-unified'); root.dataset.consolidatedFilters = '';
    document.body.classList.add('has-consolidated-filters');
    root.setAttribute('aria-label', t('Task planning', '任务规划'));
    const tabs = node('div', 'task-planning-tabs'); tabs.setAttribute('role', 'group');
    const bar = node('div', 'task-planning-bar'), chips = node('div', 'task-filter-chips'); chips.setAttribute('aria-label', t('Active filters', '当前筛选'));
    const tabButtons = {};
    for (const mode of ['tasks', 'inbox', 'top']) {
      const button = action('', () => {
        if (!allowed()) return;
        selectedViewId = '';
        if (mode === 'tasks') {
          const current = api.getPlanningView();
          if (current.mode === 'tasks' && (current.range === 'week' || (current.day && current.day !== day()))) api.setPlanningView(current);
          else api.showToday();
        }
        else api.setPlanningView({ mode, priority: 'all', categoryId: null });
      }); button.dataset.planningMode = mode; tabButtons[mode] = button; tabs.append(button);
    }
    const capture = node('form', 'task-inbox-capture'); capture.hidden = true;
    const captureLabel = node('label'), captureText = node('input'); captureText.type = 'text'; captureText.maxLength = 500; captureText.autocomplete = 'off'; captureText.dataset.inboxText = '';
    captureLabel.append(captureText);
    const captureSubmit = node('button'); captureSubmit.type = 'submit'; captureSubmit.dataset.inboxSave = '';
    const captureHelp = node('p', 'task-planning-help'); capture.append(captureLabel, captureSubmit, captureHelp);
    const options = node('details', 'task-planning-options'), summary = node('summary'); summary.dataset.taskFiltersOpen = ''; options.append(summary);
    const content = node('div', 'task-filter-content');
    const personal = node('fieldset', 'task-filter-personal'); personal.append(node('legend', '', t('Task filters', '任务筛选')));
    function group(en, zh, control) { const section = node('section', 'task-filter-group'), heading = node('h3', '', t(en, zh)); section.append(heading, control); return section; }
    const sourceSwitch = document.querySelector('.todo-source-switch');
    let sourceSelect = null;
    if (sourceSwitch && !document.body.classList.contains('todo-mobile')) content.append(group('Source', '来源', sourceSwitch));
    else {
      sourceSelect = node('select'); sourceSelect.dataset.taskSource = ''; sourceSelect.setAttribute('aria-label', t('Task source', '任务来源'));
      sourceSelect.addEventListener('change', () => { if (allowed()) { selectedViewId = ''; api.setPlanningView({ ...api.getPlanningView(), source: sourceSelect.value }); } });
      content.append(group('Source', '来源', sourceSelect));
    }
    const mobileTabs = document.querySelector('.m-task-tabs'), statusControls = mobileTabs || document.getElementById('todo-status-filters');
    if (statusControls) {
      if (mobileTabs) document.getElementById('todo-status-filters')?.classList.add('task-filter-legacy-status');
      statusControls.classList.add('task-filter-status'); personal.append(group('Status', '状态', statusControls));
      // Today belongs to the date scope. The original button remains wired for
      // existing shortcuts, while the visible choices only describe completion.
      statusControls.querySelector('[data-filter=today]')?.setAttribute('hidden', '');
      if (mobileTabs) {
        const all = action(t('All', '全部'), () => { if (allowed()) api.setPlanningView({ ...api.getPlanningView(), mode: 'tasks', filter: 'all' }); });
        all.dataset.taskStatusAll = ''; all.setAttribute('role','tab'); mobileTabs.prepend(all);
      }
      statusControls.addEventListener('click', event => {
        if (!event.target.closest('button') || !allowed()) return;
        const current = api.getPlanningView();
        if (current.filter === 'today' && !current.day) api.setPlanningView({ ...current, day: day() });
      }, true);
    }
    const dateControls = node('div', 'task-filter-date-controls');
    const range = document.querySelector('.task-range'); if (range) dateControls.append(range);
    const legacyPicker = document.getElementById('m-task-view-picker');
    let dateInput = document.getElementById('m-task-view-date');
    let dateLabel = dateInput?.closest('label');
    if (!dateInput) { dateInput = node('input'); dateInput.type = 'date'; dateLabel = node('label'); dateLabel.append(node('span', '', t('Choose a date', '选择日期')), dateInput); }
    dateInput.dataset.taskDate = ''; dateInput.setAttribute('aria-label', t('Task date', '任务日期')); dateControls.append(dateLabel);
    dateInput.addEventListener('change', event => {
      event.stopImmediatePropagation();
      if (!allowed() || !dateInput.value || !dateInput.checkValidity()) return;
      const current = api.getPlanningView(); selectedViewId = '';
      api.setPlanningView({ ...current, mode: 'tasks', day: dateInput.value, range: 'day', filter: current.filter === 'today' ? 'all' : current.filter });
    }, true);
    const allDates = action(t('All dates', '全部日期'), () => { if (allowed()) { selectedViewId = ''; const current = api.getPlanningView(); api.setPlanningView({ ...current, mode: 'tasks', day: null, range: 'day', filter: current.filter === 'today' ? 'all' : current.filter }); } });
    allDates.dataset.taskAllDates = ''; dateControls.append(allDates); personal.append(group('Date & range', '日期与范围', dateControls));
    const todayDate = action(t('Today', '今天'), () => { if (allowed()) { selectedViewId = ''; api.showToday(); } }); todayDate.dataset.taskToday = ''; dateControls.append(todayDate);
    if (legacyPicker) { legacyPicker.classList.add('task-filter-legacy-date'); document.getElementById('m-page-date').hidden = false; }
    const categoryLabel = node('label', 'task-filter-category'), category = node('select'); category.dataset.taskCategory = ''; category.setAttribute('aria-label', t('Task category', '任务分类')); categoryLabel.append(node('span', '', t('Category', '分类')), category);
    category.addEventListener('change', () => { if (allowed()) { selectedViewId = ''; api.setPlanningView({ ...api.getPlanningView(), categoryId: category.value || null }); } }); personal.append(categoryLabel);
    const filters = node('div', 'task-planning-filters');
    const priorityLabel = node('label'), priority = node('select'); priority.dataset.planningPriority = ''; priorityLabel.append(priority);
    const viewLabel = node('label'), viewSelect = node('select'); viewSelect.dataset.savedTaskView = ''; viewLabel.append(viewSelect);
    const saveLabel = node('label'), name = node('input'); name.maxLength = 60; name.type = 'text'; name.dataset.taskViewName = ''; saveLabel.append(name);
    const save = action('', () => {
      if (!allowed() || !name.value.trim()) return;
      const state = read(); if (state.views.length >= 30) { say('Keep up to 30 saved views. Remove one first.', '最多保存 30 个视图，请先删除一个。'); return; }
      const current = api.getPlanningView(), id = crypto.randomUUID();
      state.views.push({ ...current, id, name: name.value.trim(), dayMode: !current.day ? 'all' : current.day === day() ? 'today' : 'fixed' });
      if (!write(state)) return;
      selectedViewId = id; name.value = ''; say('View saved.', '已保存视图。'); render();
    }); save.dataset.saveTaskView = '';
    const remove = action('', () => {
      if (!allowed() || !selectedViewId) return;
      const state = read(), id = selectedViewId;
      state.views = state.views.filter(view => view.id !== id);
      if (write(state)) { selectedViewId = ''; say('View removed. Tasks are unchanged.', '已删除视图，任务不受影响。'); render(); }
    }); remove.dataset.deleteTaskView = '';
    personal.append(priorityLabel);
    const clearCompleted = document.getElementById('clear-completed'); if (clearCompleted) personal.append(clearCompleted);
    filters.append(viewLabel, saveLabel, save, remove); content.append(personal, filters); options.append(content);
    const reset = action(t('Reset filters', '重置筛选'), () => { if (!allowed()) return; selectedViewId = ''; const current = api.getPlanningView(); api.setPlanningView({ mode: current.mode, source: 'personal', priority: 'all', categoryId: null, range: 'day', day: day(), filter: 'active' }); }); reset.dataset.taskFiltersReset = ''; content.append(reset);
    document.querySelector('.toolbar.toolbar-quiet')?.classList.add('task-filter-legacy-toolbar');
    document.getElementById('due-day-filter-bar')?.classList.add('task-filter-legacy-day');
    let surface = null;
    if (window.DailySpaceSurfaces) surface = window.DailySpaceSurfaces.create({ key: 'task-filters', trigger: summary, title: () => t('Filter tasks', '筛选任务'), content, onClose:()=>api.syncViewLocation?.() });
    const filtersOpen = () => surface ? surface.open() : (options.open = true);
    const filtersClose = () => surface ? surface.close() : (options.open = false);
    for (const eventName of ['click', 'change']) content.addEventListener(eventName, event => { if (!allowed()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    const status = node('p', 'task-planning-status'); status.setAttribute('role', 'status');
    bar.append(tabs, options); root.append(bar, chips, capture, status);
    const section = document.querySelector('[data-workbench-section=tasks], [data-module-id=tasks]');
    if (section) section.prepend(root); else list.before(root);
    function allowed() { return ready() && renderOwner === owner(); }
    function say(en, zh) { const message = t(en, zh); if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(status, message, /could not|couldn.t/i.test(en) ? 'error' : 'info'); else status.textContent = message; }
    function write(state) {
      const before = localStorage.getItem(Core.KEY), next = JSON.stringify(Core.normalize(state));
      try {
        if (!allowed()) return false;
        localStorage.setItem(Core.KEY, next);
        if (localStorage.getItem(Core.KEY) !== next) throw new Error('Storage unavailable');
        window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['taskViews'] } }));
        return true;
      } catch (_) {
        try { if (before === null) localStorage.removeItem(Core.KEY); else localStorage.setItem(Core.KEY, before); } catch (_) {}
        say('Could not save on this device. Your input is still here.', '未能保存到此设备，输入已保留。'); return false;
      }
    }
    captureText.addEventListener('compositionstart', () => { composing = true; });
    captureText.addEventListener('compositionend', () => { composing = false; });
    capture.addEventListener('submit', event => {
      event.preventDefault();
      if (!allowed() || composing || !captureText.value.trim()) return;
      if (api.captureTask(captureText.value)) { captureText.value = ''; say('Saved to Inbox. Organize it when you are ready.', '已放入收集箱，准备好了再安排。'); captureText.focus(); }
      else say('Could not save. Your input is still here.', '未能保存，输入已保留。');
    });
    priority.addEventListener('change', () => { if (allowed()) { selectedViewId = ''; api.setPlanningView({ ...api.getPlanningView(), priority: priority.value }); } });
    viewSelect.addEventListener('change', () => {
      if (!allowed()) return;
      selectedViewId = viewSelect.value;
      const value = read().views.find(view => view.id === selectedViewId);
      if (value) api.applySavedView({ ...value, day: value.dayMode === 'today' ? day() : value.dayMode === 'all' ? null : value.day });
      render();
    });
    function decorate(mode) {
      for (const row of list.querySelectorAll('.todo-item[data-id]')) {
        if (row.querySelector('.task-triage-actions') || mode === 'tasks') continue;
        const id = row.dataset.id, rowOwner = renderOwner;
        const valid = () => allowed() && owner() === rowOwner;
        const tools = node('div', 'task-triage-actions');
        if (mode === 'inbox') {
          const disclosure = node('details'), title = node('summary', '', t('Organize', '整理'));
          const body = node('div', 'task-triage-options');
          const triage = value => { if (!valid()) return; if (!api.triageTask(id, value)) say('Could not update this task.', '未能更新此任务。'); };
          body.append(action(t('Today', '今天'), () => triage(day())), action(t('Tomorrow', '明天'), () => triage(day(1))), action(t('Keep undated', '暂不设日期'), () => triage(null)));
          const dateLabel = node('label', '', t('Choose date', '选择日期')), date = node('input'); date.type = 'date'; date.setAttribute('aria-label', t('Plan task date', '安排任务日期')); dateLabel.append(date);
          const plan = action(t('Schedule', '安排'), () => { if (date.value) triage(date.value); }); plan.disabled = true; date.addEventListener('input', () => { plan.disabled = !date.value; }); body.append(dateLabel, plan);
          disclosure.append(title, body); tools.append(disclosure);
        } else {
          const order = api.getTasks().filter(task => !task.completed && task.todayPinDate === day()).sort((a,b) => a.todayPinOrder - b.todayPinOrder), index = order.findIndex(task => task.id === id);
          const move = delta => { if (!valid()) return; if (window.DailySpaceLayoutMotion) window.DailySpaceLayoutMotion.run(list, () => api.movePinnedTask(id, delta)); else api.movePinnedTask(id, delta); };
          const up = action(t('Move up', '上移'), () => move(-1)); up.disabled = index <= 0; up.dataset.planningMove = id; up.dataset.planningDelta = '-1';
          const down = action(t('Move down', '下移'), () => move(1)); down.disabled = index < 0 || index >= order.length - 1; down.dataset.planningMove = id; down.dataset.planningDelta = '1';
          const unpin = action(t('Remove priority', '移出重点'), () => { if (valid()) api.pinTask(id, false); });
          tools.append(up, down, unpin);
        }
        row.append(tools);
      }
    }
    function render() {
      queued = false;
      const nextOwner = owner();
      if (renderOwner !== nextOwner) { captureText.value = ''; name.value = ''; selectedViewId = ''; status.textContent = ''; renderOwner = nextOwner; }
      const isReady = ready();
      root.hidden = !isReady;
      if (!isReady) { captureText.value = ''; name.value = ''; status.textContent = ''; filtersClose(); return; }
      const current = api.getPlanningView(), tasks = api.getTasks(), values = read().views;
      const assigned = api.getView().source === 'assigned', effectiveDay = current.filter === 'today' ? day() : current.day;
      const inboxCount = tasks.filter(task => task.inbox && !task.completed).length;
      const pinnedCount = tasks.filter(task => !task.completed && task.todayPinDate === day()).length;
      const taskLabel = !assigned && current.mode === 'tasks' ? current.range === 'week' ? t('7 days', '近期 7 天') : effectiveDay === day() ? t('Today', '今天') : effectiveDay ? t('Selected day', '已选日期') : t('Tasks', '任务') : t('Today', '今天');
      const labels = { tasks: taskLabel, inbox: `${t('Inbox', '收集箱')} ${inboxCount}`, top: `${t('Top 3', '重点')} ${pinnedCount}/3` };
      for (const [mode, button] of Object.entries(tabButtons)) { button.textContent = labels[mode]; button.setAttribute('aria-pressed', String(!assigned && current.mode === mode)); }
      personal.disabled = assigned; personal.hidden = assigned;
      statusControls?.closest('.task-filter-group')?.toggleAttribute('hidden', current.mode !== 'tasks' || assigned);
      dateControls.closest('.task-filter-group').hidden = current.mode !== 'tasks' || assigned;
      if (sourceSelect) { sourceSelect.replaceChildren(new Option(t('Personal', '个人任务'), 'personal'), new Option(t('Assigned to me', '分配给我'), 'assigned')); sourceSelect.value = assigned ? 'assigned' : 'personal'; }
      category.replaceChildren(new Option(t('All categories', '全部分类'), ''), ...api.getCategories().map(value => new Option(value.name, value.id))); category.value = current.categoryId || '';
      if (document.activeElement !== dateInput) dateInput.value = effectiveDay || '';
      allDates.setAttribute('aria-pressed', String(!effectiveDay && current.range !== 'week'));
      todayDate.setAttribute('aria-pressed', String(effectiveDay === day() && current.range !== 'week'));
      const allStatus = statusControls?.querySelector('[data-task-status-all], [data-filter=all]');
      if (allStatus) { const active = current.filter === 'all' || current.filter === 'today'; allStatus.classList.toggle('is-active', active); allStatus.setAttribute('aria-selected', String(active)); allStatus.setAttribute('aria-pressed', String(active)); }
      if (mobileTabs) {
        mobileTabs.querySelector('#m-filter-active')?.setAttribute('aria-selected',String(current.filter==='active'));
        mobileTabs.querySelector('#m-filter-completed')?.setAttribute('aria-selected',String(current.filter==='completed'));
      }
      capture.hidden = current.mode !== 'inbox'; captureText.placeholder = t('An idea, task or link…', '记录想法、待办或链接…'); captureText.setAttribute('aria-label', t('Capture to Inbox', '记录到收集箱')); captureSubmit.textContent = t('Capture', '记录'); captureHelp.textContent = t('No date or category needed. Organize below when you are ready.', '无需选择日期或分类，之后在下方整理。');
      const chipItems = [];
      const update = patch => { selectedViewId = ''; api.setPlanningView({ ...api.getPlanningView(), ...patch }); };
      if (assigned) chipItems.push({ key:'source', text:t('Assigned to me', '分配给我'), clear:()=>update({source:'personal'}) });
      if (current.range === 'week' && current.mode === 'tasks' && !assigned) chipItems.push({key:'range',text:t('Next 7 days','近期 7 天'),clear:()=>update({range:'day'})});
      else if (current.mode === 'tasks' && !assigned && effectiveDay && effectiveDay !== day()) chipItems.push({key:'date',text:effectiveDay,clear:()=>update({day:null})});
      else if (current.mode === 'tasks' && !assigned && !effectiveDay) chipItems.push({key:'date',text:t('All dates','全部日期'),clear:()=>update({day:day()})});
      if (!assigned && current.filter === 'completed' && current.mode === 'tasks') chipItems.push({key:'status',text:t('Completed','已完成'),clear:()=>update({filter:'active'})});
      if (!assigned && current.filter === 'all' && current.mode === 'tasks') chipItems.push({key:'status',text:t('All statuses','全部状态'),clear:()=>update({filter:'active'})});
      if (!assigned && current.categoryId) chipItems.push({key:'category',text:api.getCategories().find(value=>value.id===current.categoryId)?.name||t('Category','分类'),clear:()=>update({categoryId:null})});
      if (!assigned && current.priority !== 'all') chipItems.push({key:'priority',text:{high:t('Important','重要'),normal:t('Normal','普通'),low:t('Low','低')}[current.priority],clear:()=>update({priority:'all'})});
      chips.replaceChildren(...chipItems.map(item=>{ const button=action(`${item.text} ×`,()=>{if(!allowed())return;item.clear();queueMicrotask(()=>{if(!button.isConnected)summary.focus({preventScroll:true});});});button.dataset.taskFilterChip=item.key;button.setAttribute('aria-label',`${t('Clear filter','清除筛选')}: ${item.text}`);return button;})); chips.hidden=!chipItems.length;
      summary.textContent = `${t('Filter', '筛选')}${chipItems.length ? ` ${chipItems.length}` : ''}`;
      priorityLabel.replaceChildren(document.createTextNode(t('Priority', '优先级')), priority);
      priority.replaceChildren(...[['all','All priorities','全部优先级'],['high','Important','重要'],['normal','Normal','普通'],['low','Low','低']].map(([value,en,zh]) => new Option(t(en,zh),value))); priority.value = current.priority;
      viewLabel.replaceChildren(document.createTextNode(t('Saved views', '已保存视图')), viewSelect);
      viewSelect.replaceChildren(new Option(t('Choose a view', '选择视图'), ''), ...values.map(value => new Option(value.name, value.id)));
      if (!values.some(value => value.id === selectedViewId)) selectedViewId = '';
      viewSelect.value = selectedViewId;
      saveLabel.replaceChildren(document.createTextNode(t('View name', '视图名称')), name); name.placeholder = t('e.g. This week’s work', '例如：本周工作');
      save.textContent = t('Save current view', '保存当前视图'); remove.textContent = t('Delete view', '删除视图'); remove.disabled = !selectedViewId;
      decorate(current.mode);
    }
    function schedule() { if (!queued) { queued = true; queueMicrotask(render); } }
    for (const event of ['daily-space-todo-view-updated', 'daily-space-agent-data-updated', 'daily-space-auth-updated', 'daily-space-user-sync-updated', 'daily-space-locale-changed', 'storage']) window.addEventListener(event, schedule);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    window.DailySpaceTaskPlanning = { render: schedule, openFilters:filtersOpen,closeFilters:filtersClose,openInbox: () => api.setPlanningView({ mode: 'inbox', priority: 'all', categoryId: null }) };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
