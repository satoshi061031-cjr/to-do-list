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
    const summary = document.createElement('div'); summary.className = 'phone-overview-summary';
    const today = document.createElement('button'); today.type = 'button'; today.className = 'phone-summary-tasks'; today.dataset.phoneSummary = 'tasks';
    const todayValue = document.createElement('strong'), todayLabel = document.createElement('span'); today.append(todayValue,todayLabel);
    const next = document.createElement('a'); next.className = 'phone-summary-next'; next.dataset.phoneSummary = 'next'; next.href = 'calendar.html#today';
    const nextLabel = document.createElement('span'), nextValue = document.createElement('strong'); next.append(nextLabel,nextValue);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'phone-overview-toggle'; toggle.dataset.phoneOverviewToggle = '';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const grid = document.createElement('div'); grid.className = 'phone-overview-grid'; grid.id = 'phone-overview-details'; grid.hidden = true;
    toggle.setAttribute('aria-controls',grid.id); toggle.setAttribute('aria-expanded','false');
    const error = document.createElement('p'); error.className = 'phone-overview-error'; error.setAttribute('role','status'); error.hidden = true;
    summary.append(today,next,toggle); root.append(summary,grid,error); sections.before(root);
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
    function showToday() {
      if (!Preferences.ready()) return;
      api.showToday();
      const target = document.querySelector('[data-planning-mode=tasks]') || document.querySelector('.m-task-controls') || document.getElementById('todo-list');
      target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      if (target?.matches('button')) target.focus({preventScroll:true});
    }
    tiles.tasks.tile.addEventListener('click',showToday); today.addEventListener('click',showToday);
    let renderOwner = '';
    toggle.addEventListener('click', () => {
      if (!Preferences.ready() || renderOwner !== window.DailySpaceView?.owner()) return;
      try {
        const config = Preferences.read(); Preferences.save({...config,phoneOverviewExpanded:config.phoneOverviewExpanded !== true});
        error.hidden = true; render();
      } catch (_) {
        error.textContent = t('Could not save this choice. Your overview is unchanged; try again.', '未能保存此设置，概览保持原样，请重试。'); error.hidden = false;
      }
    });
    const labels = {tasks:['Today’s tasks','今日待办'],schedule:['Today’s schedule','今日日程'],projects:['Projects','项目'],spend:['Today’s spending','今日支出']};
    let queued = false;
    function render() {
      root.hidden = !Preferences.ready();
      if (root.hidden) {
        renderOwner = ''; todayValue.textContent = ''; todayLabel.textContent = ''; nextLabel.textContent = ''; nextValue.textContent = ''; next.href = 'calendar.html#today'; next.removeAttribute('title'); next.removeAttribute('aria-label'); error.hidden = true;
        for (const tile of Object.values(tiles)) tile.value.textContent = ''; return;
      }
      if (renderOwner !== window.DailySpaceView?.owner()) error.hidden = true;
      renderOwner = window.DailySpaceView?.owner();
      root.setAttribute('aria-label',t('Today at a glance','今天概览'));
      const config = Preferences.read(), stats = window.DailySpaceLoop.getTodayStats(), tasks = api.getTasks();
      const expanded = config.phoneOverviewExpanded === true;
      grid.hidden = !expanded; root.dataset.expanded = String(expanded); toggle.setAttribute('aria-expanded',String(expanded));
      toggle.setAttribute('aria-label',expanded?t('Hide detailed overview','收起详细概览'):t('Show detailed overview','展开详细概览'));
      toggle.title = expanded?t('Hide detailed overview','收起详细概览'):t('Show detailed overview','展开详细概览');
      todayValue.textContent = String(stats.dueTodayOpen);
      todayLabel.textContent = stats.dueTodayOpen ? t('To do today','今日待办') : t('Today is clear','今天已清空');
      today.setAttribute('aria-label',stats.dueTodayOpen?t(`${stats.dueTodayOpen} tasks left today. Open today.`, `今天剩余 ${stats.dueTodayOpen} 项待办，打开今天。`):t('No unfinished tasks today. Open today.','今天暂无未完成任务，打开今天。'));
      const now = new Date(), hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const arrangements = stats.remindersToday.filter(item => item.startTime && !tasks.some(task => task.sourceReminderId === item.id && task.completed)).map(item => ({ text:item.text,time:item.startTime,end:item.endTime,href:`calendar.html?focus=reminder&id=${encodeURIComponent(item.id)}` }));
      tasks.filter(task => !task.completed && !task.inbox && !task.sourceReminderId && task.dueDate === stats.today && task.dueTime).forEach(task => arrangements.push({text:task.text,time:task.dueTime,href:`todo.html?focus=todo&id=${encodeURIComponent(task.id)}`}));
      const upcoming = arrangements.filter(item => (item.end || item.time) >= hm).sort((a,b) => a.time.localeCompare(b.time))[0];
      next.hidden = config.hidden.includes('agenda'); summary.classList.toggle('has-no-agenda',next.hidden);
      nextLabel.textContent = upcoming ? `${t('Next','接下来')} · ${upcoming.time}` : t('Calendar','日历');
      nextValue.textContent = upcoming?.text || t('No more timed plans','暂无后续定时安排');
      next.href = upcoming?.href || 'calendar.html#today'; next.title = [nextLabel.textContent,nextValue.textContent].join(' · '); next.setAttribute('aria-label',next.title);
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
