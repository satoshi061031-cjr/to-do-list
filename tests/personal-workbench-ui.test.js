const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const PREFERENCES_KEY = 'daily-space-workbench-v1';
const preference = name => ({ version: 1, name, displayName: '', sections: ['agenda', 'tasks', 'shortcuts', 'spend', 'travel'], hidden: [], shortcuts: ['planner', 'mail', 'travel'] });

test('personal workbench settings and existing daily workflows', { timeout: 90_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-space-workbench-'));
  const port = 52000 + Math.floor(Math.random() * 3000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: 'ignore',
  });
  t.after(async () => {
    if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Isolated test server starts');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  async function pageFor(options = {}, seed = true) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...options });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(seed => {
      if (sessionStorage.getItem('workbench-fixture')) return;
      sessionStorage.setItem('workbench-fixture', '1');
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en');
      if (!seed) return;
      const date = new Date();
      const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [
        { id: 'workbench-task', text: 'Review my weekly plan', dueDate: today, completed: false },
        { id: 'second-task', text: 'Book a table', dueDate: today, completed: false },
      ] }));
      localStorage.setItem('tally-book-v1', JSON.stringify({ baseCurrency: 'CNY', records: [{ id: 'lunch', date: today, category: 'Lunch', amount: 32, currency: 'CNY', fxRate: 1, scope: 'personal' }] }));
    }, seed);
    return page;
  }
  async function openSettings(page) {
    await page.locator('[data-workbench-settings]').click();
    const settings = page.locator('#workbench-settings');
    await settings.waitFor({ state: 'visible' });
    return settings;
  }
  async function saveSettings(settings) {
    await settings.locator('button[type=submit]').click();
    await settings.waitFor({ state: 'hidden' });
  }
  async function capture(page, name) {
    if (!process.env.UI_CAPTURE_DIR) return;
    fs.mkdirSync(process.env.UI_CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UI_CAPTURE_DIR, name), animations: 'disabled', style: '#sidebar-hint { visibility: hidden; }' });
  }

  await t.test('custom name, visible sections and shortcuts persist through normal navigation and reload', async () => {
    const page = await pageFor({ isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'My workbench');
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1);
    const settings = await openSettings(page);
    await settings.locator('[name=name]').fill('My quiet space');
    await settings.locator('[name=displayName]').fill('Lin');
    await settings.locator('[data-section-visibility=spend]').uncheck();
    await settings.locator('[data-section-up=shortcuts]').click();
    await settings.locator('[name=shortcut][value=mail]').uncheck();
    await settings.locator('[name=shortcut][value=calendar]').check();
    await saveSettings(settings);
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'My quiet space');
    assert.equal(await page.locator('[data-workbench-section=spend]').isVisible(), false);
    assert.ok(await page.locator('[data-workbench-section=shortcuts] a[href^="calendar.html"]').isVisible());
    assert.equal(await page.locator('[data-workbench-section=shortcuts] a[href^="mail.html"]').count(), 0);
    const saved = await page.evaluate(() => window.DailySpaceWorkbenchPreferences.read());
    assert.equal(saved.displayName, 'Lin');
    assert.ok(saved.sections.indexOf('shortcuts') < saved.sections.indexOf('tasks'));
    assert.ok(saved.hidden.includes('spend'));
    await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.reload();
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'My quiet space');
    assert.equal(await page.locator('[data-workbench-section=spend]').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.DailySpaceWorkbenchPreferences.read()), saved);
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1, 'The workbench reuses the original task list');
    await page.locator('#todo-list [data-id=workbench-task] .todo-check-target').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'workbench-task')?.completed);
    await capture(page, 'workbench-personalized-phone.png');
  });

  await t.test('settings keep unfinished input on Back, restore focus and stay usable above a short viewport', async () => {
    const page = await pageFor({ isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    const trigger = page.locator('[data-workbench-settings]');
    let settings = await openSettings(page);
    await settings.locator('[name=name]').fill('An unfinished workspace name');
    for (let step = 0; step < 16; step++) {
      await page.keyboard.press(step % 3 ? 'Tab' : 'Shift+Tab');
      assert.ok(await settings.evaluate(node => node.contains(document.activeElement)));
    }
    await page.goBack();
    await settings.waitFor({ state: 'hidden' });
    assert.ok(await trigger.evaluate(node => node === document.activeElement));
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'My workbench');
    settings = await openSettings(page);
    assert.equal(await settings.locator('[name=name]').inputValue(), 'An unfinished workspace name');
    await page.evaluate(() => window.DailySpaceI18n.setLocale('zh'));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 420 });
      const submit = settings.locator('button[type=submit]');
      await page.waitForFunction(() => {
        const button = document.querySelector('#workbench-settings button[type=submit]');
        const box = button.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      });
      const box = await submit.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await capture(page, `workbench-settings-${width}-420.png`);
    }
    await saveSettings(settings);
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'An unfinished workspace name');
  });

  await t.test('section reordering keeps keyboard focus usable and language changes preserve the open settings draft', async () => {
    const page = await pageFor({ isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    const settings = await openSettings(page);
    await settings.locator('[name=name]').fill('My focused space');
    await settings.locator('[name=displayName]').fill('Lin');
    await settings.locator('[data-section-visibility=travel]').uncheck();
    await settings.locator('[name=shortcut][value=travel]').uncheck();
    await settings.locator('[name=shortcut][value=calendar]').check();
    await settings.locator('[data-section-up=shortcuts]').click();
    assert.ok(await settings.locator('[data-section-up=shortcuts]').evaluate(node => node === document.activeElement && !node.disabled));
    await page.keyboard.press('Enter');
    assert.ok(await settings.locator('[data-section-up=shortcuts]').isDisabled());
    assert.ok(await settings.locator('[data-section-down=shortcuts]').evaluate(node => node === document.activeElement && !node.disabled), 'Moving a section to the first position focuses its remaining available arrow');
    await settings.locator('[name=name]').focus();
    await page.evaluate(() => window.DailySpaceI18n.setLocale('zh'));
    assert.equal(await settings.locator('#workbench-settings-title').textContent(), '自定义工作台');
    assert.equal(await settings.locator('button[type=submit]').textContent(), '保存');
    assert.equal(await settings.locator('[name=name]').inputValue(), 'My focused space');
    assert.equal(await settings.locator('[name=displayName]').inputValue(), 'Lin');
    assert.ok(await settings.locator('[name=name]').evaluate(node => node === document.activeElement));
    assert.equal(await settings.locator('[data-section-visibility=travel]').isChecked(), false);
    assert.equal(await settings.locator('[name=shortcut][value=travel]').isChecked(), false);
    assert.equal(await settings.locator('[name=shortcut][value=calendar]').isChecked(), true);
    await saveSettings(settings);
    const saved = await page.evaluate(() => window.DailySpaceWorkbenchPreferences.read());
    assert.equal(saved.sections[0], 'shortcuts');
    const order = () => page.locator('.workbench-sections > [data-workbench-section]').evaluateAll(nodes => nodes.map(node => node.dataset.workbenchSection));
    assert.deepEqual(await order(), saved.sections, 'DOM reading and keyboard order follow the selected layout');
    await page.reload();
    assert.deepEqual(await order(), saved.sections, 'The reading order also survives reload');
  });

  await t.test('a failed device write keeps the saved configuration and the unsaved form available', async () => {
    const page = await pageFor({ isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.evaluate(() => window.DailySpaceWorkbenchPreferences.save({ name: 'Saved workspace' }));
    const settings = await openSettings(page);
    await settings.locator('[name=name]').fill('Not saved yet');
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      window.restoreWorkbenchStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Device storage is full', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }, PREFERENCES_KEY);
    await settings.locator('button[type=submit]').click();
    assert.ok(await settings.isVisible());
    assert.equal(await settings.locator('[name=name]').inputValue(), 'Not saved yet');
    assert.ok(await settings.locator('[role=alert]').isVisible());
    assert.ok((await settings.locator('[role=alert]').textContent()).trim());
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'Saved workspace');
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).name, PREFERENCES_KEY), 'Saved workspace');
    await page.evaluate(() => window.restoreWorkbenchStorage());
    await saveSettings(settings);
    assert.equal(await page.locator('[data-page-header] h1').textContent(), 'Not saved yet');
  });

  await t.test('cloud preferences and unsaved settings stay with their owning account', async () => {
    const page = await pageFor({ viewport: { width: 1280, height: 900 } }, false);
    let user = { provider: 'Google', email: 'alice@example.com', label: 'Alice', userId: 'alice@example.com' };
    const clouds = new Map([
      ['alice@example.com', { payload: { [PREFERENCES_KEY]: JSON.stringify(preference('Alice workspace')) }, revision: 1, updatedAt: '2026-11-12T00:00:00.000Z' }],
      ['bob@example.com', { payload: { [PREFERENCES_KEY]: JSON.stringify(preference('Bob workspace')) }, revision: 1, updatedAt: '2026-11-12T00:00:00.000Z' }],
    ]);
    await page.addInitScript(user => localStorage.setItem('daily-space-auth-v1', JSON.stringify(user)), user);
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/auth/me') return json(route, { user });
      if (url.pathname === '/api/user/snapshot') {
        if (!user) return json(route, { error: 'Please sign in first.' }, 401);
        let cloud = clouds.get(user.email) || { payload: {}, revision: 0, updatedAt: null };
        if (request.method() === 'PUT') {
          cloud = { payload: request.postDataJSON().payload, revision: cloud.revision + 1, updatedAt: new Date().toISOString() };
          clouds.set(user.email, cloud);
        }
        return json(route, { ok: true, ...cloud });
      }
      return json(route, { notifications: [], tasks: [], workspaces: [], accounts: [] });
    });
    await page.goto(`${base}/todo.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-page-header] h1')?.textContent === 'Alice workspace');
    const settings = await openSettings(page);
    await settings.locator('[name=name]').fill('Alice unsaved draft');
    user = { provider: 'Google', email: 'bob@example.com', label: 'Bob', userId: 'bob@example.com' };
    await page.evaluate(user => {
      localStorage.setItem('daily-space-auth-v1', JSON.stringify(user));
      window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
    }, user);
    await page.waitForFunction(() => document.querySelector('[data-page-header] h1')?.textContent === 'Bob workspace');
    assert.equal(await settings.isVisible(), false);
    await openSettings(page);
    assert.equal(await settings.locator('[name=name]').inputValue(), 'Bob workspace');
    await settings.locator('[name=name]').fill('Bob updated workspace');
    await saveSettings(settings);
    await page.waitForFunction(() => document.querySelector('.workspace-save-status')?.textContent.includes('Synced to cloud'));
    assert.equal(JSON.parse(clouds.get('bob@example.com').payload[PREFERENCES_KEY]).name, 'Bob updated workspace');
    assert.equal(JSON.parse(clouds.get('alice@example.com').payload[PREFERENCES_KEY]).name, 'Alice workspace');
    user = null;
    await page.evaluate(() => {
      localStorage.removeItem('daily-space-auth-v1');
      window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
    });
    await page.waitForFunction(() => document.querySelector('[data-page-header] h1')?.textContent === 'My workbench');
    await openSettings(page);
    assert.equal(await settings.locator('[name=name]').inputValue(), '');
  });

  await t.test('the renamed phone dock keeps four separate targets and slides back to the workbench', async () => {
    const page = await pageFor({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.locator('.bento-rail-nav.dock-ready').waitFor();
    const controls = page.locator('.bento-rail-nav .bento-rail-link');
    assert.equal(await controls.count(), 4);
    assert.ok((await page.locator('[data-rail-page=todo]').textContent()).includes('Home'));
    const boxes = await controls.evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return { x: b.x, right: b.right, width: b.width, height: b.height }; }));
    assert.ok(boxes.every(box => box.width >= 44 && box.height >= 44));
    assert.ok(boxes.slice(1).every((box, index) => box.x >= boxes[index].right));
    await page.locator('[data-rail-page=calendar]').click();
    await page.waitForURL('**/calendar.html');
    const from = await page.locator('[data-rail-page=calendar]').boundingBox();
    const to = await page.locator('[data-rail-page=todo]').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForURL('**/todo-m.html*');
    assert.equal(await page.locator('[data-rail-page=todo]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(page, 'workbench-dock-320.png');
  });

  async function desktopOverviewPage() {
    const page = await pageFor({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kuala_Lumpur' });
    const morning = new Date(); morning.setUTCHours(2, 0, 0, 0);
    await page.clock.install({ time: morning });
    const nextDay = new Date(morning); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    await page.addInitScript(({ today, tomorrow }) => {
      if (sessionStorage.getItem('desktop-overview-fixture')) return;
      sessionStorage.setItem('desktop-overview-fixture', '1');
      const tasks = JSON.parse(localStorage.getItem('todo-app-v2'));
      Object.assign(tasks.todos[0], { dueDate: today, dueTime: '11:00' }); Object.assign(tasks.todos[1], { dueDate: today, dueTime: '14:00' });
      tasks.todos.push({ id: 'finished-today', text: 'A finished task', dueDate: today, completed: true }, { id: 'tomorrow-task', text: 'Tomorrow stays separate', dueDate: tomorrow, completed: false });
      localStorage.setItem('todo-app-v2', JSON.stringify(tasks));
      const tally = JSON.parse(localStorage.getItem('tally-book-v1'));
      tally.records[0].date = today;
      tally.records.push({ id: 'foreign', date: today, category: 'Coffee', amount: 10, currency: 'USD', fxRate: 7, scope: 'personal' }, { id: 'shared', date: today, category: 'Shared dinner', amount: 900, currency: 'CNY', fxRate: 1, scope: 'shared' }, { id: 'tomorrow-expense', date: tomorrow, category: 'Tomorrow', amount: 300, currency: 'CNY', fxRate: 1, scope: 'personal' });
      localStorage.setItem('tally-book-v1', JSON.stringify(tally));
    }, { today: morning.toISOString().slice(0, 10), tomorrow: nextDay.toISOString().slice(0, 10) });
    await page.goto(`${base}/todo.html`, { waitUntil: 'load' });
    await page.locator('.workbench-desktop-overview').waitFor({ state: 'visible' });
    return page;
  }

  await t.test('desktop overview uses current personal task counts and converted private spending without duplicating task rows', async () => {
    const page = await desktopOverviewPage();
    assert.equal(await page.locator('.overview-task-count').textContent(), '2');
    assert.equal(await page.locator('[data-overview-metric=done] strong').textContent(), '1');
    assert.equal(await page.locator('[data-overview-metric=due] strong').textContent(), '3');
    const progress = page.locator('.overview-progress[role=progressbar]');
    assert.equal(await progress.getAttribute('aria-valuenow'), '33');
    assert.equal(await progress.getAttribute('aria-valuetext'), '1 / 3');
    assert.match(await page.locator('.overview-spend-link strong').textContent(), /102[.,]00/, 'The home sums saved exchange rates and excludes shared and future entries');
    assert.equal(await page.locator('.overview-agenda-link').textContent(), 'Review my weekly plan');
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1);
    await page.locator('#todo-list [data-id=workbench-task] .todo-check-target').click();
    await page.waitForFunction(() => document.querySelector('.overview-task-count')?.textContent === '1');
    assert.equal(await progress.getAttribute('aria-valuetext'), '2 / 3');
    assert.equal(await page.locator('.overview-agenda-link').textContent(), 'Book a table');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('.workbench-desktop-overview').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await capture(page, 'workbench-desktop-overview-1024.png');
  });

  await t.test('desktop focus opens and edits the existing task, and Back returns to the overview', async () => {
    const page = await desktopOverviewPage();
    const ids = await page.evaluate(() => window.DailySpaceTodo.getTasks().map(task => task.id));
    await page.locator('.overview-focus-open').click();
    const editor = page.locator('.task-desktop-editor');
    await editor.waitFor({ state: 'visible' });
    assert.equal(await editor.locator('[name=text]').inputValue(), 'Review my weekly plan');
    await editor.locator('[name=text]').fill('My focused next step');
    await editor.locator('.task-desktop-save').click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'workbench-task').text), 'My focused next step');
    assert.deepEqual(await page.evaluate(() => window.DailySpaceTodo.getTasks().map(task => task.id)), ids, 'The focus card edits an original task rather than creating a second item');
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1);
    await page.locator('.overview-focus-open').click();
    await editor.waitFor({ state: 'visible' });
    await page.goBack(); await editor.waitFor({ state: 'hidden' });
    assert.ok(page.url().includes('/todo.html'));
    assert.ok(await page.locator('.workbench-desktop-overview').isVisible());
  });

  await t.test('desktop cards follow saved visibility and shortcuts, while phone and wide phone previews keep their original home', async () => {
    const page = await desktopOverviewPage();
    const settings = await openSettings(page);
    await settings.locator('[data-section-visibility=agenda]').uncheck();
    await settings.locator('[data-section-visibility=spend]').uncheck();
    await settings.locator('[name=shortcut][value=planner]').uncheck();
    await settings.locator('[name=shortcut][value=mail]').uncheck();
    await settings.locator('[name=shortcut][value=travel]').uncheck();
    await settings.locator('[name=shortcut][value=calendar]').check();
    await saveSettings(settings);
    assert.equal(await page.locator('.overview-agenda-card').isVisible(), false);
    assert.equal(await page.locator('.overview-spend-link').isVisible(), false);
    assert.equal(await page.locator('.overview-quick-links a').count(), 1);
    assert.ok(await page.locator('.overview-quick-links a[href="calendar.html"]').isVisible());
    await page.reload();
    assert.equal(await page.locator('.overview-agenda-card').isVisible(), false);
    assert.equal(await page.locator('.overview-spend-link').isVisible(), false);
    assert.ok(await page.locator('.overview-quick-links a[href="calendar.html"]').isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.workbench-desktop-overview').isVisible(), false, 'Shrinking the desktop hides its overview before any route change');
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    assert.equal(await page.locator('.workbench-desktop-overview').isVisible(), false);
    assert.equal(await page.locator('[data-workbench-section=agenda]').isVisible(), false);
    assert.equal(await page.locator('[data-workbench-section=spend]').isVisible(), false);
    assert.ok(await page.locator('[data-workbench-section=shortcuts] a[href="calendar.html"]').isVisible());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    assert.equal(await page.locator('.workbench-desktop-overview').isVisible(), false, 'An explicit wide phone preview still uses the phone layout');
    assert.equal(await page.locator('#todo-list [data-id=workbench-task]').count(), 1);
  });

  assert.deepEqual(errors, [], 'No browser runtime errors');
});
