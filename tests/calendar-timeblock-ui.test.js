const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('calendar week grid: drag tasks and reminders into time slots, with keyboard moves and Undo', { timeout: 60_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-timeblock-'));
  const port = 52600 + Math.floor(Math.random() * 1200), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GROQ_API_KEY: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let count = 0; count < 60; count++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready);

  for (const method of ['PATCH', 'DELETE']) {
    const response = await fetch(`${base}/api/calendar/events/abc`, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: method === 'PATCH' ? '{}' : undefined });
    assert.equal(response.status, 401, `${method} needs a signed-in session`);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.addInitScript(today => {
    if (sessionStorage.getItem('timeblock-fixture')) return;
    sessionStorage.setItem('timeblock-fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
    localStorage.setItem('daily-space-language-v1', 'en');
    localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [
      { id: 'u1', text: 'Write report', completed: false, dueDate: today, dueTime: null, createdAt: 1 },
      { id: 't1', text: 'Call dentist', completed: false, dueDate: today, dueTime: '10:00', priority: 'high', createdAt: 2 },
    ] }));
    localStorage.setItem('calendar-app-v1', JSON.stringify({ version: 1, selectedDate: today, reminders: [
      { id: 'r1', date: today, text: 'Standup', startTime: '09:00', endTime: '09:30', priority: 'medium' }] }));
  }, today);
  await page.goto(`${base}/calendar.html`, { waitUntil: 'load' });
  const stored = id => page.evaluate(id => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === id), id);
  const column = page.locator(`.cal-col[data-date="${today}"]`);
  const chip = page.locator('.cal-allday[data-task-id="u1"]');
  await chip.waitFor();
  assert.equal(await page.locator('.cal-event-task[data-task-id="t1"]').count(), 1, 'a timed task is a block on the grid');

  const col = await column.boundingBox();
  const hours = Number(await page.locator('#week-cols').evaluate(el => getComputedStyle(el).getPropertyValue('--cal-hour-count')));
  const firstHour = 8; const hourPx = col.height / hours;
  const box = await chip.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 4 });
  await page.mouse.move(col.x + col.width / 2, col.y + (14 - firstHour) * hourPx + 2, { steps: 6 });
  assert.match(await page.locator('.cal-drop-preview').textContent(), /2 PM/);
  await page.mouse.up();
  assert.equal((await stored('u1')).plannedTime, '14:00');
  assert.equal(await page.locator('.cal-drop-preview').count(), 0);
  await page.locator('#undo-bar button').click();
  assert.equal((await stored('u1')).plannedTime, null, 'Undo puts the task back');

  const block = await page.locator('.cal-event-task[data-task-id="t1"]').boundingBox();
  await page.mouse.move(block.x + 10, block.y + 5); await page.mouse.down();
  await page.mouse.move(block.x + 10, block.y + 5 + hourPx, { steps: 8 }); await page.mouse.up();
  assert.equal((await stored('t1')).plannedTime, '11:00');

  assert.equal((await stored('t1')).dueTime, '10:00', 'Moving a plan preserves its deadline');
  const reminder = await page.locator('.cal-col [data-grid-reminder-id="r1"]').boundingBox();
  await page.mouse.move(reminder.x + 10, reminder.y + 3); await page.mouse.down();
  await page.mouse.move(reminder.x + 10, reminder.y + 3 + 2 * hourPx, { steps: 8 }); await page.mouse.up();
  const moved = await page.evaluate(() => JSON.parse(localStorage.getItem('calendar-app-v1')).reminders.find(item => item.id === 'r1'));
  assert.deepEqual([moved.startTime, moved.endTime], ['11:00', '11:30'], 'dragging a reminder moves it, keeping its length, instead of deleting it');

  const overlapping = await page.locator('.cal-col .cal-event').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()).filter(rect => rect.height));
  for (let i = 0; i < overlapping.length; i++) for (let j = i + 1; j < overlapping.length; j++) {
    const a = overlapping[i], b = overlapping[j];
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'overlapping items sit side by side');
  }

  await page.locator('.cal-event-task[data-task-id="t1"]').focus(); await page.keyboard.press('Alt+ArrowUp');
  assert.equal((await stored('t1')).plannedTime, '10:45');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.taskId), 't1', 'focus follows the moved task');
  await page.locator('.cal-allday[data-task-id="u1"]').focus(); await page.keyboard.press('Alt+ArrowDown');
  assert.equal((await stored('u1')).plannedTime, '09:00');

  await page.locator('.cal-col [data-grid-reminder-id="r1"]').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('calendar-app-v1')).reminders.length), 0, 'a plain click still deletes a reminder');
  await page.evaluate(()=>window.DailySpaceTaskDetails.open('t1'));
  const editor = page.locator('.task-desktop-editor');
  await editor.locator('[data-plan-field=estimateMinutes]').fill('30');
  await editor.locator('[data-plan-field=plannedTime]').fill('14:30');
  await editor.locator('.task-desktop-save').click();
  await page.reload();
  const saved = await stored('t1');
  assert.deepEqual([saved.dueTime,saved.plannedTime,saved.estimateMinutes],['10:00','14:30',30]);
  const slot = await page.locator('.cal-event-task[data-task-id=t1]').boundingBox();
  assert.ok(Math.abs(slot.height - hourPx / 2) < 4,'The planned block occupies half an hour');
  assert.deepEqual(errors, []);
});
