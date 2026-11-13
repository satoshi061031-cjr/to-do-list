/** Timestamp-based task focus sessions. No timer ticks or account data live here. */
(function (global) {
  const KEY = 'dayfly-focus-v1';
  const MAX_DURATION = 12 * 60 * 60 * 1000;
  const MAX_SESSIONS = 200;
  const MAX_DAYS = 32;
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const id = value => { const result = clean(value, 120); return result && !['__proto__', 'constructor', 'prototype'].includes(result) ? result : null; };
  const timestamp = value => Number.isSafeInteger(value) && value > 0 && value < 253402300800000 ? value : null;
  const duration = value => Number.isFinite(value) ? Math.min(MAX_DURATION, Math.max(0, Math.floor(value))) : 0;
  const target = value => value === 1500000 || value === 3000000 ? value : 0;
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  function localDate(value = Date.now()) {
    const time = new Date(value);
    return `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
  }
  function normalizeDays(raw, total, fallback) {
    const sums = new Map(); let remaining = total;
    for (const item of Array.isArray(raw) ? raw.slice(0, MAX_DAYS) : []) {
      const day = date(item?.date), ms = Math.min(remaining, duration(item?.durationMs));
      if (!day || !ms) continue;
      sums.set(day, (sums.get(day) || 0) + ms); remaining -= ms;
    }
    if (remaining) {
      if (!sums.has(fallback) && sums.size >= MAX_DAYS) { const last = [...sums.keys()].at(-1); remaining += sums.get(last); sums.delete(last); }
      sums.set(fallback, (sums.get(fallback) || 0) + remaining);
    }
    return [...sums].map(([day, ms]) => ({ date: day, durationMs: ms })).sort((a, b) => a.date.localeCompare(b.date));
  }
  function defaults() { return { version: 1, active: null, sessions: [] }; }
  function normalize(raw, now = Date.now()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults();
    const seen = new Set(), sessions = [];
    const items = Array.isArray(raw.sessions) ? raw.sessions.slice(-MAX_SESSIONS * 2) : [];
    for (const item of [...items].reverse()) {
      const sessionId = id(item?.id), taskId = id(item?.taskId), startedAt = timestamp(item?.startedAt), endedAt = timestamp(item?.endedAt);
      if (!sessionId || !taskId || !startedAt || !endedAt || endedAt < startedAt || endedAt > now || seen.has(sessionId)) continue;
      const durationMs = Math.min(duration(item.durationMs), endedAt - startedAt, target(item.targetMs) || MAX_DURATION);
      if (!durationMs) continue;
      seen.add(sessionId);
      sessions.push({ id: sessionId, taskId, taskTitle: clean(item.taskTitle, 500), startedAt, endedAt, durationMs, targetMs: target(item.targetMs),
        dayTotals: normalizeDays(item.dayTotals, durationMs, localDate(endedAt)) });
    }
    sessions.sort((a, b) => a.endedAt - b.endedAt || a.id.localeCompare(b.id));
    let active = null;
    const item = raw.active, activeId = id(item?.id), taskId = id(item?.taskId), startedAt = timestamp(item?.startedAt);
    if (activeId && taskId && startedAt && startedAt <= now && !seen.has(activeId)) {
      const targetMs = target(item.targetMs);
      const resumedAt = timestamp(item.resumedAt);
      const validResumed = resumedAt && resumedAt >= startedAt && resumedAt <= now ? resumedAt : null;
      const elapsedMs = Math.min(duration(item.elapsedMs), targetMs || MAX_DURATION, (validResumed || now) - startedAt);
      active = { id: activeId, taskId, taskTitle: clean(item.taskTitle, 500), startedAt,
        resumedAt: validResumed,
        elapsedMs, targetMs, dayTotals: normalizeDays(item.dayTotals, elapsedMs, localDate(startedAt)) };
    }
    return { version: 1, active, sessions: sessions.slice(-MAX_SESSIONS) };
  }
  function elapsed(active, now = Date.now()) {
    if (!active) return 0;
    return Math.min(target(active.targetMs) || MAX_DURATION, duration(active.elapsedMs) + (active.resumedAt ? Math.max(0, now - active.resumedAt) : 0));
  }
  function addPeriod(days, startedAt, ms) {
    const sums = new Map(days.map(item => [item.date, item.durationMs]));
    let cursor = startedAt, remaining = ms;
    // An individual uninterrupted interval is at most 12 hours, also across DST.
    for (let count = 0; remaining > 0 && count < 4; count++) {
      const point = new Date(cursor), day = localDate(cursor);
      const tomorrow = new Date(point.getFullYear(), point.getMonth(), point.getDate() + 1).getTime();
      const part = Math.min(remaining, Math.max(1, tomorrow - cursor));
      if (!sums.has(day) && sums.size >= MAX_DAYS) throw new Error('This focus session spans too many days. Finish it and start a new one.');
      sums.set(day, (sums.get(day) || 0) + part); cursor += part; remaining -= part;
    }
    return [...sums].map(([day, value]) => ({ date: day, durationMs: value })).sort((a, b) => a.date.localeCompare(b.date));
  }
  function start(raw, task, targetMs = 1500000, now = Date.now(), sessionId) {
    const state = normalize(raw, now);
    if (state.active) throw new Error('Finish the current focus session first.');
    if (!id(task?.id) || task.completed) throw new Error('Choose an unfinished task.');
    if (![0, 1500000, 3000000].includes(targetMs)) throw new Error('Choose 25 minutes, 50 minutes or free focus.');
    const nextId = id(sessionId) || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `focus-${now}-${Math.random().toString(36).slice(2)}`);
    if (state.sessions.some(item => item.id === nextId)) throw new Error('This focus session already exists.');
    state.active = { id: nextId, taskId: task.id, taskTitle: clean(task.text, 500), startedAt: now, resumedAt: now, elapsedMs: 0, targetMs, dayTotals: [] };
    return state;
  }
  function pause(raw, now = Date.now()) {
    const state = normalize(raw, now), active = state.active;
    if (!active?.resumedAt) return state;
    const nextElapsed = elapsed(active, now), earned = nextElapsed - active.elapsedMs;
    active.dayTotals = addPeriod(active.dayTotals, active.resumedAt, earned);
    active.elapsedMs = nextElapsed; active.resumedAt = null;
    return state;
  }
  function resume(raw, now = Date.now()) {
    const state = normalize(raw, now);
    if (state.active && !state.active.resumedAt && elapsed(state.active, now) < (state.active.targetMs || MAX_DURATION)) state.active.resumedAt = now;
    return state;
  }
  function finish(raw, now = Date.now()) {
    const before = normalize(raw, now), active = before.active;
    if (!active) return { state: before, session: null };
    const limit = active.targetMs || MAX_DURATION;
    const endedAt = active.resumedAt && elapsed(active, now) >= limit ? Math.min(now, active.resumedAt + Math.max(0, limit - active.elapsedMs)) : now;
    const state = pause(before, now), completed = state.active;
    const session = completed.elapsedMs > 0 ? { id: completed.id, taskId: completed.taskId, taskTitle: completed.taskTitle,
      startedAt: completed.startedAt, endedAt, durationMs: completed.elapsedMs, targetMs: completed.targetMs, dayTotals: completed.dayTotals } : null;
    state.active = null;
    if (session) state.sessions = [...state.sessions.filter(item => item.id !== session.id), session].sort((a, b) => a.endedAt - b.endedAt).slice(-MAX_SESSIONS);
    return { state, session };
  }
  function weekBounds(now = Date.now(), offset = 0) {
    const point = new Date(now), monday = new Date(point.getFullYear(), point.getMonth(), point.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + Math.trunc(offset) * 7);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    return { start: localDate(monday), end: localDate(sunday) };
  }
  function review(tasks, raw, range = weekBounds(), now = Date.now()) {
    const startDate = date(range.start), endDate = date(range.end);
    if (!startDate || !endDate || startDate > endDate) throw new Error('Choose a valid review range.');
    const state = normalize(raw, now), between = day => day >= startDate && day <= endDate;
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const completedTasks = safeTasks.filter(task => task?.completed && timestamp(task.completedAt) && task.completedAt <= now && between(localDate(task.completedAt)));
    const today = localDate(now), overdueTasks = safeTasks.filter(task => task && !task.completed && date(task.dueDate) && task.dueDate < today && task.dueDate <= endDate);
    const sessions = state.sessions.filter(session => session.dayTotals.some(item => between(item.date)));
    const focusMs = sessions.reduce((sum, session) => sum + session.dayTotals.filter(item => between(item.date)).reduce((value, item) => value + item.durationMs, 0), 0);
    return { start: startDate, end: endDate, completedTasks, overdueTasks, focusMs, sessions,
      inboxCount: safeTasks.filter(task => task && !task.completed && task.inbox).length,
      legacyCompletedCount: safeTasks.filter(task => task?.completed && !timestamp(task.completedAt)).length };
  }
  const api = { KEY, MAX_DURATION, MAX_SESSIONS, defaults, normalize, elapsed, start, pause, resume, finish, localDate, weekBounds, review };
  if (global) global.DailySpaceFocusCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : null);
