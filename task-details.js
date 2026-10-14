/** Quiet task details and explicit multi-selection, shared across Todo layouts. */
(function () {
  const t = (en, zh) => en;
  const localized = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  function element(tag, text, cls) { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; }
  function button(text, action, cls) { const node = element('button', text, cls); node.type = 'button'; node.addEventListener('click', action); return node; }
  function mount(form, anchor) {
    const section = element('details', '', 'task-detail-fields');
    section.append(element('summary', t('Notes & checklist', '备注与子任务')));
    const noteLabel = element('label', t('Notes', '备注'));
    const notes = element('textarea'); notes.maxLength = 10000; notes.rows = 3; notes.dataset.taskNotes = ''; notes.setAttribute('data-i18n-ignore', '');
    notes.placeholder = localized('Details, links, or a next step', '记录细节、链接或下一步');
    window.addEventListener('daily-space-locale-changed', () => { notes.placeholder = localized('Details, links, or a next step', '记录细节、链接或下一步'); }); noteLabel.append(notes);
    const list = element('div', '', 'task-subtasks'); list.dataset.subtasks = '';
    const add = button(t('＋ Add a subtask', '＋ 添加子任务'), () => {
      if (list.children.length >= 100) return;
      row({ id: crypto.randomUUID(), text: '', completed: false });
      list.lastElementChild.querySelector('[data-subtask-text]').focus(); form.dispatchEvent(new Event('input', { bubbles: true }));
    }); add.dataset.subtaskAdd = '';
    const source = element('a', '', 'task-source-link'); source.hidden = true; source.setAttribute('data-i18n-ignore', '');
    const postpone = element('div', '', 'task-snooze-actions');
    let currentId = null, currentLink = null;
    window.addEventListener('daily-space-locale-changed', () => { if (currentLink) source.textContent = `${localized(currentLink.label, currentLink.zh)} ›`; });
    for (const [minutes, en, zh] of [[10, 'Remind in 10 min', '10 分钟后提醒'], ['tomorrow', 'Remind tomorrow', '明天提醒']]) {
      postpone.append(button(t(en, zh), async () => { if (currentId) await window.DailySpaceReminders?.defer('todo', currentId, minutes); }));
    }
    section.append(noteLabel, list, add); anchor.after(section, source, postpone);
    function row(item) {
      const node = element('div', '', 'task-subtask-row'); node.dataset.subtaskId = item.id;
      const label = element('label', '', 'task-subtask-check'); const check = element('input'); check.type = 'checkbox'; check.checked = item.completed; check.setAttribute('aria-label', t('Complete subtask', '完成子任务')); label.append(check);
      const input = element('input'); input.type = 'text'; input.value = item.text; input.maxLength = 500; input.dataset.subtaskText = ''; input.setAttribute('data-i18n-ignore', ''); input.setAttribute('aria-label', t('Subtask', '子任务'));
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.isComposing && event.keyCode !== 229) add.click(); } });
      const remove = button('×', () => { node.remove(); form.dispatchEvent(new Event('input', { bubbles: true })); }); remove.setAttribute('aria-label', t('Remove subtask', '删除子任务'));
      node.append(label, input, remove); list.append(node);
    }
    return {
      value: () => ({ notes: notes.value, subtasks: [...list.children].map(node => ({ id: node.dataset.subtaskId, text: node.querySelector('[data-subtask-text]').value.trim(), completed: node.querySelector('[type=checkbox]').checked })).filter(item => item.text) }),
      fill(value, task = value) {
        const fields = window.DailySpaceTaskFields.fields(value || {}); notes.value = fields.notes; list.replaceChildren(); fields.subtasks.forEach(row);
        section.open = Boolean(fields.notes || fields.subtasks.length); currentId = task?.id || null; postpone.hidden = !currentId || task?.completed;
        const link = window.DailySpaceTaskFields.source(task || {}); currentLink = link; source.hidden = !link;
        if (link) { source.textContent = `${localized(link.label, link.zh)} ›`; source.href = link.href; if (link.href.startsWith('https:')) { source.target = '_blank'; source.rel = 'noopener noreferrer'; } else { source.removeAttribute('target'); } }
      },
    };
  }
  function boot() {
    const api = window.DailySpaceTodo;
    if (!api) return;
    if (!document.body.classList.contains('todo-mobile')) {
      const root = element('div', '', 'task-desktop-editor'); root.hidden = true; root.dataset.dialogRoot = '';
      root.innerHTML = `<button type="button" class="task-desktop-backdrop" data-dialog-close aria-label="${t('Close task editor', '关闭任务编辑器')}"></button>
        <section role="dialog" aria-modal="true" aria-labelledby="task-desktop-title" class="task-desktop-panel">
          <header><h2 id="task-desktop-title">${t('Task details', '任务详情')}</h2><button type="button" data-dialog-close aria-label="${t('Close', '关闭')}">×</button></header>
          <form class="task-desktop-form"><div class="task-desktop-body">
            <label>${t('Task', '任务')}<input name="text" maxlength="500" required data-i18n-ignore></label>
            <div class="task-desktop-dates"><label>${t('Date', '日期')}<input name="dueDate" type="date"></label><label>${t('Time', '时间')}<input name="dueTime" type="time"></label></div>
            <div class="task-desktop-options"><label>${t('Category', '分类')}<select name="categoryId"></select></label><label>${t('Repeat', '重复')}<select name="repeat"><option value="">${t('Once', '一次')}</option><option value="daily">${t('Daily', '每天')}</option><option value="weekly">${t('Weekly', '每周')}</option><option value="monthly">${t('Monthly', '每月')}</option></select></label></div>
            <p class="task-draft-status" role="status"></p></div><button class="btn btn-primary task-desktop-save" type="submit">${t('Save changes', '保存更改')}</button></form>
        </section>`;
      document.body.append(root);
      const form = root.querySelector('form'); const controls = form.elements;
      const extras = mount(form, root.querySelector('.task-desktop-options'));
      let taskId = null, draftKey = '', composing = false;
      const read = () => ({ text: controls.text.value, dueDate: controls.dueDate.value, dueTime: controls.dueTime.value, categoryId: controls.categoryId.value || null, repeat: controls.repeat.value || null, ...extras.value() });
      const stash = () => { if (!root.hidden && draftKey) localStorage.setItem(draftKey, JSON.stringify(read())); };
      const historyController = window.DailySpaceDialogHistory.create('task-details', { isOpen: () => !root.hidden, restore: data => open(data.id, false), close: () => close(true) });
      window.DailySpaceDialogHistory.fitViewport(root);
      function open(id, push = true) {
        const task = api.getTasks().find(item => item.id === id); if (!task) return;
        taskId = id; draftKey = `daily-space-task-draft:${window.DailySpaceView.owner()}:${id}`;
        let draft; try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (_) {}
        const value = draft || task;
        controls.text.value = value.text || ''; controls.dueDate.value = value.dueDate || ''; controls.dueTime.value = value.dueTime || ''; controls.repeat.value = value.repeat || '';
        controls.categoryId.replaceChildren(new Option(localized('No category', '无分类'), ''));
        controls.categoryId.dataset.i18nIgnore = ''; api.getCategories().forEach(category => controls.categoryId.add(new Option(category.name, category.id))); controls.categoryId.value = value.categoryId || '';
        extras.fill(value, task); root.querySelector('[role=status]').textContent = draft ? t('Draft restored', '已恢复草稿') : '';
        root.hidden = false; if (push) historyController.push({ id }); controls.text.focus({ preventScroll: true });
      }
      function close(fromHistory = false) { if (root.hidden) return; stash(); root.hidden = true; if (!fromHistory) historyController.back(); }
      root.querySelectorAll('[data-dialog-close]').forEach(node => node.addEventListener('click', () => close()));
      form.addEventListener('input', stash); form.addEventListener('change', stash); window.addEventListener('pagehide', stash);
      form.addEventListener('compositionstart', () => { composing = true; }); form.addEventListener('compositionend', () => { composing = false; stash(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (composing || !form.reportValidity()) return;
        if (!api.saveTask(read(), taskId)) { root.querySelector('[role=status]').textContent = t('This task is no longer available.', '这条任务已不存在。'); return; }
        localStorage.removeItem(draftKey); root.hidden = true; historyController.back();
      });
      window.addEventListener('daily-space-auth-updated', () => { root.hidden = true; draftKey = ''; });
      window.DailySpaceTaskDetails.open = open;
    }
    const list = document.getElementById('todo-list');
    const head = element('div', '', 'task-selection-head');
    const selected = new Set(); let selecting = false;
    const toggle = button(t('Select', '选择'), () => { selecting = !selecting; selected.clear(); refresh(); }); toggle.id = 'task-select-mode';
    const allLabel = element('label', '', 'task-select-all'); const all = element('input'); all.type = 'checkbox'; all.id = 'task-select-all'; allLabel.append(all, element('span', t('Select visible', '选择当前列表')));
    head.append(allLabel, toggle); list.before(head);
    const bar = element('div', '', 'task-batch-bar'); bar.hidden = true; bar.setAttribute('aria-label', t('Batch task actions', '批量任务操作'));
    const count = element('span', '', 'task-batch-count'); count.setAttribute('role', 'status'); count.dataset.i18nIgnore = '';
    const complete = button(t('Complete', '完成'), () => apply('complete'));
    const tomorrow = button(t('Tomorrow', '移到明天'), () => { const value = new Date(); value.setDate(value.getDate() + 1); apply('date', localIso(value)); });
    const day = element('input'); day.type = 'date'; day.setAttribute('aria-label', t('Reschedule date', '改期日期'));
    const move = button(t('Reschedule', '改期'), () => { if (day.value) apply('date', day.value); }); move.disabled = true; day.addEventListener('input', () => { move.disabled = !day.value || !selected.size; });
    const category = element('select'); category.dataset.i18nIgnore = ''; category.setAttribute('aria-label', t('Batch category', '批量分类'));
    const categorise = button(t('Set category', '设置分类'), () => apply('category', category.value || null));
    const primary = element('div', '', 'task-batch-primary'); primary.append(count, complete, tomorrow);
    const secondary = element('details', '', 'task-batch-options'); secondary.append(element('summary', t('Date & category', '日期与分类')));
    const choices = element('div', '', 'task-batch-choices'); choices.append(day, move, category, categorise); secondary.append(choices);
    const saveTemplate = button(t('Save as template', '存为模板'), () => window.DailySpaceWorkspaceTools?.saveTemplate([...selected]));
    saveTemplate.dataset.saveTemplate = ''; secondary.append(saveTemplate); bar.append(primary, secondary); document.body.append(bar);
    function localIso(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
    function visibleRows() { return [...list.querySelectorAll('.todo-item:not(.is-leaving)')]; }
    function apply(action, value) { if (!selected.size) return; api.batchTasks([...selected], action, value); selected.clear(); selecting = false; refresh(); toggle.focus({ preventScroll: true }); }
    function refresh() {
      const personal = api.getView().source === 'personal'; head.hidden = !personal; if (!personal) { selecting = false; selected.clear(); }
      const rows = visibleRows(); const ids = new Set(rows.map(row => row.dataset.id)); selected.forEach(id => { if (!ids.has(id)) selected.delete(id); });
      document.body.classList.toggle('task-selecting', selecting); allLabel.hidden = !selecting; bar.hidden = !selecting;
      if (!selecting) secondary.open = false;
      toggle.textContent = selecting ? t('Cancel selection', '取消选择') : t('Select', '选择'); toggle.setAttribute('aria-pressed', String(selecting));
      all.checked = rows.length > 0 && selected.size === rows.length; all.indeterminate = selected.size > 0 && selected.size < rows.length; all.disabled = !rows.length;
      rows.forEach(row => {
        let check = row.querySelector('.task-batch-check input');
        if (!check) { const label = element('label', '', 'task-batch-check'); check = element('input'); check.type = 'checkbox'; check.dataset.i18nIgnore = ''; check.setAttribute('aria-label', `${localized('Select task', '选择任务')}: ${row.querySelector('.todo-label')?.textContent || ''}`);
          check.addEventListener('change', () => { if (check.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id); refresh(); }); label.append(check); row.prepend(label); }
        const editable = row.querySelector('.todo-label[contenteditable]');
        if (editable) { editable.contentEditable = String(!selecting); if (selecting) editable.setAttribute('tabindex', '-1'); else editable.removeAttribute('tabindex'); }
        check.setAttribute('aria-label', `${localized('Select task', '选择任务')}: ${row.querySelector('.todo-label')?.textContent || ''}`);
        check.checked = selected.has(row.dataset.id); row.classList.toggle('task-is-selected', check.checked);
      });
      count.textContent = `${selected.size} ${localized('selected', '项已选')}`; [complete, tomorrow, categorise, saveTemplate].forEach(node => { node.disabled = !selected.size; }); move.disabled = !selected.size || !day.value;
      const current = category.value; category.replaceChildren(new Option(localized('No category', '无分类'), '')); api.getCategories().forEach(item => category.add(new Option(item.name, item.id))); category.value = current;
      window.dispatchEvent(new Event('resize'));
    }
    window.DailySpaceTaskDetails.clearSelection = () => { selecting = false; selected.clear(); refresh(); };
    all.addEventListener('change', () => { selected.clear(); if (all.checked) visibleRows().forEach(row => selected.add(row.dataset.id)); refresh(); });
    const selectRow = event => { if (!selecting || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
      const main = event.target.closest('.todo-main'); if (!main) return; event.preventDefault(); event.stopImmediatePropagation(); const id = main.closest('.todo-item').dataset.id;
      if (selected.has(id)) selected.delete(id); else selected.add(id); refresh(); };
    list.addEventListener('click', selectRow, true); list.addEventListener('keydown', selectRow, true);
    new MutationObserver(refresh).observe(list, { childList: true });
    window.addEventListener('daily-space-locale-changed', refresh); window.addEventListener('daily-space-todo-view-updated', refresh); window.addEventListener('daily-space-auth-updated', () => { selected.clear(); selecting = false; refresh(); }); refresh();
  }
  window.DailySpaceTaskDetails = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
