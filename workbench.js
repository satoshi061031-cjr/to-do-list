/** A personal home over the existing stores; tasks keep their original controls. */
(function () {
  function boot() {
    const Preferences = window.DailySpaceWorkbenchPreferences;
    const api = window.DailySpaceTodo;
    const shell = document.querySelector('.today-shell, .m-shell');
    if (!Preferences || !api || !shell) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const locale = () => window.DailySpaceI18n?.localeTag() || 'en-US';
    const owner = () => window.DailySpaceView.owner();
    const node = (tag, text = '', cls = '') => {
      const el = document.createElement(tag);
      el.textContent = text;
      if (cls) el.className = cls;
      return el;
    };
    const action = (text, run) => {
      const button = node('button', text);
      button.type = 'button'; button.addEventListener('click', run);
      return button;
    };
    const reorder = (container, change) => window.DailySpaceLayoutMotion?.run ? window.DailySpaceLayoutMotion.run(container, change) : change();
    function applyLayoutChange(change) {
      const motion = window.DailySpaceLayoutMotion;
      const snapshots = motion ? [document.querySelector('.workbench-sections'), document.querySelector('.workbench-overview-grid')].filter(Boolean).map(container => motion.capture(container)) : [];
      const result = change(); snapshots.forEach(snapshot => motion.play(snapshot)); return result;
    }
    const labels = {
      agenda: ['Next today', '接下来的安排'], tasks: ['Tasks', '任务'],
      shortcuts: ['Quick access', '常用入口'], spend: ['Today’s spending', '今日支出'], travel: ['Travel today', '今日旅行'],
    };
    const tools = {
      planner: ['Projects', '项目', 'planner.html'], mail: ['Mail', '邮箱', 'mail.html'],
      tally: ['Tally', '记账', 'tally.html'], travel: ['Travel', '旅行', 'travel.html'], calendar: ['Calendar', '日历', 'calendar.html'],
    };
    const sectionLabel = id => t(...labels[id]);
    document.body.classList.add('personal-workbench');
    const title = shell.querySelector('[data-page-header] h1');
    title.dataset.i18nIgnore = '';
    const intro = node('p', '', 'workbench-intro'); intro.dataset.i18nIgnore = '';
    title.after(intro);
    const contextBar = node('label', '', 'workbench-context-bar'), contextLabel = node('span'), contextSelect = node('select');
    contextBar.dataset.i18nIgnore = ''; contextSelect.dataset.workbenchContext = ''; contextBar.append(contextLabel, contextSelect); intro.after(contextBar);
    contextSelect.addEventListener('change', () => {
      try { applyLayoutChange(() => Preferences.applyContext(contextSelect.value)); }
      catch (_) { contextSelect.value = Preferences.read().activeContext || ''; }
    });
    let desktopDate = null;
    if (!document.body.classList.contains('todo-mobile')) {
      const progress = shell.querySelector('#daily-loop-progress');
      const context = node('div', '', 'workbench-header-context');
      desktopDate = node('time', '', 'workbench-date'); desktopDate.dataset.i18nIgnore = '';
      progress.before(context); context.append(desktopDate, progress);
    }
    const sections = node('div', '', 'workbench-sections');
    const taskSection = shell.querySelector('[data-module-id=tasks]');
    taskSection.before(sections);
    taskSection.dataset.workbenchSection = 'tasks';
    sections.append(taskSection);
    const phoneControls = shell.querySelector('.m-task-controls');
    if (phoneControls) taskSection.prepend(phoneControls);
    // The full reminder list follows the task list. Its existing IDs and handlers stay intact.
    const dailyLoop = document.getElementById('daily-loop');
    if (dailyLoop) taskSection.append(dailyLoop);
    const blocks = { tasks: taskSection };
    for (const id of ['agenda', 'shortcuts', 'spend', 'travel']) {
      const section = node('section', '', `workbench-block workbench-${id}`);
      section.dataset.workbenchSection = id; section.dataset.i18nIgnore = '';
      blocks[id] = section; sections.append(section);
    }
    const agendaLabel = node('h2'), agendaLink = node('a', '', 'workbench-agenda-link');
    blocks.agenda.append(agendaLabel, agendaLink);
    const shortcutLabel = node('h2'), shortcutLinks = node('div', '', 'workbench-shortcuts');
    blocks.shortcuts.append(shortcutLabel, shortcutLinks);
    const spendLink = node('a', '', 'workbench-spend-link'), spendLabel = node('span'), spendAmount = node('strong');
    spendLink.href = 'tally.html'; spendLink.append(spendLabel, spendAmount); blocks.spend.append(spendLink);
    const tripLink = document.getElementById('daily-loop-travel');
    if (tripLink) blocks.travel.append(tripLink);
    let shortcutSignature = '', queued = false;
    function render() {
      const config = Preferences.read();
      contextBar.hidden = !Preferences.ready() || !(config.contexts || []).some(item => item.id !== 'default');
      contextLabel.textContent = t('Workspace', '工作台场景');
      const contextOptions = [['', t('Default', '默认')], ...(config.contexts || []).filter(item => item.id !== 'default').map(item => [item.id, item.name])];
      const contextSignature = JSON.stringify(contextOptions);
      if (contextSelect.dataset.options !== contextSignature) {
        contextSelect.dataset.options = contextSignature;
        contextSelect.replaceChildren(...contextOptions.map(([id, label]) => new Option(label, id)));
      }
      contextSelect.value = config.activeContext || '';
      if (desktopDate) desktopDate.textContent = new Date().toLocaleDateString(locale(), {weekday:'long',month:'long',day:'numeric'});
      title.textContent = config.name || t('My workbench', '我的工作台');
      intro.hidden = !config.displayName;
      intro.textContent = config.displayName ? t(`A space for ${config.displayName}`, `${config.displayName}的专属空间`) : '';
      const focused = document.activeElement;
      config.sections.forEach((id, index) => {
        const block = blocks[id];
        if (sections.children[index] !== block) sections.insertBefore(block, sections.children[index] || null);
        block.hidden = config.hidden.includes(id);
      });
      if (focused?.isConnected && sections.contains(focused) && document.activeElement !== focused) focused.focus({preventScroll:true});
      settingsButton.disabled = !Preferences.ready();
      if (!Preferences.ready()) {
        for (const id of ["agenda", "shortcuts", "spend", "travel"]) blocks[id].hidden = true;
        agendaLink.textContent = ""; spendAmount.textContent = "";
        return;
      }
      const stats = window.DailySpaceLoop.getTodayStats();
      const tasks = api.getTasks();
      const now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const reminders = stats.remindersToday.filter(item => !tasks.some(task => task.sourceReminderId === item.id && task.completed));
      const appointments = reminders.filter(item => item.startTime).map(item => ({ text: item.text, time: item.startTime, end: item.endTime, href: `calendar.html?focus=reminder&id=${encodeURIComponent(item.id)}` }));
      tasks.filter(task => !task.completed && !task.sourceReminderId && task.dueDate === stats.today && task.dueTime).forEach(task => appointments.push({ text: task.text, time: task.dueTime, href: `${document.body.classList.contains('todo-mobile') ? 'todo-m.html' : 'todo.html'}?focus=todo&id=${encodeURIComponent(task.id)}` }));
      const next = appointments.filter(item => (item.end || item.time) >= hm).sort((a,b) => a.time.localeCompare(b.time))[0];
      agendaLabel.textContent = sectionLabel('agenda');
      blocks.agenda.hidden = config.hidden.includes('agenda') || !next;
      if (next) { agendaLink.textContent = `${next.time} · ${next.text}`; agendaLink.href = next.href; }
      shortcutLabel.textContent = sectionLabel('shortcuts');
      const external = Preferences.getBookmarks(config);
      const signature = JSON.stringify([config.shortcuts, external, locale()]);
      if (signature !== shortcutSignature) {
        shortcutSignature = signature;
        shortcutLinks.replaceChildren(...config.shortcuts.map(id => {
          const tool = tools[id], link = node('a', t(tool[0], tool[1]));
          link.href = tool[2]; const arrow = node('span'); arrow.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>'; link.append(arrow); return link;
        }), ...external.map(item => {
          const link = node('a', '', 'workbench-external-link'), copy = node('span', '', 'workbench-external-copy');
          const label = node('strong', `${item.icon ? `${item.icon} ` : ''}${item.title}`); copy.append(label);
          if (item.group) copy.append(node('small', item.group));
          link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.dataset.bookmarkId = item.id;
          link.title = [item.title, item.group, item.tags.join(', ')].filter(Boolean).join(' · ');
          const arrow = node('span', '↗'); arrow.setAttribute('aria-hidden', 'true'); link.append(copy, arrow); return link;
        }));
      }
      blocks.shortcuts.hidden = config.hidden.includes('shortcuts') || (!config.shortcuts.length && !external.length);
      const state = window.DailySpaceTallyCore.readState();
      const amount = state.records.filter(record => record.date === stats.today && record.scope !== 'shared').reduce((sum,record) => sum + window.DailySpaceTallyCore.baseAmount(record), 0);
      spendLabel.textContent = sectionLabel('spend');
      spendAmount.textContent = window.DailySpaceTallyCore.formatAmount(state, amount, state.baseCurrency);
      blocks.travel.hidden = config.hidden.includes('travel') || !stats.tripsToday.length;
      if (tripLink) {
        tripLink.querySelector('.daily-loop-reminders-label').textContent = sectionLabel('travel');
        tripLink.querySelector('.daily-loop-reminders-link').textContent = t('Open Travel', '打开旅行');
      }
      settingsButton.disabled = !Preferences.ready();
    }
    function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }

    const settingsButton = action('', () => open());
    settingsButton.className = 'workbench-settings-toggle';
    settingsButton.dataset.workbenchSettings = '';
    settingsButton.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="10" cy="18" r="2" fill="var(--surface)"/></svg>';
    const cluster = shell.querySelector('.page-action-cluster');
    cluster.insertBefore(settingsButton, cluster.querySelector('.workspace-agent-button'));
    // The Agent module owns its trailing position even when actions are added later.
    const ghost = cluster.querySelector('#m-agent-toggle, #daily-loop-focus, .global-agent-trigger');
    if (ghost) cluster.append(ghost);

    const root = node('div', '', 'workbench-settings');
    root.id = 'workbench-settings'; root.hidden = true; root.dataset.dialogRoot = ''; root.dataset.i18nIgnore = '';
    const backdrop = action('', () => close()); backdrop.className = 'workbench-settings-backdrop';
    const panel = node('section', '', 'workbench-settings-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'workbench-settings-title');
    const head = node('header'), heading = node('h2'); heading.id = 'workbench-settings-title';
    const dismiss = action('×', () => close()); dismiss.dataset.dialogClose = ''; head.append(heading, dismiss);
    const form = node('form', '', 'workbench-settings-form'); form.id = 'workbench-settings-form'; form.noValidate = true;
    const content = node('div', '', 'workbench-settings-body'), error = node('p', '', 'workbench-settings-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const footer = node('footer', '', 'workbench-settings-footer'), save = node('button'); save.type = 'submit'; save.className = 'btn btn-primary'; save.setAttribute('form', form.id); footer.append(save);
    form.append(content); panel.append(head, form, error, footer); root.append(backdrop, panel); document.body.append(root);
    window.DailySpaceDialogHistory.fitViewport(root);
    const motion = window.DailySpaceDialogHistory.motion(root);
    const sheetHistory = window.DailySpaceDialogHistory.create('workbench-settings', { isOpen: () => !root.hidden && !motion.closing, restore: () => open(false), close: () => close(true) });
    let draft = null, draftOwner = '', baseline = '', nameInput, displayInput, bookmarkRows, externalDetails, widgetRows, wideSelect, phoneOverviewSelect;
    const sectionRows = node('div', '', 'workbench-section-options');
    function remember() {
      if (!draft || draftOwner !== owner()) return;
      draft.name = nameInput.value; draft.displayName = displayInput.value;
      if (phoneOverviewSelect && (typeof draft.phoneOverviewExpanded === 'boolean' || phoneOverviewSelect.value === 'expanded')) draft.phoneOverviewExpanded = phoneOverviewSelect.value === 'expanded';
      draft.shortcuts = [...content.querySelectorAll('[name=shortcut]:checked')].map(input => input.value);
      if (bookmarkRows) draft.bookmarks = [...bookmarkRows.children].map(row => {
        const value = { id: row.dataset.bookmarkRow };
        for (const input of row.querySelectorAll('[data-bookmark-field]')) value[input.dataset.bookmarkField] = input.type === 'checkbox' ? input.checked : input.value;
        value.tags = value.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean); return value;
      });
      if (wideSelect && draft.desktopLayout) draft.desktopLayout = { ...Preferences.desktopLayout(draft.desktopLayout), wide: wideSelect.value };
    }
    function close(fromHistory = false, immediate = false) {
      if (motion.closing && !immediate) return;
      remember(); motion.close(() => document.body.classList.remove('workspace-tool-open'), immediate);
      if (!fromHistory) sheetHistory.back();
    }
    function sectionOptions() {
      sectionRows.replaceChildren();
      draft.sections.forEach((id,index) => {
        const row = node('div', '', 'workbench-section-option'), label = node('label'), checkbox = node('input');
        row.dataset.motionKey = `section:${id}`;
        checkbox.type = 'checkbox'; checkbox.dataset.sectionVisibility = id; checkbox.checked = !draft.hidden.includes(id); checkbox.disabled = id === 'tasks';
        label.append(checkbox, node('span', sectionLabel(id)));
        checkbox.addEventListener('change', () => { draft.hidden = checkbox.checked ? draft.hidden.filter(value => value !== id) : [...new Set([...draft.hidden,id])]; });
        row.append(label);
        for (const [delta,direction,symbol] of [[-1,'up','↑'],[1,'down','↓']]) {
          const move = action(symbol, () => {
            remember(); reorder(sectionRows, () => {
              [draft.sections[index],draft.sections[index + delta]] = [draft.sections[index + delta],draft.sections[index]];
              sectionOptions();
              const same = sectionRows.querySelector(`[data-section-${direction}="${id}"]`);
              const opposite = sectionRows.querySelector(`[data-section-${direction === 'up' ? 'down' : 'up'}="${id}"]`);
              (same?.disabled ? opposite : same)?.focus({preventScroll:true});
            });
          });
          move.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${direction === 'up' ? 'M12 19V5m-6 6 6-6 6 6' : 'M12 5v14m-6-6 6 6 6-6'}"/></svg>`;
          move.dataset[direction === 'up' ? 'sectionUp' : 'sectionDown'] = id;
          move.setAttribute('aria-label', `${t(direction === 'up' ? 'Move up' : 'Move down', direction === 'up' ? '上移' : '下移')} · ${sectionLabel(id)}`);
          move.disabled = index + delta < 0 || index + delta >= draft.sections.length; row.append(move);
        }
        sectionRows.append(row);
      });
    }
    function bookmarkOptions() {
      if (!bookmarkRows) return;
      bookmarkRows.replaceChildren();
      (draft.bookmarks || []).forEach((item, index) => {
        const row = node('fieldset', '', 'workbench-bookmark-row'); row.dataset.bookmarkRow = item.id;
        const legend = node('legend', t(`Website ${index + 1}`, `网站 ${index + 1}`));
        const enabledLabel = node('label', '', 'workbench-bookmark-enabled'), enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = item.enabled !== false; enabled.dataset.bookmarkField = 'enabled'; enabledLabel.append(enabled, node('span', t('Show on workbench', '在工作台显示')));
        row.append(legend, enabledLabel);
        for (const [field, en, zh, max, type] of [['title', 'Name', '名称', 60, 'text'], ['url', 'Website URL', '网站地址', 2000, 'url'], ['group', 'Group (optional)', '分组（可选）', 40, 'text'], ['tags', 'Tags, separated by commas', '标签，用逗号分隔', 250, 'text'], ['icon', 'Icon or initials (optional)', '图标或缩写（可选）', 8, 'text']]) {
          const label = node('label', t(en, zh)), input = node('input'); input.type = type; input.maxLength = max; input.dataset.bookmarkField = field;
          input.value = field === 'tags' ? (item.tags || []).join(', ') : item[field] || ''; input.autocomplete = 'off';
          if (field === 'url') { input.placeholder = 'https://'; input.inputMode = 'url'; input.spellcheck = false; }
          label.append(input); row.append(label);
        }
        const actions = node('div', '', 'workbench-bookmark-actions');
        for (const [delta, en, zh] of [[-1, 'Move up', '上移'], [1, 'Move down', '下移']]) {
          const move = action(t(en, zh), () => { remember(); [draft.bookmarks[index], draft.bookmarks[index + delta]] = [draft.bookmarks[index + delta], draft.bookmarks[index]]; bookmarkOptions(); bookmarkRows.children[index + delta]?.querySelector('[data-bookmark-field=title]')?.focus({preventScroll: true}); });
          move.disabled = index + delta < 0 || index + delta >= draft.bookmarks.length; actions.append(move);
        }
        const remove = action(t('Remove', '移除'), () => { remember(); draft.bookmarks.splice(index, 1); bookmarkOptions(); externalDetails.querySelector('[data-bookmark-add]')?.focus({preventScroll:true}); });
        remove.dataset.bookmarkRemove = item.id; actions.append(remove); row.append(actions); bookmarkRows.append(row);
      });
      const add = externalDetails.querySelector('[data-bookmark-add]'); if (add) add.disabled = (draft.bookmarks || []).length >= 40;
    }
    function validateBookmarks() {
      for (const [index, item] of (draft.bookmarks || []).entries()) {
        const field = !item.title.trim() ? 'title' : !Preferences.safeUrl(item.url) ? 'url' : null;
        if (!field) continue;
        externalDetails.open = true; bookmarkRows.children[index]?.querySelector(`[data-bookmark-field=${field}]`)?.focus();
        throw new Error('bookmarks');
      }
    }
    function widgetOptions() {
      widgetRows.replaceChildren();
      const layout = Preferences.desktopLayout(draft.desktopLayout), labels = { tasks: t('Tasks', '任务'), agenda: t('Next arrangement', '下一项安排'), focus: t('Focus', '专注'), detail: t('Spending & links', '支出与入口') };
      layout.order.forEach((id, index) => {
        const row = node('div', '', 'workbench-section-option'); row.dataset.motionKey = `widget:${id}`; row.append(node('span', labels[id]));
        for (const [delta, symbol, en, zh] of [[-1, '↑', 'Move up', '上移'], [1, '↓', 'Move down', '下移']]) {
          const move = action(symbol, () => { remember(); reorder(widgetRows, () => { const value = Preferences.desktopLayout(draft.desktopLayout); [value.order[index], value.order[index + delta]] = [value.order[index + delta], value.order[index]]; draft.desktopLayout = value; widgetOptions(); widgetRows.querySelector(`[data-widget-${delta < 0 ? 'down' : 'up'}="${id}"]`)?.focus({preventScroll:true}); }); });
          move.setAttribute('aria-label', `${t(en,zh)} · ${labels[id]}`); move.dataset[delta < 0 ? 'widgetUp' : 'widgetDown'] = id; move.disabled = index + delta < 0 || index + delta >= layout.order.length; row.append(move);
        }
        widgetRows.append(row);
      });
    }
    function open(push = true) {
      if (!Preferences.ready() || (push && !sheetHistory.push({}))) return;
      const current = JSON.stringify(Preferences.read());
      if (!draft || draftOwner !== owner() || baseline !== current) { draft = structuredClone(Preferences.read()); baseline = current; }
      draftOwner = owner(); content.replaceChildren(); error.hidden = true;
      heading.textContent = t('Customize workbench', '自定义工作台'); save.textContent = t('Save', '保存'); dismiss.setAttribute('aria-label', t('Close', '关闭')); backdrop.setAttribute('aria-label', t('Close', '关闭'));
      const nameLabel = node('label', t('Workbench name', '工作台名称'));
      nameInput = node('input'); nameInput.name = 'name'; nameInput.maxLength = 40; nameInput.value = draft.name; nameInput.placeholder = t('My workbench', '我的工作台'); nameLabel.append(nameInput);
      const displayLabel = node('label', t('Your name', '你的称呼'));
      displayInput = node('input'); displayInput.name = 'displayName'; displayInput.maxLength = 40; displayInput.value = draft.displayName; displayInput.autocomplete = 'nickname'; displayLabel.append(displayInput);
      const phoneOverviewLabel = node('label', t('Phone overview', '手机概览'));
      phoneOverviewSelect = node('select'); phoneOverviewSelect.name = 'phoneOverview'; phoneOverviewSelect.dataset.phoneOverviewPreference = '';
      phoneOverviewSelect.append(new Option(t('Compact summary', '紧凑摘要'),'compact'),new Option(t('Expanded widgets', '展开小组件'),'expanded'));
      phoneOverviewSelect.value = draft.phoneOverviewExpanded === true ? 'expanded' : 'compact'; phoneOverviewLabel.append(phoneOverviewSelect);
      const sectionsTitle = node('h3', t('Home sections', '首页区块'));
      sectionOptions();
      const note = node('p', t('Tasks stay visible. Use the arrows to change the order.', '任务始终显示，使用箭头调整区块顺序。'));
      const shortcutsTitle = node('h3', t('Quick access · up to 4', '常用入口 · 最多 4 个'));
      const choices = node('div', '', 'workbench-tool-options');
      for (const [id,tool] of Object.entries(tools)) {
        const label = node('label'), input = node('input'); input.type = 'checkbox'; input.name = 'shortcut'; input.value = id; input.checked = draft.shortcuts.includes(id); label.append(input, node('span',t(tool[0],tool[1]))); choices.append(label);
      }
      content.append(nameLabel, displayLabel, phoneOverviewLabel, sectionsTitle, sectionRows, note, shortcutsTitle, choices);
      externalDetails = node('details', '', 'workbench-bookmark-settings'); externalDetails.append(node('summary', t('External websites', '外部网站')));
      externalDetails.append(node('p', t('Add your own tools. Links open in a new tab; icons stay on-device.', '收藏你常用的工具。链接在新标签页打开，图标无需外部加载。')));
      bookmarkRows = node('div', '', 'workbench-bookmark-rows');
      const addWebsite = action(t('＋ Add website', '＋ 添加网站'), () => {
        remember(); if ((draft.bookmarks || []).length >= 40) return;
        draft.bookmarks = [...(draft.bookmarks || []), { id: crypto.randomUUID(), title: '', url: '', group: '', tags: [], icon: '', enabled: true }];
        bookmarkOptions(); bookmarkRows.lastElementChild?.querySelector('[data-bookmark-field=title]')?.focus();
      }); addWebsite.dataset.bookmarkAdd = ''; externalDetails.append(bookmarkRows, addWebsite); content.append(externalDetails); bookmarkOptions();
      const widgets = node('details', '', 'workbench-widget-settings'); widgets.append(node('summary', t('Desktop widgets', '桌面小组件')));
      widgets.append(node('p', t('Choose the reading order and one larger widget. Phone sections keep their own order.', '调整阅读顺序，并选择一个较宽的组件。手机区块使用上面的独立顺序。')));
      widgetRows = node('div'); widgets.append(widgetRows); widgetOptions();
      const wideLabel = node('label', t('Larger widget', '较宽的组件')); wideSelect = node('select'); wideSelect.dataset.widgetWide = '';
      for (const [id, en, zh] of [['tasks','Tasks','任务'],['agenda','Next arrangement','下一项安排'],['focus','Focus','专注']]) wideSelect.add(new Option(t(en, zh), id));
      wideSelect.value = Preferences.desktopLayout(draft.desktopLayout).wide; wideLabel.append(wideSelect); widgets.append(wideLabel); content.append(widgets);
      wideSelect.addEventListener('change', () => { draft.desktopLayout = { ...Preferences.desktopLayout(draft.desktopLayout), wide: wideSelect.value }; });
      const contexts = node('details', '', 'workbench-context-settings'); contexts.append(node('summary', t('Work, life & travel layouts', '工作、生活与旅行布局')));
      const contextStatus = node('p'); contextStatus.setAttribute('role','status');
      contexts.append(node('p', t('Save these sections, links and widget choices as a layout. Task data stays shared.', '把当前区块、入口和小组件配置存为场景，任务数据继续共用。')));
      const contextActions = node('div', '', 'workbench-context-actions');
      for (const [id, en, zh] of [['work','Work','工作'],['life','Life','生活'],['travel','Travel','旅行']]) {
        const capture = action(t(`Save as ${en}`, `存为${zh}场景`), () => {
          remember(); try {
            validateBookmarks();
            if (!(draft.contexts || []).some(item => item.id === 'default')) {
              const initial = Preferences.captureContext(Preferences.read(), 'default', t('Default','默认'));
              draft.contexts = [...(draft.contexts || []), initial.contexts.find(item => item.id === 'default')];
            }
            draft = Preferences.captureContext(draft, id, t(en,zh));
            contextStatus.textContent = t(`${en} layout is ready. Press Save to keep it.`, `${zh}场景已准备好，点击保存后生效。`); error.hidden = true;
          } catch (_) { error.textContent = t('Give every website a name and a valid http or https URL.', '请为每个网站填写名称及有效的 http 或 https 地址。'); error.hidden = false; }
        }); capture.dataset.contextSave = id; contextActions.append(capture);
      }
      contexts.append(contextActions, contextStatus); content.append(contexts);
      content.append(node('p', t('Google keeps these settings with your account. Guest saves them on this device.', 'Google 登录后随账号同步；Guest 保存在当前设备。')));
      motion.open(); document.body.classList.add('workspace-tool-open');
    }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (motion.closing || draftOwner !== owner()) return;
      remember();
      try {
        if (JSON.stringify(Preferences.read()) !== baseline) throw new Error('changed');
        if (draft.shortcuts.length > 4) throw new Error('shortcuts');
        validateBookmarks();
        if (draft.activeContext) draft = Preferences.captureContext(draft, draft.activeContext, draft.contexts.find(item => item.id === draft.activeContext)?.name);
        applyLayoutChange(() => Preferences.save(draft)); draft = null; close();
      } catch (failure) {
        error.textContent = failure.message === 'bookmarks' ? t('Give every website a name and a valid http or https URL.', '请为每个网站填写名称及有效的 http 或 https 地址。') : failure.message === 'shortcuts' ? t('Choose up to 4 shortcuts.', '最多选择 4 个常用入口。') : failure.message === 'changed' ? t('These settings changed elsewhere. Reopen to review them.', '设置已在其他位置更改，请重新打开后查看。') : t('Settings could not be saved. Your changes are still here; try again.', '设置保存失败，已保留当前修改，请重试。');
        error.hidden = false;
      }
    });
    function refreshLabels() {
      settingsButton.setAttribute('aria-label', t('Customize workbench', '自定义工作台'));
      settingsButton.title = t('Customize workbench', '自定义工作台');
      if (!root.hidden && !motion.closing) {
        const focused = document.activeElement, name = focused?.name, scroll = content.scrollTop;
        const direction = focused?.dataset?.sectionUp ? 'up' : focused?.dataset?.sectionDown ? 'down' : '';
        const id = direction ? focused.dataset[direction === 'up' ? 'sectionUp' : 'sectionDown'] : '';
        const value = focused?.value;
        remember(); open(false); content.scrollTop = scroll;
        const control = direction ? sectionRows.querySelector(`[data-section-${direction}="${id}"]`)
          : name === 'shortcut' ? [...content.querySelectorAll('[name=shortcut]')].find(input => input.value === value)
          : name ? content.querySelector(`[name="${name}"]`) : null;
        control?.focus({preventScroll:true});
      }
      schedule();
    }
    for (const event of ['daily-space-workbench-updated','daily-space-agent-data-updated','daily-space-todo-view-updated','daily-space-user-sync-updated']) window.addEventListener(event, schedule);
    window.addEventListener('storage', schedule);
    window.addEventListener('daily-space-locale-changed', refreshLabels);
    window.addEventListener('daily-space-auth-updated', () => { close(true,true); draft = null; draftOwner = ''; baseline = ''; schedule(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    setInterval(() => { if (!document.hidden) schedule(); }, 60000);
    refreshLabels(); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
