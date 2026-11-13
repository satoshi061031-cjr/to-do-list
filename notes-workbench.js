/** A small private notebook; related records keep their original pages and IDs. */
(function () {
  function boot() {
    const Core = window.DailySpaceNotesCore;
    if (!Core || !window.DailySpaceDialogHistory) return;
    const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
    const owner = () => String(window.DailySpaceView?.owner() || 'guest').toLowerCase();
    const ready = () => window.DailySpaceWorkbenchPreferences?.ready() === true;
    const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; el.dataset.i18nIgnore = ''; return el; };
    const action = (text, run, cls = '') => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', run); return el; };
    const parse = key => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); };
    function read() { return ready() ? Core.normalize(parse(Core.KEY)) : { version: 1, notes: [] }; }
    function write(value) {
      if (!ready()) throw new Error(t('Workspace is still loading. Try again shortly.', '工作台正在加载，请稍后重试。'));
      const before = localStorage.getItem(Core.KEY), after = JSON.stringify(Core.normalize(value)), who = owner();
      try {
        localStorage.setItem(Core.KEY, after);
        if (!ready() || who !== owner() || localStorage.getItem(Core.KEY) !== after) throw new Error('Storage did not retain the note.');
      } catch (cause) {
        try { if (who === owner()) { if (before === null) localStorage.removeItem(Core.KEY); else localStorage.setItem(Core.KEY, before); } } catch (_) {}
        throw Object.assign(new Error(t('Could not save this note on the device. Your draft is still here; free space and retry.', '无法保存到本机，草稿仍在；请释放空间后重试。')), { cause });
      }
      try { window.DailySpaceHistory?.capture(Core.KEY, before, after); } catch (_) { /* Primary note save is already verified. */ }
      window.dispatchEvent(new CustomEvent('daily-space-notes-updated'));
      window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['notes'] } }));
      return Core.normalize(value);
    }
    const selectedKey = () => `dayfly-notes-context:${owner()}`;
    function selectedIds() { try { const value = JSON.parse(sessionStorage.getItem(selectedKey()) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 5) : []; } catch (_) { return []; } }
    function selectNote(id, selected) {
      const ids = selectedIds().filter(value => value !== id);
      if (selected && ids.length >= 5) throw new Error(t('Choose at most five notes for Agent.', '最多选择五篇笔记作为代理资料。'));
      if (selected) ids.push(id);
      sessionStorage.setItem(selectedKey(), JSON.stringify(ids));
      window.dispatchEvent(new CustomEvent('daily-space-notes-context-updated'));
    }
    function selectedContext() { try { return ready() ? Core.context(read(), selectedIds()) : []; } catch (_) { return []; } }
    function entities() {
      if (!ready()) return [];
      const optional = key => { try { return parse(key) || {}; } catch (_) { return {}; } };
      const todo = optional('todo-app-v2'), planner = optional('planner-app-v1'), travel = optional('travel-book-v1');
      const out = [];
      for (const item of (Array.isArray(todo.todos) ? todo.todos : []).slice(0, 200)) out.push({ type: 'todo', id: item.id, label: `${t('Task', '任务')} · ${item.text}` });
      for (const board of Object.values(planner.boards || {})) for (const item of (Array.isArray(board.entries) ? board.entries : []).slice(0, 100)) out.push({ type: 'planner', id: item.id, label: `${t('Project card', '项目卡片')} · ${item.title}` });
      for (const item of (Array.isArray(travel.trips) ? travel.trips : []).slice(0, 100)) out.push({ type: 'trip', id: item.id, label: `${t('Trip', '旅行')} · ${item.name}` });
      return out.filter(item => item.id && item.label);
    }
    function entityLabel(link) { return entities().find(item => item.type === link.type && item.id === link.id)?.label || `${t('Linked item', '关联条目')} · ${link.id}`; }
    const root = node('div', '', 'notes-sheet'); root.id = 'notes-sheet'; root.hidden = true; root.dataset.dialogRoot = '';
    const backdrop = action('', () => close(), 'notes-backdrop'); backdrop.dataset.dialogClose = ''; backdrop.setAttribute('aria-label', t('Close notes', '关闭笔记'));
    const panel = node('section', '', 'notes-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'notes-title');
    const header = node('header'), heading = node('h2', t('Notes', '笔记')); heading.id = 'notes-title';
    const closeButton = action('×', () => close()); closeButton.dataset.dialogClose = ''; closeButton.setAttribute('aria-label', t('Close notes', '关闭笔记'));
    header.append(heading, closeButton);
    const content = node('div', '', 'notes-body'), status = node('p', '', 'notes-status'); status.setAttribute('role', 'status');
    panel.append(header, content, status); root.append(backdrop, panel); document.body.append(root);
    const motion = window.DailySpaceDialogHistory.motion(root);
    const historyController = window.DailySpaceDialogHistory.create('notes', { isOpen: () => !root.hidden && !motion.closing,
      restore: data => open(data.id || null, { list: data.mode === 'list', push: false }), close: () => close(true) });
    window.DailySpaceDialogHistory.fitViewport(root);
    let activeOwner = '', activeId = null, workingId = '', baseline = '', form = null, draftKey = '', mode = 'list', formLinks = [], composing = false, trigger = null, query = '';
    let relationQueued = false;
    const draftName = id => `dayfly-note-draft:${owner()}:${id || 'new'}`;
    const active = () => !root.hidden && !motion.closing && ready() && owner() === activeOwner;
    function message(value, tone = value && typeof value === 'object' && value.message ? 'error' : 'info') {
      if (window.DailySpaceFeedback) window.DailySpaceFeedback.set(status, value, tone);
      else { status.textContent = value?.message || String(value || ''); status.dataset.feedback = tone; }
    }
    function formValue() {
      return { id: workingId, title: form.elements.title.value, body: form.elements.body.value,
        sourceUrl: form.elements.sourceUrl.value, tags: form.elements.tags.value, links: formLinks };
    }
    function stash() {
      if (mode !== 'edit' || !form || !active() || !draftKey) return;
      try { localStorage.setItem(draftKey, JSON.stringify({ ...formValue(), baseline })); } catch (_) { message(t('Draft could not be stored. Keep this editor open and retry saving.', '草稿未能保存，请保留编辑器并重试保存。')); }
    }
    function close(fromHistory = false, immediate = false) {
      if (!root.hidden && !motion.closing) stash();
      motion.close(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }, immediate);
      if (!fromHistory) historyController.back();
    }
    function open(id = null, options = {}) {
      if (!ready()) return false;
      if (!root.hidden && owner() === activeOwner) stash();
      activeOwner = owner(); trigger = document.activeElement; status.textContent = '';
      const nextMode = options.list ? 'list' : 'edit';
      if (options.push !== false && !historyController.push({ mode: nextMode, id })) return false;
      motion.open();
      try { if (nextMode === 'list') showList(); else showEditor(id, options.link); }
      catch (error) { content.replaceChildren(); message(error); }
      return true;
    }
    function showList() {
      mode = 'list'; form = null; activeId = null; draftKey = ''; heading.textContent = t('Notes', '笔记'); content.replaceChildren();
      panel.querySelector('.notes-footer')?.remove();
      content.className = 'notes-body';
      const controls = node('div', '', 'notes-controls'), search = node('input'); search.type = 'search'; search.placeholder = t('Search notes or tags', '搜索笔记或标签'); search.setAttribute('aria-label', search.placeholder); search.value = query;
      const list = node('ul', '', 'notes-list'); list.id = 'notes-list';
      const render = () => {
        const notes = read().notes.filter(note => `${note.title} ${note.body} ${note.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
        list.replaceChildren();
        for (const note of notes) {
          const li = node('li'), control = action('', () => open(note.id), 'notes-list-open'); control.dataset.noteId = note.id;
          control.append(node('strong', note.title), node('span', note.body.replace(/\s+/g, ' ').slice(0, 110) || note.tags.map(tag => `#${tag}`).join(' ')));
          li.append(control); list.append(li);
        }
        if (!notes.length) list.append(node('li', t('Save an idea, a link or something worth keeping.', '记下想法、链接，或值得保留的资料。'), 'notes-helper'));
      };
      search.addEventListener('input', () => { query = search.value; render(); });
      const create = action(t('New note', '新建笔记'), () => open()); create.dataset.noteNew = '';
      controls.append(search, create); content.append(controls, list); render(); search.focus({ preventScroll: true });
    }
    function showEditor(id, initialLink) {
      const state = read(), stored = id ? state.notes.find(note => note.id === id) : null;
      if (id && !stored) { showList(); message(t('This note is no longer available.', '这篇笔记已不存在。')); return; }
      mode = 'edit'; activeId = id; draftKey = draftName(id); baseline = JSON.stringify(stored);
      let draft = null; try { draft = parse(draftKey); } catch (_) {}
      const value = draft || stored || { title: '', body: '', tags: [], links: initialLink ? [initialLink] : [] };
      workingId = stored?.id || Core.normalizeNote({ ...value, title: value.title || 'draft' })?.id || crypto.randomUUID();
      if (draft?.baseline !== undefined) baseline = draft.baseline;
      formLinks = Core.links(value.links);
      heading.textContent = stored ? t('Note', '笔记') : t('New note', '新建笔记');
      content.replaceChildren(); content.className = 'notes-body notes-editor-body';
      const back = action(t('All notes', '全部笔记'), () => { stash(); historyController.push({ mode: 'list' }); showList(); });
      form = node('form', '', 'notes-form'); form.id = 'notes-form'; form.autocomplete = 'off';
      const fields = node('div', '', 'notes-edit-fields');
      function field(name, label, tag = 'input') {
        const wrap = node('label', label), input = node(tag); input.name = name;
        if (tag === 'input') input.type = name === 'sourceUrl' ? 'url' : 'text';
        input.value = name === 'tags' && Array.isArray(value[name]) ? value[name].join(', ') : value[name] || '';
        input.maxLength = name === 'body' ? 10000 : name === 'title' ? 80 : name === 'sourceUrl' ? 2000 : 500;
        if (tag === 'textarea') input.rows = 7;
        wrap.append(input); fields.append(wrap); return input;
      }
      const title = field('title', t('Title', '标题')); field('body', t('Text · Markdown is kept as plain text', '正文 · Markdown 按纯文本保留'), 'textarea'); field('sourceUrl', t('Original link (optional)', '原文链接（可选）')); field('tags', t('Tags, separated by commas', '标签，以逗号分隔'));
      const relationLabel = node('p', t('Related tasks, project cards and trips', '关联任务、项目卡片与旅行'), 'notes-helper');
      const picker = node('div', '', 'notes-link-picker'), select = node('select'); select.name = 'relation'; select.setAttribute('aria-label', t('Choose a related item', '选择关联条目'));
      select.append(new Option(t('Choose a related item', '选择关联条目'), ''));
      for (const item of entities()) select.append(new Option(item.label, `${item.type}:${item.id}`));
      const linked = node('ul', '', 'notes-links');
      function renderLinks() {
        linked.replaceChildren();
        for (const link of formLinks) {
          const li = node('li'), anchor = node('a', entityLabel(link)); anchor.href = Core.href(link);
          const remove = action('×', () => { formLinks = formLinks.filter(item => item !== link); renderLinks(); stash(); }); remove.setAttribute('aria-label', t('Unlink item', '取消关联'));
          li.append(anchor, remove); linked.append(li);
        }
      }
      picker.append(select, action(t('Link', '关联'), () => {
        if (!select.value) return;
        const split = select.value.indexOf(':'), link = { type: select.value.slice(0, split), id: select.value.slice(split + 1) };
        if (formLinks.length >= 20) { message(t('Keep at most 20 links per note.', '每篇笔记最多关联 20 个条目。')); return; }
        formLinks = Core.links([...formLinks, link]); renderLinks(); stash(); select.value = '';
      })); renderLinks();
      const selectedLabel = node('label', '', 'notes-context-toggle'), include = node('input'); include.type = 'checkbox'; include.name = 'agentContext'; include.checked = selectedIds().includes(workingId);
      selectedLabel.append(include, node('span', t('Use this saved note as Agent context', '将这篇已保存笔记选为代理资料')));
      include.addEventListener('change', () => { try { selectNote(workingId, include.checked); message(''); } catch (error) { include.checked = false; message(error); } });
      const more = node('div', '', 'notes-note-actions');
      more.append(action(t('Create task', '生成任务'), () => createTask()), action(t('Ask Agent', '询问代理'), () => askAgent()));
      if (stored) more.append(action(t('Delete note', '删除笔记'), () => deleteNote(stored)));
      fields.append(relationLabel, picker, linked, selectedLabel, more);
      const footer = node('div', '', 'notes-footer'), save = node('button', t('Save note', '保存笔记'), 'notes-primary'); save.type = 'submit'; save.setAttribute('form', 'notes-form'); footer.append(save);
      form.append(fields); content.append(back, form); panel.querySelector('.notes-footer')?.remove(); panel.append(footer);
      form.addEventListener('input', stash); form.addEventListener('change', stash);
      form.addEventListener('compositionstart', () => { composing = true; }); form.addEventListener('compositionend', () => { composing = false; stash(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (!composing && !motion.closing) saveEditor(); });
      if (draft) message(t('Draft restored. Save when ready.', '已恢复草稿，准备好后保存。'));
      if (draft && JSON.stringify(stored || null) !== baseline) showConflict(stored);
      title.focus({ preventScroll: true });
    }
    function showConflict(saved) {
      if (!form) return;
      form.querySelector('.notes-conflict')?.remove();
      const box = node('section', '', 'notes-conflict'), summary = node('p', t('The saved note changed while this draft was open. Choose which text to continue with.', '已保存笔记在草稿编辑期间发生更改，请选择继续使用哪个版本。'), 'notes-helper');
      const preview = node('details'); preview.append(node('summary', t('View saved version', '查看已保存版本')), node('p', saved?.title || t('This note was deleted.', '这篇笔记已删除。')), node('pre', saved?.body || ''));
      const choices = node('div', '', 'notes-note-actions');
      choices.append(action(t('Continue with my draft', '继续使用我的草稿'), () => {
        baseline = JSON.stringify(saved || null); activeId = saved?.id || null; box.remove(); stash(); message(t('Draft kept. Review it and save when ready.', '已保留草稿，检查后可重新保存。'));
      }), action(t('Use saved version', '使用已保存版本'), () => {
        try { localStorage.removeItem(draftKey); } catch (_) {}
        if (saved) { showEditor(saved.id); message(''); } else { draftKey = ''; form = null; showList(); }
      }));
      box.append(summary, preview, choices); form.prepend(box);
    }
    function saveEditor() {
      if (!active() || mode !== 'edit' || composing || !form.reportValidity()) return null;
      try {
        const current = read(), existing = current.notes.find(note => note.id === workingId) || null;
        if (JSON.stringify(existing) !== baseline) { stash(); showConflict(existing); message(t('Review the saved version before replacing it.', '请先检查已保存版本，再决定是否替换。')); return null; }
        const input = formValue();
        if (input.sourceUrl.trim() && !Core.safeUrl(input.sourceUrl)) throw new Error(t('Use a complete http or https link without a username or password.', '请输入完整的 http 或 https 链接，且不要包含账号密码。'));
        const next = write(Core.upsert(current, input));
        const saved = next.notes.find(note => note.id === workingId);
        activeId = saved.id; baseline = JSON.stringify(saved);
        try { localStorage.removeItem(draftKey); } catch (_) {}
        draftKey = draftName(saved.id); historyController.push({ mode: 'edit', id: saved.id });
        message(t('Saved on this device.', '已保存到本机。'), 'success'); return saved;
      } catch (error) { message(error); return null; }
    }
    function deleteNote(note) {
      if (!active()) return;
      try {
        const who = owner(), current = read(), latest = current.notes.find(item => item.id === note.id);
        if (!latest) { showList(); return; }
        if (JSON.stringify(latest) !== baseline) { stash(); showConflict(latest); message(t('The note changed. Review it before deleting.', '笔记已有更改，请检查后再删除。')); return; }
        note = latest;
        write({ notes: current.notes.filter(item => item.id !== note.id) });
        try { localStorage.removeItem(draftKey); selectNote(note.id, false); } catch (_) {}
        draftKey = ''; form = null; historyController.push({ mode: 'list' }); showList();
        const undo = () => {
          if (!ready() || owner() !== who) return;
          try { const value = read(); if (!value.notes.some(item => item.id === note.id)) write({ notes: [note, ...value.notes] }); } catch (error) { message(error); }
        };
        // The shared bar is outside a modal's focus trap. Keep the same undo
        // reachable inside the note sheet until its normal six-second expiry.
        const inlineUndo = action(t('Undo delete', '撤销删除'), undo); content.querySelector('.notes-controls')?.append(inlineUndo);
        setTimeout(() => inlineUndo.remove(), 6000);
        window.DailySpaceUndo?.offer(t('Note deleted', '已删除笔记'), undo);
      } catch (error) { message(error); }
    }
    function createTask() {
      const note = saveEditor(); if (!note) return;
      if (!window.DailySpaceTodo?.saveTask) { location.href = `todo.html?focus=note&id=${encodeURIComponent(note.id)}`; return; }
      try {
        const tasks = window.DailySpaceTodo.getTasks();
        const existing = note.links.find(link => link.type === 'todo' && tasks.some(task => task.id === link.id));
        if (existing) { message(t('This note already links to a task. Open it from Related items.', '这篇笔记已有任务，请从关联条目打开。')); return; }
        const noteUrl = new URL(`todo.html?focus=note&id=${encodeURIComponent(note.id)}`, location.href).href;
        // A previous task save can have succeeded while its note link failed.
        // Recover that relation on retry instead of creating another task.
        const task = tasks.find(item => item.sourceUrl === noteUrl || String(item.notes || '').includes(noteUrl)) ||
          window.DailySpaceTodo.saveTask({ text: note.title, notes: `${note.body.slice(0, 9500)}\n\n${t('Source note', '来源笔记')}: ${noteUrl}`, sourceUrl: noteUrl, inbox: true, dueDate: null, dueTime: null, categoryId: null, repeat: null });
        if (!task?.id) throw new Error(t('The task could not be created.', '任务未能创建。'));
        const next = write(Core.upsert(read(), { ...note, links: [...note.links, { type: 'todo', id: task.id }] }));
        const updated = next.notes.find(item => item.id === note.id);
        baseline = JSON.stringify(updated); formLinks = updated.links; showEditor(note.id); message(t('Task created in the workbench. Both records keep their link.', '已在工作台生成任务，并保留双向关联。'));
      } catch (error) { message(error); }
    }
    function askAgent() {
      const note = saveEditor(); if (!note) return;
      try { selectNote(note.id, true); } catch (error) { message(error); return; }
      if (!window.DailySpaceAgentUi) { message(t('Open the workbench to ask Agent about this saved note.', '可回到工作台，向代理询问这篇已保存笔记。')); return; }
      close();
      setTimeout(() => {
        if (!ready() || owner() !== activeOwner) return;
        window.DailySpaceAgentUi.setOpen(true); window.DailySpaceAgentUi.focusComposer();
        const input = document.querySelector('.todo-agent-input');
        if (input && !input.value) input.value = t('Summarize the selected notes and suggest a next step, citing sources.', '请总结选中的笔记，建议下一步，并标明来源。');
      }, 180);
    }
    function renderRelated(host, entity) {
      if (!host || !entity?.id || !ready()) return;
      let block = [...host.children].find(child => child.classList.contains('notes-related'));
      const notes = Core.forEntity(read(), entity), signature = JSON.stringify([owner(), entity, notes.map(note => [note.id, note.title])]);
      if (block?.dataset.signature === signature) return;
      if (!block) { block = node('section', '', 'notes-related'); host.append(block); }
      block.dataset.signature = signature; block.dataset.notesEntity = `${entity.type}:${entity.id}`; block.replaceChildren(node('h3', t('Related notes', '相关笔记')));
      const links = node('div', '', 'notes-related-list');
      for (const note of notes) links.append(action(note.title, () => open(note.id)));
      const add = action(t('Add note', '添加笔记'), () => open(null, { link: entity })); add.dataset.relatedNoteAdd = ''; links.append(add); block.append(links);
    }
    function relations() {
      relationQueued = false;
      if (!ready()) { document.querySelectorAll('.notes-related').forEach(el => el.remove()); return; }
      try {
        const desktop = document.querySelector('.task-desktop-editor:not([hidden]):not(.is-closing)');
        const taskId = history.state?.workspaceSheet?.key === 'task-details' ? history.state.workspaceSheet.data?.id : history.state?.mobileTaskSheet ? history.state.taskId : null;
        const mobile = document.querySelector('#m-task-editor:not([hidden]):not(.is-closing)');
        if (taskId) renderRelated(desktop?.querySelector('.task-desktop-body') || mobile?.querySelector('form'), { type: 'todo', id: taskId });
        document.querySelectorAll('[data-entry-id] .planner-card-drawer-inner').forEach(host => renderRelated(host, { type: 'planner', id: host.closest('[data-entry-id]').dataset.entryId }));
        const trip = window.DailySpaceTravel?.state()?.trip;
        if (trip) renderRelated(document.getElementById('travel-workspace'), { type: 'trip', id: trip.id });
      } catch (_) { /* Invalid legacy data remains available through its original editor. */ }
    }
    function queueRelations() { if (!relationQueued) { relationQueued = true; queueMicrotask(relations); } }
    const api = { ready, open, list: () => read().notes, forEntity: (entity, id) => Core.forEntity(read(), typeof entity === 'string' ? { type: entity, id } : entity),
      context: selectedContext, selectedContext, select: selectNote, read, save: input => { const next = write(Core.upsert(read(), input)); return next.notes.find(note => note.id === input.id); } };
    window.DailySpaceNotes = api;
    const mainAnchor = document.querySelector('.workspace-task-shortcuts, .today-list-actions, .m-task-controls');
    const launch = node('div', '', 'notes-launch'), launcher = action(t('Notes', '笔记'), () => open(null, { list: true })); launcher.dataset.notesOpen = ''; launch.append(launcher);
    if (mainAnchor) mainAnchor.append(launch);
    else if (document.querySelector('main [data-page-header]')) document.querySelector('main [data-page-header]').after(launch);
    else if (document.querySelector('[data-page-header]')) document.querySelector('[data-page-header]').after(launch);
    function refresh() {
      launcher.disabled = !ready();
      if (!root.hidden && (!ready() || owner() !== activeOwner)) { draftKey = ''; form = null; close(true, true); }
      if (active() && mode === 'list') { try { showList(); } catch (error) { message(error); } }
      queueRelations();
    }
    for (const event of ['daily-space-notes-updated', 'daily-space-agent-data-updated', 'daily-space-user-sync-updated', 'daily-space-travel-view-updated', 'storage', 'popstate']) window.addEventListener(event, refresh);
    window.addEventListener('daily-space-auth-updated', () => { draftKey = ''; form = null; activeOwner = ''; close(true, true); refresh(); });
    window.addEventListener('daily-space-locale-changed', () => { launcher.textContent = t('Notes', '笔记'); if (!root.hidden) close(); queueRelations(); });
    window.addEventListener('pagehide', stash);
    new MutationObserver(queueRelations).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    refresh();
    const target = new URLSearchParams(location.search);
    let targetOpened = false;
    function openTarget() {
      if (targetOpened || target.get('focus') !== 'note' || !ready()) return;
      targetOpened = true; open((target.get('id') || '').slice(0, 120));
    }
    openTarget(); window.addEventListener('daily-space-user-sync-updated', openTarget);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
