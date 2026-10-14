const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const webPush = require('web-push');
const { createReminderStore, validateSubscription, nextMorning } = require('../server/reminder-store');
const keys = webPush.generateVAPIDKeys();
const peer = crypto.createECDH('prime256v1'); peer.generateKeys();
const subscription = (id = 'one') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/test-${id}`, keys: { p256dh: peer.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });
function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let clock = Date.parse('2026-10-14T06:00:00Z'); const sent = [];
  const store = createReminderStore(db, { now: () => clock, publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:fixture@example.test', send: async (subscription, payload) => { sent.push({ subscription, payload: JSON.parse(payload) }); }, ...options });
  const job = (id = 'a') => ({ source: `todo:${id}`, title: `Task ${id}`, dueAt: clock, href: `todo.html?focus=todo&id=${id}`, timeZone: 'Asia/Shanghai' });
  return { db, store, sent, job, advance: millis => { clock += millis; }, now: () => clock };
}
test('durable scheduler delivers without an open page and unchanged sync never repeats it', async t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-space-reminder-durability-')); const filename = path.join(directory, 'db.sqlite');
  const db = new DatabaseSync(filename); let closed = false;
  t.after(() => { if (!closed) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const sent = [], clock = Date.parse('2026-10-14T06:00:00Z');
  const options = { ...keys, subject: 'mailto:fixture@example.test', now: () => clock, send: async (_, payload) => sent.push({ payload: JSON.parse(payload) }) };
  const store = createReminderStore(db, options); const job = () => ({ source: 'todo:a', title: 'Task a', dueAt: clock, href: 'todo.html?focus=todo&id=a', timeZone: 'UTC' });
  assert.equal(store.configured, true);
  store.subscribe('owner', subscription()); store.sync('owner', [job()]);
  await store.tick(); assert.equal(sent.length, 1); assert.equal(sent[0].payload.body, 'Task a');
  assert.equal(db.prepare('SELECT state FROM reminder_jobs').get().state, 'delivered');
  store.sync('owner', [job()]); await store.tick(); assert.equal(sent.length, 1);
  db.close(); closed = true; const reopened = new DatabaseSync(filename);
  try { const restarted = createReminderStore(reopened, options); await restarted.tick(); assert.equal(reopened.prepare('SELECT state FROM reminder_jobs').get().state, 'delivered'); assert.equal(sent.length, 1); } finally { reopened.close(); }
});
test('snooze rotates its capability and survives unchanged schedules and process restart', async t => {
  const { store, db, sent, job, advance, now } = fixture(t);
  store.subscribe('owner', subscription()); const original = job(); store.sync('owner', [original]); await store.tick();
  const first = sent[0].payload.data;
  assert.throws(() => store.defer(first.jobId, crypto.randomBytes(32).toString('base64url'), 'snooze'), /no longer/);
  assert.equal(store.defer(first.jobId, first.token, 'snooze'), now() + 600000);
  assert.throws(() => store.defer(first.jobId, first.token, 'snooze'), /no longer/);
  store.sync('owner', [original]); await store.tick(); assert.equal(sent.length, 1);
  advance(600000); await store.tick(); assert.equal(sent.length, 2); assert.notEqual(sent[1].payload.data.token, first.token);
  const next = sent[1].payload.data; store.defer(next.jobId, next.token, 'tomorrow');
  assert.equal(db.prepare('SELECT due FROM reminder_jobs').get().due, Date.parse('2026-10-15T01:00:00Z'));
});
test('completion, removal, rescheduling and sign-out revoke pending alerts and old actions', async t => {
  const { store, sent, job, advance } = fixture(t);
  store.subscribe('owner', subscription()); store.sync('owner', [job()]); await store.tick(); const data = sent[0].payload.data;
  store.sync('owner', []); assert.throws(() => store.defer(data.jobId, data.token, 'snooze'), /no longer/);
  const next = job(); store.sync('owner', [{ ...next, dueAt: next.dueAt + 600000 }]); await store.tick(); assert.equal(sent.length, 1);
  store.revokeOwner('owner'); advance(600000); await store.tick(); assert.equal(sent.length, 1);
});
test('subscription and reminder ownership are isolated, malformed schedules are atomic', async t => {
  const { store, db, job, sent } = fixture(t); const sub = subscription();
  store.subscribe('a', sub); assert.throws(() => store.subscribe('b', sub), /another account/);
  store.unsubscribe('b', sub.endpoint); assert.equal(store.status('a', sub.endpoint).enabled, true);
  store.sync('a', [job()]); store.sync('b', []); await store.tick(); assert.equal(sent.length, 1);
  assert.equal(store.status('b', sub.endpoint).enabled, false);
  assert.throws(() => store.sync('a', [job(), { ...job('b'), href: 'https://evil.test/' }]), /Invalid reminder link/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reminder_jobs WHERE owner=?').get('a').n, 1);
});
test('push endpoints reject private destinations and lookalike hosts; request is encrypted', t => {
  const sub = subscription();
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com:444/a', 'https://user@fcm.googleapis.com/a']) assert.throws(() => validateSubscription({ ...sub, endpoint }), /Unsupported/);
  const request = webPush.generateRequestDetails(sub, 'private task text', { vapidDetails: { subject: 'mailto:fixture@example.test', ...keys }, TTL: 300 });
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm'); assert.ok(request.headers.Authorization.startsWith('vapid ')); assert.ok(!request.body.includes(Buffer.from('private task text')));
});
test('temporary push errors retry within bounds and expired subscriptions are removed', async t => {
  let count = 0; const f = fixture(t, { send: async () => { count++; throw Object.assign(new Error('Down'), { statusCode: 503 }); } });
  f.store.subscribe('owner', subscription()); f.store.sync('owner', [f.job()]);
  await f.store.tick(); await f.store.tick(); assert.equal(count, 1);
  f.advance(60000); await f.store.tick(); f.advance(120000); await f.store.tick(); f.advance(240000); await f.store.tick(); assert.equal(count, 3);
  assert.equal(f.db.prepare('SELECT state FROM reminder_jobs').get().state, 'failed');
  const expired = fixture(t, { send: async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); } });
  const sub = subscription(); expired.store.subscribe('owner', sub); expired.store.sync('owner', [expired.job()]); await expired.store.tick(); assert.equal(expired.store.status('owner', sub.endpoint).enabled, false);
});
test('tomorrow uses local calendar days over DST and missing/mismatched keys disable background push', t => {
  assert.equal(nextMorning(Date.parse('2026-03-07T18:00:00Z'), 'America/New_York'), Date.parse('2026-03-08T13:00:00Z'));
  const f = fixture(t, { privateKey: '' }); assert.equal(f.store.configured, false); assert.throws(() => f.store.subscribe('owner', subscription()), /not configured/);
  const mismatched = fixture(t, { privateKey: webPush.generateVAPIDKeys().privateKey }); assert.equal(mismatched.store.configured, false);
});

test('service worker shows a closed-page push and snoozes without opening a window', async t => {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const { store, db, job, sent, now } = fixture(t); store.subscribe('owner', subscription()); store.sync('owner', [job()]); await store.tick();
  const listeners = {}, displayed = [], requests = []; let closed = false, opened = false;
  const scope = 'https://fixture.example/';
  const context = vm.createContext({ URL, console, self: { location: { origin: 'https://fixture.example' }, registration: { scope, showNotification: async (title, options) => displayed.push({ title, options }) },
    addEventListener: (event, handler) => { listeners[event] = handler; }, clients: { openWindow: async () => { opened = true; }, matchAll: async () => [] } },
    fetch: async (url, options) => { requests.push(url); const body = JSON.parse(options.body); store.defer(body.jobId, body.token, body.action); return { ok: true }; },
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8'), context);
  let promise;
  listeners.push({ data: { json: () => sent[0].payload }, waitUntil: value => { promise = value; } }); await promise;
  assert.equal(displayed.length, 1); assert.equal(displayed[0].options.actions[0].action, 'snooze');
  listeners.notificationclick({ action: 'snooze', notification: { data: displayed[0].options.data, close: () => { closed = true; } }, waitUntil: value => { promise = value; } }); await promise;
  assert.equal(closed, true); assert.equal(opened, false); assert.equal(requests[0], '/api/reminders/action');
  assert.equal(db.prepare('SELECT due FROM reminder_jobs').get().due, now() + 600000);
});
