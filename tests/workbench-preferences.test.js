const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../workbench-preferences');
const Transfer = require('../workspace-tools-core');
const source = fs.readFileSync(path.resolve(__dirname, '../workbench-preferences.js'), 'utf8');

function storage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function browser(store = storage(), dataset = {}) {
  const events = [], window = { dispatchEvent: event => events.push(event) };
  const context = vm.createContext({ window, localStorage: store, document: { documentElement: { dataset } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  vm.runInContext(source, context);
  return { api: window.DailySpaceWorkbenchPreferences, events, store, dataset };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('workbench preferences validate order, mandatory tasks, safe shortcuts and bounded names', () => {
  const result = Core.normalize({ version: 900, name: '  我的\n 工作台  ', displayName: '🙂'.repeat(41),
    sections: ['travel', 'tasks', 'travel', '__proto__'], hidden: ['tasks', 'travel', 'travel', 'unknown'],
    shortcuts: ['mail', 'evil.html', 'mail', 'travel', 'planner', 'tally', 'calendar'], unknown: 'discard' });
  assert.deepEqual(result.sections, ['travel', 'tasks', 'agenda', 'shortcuts', 'spend']);
  assert.deepEqual(result.hidden, ['travel']);
  assert.deepEqual(result.shortcuts, ['mail', 'travel', 'planner', 'tally']);
  assert.equal(result.name, '我的 工作台'); assert.equal(Array.from(result.displayName).length, 40);
  assert.equal(result.version, 1); assert.equal(result.unknown, undefined);
  assert.deepEqual(Core.normalize({ shortcuts: [] }).shortcuts, []);
  for (const invalid of [null, [], 'invalid', 4, false]) assert.deepEqual(Core.normalize(invalid), Core.defaults());
  const value = Core.defaults(); value.sections.pop(); value.shortcuts.push('invalid');
  assert.deepEqual(Core.defaults().sections, ['agenda', 'tasks', 'shortcuts', 'spend', 'travel']);
  assert.equal(Core.defaults().shortcuts.includes('invalid'), false);
});

test('saved workbench choices survive reload and emit ordinary sync notifications after storage succeeds', () => {
  const c = browser();
  assert.equal(c.api.ready(), true);
  const saved = c.api.save({ name: 'My desk', displayName: 'Jun', hidden: ['spend'], sections: ['tasks', 'agenda'], shortcuts: ['travel', 'planner'] });
  assert.equal(JSON.parse(c.store.getItem(Core.KEY)).name, 'My desk');
  assert.deepEqual(plain(c.api.read()), plain(saved));
  assert.deepEqual(c.events.map(event => event.type), ['daily-space-workbench-updated', 'daily-space-agent-data-updated']);
  assert.deepEqual(plain(c.events[1].detail), { domains: ['workbench'] });
  assert.equal(browser(c.store).api.read().name, 'My desk');
});

test('account transitions and unresolved recovery cannot read or write the preceding owner settings', () => {
  const store = storage({ [Core.KEY]: { name: 'Alice private desk' },
    'daily-space-auth-v1': { email: 'bob@example.com' }, 'daily-space-workspace-owner-v1': { owner: 'alice@example.com' } });
  const c = browser(store);
  assert.deepEqual(plain(c.api.read()), Core.defaults());
  assert.throws(() => c.api.save({ name: 'Overwrite Alice' }), error => error.code === 'WORKSPACE_NOT_READY');
  assert.equal(JSON.parse(store.getItem(Core.KEY)).name, 'Alice private desk'); assert.deepEqual(c.events, []);
  store.setItem(Core.KEY, JSON.stringify({ name: 'Bob desk' }));
  store.setItem('daily-space-workspace-owner-v1', JSON.stringify({ owner: 'bob@example.com' }));
  Object.assign(c.dataset, { workspaceReady: 'true', workspaceOwner: 'bob@example.com' });
  assert.equal(c.api.read().name, 'Bob desk');
  c.dataset.workspaceReady = 'false'; assert.equal(c.api.read().name, '');
  c.dataset.workspaceReady = 'true'; c.dataset.workspaceLocked = 'true'; assert.equal(c.api.read().name, '');
  c.dataset.workspaceLocked = 'false'; store.setItem('daily-space-snapshot-recovery-v1', '{}');
  assert.equal(c.api.ready(), false); assert.equal(c.api.read().name, '');
  store.removeItem('daily-space-snapshot-recovery-v1');
  assert.equal(c.api.read().name, 'Bob desk');
});

test('quota and silent storage failures retain old settings, report failure and emit no success event', () => {
  for (const silent of [false, true]) {
    const store = storage({ [Core.KEY]: { name: 'Before' } }), original = store.getItem(Core.KEY);
    const c = browser(store), write = store.setItem;
    store.setItem = (key, value) => { if (key === Core.KEY && value !== original) { if (!silent) throw new Error('QuotaExceededError'); return; } write(key, value); };
    assert.throws(() => c.api.save({ name: 'After' }), error => error.code === 'WORKBENCH_STORAGE');
    assert.equal(store.getItem(Core.KEY), original); assert.deepEqual(c.events, []);
  }
  const damaged = browser(storage({ [Core.KEY]: '{broken JSON' }));
  assert.deepEqual(plain(damaged.api.read()), Core.defaults());
});

test('personal configuration round-trips in device backups while import preserves existing local choices', () => {
  const config = Core.normalize({ name: 'Quiet desk', sections: ['tasks', 'spend'], hidden: ['travel'], shortcuts: ['mail'] });
  const from = storage({ [Core.KEY]: config, 'daily-space-auth-v1': { email: 'private@example.com' } }), empty = storage();
  const backup = Transfer.backup(from);
  assert.equal(backup.payload['daily-space-auth-v1'], undefined);
  assert.deepEqual(JSON.parse(backup.payload[Core.KEY]), config);
  const plan = Transfer.prepare(JSON.stringify(backup), 'json', empty);
  assert.deepEqual(plan.summary, [{ key: Core.KEY, added: 1, skipped: 0 }]);
  Transfer.apply(plan, empty); assert.deepEqual(JSON.parse(empty.getItem(Core.KEY)), config);
  const local = storage({ [Core.KEY]: Core.normalize({ name: 'Keep my desk' }) });
  const existing = Transfer.prepare(JSON.stringify(backup), 'json', local);
  assert.deepEqual(existing.summary, [{ key: Core.KEY, added: 0, skipped: 1 }]);
  Transfer.apply(existing, local); assert.equal(JSON.parse(local.getItem(Core.KEY)).name, 'Keep my desk');
  const stale = Transfer.prepare(JSON.stringify(backup), 'json', empty);
  empty.setItem(Core.KEY, JSON.stringify(Core.normalize({ name: 'Changed while previewing' })));
  assert.throws(() => Transfer.apply(stale, empty), /Device data changed/);
});
