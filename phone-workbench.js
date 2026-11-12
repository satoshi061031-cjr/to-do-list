/** Compact phone overview; every action leads to the existing workspace. */
(function () {
  function boot() {
    if (!document.body.classList.contains('todo-mobile')) return;
    const Preferences = window.DailySpaceWorkbenchPreferences, api = window.DailySpaceTodo;
    const sections = document.querySelector('.workbench-sections');
    if (!Preferences || !api || !sections) return;
    document.body.classList.add('phone-widget-home');
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const root = document.createElement('section'); root.className = 'phone-workbench-overview'; root.dataset.i18nIgnore = ''; root.hidden = true;
    const grid = document.createElement('div'); grid.className = 'phone-overview-grid'; root.append(grid); sections.before(root);
    const tiles = {};
    const destinations = {schedule:'calendar.html#today',projects:'planner.html',spend:'tally.html'};
    for (const id of ['tasks','schedule','projects','spend']) {
      const tile = document.createElement(id === 'tasks' ? 'button' : 'a');
      tile.className = 'phone-overview-tile'; tile.dataset.phoneOverview = id;
      if (id === 'tasks') tile.type = 'button'; else tile.href = destinations[id];
      const value = document.createElement('strong'), label = document.createElement('span');
      value.className = 'phone-overview-value'; label.className = 'phone-overview-label'; tile.append(value,label); grid.append(tile);
      tiles[id] = {tile,value,label};
    }
    tiles.tasks.tile.addEventListener('click', () => {
      if (!Preferences.ready()) return;
      api.showToday();
      const target = document.querySelector('.m-task-controls') || document.getElementById('todo-list');
      target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      document.getElementById('m-filter-active')?.focus({preventScroll:true});
    });
    const labels = {tasks:['Today’s tasks','今日待办'],schedule:['Today’s schedule','今日日程'],projects:['Projects','项目'],spend:['Today’s spending','今日支出']};
    let queued = false;
    function render() {
      root.hidden = !Preferences.ready();
      if (root.hidden) { for (const tile of Object.values(tiles)) tile.value.textContent = ''; return; }
      root.setAttribute('aria-label',t('Today at a glance','今天概览'));
      const config = Preferences.read(), stats = window.DailySpaceLoop.getTodayStats(), tasks = api.getTasks();
      for (const [id,label] of Object.entries(labels)) tiles[id].label.textContent = t(...label);
      tiles.tasks.value.textContent = String(stats.dueTodayOpen);
      tiles.schedule.value.textContent = String(stats.remindersToday.filter(reminder => !tasks.some(task => task.sourceReminderId === reminder.id && task.completed)).length);
      let planners = [];
      try { const state = JSON.parse(localStorage.getItem('planner-app-v1') || '{}'); planners = Array.isArray(state.planners) ? state.planners : []; } catch (_) {}
      tiles.projects.value.textContent = String(planners.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').length);
      const state = window.DailySpaceTallyCore.readState();
      const amount = state.records.filter(record => record.date === stats.today && record.scope !== 'shared').reduce((sum,record) => sum + window.DailySpaceTallyCore.baseAmount(record),0);
      tiles.spend.value.textContent = window.DailySpaceTallyCore.formatAmount(state,amount,state.baseCurrency);
      tiles.tasks.tile.hidden = false;
      tiles.schedule.tile.hidden = config.hidden.includes('agenda');
      tiles.spend.tile.hidden = config.hidden.includes('spend');
      tiles.projects.tile.hidden = config.hidden.includes('shortcuts') || !config.shortcuts.includes('planner');
    }
    function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }
    for (const event of ['daily-space-workbench-updated','daily-space-agent-data-updated','daily-space-todo-view-updated','daily-space-user-sync-updated','daily-space-auth-updated','daily-space-locale-changed','storage']) window.addEventListener(event,schedule);
    document.addEventListener('visibilitychange',() => { if (!document.hidden) schedule(); });
    setInterval(() => { if (!document.hidden) schedule(); },60000);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
