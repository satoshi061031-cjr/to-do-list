const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../record-history-core');

const task = (id, text, extra = {}) => ({ id, text, completed: false, dueDate: null, notes: '', subtasks: [], ...extra });
const store = todos => ({ todos, categories: [{ id: 'work', name: 'Work' }], selectedCategoryKey: 'work' });

test('history ignores first creation, hydration-free calls and unchanged values', () => {
  const initial = store([task('a', 'First')]);
  assert.deepEqual(Core.capture(null, 'todo-app-v2', null, initial), Core.defaults());
  assert.deepEqual(Core.capture(null, 'todo-app-v2', store([]), initial), Core.defaults());
  assert.deepEqual(Core.capture(null, 'todo-app-v2', initial, JSON.stringify(initial)), Core.defaults());
  assert.deepEqual(Core.capture(null, 'account-credentials', initial, store([])), Core.defaults());
  assert.deepEqual(Core.capture(null, 'todo-app-v2', initial, '{broken'), Core.defaults());
});

test('previous records include all notes, checklist and planning metadata without mutating stores', () => {
  const old = task('a', 'Earlier task', { notes: 'A detailed note', subtasks: [{ id: 'sub', text: 'Check document', completed: true }], priority: 'high', sourceUrl: 'https://example.com', todayPinDate: '2026-11-13' });
  const before = store([old]), after = store([{ ...old, text: 'Edited task', completed: true }]);
  const input = JSON.stringify(before);
  const history = Core.capture(null, 'todo-app-v2', before, after, 100);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].kind, 'update');
  assert.deepEqual(history.entries[0].value, old);
  assert.equal(JSON.stringify(before), input);
  old.notes = 'Mutated elsewhere';
  assert.equal(history.entries[0].value.notes, 'A detailed note', 'A full detached copy is retained');
  assert.equal(Core.capture(history, 'todo-app-v2', history.entries[0].value && store([history.entries[0].value]), after, 101).entries.length, 1, 'Repeated capture is idempotent');
});

test('restore replaces only the selected record and refuses changes made after preview', () => {
  const old = task('a', 'Original'), current = task('a', 'Current'), other = task('b', 'Keep this new edit');
  const history = Core.capture(null, 'todo-app-v2', store([old]), store([current]), 200);
  const currentStore = store([current, other]);
  const plan = Core.planRestore(history, history.entries[0].id, currentStore, Core.signature(current));
  assert.equal(plan.state.todos[0].text, 'Original');
  assert.deepEqual(plan.state.todos[1], other);
  assert.deepEqual(plan.state.categories, currentStore.categories);
  assert.equal(currentStore.todos[0].text, 'Current');
  assert.throws(() => Core.planRestore(history, history.entries[0].id, store([{ ...current, text: 'Changed after preview' }, other]), Core.signature(current)), /RECORD_CHANGED/);
});

test('deleted records restore with original IDs, preserving newer unrelated records', () => {
  const old = task('deleted', 'Find me');
  const history = Core.capture(null, 'todo-app-v2', store([old]), store([]), 300);
  const entry = history.entries[0];
  assert.equal(entry.kind, 'delete');
  const plan = Core.planRestore(history, entry.id, store([task('new', 'New task')]), 'absent');
  assert.deepEqual(plan.state.todos.map(item => item.id), ['new', 'deleted']);
  assert.throws(() => Core.planRestore(history, entry.id, store([task('deleted', 'Recreated elsewhere')]), 'absent'), /RECORD_CHANGED/);
});

test('notes and trips retain complete source records and survive normalization/export roundtrip', () => {
  const note = { id: 'note', title: 'Flight notes', body: 'Reservation text', links: [{ type: 'trip', id: 'trip' }], sourceUrl: 'https://example.com', createdAt: 100, updatedAt: 100 };
  const trip = { id: 'trip', name: 'Tokyo', startDate: '2026-12-01', endDate: '2026-12-03', days: [{ stops: [{ id: 'stop', name: 'Museum', lat: 10, lng: 20 }] }], bookings: [{ id: 'booking', confirmation: 'ABC' }] };
  let history = Core.capture(null, 'dayfly-notes-v1', { version: 1, notes: [note] }, { version: 1, notes: [] }, 400);
  history = Core.capture(history, 'travel-book-v1', { trips: [trip] }, { trips: [] }, 401);
  const roundtrip = Core.normalize(JSON.stringify(history));
  assert.equal(roundtrip.entries.length, 2);
  assert.deepEqual(roundtrip.entries.find(entry => entry.key === 'travel-book-v1').value, trip);
  assert.deepEqual(roundtrip.entries.find(entry => entry.key === 'dayfly-notes-v1').value, note);
  assert.deepEqual(Core.normalize(roundtrip), roundtrip);
});

