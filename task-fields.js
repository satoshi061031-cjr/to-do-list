/** Shared task detail fields: keep every editor and recurrence compatible. */
(function () {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  };
  function sourceUrl(value) {
    try { const url = new URL(String(value || '').slice(0, 2000)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch (_) { return null; }
  }
  function fields(value = {}) {
    const seen = new Set();
    return {
      inbox: value.inbox === true,
      priority: ['low', 'high'].includes(value.priority) ? value.priority : 'normal',
      todayPinDate: validDate(value.todayPinDate),
      todayPinOrder: Number.isInteger(value.todayPinOrder) && value.todayPinOrder >= 0 ? Math.min(value.todayPinOrder, 2) : 0,
      createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && value.createdAt <= 8640000000000000 ? value.createdAt : null,
      completedAt: value.completed && Number.isSafeInteger(value.completedAt) && value.completedAt > 0 && value.completedAt <= 8640000000000000 ? value.completedAt : null,
      sourceUrl: sourceUrl(value.sourceUrl),
      notes: String(value.notes || '').slice(0, 10000),
      subtasks: (Array.isArray(value.subtasks) ? value.subtasks : []).slice(0, 100).filter(item =>
        item && typeof item.id === 'string' && !seen.has(item.id) && seen.add(item.id)
      ).map(item => ({ id: item.id.slice(0, 120), text: String(item.text || '').slice(0, 500), completed: Boolean(item.completed) })),
      remindAt: Number.isFinite(value.remindAt) && value.remindAt > 0 ? value.remindAt : null,
      sourceReminderId: typeof value.sourceReminderId === 'string' ? value.sourceReminderId : null,
      sourcePlannerId: typeof value.sourcePlannerId === 'string' ? value.sourcePlannerId : null,
      sourceTripId: typeof value.sourceTripId === 'string' && value.sourceTripId.trim() ? value.sourceTripId.slice(0, 120) : null,
      sourceTripName: typeof value.sourceTripName === 'string' ? value.sourceTripName.slice(0, 60) : null,
      sourceTripDate: /^\d{4}-\d{2}-\d{2}$/.test(value.sourceTripDate || '') ? value.sourceTripDate : null,
      externalEventId: typeof value.externalEventId === 'string' ? value.externalEventId : null,
      sourceMailId: typeof value.sourceMailId === 'string' ? value.sourceMailId : null,
      sourceMailUrl: /^https:\/\/mail\.google\.com\//.test(value.sourceMailUrl || '') ? value.sourceMailUrl.slice(0, 2000) : null,
    };
  }
  function recurrence(value) {
    return { notes: fields(value).notes, subtasks: fields(value).subtasks.map(item => ({ ...item, id: crypto.randomUUID(), completed: false })), priority: fields(value).priority, inbox: false, todayPinDate: null, todayPinOrder: 0, createdAt: Date.now(), completedAt: null, sourceUrl: fields(value).sourceUrl, remindAt: null };
  }
  function editable(value = {}) {
    return { ...fields(value), text: String(value.text || '').trim().slice(0, 500), dueDate: validDate(value.dueDate),
      dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.dueTime || '') ? value.dueTime : null,
      categoryId: typeof value.categoryId === 'string' && value.categoryId ? value.categoryId : null,
      repeat: ['daily', 'weekly', 'monthly'].includes(value.repeat) ? value.repeat : null };
  }
  function mergeDraft(current, draft = {}) {
    const keys = ['text', 'dueDate', 'dueTime', 'categoryId', 'repeat', 'notes', 'subtasks', 'inbox', 'priority', 'sourceUrl'];
    const candidate = editable(draft), latest = editable(current || {});
    const base = draft._baseTask && draft._baseTask.id === current?.id ? editable(draft._baseTask) : null;
    const patch = {}, conflicts = [];
    for (const key of keys) {
      if (!Object.hasOwn(draft, key)) continue;
      const desired = JSON.stringify(candidate[key]), prior = base && JSON.stringify(base[key]);
      if (base && desired === prior) continue;
      if (base && JSON.stringify(latest[key]) !== prior && JSON.stringify(latest[key]) !== desired) conflicts.push(key);
      patch[key] = candidate[key];
    }
    return { patch, conflicts: draft._forceTaskChanges === true ? [] : conflicts };
  }
  function source(value) {
    if (value.sourceTripId) return { href: `travel.html?focus=trip&id=${encodeURIComponent(value.sourceTripId)}`, label: 'Travel', zh: '来源旅行' };
    if (value.sourceMailId) return { href: fields(value).sourceMailUrl || 'mail.html', label: 'Mail', zh: '来源邮件' };
    if (value.sourceReminderId) return { href: `calendar.html?focus=reminder&id=${encodeURIComponent(value.sourceReminderId)}`, label: 'Calendar reminder', zh: '来源日历提醒' };
    if (value.sourcePlannerId) {
      let board = '';
      try { const state = JSON.parse(localStorage.getItem('planner-app-v1') || '{}');
        board = Object.keys(state.boards || {}).find(key => state.boards[key]?.entries?.some(item => item.id === value.sourcePlannerId)) || '';
      } catch (_) {}
      return { href: `planner.html?focus=card&id=${encodeURIComponent(value.sourcePlannerId)}&board=${encodeURIComponent(board)}`, label: 'Project card', zh: '来源项目卡片' };
    }
    if (fields(value).sourceUrl) return { href: fields(value).sourceUrl, label: 'Original link', zh: '原始链接' };
    return null;
  }
  const api = { fields, recurrence, source, validDate, sourceUrl, mergeDraft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DailySpaceTaskFields = api;
})();
