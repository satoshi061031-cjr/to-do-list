const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const webPush = require('web-push');
const { createReminderStore } = require('../server/reminder-store');
const { createReminderBackup } = require('../server/reminder-backup');

const keys = webPush.generateVAPIDKeys();
const peer = crypto.createECDH('prime256v1'); peer.generateKeys();
const subscription = id => ({ endpoint: `https://fcm.googleapis.com/fcm/send/backup-${id}`, keys: { p256dh: peer.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });

/** Just enough of the Supabase query builder for reminder_backups. */
function fakeSupabase() {
  const rows = new Map();
  const client = {
    rows,
    from() {
      return {
        upsert: async row => { rows.set(row.user_id, JSON.parse(JSON.stringify(row))); return { error: null }; },
        delete: () => ({ eq: async (_, id) => { rows.delete(id); return { error: null }; } }),
        select: () => ({ order: () => ({ range: async (from, to) => ({ data: [...rows.values()].slice(from, to + 1), error: null }) }) }),
      };
    },
  };
  return client;
}

function server(t, client, clock) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const sent = [];
  let backup = null;
  const store = createReminderStore(db, {
    ...keys, subject: 'mailto:fixture@example.test', now: () => clock.value,
    send: async (_, payload) => sent.push(JSON.parse(payload)),
    onChange: owner => backup?.scheduleSave(owner),
  });
  backup = createReminderBackup({ store, client, delayMs: 0, log: { error() {}, info() {} } });
  return { db, store, backup, sent };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('a wiped server restores subscriptions and schedules and still sends due reminders', async t => {
  const client = fakeSupabase();
  const clock = { value: Date.parse('2026-11-21T08:00:00Z') };
  const first = server(t, client, clock);
  first.store.subscribe('me@example.com', subscription('phone'));
  first.store.sync('me@example.com', [{ source: 'todo:a', title: 'Pay rent', dueAt: clock.value + 3_600_000, href: 'todo.html?focus=todo&id=a', timeZone: 'Asia/Shanghai' }]);
  await settle();
  assert.equal(client.rows.get('me@example.com').subscriptions.length, 1);
  assert.equal(client.rows.get('me@example.com').jobs.length, 1);

  // Redeploy: empty SQLite file, same Supabase.
  const second = server(t, client, clock);
  assert.equal(second.store.status('me@example.com', subscription('phone').endpoint).enabled, false);
  assert.equal(await second.backup.restoreAll(), 1);
  assert.equal(second.store.status('me@example.com', 'https://fcm.googleapis.com/fcm/send/backup-phone').enabled, true, 'the browser keeps its push key');
  clock.value += 3_600_000;
  await second.store.tick();
  assert.equal(second.sent.length, 1);
  assert.equal(second.sent[0].body, 'Pay rent');
  await settle();
  assert.equal(client.rows.get('me@example.com').jobs[0].state, 'delivered', 'delivery is backed up, so a later wipe does not resend it');

  const third = server(t, client, clock);
  await third.backup.restoreAll();
  await third.store.tick();
  assert.equal(third.sent.length, 0);
});

test('restore never overwrites rows the server already has, and revoking an account removes its copy', async t => {
  const client = fakeSupabase();
  const clock = { value: Date.parse('2026-11-21T08:00:00Z') };
  const a = server(t, client, clock);
  a.store.subscribe('me@example.com', subscription('old'));
  await settle();
  const b = server(t, client, clock);
  b.store.subscribe('me@example.com', subscription('new'));
  assert.equal(await b.backup.restoreAll(), 0);
  assert.equal(b.store.status('me@example.com', 'https://fcm.googleapis.com/fcm/send/backup-old').enabled, false);
  b.store.revokeOwner('me@example.com');
  await settle();
  assert.equal(client.rows.has('me@example.com'), false);
});

test('without Supabase the backup is a no-op', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const store = createReminderStore(db, { ...keys, subject: 'mailto:fixture@example.test' });
  const backup = createReminderBackup({ store, config: { url: '', serviceRoleKey: '' } });
  assert.equal(backup.configured, false);
  assert.equal(await backup.restoreAll(), 0);
  backup.scheduleSave('me@example.com');
  await backup.flush();
});

test('corrupt backup rows are skipped instead of breaking start-up', async t => {
  const client = fakeSupabase();
  client.rows.set('x@example.com', { user_id: 'x@example.com', subscriptions: [{ payload: '{"endpoint":"https://evil.example/"}' }, { payload: 'not json' }], jobs: [{ id: 1 }, null, { id: 'j', source: 'bad', due: 1 }] });
  const clock = { value: Date.now() };
  const s = server(t, client, clock);
  assert.equal(await s.backup.restoreAll(), 0);
  assert.equal(s.store.hasOwnerRows('x@example.com'), false);
});

test('the wake-up endpoint needs the shared secret', { timeout: 30_000 }, async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { spawn } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-tick-'));
  const port = 53900 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`, secret = crypto.randomBytes(24).toString('base64url');
  const child = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', REMINDER_TICK_SECRET: secret }, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let count = 0; count < 80 && !ready; count++) { try { ready = (await fetch(`${base}/api/health`)).ok; } catch (_) { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(ready);
  const tick = authorization => fetch(`${base}/api/reminders/tick`, { method: 'POST', headers: authorization ? { Authorization: authorization } : {} });
  assert.equal((await tick()).status, 401);
  assert.equal((await tick('Bearer wrong-secret-value-123')).status, 401);
  const ok = await tick(`Bearer ${secret}`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});
