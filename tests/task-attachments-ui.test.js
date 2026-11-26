const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('task attachments: guests cannot upload; signed-in uploads save with the task, show on the row and can be removed', { timeout: 90_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-attachments-ui-'));
  const port = 55800 + Math.floor(Math.random() * 800), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), APP_SESSION_SECRET: 'attachments-ui-secret', DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', GROQ_API_KEY: '', OPENAI_API_KEY: '' }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let count = 0; count < 80 && !ready; count++) { try { ready = (await fetch(`${base}/api/health`)).ok; } catch (_) { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(ready);
  const photo = path.join(directory, 'photo.png');
  fs.writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9QzwAEjDAGNzYAAB2dAvFx3S4QAAAAAElFTkSuQmCC', 'base64'));
  const pdf = path.join(directory, 'plan.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\n%plan\n');

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const session = JSON.stringify({ userId: 'me@example.com', email: 'me@example.com', provider: 'Google', label: 'Me' });
  const key = crypto.createHash('sha256').update('attachments-ui-secret').digest('hex');
  const cookie = { name: 'daily_space_session', value: `${Buffer.from(session).toString('base64url')}.${crypto.createHmac('sha256', key).update(session).digest('base64url')}`, url: base };

  async function open(signedIn, language = 'en') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    t.after(() => context.close());
    if (signedIn) await context.addCookies([cookie]);
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(({ signedIn, language }) => {
      if (sessionStorage.getItem('fixture')) return;
      sessionStorage.setItem('fixture', '1'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', language);
      if (signedIn) localStorage.setItem('daily-space-auth-v1', JSON.stringify({ email: 'me@example.com', provider: 'google', label: 'Me' }));
      const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'a', text: 'File the tax return', completed: false, dueDate: today, dueTime: null, createdAt: 1 }] }));
    }, { signedIn, language });
    await page.goto(`${base}/todo.html`, { waitUntil: 'load' });
    await page.locator('#todo-list [data-id="a"] .task-details-open').click();
    return { page, errors, panel: page.locator('.task-desktop-panel') };
  }
  const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task => task.id === 'a').attachments || []);

  const guest = await open(false);
  assert.equal(await guest.panel.locator('[data-attachment-add]').isDisabled(), true, 'guests have nowhere to store files');
  assert.equal(await guest.panel.locator('[data-attachment-add]').getAttribute('title'), 'Sign in to attach files');

  const { page, panel, errors } = await open(true);
  await panel.locator('[data-attachment-input]').setInputFiles([photo, pdf]);
  await panel.locator('.task-attachment[data-attachment-id]').nth(1).waitFor();
  assert.equal(await panel.locator('.task-attachment-thumb').evaluate(image => image.complete && image.naturalWidth), 2, 'the image preview loads through the signed-in route');
  assert.equal(await panel.locator('.task-attachment-kind').textContent(), 'PDF');
  assert.equal((await stored(page)).length, 0, 'nothing is saved before Save');
  await page.locator('.task-desktop-save').click(); await page.locator('.task-desktop-editor').waitFor({ state: 'hidden' });
  const saved = await stored(page);
  assert.deepEqual(saved.map(item => [item.name, item.type]).sort(), [['photo.png', 'image/png'], ['plan.pdf', 'application/pdf']]);
  assert.equal(await page.locator('#todo-list [data-id="a"] .todo-attachments').getAttribute('aria-label'), '2 attachments');

  const pdfItem = saved.find(item => item.name === 'plan.pdf');
  const download = await page.evaluate(async url => { const response = await fetch(url); return [response.status, response.headers.get('content-type'), await response.text()]; }, `/api/attachments/${pdfItem.id}?name=plan.pdf`);
  assert.deepEqual(download, [200, 'application/pdf', '%PDF-1.4\n%plan\n']);

  await page.locator('#todo-list [data-id="a"] .task-details-open').click();
  await panel.locator(`.task-attachment[data-attachment-id="${pdfItem.id}"] .task-attachment-remove`).click();
  await page.locator('.task-desktop-save').click(); await page.locator('.task-desktop-editor').waitFor({ state: 'hidden' });
  assert.deepEqual((await stored(page)).map(item => item.name), ['photo.png']);
  assert.equal(await page.locator('#todo-list [data-id="a"] .todo-attachments').getAttribute('aria-label'), '1 attachment');
  assert.deepEqual(errors, []);

  const zh = await open(true, 'zh');
  assert.equal(await zh.panel.locator('.task-attachments-title').textContent(), '附件');
  assert.equal(await zh.panel.locator('[data-attachment-add]').textContent(), '＋ 添加文件');
});
