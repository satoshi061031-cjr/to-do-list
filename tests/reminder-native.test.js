const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'reminder-client.js'), 'utf8');

function load({ display = 'granted', todos = [], reminders = [], email = 'me@example.com' } = {}) {
  const store = new Map([
    ['todo-app-v2', JSON.stringify({ todos })],
    ['calendar-app-v1', JSON.stringify({ reminders })],
    ['daily-space-auth-v1', JSON.stringify({ email, provider: 'google' })],
  ]);
  const plugin = {
    pending: [{ id: 999 }], scheduled: [], cancelled: [], requested: 0, listeners: {},
    async checkPermissions() { return { display }; },
    async requestPermissions() { this.requested += 1; display = 'granted'; return { display }; },
    async getPending() { return { notifications: this.pending }; },
    async cancel({ notifications }) { this.cancelled.push(...notifications.map(item => item.id)); },
    async schedule({ notifications }) { this.scheduled.push(...notifications); },
    addListener(name, callback) { this.listeners[name] = callback; },
  };
  const location = { href: 'todo.html', search: '', pathname: '/todo.html', hash: '' };
  const window = { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications: plugin } }, addEventListener() {}, setInterval() {} };
  const context = {
    window, location, console, Intl, Date, JSON, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    document: { querySelectorAll: () => [], addEventListener() {}, readyState: 'complete' },
    navigator: {}, CustomEvent: class {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: window.DailySpaceReminders, plugin, location };
}

const inHours = hours => { const d = new Date(Date.now() + hours * 3_600_000); return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; };

test('the native app schedules upcoming reminders on the phone and replaces the previous set', async () => {
  const soon = inHours(2), later = inHours(30), past = inHours(-3);
  const { api, plugin } = load({
    todos: [
      { id: 'a', text: 'Pay rent', dueDate: soon.date, dueTime: soon.time },
      { id: 'done', text: 'Already done', dueDate: soon.date, dueTime: soon.time, completed: true },
      { id: 'old', text: 'In the past', dueDate: past.date, dueTime: past.time },
    ],
    reminders: [{ id: 'r', text: 'Dentist', date: later.date, startTime: later.time }],
  });
  assert.equal(await api.scheduleNative(), true);
  assert.deepEqual([...plugin.cancelled], [999], 'old pending notifications are cleared first');
  assert.deepEqual(plugin.scheduled.map(item => item.body), ['Pay rent', 'Dentist'], 'soonest first; done and past items are skipped');
  assert.ok(plugin.scheduled.every(item => Number.isInteger(item.id) && item.id > 0 && item.id <= 0x7fffffff));
  assert.match(plugin.scheduled[0].extra.href, /^todo\.html\?focus=todo&id=a/);
  assert.equal(plugin.scheduled[0].schedule.allowWhileIdle, true);
});

test('permission is asked once and a refusal schedules nothing', async () => {
  const soon = inHours(2);
  const asked = load({ display: 'prompt', todos: [{ id: 'a', text: 'Pay rent', dueDate: soon.date, dueTime: soon.time }] });
  assert.equal(await asked.api.scheduleNative(), true);
  assert.equal(asked.plugin.requested, 1);
  const denied = load({ display: 'denied', todos: [{ id: 'a', text: 'Pay rent', dueDate: soon.date, dueTime: soon.time }] });
  assert.equal(await denied.api.scheduleNative(), false);
  assert.equal(denied.plugin.scheduled.length, 0);
});

test('tapping a notification opens only an app page', async () => {
  const { api, plugin, location } = load();
  await api.scheduleNative();
  plugin.listeners.localNotificationActionPerformed({ notification: { extra: { href: 'https://evil.example/' } } });
  assert.equal(location.href, 'todo.html');
  plugin.listeners.localNotificationActionPerformed({ notification: { extra: { href: 'calendar.html?focus=reminder&id=r' } } });
  assert.equal(location.href, 'calendar.html?focus=reminder&id=r');
});
