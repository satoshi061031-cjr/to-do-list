/** Desktop summaries over the existing personal workbench stores. */
(function () {
  function boot() {
    const shell = document.querySelector('.today-shell');
    const Preferences = window.DailySpaceWorkbenchPreferences;
    const api = window.DailySpaceTodo;
    if (!shell || !Preferences || !api || document.body.classList.contains('todo-mobile')) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const owner = () => window.DailySpaceView.owner();
    const media = matchMedia('(min-width: 820px)');
    const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
    const root = node('section', 'workbench-desktop-overview'); root.hidden = true; root.dataset.i18nIgnore = '';
    const grid = node('div', 'workbench-overview-grid'); root.append(grid);
    shell.querySelector('.workbench-sections').before(root);
    const taskCard = node('section', 'overview-task-card');
    const taskTitle = node('h2'), taskCount = node('strong', 'overview-task-count'), taskCaption = node('span', 'overview-task-caption');
    const taskMeta = node('div', 'overview-task-meta');
    const metrics = ['done','due','overdue'].map(id => { const el = node('div'), value = node('strong'), label = node('span'); el.dataset.overviewMetric = id; el.append(value,label); taskMeta.append(el); return {value,label}; });
    const progress = node('div', 'overview-progress'), fill = node('span'); progress.append(fill); progress.setAttribute('role','progressbar'); progress.setAttribute('aria-valuemin','0'); progress.setAttribute('aria-valuemax','100');
    taskCard.append(taskTitle,taskCount,taskCaption,taskMeta,progress);
    const agendaCard = node('section', 'overview-agenda-card'), agendaTitle = node('h2'), agendaTime = node('time', 'overview-agenda-time'), agendaLink = node('a','overview-agenda-link'), agendaNote = node('p','overview-agenda-note');
    agendaCard.append(agendaTitle,agendaTime,agendaLink,agendaNote);
    const focusCard = node('section','overview-focus-card'), focusKicker = node('p','overview-focus-kicker'), ghost = node('img','overview-focus-ghost'), focusTitle = node('h2','overview-focus-title'), focusMeta = node('p','overview-focus-meta'), focusOpen = node('button','overview-focus-open');
    ghost.src = 'welcome-sticker.png'; ghost.alt = ''; ghost.setAttribute('aria-hidden','true'); ghost.width = 56; ghost.height = 56;
    focusOpen.type = 'button'; focusCard.append(focusKicker,ghost,focusTitle,focusMeta,focusOpen);
    const band = node('section','overview-detail-band'), spendLink = node('a','overview-spend-link'), spendLabel = node('span'), spendAmount = node('strong'), quickLinks = node('div','overview-quick-links');
    spendLink.href = 'tally.html'; spendLink.append(spendLabel,spendAmount); band.append(spendLink,quickLinks);
    grid.append(taskCard,agendaCard,focusCard,band);
    const tools = {planner:['Projects','项目','planner.html'],mail:['Mail','邮箱','mail.html'],tally:['Tally','记账','tally.html'],travel:['Travel','旅行','travel.html'],calendar:['Calendar','日历','calendar.html']};
    let focusId = null, renderOwner = '', linksSignature = '', queued = false;
    focusOpen.addEventListener('click', () => {
      if (!Preferences.ready() || owner() !== renderOwner) return;
      if (focusId && api.getTasks().some(task => task.id === focusId && !task.completed)) {
        window.DailySpaceTaskDetails?.open?.(focusId);
      } else document.getElementById('todo-input')?.focus();
    });
    function render() {
      root.hidden = !media.matches || !Preferences.ready();
      if (root.hidden) { focusId = null; renderOwner = ''; focusTitle.textContent = ''; spendAmount.textContent = ''; return; }
      renderOwner = owner();
      const config = Preferences.read(), tasks = api.getTasks(), stats = window.DailySpaceLoop.getTodayStats();
      taskTitle.textContent = t('Today at a glance','今天概览');
      taskCount.textContent = String(stats.dueTodayOpen);
      taskCaption.textContent = t('tasks left today','项今日待办');
      const labels = [t('Completed','已完成'),t('Due today','今日到期'),t('Overdue','逾期')];
      [stats.dueTodayDone,stats.dueTodayTotal,stats.overdueOpen].forEach((value,index) => { metrics[index].value.textContent = String(value); metrics[index].label.textContent = labels[index]; });
      const percentage = stats.dueTodayTotal ? Math.round(stats.dueTodayDone / stats.dueTodayTotal * 100) : 0;
      fill.style.width = `${percentage}%`; progress.setAttribute('aria-valuenow',String(percentage)); progress.setAttribute('aria-label',t('Today’s task progress','今日任务进度')); progress.setAttribute('aria-valuetext',`${stats.dueTodayDone} / ${stats.dueTodayTotal}`);
      const now = new Date(), hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const appointments = stats.remindersToday.filter(item => item.startTime && !tasks.some(task => task.sourceReminderId === item.id && task.completed)).map(item => ({text:item.text,time:item.startTime,end:item.endTime,href:`calendar.html?focus=reminder&id=${encodeURIComponent(item.id)}`}));
      tasks.filter(task => !task.completed && !task.sourceReminderId && task.dueDate === stats.today && task.dueTime).forEach(task => appointments.push({text:task.text,time:task.dueTime,href:`todo.html?focus=todo&id=${encodeURIComponent(task.id)}`}));
      const next = appointments.filter(item => (item.end || item.time) >= hm).sort((a,b) => a.time.localeCompare(b.time))[0];
      agendaTitle.textContent = t('Next today','接下来的安排'); agendaTime.hidden = !next;
      agendaTime.textContent = next?.time || ''; if (next) agendaTime.dateTime = `${stats.today}T${next.time}`;
      agendaLink.textContent = next?.text || t('Open calendar','打开日历'); agendaLink.href = next?.href || 'calendar.html';
      agendaNote.textContent = next ? new Date().toLocaleDateString(window.DailySpaceI18n?.localeTag() || 'en-US',{weekday:'long',month:'short',day:'numeric'}) : t('No more timed arrangements today.','今天没有更多定时安排。');
      const candidate = tasks.filter(task => !task.completed && (!task.dueDate || task.dueDate <= stats.today)).sort((a,b) => (a.dueDate || stats.today).localeCompare(b.dueDate || stats.today) || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99'))[0];
      focusId = candidate?.id || null; focusKicker.textContent = t('One thing at a time','一次专注一件事');
      focusTitle.textContent = candidate?.text || t('A little room for what matters','给重要的事留一点空间');
      focusMeta.textContent = candidate ? [candidate.dueDate && candidate.dueDate < stats.today ? t('Overdue','逾期') : t('Your next step','下一步'),candidate.dueTime].filter(Boolean).join(' · ') : t('Add a task when you’re ready.','准备好了，就记录下一件事。');
      focusOpen.textContent = candidate ? t('Open task','打开任务') : t('New task','新建任务');
      const state = window.DailySpaceTallyCore.readState();
      const amount = state.records.filter(record => record.date === stats.today && record.scope !== 'shared').reduce((sum,record) => sum + window.DailySpaceTallyCore.baseAmount(record),0);
      spendLabel.textContent = t('Today’s spending','今日支出'); spendAmount.textContent = window.DailySpaceTallyCore.formatAmount(state,amount,state.baseCurrency);
      const signature = JSON.stringify([config.shortcuts,window.DailySpaceI18n?.locale()]);
      if (signature !== linksSignature) {
        linksSignature = signature; quickLinks.replaceChildren(...config.shortcuts.map(id => { const tool = tools[id], link = node('a','',t(tool[0],tool[1])); link.href = tool[2]; return link; }));
      }
      agendaCard.hidden = config.hidden.includes('agenda'); spendLink.hidden = config.hidden.includes('spend'); quickLinks.hidden = config.hidden.includes('shortcuts') || !config.shortcuts.length;
      band.hidden = spendLink.hidden && quickLinks.hidden;
      root.dataset.showAgenda = String(!agendaCard.hidden); root.dataset.showSpend = String(!spendLink.hidden); root.dataset.showShortcuts = String(!quickLinks.hidden);
      // Card order follows the saved auxiliary section order; the action list stays below the overview.
      const order = config.sections.filter(id => id === 'spend' || id === 'shortcuts');
      order.forEach((id,index) => { const el = id === 'spend' ? spendLink : quickLinks; if (band.children[index] !== el) band.insertBefore(el,band.children[index] || null); });
    }
    function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }
    for (const event of ['daily-space-workbench-updated','daily-space-agent-data-updated','daily-space-todo-view-updated','daily-space-user-sync-updated','daily-space-auth-updated','daily-space-locale-changed','storage']) window.addEventListener(event,schedule);
    media.addEventListener('change',schedule); document.addEventListener('visibilitychange',() => { if (!document.hidden) schedule(); });
    setInterval(() => { if (!document.hidden) schedule(); },60000);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
