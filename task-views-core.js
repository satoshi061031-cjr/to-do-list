/** Named task views contain filters only; they never duplicate task records. */
(function (global) {
  const KEY = 'dayfly-task-views-v1';
  const clean = (value, max = 60) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const result = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === value ? value : null;
  }
  function normalize(raw) {
    const seen = new Set();
    const views = (Array.isArray(raw?.views) ? raw.views : []).slice(0, 30).filter(value => {
      const id = clean(value?.id, 120);
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id) || seen.has(id) || !clean(value?.name)) return false;
      seen.add(id); return true;
    }).map(value => ({ id: clean(value.id, 120), name: clean(value.name),
      filter: ['all', 'completed', 'today'].includes(value.filter) ? value.filter : 'active',
      range: value.range === 'week' ? 'week' : 'day', day: date(value.day),
      dayMode: ['today', 'all'].includes(value.dayMode) ? value.dayMode : 'fixed',
      categoryId: clean(value.categoryId, 120) || null,
      mode: ['inbox', 'top'].includes(value.mode) ? value.mode : 'tasks',
      priority: ['high', 'normal', 'low'].includes(value.priority) ? value.priority : 'all',
      ...(value.source === 'assigned' ? { source: 'assigned' } : {}),
    }));
    return { version: 1, views };
  }
  const api = { KEY, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.DailySpaceTaskViewsCore = api;
})(typeof window !== 'undefined' ? window : null);
