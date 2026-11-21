/** Habits page: today's check-ins, a seven-day strip per habit, and details with streaks and a 12-week heatmap. */
(function () {
  function boot() {
    const Core = window.DailySpaceHabits;
    const host = document.getElementById('habits-content');
    if (!Core || !host) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const ready = () => window.DailySpaceWorkbenchPreferences?.ready() === true;
    const owner = () => String(window.DailySpaceView?.owner() || 'guest').toLowerCase();
    const chinese = () => window.DailySpaceI18n?.locale?.() === 'zh';
    const localeTag = () => window.DailySpaceI18n?.localeTag?.() || undefined;
    const today = () => Core.localDate();
    const ORDER = [1, 2, 3, 4, 5, 6, 0];
    const ICONS = ['💧', '📚', '🏃', '🧘', '💊', '🥗', '😴', '✍️', '🎸', '🌱', '🧹', '🚶'];
    const COLOR_NAMES = { primary: ['Blue', '蓝色'], secondary: ['Slate', '灰蓝'], tertiary: ['Yellow', '黄色'], success: ['Green', '绿色'], danger: ['Red', '红色'] };
    const MESSAGES = {
      HABITS_LIMIT: ['Keep at most 50 habits. Archive or delete one before adding another.', '最多保留 50 个习惯，请先归档或删除一个。'],
      HABIT_MISSING: ['This habit is no longer available.', '这个习惯已不存在。'],
      HABIT_ARCHIVED: ['Restore this habit before checking in.', '请先恢复这个习惯再打卡。'],
      HABIT_DATE: ['Choose today or an earlier day.', '请选择今天或更早的日期。'],
      HABIT_NAME: ['Give the habit a name.', '请为习惯命名。'],
      HABIT_FREQUENCY: ['Choose how often to repeat this habit.', '请选择重复频率。'],
      HABIT_EXISTS: ['This habit already exists.', '这个习惯已存在。'],
    };

    const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };
    const button = (text, run, cls = '') => { const el = node('button', text, cls); el.type = 'button'; if (run) el.addEventListener('click', run); return el; };
    const keyed = (el, key) => { el.dataset.focusKey = key; return el; };
    function icon(path) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
      const line = document.createElementNS(svg.namespaceURI, 'path'); line.setAttribute('d', path); svg.append(line);
      return svg;
    }
    const asDate = day => { const [year, month, date] = day.split('-').map(Number); return new Date(year, month - 1, date, 12); };
    const format = (day, options) => asDate(day).toLocaleDateString(localeTag(), options);
    // 4 January 2026 was a Sunday, so index 0 is Sunday, as in Date#getDay.
    const weekdayName = (index, style = 'short') => new Date(2026, 0, 4 + index, 12).toLocaleDateString(localeTag(), { weekday: style });
    const countDays = count => t(`${count} ${count === 1 ? 'day' : 'days'}`, `${count} 天`);
    const countWeeks = count => t(`${count} ${count === 1 ? 'week' : 'weeks'}`, `${count} 周`);
    const unitCount = (habit, count) => habit.frequency.type === 'weekly' ? countWeeks(count) : countDays(count);
    function errorText(error) { const pair = MESSAGES[error?.code]; return pair ? t(...pair) : error?.message || String(error); }

    function frequencyLabel(habit) {
      const frequency = habit.frequency;
      if (frequency.type === 'weekly') {
        const times = frequency.times;
        return t(times === 1 ? 'Once a week' : times === 2 ? 'Twice a week' : `${times} times a week`, `每周 ${times} 次`);
      }
      if (frequency.type === 'weekdays') {
        const days = frequency.days;
        if (days.length === 7) return t('Every day', '每天');
        if (days.length === 5 && [1, 2, 3, 4, 5].every(day => days.includes(day))) return t('Weekdays', '工作日');
        if (days.length === 2 && days.includes(0) && days.includes(6)) return t('Weekends', '周末');
        return ORDER.filter(day => days.includes(day)).map(day => weekdayName(day)).join(chinese() ? '、' : ', ');
      }
      return t('Every day', '每天');
    }
    function streakLabel(habit, count) {
      return habit.frequency.type === 'weekly' ? t(`${count}-week streak`, `连续 ${count} 周`) : t(`${count}-day streak`, `连续 ${count} 天`);
    }
    function rowMeta(habit, map, day) {
      const parts = [frequencyLabel(habit)];
      if (habit.frequency.type === 'weekly') { const week = Core.weekProgress(habit, map, day); parts.push(t(`${week.done}/${week.target} this week`, `本周 ${week.done}/${week.target}`)); }
      const streak = Core.currentStreak(habit, map, day);
      if (streak) parts.push(streakLabel(habit, streak));
      return parts.join(' · ');
    }
    function stateLabel(state) {
      return {
        done: t('Done', '已完成'), extra: t('Done on a rest day', '休息日完成'), missed: t('Missed', '未完成'), pending: t('Not done yet', '尚未完成'),
        open: t('No check-in', '未打卡'), rest: t('Not scheduled', '无需打卡'), before: t('Before this habit started', '习惯开始之前'), future: t('Upcoming', '尚未到来'),
      }[state] || '';
    }

    // Storage: the workspace snapshot owns this key; writes verify the device kept them for the same owner.
    function parse() { const raw = localStorage.getItem(Core.KEY); return raw === null ? null : JSON.parse(raw); }
    function read() { return ready() ? Core.normalize(parse(), today()) : Core.defaults(); }
    let silent = false;
    function write(next) {
      if (!ready()) throw new Error(t('Workspace is still loading. Try again shortly.', '工作台正在加载，请稍后重试。'));
      const who = owner(), before = localStorage.getItem(Core.KEY), value = Core.normalize(next, today()), after = JSON.stringify(value);
      if (after === before) return value;
      try {
        localStorage.setItem(Core.KEY, after);
        if (!ready() || who !== owner() || localStorage.getItem(Core.KEY) !== after) throw new Error('Storage did not retain the habit.');
      } catch (cause) {
        try { if (who === owner()) { if (before === null) localStorage.removeItem(Core.KEY); else localStorage.setItem(Core.KEY, before); } } catch (_) { /* The error below keeps the page as it was. */ }
        throw Object.assign(new Error(t('Could not save on this device. Free some space and try again.', '无法保存到本机，请释放空间后重试。')), { cause });
      }
      window.dispatchEvent(new CustomEvent('daily-space-habits-updated'));
      window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['habits'] } }));
      return value;
    }

    // Inline feedback near the view's actions, plus a quiet live region for check-ins.
    let notice = null;
    const live = node('p', '', 'habits-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.dataset.i18nIgnore = ''; host.after(live);
    function announce(text) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); }
    function statusNode() { const el = node('p', '', 'habits-status'); el.dataset.habitsStatus = ''; el.setAttribute('role', 'status'); return el; }
    function paintNotice() {
      const el = host.querySelector('[data-habits-status]');
      if (!el) return;
      if (!notice) { el.textContent = ''; delete el.dataset.feedback; el.setAttribute('role', 'status'); return; }
      if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(el, notice.text, notice.tone);
      else { el.textContent = notice.text; el.dataset.feedback = notice.tone; }
    }
    function setNotice(value, tone) {
      notice = value ? { text: value instanceof Error ? errorText(value) : String(value), tone: tone || (value instanceof Error ? 'error' : 'info') } : null;
      paintNotice();
    }

    // Views follow the URL, so Back, Forward, reload and exact links keep working.
    function viewFromUrl() {
      const params = new URLSearchParams(location.search), clip = value => String(value || '').slice(0, 120);
      if (params.has('new')) return { name: 'edit', id: null };
      if (params.get('edit')) return { name: 'edit', id: clip(params.get('edit')) };
      if (params.get('id')) return { name: 'detail', id: clip(params.get('id')) };
      return { name: 'list', id: null };
    }
    function urlFor(next) {
      const params = new URLSearchParams();
      if (next.name === 'edit') { if (next.id) params.set('edit', next.id); else params.set('new', '1'); }
      else if (next.name === 'detail') params.set('id', next.id);
      const query = params.toString();
      return `${location.pathname}${query ? `?${query}` : ''}`;
    }
    const depth = () => Number(history.state?.habitsPage?.depth) || 0;
    const scrollers = () => [document.scrollingElement, document.getElementById('main-area')].filter(Boolean);
    let view = viewFromUrl(), reorder = false, archivedOpen = false, renderedSignature = '', pendingFocus = null, pop = null;
    let form = null, formOwner = '', formKey = '', formBaseline = '', composing = false;
    function go(next, { replace = false, focus = null } = {}) {
      stashForm();
      if (!replace) history.replaceState({ ...history.state, habitsScroll: scrollers().map(el => el.scrollTop) }, '');
      const entry = { view: next.name, id: next.id, depth: replace ? depth() : depth() + 1 };
      history[replace ? 'replaceState' : 'pushState']({ ...history.state, habitsScroll: null, habitsPage: entry }, '', urlFor(next));
      view = next; reorder = false; notice = null; pendingFocus = focus;
      render(true);
      if (!replace) scrollers().forEach(el => { el.scrollTop = 0; });
    }
    /** Return to the view that opened this one; direct links fall back to their parent view. */
    function leave(fallback, focus) {
      if (depth() > 0) { pendingFocus = focus; history.back(); return; }
      go(fallback, { replace: true, focus });
    }
    window.addEventListener('popstate', () => {
      stashForm();
      view = viewFromUrl(); reorder = false; notice = null;
      render(true);
      const saved = history.state?.habitsScroll;
      scrollers().forEach((el, index) => { el.scrollTop = Array.isArray(saved) ? Number(saved[index]) || 0 : 0; });
    });

    function signature() {
      let raw = null;
      try { raw = ready() ? localStorage.getItem(Core.KEY) : null; } catch (_) { raw = '!'; }
      return JSON.stringify([owner(), ready(), window.DailySpaceI18n?.locale?.(), today(), view.name, view.id, view.name === 'edit' ? null : raw, reorder]);
    }
    function updateTitle() {
      const title = t('Habits', '习惯');
      document.getElementById('toolbox-title').textContent = title;
      const description = document.getElementById('toolbox-description');
      if (description) description.textContent = t('Small routines, kept day by day.', '小习惯，日日坚持。');
      document.title = `${title} · dayfly`;
    }
    function render(force = false) {
      if (silent) return;
      const next = signature();
      if (!force && next === renderedSignature) return;
      renderedSignature = next;
      const active = document.activeElement;
      const focusKey = pendingFocus || (active && host.contains(active) ? active.closest('[data-focus-key]')?.dataset.focusKey : null);
      pendingFocus = null;
      stashForm(); form = null;
      updateTitle();
      host.replaceChildren();
      if (!ready()) { host.append(node('p', t('Your workspace is loading…', '工作台正在加载…'), 'habits-empty')); return; }
      let state;
      try { state = read(); }
      catch (_) {
        host.append(node('p', t('Habit data on this device could not be read. Download a backup from Account before changing it.', '无法读取本机的习惯数据。修改前请先在账户中下载备份。'), 'habits-empty'));
        return;
      }
      try {
        if (view.name === 'detail') renderDetail(state); else if (view.name === 'edit') renderForm(state); else renderList(state);
      } catch (error) { host.replaceChildren(statusNode()); notice = { text: errorText(error), tone: 'error' }; }
      paintNotice();
      if (pop) { host.querySelector(`[data-focus-key="${CSS.escape(pop)}"]`)?.classList.add('is-popping'); pop = null; }
      if (focusKey) {
        const target = host.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
        if (target && !target.disabled) { if (target.matches('button.habit-day')) rove(target); target.focus({ preventScroll: true }); }
      }
    }

    function mark() { const span = node('span', '', 'habit-check-mark'); span.setAttribute('aria-hidden', 'true'); return span; }
    function titleOf(habit) {
      const title = node('span', '', 'habit-title');
      if (habit.icon) { const badge = node('span', habit.icon, 'habit-icon'); badge.setAttribute('aria-hidden', 'true'); title.append(badge); }
      title.append(node('span', habit.name, 'habit-name'));
      return title;
    }
    function rove(target) { for (const el of target.closest('.habit-strip')?.querySelectorAll('button.habit-day') || []) el.tabIndex = el === target ? 0 : -1; }
    function stripKeys(event) {
      const current = event.target.closest('button.habit-day');
      if (!current) return;
      const buttons = [...event.currentTarget.querySelectorAll('button.habit-day')], index = buttons.indexOf(current);
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined || !buttons[next]) return;
      event.preventDefault(); rove(buttons[next]); buttons[next].focus();
    }
    /** Seven days ending today. One tab stop per strip; arrow keys move between days. */
    function strip(habit, map, day) {
      const wrap = node('div', '', 'habit-strip');
      wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', t(`Last 7 days: ${habit.name}`, `最近 7 天：${habit.name}`));
      for (const cell of Core.lastDays(habit, map, day, 7)) {
        const full = format(cell.date, { weekday: 'long', month: 'long', day: 'numeric' });
        const usable = !habit.archivedAt && cell.state !== 'rest' && cell.state !== 'future';
        const el = usable ? button('', () => checkIn(habit.id, cell.date, !cell.done, `day:${habit.id}:${cell.date}`)) : node('span');
        el.className = 'habit-day'; el.dataset.state = cell.state; el.dataset.date = cell.date;
        if (cell.date === day) el.dataset.today = '';
        const name = node('span', format(cell.date, { weekday: 'short' }), 'habit-day-name'), dot = node('span', String(Number(cell.date.slice(8))), 'habit-day-dot');
        name.setAttribute('aria-hidden', 'true'); dot.setAttribute('aria-hidden', 'true');
        el.append(name, dot);
        if (usable) {
          keyed(el, `day:${habit.id}:${cell.date}`); el.dataset.habitDay = habit.id;
          el.setAttribute('aria-pressed', String(cell.done));
          el.setAttribute('aria-label', cell.date === day ? t(`Today, ${full}`, `今天，${full}`) : full);
          el.tabIndex = cell.date === day ? 0 : -1;
        } else el.append(node('span', `${full}: ${stateLabel(cell.state)}`, 'habits-sr'));
        wrap.append(el);
      }
      const buttons = [...wrap.querySelectorAll('button.habit-day')];
      if (buttons.length && !buttons.some(el => el.tabIndex === 0)) buttons.at(-1).tabIndex = 0;
      wrap.addEventListener('keydown', stripKeys);
      wrap.addEventListener('focusin', event => { const target = event.target.closest('button.habit-day'); if (target) rove(target); });
      return wrap;
    }
    function row(habit, state, day) {
      const map = Core.checkinsFor(state, habit.id), done = map[day] === 1;
      const item = node('li', '', 'habit-row'); item.dataset.habitId = habit.id; item.dataset.motionKey = habit.id; item.dataset.habitColor = habit.color;
      if (Core.isDue(habit, day)) {
        const check = keyed(button('', () => checkIn(habit.id, day, !done, `check:${habit.id}`), 'habit-check'), `check:${habit.id}`);
        check.dataset.habitCheck = habit.id; check.setAttribute('aria-pressed', String(done));
        check.setAttribute('aria-label', t(`${habit.name}: done today`, `${habit.name}：今天已完成`));
        check.append(mark()); item.append(check);
      } else {
        const rest = node('span', '', 'habit-check is-rest'); rest.setAttribute('aria-hidden', 'true'); rest.append(mark()); item.append(rest);
      }
      const open = keyed(button('', () => go({ name: 'detail', id: habit.id }, { focus: 'heading' }), 'habit-open'), `open:${habit.id}`);
      open.dataset.habitOpen = habit.id;
      const meta = node('span', rowMeta(habit, map, day), 'habit-meta'); meta.dataset.habitMeta = habit.id;
      const chevron = node('span', '›', 'habit-chevron'); chevron.setAttribute('aria-hidden', 'true');
      open.append(titleOf(habit), meta, chevron);
      item.append(open, strip(habit, map, day));
      return item;
    }
    function group(id, title, habits, state, day, empty) {
      const section = node('section', '', 'habits-group'), heading = node('h2', title); heading.id = `habits-group-${id}`;
      section.setAttribute('aria-labelledby', heading.id); section.dataset.habitsGroup = id; section.append(heading);
      if (habits.length) { const list = node('ul', '', 'habits-list'); for (const habit of habits) list.append(row(habit, state, day)); section.append(list); }
      else if (empty) section.append(node('p', empty, 'habits-empty'));
      return section;
    }
    function orderRow(habit, index, count) {
      const item = node('li', '', 'habit-row habit-order-row'); item.dataset.motionKey = habit.id; item.dataset.habitId = habit.id; item.dataset.habitColor = habit.color;
      const controls = node('span', '', 'habit-move-controls');
      for (const [direction, delta, en, zh, path] of [['up', -1, `Move ${habit.name} up`, `上移「${habit.name}」`, 'M12 19V5 M6 11l6-6 6 6'], ['down', 1, `Move ${habit.name} down`, `下移「${habit.name}」`, 'M12 5v14 M6 13l6 6 6-6']]) {
        const control = keyed(button('', () => move(habit.id, delta), 'habit-move'), `${direction}:${habit.id}`);
        control.dataset.move = direction; control.setAttribute('aria-label', t(en, zh)); control.append(icon(path));
        control.disabled = direction === 'up' ? index === 0 : index === count - 1;
        controls.append(control);
      }
      item.append(titleOf(habit), controls);
      return item;
    }
    function archivedSection(habits) {
      const details = node('details', '', 'habits-archived'); details.open = archivedOpen; details.dataset.habitsArchived = '';
      details.addEventListener('toggle', () => { archivedOpen = details.open; });
      const summary = keyed(node('summary', t(`Archived (${habits.length})`, `已归档（${habits.length}）`)), 'archived');
      const list = node('ul', '', 'habits-list');
      for (const habit of habits) {
        const item = node('li', '', 'habit-row habit-archived-row'); item.dataset.habitId = habit.id; item.dataset.habitColor = habit.color;
        const open = keyed(button('', () => go({ name: 'detail', id: habit.id }, { focus: 'heading' }), 'habit-open'), `open:${habit.id}`);
        open.append(titleOf(habit), node('span', frequencyLabel(habit), 'habit-meta'));
        const restore = keyed(button(t('Restore', '恢复'), () => setArchived(habit.id, false, `open:${habit.id}`), 'habits-button'), `restore:${habit.id}`);
        restore.setAttribute('aria-label', t(`Restore ${habit.name}`, `恢复「${habit.name}」`));
        item.append(open, restore); list.append(item);
      }
      details.append(summary, list);
      return details;
    }
    function renderList(state) {
      const day = today(), active = state.habits.filter(habit => !habit.archivedAt), archived = state.habits.filter(habit => habit.archivedAt);
      if (reorder && active.length < 2) reorder = false;
      const wrap = node('div', '', 'habits-view'); wrap.dataset.habitsView = 'list';
      const toolbar = node('div', '', 'habits-toolbar'), heading = node('div', '', 'habits-day');
      heading.append(node('p', format(day, { weekday: 'long', month: 'long', day: 'numeric' }), 'habits-date'));
      const progress = Core.summary(state, day);
      if (progress.due && !reorder) {
        const line = node('p', t(`${progress.done} of ${progress.due} done today`, `今天已完成 ${progress.done}/${progress.due}`), 'habits-progress');
        line.dataset.habitsProgress = ''; heading.append(line);
      }
      const actions = node('div', '', 'habits-actions');
      if (active.length > 1) {
        const order = keyed(button(reorder ? t('Done', '完成') : t('Reorder', '调整顺序'), () => { reorder = !reorder; notice = null; pendingFocus = 'reorder'; render(true); }, 'habits-button'), 'reorder');
        order.dataset.habitsReorder = ''; actions.append(order);
      }
      if (!reorder) { const create = keyed(button(t('New habit', '新建习惯'), () => openForm(null), 'habits-button habits-primary'), 'new'); create.dataset.habitsNew = ''; actions.append(create); }
      toolbar.append(heading, actions);
      wrap.append(toolbar, statusNode());
      if (!state.habits.length) {
        const empty = node('div', '', 'habits-empty-state'); empty.dataset.habitsEmpty = '';
        empty.append(node('p', t('No habits yet.', '还没有习惯。'), 'habits-empty-title'),
          node('p', t('Start with one small routine you want to repeat, like a short walk or ten pages of reading.', '从一个想坚持的小习惯开始，比如散步一会儿或读十页书。'), 'habits-empty'));
        wrap.append(empty);
      } else if (!active.length) {
        wrap.append(node('p', t('All habits are archived. Restore one below or create a new one.', '所有习惯都已归档。可在下方恢复，或新建一个。'), 'habits-empty'));
      } else if (reorder) {
        const list = node('ol', '', 'habits-list habits-order'); list.dataset.habitsOrder = ''; list.setAttribute('aria-label', t('Habit order', '习惯顺序'));
        active.forEach((habit, index) => list.append(orderRow(habit, index, active.length)));
        wrap.append(list);
      } else {
        const due = [], other = [];
        for (const habit of active) (Core.dueToday(habit, Core.checkinsFor(state, habit.id), day) ? due : other).push(habit);
        wrap.append(group('today', t('Today', '今天'), due, state, day, t('Nothing is due today.', '今天没有需要打卡的习惯。')));
        if (other.length) wrap.append(group('later', t('Not due today', '今天无需打卡'), other, state, day));
      }
      if (archived.length && !reorder) wrap.append(archivedSection(archived));
      host.append(wrap);
    }

    function heatmapFigure(habit, map, day) {
      const weeks = Core.heatmap(habit, map, day, 12), weekly = habit.frequency.type === 'weekly';
      const figure = node('figure', '', 'habit-heatmap'), grid = node('div', '', 'habit-heatmap-grid');
      grid.dataset.habitHeatmap = ''; if (weekly) grid.dataset.weekly = '';
      const cells = weeks.flatMap(week => week.days), done = cells.filter(cell => cell.state === 'done' || cell.state === 'extra').length;
      const scheduled = cells.filter(cell => cell.state === 'done' || cell.state === 'missed').length, met = weeks.filter(week => week.met).length;
      grid.setAttribute('role', 'img');
      grid.setAttribute('aria-label', weekly
        ? t(`Last 12 weeks: goal met in ${met} of 12 weeks, ${done} check-ins.`, `最近 12 周：${met} 周达成目标，共打卡 ${done} 次。`)
        : t(`Last 12 weeks: done on ${cells.filter(cell => cell.state === 'done').length} of ${scheduled} scheduled days.`, `最近 12 周：应打卡 ${scheduled} 天，完成 ${cells.filter(cell => cell.state === 'done').length} 天。`));
      const corner = node('span', '', 'habit-heatmap-corner'); corner.setAttribute('aria-hidden', 'true'); grid.append(corner);
      ORDER.forEach((index, rowNumber) => { const label = node('span', rowNumber % 2 === 0 ? weekdayName(index, 'narrow') : '', 'habit-heatmap-weekday'); label.setAttribute('aria-hidden', 'true'); grid.append(label); });
      if (weekly) { const blank = node('span', '', 'habit-heatmap-weekday'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank); }
      const startsMonth = week => week.days.find(cell => cell.date.endsWith('-01'));
      weeks.forEach((week, column) => {
        const first = startsMonth(week);
        let label = first ? format(first.date, { month: 'short' }) : '';
        if (!first && column === 0 && !weeks.slice(1, 3).some(startsMonth)) label = format(week.start, { month: 'short' });
        const month = node('span', label, 'habit-heatmap-month'); month.setAttribute('aria-hidden', 'true'); grid.append(month);
        for (const cell of week.days) {
          const square = node('span', '', 'habit-cell'); square.dataset.state = cell.state; square.dataset.date = cell.date;
          if (cell.date === day) square.dataset.today = '';
          square.title = `${format(cell.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${stateLabel(cell.state)}`;
          grid.append(square);
        }
        if (weekly) {
          const marker = node('span', '', 'habit-week-mark'); marker.dataset.met = String(Boolean(week.met));
          marker.title = t(`Week of ${format(week.start, { month: 'short', day: 'numeric' })}: ${week.count} of ${habit.frequency.times}`, `${format(week.start, { month: 'short', day: 'numeric' })} 当周：${week.count}/${habit.frequency.times}`);
          grid.append(marker);
        }
      });
      const legend = node('figcaption', '', 'habit-heatmap-legend');
      const entries = [['done', t('Done', '已完成')]];
      if (!weekly) entries.push(['missed', t('Missed', '未完成')]);
      if (habit.frequency.type === 'weekdays') entries.push(['rest', t('Not scheduled', '无需打卡')]);
      if (weekly) entries.push(['met', t('Weekly goal met', '达成每周目标')]);
      for (const [state, label] of entries) {
        const item = node('span', '', 'habit-legend-item'), swatch = node('span', '', state === 'met' ? 'habit-week-mark' : 'habit-cell');
        if (state === 'met') swatch.dataset.met = 'true'; else swatch.dataset.state = state;
        swatch.setAttribute('aria-hidden', 'true'); item.append(swatch, node('span', label)); legend.append(item);
      }
      figure.append(grid, legend);
      return figure;
    }
    function renderDetail(state) {
      const day = today(), habit = state.habits.find(item => item.id === view.id);
      const wrap = node('div', '', 'habits-view habit-detail'); wrap.dataset.habitsView = 'detail';
      const back = keyed(button(t('All habits', '全部习惯'), () => leave({ name: 'list', id: null }, `open:${view.id}`), 'habits-back'), 'back');
      back.prepend(icon('M15 18l-6-6 6-6')); wrap.append(back);
      if (!habit) { wrap.append(node('p', t('This habit is no longer available.', '这个习惯已不存在。'), 'habits-empty')); host.append(wrap); return; }
      wrap.dataset.habitColor = habit.color;
      const map = Core.checkinsFor(state, habit.id), stats = Core.stats(habit, map, day);
      const header = node('header', '', 'habit-detail-header');
      if (habit.icon) { const badge = node('span', habit.icon, 'habit-detail-icon'); badge.setAttribute('aria-hidden', 'true'); header.append(badge); }
      const titles = node('div', '', 'habit-detail-titles'), heading = keyed(node('h2', habit.name), 'heading'); heading.tabIndex = -1;
      const facts = [frequencyLabel(habit)];
      if (habit.frequency.type === 'weekly') facts.push(t(`${stats.week.done}/${stats.week.target} this week`, `本周 ${stats.week.done}/${stats.week.target}`));
      if (habit.archivedAt) facts.push(t('Archived', '已归档'));
      titles.append(heading, node('p', facts.join(' · '), 'habit-detail-meta')); header.append(titles); wrap.append(header);
      if (!habit.archivedAt) {
        if (Core.isDue(habit, day)) {
          const toggle = keyed(button('', () => checkIn(habit.id, day, !stats.doneToday, 'today'), 'habit-today'), 'today');
          toggle.dataset.habitToday = ''; toggle.setAttribute('aria-pressed', String(stats.doneToday));
          toggle.append(mark(), node('span', t('Done today', '今天已完成'))); wrap.append(toggle);
        } else wrap.append(node('p', t('Not scheduled today.', '今天无需打卡。'), 'habit-detail-note'));
      }
      const metrics = node('dl', '', 'habit-stats');
      const rate = stats.rate.rate === null ? '—' : `${Math.round(stats.rate.rate * 100)}%`;
      const rateNote = !stats.rate.due ? t('Nothing scheduled yet', '暂无应打卡记录') : stats.rate.unit === 'week'
        ? t(`${stats.rate.done} of ${stats.rate.due} weeks`, `${stats.rate.due} 周中完成 ${stats.rate.done} 周`) : t(`${stats.rate.done} of ${stats.rate.due} days`, `${stats.rate.due} 天中完成 ${stats.rate.done} 天`);
      for (const [key, label, value, note] of [['current', t('Current streak', '当前连续'), unitCount(habit, stats.current)], ['best', t('Best streak', '最长连续'), unitCount(habit, stats.best)],
        ['rate', t('Last 30 days', '近 30 天'), rate, rateNote], ['total', t('Check-ins', '打卡次数'), String(stats.total)]]) {
        const item = node('div'), value_ = node('dd', value); value_.dataset.habitStat = key;
        item.append(node('dt', label), value_); if (note) item.append(node('dd', note, 'habit-stat-note'));
        metrics.append(item);
      }
      wrap.append(metrics);
      const recent = node('section', '', 'habit-section'); recent.append(node('h3', t('Last 7 days', '最近 7 天')), strip(habit, map, day)); wrap.append(recent);
      const history = node('section', '', 'habit-section'); history.append(node('h3', t('Last 12 weeks', '最近 12 周')), heatmapFigure(habit, map, day)); wrap.append(history);
      const actions = node('div', '', 'habit-detail-actions');
      if (!habit.archivedAt) actions.append(keyed(button(t('Edit', '编辑'), () => openForm(habit.id), 'habits-button'), 'edit'));
      const archive = keyed(button(habit.archivedAt ? t('Restore', '恢复') : t('Archive', '归档'), () => setArchived(habit.id, !habit.archivedAt, 'archive'), 'habits-button'), 'archive');
      archive.dataset.habitArchive = ''; actions.append(archive);
      const remove = keyed(button(t('Delete', '删除'), () => deleteHabit(habit.id), 'habits-button habits-danger'), 'delete'); remove.dataset.habitDelete = ''; actions.append(remove);
      wrap.append(actions, statusNode());
      host.append(wrap);
    }

    // The form keeps an account-scoped session draft, so Back/Forward and reloads keep unsaved input.
    const draftKey = id => `dayfly-habit-draft:${owner()}:${id || 'new'}`;
    function readDraft(id) { try { const value = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null'); return value && typeof value === 'object' ? value : null; } catch (_) { return null; } }
    function clearDraft(key) { try { if (key) sessionStorage.removeItem(key); } catch (_) { /* Drafts are a convenience. */ } }
    function formValue() {
      const data = new FormData(form), type = String(data.get('frequency') || 'daily');
      return { name: String(data.get('name') || ''), icon: String(data.get('icon') || ''), color: String(data.get('color') || 'primary'),
        frequency: type === 'weekdays' ? { type, days: data.getAll('days').map(Number) } : type === 'weekly' ? { type, times: Number(data.get('times')) || 1 } : { type: 'daily' } };
    }
    function stashForm() {
      if (!form || !form.isConnected || view.name !== 'edit' || !formKey || owner() !== formOwner || !ready()) return;
      const serialized = JSON.stringify(formValue());
      try { if (serialized === formBaseline) sessionStorage.removeItem(formKey); else sessionStorage.setItem(formKey, serialized); } catch (_) { /* The form keeps its values. */ }
    }
    function syncFrequency(target = form) {
      if (!target) return;
      const type = target.querySelector('input[name=frequency]:checked')?.value || 'daily';
      target.querySelector('[data-habit-days]').hidden = type !== 'weekdays';
      target.querySelector('[data-habit-times]').hidden = type !== 'weekly';
    }
    function fill(value) {
      const type = Core.TYPES.includes(value?.frequency?.type) ? value.frequency.type : 'daily';
      form.elements.name.value = typeof value?.name === 'string' ? value.name : '';
      for (const input of form.querySelectorAll('input[name=icon]')) input.checked = input.value === (value?.icon || '');
      for (const input of form.querySelectorAll('input[name=color]')) input.checked = input.value === (Core.COLORS.includes(value?.color) ? value.color : 'primary');
      for (const input of form.querySelectorAll('input[name=frequency]')) input.checked = input.value === type;
      const days = type === 'weekdays' && Array.isArray(value.frequency.days) ? value.frequency.days : [];
      for (const input of form.querySelectorAll('input[name=days]')) input.checked = days.includes(Number(input.value));
      form.elements.times.value = String(type === 'weekly' ? value.frequency.times || 3 : 3);
      syncFrequency();
    }
    function fieldset(legend, cls) { const root = node('fieldset', '', 'habit-fieldset'), body = node('div', '', cls); root.append(node('legend', legend), body); return { root, body }; }
    function choice(type, name, value, text, cls = '') {
      const label = node('label', '', `habit-choice ${cls}`.trim()), input = node('input'); input.type = type; input.name = name; input.value = value;
      keyed(input, `${name}:${value}`);
      label.append(input, node('span', text, 'habit-choice-face'));
      return label;
    }
    function renderForm(state) {
      const editing = view.id ? state.habits.find(habit => habit.id === view.id) : null;
      const wrap = node('div', '', 'habits-view habit-form-view'); wrap.dataset.habitsView = 'edit';
      if ((view.id && !editing) || (!view.id && state.habits.length >= Core.MAX_HABITS)) {
        const back = keyed(button(t('All habits', '全部习惯'), () => leave({ name: 'list', id: null }, 'new'), 'habits-back'), 'back');
        back.prepend(icon('M15 18l-6-6 6-6'));
        wrap.append(back, node('p', view.id ? t('This habit is no longer available.', '这个习惯已不存在。') : t(...MESSAGES.HABITS_LIMIT), 'habits-empty'));
        host.append(wrap); return;
      }
      form = node('form', '', 'habit-form'); form.noValidate = true; form.autocomplete = 'off'; form.dataset.habitForm = '';
      const heading = keyed(node('h2', editing ? t('Edit habit', '编辑习惯') : t('New habit', '新建习惯')), 'form-heading'); heading.tabIndex = -1;
      const nameField = node('label', '', 'habit-field'), name = keyed(node('input'), 'name');
      name.name = 'name'; name.type = 'text'; name.maxLength = Core.MAX_NAME; name.required = true; name.autocomplete = 'off'; name.placeholder = t('For example, read 10 pages', '例如：读 10 页书');
      nameField.append(node('span', t('Name', '名称')), name);
      const icons = fieldset(t('Icon', '图标'), 'habit-choices');
      const iconOptions = ['', ...ICONS]; if (editing?.icon && !ICONS.includes(editing.icon)) iconOptions.push(editing.icon);
      for (const value of iconOptions) icons.body.append(choice('radio', 'icon', value, value || t('None', '无'), value ? 'habit-emoji' : 'habit-text'));
      const colors = fieldset(t('Color', '颜色'), 'habit-choices');
      for (const color of Core.COLORS) {
        const option = choice('radio', 'color', color, '', 'habit-swatch'); option.dataset.habitColor = color;
        option.querySelector('.habit-choice-face').append(node('span', t(...COLOR_NAMES[color]), 'habits-sr')); colors.body.append(option);
      }
      const repeat = fieldset(t('Repeat', '重复'), 'habit-frequency'), types = node('div', '', 'habit-choices habit-segments');
      for (const [value, en, zh] of [['daily', 'Every day', '每天'], ['weekdays', 'On certain days', '指定星期'], ['weekly', 'Times per week', '每周次数']]) types.append(choice('radio', 'frequency', value, t(en, zh), 'habit-segment'));
      const days = node('div', '', 'habit-choices habit-days'); days.dataset.habitDays = ''; days.setAttribute('role', 'group'); days.setAttribute('aria-label', t('Days', '星期'));
      for (const index of ORDER) days.append(choice('checkbox', 'days', String(index), weekdayName(index), 'habit-weekday'));
      const timesField = node('label', '', 'habit-field habit-times'), times = keyed(node('select'), 'times'); timesField.dataset.habitTimes = ''; times.name = 'times';
      for (let count = 1; count <= 7; count++) times.append(new Option(String(count), String(count)));
      timesField.append(node('span', t('Times per week', '每周次数')), times);
      repeat.body.append(types, days, timesField);
      const footer = node('div', '', 'habit-form-footer');
      const cancel = keyed(button(t('Cancel', '取消'), () => cancelForm(editing), 'habits-button'), 'cancel');
      const save = keyed(node('button', t('Save habit', '保存习惯'), 'habits-button habits-primary'), 'save'); save.type = 'submit';
      footer.append(cancel, save);
      form.append(heading, nameField, icons.root, colors.root, repeat.root, statusNode(), footer);
      wrap.append(form); host.append(wrap);
      formOwner = owner(); formKey = draftKey(view.id);
      fill(editing || { name: '', icon: '', color: 'primary', frequency: { type: 'daily' } });
      formBaseline = JSON.stringify(formValue());
      const draft = readDraft(view.id);
      if (draft) fill(draft);
      form.addEventListener('input', stashForm);
      form.addEventListener('change', event => {
        // A field can report a change while its form is being replaced (Back with focus inside); only the live form reacts.
        const target = event.currentTarget;
        if (target !== form) return;
        // Choosing specific days starts from the working week.
        if (event.target.name === 'frequency' && event.target.value === 'weekdays' && !target.querySelector('input[name=days]:checked')) {
          for (const input of target.querySelectorAll('input[name=days]')) input.checked = ['1', '2', '3', '4', '5'].includes(input.value);
        }
        syncFrequency(target); stashForm();
      });
      form.addEventListener('compositionstart', () => { composing = true; });
      form.addEventListener('compositionend', () => { composing = false; stashForm(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (!composing) saveForm(editing); });
    }
    function saveForm(editing) {
      if (!ready() || !form) return;
      const value = formValue(), nameInput = form.elements.name;
      nameInput.removeAttribute('aria-invalid');
      if (!value.name.trim()) { nameInput.setAttribute('aria-invalid', 'true'); setNotice(t(...MESSAGES.HABIT_NAME), 'error'); nameInput.focus(); return; }
      if (value.frequency.type === 'weekdays' && !value.frequency.days.length) { setNotice(t('Choose at least one day.', '请至少选择一天。'), 'error'); form.querySelector('input[name=days]')?.focus(); return; }
      try {
        let id = editing?.id;
        if (id) write(Core.update(read(), id, value, today()));
        else { id = Core.uid(); write(Core.create(read(), { ...value, id }, Date.now(), today())); }
        const key = formKey; form = null; clearDraft(key);
        announce(editing ? t('Habit saved.', '习惯已保存。') : t(`Added ${value.name.trim()}.`, `已添加「${value.name.trim()}」。`));
        if (editing) leave({ name: 'detail', id }, 'heading'); else leave({ name: 'list', id: null }, `open:${id}`);
      } catch (error) { setNotice(error); }
    }
    function cancelForm(editing) {
      const key = formKey; form = null; clearDraft(key);
      leave(editing ? { name: 'detail', id: editing.id } : { name: 'list', id: null }, editing ? 'edit' : 'new');
    }
    function openForm(id) {
      if (!ready()) return;
      try { if (!id && read().habits.length >= Core.MAX_HABITS) { setNotice(t(...MESSAGES.HABITS_LIMIT), 'error'); return; } }
      catch (error) { setNotice(error); return; }
      go({ name: 'edit', id }, { focus: 'name' });
    }

    function checkIn(id, date, done, key) {
      if (!ready()) return;
      try {
        const day = today(), state = read(), habit = state.habits.find(item => item.id === id);
        notice = null; pop = done ? key : null;
        write(Core.setCheckin(state, id, date, done, day));
        render();
        const when = date === day ? t('today', '今天') : format(date, { month: 'long', day: 'numeric' });
        announce(done ? t(`${habit?.name}: done ${when}`, `${habit?.name}：${when}已完成`) : t(`${habit?.name}: check-in removed for ${when}`, `${habit?.name}：已取消${when}的打卡`));
      } catch (error) { pop = null; setNotice(error); }
    }
    function move(id, delta) {
      if (!ready()) return;
      const list = host.querySelector('[data-habits-order]');
      if (!list) return;
      let next = null;
      const change = () => {
        silent = true;
        try { next = write(Core.move(read(), id, delta, today())); } finally { silent = false; }
        const active = next.habits.filter(habit => !habit.archivedAt);
        active.forEach((habit, index) => {
          const item = [...list.children].find(child => child.dataset.motionKey === habit.id);
          if (!item) return;
          list.append(item);
          item.querySelector('[data-move=up]').disabled = index === 0;
          item.querySelector('[data-move=down]').disabled = index === active.length - 1;
        });
        renderedSignature = signature();
      };
      try {
        if (window.DailySpaceLayoutMotion) window.DailySpaceLayoutMotion.run(list, change); else change();
      } catch (error) { setNotice(error); render(true); return; }
      const active = next.habits.filter(habit => !habit.archivedAt), position = active.findIndex(habit => habit.id === id) + 1, name = active[position - 1]?.name || '';
      announce(t(`${name} moved to position ${position} of ${active.length}.`, `「${name}」已移到第 ${position} 位，共 ${active.length} 个。`));
      // Keep keyboard focus on a usable control when a move reaches the top or bottom.
      queueMicrotask(() => {
        const item = [...list.children].find(child => child.dataset.motionKey === id);
        if (item && !item.contains(document.activeElement)) (item.querySelector(`[data-move=${delta < 0 ? 'up' : 'down'}]:not(:disabled)`) || item.querySelector('[data-move]:not(:disabled)'))?.focus({ preventScroll: true });
      });
    }
    function setArchived(id, archived, focus) {
      if (!ready()) return;
      try {
        notice = null; pendingFocus = focus;
        write(Core.archive(read(), id, archived, Date.now(), today()));
        render();
        setNotice(archived ? t('Archived. It no longer appears in Today.', '已归档，不再显示在“今天”中。') : t('Restored to Today.', '已恢复到“今天”。'), 'success');
      } catch (error) { pendingFocus = null; setNotice(error); }
    }
    function deleteHabit(id) {
      if (!ready()) return;
      try {
        const who = owner(), result = Core.remove(read(), id, today()), removed = result.removed;
        // Leave the details first, instead of re-rendering them for a habit that is gone.
        silent = true;
        try { write(result.state); } finally { silent = false; }
        const undo = () => {
          if (!ready() || owner() !== who) return;
          try { write(Core.restore(read(), removed, today())); render(); setNotice(t('Habit restored.', '习惯已恢复。'), 'success'); }
          catch (error) { setNotice(error); }
        };
        leave({ name: 'list', id: null }, 'new');
        if (window.DailySpaceUndo) window.DailySpaceUndo.offer(t(`Deleted “${removed.habit.name}”`, `已删除「${removed.habit.name}」`), undo);
        else announce(t('Habit deleted.', '习惯已删除。'));
      } catch (error) { setNotice(error); }
    }

    for (const event of ['daily-space-habits-updated', 'daily-space-agent-data-updated', 'daily-space-user-sync-updated', 'daily-space-locale-changed', 'storage']) window.addEventListener(event, () => render());
    window.addEventListener('daily-space-auth-updated', () => {
      // Another identity never sees this one's view, draft or reorder state.
      form = null; reorder = false; notice = null; pendingFocus = null;
      if (view.name !== 'list') {
        view = { name: 'list', id: null };
        history.replaceState({ ...history.state, habitsPage: { view: 'list', id: null, depth: depth() } }, '', urlFor(view));
      }
      render(true);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.addEventListener('focus', () => render());
    window.addEventListener('pagehide', stashForm);
    // Today changes at midnight; the signature includes the date.
    setInterval(() => { if (!document.hidden) render(); }, 60000);
    history.replaceState({ ...history.state, habitsPage: { view: view.name, id: view.id, depth: depth() } }, '', location.href);
    render(true);
    window.DailySpaceHabitsPage = { render: () => render(true), view: () => ({ ...view }) };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
