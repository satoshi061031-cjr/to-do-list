/** Bounded, complete previous records. No storage interception or account state. */
(function (global) {
  const KEY = 'dayfly-history-v1';
  const SUPPORTED = Object.freeze(Object.assign(Object.create(null), { 'todo-app-v2': 'todos', 'dayfly-notes-v1': 'notes', 'travel-book-v1': 'trips' }));
  const MAX_BYTES = 150 * 1024, MAX_RECORD_BYTES = 40 * 1024, MAX_ENTRIES = 200;
  const MAX_RECORDS = { 'todo-app-v2': 1000, 'dayfly-notes-v1': 100, 'travel-book-v1': 100 };
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const bytes = value => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : Buffer.byteLength(value, 'utf8');
  const cleanId = value => typeof value === 'string' && value.trim() && value.length <= 120 && !forbidden.has(value) ? value : null;
  const stamp = value => Number.isFinite(value) && value > 0 && value <= 8640000000000000 ? value : null;
  function date(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T12:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
  function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch (_) { return false; } }
  const defaults = () => ({ version: 1, entries: [], skipped: 0 });
  function parse(value) { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; } }
  function copy(value) {
    const json = JSON.stringify(value);
    if (!json || bytes(json) > MAX_RECORD_BYTES) return null;
    let invalid = false;
    const result = JSON.parse(json, (key, item) => { if (forbidden.has(key)) invalid = true; return item; });
    return invalid ? null : result;
  }
  function validRecord(key, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !cleanId(value.id)) return false;
    if (value.sourceUrl != null && !safeUrl(value.sourceUrl)) return false;
    if (key === 'todo-app-v2') return Boolean(typeof value.text === 'string' && value.text.trim() && value.text.length <= 500 && typeof value.completed === 'boolean' &&
      (value.dueDate == null || date(value.dueDate)) && (value.dueTime == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value.dueTime)) &&
      (value.subtasks == null || (Array.isArray(value.subtasks) && value.subtasks.length <= 100 && value.subtasks.every(item => item && cleanId(item.id) && typeof item.text === 'string' && typeof item.completed === 'boolean'))));
    if (key === 'dayfly-notes-v1') return Boolean(typeof value.title === 'string' && value.title.length <= 80 && typeof value.body === 'string' && value.body.length <= 10000 && (value.title.trim() || value.body.trim()) &&
      (value.tags == null || (Array.isArray(value.tags) && value.tags.length <= 12 && value.tags.every(tag => typeof tag === 'string' && tag.length <= 40))) &&
      (value.links == null || (Array.isArray(value.links) && value.links.length <= 20 && value.links.every(link => link && ['todo', 'planner', 'trip'].includes(link.type) && cleanId(link.id)))));
    if (key === 'travel-book-v1') return Boolean(typeof value.name === 'string' && value.name.trim() && date(value.startDate) && date(value.endDate) && value.endDate >= value.startDate &&
      (value.stops == null || (Array.isArray(value.stops) && value.stops.every(stop => stop && typeof stop === 'object'))) &&
      (value.reservations == null || (Array.isArray(value.reservations) && value.reservations.every(booking => booking && typeof booking === 'object'))));
    return false;
  }
  function signature(value) {
    if (value == null) return 'absent';
    function sort(item) {
      if (Array.isArray(item)) return item.map(sort);
      if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
      return item;
    }
    return JSON.stringify(sort(value));
  }
  function normalize(raw) {
    const value = parse(raw), result = defaults();
    result.skipped = Number.isSafeInteger(value?.skipped) && value.skipped >= 0 ? value.skipped : 0;
    const ids = new Set();
    const candidates = (Array.isArray(value?.entries) ? value.entries : []).slice(0, MAX_ENTRIES * 4);
    for (const entry of candidates) {
      if (!cleanId(entry?.id) || ids.has(entry.id) || !SUPPORTED[entry.key] || !cleanId(entry.recordId) || !stamp(entry.at) || !['update', 'delete'].includes(entry.kind)) continue;
      let record;
      try { record = copy(entry.value); } catch (_) { continue; }
      if (!validRecord(entry.key, record) || record.id !== entry.recordId) continue;
      ids.add(entry.id); result.entries.push({ id: entry.id, key: entry.key, recordId: entry.recordId, at: entry.at, kind: entry.kind, value: record });
    }
    // Stable ordering preserves the latest local insertion within one clock tick.
    result.entries.sort((a, b) => b.at - a.at);
    result.entries = result.entries.slice(0, MAX_ENTRIES);
    while (result.entries.length && bytes(JSON.stringify(result)) > MAX_BYTES) result.entries.pop();
    return result;
  }
  function collection(key, state) {
    const parsed = parse(state);
    return parsed && !Array.isArray(parsed) && Array.isArray(parsed[SUPPORTED[key]]) ? parsed[SUPPORTED[key]] : null;
  }
  function getRecord(key, state, id) { return collection(key, state)?.find(record => record?.id === id) || null; }
  function capture(history, key, before, after, at = Date.now()) {
    const result = normalize(history);
    if (!SUPPORTED[key] || !stamp(at)) return result;
    const oldList = collection(key, before), newList = collection(key, after);
    if (!oldList || !newList) return result;
    const next = new Map(newList.filter(item => cleanId(item?.id)).map(item => [item.id, item]));
    for (const record of oldList) {
      if (!validRecord(key, record)) continue;
      const changed = next.get(record.id), kind = changed ? 'update' : 'delete';
      if (signature(record) === signature(changed)) continue;
      let previous;
      try { previous = copy(record); } catch (_) { previous = null; }
      if (!previous) { result.skipped = Math.min(Number.MAX_SAFE_INTEGER, result.skipped + 1); continue; }
      const duplicate = result.entries.find(entry => entry.key === key && entry.recordId === record.id);
      if (duplicate && duplicate.kind === kind && signature(duplicate.value) === signature(previous)) continue;
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `history-${at}-${Math.random().toString(36).slice(2)}`;
      result.entries.unshift({ id, key, recordId: record.id, at, kind, value: previous });
    }
    return normalize(result);
  }
  function planRestore(history, id, current, expectedSignature) {
    const entry = normalize(history).entries.find(item => item.id === id);
    if (!entry) throw new Error('VERSION_MISSING');
    const parsed = parse(current), list = collection(entry.key, parsed);
    if (!list) throw new Error('STORE_UNAVAILABLE');
    const present = getRecord(entry.key, parsed, entry.recordId);
    if (signature(present) !== expectedSignature) throw new Error('RECORD_CHANGED');
    const restored = copy(entry.value);
    // Copy the container, not unrelated records: a restore never rolls back a whole store.
    const records = list.map(item => item?.id === entry.recordId ? restored : item);
    if (!present) records.push(restored);
    if (records.length > MAX_RECORDS[entry.key]) throw Object.assign(new Error('STORE_LIMIT'), { key: entry.key, limit: MAX_RECORDS[entry.key] });
    const state = { ...parsed, [SUPPORTED[entry.key]]: records };
    return { key: entry.key, state, before: parsed, after: state, record: restored };
  }
  const api = { KEY, SUPPORTED, MAX_BYTES, MAX_RECORD_BYTES, MAX_ENTRIES, MAX_RECORDS, defaults, normalize, capture, planRestore, signature, getRecord, validRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.DailySpaceHistoryCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
