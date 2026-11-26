const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { createAttachments, diskBackend, cleanName, ownerKey } = require('../server/attachments');
const { writeStore } = require('../server/snapshot-values');

const quiet = { info() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const body = (bytes, type = 'image/png') => Object.assign(Readable.from([Buffer.from(bytes)]), { headers: { 'content-length': String(Buffer.byteLength(bytes)), 'content-type': type } });

function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-attachments-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { value: Date.parse('2026-11-26T08:00:00Z') };
  let snapshot = { payload: {} };
  const store = createAttachments({
    backend: diskBackend(root), now: () => clock.value, log: quiet,
    getSnapshotStore: () => ({ getSnapshot: async () => snapshot }), ...options,
  });
  return { root, store, clock, setSnapshot: value => { snapshot = value; } };
}

test('upload, download and per-account isolation', async t => {
  const { store } = setup(t);
  const { attachment, usage } = await store.upload('Me@Example.com', body('png-bytes'), { name: 'receipt.png', type: 'image/png' });
  assert.match(attachment.id, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual([attachment.name, attachment.type, attachment.size], ['receipt.png', 'image/png', 9]);
  assert.equal(usage.used, 9);
  const file = await store.download('me@example.com', attachment.id, 'receipt.png');
  assert.equal(file.body.toString(), 'png-bytes');
  assert.equal(file.headers['Content-Type'], 'image/png');
  assert.match(file.headers['Content-Disposition'], /^inline; filename="receipt.png"/);
  assert.equal(file.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  await assert.rejects(store.download('other@example.com', attachment.id), { statusCode: 404 }, 'another account cannot read it by id');
  await assert.rejects(store.download('me@example.com', '../../etc/passwd'), { statusCode: 404 });
});

test('anything that could run in the page downloads as bytes', async t => {
  const { store } = setup(t);
  for (const type of ['text/html', 'image/svg+xml', 'application/javascript', 'not a type']) {
    const { attachment } = await store.upload('me@example.com', body('<script>alert(1)</script>', type), { name: 'x', type });
    const file = await store.download('me@example.com', attachment.id, '名单 "final".html');
    assert.equal(file.headers['Content-Type'], 'application/octet-stream', type);
    assert.match(file.headers['Content-Disposition'], /^attachment; filename="__ final .html"; filename\*=UTF-8''%E5%90%8D%E5%8D%95%20final%20.html$/);
  }
  assert.equal(cleanName('a/b\\c\u0000.txt'), 'a b c .txt');
  assert.equal(cleanName(''), 'attachment');
});

test('size limit, quota and empty files', async t => {
  const { store } = setup(t, { maxFileBytes: 10, quotaBytes: 15 });
  await assert.rejects(store.upload('me@example.com', body('01234567890'), {}), { statusCode: 413, code: 'ATTACHMENT_TOO_LARGE' });
  const streamed = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]); streamed.headers = {};
  await assert.rejects(store.upload('me@example.com', streamed, {}), { statusCode: 413 }, 'an undeclared length is still capped');
  await store.upload('me@example.com', body('0123456789'), {});
  await assert.rejects(store.upload('me@example.com', body('012345'), {}), { statusCode: 413, code: 'ATTACHMENT_QUOTA' });
  await assert.rejects(store.upload('me@example.com', body(''), {}), { statusCode: 400 });
  await assert.rejects(store.upload('', body('x'), {}), { statusCode: 401 });
});

test('the sweep deletes only old files that no store mentions', async t => {
  const { store, clock, setSnapshot } = setup(t);
  const kept = (await store.upload('me@example.com', body('a'), {})).attachment;
  const inHistory = (await store.upload('me@example.com', body('b'), {})).attachment;
  const unused = (await store.upload('me@example.com', body('c'), {})).attachment;
  const fresh = { id: null };
  setSnapshot({ payload: writeStore(writeStore({}, 'todo-app-v2', { todos: [{ id: 't', attachments: [kept] }] }), 'dayfly-history-v1', { entries: [{ before: JSON.stringify({ attachments: [inHistory] }) }] }) });
  assert.equal(await store.sweep('me@example.com'), 0, 'nothing is old enough yet');
  clock.value += 3 * DAY;
  fresh.id = (await store.upload('me@example.com', body('d'), {})).attachment.id;
  assert.equal(await store.sweep('me@example.com'), 1);
  await assert.rejects(store.download('me@example.com', unused.id), { statusCode: 404 });
  for (const id of [kept.id, inHistory.id, fresh.id]) assert.ok(await store.download('me@example.com', id));
  setSnapshot(null);
  clock.value += 10 * DAY;
  assert.equal(await store.sweep('me@example.com'), 0, 'without a snapshot nothing is proven unused');
});

