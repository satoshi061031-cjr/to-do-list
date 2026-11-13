const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');


// Contextual editor regression tests; standalone navigation is covered in workbench-tools-ui.
async function focusContextOpener(page) { await page.locator('[data-workspace-agent]').focus(); }


test('private notes capture, relations and explicit Agent context on phone', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-notes-'));
  const port = 54000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let online = false;
  for (let n = 0; n < 50; n++) { try { if ((await fetch(`${base}/api/health`)).ok) { online = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(online);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }); t.after(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => {
    if (sessionStorage.getItem('notes-fixture')) return;
    sessionStorage.setItem('notes-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
    localStorage.setItem('daily-space-language-v1', 'en');
    localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'task-existing', text: 'Plan a visit', completed: false, dueDate: null }] }));
    localStorage.setItem('travel-book-v1', JSON.stringify({ version: 5, trips: [{ id: 'trip-existing', name: 'Kyoto', startDate: '2026-12-01', endDate: '2026-12-02', stops: [], reservations: [] }] }));
  });
  async function load() {
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    if (!await page.evaluate(() => Boolean(window.DailySpaceNotesCore))) await page.addScriptTag({ url: `${base}/notes-core.js` });
    if (!await page.evaluate(() => Boolean(window.DailySpaceNotes))) { await page.addStyleTag({ url: `${base}/notes-workbench.css` }); await page.addScriptTag({ url: `${base}/notes-workbench.js` }); }
  }
  await load();
  const sheet = page.locator('#notes-sheet');
  async function openNotes() {
    await focusContextOpener(page);
    await page.evaluate(() => window.DailySpaceNotes.open(null, { list: true }));
  }
  await t.test('new-note drafts survive Back and saved text stays safe with related source', async () => {
    await openNotes(); await sheet.locator('[data-note-new]').click();
    await sheet.locator('[name=title]').fill('Kyoto ideas');
    await sheet.locator('[name=body]').fill('Visit the garden. <img src=x onerror=alert(1)>');
    await page.goBack(); await sheet.waitFor({ state: 'hidden' });
    await openNotes(); await sheet.locator('[data-note-new]').click();
    assert.equal(await sheet.locator('[name=title]').inputValue(), 'Kyoto ideas');
    await sheet.locator('[name=sourceUrl]').fill('https://example.com/guide');
    await sheet.locator('[name=tags]').fill('travel, ideas');
    await sheet.locator('[name=relation]').selectOption('trip:trip-existing'); await sheet.getByRole('button', { name: 'Link', exact: true }).click();
    await sheet.getByRole('button', { name: 'Save note', exact: true }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes[0]);
    assert.equal(stored.title, 'Kyoto ideas'); assert.equal(stored.sourceUrl, 'https://example.com/guide');
    assert.deepEqual(stored.links, [{ type: 'trip', id: 'trip-existing' }]);
    assert.equal(await sheet.locator('img').count(), 0);
    await page.setViewportSize({ width: 320, height: 520 });
    await page.waitForFunction(() => {
      const root = document.getElementById('notes-sheet'), viewport = window.visualViewport;
      return innerWidth === 320 && Math.abs((viewport?.height || innerHeight) - 520) < 1 &&
        Math.abs(parseFloat(root.style.getPropertyValue('--workspace-sheet-height')) - (viewport?.height || innerHeight)) < 1;
    });
    const saveBox = await sheet.getByRole('button', { name: 'Save note', exact: true }).boundingBox();
    const geometry = await sheet.evaluate(root => ({ rootHeight: root.getBoundingClientRect().height, fitHeight: root.style.getPropertyValue('--workspace-sheet-height'), viewportHeight: visualViewport?.height || innerHeight, panelHeight: root.querySelector('.notes-panel').getBoundingClientRect().height }));
    if (process.env.NOTES_GEOMETRY_DEBUG === '1') t.diagnostic(JSON.stringify({ saveBox, ...geometry }));
    assert.ok(saveBox && saveBox.x >= 0 && saveBox.x + saveBox.width <= 321 && saveBox.y + saveBox.height <= 521, `Save remains reachable in a short narrow viewport: ${JSON.stringify({ saveBox, ...geometry })}`);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await t.test('note converts to one source-linked task, and repeated conversion is idempotent', async () => {
    await sheet.getByRole('button', { name: 'Create task', exact: true }).click();
    const snapshot = await page.evaluate(() => ({ notes: JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes, tasks: window.DailySpaceTodo.getTasks() }));
    const task = snapshot.tasks.find(item => item.text === 'Kyoto ideas'); assert.ok(task);
    assert.ok(task.notes.includes('notes.html?id=')); assert.ok(snapshot.notes[0].links.some(link => link.type === 'todo' && link.id === task.id));
    await sheet.getByRole('button', { name: 'Create task', exact: true }).click();
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().filter(item => item.text === 'Kyoto ideas').length), 1);
    const entries = await page.evaluate(() => window.DailySpaceSearch.search('garden'));
    assert.ok(entries.some(item => item.id.startsWith('note:') && item.href.includes('focus=note')));
  });
  await t.test('device failures keep the form and saved note; concurrent edits require an explicit choice', async () => {
    const before = await page.evaluate(() => localStorage.getItem('dayfly-notes-v1'));
    await sheet.locator('[name=body]').fill('An unsaved revision');
    await page.evaluate(() => {
      window.noteTestWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'dayfly-notes-v1') throw new Error('QuotaExceededError'); return window.noteTestWrite.call(this, key, value); };
    });
    await sheet.getByRole('button', { name: 'Save note', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('dayfly-notes-v1')), before);
    assert.equal(await sheet.locator('[name=body]').inputValue(), 'An unsaved revision');
    assert.ok((await sheet.locator('.notes-status').textContent()).includes('Could not save'));
    assert.equal(await sheet.locator('.notes-status').getAttribute('role'),'alert');
    await page.evaluate(() => {
      Storage.prototype.setItem = window.noteTestWrite; delete window.noteTestWrite;
      const state = JSON.parse(localStorage.getItem('dayfly-notes-v1')); state.notes[0].body = 'Changed on another tab'; state.notes[0].updatedAt += 1;
      localStorage.setItem('dayfly-notes-v1', JSON.stringify(state)); window.dispatchEvent(new CustomEvent('daily-space-notes-updated'));
    });
    await sheet.getByRole('button', { name: 'Save note', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes[0].body), 'Changed on another tab');
    assert.ok(await sheet.locator('.notes-conflict').isVisible());
    await sheet.getByRole('button', { name: 'Continue with my draft', exact: true }).click();
    await sheet.getByRole('button', { name: 'Save note', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes[0].body), 'An unsaved revision');
  });
  await t.test('delete exposes an accessible Undo inside the modal and restores its relationships', async () => {
    const links = await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes[0].links);
    await sheet.getByRole('button', { name: 'Delete note', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes.length), 0);
    await sheet.getByRole('button', { name: 'Undo delete', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes[0].links), links);
    await sheet.locator('.notes-list-open').click();
  });
  await t.test('Agent only gets selected saved notes; account mismatch cannot expose or overwrite them', async () => {
    assert.deepEqual(await page.evaluate(() => window.DailySpaceNotes.selectedContext()), []);
    await sheet.locator('[name=agentContext]').check();
    const chosen = await page.evaluate(() => window.DailySpaceNotes.selectedContext()); assert.equal(chosen.length, 1); assert.equal(chosen[0].title, 'Kyoto ideas');
    assert.ok(chosen[0].href.includes('focus=note')); assert.equal(chosen[0].sourceUrl, 'https://example.com/guide');
    await page.evaluate(() => {
      localStorage.setItem('daily-space-auth-v1', JSON.stringify({ email: 'other@example.com' }));
      localStorage.setItem('daily-space-workspace-owner-v1', JSON.stringify({ owner: 'guest' }));
      window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
    });
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.DailySpaceNotes.selectedContext()), []);
    assert.deepEqual(await page.evaluate(() => window.DailySpaceNotes.list()), []);
    assert.equal(await page.evaluate(() => window.DailySpaceNotes.open()), false);
  });
  await t.test('desktop task details expose the same related note and keep Back behavior', async () => {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }); t.after(() => desktop.close());
    const view = await desktop.newPage(); view.setDefaultTimeout(6000); view.on('pageerror', error => errors.push(error.message));
    await view.route('https://**/*', route => route.abort());
    await view.addInitScript(() => { localStorage.setItem('daily-space-language-v1', 'en'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1'); });
    await view.goto(`${base}/todo.html`, { waitUntil: 'load' });
    if (!await view.evaluate(() => Boolean(window.DailySpaceNotesCore))) await view.addScriptTag({ url: `${base}/notes-core.js` });
    if (!await view.evaluate(() => Boolean(window.DailySpaceNotes))) { await view.addStyleTag({ url: `${base}/notes-workbench.css` }); await view.addScriptTag({ url: `${base}/notes-workbench.js` }); }
    await view.evaluate(() => {
      const task = window.DailySpaceTodo.saveTask({ text: 'Read project research', dueDate: null });
      window.DailySpaceNotes.save({ id: 'project-research', title: 'Project research', body: 'Original source material', links: [{ type: 'todo', id: task.id }] });
      window.DailySpaceTaskDetails.open(task.id);
    });
    const related = view.locator('.task-desktop-editor .notes-related'); await related.waitFor({ state: 'visible' });
    await related.getByRole('button', { name: 'Project research', exact: true }).click();
    assert.equal(await view.locator('#notes-sheet [name=body]').inputValue(), 'Original source material');
    await view.goBack(); await view.locator('#notes-sheet').waitFor({ state: 'hidden' });
    assert.ok(await view.locator('.task-desktop-editor').isVisible());
  });
  assert.deepEqual(errors, []);
});
