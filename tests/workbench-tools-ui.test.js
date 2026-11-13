const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('toolbox routes expose real tools and preserve the original records', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-tools-')), port = 55000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] }); t.after(() => browser.close());
  const errors = [];
  async function pageFor(width = 390, file = 'tools.html') {
    const context = await browser.newContext({ viewport: { width, height: width < 820 ? 844 : 900 }, isMobile: width < 820, hasTouch: width < 820, serviceWorkers: 'block' }); t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message)); await page.route('https://**/*', route => route.abort());
    await page.addInitScript(() => {
      if (sessionStorage.getItem('tools-fixture')) return;
      sessionStorage.setItem('tools-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1'); localStorage.setItem('daily-space-language-v1', 'en');
      const day = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [{ id: 'work', name: 'Work' }], selectedCategoryKey: '__all__', custom: 'keep', todos: [
        { id: 'unfinished', text: 'Prepare project update', dueDate: day(yesterday), completed: false, categoryId: 'work', notes: 'Keep task details', sourceMailId: 'mail:keep' },
        { id: 'done', text: 'Finish research', dueDate: day(new Date()), completed: true, completedAt: Date.now() - 1000 },
      ] }));
    });
    await page.goto(`${base}/${file}`, { waitUntil: 'load' }); await page.waitForFunction(() => window.DailySpaceWorkbenchPreferences.ready()); return page;
  }
  for (const width of [320, 390, 1280, 1440]) await t.test(`${width}px navigation leads to the toolbox with named, reachable entries`, async () => {
    const page = await pageFor(width, width < 820 ? 'todo-m.html' : 'todo.html');
    assert.equal(await page.locator('[data-workbench-tools-trigger]').count(), 0);
    const first = await page.locator('#todo-list .todo-item').first().boundingBox(); assert.ok(first.y < 800);
    if (width < 820) { await page.locator('#bento-menu-toggle').click(); }
    else { const link = page.locator('.bento-rail [data-rail-page=tools]'); assert.equal(await link.locator('.bento-rail-sr').textContent(), 'Toolbox'); await link.click(); }
    await page.waitForURL('**/tools.html'); await page.locator('[data-tool=notes]').waitFor();
    assert.equal(await page.locator('.toolbox-card').count(), 10); assert.equal(await page.locator('.notes-launch').count(), 0);
    assert.equal(await page.locator('.bento-rail [data-rail-page=tools]').getAttribute('aria-current'), 'page');
    for (const el of await page.locator('.toolbox-card').all()) { const box = await el.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await t.test('notebook is a normal page with save, drafts, Back and one linked task', async () => {
    const page = await pageFor(); await page.locator('[data-tool=notes]').click(); await page.waitForURL('**/notes.html');
    assert.equal(await page.locator('#notes-sheet [role=dialog]').count(), 0); assert.equal(await page.locator('#notes-sheet [aria-modal]').count(), 0);
    await page.locator('[data-note-new]').click(); await page.locator('[name=title]').fill('Travel research'); await page.locator('[name=body]').fill('Saved references');
    await page.getByRole('button', { name: 'Save note', exact: true }).click(); assert.match(page.url(), /notes.html\?id=/);
    await page.getByRole('button', { name: 'Create task', exact: true }).click(); await page.getByRole('button', { name: 'Create task', exact: true }).click();
    const saved = await page.evaluate(() => ({ tasks: JSON.parse(localStorage.getItem('todo-app-v2')), note: window.DailySpaceNotes.list()[0] }));
    const created = saved.tasks.todos.filter(item => item.text === 'Travel research'); assert.equal(created.length, 1); assert.equal(created[0].inbox, true);
    assert.ok(saved.note.links.some(item => item.type === 'todo' && item.id === created[0].id)); assert.equal(saved.tasks.custom, 'keep'); assert.equal(saved.tasks.todos.find(item => item.id === 'unfinished').notes, 'Keep task details');
    await page.locator('[name=body]').fill('Unfinished note draft'); await page.locator('.bento-rail [data-rail-page=todo]').click(); await page.waitForURL(/todo-m.html/);
    await page.locator('#bento-menu-toggle').click(); await page.locator('[data-tool=notes]').click(); await page.locator('[data-note-id]').click(); assert.equal(await page.locator('[name=body]').inputValue(), 'Unfinished note draft');
    await page.goBack(); await page.locator('[data-note-new]').waitFor(); await page.goBack(); await page.waitForURL('**/tools.html');
  });
  await t.test('exact note links reload and Forward reopen the saved record without modal history', async () => {
    const page = await pageFor(390, 'notes.html'); await page.locator('[data-note-new]').click(); await page.locator('[name=title]').fill('A linked note'); await page.getByRole('button', { name: 'Save note', exact: true }).click();
    const exact = page.url(); await page.reload(); assert.equal(await page.locator('[name=title]').inputValue(), 'A linked note');
    await page.getByRole('button', { name: 'All notes', exact: true }).click(); await page.goBack(); assert.equal(page.url(), exact); assert.equal(await page.locator('[name=title]').inputValue(), 'A linked note');
    await page.goForward(); await page.locator('[data-note-new]').waitFor(); assert.equal(await page.locator('#notes-sheet [data-sheet-drag-handle]').count(), 0);
  });
  await t.test('background status updates preserve a focused toolbox control', async () => {
    const page = await pageFor(); await page.locator('[data-tool=review]').focus();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated')));
    assert.ok(await page.locator('[data-tool=review]').evaluate(el => el === document.activeElement));
    await page.locator('[data-tool=notes]').click(); const search = page.locator('#notes-sheet input[type=search]'); await search.fill('Reference');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated'))); assert.ok(await search.evaluate(el => el === document.activeElement));
    await page.evaluate(() => { localStorage.setItem('dayfly-notes-v1', JSON.stringify({ notes: [{ id: 'new-reference', title: 'Reference from another tab', body: 'Keep typing', updatedAt: Date.now(), createdAt: Date.now() }] })); window.dispatchEvent(new CustomEvent('daily-space-notes-updated')); });
    assert.ok(await search.evaluate(el => el === document.activeElement)); assert.equal(await search.inputValue(), 'Reference'); assert.ok(await page.locator('[data-note-id=new-reference]').isVisible());
  });
  await t.test('review reads actual completions and moves only the chosen overdue task', async () => {
    const page = await pageFor(); await page.locator('[data-tool=review]').click(); await page.waitForURL('**/review.html');
    assert.equal(await page.locator('[data-review-metric=completed]').textContent(), '1'); assert.equal(await page.locator('[data-review-metric=overdue]').textContent(), '1');
    await page.getByRole('button', { name: 'Previous week', exact: true }).click(); assert.equal(await page.locator('[data-review-metric=completed]').textContent(), '0');
    await page.getByRole('button', { name: 'This week', exact: true }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')));
    await page.locator('[data-review-today=unfinished]').click(); assert.equal(await page.locator('[data-review-metric=overdue]').textContent(), '0');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')));
    assert.equal(after.todos[0].notes, before.todos[0].notes); assert.equal(after.todos[0].sourceMailId, before.todos[0].sourceMailId); assert.deepEqual(after.todos[1], before.todos[1]); assert.deepEqual(after.categories, before.categories); assert.equal(after.custom, 'keep');
    assert.equal(await page.locator('#focus-sheet').count(), 0, 'Review does not start a second focus timer');
  });
  await t.test('toolbox opens focus, templates, data tools and mobile appearance/account controls', async () => {
    const page = await pageFor();
    await page.locator('[data-tool=focus]').click(); await page.waitForURL(/todo-m.html/); await page.locator('#focus-sheet').waitFor({ state: 'visible' }); await page.goBack(); await page.locator('#focus-sheet').waitFor({ state: 'hidden' });
    await page.goto(`${base}/tools.html`); await page.locator('[data-tool=templates]').click(); await page.waitForURL(/todo-m.html/); await page.locator('#workspace-tools-sheet').waitFor({ state: 'visible' }); await page.goBack(); await page.locator('#workspace-tools-sheet').waitFor({ state: 'hidden' });
    await page.locator('#m-add-task').click(); assert.ok(await page.locator('#m-task-editor [data-task-templates]').isVisible());
    await page.locator('#m-task-editor [data-task-templates] button').click(); await page.locator('#workspace-tools-sheet').waitFor({ state: 'visible' }); await page.goBack(); await page.locator('#workspace-tools-sheet').waitFor({ state: 'hidden' }); assert.ok(await page.locator('#m-task-editor').isVisible());
    await page.goto(`${base}/tools.html`);
    for (const [id, sheet] of [['history', '#record-history-sheet'], ['backup', '#workspace-tools-sheet']]) { await page.locator(`[data-tool=${id}]`).click(); await page.locator(sheet).waitFor({ state: 'visible' }); await page.goBack(); await page.locator(sheet).waitFor({ state: 'hidden' }); }
    await page.locator('[data-toolbox-theme]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark'); await page.reload(); assert.equal(await page.locator('[data-toolbox-theme]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-toolbox-language]').click(); assert.equal(await page.locator('#toolbox-title').textContent(), '工具箱');
    await page.locator('[data-toolbox-account]').click(); await page.locator('.auth-modal').waitFor({ state: 'visible' });
  });
  await t.test('failed task writes keep note text and previous task data; locked pages clear personal content', async () => {
    const page = await pageFor(390, 'notes.html'); await page.locator('[data-note-new]').click(); await page.locator('[name=title]').fill('Keep this idea'); await page.locator('[name=body]').fill('My draft'); await page.getByRole('button', { name: 'Save note', exact: true }).click();
    const before = await page.evaluate(() => localStorage.getItem('todo-app-v2'));
    await page.evaluate(() => { window.originalWrite = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'todo-app-v2') throw new Error('QuotaExceededError'); return window.originalWrite.call(this,key,value); }; });
    await page.getByRole('button', { name: 'Create task', exact: true }).click(); assert.match(await page.locator('.notes-status').textContent(), /Could not save/); assert.equal(await page.locator('[name=body]').inputValue(), 'My draft'); assert.equal(await page.evaluate(() => localStorage.getItem('todo-app-v2')), before);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; document.documentElement.dataset.workspaceReady = 'false'; document.documentElement.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated')); });
    await page.locator('#notes-sheet').waitFor({ state: 'hidden' }); assert.equal(await page.locator('[name=body]:visible').count(), 0);
  });
  assert.deepEqual(errors, []);
});
