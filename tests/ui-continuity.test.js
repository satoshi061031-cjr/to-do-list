const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('continuity preserves editing, focus and usable opaque surfaces', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-continuity-'));
  const port = 56000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let online = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { online = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(online);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  async function pageFor(width, theme = 'light', reducedMotion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 820, hasTouch: width < 820, reducedMotion, serviceWorkers: 'block' });
    t.after(() => context.close());
    await context.addInitScript(({ theme }) => {
      if (sessionStorage.getItem('continuity-fixture')) return;
      sessionStorage.setItem('continuity-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en'); localStorage.setItem('todo-theme', theme);
      const date = new Date(), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'task', text: 'Read the plan', completed: false, dueDate: day, notes: 'Keep task notes' }] }));
      localStorage.setItem('dayfly-notes-v1', JSON.stringify({ version: 1, notes: Array.from({ length: 20 }, (_, i) => ({ id: `note-${i}`, title: i === 19 ? 'A long note title that wraps across multiple lines on a narrow phone screen' : `Note ${i}`, body: `Saved reference ${i}`, tags: [], links: [], createdAt: 1000, updatedAt: 1000 })) }));
      localStorage.setItem('planner-app-v1', JSON.stringify({ version: 2, planners: [{ id: 'board', name: 'My board' }], selectedPlannerId: 'board', boards: { board: {
        columns: [{ id: 'planned', status: 'planned', systemKey: 'planned', title: 'Planned', emoji: '○' }],
        entries: ['first', 'last'].map(id => ({ id, columnId: 'planned', title: `Card ${id}`, note: 'Retain this note', completed: false, expanded: false, tags: [] })),
      } } }));
    }, { theme });
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message)); await page.route('https://**/*', route => route.abort());
    return page;
  }
  async function load(page, file) { await page.goto(`${base}/${file}`, { waitUntil: 'load' }); await page.waitForFunction(() => window.DailySpaceWorkbenchPreferences.ready()); }
  for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    await t.test(`${width}px ${theme} notebook Back restores reading position, row focus and draft`, async () => {
      const page = await pageFor(width, theme); await load(page, 'notes.html');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      const row = page.locator('[data-note-id="note-16"]'); await row.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => ({ top: document.querySelector('.main-area').scrollTop, y: scrollY }));
      await row.click();
      const titleBox = await page.locator('#notes-form [name=title]').boundingBox(); assert.ok(titleBox.y >= 0 && titleBox.y + titleBox.height <= 844, JSON.stringify(titleBox));
      await page.locator('#notes-form [name=body]').fill('Unfinished reference');
      await page.goBack(); await page.waitForFunction(() => document.activeElement?.dataset.noteId === 'note-16');
      const after = await page.evaluate(() => ({ top: document.querySelector('.main-area').scrollTop, y: scrollY }));
      assert.ok(Math.abs(before.top - after.top) <= 2 && Math.abs(before.y - after.y) <= 2, JSON.stringify({ before, after }));
      assert.equal(await page.locator('#notes-sheet [aria-modal], #notes-sheet [data-sheet-drag-handle]').count(), 0);
      await row.click(); assert.equal(await page.locator('#notes-form [name=body]').inputValue(), 'Unfinished reference');
      await page.getByRole('button', { name: 'All notes', exact: true }).click();
      await page.locator('[data-note-id="note-19"]').click(); await page.goBack();
      await page.waitForFunction(() => document.activeElement?.dataset.noteId === 'note-19');
      await page.waitForFunction(() => !document.querySelector('.continuity-title, .continuity-title-target'));
    });
    await t.test(`${width}px ${theme} card toggles retain the card, editor input and keyboard path`, async () => {
      const page = await pageFor(width, theme); await load(page, 'planner.html');
      const card = page.locator('[data-entry-id=first]');
      await card.locator('.planner-card-face').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Collapse card');
      await card.locator('.planner-card-note').fill('Keep this unfinished input');
      await page.evaluate(() => { window.originalCard = document.querySelector('[data-entry-id=first]'); window.originalEditor = window.originalCard.querySelector('textarea'); });
      await card.locator('.planner-card-toggle').click();
      assert.ok(await card.locator('.planner-card-face').evaluate(node => node === document.activeElement));
      await page.keyboard.press('Enter');
      assert.equal(await card.locator('.planner-card-note').inputValue(), 'Keep this unfinished input');
      assert.ok(await page.evaluate(() => window.originalCard === document.querySelector('[data-entry-id=first]') && window.originalEditor === window.originalCard.querySelector('textarea')));
      await card.locator('.planner-card-toggle').click(); await page.keyboard.press('Enter'); await card.locator('.planner-card-toggle').click();
      assert.ok(await card.locator('.planner-card-drawer').evaluate(node => node.inert));
      assert.equal(await page.locator('[data-entry-id=last] .planner-card-face-title').textContent(), 'Card last');
    });
    await t.test(`${width}px ${theme} task panels stay opaque during entry and return drafts`, async () => {
      const page = await pageFor(width, theme); await load(page, width < 820 ? 'todo-m.html' : 'todo.html');
      const row = page.locator('#todo-list [data-id=task]');
      const trigger = row.locator(width < 820 ? '.todo-main' : '.task-details-open');
      const panel = page.locator(width < 820 ? '#m-task-editor [role=dialog]' : '.task-desktop-panel');
      await page.evaluate(() => {
        window.panelSamples = []; document.addEventListener('click', () => {
          let remaining = 12;
          const sample = () => { const panel = document.querySelector('#m-task-editor [role=dialog], .task-desktop-panel'); if (panel && !panel.closest('[hidden]')) window.panelSamples.push(getComputedStyle(panel).opacity); if (--remaining) requestAnimationFrame(sample); };
          requestAnimationFrame(sample);
        }, { once: true });
      });
      await trigger.click();
      const input = panel.locator(width < 820 ? '#m-task-title' : '[name=text]');
      assert.ok(await input.evaluate(node => node === document.activeElement));
      await input.fill('Task draft remains'); await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
      const samples = await page.evaluate(() => window.panelSamples); assert.ok(samples.length > 0); assert.ok(samples.every(value => value === '1'), JSON.stringify(samples));
      await trigger.click(); assert.equal(await input.inputValue(), 'Task draft remains');
      await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks()[0].text), 'Read the plan');
    });
  }
  await t.test('search and filters preserve click, keyboard and reduced-motion paths', async () => {
    const page = await pageFor(1280, 'light', 'reduce'); await load(page, 'todo.html');
    await page.keyboard.press('ControlOrMeta+k'); const search = page.locator('.workspace-command [role=dialog]');
    await search.waitFor({ state: 'visible' }); assert.ok(await search.locator('input').evaluate(node => node === document.activeElement));
    assert.equal(await search.evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
    await page.locator('[data-task-filters-open]').click();
    const filter = page.locator('#surface-task-filters [role=dialog]'); const box = await filter.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0 && box.y + box.height <= 844);
    await page.keyboard.press('Escape'); await filter.waitFor({ state: 'hidden' });
    assert.ok(await page.locator('[data-task-filters-open]').evaluate(node => node === document.activeElement));
    await load(page, 'notes.html'); await page.locator('[data-note-id=note-0]').click();
    assert.equal(await page.locator('.continuity-title, .continuity-title-target').count(), 0);
    await page.goBack(); await page.waitForFunction(() => document.activeElement?.dataset.noteId === 'note-0');
  });
  async function frameEndpoints(page, selector) {
    await page.locator(selector).waitFor({ state: 'visible' });
    return page.locator(selector).evaluate(frame => {
      const animation = frame.getAnimations()[0], time = animation.currentTime;
      animation.pause(); animation.currentTime = 0;
      const first = frame.getBoundingClientRect().toJSON();
      animation.currentTime = animation.effect.getTiming().duration - .01;
      const last = frame.getBoundingClientRect().toJSON();
      animation.currentTime = time; animation.play();
      return { first, last, opaque: getComputedStyle(frame).backgroundColor, duration: animation.effect.getTiming().duration };
    });
  }
  await t.test('changing reduced-motion preference completes an active container without losing editor focus', async () => {
    const page = await pageFor(390); await load(page, 'todo-m.html');
    await page.locator('#todo-list [data-id=task] .todo-main').click();
    await page.locator('#m-task-editor > .continuity-surface').waitFor({ state: 'visible' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('.continuity-surface, .continuity-title, .continuity-title-target'));
    assert.ok(await page.locator('#m-task-title').evaluate(node => node === document.activeElement));
    await page.keyboard.press('Escape'); await page.locator('#m-task-editor').waitFor({ state: 'hidden' });
  });
  await t.test('phone height changes during return retain the shrinking frame and latest entry position', async () => {
    const page = await pageFor(390); await load(page, 'todo-m.html');
    const row = page.locator('#todo-list [data-id=task]');
    await row.locator('.todo-main').click(); await page.waitForFunction(() => !document.querySelector('.continuity-surface'));
    await page.locator('#m-task-close').click();
    await page.setViewportSize({ width: 390, height: 680 });
    const frames = await frameEndpoints(page, '#m-task-editor > .continuity-surface');
    sameBox(frames.last, await row.boundingBox());
    await page.locator('#m-task-editor').waitFor({ state: 'hidden' });
  });
  await t.test('returning before entry finishes continues the painted frame, title and scrim without flashing', async () => {
    const page = await pageFor(390); await load(page, 'todo-m.html');
    await page.locator('#todo-list [data-id=task] .todo-main').click();
    const before = await page.evaluate(() => {
      const root = document.querySelector('#m-task-editor');
      for (const animation of [...root.getAnimations({ subtree: true }), ...[...document.querySelectorAll('.continuity-title')].flatMap(node => node.getAnimations())]) { animation.pause(); animation.currentTime = 60; }
      return { frame: root.querySelector('.continuity-surface').getBoundingClientRect().toJSON(), title: document.querySelector('.continuity-title')?.getBoundingClientRect().toJSON(), scrim: Number(getComputedStyle(root.firstElementChild).opacity), content: Number(getComputedStyle(root.querySelector('header')).opacity) };
    });
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => {
      const root = document.querySelector('#m-task-editor');
      for (const animation of [...root.getAnimations({ subtree: true }), ...[...document.querySelectorAll('.continuity-title')].flatMap(node => node.getAnimations())]) { animation.pause(); animation.currentTime = 0; }
      return { frame: root.querySelector('.continuity-surface').getBoundingClientRect().toJSON(), title: document.querySelector('.continuity-title')?.getBoundingClientRect().toJSON(), scrim: Number(getComputedStyle(root.firstElementChild).opacity), content: Number(getComputedStyle(root.querySelector('header')).opacity) };
    });
    sameBox(after.frame, before.frame);
    assert.ok(await page.locator('#m-task-title').evaluate(node => node.classList.contains('continuity-title-target')));
    assert.ok(after.content <= before.content + .02); assert.ok(after.scrim <= before.scrim + .02);
    assert.ok(before.title && after.title); assert.ok(Math.abs(before.title.x - after.title.x) < 2 && Math.abs(before.title.y - after.title.y) < 2);
    await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.playState === 'paused') animation.play(); });
    await page.locator('#m-task-editor').waitFor({ state: 'hidden' });
  });
  await t.test('a removed return entry cannot leave a floating container or hidden title behind', async () => {
    const page = await pageFor(1280); await load(page, 'todo.html');
    await page.locator('#todo-list [data-id=task] .task-details-open').click(); await page.waitForFunction(() => !document.querySelector('.continuity-surface'));
    await page.keyboard.press('Escape'); await page.locator('.task-desktop-editor > .continuity-surface').waitFor({ state: 'visible' });
    await page.evaluate(() => window.DailySpaceTodo.removeTask('task'));
    await page.locator('.task-desktop-editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.continuity-surface, .continuity-title-target').count(), 0);
  });
  function sameBox(actual, expected) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 2, `${key}: ${JSON.stringify({ actual, expected })}`);
  }
  for (const width of [390, 1280]) {
    await t.test(`${width}px task button, Back and drag return the full frame to its original row`, async () => {
      const page = await pageFor(width); await load(page, width < 820 ? 'todo-m.html' : 'todo.html');
      const row = page.locator('#todo-list [data-id=task]'), trigger = row.locator(width < 820 ? '.todo-main' : '.task-details-open');
      const root = page.locator(width < 820 ? '#m-task-editor' : '.task-desktop-editor'), panel = root.locator('[role=dialog]');
      async function open() { await trigger.click(); await page.waitForFunction(() => !document.querySelector('.continuity-surface, .continuity-title')); }
      await open(); const original = await row.boundingBox(), expanded = await panel.boundingBox();
      await root.locator(width < 820 ? '#m-task-close' : 'header [data-dialog-close]').click();
      let frames = await frameEndpoints(page, `${width < 820 ? '#m-task-editor' : '.task-desktop-editor'} > .continuity-surface`);
      sameBox(frames.first, expanded); sameBox(frames.last, original); assert.ok(frames.duration >= (width < 820 ? 350 : 200));
      assert.match(frames.opaque, /^rgb\(/); await root.waitFor({ state: 'hidden' });
      await open(); await page.goBack(); frames = await frameEndpoints(page, `${width < 820 ? '#m-task-editor' : '.task-desktop-editor'} > .continuity-surface`);
      sameBox(frames.last, await row.boundingBox()); await root.waitFor({ state: 'hidden' });
      if (width < 820) {
        await open(); const handle = root.locator('[data-sheet-drag-handle]');
        await handle.dispatchEvent('pointerdown', { pointerId: 51, isPrimary: true, button: 0, clientX: 150, clientY: 60 });
        await handle.dispatchEvent('pointermove', { pointerId: 51, isPrimary: true, clientX: 150, clientY: 210 });
        const released = await panel.boundingBox();
        await handle.dispatchEvent('pointerup', { pointerId: 51, isPrimary: true, clientX: 150, clientY: 210 });
        frames = await frameEndpoints(page, '#m-task-editor > .continuity-surface');
        sameBox(frames.first, released); sameBox(frames.last, await row.boundingBox()); await root.waitFor({ state: 'hidden' });
      }
    });
    await t.test(`${width}px notebook editor and project card visibly shrink to their entries`, async () => {
      const page = await pageFor(width); await load(page, 'notes.html');
      await page.locator('[data-note-id=note-0]').click(); await page.waitForFunction(() => !document.querySelector('.continuity-surface'));
      const expanded = await page.locator('#notes-sheet > .notes-panel').boundingBox();
      await page.getByRole('button', { name: 'All notes', exact: true }).click();
      let frames = await frameEndpoints(page, '#notes-sheet > .continuity-surface');
      sameBox(frames.first, expanded); sameBox(frames.last, await page.locator('[data-note-id=note-0]').boundingBox());
      await page.waitForFunction(() => !document.querySelector('.continuity-surface, .continuity-retiring'));
      await load(page, 'planner.html'); const card = page.locator('[data-entry-id=first]');
      await card.locator('.planner-card-face').click(); await page.waitForFunction(() => !document.querySelector('.continuity-surface'));
      const cardExpanded = await card.boundingBox(); await card.locator('.planner-card-toggle').click();
      frames = await frameEndpoints(page, '.planner-cards > .continuity-surface');
      sameBox(frames.first, cardExpanded); sameBox(frames.last, await card.boundingBox());
      await page.waitForFunction(() => !document.querySelector('.continuity-surface')); assert.ok(await card.locator('.planner-card-face').evaluate(node => getComputedStyle(node).opacity === '1'));
    });
    await t.test(`${width}px filter returns to its actual trigger`, async () => {
      const page = await pageFor(width); await load(page, width < 820 ? 'todo-m.html' : 'todo.html');
      const trigger = page.locator('[data-task-filters-open]'); await trigger.click();
      await page.waitForFunction(() => !document.querySelector('.continuity-surface'));
      const root = page.locator('#surface-task-filters'), expanded = await root.locator('[role=dialog]').boundingBox();
      await root.locator('.interaction-surface-close').click();
      const frames = await frameEndpoints(page, '#surface-task-filters > .continuity-surface');
      sameBox(frames.first, expanded); sameBox(frames.last, await trigger.boundingBox()); await root.waitFor({ state: 'hidden' });
    });
  }
  assert.deepEqual(errors, []);
});
