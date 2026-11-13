const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('one task view bar and responsive filters preserve scope and saved views', { timeout: 90_000 }, async t => {
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
      localStorage.setItem('todo-app-v2', JSON.stringify({ categories: [{id:'work',name:'Work'},{id:'life',name:'Life'}], todos: [
        ...[1,2,3,4].map(n => ({ id: `task-${n}`, text: `Plan item ${n}`, completed: false, dueDate: today, categoryId: n % 2 ? 'work' : 'life', priority:n===1?'high':'normal' })),
        { id: 'legacy-undated', text: 'An already organized undated task', completed: false, dueDate: null },
        { id: 'legacy-done', text: 'Old completed task', completed: true, dueDate: today },
        { id:'future-task',text:'Future task',completed:false,dueDate:'2099-12-18',categoryId:'work',priority:'high' },
      ] }));
    });
    await page.goto(`${base}/${mobile ? 'todo-m.html' : 'todo.html'}`, { waitUntil: 'load' });
    await page.locator('.task-planning').waitFor({ state: 'visible' }); return page;
  }

  const filters = page => page.locator('#surface-task-filters');
  async function open(page) { await page.locator('[data-task-filters-open]').click(); await filters(page).waitFor({state:'visible'}); }
  async function close(page) { await filters(page).locator('.interaction-surface-close').click(); await filters(page).waitFor({state:'hidden'}); await page.waitForFunction(()=>history.state?.workspaceSheet?.key!=='surface-task-filters'); }
  async function rows(page) { return page.locator('#todo-list .todo-item').evaluateAll(nodes=>nodes.map(node=>node.dataset.id)); }

  for (const mobile of [true,false]) await t.test(`${mobile?'phone':'desktop'} has one view bar and keeps the original controls in Filter`, async()=>{
    const page=await pageFor(mobile);
    assert.equal(await page.locator('.task-planning-bar').count(),1);
    assert.equal(await page.locator('[data-task-range=week]').isVisible(),false);
    assert.equal(await page.locator(mobile?'#m-filter-completed':'[data-filter=completed]').isVisible(),false);
    if(mobile)assert.equal(await page.locator('#m-task-view-picker').isVisible(),false);
    const before=await page.locator('#todo-list').boundingBox();
    await open(page);
    assert.ok(await filters(page).locator('[data-task-range=week]').isVisible());
    assert.ok(await filters(page).locator(mobile?'#m-filter-completed':'[data-filter=completed]').isVisible());
    assert.equal(await filters(page).locator('[role=dialog]').getAttribute('aria-modal'),String(mobile));
    if(mobile){
      assert.equal(await filters(page).locator('#clear-completed').isVisible(),false,'Active mode keeps bulk clearing out of the available actions');
      await filters(page).locator('#m-filter-completed').click();assert.equal(await filters(page).locator('#clear-completed').isVisible(),true);
      await filters(page).locator('#m-filter-active').click();assert.equal(await filters(page).locator('#clear-completed').isVisible(),false);
    }
    if(!mobile){const after=await page.locator('#todo-list').boundingBox();assert.equal(Math.round(before.y),Math.round(after.y),'Opening Filter does not push the list');}
    assert.equal(await page.locator('.task-planning-options').evaluate(node=>node.open),false,'Summary does not create a second native disclosure');
    await page.keyboard.press('Escape');await filters(page).waitFor({state:'hidden'});
    assert.ok(await page.locator('[data-task-filters-open]').evaluate(node=>node===document.activeElement));
  });

  await t.test('desktop date and status are independent and All dates is explicit',async()=>{
    const page=await pageFor(false);await open(page);
    await filters(page).locator('[data-task-date]').fill('2099-12-18');await filters(page).locator('[data-task-date]').dispatchEvent('change');
    assert.deepEqual(await rows(page),['future-task']);
    await filters(page).locator('[data-filter=active]').click();assert.deepEqual(await rows(page),['future-task']);
    await filters(page).locator('[data-filter=all]').click();assert.deepEqual(await rows(page),['future-task']);
    assert.equal(await page.evaluate(()=>DailySpaceTodo.getPlanningView().day),'2099-12-18');
    await filters(page).locator('[data-task-all-dates]').click();assert.ok((await rows(page)).includes('legacy-undated'));
    await close(page);assert.equal(await page.locator('[data-task-filter-chip=date]').textContent(),'All dates ×');
    await page.locator('[data-task-filter-chip=date]').click();
    assert.ok(!(await rows(page)).includes('future-task'));
    await open(page);await filters(page).locator('[data-task-date]').fill('2099-12-18');await filters(page).locator('[data-task-date]').dispatchEvent('change');await close(page);
    assert.equal(await page.locator('[data-planning-mode=tasks]').textContent(),'Selected day');
    await open(page);await filters(page).locator('[data-task-today]').click();await close(page);
    assert.ok(!(await rows(page)).includes('future-task'));assert.equal(await page.evaluate(()=>DailySpaceTodo.getPlanningView().range),'day');
  });

  await t.test('filter chips clear only their own condition and saved views retain date/category/priority',async()=>{
    const page=await pageFor(false);await open(page);
    await filters(page).locator('[data-task-date]').fill('2099-12-18');await filters(page).locator('[data-task-date]').dispatchEvent('change');
    await filters(page).locator('[data-task-category]').selectOption('work');await filters(page).locator('[data-planning-priority]').selectOption('high');
    await filters(page).locator('[data-task-view-name]').fill('Future work');await filters(page).locator('[data-save-task-view]').click();
    const viewId=await filters(page).locator('[data-saved-task-view]').inputValue();await close(page);
    await page.locator('[data-task-filter-chip=priority]').click();
    const view=await page.evaluate(()=>DailySpaceTodo.getPlanningView());assert.equal(view.day,'2099-12-18');assert.equal(view.categoryId,'work');assert.equal(view.priority,'all');
    await page.reload();await page.locator('.task-planning').waitFor({state:'visible'});await open(page);await filters(page).locator('[data-saved-task-view]').selectOption(viewId);
    const restored=await page.evaluate(()=>DailySpaceTodo.getPlanningView());assert.equal(restored.day,'2099-12-18');assert.equal(restored.categoryId,'work');assert.equal(restored.priority,'high');
    assert.deepEqual(await rows(page),['future-task']);
  });

  await t.test('closing a phone Filter preserves the selected range and completion status',async()=>{
    const page=await pageFor();await page.emulateMedia({reducedMotion:'reduce'});await open(page);await filters(page).locator('[data-task-range=week]').click();await close(page);
    await open(page);await filters(page).locator('#m-filter-completed').click();await close(page);
    const current=await page.evaluate(()=>DailySpaceTodo.getView());assert.equal(current.range,'week');assert.equal(current.filter,'completed');
    assert.equal(new URL(page.url()).hash,'','The restored base entry reflects completion state without an extra history entry');
    await page.goForward();await filters(page).waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().range),'week');assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().filter),'completed');
    await page.goBack();await filters(page).waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().range),'week');assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().filter),'completed');
    await page.evaluate(()=>{location.hash='#today';});await page.waitForFunction(()=>DailySpaceTodo.getView().range==='day'&&DailySpaceTodo.getView().filter==='active');
  });

  await t.test('phone source remains reachable, named assigned views roundtrip, and locks clear drafts',async()=>{
    const page=await pageFor();await page.setViewportSize({width:320,height:700});await open(page);
    await filters(page).locator('[data-task-source]').selectOption('assigned');
    await page.waitForFunction(()=>DailySpaceTodo.getView().source==='assigned');
    await filters(page).locator('[data-task-view-name]').fill('Team requests');await filters(page).locator('[data-save-task-view]').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dayfly-task-views-v1')).views[0]);assert.equal(saved.source,'assigned');
    await filters(page).locator('[data-task-source]').selectOption('personal');await filters(page).locator('[data-saved-task-view]').selectOption(saved.id);
    assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().source),'assigned');
    await close(page);assert.equal(await page.evaluate(()=>DailySpaceTodo.getView().source),'assigned');await open(page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await filters(page).locator('[data-task-view-name]').fill('Private unsaved label');
    await page.evaluate(()=>{document.documentElement.dataset.workspaceLocked='true';window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated'));});
    await filters(page).waitFor({state:'hidden'});assert.equal(await filters(page).locator('[data-task-view-name]').inputValue(),'');
  });
  assert.deepEqual(errors,[]);
});
