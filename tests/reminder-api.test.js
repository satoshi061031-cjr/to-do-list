const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto'); const { spawn } = require('node:child_process');
const webPush = require('web-push');
function cookie(owner, provider = 'Google') {
  const json = JSON.stringify({ userId: owner, email: owner, provider, label: owner });
  const key = crypto.createHash('sha256').update('reminder-api-fixture-secret').digest('hex');
  return `daily_space_session=${Buffer.from(json).toString('base64url')}.${crypto.createHmac('sha256', key).update(json).digest('base64url')}`;
}
test('reminder HTTP routes enforce Google ownership, origin checks and logout revocation', { timeout: 15000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-space-push-api-')); const port = 51000 + Math.floor(Math.random()*3000); const base = `http://127.0.0.1:${port}`; const keys = webPush.generateVAPIDKeys();
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'db.sqlite'), APP_SESSION_SECRET: 'reminder-api-fixture-secret', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:fixture@example.test' }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false; for (let i=0; i<50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve,100)); } assert.equal(ready,true);
  const peer = crypto.createECDH('prime256v1'); peer.generateKeys(); const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/api-fixture', keys: { p256dh: peer.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const schedule = { jobs: [{ source: 'todo:a', title: 'Private fixture', dueAt: Date.now()+3600000, href: 'todo.html?focus=todo&id=a', timeZone: 'UTC' }], subscription: sub };
  const request = (route, method, body, owner, extra = {}) => fetch(`${base}/api/reminders/${route}`, { method, headers: { 'Content-Type': 'application/json', ...(owner ? { cookie: cookie(owner) } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('subscription', 'POST', schedule)).status, 401);
  assert.equal((await request('subscription', 'POST', schedule, 'a@example.test', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('subscription', 'POST', schedule, 'a@example.test', { cookie: cookie('a@example.test', 'Outlook') })).status, 403);
  assert.equal((await request('subscription', 'POST', schedule, 'a@example.test', { origin: base })).status, 200);
  const status = async owner => (await request(`status?endpoint=${encodeURIComponent(sub.endpoint)}`, 'GET', null, owner)).json();
  assert.equal((await status('a@example.test')).enabled, true); assert.equal((await status('b@example.test')).enabled, false); assert.equal((await status(null)).enabled, false);
  assert.equal((await request('subscription', 'POST', schedule, 'b@example.test')).status, 409);
  assert.equal((await request('subscription', 'DELETE', { endpoint: sub.endpoint }, 'b@example.test')).status, 200); assert.equal((await status('a@example.test')).enabled, true);
  assert.equal((await request('schedule', 'PUT', { jobs: [] }, 'a@example.test')).status, 200);
  assert.equal((await request('action', 'POST', { jobId: 'missing', token: crypto.randomBytes(32).toString('base64url'), action: 'snooze' })).status, 410);
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: cookie('a@example.test') } }); assert.equal((await status('a@example.test')).enabled, false);
});
