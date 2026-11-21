const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'workspace-tasks.js'), 'utf8');

function harness({ email = 'me@example.com', todos = [], reminders = [] } = {}) {
  const store = new Map();
  const calls = [];
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  const responses = [];
  const window = { addEventListener() {}, dispatchEvent() {} };
  const context = {
    window, localStorage, console, URLSearchParams, Intl, JSON, Date, setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: { documentElement: { dataset: { workspaceReady: 'true', workspaceLocked: 'false' } } },
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      const next = responses.shift() || { status: 200, body: { ok: true, connected: true, provider: 'google' } };
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const set = (todoList, reminderList) => {
    localStorage.setItem('todo-app-v2', JSON.stringify({ todos: todoList, categories: [] }));
    localStorage.setItem('calendar-app-v1', JSON.stringify({ version: 1, reminders: reminderList }));
  };
  if (email) localStorage.setItem('daily-space-auth-v1', JSON.stringify({ email }));
  set(todos, reminders);
  return { api: window.DailySpaceTasks, calls, responses, set, store, context };
}

const task = (over = {}) => ({ id: 't1', text: 'Dentist', dueDate: '2026-11-20', dueTime: '10:00', externalEventId: 'ev1', ...over });

test('a new event id is only recorded; a later edit patches the event', async () => {
  const h = harness({ todos: [task()] });
  await h.api.reconcileExternalEvents({ now: 1000 });
  assert.equal(h.calls.length, 0, 'first sight records the state another device may already have sent');
  h.set([task({ dueTime: '14:30', text: 'Dentist (moved)' })], []);
  const result = await h.api.reconcileExternalEvents({ now: 2000 });
  assert.equal(result.updated, 1);
  assert.equal(h.calls[0].method, 'PATCH');
  assert.equal(h.calls[0].url, '/api/calendar/events/ev1');
  assert.equal(h.calls[0].body.startTime, '14:30');
  assert.equal(h.calls[0].body.title, 'Dentist (moved)');
  await h.api.reconcileExternalEvents({ now: 3000 });
  assert.equal(h.calls.length, 1, 'an unchanged item is not sent again');
});

test('a deleted item waits out the undo window, then deletes its event', async () => {
  const h = harness({ todos: [task()] });
  await h.api.reconcileExternalEvents({ now: 0 });
  h.set([], []);
  await h.api.reconcileExternalEvents({ now: 1000 });
  assert.equal(h.calls.length, 0, 'not deleted immediately');
  h.set([task()], []);
  await h.api.reconcileExternalEvents({ now: 5000 });
  h.set([], []);
  await h.api.reconcileExternalEvents({ now: 6000 });
  await h.api.reconcileExternalEvents({ now: 12000 });
  assert.equal(h.calls.length, 0, 'undo reset the timer');
  const result = await h.api.reconcileExternalEvents({ now: 22000 });
  assert.equal(result.deleted, 1);
  assert.equal(h.calls[0].method, 'DELETE');
  assert.equal(h.calls[0].url, '/api/calendar/events/ev1');
});

test('many items vanishing at once (account switch, restore) never deletes events', async () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id, index) => task({ id, externalEventId: `ev-${id}`, dueTime: `1${index}:00` }));
  const h = harness({ todos: items });
  await h.api.reconcileExternalEvents({ now: 0 });
  h.set([], []);
  const result = await h.api.reconcileExternalEvents({ now: 1000 });
  assert.equal(result.rebaselined, true);
  await h.api.reconcileExternalEvents({ now: 60000 });
  assert.equal(h.calls.length, 0);
});

test('reminders win over a linked task, a failed update retries later, and guests sync nothing', async () => {
  const h = harness({ todos: [task({ externalEventId: 'shared' })], reminders: [{ id: 'r1', text: 'Standup', date: '2026-11-20', startTime: '09:00', endTime: '09:30', externalEventId: 'shared' }] });
  await h.api.reconcileExternalEvents({ now: 0 });
  h.set([task({ externalEventId: 'shared' })], [{ id: 'r1', text: 'Standup', date: '2026-11-20', startTime: '11:00', endTime: '11:30', externalEventId: 'shared' }]);
  h.responses.push({ status: 502, body: { ok: false, connected: true } });
  await h.api.reconcileExternalEvents({ now: 1000 });
  assert.equal(h.calls[0].body.endTime, '11:30');
  await h.api.reconcileExternalEvents({ now: 2000 });
  assert.equal(h.calls.length, 1, 'waits before retrying a failure');
  await h.api.reconcileExternalEvents({ now: 1000 + 5 * 60 * 1000 + 1 });
  assert.equal(h.calls.length, 2);

  const guest = harness({ email: '', todos: [task()] });
  assert.equal((await guest.api.reconcileExternalEvents({ now: 0 })).skipped, true);
  const locked = harness({ todos: [task()] });
  locked.context.document.documentElement.dataset.workspaceLocked = 'true';
  assert.equal((await locked.api.reconcileExternalEvents({ now: 0 })).skipped, true);
});

test('records are kept per account', async () => {
  const h = harness({ todos: [task()] });
  await h.api.reconcileExternalEvents({ now: 0 });
  assert.ok(h.store.has('dayfly-external-events-v1:me@example.com'));
  h.store.set('daily-space-auth-v1', JSON.stringify({ email: 'other@example.com' }));
  h.set([task({ dueTime: '18:00' })], []);
  await h.api.reconcileExternalEvents({ now: 1000 });
  assert.equal(h.calls.length, 0, "another account's first sight is only recorded");
});