test('sweeps run at most twice a day per account', async t => {
  let calls = 0;
  const { store, clock } = setup(t, { getSnapshotStore: () => { calls += 1; return null; } });
  store.scheduleSweep('me@example.com'); store.scheduleSweep('me@example.com');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  clock.value += 12 * 60 * 60 * 1000;
  store.scheduleSweep('me@example.com');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  assert.notEqual(ownerKey('me@example.com'), ownerKey('other@example.com'));
});

test('HTTP: sign-in, same-origin uploads and the round trip', { timeout: 30_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-attachments-http-'));
  const port = 54900 + Math.floor(Math.random() * 800), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), APP_SESSION_SECRET: 'attachments-secret', DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let count = 0; count < 80 && !ready; count++) { try { ready = (await fetch(`${base}/api/health`)).ok; } catch (_) { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(ready);
  const session = JSON.stringify({ userId: 'me@example.com', email: 'me@example.com', provider: 'Google', label: 'Me' });
  const key = crypto.createHash('sha256').update('attachments-secret').digest('hex');
  const cookie = `daily_space_session=${Buffer.from(session).toString('base64url')}.${crypto.createHmac('sha256', key).update(session).digest('base64url')}`;

  assert.equal((await fetch(`${base}/api/attachments`, { method: 'POST', body: 'x' })).status, 401);
  assert.equal((await fetch(`${base}/api/attachments`, { method: 'POST', body: 'x', headers: { cookie, Origin: 'https://evil.example' } })).status, 403);
  const uploaded = await fetch(`${base}/api/attachments?name=${encodeURIComponent('发票.pdf')}`, { method: 'POST', body: '%PDF-1.4 test', headers: { cookie, Origin: base, 'Content-Type': 'application/pdf' } });
  assert.equal(uploaded.status, 201);
  const { attachment, usage } = await uploaded.json();
  assert.equal(attachment.name, '发票.pdf');
  assert.equal(usage.used, 13);
  const file = await fetch(`${base}/api/attachments/${attachment.id}?name=${encodeURIComponent(attachment.name)}`, { headers: { cookie } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal(await file.text(), '%PDF-1.4 test');
  assert.equal((await fetch(`${base}/api/attachments/${attachment.id}`)).status, 401);
  const status = await (await fetch(`${base}/api/attachments/usage`, { headers: { cookie } })).json();
  assert.deepEqual([status.count, status.storage], [1, 'disk']);
  assert.ok(fs.existsSync(path.join(directory, 'attachments', ownerKey('me@example.com'), attachment.id)), 'stored beside the database without Supabase');
});

test('Supabase Storage: creates the private bucket once, then stores, lists, reads and removes', async () => {
  const objects = new Map(), calls = { create: 0 };
  let bucketExists = false;
  const client = { storage: {
    async getBucket() { return bucketExists ? { data: { id: 'task-attachments' }, error: null } : { data: null, error: { message: 'Bucket not found' } }; },
    async createBucket(name, options) { calls.create += 1; assert.equal(options.public, false); bucketExists = true; return { data: { name }, error: null }; },
    from: () => ({
      async upload(key, buffer, options) { objects.set(key, { buffer, type: options.contentType, created: new Date(0).toISOString() }); return { error: null }; },
      async download(key) { const item = objects.get(key); return item ? { data: new Blob([item.buffer], { type: item.type }), error: null } : { data: null, error: { message: 'Not found' } }; },
      async list(prefix) { return { data: [...objects].filter(([key]) => key.startsWith(`${prefix}/`)).map(([key, item]) => ({ name: key.split('/')[1], created_at: item.created, metadata: { size: item.buffer.length } })), error: null }; },
      async remove(keys) { keys.forEach(key => objects.delete(key)); return { error: null }; },
    }),
  } };
  const store = createAttachments({ client, log: quiet, getSnapshotStore: () => ({ getSnapshot: async () => ({ payload: { 'todo-app-v2': '{"todos":[]}' } }) }) });
  assert.equal(store.storage, 'supabase');
  const { attachment } = await store.upload('me@example.com', body('jpeg', 'image/jpeg'), { name: 'a.jpg', type: 'image/jpeg' });
  await store.upload('me@example.com', body('more'), {});
  assert.equal(calls.create, 1);
  assert.ok([...objects.keys()].every(key => key.startsWith(`${ownerKey('me@example.com')}/`)), 'stored under the owner hash, never the email');
  assert.equal((await store.download('me@example.com', attachment.id)).body.toString(), 'jpeg');
  assert.equal((await store.usage('me@example.com')).used, 8);
  assert.equal(await store.sweep('me@example.com'), 2, 'old, unreferenced files are removed');
  assert.equal(objects.size, 0);
});
