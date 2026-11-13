/** References are derived from the supplied records, never model-generated URLs. */
(function (global) {
  function references(context) {
    const result = [], seen = new Set();
    function add(type, id, label, page, focus, extra) {
      if (typeof id !== 'string' || !id || id.length > 200) return;
      const key = `${type}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const params = Object.entries({ focus, id, ...extra }).map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`).join('&');
      result.push({ key, label: String(label || id).slice(0, 100), href: `${page}?${params}` });
    }
    for (const item of context?.todo?.todos || []) add('todo', item.id, item.text, 'todo.html', 'todo');
    for (const item of context?.calendar?.reminders || []) add('reminder', item.id, item.text, 'calendar.html', 'reminder');
    for (const [board, value] of Object.entries(context?.planner?.boards || {})) {
      for (const item of value?.entries || []) add('card', item.id, item.title, 'planner.html', 'card', { board });
    }
    for (const item of context?.tally?.records || []) add('expense', item.id, `${item.date} · ${item.category} · ${item.amount}`, 'tally.html', 'expense');
    for (const item of context?.notes || []) add('note', item.id, item.title, 'todo.html', 'note');
    for (const item of context?.travel?.trips || []) add('trip', item.id, item.name, 'travel.html', 'trip');
    return result;
  }
  function resolve(context, requested) {
    const catalog = new Map(references(context).map(item => [item.key, item]));
    return [...new Set(Array.isArray(requested) ? requested : [])].slice(0, 8).map(key => catalog.get(key)).filter(Boolean);
  }
  const api = { references, resolve };
  if (global) global.DailySpaceAgentSources = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : null);
