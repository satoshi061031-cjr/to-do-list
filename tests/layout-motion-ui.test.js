const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('explicit task and workbench reorders preserve position continuity without animating background updates', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfly-layout-motion-'));
  const port = 59000 + Math.floor(Math.random() * 1500), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore',
  });
  t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); fs.rmSync(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 50)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  t.after(() => browser.close());
  const errors = [];
  async function pageFor(options = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...options }); t.after(() => context.close());
    await context.addInitScript(() => {
      if (localStorage.getItem('layout-motion-fixture')) return;
      localStorage.setItem('layout-motion-fixture', '1'); localStorage.setItem('daily-space-language-v1', 'en'); sessionStorage.setItem('daily-space-guest-save-dismissed-v1', '1');
      const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [], todos: ['first','second','third'].map((id,index) => ({ id, text: `Priority ${id}`, dueDate: day, completed: false, todayPinDate: day, todayPinOrder: index })) }));
    });
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(`${base}/${options.isMobile ? 'todo-m.html' : 'todo.html'}`, { waitUntil: 'load' });
    if (!await page.evaluate(() => Boolean(window.DailySpaceLayoutMotion))) await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../layout-motion.js'), 'utf8') });
    await page.evaluate(() => {
      window.layoutMoves = [];
      const native = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = native.call(this,frames,options);
        if (options?.duration === 180 && Array.isArray(frames) && String(frames[0]?.transform || '').startsWith('translate(')) {
          window.layoutMoves.push({ key: this.dataset.motionKey || this.dataset.id || this.dataset.overviewWidget || this.dataset.workbenchSection, parent: this.parentElement.className, frames, duration: options.duration });
        }
        return animation;
      };
    });
    return { page, context };
  }
  const ids = page => page.locator('#todo-list > .todo-item').evaluateAll(rows => rows.map(row => row.dataset.id));
  const settled = page => page.waitForFunction(() => [...document.querySelectorAll('#todo-list > .todo-item, [data-motion-key], [data-overview-widget]')].every(node => !node.getAnimations().some(animation => ['running','pending'].includes(animation.playState))));

  await t.test('Top 3 keyboard moves animate the same task IDs and retain the action focus', async () => {
    const { page } = await pageFor({ isMobile: true, hasTouch: true });
    await page.locator('[data-planning-mode=top]').click();
    await page.evaluate(() => { window.layoutMoves.length = 0; });
    const down = page.locator('[data-planning-move=first][data-planning-delta="1"]');
    await down.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.layoutMoves.some(item => item.key === 'first'));
    assert.deepEqual(await ids(page), ['second','first','third']);
    await page.waitForFunction(() => document.activeElement?.dataset.planningMove === 'first');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.DailySpaceTodo.getTasks().find(task => task.id === 'first').todayPinOrder === 2);
    assert.deepEqual(await ids(page), ['second','third','first']);
    await settled(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.planningMove),'first');
    const moves = await page.evaluate(() => window.layoutMoves);
    assert.ok(moves.length >= 4); assert.ok(moves.every(item => item.duration === 180 && item.frames[1].transform === 'translate(0px, 0px)'));
    assert.ok(await page.locator('#todo-list > .todo-item').evaluateAll(rows => rows.every(row => row.style.transform === '' && getComputedStyle(row).transform === 'none')));
  });
  await t.test('real cross-tab reorder and reduced-motion user changes remain instant', async () => {
    const { page, context } = await pageFor({ isMobile: true, hasTouch: true });
    await page.locator('[data-planning-mode=top]').click();
    const other = await context.newPage(); await other.route('https://**/*', route => route.abort()); await other.goto(`${base}/calendar.html`);
    await page.evaluate(() => { window.layoutMoves.length = 0; });
    await other.evaluate(() => { const state=JSON.parse(localStorage.getItem('todo-app-v2')); state.todos.find(task=>task.id==='third').todayPinOrder=0; state.todos.find(task=>task.id==='first').todayPinOrder=2; state.todos.find(task=>task.id==='second').todayPinOrder=1; localStorage.setItem('todo-app-v2',JSON.stringify(state)); });
    await page.waitForFunction(() => document.querySelector('#todo-list > .todo-item')?.dataset.id === 'third');
    assert.equal(await page.evaluate(() => window.layoutMoves.length),0);
    await page.bringToFront();
    await page.waitForFunction(() => !document.hidden);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-planning-move=first][data-planning-delta="-1"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.dataset.planningMove === 'first');
    assert.deepEqual(await ids(page),['third','first','second']); assert.equal(await page.evaluate(() => window.layoutMoves.length),0);
  });
  await t.test('settings draft reorders and explicit applied desktop layouts use the same small movement', async () => {
    const { page } = await pageFor({ viewport: { width: 1440, height: 1000 } });
    await page.locator('[data-workbench-settings]').click();
    const settings = page.locator('#workbench-settings'); await settings.waitFor({ state: 'visible' });
    await settings.locator('[data-section-up=shortcuts]').click();
    await page.waitForFunction(() => window.layoutMoves.some(item => item.key === 'section:shortcuts'));
    await settled(page);
    await settings.locator('.workbench-widget-settings > summary').click();
    await settings.locator('[data-widget-up=focus]').click();
    await page.waitForFunction(() => window.layoutMoves.some(item => item.key === 'widget:focus'));
    await settled(page);
    await page.evaluate(() => { window.layoutMoves.length=0; });
    await settings.locator('button[type=submit]').click();
    await page.waitForFunction(() => window.layoutMoves.some(item => item.parent.includes('workbench-overview-grid')));
    await settings.waitFor({ state:'hidden' }); await settled(page);
    const saved = await page.evaluate(() => window.DailySpaceWorkbenchPreferences.read());
    assert.ok(saved.sections.indexOf('shortcuts') < saved.sections.indexOf('tasks')); assert.ok(saved.desktopLayout.order.indexOf('focus') < saved.desktopLayout.order.indexOf('agenda'));
  });
  await t.test('pointer cancellation and identity changes remove position transforms immediately', async () => {
    const { page } = await pageFor({ isMobile:true,hasTouch:true }); await page.locator('[data-planning-mode=top]').click();
    await page.locator('[data-planning-move=first][data-planning-delta="1"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.layoutMoves.length>0);
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1})));
    assert.ok(await page.locator('#todo-list > .todo-item').evaluateAll(rows => rows.every(row => getComputedStyle(row).transform === 'none')));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('daily-space-auth-updated')));
    assert.ok(await page.locator('#todo-list > .todo-item').evaluateAll(rows => rows.every(row => getComputedStyle(row).transform === 'none')));
  });
  await t.test('pressing a moving checkbox preserves its hit target through pointer up', async () => {
    const { page } = await pageFor({ isMobile:true,hasTouch:true }); await page.locator('[data-planning-mode=top]').click();
    await page.locator('[data-planning-move=first][data-planning-delta="1"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.layoutMoves.length>0);
    await page.evaluate(() => {
      for(const row of document.querySelectorAll('#todo-list > .todo-item')) for(const animation of row.getAnimations()) {
        if(animation.effect?.getTiming().duration===180) { animation.currentTime=20; animation.pause(); }
      }
    });
    const checkbox=page.locator('#todo-list > [data-id=first] .todo-check-target'); const box=await checkbox.boundingBox();
    assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.up();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task=>task.id==='first').completedAt>0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('todo-app-v2')).todos.find(task=>task.id==='second').completed),false);
  });
  assert.deepEqual(errors,[]);
});
