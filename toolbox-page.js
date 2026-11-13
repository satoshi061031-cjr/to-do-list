/** Discoverable tools and review, over the existing workspace stores. */
(function () {
  function boot() {
    const host = document.getElementById('toolbox-content');
    if (!host) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const ready = () => window.DailySpaceWorkbenchPreferences?.ready() === true;
    const owner = () => window.DailySpaceView?.owner() || 'guest';
    const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
    const button = (label, run) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', run); return el; };
    const status = document.getElementById('toolbox-status');
    let weekOffset = 0, renderedSignature = '';
    function report(error) { if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(status, error, 'error'); else status.textContent = error.message; }
    const paths = {
      notes: 'M5 3h11l3 3v15H5z M8 10h8 M8 14h8 M8 18h5',
      review: 'M4 20V4 M4 20h16 M8 16v-5 M12 16V7 M16 16v-8',
      focus: 'M12 8v4l3 2 M9 2h6 M12 2v3',
      templates: 'M4 4h7v7H4z M14 4h6v7h-6z M4 14h7v6H4z M14 14h6v6h-6z',
      history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v6l4 2',
      backup: 'M4 15v5h16v-5 M12 16V3 M7 8l5-5 5 5',
      planner: 'M3 4h18v16H3z M9 4v16 M15 4v16 M5 8h2 M11 8h2 M17 8h2',
      mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
      travel: 'M4 7h16v14H4z M8 7V3h8v4 M8 7v14 M16 7v14',
      teamwork: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-4 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 3a4 4 0 0 1 0 8',
      page: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
    };
    function icon(name) {
      const span = node('span', '', 'toolbox-icon'); span.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(key, value);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.page); svg.append(path);
      if (name === 'focus') { const circle = document.createElementNS(svg.namespaceURI, 'circle'); for (const [key,value] of Object.entries({cx:12,cy:13,r:8})) circle.setAttribute(key,value); svg.append(circle); }
      span.append(svg); return span;
    }
    function section(title) { const el = node('section', '', 'toolbox-section'); el.append(node('h2', title)); host.append(el); return el; }
    function card(grid, id, title, description, target) {
      const el = typeof target === 'string' ? node('a') : button('', () => { if (ready()) target(); });
      el.className = 'toolbox-card'; el.dataset.tool = id;
      if (typeof target === 'string') el.href = target; else el.disabled = !ready();
      const copy = node('span'); copy.append(node('strong', title), node('span', description, 'toolbox-card-copy'));
      const arrow = node('span', '›', 'toolbox-arrow'); arrow.setAttribute('aria-hidden', 'true');
      el.append(icon(id), copy, arrow); grid.append(el);
    }
    function command(id) { if (!window.DailySpaceCommand?.execute(`action:${id}`)) report(new Error(t('Workspace is still loading. Please retry.', '工作台正在加载，请重试。'))); }
    function renderTools() {
      const work = section(t('Your everyday tools', '日常工具')), grid = node('div', '', 'toolbox-grid'); work.append(grid);
      let notesCount = '';
      if (ready()) { try { notesCount = String(window.DailySpaceNotes?.list().length || 0); } catch (_) {} }
      card(grid, 'notes', t('Notes', '笔记'), notesCount ? t(`${notesCount} saved · Ideas, references and linked tasks`, `已保存 ${notesCount} 篇 · 想法、资料和关联任务`) : t('Ideas, references and linked tasks', '记录想法、资料，关联任务'), 'notes.html');
      card(grid, 'review', t('Weekly review', '每周复盘'), t('Completions, focus time and unfinished work', '查看完成事项、专注时间和待安排任务'), 'review.html');
      card(grid, 'focus', t('Focus', '专注'), t('Choose one task and start a timer', '选一件事，开始一段专注时间'), () => command('start-focus'));
      card(grid, 'templates', t('Task templates', '任务模板'), t('Create tasks from a routine you have saved', '从已保存的流程快速新建任务'), () => command('templates'));
      const pages = section(t('More from your workspace', '工作与生活')), links = node('div', '', 'toolbox-grid'); pages.append(links);
      for (const [id, en, zh, hint, hintZh] of [
        ['planner', 'Projects', '项目', 'Boards and project cards', '管理看板与项目卡片'], ['mail', 'Mail', '邮箱', 'Connected Google inbox', '查看 Google 邮箱'],
        ['travel', 'Travel', '旅行', 'Trips, bookings and itineraries', '管理旅行、预订与行程'], ['teamwork', 'Teamwork', '协作', 'Shared workspaces and assignments', '共享工作空间与指派'],
      ]) card(links, id, t(en, zh), t(hint, hintZh), `${id}.html`);
      const data = section(t('Data management', '数据管理')), manage = node('div', '', 'toolbox-grid'); data.append(manage);
      card(manage, 'history', t('History & recycle bin', '历史与回收站'), t('Inspect previous versions and recover deleted records', '查看旧版本，恢复已删除记录'), () => window.DailySpaceHistory?.open());
      card(manage, 'backup', t('Import & export', '导入与导出'), t('Download a backup or preview a file before importing', '下载备份，或预览文件后导入'), () => window.DailySpaceWorkspaceTools?.open());
      const settings = section(t('Account & appearance', '账户与外观')), controls = node('div', '', 'toolbox-settings'); settings.append(controls);
      const account = button(t('Account & sync', '账户与同步'), () => document.querySelector('.sidebar-auth-entry')?.click()); account.dataset.toolboxAccount = '';
      const dark = document.documentElement.dataset.theme === 'dark';
      const theme = button(t(dark ? 'Dark appearance' : 'Light appearance', dark ? '深色外观' : '浅色外观'), () => { document.getElementById('theme-toggle')?.click(); render(); }); theme.dataset.toolboxTheme = ''; theme.setAttribute('aria-pressed', String(dark));
      const language = button(t('Language · English', '语言 · 简体中文'), () => document.getElementById('language-toggle')?.click()); language.dataset.toolboxLanguage = '';
      controls.append(account, theme, language);
    }
    function renderReview() {
      const Core = window.DailySpaceFocusCore, Tasks = window.DailySpacePageTasks;
      if (!ready()) { host.append(node('p', t('Your workspace is loading…', '工作台正在加载…'))); return; }
      const data = Core.review(Tasks.getTasks(), JSON.parse(localStorage.getItem(Core.KEY) || 'null'), Core.weekBounds(Date.now(), weekOffset));
      const nav = node('nav', '', 'review-week-nav'); nav.setAttribute('aria-label', t('Review week', '复盘周次'));
      const previous = button('‹', () => { weekOffset = Math.max(-520, weekOffset - 1); render(); }); previous.setAttribute('aria-label', t('Previous week', '上一周'));
      const next = button('›', () => { weekOffset = Math.min(0, weekOffset + 1); render(); }); next.setAttribute('aria-label', t('Next week', '下一周')); next.disabled = weekOffset === 0;
      const current = button(t('This week', '本周'), () => { weekOffset = 0; render(); }); current.hidden = weekOffset === 0;
      const range = node('span', `${data.start} — ${data.end}`); range.dataset.reviewRange = ''; previous.dataset.reviewNav = 'previous'; next.dataset.reviewNav = 'next'; current.dataset.reviewNav = 'current'; nav.append(previous, range, next, current); host.append(nav);
      const metrics = node('dl', '', 'review-metrics');
      for (const [key, label, value] of [['completed', weekOffset === 0 ? t('Completed this week', '本周完成') : t('Completed in selected week', '该周完成'), data.completedTasks.length], ['focus', t('Recorded focus', '已记录专注'), t(`${Math.round(data.focusMs / 60000)} min`, `${Math.round(data.focusMs / 60000)} 分钟`)], ['overdue', t('Still overdue', '仍然逾期'), data.overdueTasks.length], ['inbox', t('Inbox now', '当前待整理'), data.inboxCount]]) {
        const wrap = node('div'), valueEl = node('dd', String(value)); valueEl.dataset.reviewMetric = key; wrap.append(node('dt', label), valueEl); metrics.append(wrap);
      }
      host.append(metrics); const columns = node('div', '', 'review-columns'); host.append(columns);
      const who = owner();
      for (const [key, title, tasks, empty] of [['completed', t('Completed', '已完成'), data.completedTasks.sort((a,b) => b.completedAt-a.completedAt), t('No recorded completions this week.', '本周还没有已记录的完成事项。')], ['overdue', t('Arrange unfinished tasks', '安排未完成任务'), data.overdueTasks.sort((a,b) => a.dueDate.localeCompare(b.dueDate)), t('No unfinished overdue tasks.', '没有尚未完成的逾期任务。')]]) {
        const block = node('section', '', 'toolbox-section'), list = node('ul', '', 'review-list'); list.dataset.reviewList = key; block.append(node('h2', title), list); columns.append(block);
        for (const task of tasks) {
          const row = node('li'), link = node('a', task.text); link.href = `${window.matchMedia('(max-width: 819px)').matches ? 'todo-m.html' : 'todo.html'}?focus=todo&id=${encodeURIComponent(task.id)}`; row.append(link);
          if (key === 'overdue') { const move = button(t('Today', '移到今天'), () => { if (!ready() || owner() !== who) return; try { Tasks.moveToToday(task.id); render(); const next = host.querySelector('[data-review-today]') || host.querySelector('[data-review-list=overdue]'); if (next) { next.tabIndex = -1; next.focus({ preventScroll: true }); } } catch (error) { report(error); } }); move.dataset.reviewToday = task.id; move.setAttribute('aria-label', `${t('Move to today', '移到今天')} · ${task.text}`); row.append(move); }
          list.append(row);
        }
        if (!tasks.length) list.append(node('li', empty, 'review-empty'));
      }
      host.append(node('p', t('Completion and focus use recorded dates. Older tasks without a completion date are excluded. Overdue work and Inbox show their current state.', '完成与专注按实际记录日期统计；没有完成日期的旧任务不计入。逾期任务与待整理数量显示当前状态。'), 'review-help'));
    }
    function render() {
      let signature = '';
      try { const review = document.body.classList.contains('review-page'); signature = JSON.stringify([owner(), ready(), window.DailySpaceI18n?.locale(), document.documentElement.dataset.theme, window.DailySpaceFocusCore.localDate(), weekOffset, ready() ? (review ? [localStorage.getItem('todo-app-v2'), localStorage.getItem('dayfly-focus-v1')] : localStorage.getItem('dayfly-notes-v1')) : null]); } catch (_) {}
      if (signature && signature === renderedSignature) return;
      renderedSignature = signature;
      const focused = document.activeElement?.closest('[data-tool],[data-toolbox-theme],[data-toolbox-language],[data-toolbox-account],[data-review-nav]');
      const selector = focused?.hasAttribute('data-toolbox-account') ? '[data-toolbox-account]' : focused?.dataset.reviewNav ? `[data-review-nav="${focused.dataset.reviewNav}"]` : focused?.dataset.tool ? `[data-tool="${focused.dataset.tool}"]` : focused?.hasAttribute('data-toolbox-theme') ? '[data-toolbox-theme]' : focused?.hasAttribute('data-toolbox-language') ? '[data-toolbox-language]' : null;
      host.replaceChildren(); status.textContent = '';
      const review = document.body.classList.contains('review-page');
      document.getElementById('toolbox-title').textContent = review ? t('Weekly review', '每周复盘') : t('Toolbox', '工具箱');
      document.title = `${document.getElementById('toolbox-title').textContent} · dayfly`;
      document.getElementById('toolbox-description').textContent = review ? t('Make room for what comes next.', '回看这一周，为下一步留出空间。') : t('A place for ideas, progress and the tools you need.', '想法、进展和日常工具，都在这里。');
      try { if (review) renderReview(); else renderTools(); } catch (error) { report(error); }
      if (selector) { const target = host.querySelector(selector); (target && !target.hidden && !target.disabled ? target : host.querySelector('[data-review-nav=previous]'))?.focus({ preventScroll: true }); }
    }
    for (const event of ['daily-space-user-sync-updated', 'daily-space-auth-updated', 'daily-space-agent-data-updated', 'daily-space-notes-updated', 'daily-space-locale-changed', 'storage']) window.addEventListener(event, render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.addEventListener('focus', render);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
