const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const TODAY = '2026-11-12';
const NEXT_MONTH = '2026-12-01';

test('phone overview and calendar widgets preserve real personal workflows', { timeout: 100_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-phone-widgets-'));
  const port = 54500 + Math.floor(Math.random() * 2500);
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
  assert.ok(ready, 'The test uses its own server and SQLite database');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];

  async function pageFor(options = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Kuala_Lumpur', serviceWorkers: 'block', ...options });
    t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-12T02:00:00Z') });
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(({ today, nextMonth }) => {
      if (sessionStorage.getItem('phone-widget-fixture')) return;
      sessionStorage.setItem('phone-widget-fixture', '1');
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en');
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [
        { id: 'task-a', text: 'Prepare the design review', dueDate: today, dueTime: '11:00', completed: false },
        { id: 'task-b', text: 'Take an evening walk', dueDate: today, completed: false },
        { id: 'task-done', text: 'One completed task', dueDate: today, completed: true },
        { id: 'december-task', text: 'December kickoff', dueDate: nextMonth, completed: false },
      ] }));
      localStorage.setItem('calendar-app-v1', JSON.stringify({ selectedDate: today, reminders: [
        { id: 'today-meeting', text: 'Design meeting', date: today, startTime: '14:00', endTime: '15:00', priority: 'medium' },
        { id: 'december-reminder', text: 'Visa appointment', date: nextMonth, startTime: '09:30', endTime: '10:00', priority: 'high' },
      ] }));
      localStorage.setItem('tally-book-v1', JSON.stringify({ baseCurrency: 'CNY', records: [
        { id: 'lunch', date: today, category: 'Lunch', amount: 32, currency: 'CNY', fxRate: 1, scope: 'personal' },
        { id: 'coffee', date: today, category: 'Coffee', amount: 10, currency: 'USD', fxRate: 7, scope: 'personal' },
        { id: 'shared', date: today, category: 'Shared dinner', amount: 900, currency: 'CNY', fxRate: 1, scope: 'shared' },
        { id: 'future-expense', date: nextMonth, category: 'Future', amount: 300, currency: 'CNY', fxRate: 1, scope: 'personal' },
      ] }));
      const columns = [{ id: 'planned', title: 'Planned', status: 'planned', systemKey: 'planned' }];
      localStorage.setItem('planner-app-v1', JSON.stringify({ version: 2, selectedPlannerId: 'work', planners: [{ id: 'work', name: 'Work' }, { id: 'life', name: 'Life' }], boards: { work: { columns, entries: [] }, life: { columns, entries: [] } } }));
    }, { today: TODAY, nextMonth: NEXT_MONTH });
    return page;
  }
  async function capture(page, name) {
    if (!process.env.UI_CAPTURE_DIR) return;
    fs.mkdirSync(process.env.UI_CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UI_CAPTURE_DIR, name), animations: 'disabled', style: '#sidebar-hint{visibility:hidden}' });
  }
  const value = (page, id) => page.locator(`[data-phone-overview=${id}] .phone-overview-value`);
  async function expandOverview(page) {
    const toggle=page.locator('[data-phone-overview-toggle]');
    if(await toggle.count() && await toggle.getAttribute('aria-expanded')!=='true') await toggle.click();
    await page.locator('.phone-overview-grid').waitFor({state:'visible'});
  }

  await t.test('phone overview counts the existing tasks, appointments, projects and converted private spending', async () => {
    const page = await pageFor(); await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await page.locator('.phone-workbench-overview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.phone-overview-grid').isVisible(),false,'Phone overview defaults to a compact summary');
    assert.ok(await page.locator('[data-phone-summary=tasks]').isVisible());
    await expandOverview(page);
    assert.equal(await value(page, 'tasks').textContent(), '3', 'Two personal tasks plus one linked reminder are pending today');
    assert.equal(await value(page, 'schedule').textContent(), '1');
    assert.equal(await value(page, 'projects').textContent(), '2');
    assert.match(await value(page, 'spend').textContent(), /102[.,]00/, 'The overview uses stored exchange rates and excludes shared/future expenses');
    assert.equal(await page.locator('#todo-list [data-id=task-a]').count(), 1);
    await page.locator('#todo-list [data-id=task-a] .todo-check-target').click();
    await page.waitForFunction(() => document.querySelector('[data-phone-overview=tasks] .phone-overview-value')?.textContent === '2');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'task-a').completed), true);
    for (const [id, href] of [['schedule', 'calendar.html#today'], ['projects', 'planner.html'], ['spend', 'tally.html']]) assert.equal(await page.locator(`[data-phone-overview=${id}]`).getAttribute('href'), href);
    await capture(page, 'phone-overview-390-light.png');
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await capture(page, 'phone-overview-390-dark.png');
  });

  await t.test('the tasks tile returns to today without copying the list, respects hidden sections and keeps full touch targets', async () => {
    const page = await pageFor(); await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    await expandOverview(page);
    await page.evaluate(({ day }) => { window.DailySpaceTodo.selectDueDay(day); window.DailySpaceTodo.setFilter('completed'); window.DailySpaceTodo.setRange('week'); location.hash = '#assigned'; }, { day: NEXT_MONTH });
    await page.waitForFunction(() => window.DailySpaceTodo.getView().source === 'assigned');
    await page.locator('[data-phone-overview=tasks]').click();
    const view = await page.evaluate(() => window.DailySpaceTodo.getView());
    assert.equal(view.source, 'personal'); assert.equal(view.filter, 'active'); assert.equal(view.range, 'day'); assert.equal(view.day, TODAY);
    assert.equal(await page.locator('#todo-list [data-id=task-a]').count(), 1);
    assert.equal(await page.locator('#todo-list [data-id=december-task]').count(), 0);
    await page.evaluate(() => { const prefs = window.DailySpaceWorkbenchPreferences; prefs.save({ ...prefs.read(), hidden: ['agenda', 'spend'] }); });
    await page.waitForFunction(() => document.querySelector('[data-phone-overview=schedule]')?.hidden || !document.querySelector('[data-phone-overview=schedule]')?.getClientRects().length);
    assert.equal(await page.locator('[data-phone-overview=schedule]').isVisible(), false); assert.equal(await page.locator('[data-phone-overview=spend]').isVisible(), false);
    assert.ok(await page.locator('[data-phone-overview=tasks]').isVisible());
    await page.evaluate(() => { const prefs = window.DailySpaceWorkbenchPreferences; prefs.save({ ...prefs.read(), hidden: [] }); });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tile of await page.locator('[data-phone-overview]:visible').all()) { const b = await tile.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44, JSON.stringify(b)); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await capture(page, 'phone-overview-320-light.png');
    await page.evaluate(() => { document.documentElement.dataset.workspaceReady = 'false'; window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated', { detail: { workspaceReady: false, status: 'loading' } })); });
    await page.locator('.phone-workbench-overview').waitFor({ state: 'hidden' });
  });

  await t.test('overview remains a phone surface including explicit wide phone previews', async () => {
    const page = await pageFor({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    await page.goto(`${base}/todo.html`, { waitUntil: 'load' });
    assert.equal(await page.locator('.phone-workbench-overview').isVisible(), false);
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    assert.ok(await page.locator('.phone-workbench-overview').isVisible());
    assert.equal(await page.locator('#todo-list [data-id=task-a]').count(), 1);
  });

  await t.test('month disclosure changes the selected date across months and reuses the original agenda search', async () => {
    const page = await pageFor(); await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
    const toggle = page.locator('#calendar-range'), panel = page.locator('#phone-calendar-month');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click(); await panel.waitFor({ state: 'visible' });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await toggle.getAttribute('aria-controls'), 'phone-calendar-month');
    await page.locator('#phone-calendar-month-next').click();
    assert.equal(await page.evaluate(() => window.DailySpaceCalendar.getView().selectedDate), TODAY, 'Browsing a month never changes the selected date');
    await page.locator(`[data-month-date="${NEXT_MONTH}"]`).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.DailySpaceCalendar.getView().selectedDate), NEXT_MONTH);
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    assert.ok(await page.locator('#cal-composer').getByText('December kickoff', { exact: true }).isVisible());
    assert.equal(await page.locator('#cal-search-input').count(), 1, 'The permanent phone search uses the original input');
    assert.ok(await page.locator('[data-mobile-calendar-search] #cal-search-input').isVisible());
    await page.locator('#cal-search-input').fill('kickoff');
    await page.waitForFunction(() => ![...document.querySelectorAll('#cal-composer .calendar-item-text')].some(el => el.textContent === 'Visa appointment' && el.getClientRects().length));
    assert.equal(await page.locator('#cal-composer').getByText('Visa appointment', { exact: true }).isVisible(), false);
    await page.locator('#cal-search-input').fill('');
    await page.locator('[data-cal-filter=reminders]').click();
    assert.equal(await page.locator('#task-list [data-id=december-task]').isVisible(), false);
    await page.locator('[data-cal-filter=all]').click();
    assert.ok(await page.locator('#cal-composer').getByText('December kickoff', { exact: true }).isVisible());
    await capture(page, 'phone-calendar-agenda-390-light.png');
  });

  await t.test('month day targets fit 320px, Escape restores the toggle and desktop restores its search disclosure', async () => {
    const page = await pageFor({ viewport: { width: 320, height: 568 } }); await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
    const toggle = page.locator('#calendar-range'), panel = page.locator('#phone-calendar-month');
    await toggle.click(); await panel.waitFor({ state: 'visible' });
    const dayButtons = page.locator('#phone-calendar-month-grid [data-month-date]'); assert.ok(await dayButtons.count() >= 28);
    for (const button of await dayButtons.all()) { const b = await button.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44, JSON.stringify(b)); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(page, 'phone-calendar-month-320-light.png');
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.locator('#calendar-search-options #cal-search-form').count(), 1, 'The same search form returns to the desktop disclosure');
    assert.equal(await toggle.getAttribute('aria-controls'), null);
  });

  await t.test('grouped calendar rows retain separate task details, completion and draft-preserving capture', async () => {
    const page = await pageFor(); await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
    const row = page.locator('#task-list [data-id=task-a]');
    await row.locator('.calendar-task-open').click();
    const details = page.locator('.task-desktop-editor'); await details.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'task-a').completed), false);
    await details.locator('.task-detail-fields > summary').click();
    await details.locator('[data-task-notes]').fill('A calendar detail draft');
    await page.goBack(); await details.waitFor({ state: 'hidden' });
    const target = row.locator('.todo-check-target'), b = await target.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44);
    await target.click({ position: { x: 3, y: 3 } });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'task-a').completed), true);
    await page.locator('#calendar-capture').click(); await page.locator('[data-calendar-kind=task]').click();
    await page.locator('#day-task-input').fill('A task from the new calendar');
    await page.goBack(); await page.locator('#calendar-editor-sheet').waitFor({ state: 'hidden' });
    await page.locator('#calendar-capture').click(); await page.locator('[data-calendar-kind=task]').click();
    assert.equal(await page.locator('#day-task-input').inputValue(), 'A task from the new calendar');
    await page.setViewportSize({ width: 320, height: 420 });
    const save = page.locator('#calendar-editor-save'); await save.scrollIntoViewIfNeeded(); const saveBox = await save.boundingBox();
    assert.ok(saveBox.width >= 44 && saveBox.height >= 44 && saveBox.y >= 0 && saveBox.y + saveBox.height <= 420, JSON.stringify(saveBox));
    await save.click(); await page.locator('#calendar-editor-sheet').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.filter(task => task.text === 'A task from the new calendar').length), 1);
  });

  assert.deepEqual(errors, [], 'No browser runtime errors');
});
