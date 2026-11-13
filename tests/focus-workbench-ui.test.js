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


test('task focus and recorded weekly review on phone and desktop', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-focus-'));
  const port = 55000 + Math.floor(Math.random() * 3000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  async function pageFor(viewport = { width: 390, height: 844 }) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 820, hasTouch: viewport.width < 820, serviceWorkers: 'block' });
    t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', failure => errors.push(failure.message));
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(() => {
      if (sessionStorage.getItem('focus-fixture')) return; sessionStorage.setItem('focus-fixture', '1');
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1'); localStorage.setItem('daily-space-language-v1', 'en');
      const now = new Date(), day = offset => { const date = new Date(now); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [
        { id: 'focus-task', text: 'Write the launch notes', dueDate: day(0), completed: false, priority: 'high' },
        { id: 'second-task', text: 'Prepare train bookings', dueDate: day(0), completed: false },
        { id: 'overdue-task', text: 'Overdue receipt', dueDate: day(-2), completed: false },
        { id: 'done-task', text: 'Recorded completion', dueDate: day(0), completed: true, completedAt: Date.now() - 1000 },
        { id: 'legacy-task', text: 'Legacy completion', dueDate: day(0), completed: true },
      ] }));
    });
    await page.goto(`${base}/${viewport.width < 820 ? 'todo-m.html' : 'todo.html'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.DailySpaceFocus));
    return page;
  }
  async function openTools(page) {
    await openWorkbenchTools(page);
  }
  async function open(page) { await openTools(page); await page.locator('[data-focus-open]').click(); const sheet = page.locator('#focus-sheet'); await sheet.waitFor({ state: 'visible' }); return sheet; }
  async function raw(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-focus-v1') || 'null')); }

  await t.test('phone starts, pauses, reloads and finishes one task-linked session without paused time', async () => {
    const page = await pageFor(); await page.clock.install();
    let sheet = await open(page);
    await sheet.locator('[data-focus-task]').selectOption('focus-task'); await sheet.locator('[data-focus-mode]').selectOption('0');
    await sheet.locator('[data-focus-start]').click();
    await page.clock.runFor(60000);
    await sheet.locator('[data-focus-pause]').click();
    const paused = await raw(page); assert.equal(paused.active.resumedAt, null); assert.ok(paused.active.elapsedMs >= 60000 && paused.active.elapsedMs < 61000);
    await page.clock.fastForward(30 * 60000);
    assert.equal((await raw(page)).active.elapsedMs, paused.active.elapsedMs);
    await page.reload(); await page.waitForFunction(() => Boolean(window.DailySpaceFocus)); sheet = await open(page);
    assert.ok(await sheet.locator('[data-focus-resume]').isVisible());
    await sheet.locator('[data-focus-resume]').click(); await page.clock.runFor(120000);
    await sheet.locator('[data-focus-finish]').click();
    const saved = await raw(page); assert.equal(saved.active, null); assert.equal(saved.sessions.length, 1); assert.equal(saved.sessions[0].taskId, 'focus-task');
    assert.ok(saved.sessions[0].durationMs >= 180000 && saved.sessions[0].durationMs < 182000);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'focus-task').completed), false);
  });

  await t.test('target ends once when panel is closed and never silently completes the task', async () => {
    const page = await pageFor(); await page.clock.install(); const sheet = await open(page);
    await sheet.locator('[data-focus-task]').selectOption('focus-task'); await sheet.locator('[data-focus-start]').click();
    await sheet.locator('[data-focus-complete]').check(); await page.keyboard.press('Escape'); await page.clock.runFor(200);
    await sheet.waitFor({ state: 'hidden' }); await page.clock.fastForward(26 * 60000);
    const saved = await raw(page); assert.equal(saved.active, null); assert.equal(saved.sessions.length, 1); assert.equal(saved.sessions[0].durationMs, 1500000);
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'focus-task').completed), false);
    await page.clock.fastForward(60000); assert.equal((await raw(page)).sessions.length, 1);
  });

  await t.test('review uses recorded completions, reschedules overdue tasks, and has working week navigation', async () => {
    const page = await pageFor(); await openTools(page); await page.locator('[data-focus-review]').click(); const sheet = page.locator('#focus-sheet'); await sheet.waitFor({ state: 'visible' });
    assert.equal(await sheet.locator('[data-review-metric=completed]').textContent(), '1');
    assert.ok((await sheet.locator('[data-review-completed]').textContent()).includes('Recorded completion'));
    assert.equal((await sheet.locator('[data-review-completed]').textContent()).includes('Legacy completion'), false);
    await sheet.locator('[data-review-overdue] button').click();
    assert.equal(await sheet.locator('[data-review-metric=overdue]').textContent(), '0');
    const first = await sheet.locator('[data-review-range]').textContent(); await sheet.locator('[data-review-previous]').click();
    assert.notEqual(await sheet.locator('[data-review-range]').textContent(), first);
    await sheet.locator('[data-review-current]').click(); assert.equal(await sheet.locator('[data-review-range]').textContent(), first);
  });

  await t.test('manual finish can explicitly complete its task and record its completion date', async () => {
    const page = await pageFor(); await page.clock.install(); const sheet = await open(page);
    await sheet.locator('[data-focus-task]').selectOption('focus-task'); await sheet.locator('[data-focus-start]').click(); await page.clock.runFor(1000);
    await sheet.locator('[data-focus-complete]').check(); await sheet.locator('[data-focus-finish]').click();
    const task = await page.evaluate(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'focus-task'));
    assert.equal(task.completed, true); assert.ok(task.completedAt > 0); assert.equal((await raw(page)).sessions.length, 1);
  });

  await t.test('failed storage retains the running session and offers an actionable error', async () => {
    const page = await pageFor(); const sheet = await open(page); await sheet.locator('[data-focus-task]').selectOption('focus-task'); await sheet.locator('[data-focus-start]').click();
    const before = await raw(page);
    await page.evaluate(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'dayfly-focus-v1' && JSON.parse(value).active?.resumedAt === null) throw new Error('QuotaExceededError'); return write.call(this, key, value); }; });
    await sheet.locator('[data-focus-pause]').click();
    assert.ok(await sheet.locator('.focus-save-error').isVisible()); assert.deepEqual(await raw(page), before);
    assert.ok(await sheet.locator('[data-focus-pause]').isVisible());
  });

  await t.test('workspace lock closes the sheet and cannot read or mutate the previous owner session', async () => {
    const page = await pageFor(); const sheet = await open(page); await sheet.locator('[data-focus-task]').selectOption('focus-task'); await sheet.locator('[data-focus-start]').click();
    const before = await raw(page);
    await page.evaluate(() => { document.documentElement.dataset.workspaceReady = 'false'; window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated')); });
    await sheet.waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => window.DailySpaceFocus.read().active), null);
    assert.deepEqual(await raw(page), before); assert.ok(await page.locator('[data-focus-open]').isDisabled()); assert.equal(await page.locator('.focus-mini').textContent(), '');
  });

  await t.test('desktop card starts focus and a narrow phone sheet retains touch targets and focus isolation', async () => {
    const desktop = await pageFor({ width: 1280, height: 900 }); assert.ok(await desktop.locator('[data-focus-card-start]').isVisible());
    await desktop.locator('[data-focus-card-start]').click(); assert.ok(await desktop.locator('#focus-sheet').isVisible());
    const page = await pageFor({ width: 320, height: 568 }); const sheet = await open(page);
    await sheet.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    for (let index = 0; index < 12; index++) { await page.keyboard.press(index % 3 ? 'Tab' : 'Shift+Tab'); assert.ok(await sheet.evaluate(root => root.contains(document.activeElement))); }
    const controls = await sheet.locator('button:visible,select:visible').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { text: element.className || element.getAttribute('aria-label'), w: r.width, h: r.height }; }));
    assert.ok(controls.every(rect => rect.h >= 44 && rect.w >= 44), JSON.stringify(controls));
    assert.ok(await sheet.locator('.focus-panel').evaluate(element => element.getBoundingClientRect().width <= innerWidth));
    await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
  });
  assert.deepEqual(errors, []);
});
