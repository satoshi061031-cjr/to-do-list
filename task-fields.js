/** Shared task detail fields: keep every editor and recurrence compatible. */
(function () {
  function fields(value = {}) {
    const seen = new Set();
    return {
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
    return { notes: fields(value).notes, subtasks: fields(value).subtasks.map(item => ({ ...item, id: crypto.randomUUID(), completed: false })), remindAt: null };
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
    return null;
  }
  window.DailySpaceTaskFields = { fields, recurrence, source };
})();
