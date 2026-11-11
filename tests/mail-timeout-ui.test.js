const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('mail timeout and cancellation recovery', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-space-mail-timeout-'));
  const port = 54000 + Math.floor(Math.random() * 4000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'mail.sqlite'),
      GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let ready = false;
  for (let index = 0; index < 50; index++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Isolated mail test server starts');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  const user = { userId: 'mail-reader', email: 'mail-reader@example.com', provider: 'Google', label: 'Reader' };
  const message = { id: 'hotel', subject: 'Hotel booking confirmation', from: 'Kyoto Hotel',
    receivedAt: new Date().toISOString(), snippet: 'Your hotel reservation is confirmed.' };
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

  async function pageFor() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(account => {
      localStorage.setItem('daily-space-auth-v1', JSON.stringify(account));
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      const originalFetch = window.fetch;
      window.pendingMailReplies = [];
      window.fetch = (url, options) => {
        const value = String(url);
        const hang = (window.hangAccountCheck && value === '/api/auth/me') ||
          (window.hangBookingParse && value.endsWith('/booking-import'));
        if (!hang) return originalFetch(url, options);
        if (value === '/api/auth/me') window.hangAccountCheck = false;
        else window.hangBookingParse = false;
        // Deliberately ignore AbortSignal: the controller must reject and ignore
        // this response without depending on the browser canceling transport.
        return new Promise(resolve => window.pendingMailReplies.push(payload => resolve(new Response(JSON.stringify(payload), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }))));
      };
    }, user);
    let cloud = { payload: {}, revision: 0, updatedAt: null };
    await page.route('**/api/user/snapshot', route => {
      if (route.request().method() === 'PUT') cloud = { payload: route.request().postDataJSON().payload, revision: cloud.revision + 1, updatedAt: new Date().toISOString() };
      return json(route, { ok: true, userId: user.email, ...cloud });
    });
    await page.route('**/api/auth/me', route => json(route, { user }));
    await page.route('**/api/mail/accounts', route => json(route, { accounts: [{ id: 'personal', provider: 'Gmail', email: user.email, hasCredentials: true }] }));
    await page.route('**/api/mail/accounts/personal/digest?*', route => json(route, { messages: [message], digest: 'Hotel booking details', summarized: true }));
    await page.route('**/api/travel/trips', route => json(route, { trips: [] }));
    await page.route('**/api/me/notifications?*', route => json(route, { notifications: [] }));
    return page;
  }

  await t.test('account checks time out with Retry and a late old identity cannot replace the recovered inbox', async () => {
    const page = await pageFor();
    await page.addInitScript(() => { window.hangAccountCheck = true; });
    await page.goto(`${base}/mail.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.pendingMailReplies.length === 1);
    await page.clock.runFor(20050);
    await page.locator('#mail-page-status .mail-retry-btn').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mail-page-status').textContent(), /timed out/i);
    assert.equal(await page.locator('#mail-page-status .mail-retry-btn').isDisabled(), false);
    await page.locator('#mail-page-status .mail-retry-btn').click();
    await page.locator('[data-open-mail="hotel"]').waitFor({ state: 'visible' });
    await page.locator('#mail-page-status').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#mail-account-switcher').inputValue(), 'personal');
    await page.evaluate(() => window.pendingMailReplies[0]({ user: { userId: 'stale-user', email: 'stale@example.com', label: 'Stale user', provider: 'Google' } }));
    await page.clock.runFor(10);
    assert.equal(await page.locator('#mail-account-switcher').inputValue(), 'personal');
    assert.ok(await page.locator('[data-open-mail="hotel"]').isVisible());
    assert.equal(await page.locator('#mail-page-status').isVisible(), false);
  });

  await t.test('booking parsing times out, retries and ignores late results after retry and reader closure', async () => {
    const page = await pageFor();
    await page.route('**/api/mail/accounts/personal/messages/hotel/booking-import', route => json(route, {
      bookings: [], source: { subject: 'Fresh booking confirmation' }, parsedBy: 'fallback',
    }));
    await page.goto(`${base}/mail.html`, { waitUntil: 'load' });
    await page.locator('[data-open-mail="hotel"]').click();
    await page.evaluate(() => { window.hangBookingParse = true; });
    await page.locator('#mail-detail-booking').click();
    await page.waitForFunction(() => window.pendingMailReplies.length === 1);
    await page.clock.runFor(20050);
    await page.locator('#mail-detail-status .mail-retry-btn').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mail-detail-status').textContent(), /timed out/i);
    assert.equal(await page.locator('#mail-detail-booking').isDisabled(), false);
    await page.locator('#mail-detail-status .mail-retry-btn').click();
    await page.locator('#mail-booking-sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#mail-booking-source').textContent(), 'Fresh booking confirmation');
    await page.evaluate(() => window.pendingMailReplies[0]({ bookings: [], source: { subject: 'Late timed out booking' } }));
    await page.clock.runFor(10);
    assert.equal(await page.locator('#mail-booking-source').textContent(), 'Fresh booking confirmation');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#mail-detail-sheet').isVisible());
    await page.evaluate(() => { window.hangBookingParse = true; });
    await page.locator('#mail-detail-booking').click();
    await page.waitForFunction(() => window.pendingMailReplies.length === 2);
    await page.keyboard.press('Escape');
    await page.locator('#mail-detail-sheet').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.pendingMailReplies[1]({ bookings: [], source: { subject: 'Late closed reader booking' } }));
    await page.clock.runFor(10);
    assert.equal(await page.locator('#mail-booking-sheet').isVisible(), false);
    assert.equal(await page.locator('#mail-booking-source').textContent(), '');
    assert.equal(await page.locator('#mail-detail-booking').isDisabled(), false);
    await page.locator('[data-open-mail="hotel"]').click();
    await page.locator('#mail-detail-booking').click();
    await page.locator('#mail-booking-sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#mail-booking-source').textContent(), 'Fresh booking confirmation');
  });

  assert.deepEqual(errors, [], 'No browser JavaScript errors');
});
