const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');


// Contextual editor regression tests; standalone navigation is covered in workbench-tools-ui.
async function focusContextOpener(page) { await page.locator('[data-workspace-agent]').focus(); }


test('selected note context and safe Agent citations through the real browser UI', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-agent-sources-'));
  const port = 56000 + Math.floor(Math.random() * 1500), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  let online = false;
  for (let n = 0; n < 50; n++) { try { if ((await fetch(`${base}/api/health`)).ok) { online = true; break; } } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(online, 'Isolated app server starts');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  async function fixture(deferred = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }); t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/agent/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, modelVerified: false }) }));
    await page.route('**/api/user/snapshot', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ payload: {}, revision: 0 }) }));
    await page.route('**/api/agent', route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        reply: 'Suggested next step: review the garden opening hours. <img src=x onerror=alert(1)>', actions: [],
        sources: ['note:chosen-note', 'todo:original-task', 'note:unselected-note', 'note:invented', 'https://evil.invalid/steal', 'javascript:alert(1)', { href: 'https://evil.invalid/steal', label: 'Forged' }, 'todo:original-task'],
        sourceUrls: ['https://evil.invalid/steal'],
      }) });
    });
    await page.addInitScript(deferred => {
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      localStorage.setItem('daily-space-language-v1', 'en');
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: [{ id: 'original-task', text: 'Review travel plans', notes: '', completed: false, dueDate: null }] }));
      localStorage.setItem('dayfly-notes-v1', JSON.stringify({ version: 1, notes: [
        { id: 'chosen-note', title: 'Kyoto reference', body: 'SELECTED SAVED BODY: Garden opens at nine.', sourceUrl: 'https://example.com/garden', links: [{ type: 'todo', id: 'original-task' }], tags: ['travel'], createdAt: 1000, updatedAt: 1000 },
        { id: 'unselected-note', title: 'Private other note', body: 'UNSELECTED SAVED BODY SHOULD NOT LEAVE', sourceUrl: null, links: [], tags: [], createdAt: 1000, updatedAt: 1000 },
      ] }));
      window.agentSourceTestRequests = []; window.agentSourceTestPending = [];
      if (deferred) {
        const realFetch = window.fetch.bind(window);
        // Deliberately ignore AbortSignal to exercise generation guards even if
        // a transport completes after cancellation or identity replacement.
        window.fetch = (url, options) => String(url) === '/api/agent' ? new Promise(resolve => {
          window.agentSourceTestRequests.push(JSON.parse(options.body)); window.agentSourceTestPending.push(resolve);
        }) : realFetch(url, options);
      }
    }, deferred);
    await page.goto(`${base}/todo-m.html`, { waitUntil: 'load' });
    return { page, requests };
  }
  async function notes(page) {
    await focusContextOpener(page);
    await page.evaluate(() => window.DailySpaceNotes.open(null, { list: true }));
    await page.locator('#notes-sheet').waitFor({ state: 'visible' });
  }
  async function selectNoteAndOpenAgent(page, withPrivateDraft = false) {
    await notes(page);
    if (withPrivateDraft) {
      await page.locator('#notes-list [data-note-id=unselected-note]').click();
      await page.locator('#notes-sheet [name=body]').fill('PRIVATE UNSAVED DRAFT SHOULD NOT LEAVE');
      await page.goBack(); await page.locator('#notes-sheet').waitFor({ state: 'hidden' });
      await notes(page);
    }
    await page.locator('#notes-list [data-note-id=chosen-note]').click();
    await page.locator('#notes-sheet [name=agentContext]').check();
    await page.locator('#notes-sheet').getByRole('button', { name: 'Ask Agent', exact: true }).click();
    await page.locator('#todo-agent-overlay').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.body.dataset.agentConfigured === '1');
  }
  async function send(page, message) {
    await page.locator('.todo-agent-input').fill(message); await page.locator('.todo-agent-send').click();
  }
  async function releaseLate(page, reply) {
    await page.evaluate(reply => {
      const resolve = window.agentSourceTestPending.shift();
      resolve(new Response(JSON.stringify({ reply, actions: [{ type: 'todo_add', text: 'Stale Agent mutation must not apply', dueDate: null }], sources: ['note:chosen-note', 'todo:original-task'] }), { headers: { 'Content-Type': 'application/json' } }));
    }, reply);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  await t.test('explicit note selection and Send include saved selected context only and render verified internal citations', async () => {
    const { page, requests } = await fixture();
    await selectNoteAndOpenAgent(page, true);
    assert.equal(requests.length, 0, 'Ask Agent prepares a question without submitting it');
    const before = await page.evaluate(() => window.DailySpaceTodo.getTasks());
    await send(page, 'Summarize selected notes and suggest a next step with sources.');
    await page.waitForFunction(() => !document.querySelector('.todo-agent-send').disabled);
    assert.equal(requests.length, 1);
    const payload = requests[0];
    assert.deepEqual(payload.context.notes.map(note => note.id), ['chosen-note']);
    assert.equal(payload.context.notes[0].body, 'SELECTED SAVED BODY: Garden opens at nine.');
    assert.equal(payload.context.notes[0].sourceUrl, 'https://example.com/garden');
    assert.ok(payload.context.references.includes('note:chosen-note')); assert.ok(payload.context.references.includes('todo:original-task'));
    assert.equal(payload.context.references.includes('note:unselected-note'), false);
    assert.equal(JSON.stringify(payload.context.notes).includes('UNSELECTED'), false); assert.equal(JSON.stringify(payload.context.notes).includes('UNSAVED'), false);
    const links = await page.locator('.agent-source-links a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.getAttribute('href') })));
    assert.deepEqual(links, [{ text: 'Kyoto reference', href: 'notes.html?focus=note&id=chosen-note' }, { text: 'Review travel plans', href: 'todo.html?focus=todo&id=original-task' }]);
    assert.equal(await page.locator('#todo-agent-messages img').count(), 0, 'Suggested prose stays text');
    assert.equal(await page.locator('.agent-source-links a[href^="https:"], .agent-source-links a[href^="javascript:"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.DailySpaceTodo.getTasks()), before, 'Suggested draft does not create or change a task');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dayfly-notes-v1')).notes.find(note => note.id === 'unselected-note').body), 'UNSELECTED SAVED BODY SHOULD NOT LEAVE');
    assert.ok(await page.evaluate(() => localStorage.getItem('dayfly-note-draft:guest:unselected-note').includes('PRIVATE UNSAVED DRAFT')));
  });

  await t.test('closing a pending request rejects late citations and actions even when transport ignores abort', async () => {
    const { page } = await fixture(true);
    await selectNoteAndOpenAgent(page);
    const before = await page.evaluate(() => window.DailySpaceTodo.getTasks());
    await send(page, 'Which source should I read next?'); await page.waitForFunction(() => window.agentSourceTestPending.length === 1);
    await page.locator('.todo-agent-close').click(); await page.locator('#todo-agent-overlay').waitFor({ state: 'hidden' });
    await releaseLate(page, 'CANCELLED PRIVATE REPLY MUST NOT APPEAR');
    await page.locator('[data-workspace-agent]').click(); await page.locator('#todo-agent-overlay').waitFor({ state: 'visible' });
    assert.equal((await page.locator('#todo-agent-messages').textContent()).includes('CANCELLED PRIVATE'), false);
    assert.equal(await page.locator('.agent-source-links').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.DailySpaceTodo.getTasks()), before);
    assert.equal(await page.locator('.todo-agent-send').isDisabled(), false);
    assert.equal(await page.locator('.todo-agent-input').inputValue(), 'Which source should I read next?');
  });

  await t.test('account replacement clears prior citations and rejects the old in-flight response', async () => {
    const { page } = await fixture(true);
    await selectNoteAndOpenAgent(page);
    await send(page, 'Summarize the source once.'); await page.waitForFunction(() => window.agentSourceTestPending.length === 1);
    await page.evaluate(() => window.agentSourceTestPending.shift()(new Response(JSON.stringify({ reply: 'A saved answer with a verified source.', actions: [], sources: ['note:chosen-note'] }), { headers: { 'Content-Type': 'application/json' } })));
    await page.waitForFunction(() => !document.querySelector('.todo-agent-send').disabled);
    assert.equal(await page.locator('.agent-source-links a').count(), 1, 'A prior account source is visible before replacement');
    await send(page, 'What did my selected notes say?'); await page.waitForFunction(() => window.agentSourceTestPending.length === 1);
    await page.evaluate(() => {
      localStorage.setItem('daily-space-auth-v1', JSON.stringify({ email: 'another-reader@example.test', provider: 'Google', label: 'Another reader' }));
      window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
      localStorage.removeItem('daily-space-auth-v1'); window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
    });
    await page.locator('#todo-agent-overlay').waitFor({ state: 'hidden' });
    await releaseLate(page, 'PREVIOUS ACCOUNT PRIVATE REPLY MUST NOT APPEAR');
    assert.equal(await page.locator('#todo-agent-messages').textContent(), ''); assert.equal(await page.locator('.agent-source-links').count(), 0);
    assert.equal(await page.locator('.todo-agent-input').inputValue(), '');
    assert.equal(await page.evaluate(() => window.DailySpaceTodo.getTasks().some(task => task.text === 'Stale Agent mutation must not apply')), false);
    assert.equal(await page.locator('.todo-agent-send').isDisabled(), false);
  });
  assert.deepEqual(errors, []);
});
