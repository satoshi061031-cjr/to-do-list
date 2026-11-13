const test = require('node:test');
const assert = require('node:assert/strict');
const Fields = require('../task-fields');
const Views = require('../task-views-core');

test('planning migration keeps legacy undated and completed tasks distinct from Inbox and historical completion', () => {
  const old = Fields.fields({ completed: true, dueDate: null });
  assert.equal(old.inbox, false);
  assert.equal(old.priority, 'normal');
  assert.equal(old.completedAt, null);
  assert.equal(old.createdAt, null);
  assert.equal(old.todayPinDate, null);
  assert.equal(Fields.fields({ completed: false, completedAt: Date.now() }).completedAt, null);
  for (const value of [Infinity, NaN, -1, 1.5, 8640000000000001]) {
    assert.equal(Fields.fields({ createdAt: value }).createdAt, null);
    assert.equal(Fields.fields({ completed: true, completedAt: value }).completedAt, null);
  }
});

test('captured source links reject unsafe protocols and credentials while daily pins validate real dates', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,hello', 'https://alice:secret@example.com/a', '//example.com', 'not a url']) assert.equal(Fields.fields({ sourceUrl }).sourceUrl, null);
  assert.equal(Fields.fields({ sourceUrl: 'https://example.com/article?q=a' }).sourceUrl, 'https://example.com/article?q=a');
  assert.equal(Fields.fields({ todayPinDate: '2026-02-30' }).todayPinDate, null);
  assert.equal(Fields.fields({ todayPinDate: '2028-02-29', todayPinOrder: 999 }).todayPinOrder, 2);
});

test('repeat occurrences preserve useful content and priority while clearing prior execution and daily planning', () => {
  const original = { completed: true, completedAt: Date.now(), inbox: true, priority: 'high', todayPinDate: '2026-11-13', todayPinOrder: 2, notes: 'Context', sourceUrl: 'https://example.com/', subtasks: [{ id: 'old', text: 'One step', completed: true }] };
  const next = Fields.recurrence(original);
  assert.equal(next.inbox, false); assert.equal(next.completedAt, null); assert.equal(next.todayPinDate, null);
  assert.equal(next.priority, 'high'); assert.equal(next.notes, 'Context'); assert.equal(next.sourceUrl, original.sourceUrl);
  assert.equal(next.subtasks[0].completed, false); assert.notEqual(next.subtasks[0].id, 'old');
  assert.ok(Number.isSafeInteger(next.createdAt));
});

test('named views are bounded filter definitions with relative today semantics and no duplicate records', () => {
  const data = Views.normalize({ version: 99, views: [
    { id: 'work', name: ' Work this week ', mode: 'tasks', filter: 'active', range: 'week', day: '2026-11-13', dayMode: 'today', priority: 'high', categoryId: 'work-category', todos: ['must-not-copy'] },
    { id: 'work', name: 'Duplicate' }, { id: '__proto__', name: 'Unsafe' }, { id: 'bad', name: ' ' },
    { id: 'inbox', name: 'Inbox', mode: 'inbox', filter: 'invalid', day: '2026-02-30' },
  ] });
  assert.equal(data.version, 1); assert.equal(data.views.length, 2);
  assert.equal(data.views[0].dayMode, 'today'); assert.equal(data.views[0].range, 'week');
  assert.equal(data.views[0].name, 'Work this week'); assert.equal(data.views[0].todos, undefined);
  assert.equal(data.views[1].day, null); assert.equal(data.views[1].filter, 'active');
  assert.equal(Views.normalize({ views: Array.from({ length: 40 }, (_, n) => ({ id: String(n), name: `View ${n}` })) }).views.length, 30);
  assert.deepEqual(Views.normalize(null), { version: 1, views: [] });
});

test('task editor three-way merge keeps unrelated newer fields and requires an explicit choice on conflicting edits', () => {
  const base = { id: 'one', text: 'Original', notes: '', priority: 'normal', dueDate: '2026-11-13', completed: false };
  const latest = { ...base, text: 'Other tab title', notes: 'New notes', priority: 'high', completed: true, completedAt: Date.now() };
  const conflicting = { text: 'My draft title', notes: '', priority: 'normal', dueDate: base.dueDate, _baseTask: base };
  const result = Fields.mergeDraft(latest, conflicting);
  assert.deepEqual(result.conflicts, ['text']); assert.deepEqual(result.patch, { text: 'My draft title' });
  const forced = Fields.mergeDraft(latest, { ...conflicting, _forceTaskChanges: true });
  assert.deepEqual(forced.conflicts, []);
  assert.deepEqual({ ...latest, ...forced.patch }, { ...latest, text: 'My draft title' });
  const independent = Fields.mergeDraft({ ...base, notes: 'Remote notes' }, { ...base, priority: 'high', _baseTask: base });
  assert.deepEqual(independent.conflicts, []); assert.deepEqual(independent.patch, { priority: 'high' });
  assert.deepEqual(Fields.mergeDraft(latest, { priority: 'low' }).patch, { priority: 'low' });
});