test('restoring deleted tasks, notes or trips cannot exceed the portable store record limits', () => {
  const examples = {
    'todo-app-v2': task('deleted', 'Task to restore'),
    'dayfly-notes-v1': { id: 'deleted', title: 'Note to restore', body: 'Content' },
    'travel-book-v1': { id: 'deleted', name: 'Trip to restore', startDate: '2026-12-01', endDate: '2026-12-02' },
  };
  for (const [key, record] of Object.entries(examples)) {
    const field = Core.SUPPORTED[key], history = Core.capture(null, key, { [field]: [record] }, { [field]: [] }, 450);
    const current = { [field]: Array.from({ length: Core.MAX_RECORDS[key] }, (_, i) => ({ ...record, id: `existing-${i}` })) };
    const unchanged = JSON.stringify(current);
    assert.throws(() => Core.planRestore(history, history.entries[0].id, current, 'absent'), error => error.message === 'STORE_LIMIT' && error.limit === Core.MAX_RECORDS[key]);
    assert.equal(JSON.stringify(current), unchanged);
    current[field][0] = record;
    const replacement = Core.planRestore(history, history.entries[0].id, current, Core.signature(record));
    assert.equal(replacement.state[field].length, Core.MAX_RECORDS[key], 'Replacing at the limit is allowed without removing another record');
  }
});

test('retention observes UTF8 byte and entry ceilings, skipping oversized complete records', () => {
  let history = Core.defaults();
  for (let i = 0; i < 220; i++) history = Core.capture(history, 'todo-app-v2', store([task('a', 'Version ' + i, { notes: '字'.repeat(1000) })]), store([task('a', 'New ' + i)]), 500 + i);
  assert.ok(history.entries.length > 0 && history.entries.length <= Core.MAX_ENTRIES);
  assert.ok(Buffer.byteLength(JSON.stringify(history), 'utf8') <= Core.MAX_BYTES);
  assert.equal(history.entries[0].at, 719);
  const oversized = task('huge', 'Large record', { notes: '字'.repeat(15000) });
  const next = Core.capture(history, 'todo-app-v2', store([oversized]), store([]), 800);
  assert.equal(next.skipped, 1);
  assert.equal(next.entries.some(entry => entry.recordId === 'huge'), false);
  assert.equal(oversized.notes.length, 15000, 'Current source record is never truncated');
});

test('invalid imported entries, duplicate IDs and dangerous prototype keys are discarded', () => {
  const history = Core.capture(null, 'todo-app-v2', store([task('safe', 'Safe')]), store([]), 900);
  const good = history.entries[0];
  const poisoned = JSON.parse(JSON.stringify({ ...good, id: 'poison', value: task('safe', 'Poison') }).replace('"completed":false', '"completed":false,"__proto__":{"polluted":true}'));
  const normalized = Core.normalize({ entries: [good, good, poisoned, { ...good, id: 'wrong-id', recordId: 'other' }, { ...good, id: 'wrong-key', key: 'daily-space-auth-v1' }, { ...good, id: 'future', at: Infinity }] });
  assert.equal(normalized.entries.length, 1);
  assert.equal({}.polluted, undefined);
});

test('browser capture is explicit, skips cloud application and never turns quota failure into primary edit failure', () => {
  const values = new Map(), listeners = [], events = [];
  let available = true, failHistory = false, failRead = false;
  const window = {
    DailySpaceHistoryCore: Core,
    DailySpaceWorkbenchPreferences: { ready: () => available },
    DailySpaceView: { owner: () => 'guest' },
    dispatchEvent: event => events.push(event),
  };
  const context = { window, document: { readyState: 'loading', addEventListener: (...args) => listeners.push(args) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, localStorage: { getItem: key => { if (failRead && key === Core.KEY) throw new Error('StorageUnavailable'); return values.get(key) || null; }, setItem: (key, value) => { if (key === Core.KEY && failHistory) throw new Error('QuotaExceededError'); values.set(key, value); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../record-history.js'), 'utf8'), context);
  const before = store([task('a', 'Original')]), after = store([task('a', 'Edited')]);
  window.DailySpaceSnapshotApplying = true;
  assert.equal(window.DailySpaceHistory.capture('todo-app-v2', before, after), true);
  assert.equal(values.has(Core.KEY), false, 'Hydrated cloud changes do not become local history');
  window.DailySpaceSnapshotApplying = false;
  available = false;
  assert.equal(window.DailySpaceHistory.capture('todo-app-v2', before, after), false);
  assert.equal(values.has(Core.KEY), false, 'Locked/account-changing workspace is isolated');
  available = true; failHistory = true;
  values.set('todo-app-v2', JSON.stringify(after));
  assert.equal(window.DailySpaceHistory.capture('todo-app-v2', before, after), false);
  assert.equal(JSON.parse(values.get('todo-app-v2')).todos[0].text, 'Edited');
  assert.ok(events.some(event => event.detail.failed));
  failHistory = false;
  assert.equal(window.DailySpaceHistory.capture('todo-app-v2', before, after), true);
  assert.equal(Core.normalize(values.get(Core.KEY)).entries.length, 1);
  const saved = values.get(Core.KEY); failRead = true;
  assert.equal(window.DailySpaceHistory.capture('todo-app-v2', after, store([])), false);
  assert.equal(values.get(Core.KEY), saved, 'An unreadable existing history is never replaced by an empty history');
});
