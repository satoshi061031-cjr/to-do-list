const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('Inbox, daily priorities and named views use the existing task records on phone and desktop', { timeout: 90_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-planning-'));
  const port = 49000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  for (let n = 0; n < 60; n++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  async function pageFor(mobile = true) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 950 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    t.after(() => context.close()); const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message)); await page.route('https://**/*', route => route.abort());
    await page.addInitScript(() => {
      if (sessionStorage.getItem('planning-fixture') || localStorage.getItem('planning-fixture-initialized')) return;
      localStorage.setItem('planning-fixture-initialized', '1');
      sessionStorage.setItem('planning-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1'); localStorage.setItem('daily-space-language-v1', 'en');
      const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [
        ...[1,2,3,4].map(n => ({ id: `task-${n}`, text: `Plan item ${n}`, completed: false, dueDate: today })),
        { id: 'legacy-undated', text: 'An already organized undated task', completed: false, dueDate: null },
        { id: 'legacy-done', text: 'Old completed task', completed: true, dueDate: today },
      ] }));
    });
    await page.goto(`${base}/${mobile ? 'todo-m.html' : 'todo.html'}`, { waitUntil: 'load' });
    await page.locator('.task-planning').waitFor({ state: 'visible' }); return page;
  }

  await t.test('capture needs no date/category, respects IME, and triage reuses the same task ID', async () => {
    const page = await pageFor();
    await page.locator('[data-planning-mode=inbox]').click();
    assert.equal(await page.locator('#todo-list .todo-item').count(), 0);
    const input = page.locator('[data-inbox-text]'); await input.fill('https://example.com/travel-guide');
    await input.dispatchEvent('compositionstart'); await page.locator('.task-inbox-capture').dispatchEvent('submit');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().length), 6);
    await input.dispatchEvent('compositionend'); await page.locator('[data-inbox-save]').click();
    const captured = await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.inbox));
    assert.equal(captured.dueDate, null); assert.equal(captured.categoryId, null); assert.equal(captured.sourceUrl, 'https://example.com/travel-guide'); assert.ok(captured.createdAt > 0);
    assert.equal(await input.inputValue(), '');
    await page.locator(`#todo-list [data-id="${captured.id}"] .task-triage-actions summary`).click();
    await page.locator(`#todo-list [data-id="${captured.id}"] .task-triage-options button`).filter({ hasText: /^Today$/ }).click();
    const organized = await page.evaluate(id => window.DailySpaceTodo.getTasks().find(task => task.id === id), captured.id);
    assert.equal(organized.inbox, false); assert.match(organized.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'legacy-undated').inbox), false);
  });

  await t.test('Top 3 enforces its limit, supports explicit ordering, and completion records actual time', async () => {
    const page = await pageFor();
    const result = await page.evaluate(() => [1,2,3,4].map(n => window.DailySpaceTodo.pinTask(`task-${n}`, true)));
    assert.deepEqual(result, [true,true,true,false]);
    await page.locator('[data-planning-mode=top]').click();
    assert.deepEqual(await page.locator('#todo-list .todo-item').evaluateAll(rows => rows.map(row => row.dataset.id)), ['task-1','task-2','task-3']);
    await page.locator('#todo-list [data-id=task-2] .task-triage-actions button').filter({ hasText: /^Move up$/ }).click();
    assert.deepEqual(await page.locator('#todo-list .todo-item').evaluateAll(rows => rows.map(row => row.dataset.id)), ['task-2','task-1','task-3']);
    await page.locator('#todo-list [data-id=task-2] .todo-check-target').click();
    await page.waitForFunction(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-2').completedAt > 0);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'legacy-done').completedAt), null);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.pinTask('task-4',true)), true);
    await page.evaluate(() => window.DailySpaceTodo.batchTasks(['task-1'],'complete'));
    await page.locator('.undo-bar-action').click();
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-1').completedAt), null);
  });

  await t.test('priority editor and named view survive reload without duplicating tasks', async () => {
    const page = await pageFor(false);
    await page.locator('#todo-list [data-id=task-1] .task-details-open').click();
    const details = page.locator('.task-desktop-editor');
    await details.locator('[data-task-priority]').selectOption('high');
    await details.locator('button[type=submit]').click(); await details.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-1').priority), 'high');
    await page.locator('.task-planning-options > summary').click();
    await page.locator('[data-planning-priority]').selectOption('high');
    await page.locator('[data-task-view-name]').fill('My important work'); await page.locator('[data-save-task-view]').click();
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-task-views-v1')).views[0].id);
    await page.reload(); await page.locator('.task-planning').waitFor({ state: 'visible' });
    await page.evaluate(() => window.DailySpaceTodo.showToday());
    await page.locator('.task-planning-options > summary').click(); await page.locator('[data-saved-task-view]').selectOption(id);
    await page.evaluate(() => window.DailySpaceTaskPlanning.closeFilters());
    await page.locator('[data-surface-key=task-filters]').waitFor({state:'hidden'});
    assert.equal(await page.locator('#todo-list .todo-item').count(), 1);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().length), 6);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getPlanningView().priority), 'high');
  });

  await t.test('failed capture preserves text and tasks; narrow phone does not overflow', async () => {
    const page = await pageFor(); await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('[data-planning-mode=inbox]').click(); await page.locator('[data-inbox-text]').fill('Keep this unsaved idea');
    await page.evaluate(() => { window.__planningSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function (key,value) { if (key === 'todo-app-v2') throw new Error('QuotaExceededError'); return window.__planningSetItem.call(this,key,value); }; });
    await page.locator('[data-inbox-save]').click();
    assert.equal(await page.locator('[data-inbox-text]').inputValue(), 'Keep this unsaved idea');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().length), 6);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => { Storage.prototype.setItem = window.__planningSetItem; });
    await page.evaluate(() => { Storage.prototype.setItem = function (key,value) { if (key === 'todo-app-v2') return; return window.__planningSetItem.call(this,key,value); }; });
    await page.locator('[data-inbox-save]').click();
    assert.equal(await page.locator('[data-inbox-text]').inputValue(), 'Keep this unsaved idea');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().length), 6);
    await page.evaluate(() => { Storage.prototype.setItem = window.__planningSetItem; });
  });

  await t.test('unresolved account transitions hide private capture drafts and reject new mutations', async () => {
    const page = await pageFor(); await page.locator('[data-planning-mode=inbox]').click();
    await page.locator('[data-inbox-text]').fill('Private unsubmitted thought');
    await page.evaluate(() => { document.documentElement.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated')); });
    await page.locator('.task-planning').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-inbox-text]').inputValue(), '');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.captureTask('Must not cross an account boundary')), false);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.pinTask('task-1', true)), false);
  });

  for (const mobile of [true, false]) await t.test(`${mobile ? 'phone' : 'desktop'} Guest tabs refresh live records and preserve drafts with explicit same-field conflict choices`, async () => {
    const page = await pageFor(mobile), other = await page.context().newPage(); other.setDefaultTimeout(6000);
    other.on('pageerror', error => errors.push(error.message)); await other.route('https://**/*', route => route.abort());
    await other.goto(`${base}/${mobile ? 'todo-m.html' : 'todo.html'}`, { waitUntil: 'load' });
    const openTask = async id => { if (mobile) await page.locator(`#todo-list [data-id=${id}] .todo-main`).click(); else await page.locator(`#todo-list [data-id=${id}] .task-details-open`).click(); };
    const editor = page.locator(mobile ? '#m-task-editor' : '.task-desktop-editor');
    const text = editor.locator(mobile ? '#m-task-title' : '[name=text]');
    const submit = editor.locator('button[type=submit]');
    await openTask('task-1'); await text.fill('My unsaved draft');
    const extraId = await other.evaluate(() => {
      window.DailySpaceTodo.saveTask({ text: 'Other tab title', notes: 'Remote note retained', priority: 'high' }, 'task-1');
      return window.DailySpaceTodo.captureTask('Another tab captured this').id;
    });
    await page.waitForFunction(id => window.DailySpaceTodo.getTasks().some(task => task.id === id), extraId);
    assert.equal(await text.inputValue(), 'My unsaved draft');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-1').text), 'Other tab title');
    await submit.click(); await editor.locator('[data-task-conflict-keep]').waitFor({ state: 'visible' });
    assert.equal(await text.inputValue(), 'My unsaved draft');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'task-1').text), 'Other tab title');
    await editor.locator('[data-task-conflict-keep]').click(); await editor.waitFor({ state: 'hidden' });
    const merged = await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-1'));
    assert.equal(merged.text, 'My unsaved draft'); assert.equal(merged.notes, 'Remote note retained'); assert.equal(merged.priority, 'high');
    assert.equal(await page.evaluate(id => window.DailySpaceTodo.getTasks().some(task => task.id === id), extraId), true);

    await openTask('task-2'); await editor.locator('[data-task-priority]').selectOption('high');
    await other.evaluate(() => window.DailySpaceTodo.saveTask({ notes: 'Independent update' }, 'task-2'));
    await page.waitForFunction(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-2').notes === 'Independent update');
    await submit.click(); await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-2').priority), 'high');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'task-2').notes), 'Independent update');

    await openTask('task-3'); await text.fill('A draft of a removed task');
    await other.evaluate(() => window.DailySpaceTodo.removeTask('task-3'));
    await page.waitForFunction(() => !window.DailySpaceTodo.getTasks().some(task => task.id === 'task-3'));
    await submit.click(); assert.equal(await editor.isVisible(), true);
    assert.equal(await text.inputValue(), 'A draft of a removed task');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.some(task => task.id === 'task-3')), false);
  });

  await t.test('calendar repeat occurrence clears Travel ownership and source links', async () => {
    const page = await pageFor();
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('todo-app-v2'));
      const today = state.todos[0].dueDate;
      localStorage.setItem('travel-book-v1', JSON.stringify({ version: 5, activeTripId: 'trip-one', trips: [{ id: 'trip-one', name: 'A trip', destination: 'Tokyo', startDate: today, endDate: today, linkedTodoId: 'task-1', stops: [], bookings: [] }] }));
      Object.assign(state.todos[0], { repeat: 'daily', sourceTripId: 'trip-one', sourceTripName: 'A trip', sourceTripDate: today, sourceMailId: 'mail-origin', sourceMailUrl: 'https://mail.google.com/mail/u/0/#inbox/mail-origin' });
      localStorage.setItem('todo-app-v2', JSON.stringify(state));
    });
    await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
    await page.locator('#task-list [data-id=task-1] .todo-check-target').click();
    const result = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('todo-app-v2')).todos;
      return { linked: tasks.filter(task => task.sourceTripId === 'trip-one'), next: tasks.find(task => task.id !== 'task-1' && task.repeat === 'daily') };
    });
    assert.equal(result.linked.length, 1); assert.ok(result.next);
    for (const key of ['sourceTripId','sourceTripName','sourceTripDate','sourceMailId','sourceMailUrl']) assert.equal(result.next[key], null);
  });
  assert.deepEqual(errors, []);
});
