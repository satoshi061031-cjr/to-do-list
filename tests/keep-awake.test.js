const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeepAwake, keepAwakeUrl } = require('../server/keep-awake');

const quiet = { info() {}, error() {} };

test('the ping targets the public health check, from Render or an override', () => {
  assert.equal(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://dayfly.onrender.com' }), 'https://dayfly.onrender.com/api/health');
  assert.equal(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://dayfly.onrender.com/', KEEP_AWAKE_URL: 'https://my.example/app/' }), 'https://my.example/api/health');
  assert.equal(keepAwakeUrl({ KEEP_AWAKE_URL: 'http://127.0.0.1:3000' }), 'http://127.0.0.1:3000/api/health');
});

test('no ping without a usable address, over plain HTTP to another host, or when turned off', () => {
  assert.equal(keepAwakeUrl({}), null);
  assert.equal(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'not a url' }), null);
  assert.equal(keepAwakeUrl({ KEEP_AWAKE_URL: 'http://dayfly.example' }), null);
  assert.equal(keepAwakeUrl({ KEEP_AWAKE_URL: 'https://user:pass@dayfly.example' }), null);
  for (const value of ['off', 'false', '0', 'NO']) assert.equal(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://dayfly.onrender.com', KEEP_AWAKE: value }), null);
});

test('it only starts when reminders are configured, and only once', () => {
  const env = { RENDER_EXTERNAL_URL: 'https://dayfly.onrender.com' };
  const off = createKeepAwake({ env, enabled: false, log: quiet });
  assert.equal(off.start(), false);
  const on = createKeepAwake({ env, enabled: true, intervalMs: 60_000, log: quiet });
  assert.equal(on.start(), true);
  assert.equal(on.start(), false);
  on.stop();
});

test('pings report success and a persistent failure is logged once', async () => {
  const calls = [], errors = [];
  let ok = true;
  const keep = createKeepAwake({
    env: { RENDER_EXTERNAL_URL: 'https://dayfly.onrender.com' }, log: { info() {}, error: message => errors.push(message) },
    fetchImpl: async (url, init) => { calls.push({ url, agent: init.headers['User-Agent'] }); if (!ok) throw new Error('down'); return { ok: true }; },
  });
  assert.equal(await keep.ping(), true);
  assert.deepEqual(calls[0], { url: 'https://dayfly.onrender.com/api/health', agent: 'dayfly-keep-awake' });
  ok = false;
  for (let i = 0; i < 5; i++) assert.equal(await keep.ping(), false);
  assert.equal(errors.length, 1);
  ok = true;
  assert.equal(await keep.ping(), true);
});
