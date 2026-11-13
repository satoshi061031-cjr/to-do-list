const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');


async function openWorkbenchTools(page) {
  const trigger = page.locator('[data-workbench-tools-trigger]');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.locator('#workbench-tools-content').waitFor({ state: 'visible' });
}


test('record recovery on phone preserves newer data, catches conflicts and closes on identity change', { timeout: 90_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-history-'));
  const port = 54500 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let started = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { started = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(started);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => {
    if (sessionStorage.getItem('history-fixture')) return;
    sessionStorage.setItem('history-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1'); localStorage.setItem('daily-space-language-v1', 'en');
    const today = new Date(), day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('todo-app-v2', JSON.stringify({ todos: [{ id: 'history-task', text: 'Original title', completed: false, dueDate: day, dueTime: null, categoryId: null }, { id: 'other-task', text: 'Keep this task', completed: false, dueDate: day, dueTime: null, categoryId: null }], categories: [] }));
  });
  await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DailySpaceHistory?.ready());
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')));
  const edit = text => page.evaluate(text => { const item = window.DailySpaceTodo.getTasks().find(task => task.id === 'history-task'); return window.DailySpaceTodo.saveTask({ ...item, text }, item.id); }, text);
  const sheet = page.locator('#record-history-sheet');
  const open = async () => { await openWorkbenchTools(page); await page.locator('[data-history-open]').first().click(); await sheet.waitFor({ state: 'visible' }); };
  const previewOriginal = async () => { const row = sheet.locator('.record-history-row').filter({ has: page.locator('strong', { hasText: /^Original title$/ }) }).first(); await row.locator('[data-history-preview]').click(); await sheet.locator('.record-history-preview').waitFor({ state: 'visible' }); };

  await t.test('restores a prior version while keeping the current version available', async () => {
    assert.equal((await edit('Edited title')).text, 'Edited title');
    await open(); await previewOriginal(); await sheet.locator('[data-history-restore]').click();
    assert.equal((await state()).todos.find(item => item.id === 'history-task').text, 'Original title');
    assert.ok(await sheet.locator('.record-history-row strong', { hasText: 'Edited title' }).count(), 'The version replaced by restore is retained');
    assert.equal((await state()).todos.find(item => item.id === 'other-task').text, 'Keep this task');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goBack(); await sheet.waitFor({ state: 'hidden' });
  });
  await t.test('recycle bin restores the same ID and keeps newer unrelated tasks', async () => {
    await page.evaluate(() => window.DailySpaceTodo.removeTask('history-task'));
    await open(); await sheet.locator('select[aria-label="History filter"]').selectOption('deleted');
    await previewOriginal(); await sheet.locator('[data-history-restore]').click();
    const tasks = (await state()).todos;
    assert.equal(tasks.filter(item => item.id === 'history-task').length, 1);
    assert.ok(tasks.some(item => item.id === 'other-task'));
    await page.goBack(); await sheet.waitFor({ state: 'hidden' });
  });
  await t.test('changes after preview block restoring an outdated choice', async () => {
    await edit('Before preview'); await open(); await previewOriginal();
    await edit('Changed after preview');
    await sheet.locator('[data-history-restore]').click();
    assert.match(await sheet.locator('.workspace-tool-status').textContent(), /changed after preview/);
    assert.equal(await sheet.locator('.workspace-tool-status').getAttribute('role'),'alert');
    assert.equal(await sheet.locator('[data-history-restore]').isDisabled(), true);
    assert.equal((await state()).todos.find(item => item.id === 'history-task').text, 'Changed after preview');
    await page.goBack(); await sheet.waitFor({ state: 'hidden' });
  });
  await t.test('failed primary restore retains current data and rolls the reserved history back', async () => {
    await open(); await previewOriginal();
    const historyBefore = await page.evaluate(() => localStorage.getItem('dayfly-history-v1'));
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (this === localStorage && key === 'todo-app-v2') throw new DOMException('Device is full', 'QuotaExceededError'); return original.call(this, key, value); };
      window.restoreHistoryStorage = () => { Storage.prototype.setItem = original; };
    });
    await sheet.locator('[data-history-restore]').click();
    assert.match(await sheet.locator('.workspace-tool-status').textContent(), /Current data was kept/);
    assert.equal(await sheet.locator('.workspace-tool-status').getAttribute('role'),'alert');
    assert.equal((await state()).todos.find(item => item.id === 'history-task').text, 'Changed after preview');
    assert.equal(await page.evaluate(() => localStorage.getItem('dayfly-history-v1')), historyBefore);
    await page.evaluate(() => window.restoreHistoryStorage());
    await page.goBack(); await sheet.waitFor({ state: 'hidden' });
  });
  await t.test('restoring notes refuses both full libraries and byte overflow without dropping current notes', async () => {
    const previousNotes = await page.evaluate(() => localStorage.getItem('dayfly-notes-v1'));
    try {
      for (const scenario of ['count', 'bytes']) {
        const saved = await page.evaluate(scenario => {
          const Core = window.DailySpaceNotesCore, now = Date.now();
          const archived = Core.normalizeNote({ id: 'deleted-note-' + scenario, title: 'Archived note ' + scenario, body: scenario === 'bytes' ? '汉'.repeat(10000) : 'Keep all current notes', createdAt: now, updatedAt: now });
          window.DailySpaceHistory.capture(Core.KEY, { notes: [archived] }, { notes: [] });
          const current = Core.normalize({ notes: Array.from({ length: scenario === 'count' ? 100 : 5 }, (_, i) => ({ id: 'current-note-' + i, title: 'Current note ' + i, body: scenario === 'bytes' ? '汉'.repeat(10000) : 'Current content', createdAt: now, updatedAt: now })) });
          const serialized = JSON.stringify(current); localStorage.setItem(Core.KEY, serialized);
          window.DailySpaceHistory.open({ key: Core.KEY, recordId: archived.id });
          return serialized;
        }, scenario);
        await sheet.waitFor({ state: 'visible' });
        await sheet.locator('[data-history-preview]').first().click();
        const historyBefore = await page.evaluate(() => localStorage.getItem('dayfly-history-v1'));
        await sheet.locator('[data-history-restore]').click();
        assert.match(await sheet.locator('.workspace-tool-status').textContent(), scenario === 'count' ? /Notes are full \(100 notes\)/ : /Notes storage is full/);
        assert.equal(await sheet.locator('.workspace-tool-status').getAttribute('role'),'alert');
        assert.equal(await page.evaluate(() => localStorage.getItem('dayfly-notes-v1')), saved);
        assert.equal(await page.evaluate(() => localStorage.getItem('dayfly-history-v1')), historyBefore);
        assert.equal(await page.evaluate(() => window.DailySpaceNotesCore.normalize(JSON.parse(localStorage.getItem('dayfly-notes-v1'))).notes.length), scenario === 'count' ? 100 : 5);
        await page.goBack(); await sheet.waitFor({ state: 'hidden' });
      }
    } finally {
      await page.evaluate(previous => { if (previous === null) localStorage.removeItem('dayfly-notes-v1'); else localStorage.setItem('dayfly-notes-v1', previous); }, previousNotes);
    }
  });
  await t.test('small phone preview remains scrollable and keyboard focus stays inside recovery sheet', async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(); await previewOriginal();
    const restore = sheet.locator('[data-history-restore]'); await restore.scrollIntoViewIfNeeded();
    const bounds = await restore.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 568);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await restore.focus();
    for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 3 ? 'Tab' : 'Shift+Tab'); assert.ok(await sheet.evaluate(root => root.contains(document.activeElement))); }
    if (process.env.UI_CAPTURE_DIR) { fs.mkdirSync(process.env.UI_CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.UI_CAPTURE_DIR, 'history-small-phone.png'), animations: 'disabled' }); }
    await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await t.test('auth transition closes previews and disables access to an unready workspace', async () => {
    await open(); await previewOriginal();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('daily-space-auth-updated')));
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await sheet.locator('.record-history-preview').textContent(), '');
    await page.evaluate(() => { document.documentElement.dataset.workspaceLocked = 'true'; window.DailySpaceHistory.open(); });
    assert.equal(await sheet.isVisible(), false);
    await page.evaluate(() => { delete document.documentElement.dataset.workspaceLocked; });
  });
  assert.deepEqual(errors, []);
});
