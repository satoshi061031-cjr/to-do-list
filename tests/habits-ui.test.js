const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const KEY = 'dayfly-habits-v1';
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
const days = page => page.evaluate(() => { const Core = window.DailySpaceHabits, today = Core.localDate(); return { today, yesterday: Core.addDays(today, -1), before: Core.addDays(today, -2) }; });

test('habits: daily check-ins, streaks, details, editing and account isolation', { timeout: 150000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-habits-'));
  const port = 57000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let online = false;
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(`${base}/api/health`)).ok) { online = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(online, 'Isolated test server starts');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  async function pageFor(options = {}, seed = null) {
    const width = options.viewport?.width || 390;
    const context = await browser.newContext({ viewport: { width, height: width < 820 ? 844 : 900 }, isMobile: width < 820, hasTouch: width < 820, serviceWorkers: 'block', ...options });
    t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(seed => {
      if (sessionStorage.getItem('habits-fixture')) return;
      sessionStorage.setItem('habits-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en');
      if (seed) new Function(seed)();
    }, seed);
    return page;
  }
  const row = (page, name) => page.locator('.habit-row', { has: page.locator('.habit-name', { hasText: name }) });

  const phone = await pageFor();
  await t.test('the Toolbox card opens Habits; a new habit can be checked in today and yesterday, and it persists', async () => {
    await phone.goto(`${base}/tools.html`, { waitUntil: 'load' });
    await phone.locator('[data-tool=habits]').click();
    await phone.waitForURL('**/habits.html');
    await phone.locator('[data-habits-empty]').waitFor();
    assert.equal(await phone.locator('.bento-rail [data-rail-page=tools]').getAttribute('aria-current'), 'page', 'More stays the current dock group');
    await phone.locator('[data-habits-new]').click();
    await phone.waitForURL(/habits\.html\?new=1$/);
    assert.ok(await phone.locator('[name=name]').evaluate(el => el === document.activeElement), 'the name field is ready for typing');
    await phone.locator('[name=name]').fill('Read 10 pages');
    await phone.locator('label.habit-choice', { has: phone.locator('input[name=icon][value="📚"]') }).click();
    await phone.locator('label.habit-choice', { has: phone.locator('input[name=color][value=success]') }).click();
    await phone.getByRole('button', { name: 'Save habit', exact: true }).click();
    await phone.waitForURL(url => url.pathname.endsWith('/habits.html') && !url.search);
    const read = row(phone, 'Read 10 pages');
    await read.waitFor();
    assert.ok(await read.locator('[data-habit-open]').evaluate(el => el === document.activeElement), 'focus returns to the new habit');
    const habit = (await stored(phone)).habits[0];
    assert.deepEqual({ name: habit.name, icon: habit.icon, color: habit.color, frequency: habit.frequency, archivedAt: habit.archivedAt }, { name: 'Read 10 pages', icon: '📚', color: 'success', frequency: { type: 'daily' }, archivedAt: null });

    const { today, yesterday } = await days(phone);
    const check = read.locator('[data-habit-check]');
    assert.equal(await check.getAttribute('aria-pressed'), 'false');
    await check.click();
    assert.equal(await check.getAttribute('aria-pressed'), 'true');
    assert.match(await read.locator('[data-habit-meta]').textContent(), /1-day streak/);
    assert.equal(await phone.locator('[data-habits-progress]').textContent(), '1 of 1 done today');
    await read.locator(`[data-habit-day][data-date="${yesterday}"]`).click();
    assert.match(await read.locator('[data-habit-meta]').textContent(), /2-day streak/);
    assert.deepEqual(Object.keys((await stored(phone)).checkins[habit.id]), [yesterday, today]);
    for (const box of await read.locator('.habit-check, .habit-day').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))) assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await phone.reload();
    await read.waitFor();
    assert.equal(await read.locator('[data-habit-check]').getAttribute('aria-pressed'), 'true');
    assert.match(await read.locator('[data-habit-meta]').textContent(), /2-day streak/);
    await read.locator('[data-habit-check]').click();
    assert.equal(await read.locator('[data-habit-check]').getAttribute('aria-pressed'), 'false', 'tapping again undoes today');
    assert.match(await read.locator('[data-habit-meta]').textContent(), /1-day streak/, 'an unfinished today keeps the streak from yesterday');
    await read.locator('[data-habit-check]').click();
  });

  await t.test('details show streaks, the 30-day rate and a 12-week heatmap; Back returns to the list', async () => {
    const read = row(phone, 'Read 10 pages');
    await read.locator('[data-habit-open]').click();
    await phone.waitForURL(/habits\.html\?id=/);
    assert.ok(await phone.locator('.habit-detail h2').evaluate(el => el === document.activeElement));
    assert.equal(await phone.locator('[data-habit-stat=current]').textContent(), '2 days');
    assert.equal(await phone.locator('[data-habit-stat=best]').textContent(), '2 days');
    assert.equal(await phone.locator('[data-habit-stat=rate]').textContent(), '100%');
    assert.equal(await phone.locator('[data-habit-stat=total]').textContent(), '2');
    assert.equal(await phone.locator('[data-habit-today]').getAttribute('aria-pressed'), 'true');
    assert.equal(await phone.locator('[data-habit-heatmap] .habit-cell').count(), 84);
    assert.match(await phone.locator('[data-habit-heatmap]').getAttribute('aria-label'), /Last 12 weeks: done on 2 of 2 scheduled days/);
    const { today } = await days(phone);
    assert.equal(await phone.locator(`[data-habit-heatmap] .habit-cell[data-date="${today}"]`).getAttribute('data-state'), 'done');
    await phone.goBack();
    await read.waitFor();
    await read.locator('[data-habit-open]').click();
    await phone.getByRole('button', { name: 'All habits', exact: true }).click();
    await phone.waitForURL(url => !url.search);
    assert.ok(await read.locator('[data-habit-open]').evaluate(el => el === document.activeElement), 'the in-page back action restores focus to the habit');
  });

  await t.test('editing keeps history; reorder, archive and restore keep the list in order', async () => {
    await phone.locator('[data-habits-new]').click();
    await phone.locator('[name=name]').fill('Call family');
    await phone.locator('label.habit-choice', { has: phone.locator('input[name=frequency][value=weekly]') }).click();
    await phone.locator('[name=times]').selectOption('2');
    await phone.getByRole('button', { name: 'Save habit', exact: true }).click();
    const call = row(phone, 'Call family');
    await call.waitFor();
    assert.match(await call.locator('[data-habit-meta]').textContent(), /Twice a week · 0\/2 this week/);

    await call.locator('[data-habit-open]').click();
    await phone.getByRole('button', { name: 'Edit', exact: true }).click();
    await phone.waitForURL(/habits\.html\?edit=/);
    await phone.locator('[name=name]').fill('Call my family');
    await phone.goBack();
    await phone.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await phone.locator('[name=name]').inputValue(), 'Call my family', 'Back keeps an unsaved draft');
    await phone.getByRole('button', { name: 'Save habit', exact: true }).click();
    await phone.waitForURL(/habits\.html\?id=/);
    assert.equal(await phone.locator('.habit-detail h2').textContent(), 'Call my family');
    await phone.getByRole('button', { name: 'All habits', exact: true }).click();

    await phone.locator('[data-habits-reorder]').click();
    const up = phone.getByRole('button', { name: 'Move Call my family up', exact: true });
    await up.click();
    assert.deepEqual((await stored(phone)).habits.map(item => item.name), ['Call my family', 'Read 10 pages']);
    assert.equal(await up.isDisabled(), true);
    assert.ok(await phone.getByRole('button', { name: 'Move Call my family down', exact: true }).evaluate(el => el === document.activeElement), 'focus stays on a usable move control');
    await phone.locator('[data-habits-reorder]').click();
    assert.deepEqual(await phone.locator('[data-habits-group=today] .habit-name').allTextContents(), ['Call my family', 'Read 10 pages']);

    await row(phone, 'Call my family').locator('[data-habit-open]').click();
    await phone.locator('[data-habit-archive]').click();
    assert.equal(await phone.locator('[data-habit-archive]').textContent(), 'Restore');
    assert.match(await phone.locator('[data-habits-status]').textContent(), /Archived/);
    await phone.getByRole('button', { name: 'All habits', exact: true }).click();
    assert.equal(await phone.locator('[data-habits-group] .habit-name', { hasText: 'Call my family' }).count(), 0, 'archived habits leave Today');
    await phone.locator('[data-habits-archived] summary').click();
    await phone.getByRole('button', { name: 'Restore Call my family', exact: true }).click();
    await row(phone, 'Call my family').locator('[data-habit-check]').waitFor();
    assert.equal((await stored(phone)).habits.find(item => item.name === 'Call my family').archivedAt, null);
  });

  await t.test('delete is immediate with the shared Undo bar, which restores the habit and its check-ins', async () => {
    const before = await stored(phone);
    await row(phone, 'Read 10 pages').locator('[data-habit-open]').click();
    await phone.locator('[data-habit-delete]').click();
    await phone.waitForURL(url => !url.search);
    assert.equal(await row(phone, 'Read 10 pages').count(), 0);
    const bar = phone.locator('#undo-bar');
    await bar.waitFor({ state: 'visible' });
    assert.match(await bar.textContent(), /Deleted “Read 10 pages”/);
    await bar.locator('.undo-bar-action').click();
    await row(phone, 'Read 10 pages').waitFor();
    assert.deepEqual(await stored(phone), before);
  });

  await t.test('desktop keeps the strip in the row and supports the keyboard', async () => {
    const desktop = await pageFor({ viewport: { width: 1440, height: 900 } }, `localStorage.setItem('${KEY}', JSON.stringify({ version: 1, habits: [{ id: 'water', name: 'Drink water', icon: '💧', color: 'primary', frequency: { type: 'daily' }, createdAt: Date.now() - 864e6, archivedAt: null, order: 0 }], checkins: {} }));`);
    await desktop.goto(`${base}/habits.html`, { waitUntil: 'load' });
    const water = row(desktop, 'Drink water');
    await water.waitFor();
    const [rowBox, openBox, stripBox] = await Promise.all(['', '[data-habit-open]', '.habit-strip'].map(selector => (selector ? water.locator(selector) : water).boundingBox()));
    assert.ok(stripBox.x > openBox.x + openBox.width - 1 && stripBox.y >= rowBox.y && stripBox.y + stripBox.height <= rowBox.y + rowBox.height + 1, 'the strip sits beside the habit');
    assert.ok(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const { today, yesterday } = await days(desktop);
    await water.locator('[data-habit-check]').focus();
    await desktop.keyboard.press('Space');
    assert.equal(await water.locator('[data-habit-check]').getAttribute('aria-pressed'), 'true');
    assert.ok(await water.locator('[data-habit-check]').evaluate(el => el === document.activeElement), 'focus survives the update');
    await desktop.keyboard.press('Tab'); await desktop.keyboard.press('Tab');
    assert.equal(await desktop.evaluate(() => document.activeElement.dataset.date), today, 'the strip is one tab stop, starting today');
    await desktop.keyboard.press('ArrowLeft');
    assert.equal(await desktop.evaluate(() => document.activeElement.dataset.date), yesterday);
    await desktop.keyboard.press('Enter');
    assert.equal(await water.locator(`[data-date="${yesterday}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await desktop.evaluate(() => document.activeElement.dataset.date), yesterday);
    assert.match(await water.locator('[data-habit-meta]').textContent(), /2-day streak/);
  });

  await t.test('each account sees and syncs only its own habits; Guest keeps its own workspace', async () => {
    const habitStore = (id, name) => JSON.stringify({ version: 1, habits: [{ id, name, icon: '', color: 'primary', frequency: { type: 'daily' }, createdAt: Date.now() - 864e6, archivedAt: null, order: 0 }], checkins: {} });
    const clouds = new Map([
      ['alice@example.com', { payload: { [KEY]: habitStore('alice-walk', 'Alice walk') }, revision: 1, updatedAt: '2026-11-12T00:00:00.000Z' }],
      ['bob@example.com', { payload: { [KEY]: habitStore('bob-stretch', 'Bob stretch') }, revision: 1, updatedAt: '2026-11-12T00:00:00.000Z' }],
    ]);
    let user = { provider: 'Google', email: 'alice@example.com', label: 'Alice', userId: 'alice@example.com' };
    const page = await pageFor({}, `localStorage.setItem('daily-space-auth-v1', ${JSON.stringify(JSON.stringify(user))});`);
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/auth/me') return json(route, { user });
      if (url.pathname === '/api/user/snapshot') {
        if (!user) return json(route, { error: 'Please sign in first.' }, 401);
        let cloud = clouds.get(user.email) || { payload: {}, revision: 0, updatedAt: null };
        if (request.method() === 'PUT') { cloud = { payload: request.postDataJSON().payload, revision: cloud.revision + 1, updatedAt: new Date().toISOString() }; clouds.set(user.email, cloud); }
        return json(route, { ok: true, ...cloud });
      }
      return json(route, { notifications: [], tasks: [], workspaces: [], accounts: [] });
    });
    await page.goto(`${base}/habits.html`, { waitUntil: 'load' });
    await row(page, 'Alice walk').waitFor();
    const { today } = await days(page);
    await row(page, 'Alice walk').locator('[data-habit-check]').click();
    await page.waitForFunction(() => document.querySelector('.workspace-save-status')?.textContent.includes('Synced to cloud'));
    assert.deepEqual(JSON.parse(clouds.get('alice@example.com').payload[KEY]).checkins, { 'alice-walk': { [today]: 1 } });

    user = { provider: 'Google', email: 'bob@example.com', label: 'Bob', userId: 'bob@example.com' };
    await page.evaluate(user => { localStorage.setItem('daily-space-auth-v1', JSON.stringify(user)); window.dispatchEvent(new CustomEvent('daily-space-auth-updated')); }, user);
    await row(page, 'Bob stretch').waitFor();
    assert.equal(await row(page, 'Alice walk').count(), 0);
    assert.equal(await row(page, 'Bob stretch').locator('[data-habit-check]').getAttribute('aria-pressed'), 'false');
    assert.equal(JSON.parse(clouds.get('bob@example.com').payload[KEY]).habits.length, 1);

    // A workspace that is still loading shows no personal habits and accepts no writes.
    await page.evaluate(() => { document.documentElement.dataset.workspaceReady = 'false'; document.documentElement.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated')); });
    assert.equal(await page.locator('.habit-row').count(), 0);
    assert.match(await page.locator('#habits-content').textContent(), /loading/);

    user = null;
    await page.evaluate(() => { localStorage.removeItem('daily-space-auth-v1'); window.dispatchEvent(new CustomEvent('daily-space-auth-updated')); });
    await page.locator('[data-habits-empty]').waitFor();
    assert.equal(await page.locator('.habit-row').count(), 0, 'Guest does not see account habits');
    assert.equal(JSON.parse(clouds.get('alice@example.com').payload[KEY]).habits[0].name, 'Alice walk');
  });

  assert.deepEqual(errors, []);
});
