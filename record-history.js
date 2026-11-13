/** Explicit local mutation history. Call capture only after a successful edit. */
(function () {
  const Core = window.DailySpaceHistoryCore;
  if (!Core) return;
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const owner = () => window.DailySpaceView?.owner() || 'guest';
  const ready = () => Boolean(window.DailySpaceWorkbenchPreferences?.ready());
  const read = () => { try { return Core.normalize(localStorage.getItem(Core.KEY)); } catch (_) { return Core.defaults(); } };
  let lastCaptureFailed = false;
  function notify(detail = {}) { window.dispatchEvent(new CustomEvent('daily-space-history-updated', { detail })); }
  function capture(key, before, after) {
    if (window.DailySpaceSnapshotApplying) return true;
    if (!ready() || !Core.SUPPORTED[key]) return false;
    try {
      const previous = Core.normalize(localStorage.getItem(Core.KEY)), next = Core.capture(previous, key, before, after);
      if (Core.signature(previous) === Core.signature(next)) return true;
      localStorage.setItem(Core.KEY, JSON.stringify(next));
      lastCaptureFailed = false;
      notify({ skipped: next.skipped > previous.skipped });
      return true;
    } catch (_) {
      // The primary edit has already succeeded. A full history store must not
      // turn that edit into a false failure or roll the primary record back.
      lastCaptureFailed = true; notify({ failed: true });
      return false;
    }
  }
  const api = { capture, read, ready, open: () => {} };
  window.DailySpaceHistory = api;
  function boot() {
    if (!window.DailySpaceDialogHistory) return;
    const element = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
    const button = (text, run) => { const el = element('button', text); el.type = 'button'; el.addEventListener('click', run); return el; };
    const root = element('div', '', 'workspace-tool-sheet record-history-sheet'); root.id = 'record-history-sheet'; root.hidden = true; root.dataset.dialogRoot = ''; root.dataset.i18nIgnore = '';
    const backdrop = button('', () => close()); backdrop.className = 'workspace-tool-backdrop'; backdrop.dataset.dialogClose = ''; backdrop.setAttribute('aria-label', t('Close history', '关闭历史记录'));
    const panel = element('section', '', 'workspace-tool-panel record-history-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'record-history-title');
    const header = element('header'), title = element('h2', t('History & recycle bin', '历史与回收站')); title.id = 'record-history-title';
    const dismiss = button('×', () => close()); dismiss.dataset.dialogClose = ''; dismiss.setAttribute('aria-label', t('Close', '关闭')); header.append(title, dismiss);
    const filters = element('div', '', 'record-history-filters');
    const mode = element('select'); mode.setAttribute('aria-label', t('History filter', '历史记录筛选')); mode.append(new Option(t('All versions', '全部版本'), 'all'), new Option(t('Recycle bin', '回收站'), 'deleted'));
    const domain = element('select'); domain.setAttribute('aria-label', t('Record type', '记录类型'));
    domain.append(new Option(t('All records', '全部记录'), ''), new Option(t('Tasks', '任务'), 'todo-app-v2'), new Option(t('Notes', '笔记'), 'dayfly-notes-v1'), new Option(t('Trips', '旅行'), 'travel-book-v1'));
    const query = element('input'); query.type = 'search'; query.placeholder = t('Search previous records', '搜索历史记录'); query.setAttribute('aria-label', query.placeholder);
    filters.append(mode, domain, query);
    const body = element('div', '', 'record-history-body'), list = element('div', '', 'record-history-list'), preview = element('section', '', 'record-history-preview'); preview.hidden = true;
    const description = element('p', t('Previous task, note and trip records are saved after local edits. Up to 200 versions share 150 KB; older versions expire as space is needed.', '本机编辑后保留任务、笔记和行程的旧记录。最多 200 个版本，共用 150 KB，空间不足时移除最早版本。'), 'record-history-help');
    const status = element('p', '', 'workspace-tool-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    function feedback(message, tone = 'info') {
      if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(status, message, tone);
      else { status.textContent = message; status.dataset.feedback = tone; }
    }
    body.append(description, list, preview); panel.append(header, filters, body, status); root.append(backdrop, panel); document.body.append(root);
    const motion = window.DailySpaceDialogHistory.motion(root);
    window.DailySpaceDialogHistory.fitViewport(root);
    const navigation = window.DailySpaceDialogHistory.create('record-history', { isOpen: () => !root.hidden && !motion.closing, restore: data => open(data, false), close: () => close(true) });
    let openedOwner = '', recordFilter = null, selected = null, selectedSignature = null;
    const label = key => key === 'todo-app-v2' ? t('Task', '任务') : key === 'dayfly-notes-v1' ? t('Note', '笔记') : t('Trip', '旅行');
    const recordTitle = record => record.text || record.title || record.name || t('Untitled', '未命名');
    function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
    function sameOwner() { return ready() && openedOwner === owner(); }
    function open(options = {}, push = true) {
      if (!ready()) return;
      const filter = options && Core.SUPPORTED[options.key] && options.recordId ? { key: options.key, recordId: options.recordId } : null;
      if (push && !navigation.push(filter || {})) return;
      openedOwner = owner(); recordFilter = filter; selected = null; selectedSignature = null;
      feedback('', lastCaptureFailed ? 'warning' : 'info');
      mode.value = options.mode === 'deleted' ? 'deleted' : 'all'; domain.value = Core.SUPPORTED[options.key] ? options.key : ''; query.value = ''; status.textContent = lastCaptureFailed ? t('A recent change was saved without a history copy because device storage was unavailable.', '最近一次修改已保存，但由于设备存储不可用，未能保存历史副本。') : ''; preview.hidden = true;
      render(); motion.open(); query.focus({ preventScroll: true });
    }
    function close(fromHistory = false, immediate = false) {
      motion.close(() => { selected = null; selectedSignature = null; preview.replaceChildren(); }, immediate);
      if (!fromHistory) navigation.back();
    }
    function render() {
      if (!sameOwner()) { list.replaceChildren(); preview.hidden = true; return; }
      const history = read(), search = query.value.trim().toLocaleLowerCase();
      const present = new Map(Object.entries(Core.SUPPORTED).map(([key, field]) => { const records = readStore(key)?.[field]; return [key, new Set((Array.isArray(records) ? records : []).map(item => item?.id))]; }));
      const entries = history.entries.filter(entry => {
        if (domain.value && entry.key !== domain.value) return false;
        if (recordFilter && (entry.key !== recordFilter.key || entry.recordId !== recordFilter.recordId)) return false;
        if (search && !recordTitle(entry.value).toLocaleLowerCase().includes(search)) return false;
        return mode.value !== 'deleted' || !present.get(entry.key)?.has(entry.recordId);
      });
      list.replaceChildren();
      if (!entries.length) list.append(element('p', t('No saved versions here yet. New local edits and deletions will appear here.', '这里还没有保存的版本。之后的本机编辑和删除会显示在这里。'), 'record-history-empty'));
      for (const entry of entries) {
        const row = element('article', '', 'record-history-row'), copy = element('div');
        copy.append(element('strong', recordTitle(entry.value)));
        const deleted = !present.get(entry.key)?.has(entry.recordId);
        const time = new Date(entry.at).toLocaleString(window.DailySpaceI18n?.localeTag() || 'en-US');
        copy.append(element('p', `${label(entry.key)} · ${time} · ${deleted ? t('Deleted record', '已删除记录') : t('Previous version', '历史版本')}`));
        const view = button(t('Preview', '预览'), () => select(entry)); view.dataset.historyPreview = entry.id; row.append(copy, view); list.append(row);
      }
      description.textContent = history.skipped ? t('Some records exceeded the 40 KB per-version limit and were not copied. Current data is unchanged. Up to 200 complete versions share 150 KB.', '部分记录超过每版本 40 KB，未被复制；当前数据不受影响。最多保留 200 个完整版本，共用 150 KB。') : t('Previous task, note and trip records are saved after local edits. Up to 200 versions share 150 KB; older versions expire as space is needed.', '本机编辑后保留任务、笔记和行程的旧记录。最多 200 个版本，共用 150 KB，空间不足时移除最早版本。');
    }
    function select(entry) {
      if (!sameOwner()) return;
      selected = entry.id; selectedSignature = Core.signature(Core.getRecord(entry.key, readStore(entry.key), entry.recordId)); feedback('');
      preview.replaceChildren(); preview.hidden = false;
      preview.append(element('h3', recordTitle(entry.value)));
      const current = Core.getRecord(entry.key, readStore(entry.key), entry.recordId);
      preview.append(element('p', current ? t('Restoring replaces this record only. Its current version is saved to history first; other records stay as they are.', '恢复只替换这一条记录。当前版本会先保存到历史，其他记录保持原样。') : t('Restoring puts this deleted record back with its original ID.', '恢复后以原 ID 找回这条已删除记录。')));
      preview.append(recordPreview(entry));
      const restore = button(current ? t('Restore this version', '恢复此版本') : t('Restore record', '恢复记录'), () => commit(entry, restore)); restore.className = 'btn-primary'; restore.dataset.historyRestore = '';
      const cancel = button(t('Close preview', '关闭预览'), () => { preview.hidden = true; selected = null; selectedSignature = null; }); preview.append(restore, cancel); preview.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    function recordPreview(entry) {
      const value = entry.value, details = element('div', '', 'record-history-preview-content');
      const line = (name, content) => { if (content) { const paragraph = element('p'); paragraph.append(element('strong', name + ': '), document.createTextNode(String(content))); details.append(paragraph); } };
      const list = (name, values) => { if (!values.length) return; details.append(element('h4', name)); const items = element('ul'); for (const text of values) items.append(element('li', text)); details.append(items); };
      if (entry.key === 'todo-app-v2') {
        line(t('Status', '状态'), value.completed ? t('Completed', '已完成') : t('Open', '未完成'));
        line(t('Date', '日期'), [value.dueDate, value.dueTime].filter(Boolean).join(' ') || t('Not scheduled', '未安排'));
        const category = readStore(entry.key)?.categories?.find(item => item.id === value.categoryId);
        if (value.categoryId) line(t('Category', '分类'), category?.name || t('Category no longer available', '分类已不存在'));
        line(t('Priority', '优先级'), value.priority === 'high' ? t('High', '重要') : value.priority === 'low' ? t('Low', '较低') : t('Normal', '普通'));
        line(t('Notes', '备注'), value.notes);
        list(t('Checklist', '清单'), (Array.isArray(value.subtasks) ? value.subtasks : []).filter(Boolean).map(item => `${item.completed ? '✓' : '○'} ${item.text || ''}`));
      } else if (entry.key === 'dayfly-notes-v1') {
        line(t('Note', '笔记'), value.body);
        line(t('Tags', '标签'), (Array.isArray(value.tags) ? value.tags : []).join(' · '));
        if (Array.isArray(value.links) && value.links.length) line(t('Linked records', '关联记录'), String(value.links.length));
      } else {
        line(t('Dates', '日期'), `${value.startDate} – ${value.endDate}`);
        line(t('Destination', '目的地'), value.destination);
        list(t('Places', '地点'), (Array.isArray(value.stops) ? value.stops : []).map(stop => `${t('Day', '第')}${stop.day || 1}${t('', '天')} · ${stop.title || stop.name || ''}${stop.note ? ' · ' + stop.note : ''}`));
        list(t('Bookings', '预订'), (Array.isArray(value.reservations) ? value.reservations : []).map(booking => [booking.title, booking.startDate, booking.startTime, booking.confirmationCode].filter(Boolean).join(' · ')));
      }
      if (typeof value.sourceUrl === 'string') { try { const url = new URL(value.sourceUrl); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) { const source = element('a', t('Open original source', '打开来源')); source.href = url.href; source.target = '_blank'; source.rel = 'noopener noreferrer'; details.append(source); } } catch (_) {} }
      return details;
    }
    function commit(entry, control) {
      if (!sameOwner() || selected !== entry.id) return;
      try {
        const current = readStore(entry.key), previousHistory = read(), plan = Core.planRestore(previousHistory, entry.id, current, selectedSignature);
        if (entry.key === 'dayfly-notes-v1') {
          if (!window.DailySpaceNotesCore) throw new Error('STORE_UNAVAILABLE');
          const validated = window.DailySpaceNotesCore.normalize(plan.state);
          if (validated.notes.length !== plan.state.notes.length) throw new Error('NOTES_INVALID');
          if (new TextEncoder().encode(JSON.stringify(plan.state)).length > window.DailySpaceNotesCore.MAX_BYTES) throw Object.assign(new Error('NOTES_SIZE'), { code: 'NOTES_SIZE' });
        }
        const serialized = JSON.stringify(plan.state);
        const present = Core.getRecord(entry.key, current, entry.recordId);
        const nextHistory = Core.capture(previousHistory, entry.key, plan.before, plan.after);
        if (present && (!Core.validRecord(entry.key, present) || nextHistory.skipped > previousHistory.skipped)) throw new Error('RESTORE_BACKUP_UNAVAILABLE');
        // Reserve the current version before replacing it. If the primary
        // storage write fails, put the history container back as well.
        const previousRaw = localStorage.getItem(Core.KEY), historyChanged = Core.signature(nextHistory) !== Core.signature(previousHistory);
        if (historyChanged) localStorage.setItem(Core.KEY, JSON.stringify(nextHistory));
        try { localStorage.setItem(entry.key, serialized); }
        catch (error) {
          if (historyChanged) { try { if (previousRaw === null) localStorage.removeItem(Core.KEY); else localStorage.setItem(Core.KEY, previousRaw); } catch (_) { /* Primary records are still unchanged. */ } }
          throw error;
        }
        window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: [entry.key === 'todo-app-v2' ? 'todo' : entry.key === 'dayfly-notes-v1' ? 'notes' : 'travel'], historyRestore: true } }));
        notify({ restored: { key: entry.key, id: entry.recordId } });
        selectedSignature = Core.signature(plan.record);
        feedback(t('Record restored.', '记录已恢复。'), 'success');
        preview.hidden = true; selected = null; render();
      } catch (error) {
        feedback('', 'error');
        const changed = error.message === 'RECORD_CHANGED';
        if (changed) status.textContent = t('This record changed after preview. Open its preview again before restoring.', '此记录在预览后已更改，请重新预览再恢复。');
        else if (error.message === 'STORE_LIMIT' || error.code === 'NOTES_LIMIT') status.textContent = entry.key === 'dayfly-notes-v1' ? t('Notes are full (100 notes). Export or remove another note before restoring. Current data was kept.', '笔记已满（100 条），请先导出或移除其他笔记再恢复。当前数据已保留。') : entry.key === 'todo-app-v2' ? t('Tasks are full (1,000 tasks). Export or remove another task before restoring. Current data was kept.', '任务已满（1,000 条），请先导出或移除其他任务再恢复。当前数据已保留。') : t('Trips are full (100 trips). Export or remove another trip before restoring. Current data was kept.', '行程已满（100 趟），请先导出或移除其他行程再恢复。当前数据已保留。');
        else if (error.code === 'NOTES_SIZE') status.textContent = t('Notes storage is full. Export or shorten another note before restoring. Current data was kept.', '笔记存储已满，请先导出或缩短其他笔记再恢复。当前数据已保留。');
        else if (error.message === 'NOTES_INVALID') status.textContent = t('Some current notes need repair before restoring. Export a backup first. Current data was kept.', '当前部分笔记需要修复，请先导出备份。当前数据已保留。');
        else if (error.message === 'RESTORE_BACKUP_UNAVAILABLE') status.textContent = t('The current record is too large to preserve safely before restoring. Export a backup first; current data was kept.', '当前记录过大，恢复前无法安全保留版本。请先导出备份；当前数据已保留。');
        else status.textContent = t('Could not restore this record. Current data was kept; please try again.', '暂时无法恢复，当前数据已保留，请重试。');
        if (changed) control.disabled = true;
      }
    }
    mode.addEventListener('change', render); domain.addEventListener('change', () => { recordFilter = null; render(); }); query.addEventListener('input', render);
    const shortcuts = document.querySelector('.workspace-task-shortcuts');
    const entry = button(t('History', '历史'), () => open()); entry.dataset.historyOpen = ''; entry.dataset.i18nIgnore = '';
    if (shortcuts) shortcuts.append(entry);
    else {
      const anchor = document.querySelector('.today-list-actions, .m-add-bar');
      if (anchor) { const tools = element('div', '', 'workspace-task-shortcuts'); tools.append(entry); anchor.append(tools); }
      else { const account = document.querySelector('.auth-data-tools'); if (account) { entry.className = 'auth-data-tools'; account.after(entry); } }
    }
    const tripTools = document.querySelector('.travel-workspace-actions, .travel-header-actions, .travel-hero-actions');
    if (tripTools && !shortcuts) { const control = button(t('History & recycle bin', '历史与回收站'), () => open({ key: 'travel-book-v1' })); control.className = 'btn'; control.dataset.historyOpen = ''; tripTools.append(control); }
    api.open = open;
    window.addEventListener('daily-space-history-updated', event => {
      if (root.hidden || !sameOwner()) return;
      if (event.detail?.failed) feedback(t('Your change was saved, but history could not be updated. Free device space and try the next edit again.', '修改已保存，但历史未能更新，请释放设备空间后重试。'), 'warning');
      render();
    });
    window.addEventListener('daily-space-agent-data-updated', () => { if (!root.hidden) render(); });
    window.addEventListener('daily-space-auth-updated', () => { close(true, true); openedOwner = ''; list.replaceChildren(); });
    window.addEventListener('daily-space-user-sync-updated', () => { if (!root.hidden && !sameOwner()) close(true, true); });
    window.addEventListener('daily-space-locale-changed', () => { entry.textContent = t('History', '历史'); if (!root.hidden) close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
