/** Private, portable notes with small explicit links to existing workspace records. */
(function (global) {
  const KEY = 'dayfly-notes-v1';
  const MAX_NOTES = 100;
  const MAX_BYTES = 180000;
  const TYPES = ['todo', 'planner', 'trip'];
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const identity = value => {
    const id = clean(value, 120);
    return id && !['__proto__', 'constructor', 'prototype'].includes(id) ? id : null;
  };
  const stamp = value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 ? value : null;
  function safeUrl(value) {
    const raw = clean(value, 2000);
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function links(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 20).flatMap(item => {
      const id = identity(item?.id), type = item?.type;
      const key = `${type}:${id}`;
      if (!id || !TYPES.includes(type) || seen.has(key)) return [];
      seen.add(key); return [{ type, id }];
    });
  }
  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = identity(raw.id), body = clean(raw.body, 10000);
    const title = clean(raw.title, 80) || clean(body.split('\n')[0], 80);
    if (!id || !title) return null;
    const tags = Array.isArray(raw.tags) ? raw.tags : typeof raw.tags === 'string' ? raw.tags.split(/[,，\n]/) : [];
    return { id, title, body, sourceUrl: safeUrl(raw.sourceUrl),
      tags: [...new Set(tags.map(value => clean(value, 32).replace(/^#+/, '')).filter(Boolean))].slice(0, 12),
      links: links(raw.links), createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt) };
  }
  function bytes(value) {
    const text = JSON.stringify(value);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length * 3;
  }
  function normalize(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.notes) ? raw.notes : [];
    if (input.length > MAX_NOTES) throw Object.assign(new Error('Keep at most 100 notes. Export older notes before adding more.'), { code: 'NOTES_LIMIT' });
    const seen = new Set(), notes = input.map(normalizeNote).filter(item => item && !seen.has(item.id) && seen.add(item.id));
    const state = { version: 1, notes };
    if (bytes(state) > MAX_BYTES) throw Object.assign(new Error('Notes are full. Export or shorten older notes before saving.'), { code: 'NOTES_SIZE' });
    return state;
  }
  function upsert(raw, input, now = Date.now()) {
    const state = normalize(raw), existing = state.notes.find(item => item.id === input?.id);
    const note = normalizeNote({ ...input, createdAt: existing?.createdAt || stamp(input?.createdAt) || now, updatedAt: now });
    if (!note) throw new Error('Give the note a title or some text.');
    const notes = existing ? state.notes.map(item => item.id === note.id ? note : item) : [note, ...state.notes];
    return normalize({ notes });
  }
  function forEntity(raw, entity) {
    if (!TYPES.includes(entity?.type) || !identity(entity?.id)) return [];
    return normalize(raw).notes.filter(note => note.links.some(link => link.type === entity.type && link.id === entity.id));
  }
  function href(entity) {
    if (!identity(entity?.id)) return null;
    const pages = { todo: ['todo.html', 'todo'], planner: ['planner.html', 'card'], trip: ['travel.html', 'trip'] };
    const page = pages[entity.type];
    return page ? `${page[0]}?focus=${page[1]}&id=${encodeURIComponent(entity.id)}` : null;
  }
  function context(raw, selected) {
    const ids = new Set(Array.isArray(selected) ? selected : []);
    return normalize(raw).notes.filter(note => ids.has(note.id)).slice(0, 5).map(note => ({
      id: note.id, title: note.title, body: note.body.slice(0, 3000), sourceUrl: note.sourceUrl,
      links: note.links, href: `todo.html?focus=note&id=${encodeURIComponent(note.id)}`,
    }));
  }
  const api = { KEY, MAX_NOTES, MAX_BYTES, TYPES, normalize, normalizeNote, upsert, forEntity, safeUrl, links, href, context };
  if (global) global.DailySpaceNotesCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : null);
