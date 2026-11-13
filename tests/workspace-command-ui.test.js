const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright-core');

test('grouped search commands preserve records, safe entry flows and owner boundaries',{timeout:120000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-command-')),port=55000+Math.floor(Math.random()*3000),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(directory,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
 t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(directory,{recursive:true,force:true});});
 let started=false;for(let i=0;i<60;i++){try{if((await fetch(`${base}/api/health`)).ok){started=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(started);
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());const errors=[];
 async function pageFor(mobile=false){
  const context=await browser.newContext({viewport:{width:mobile?390:1280,height:mobile?844:768},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});t.after(()=>context.close());
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(()=>{
   if(sessionStorage.getItem('command-fixture'))return;sessionStorage.setItem('command-fixture','1');sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');localStorage.setItem('daily-space-language-v1','en');
   const date=new Date(),today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
   localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[{id:'task-command',text:'Review garden plan',completed:false,dueDate:today}]}));
   localStorage.setItem('dayfly-notes-v1',JSON.stringify({notes:[{id:'note-command',title:'Garden notes',body:'Quiet afternoon',createdAt:Date.now(),updatedAt:Date.now()}]}));
   localStorage.setItem('tally-book-v1',JSON.stringify({baseCurrency:'CNY',records:[]}));
  });
  await page.goto(`${base}/${mobile?'todo-m.html':'todo.html'}`,{waitUntil:'load'});await page.waitForFunction(()=>window.DailySpaceSearch?.ready()&&window.DailySpaceSearchUi);return page;
 }
 async function search(page,query=''){
  await page.locator('[data-workspace-search]').click();const root=page.locator('.workspace-command');await root.waitFor({state:'visible'});
  await root.locator('input[role=combobox]').fill(query);return root;
 }
 async function action(page,id,query){const root=await search(page,query);await root.locator(`[data-command-id="action:${id}"]`).click();await root.waitFor({state:'hidden'});}

 await t.test('desktop groups and keyboard selection ignore IME Enter and never create records by searching',async()=>{
  const page=await pageFor(),root=await search(page);
  assert.ok(await root.locator('[role=presentation][data-command-group=pages]').isVisible());assert.ok(await root.locator('[role=presentation][data-command-group=actions]').count());
  const input=root.locator('input[role=combobox]');await input.fill('garden');assert.equal(await root.locator('[role=option][data-command-group=records]').count(),2);
  await input.fill('add task');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(await root.isVisible(),true);await input.dispatchEvent('compositionend');
  await input.press('Enter');await root.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.id==='todo-input');
  assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),1);
  const again=await search(page,'zzzz-no-record');assert.equal(await again.locator('[role=option]').count(),0);assert.ok(await again.locator('[data-command-suggestion="action:add-expense"]').isVisible());
  await page.keyboard.press('Escape');await again.waitFor({state:'hidden'});assert.ok(await page.locator('[data-workspace-search]').evaluate(node=>node===document.activeElement));
 });
 await t.test('phone actions open capture and focus setup without mutating task or session stores',async()=>{
  const page=await pageFor(true);
  await action(page,'capture-inbox','Capture to Inbox');await page.waitForFunction(()=>document.activeElement?.matches('[data-inbox-text]'));
  assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getPlanningView().mode),'inbox');assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getTasks().length),1);
  await action(page,'start-focus','Start focus');await page.locator('#focus-sheet').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>window.DailySpaceFocus.read().active),null);
  await page.goBack();await page.locator('#focus-sheet').waitFor({state:'hidden'});
  await action(page,'filters','Filter tasks');await page.waitForFunction(()=>document.querySelector('[data-surface-key="task-filters"]:not([hidden])')||document.querySelector('.task-planning-options[open]'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 await t.test('cross-page expense intent opens once after ready, removes its route parameter and keeps the ledger unchanged',async()=>{
  const page=await pageFor(true);await action(page,'add-expense','Add expense');await page.waitForURL('**/tally.html');
  await page.locator('#tally-add-sheet').waitFor({state:'visible'});assert.equal(new URL(page.url()).searchParams.has('command'),false);
  assert.equal(await page.evaluate(()=>window.DailySpaceTallyCore.readState().records.length),0);
  await page.goBack();await page.locator('#tally-add-sheet').waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.has('command'),false);
  await page.reload();await page.locator('[data-workspace-search]').waitFor();assert.equal(await page.locator('#tally-add-sheet').isVisible(),false);
  await page.goto(`${base}/tally.html?command=add-expense`,{waitUntil:'load'});await page.waitForURL('**/tally.html');assert.equal(await page.locator('#tally-add-sheet').isVisible(),false,'A stale command URL without this owner’s pending intent does not reopen entry');
 });
 await t.test('Ctrl K opens above an existing sheet and Escape restores its prior focus',async()=>{
  const page=await pageFor();await action(page,'start-focus','Start focus');const focus=page.locator('#focus-sheet');await focus.waitFor({state:'visible'});
  const selected=page.locator('[data-focus-task]');await selected.focus();await page.keyboard.press('Control+k');const root=page.locator('.workspace-command');await root.waitFor({state:'visible'});
  assert.ok(await root.evaluate(node=>Number(getComputedStyle(node).zIndex))>await focus.evaluate(node=>Number(getComputedStyle(node).zIndex)));
  await root.locator('input').fill('garden');await page.keyboard.press('ArrowDown');assert.ok(await root.locator('[aria-selected=true]').count());
  await page.keyboard.press('Escape');await root.waitFor({state:'hidden'});assert.equal(await focus.isVisible(),true);assert.ok(await focus.evaluate(node=>node.contains(document.activeElement)));
 });
 await t.test('recent items re-resolve current records and workspace lock removes private results immediately',async()=>{
  const page=await pageFor();const root=await search(page,'Garden notes');await root.locator('[data-command-id="note:note-command"]').click();
  await page.waitForURL('**/todo.html?focus=note&id=note-command');await page.locator('#notes-sheet').waitFor({state:'visible'});await page.goBack();await page.locator('#notes-sheet').waitFor({state:'hidden'});
  const recent=await search(page);assert.ok(await recent.locator('[data-command-group=recent][data-command-id="note:note-command"]').isVisible());
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('dayfly-notes-v1'));state.notes=[];localStorage.setItem('dayfly-notes-v1',JSON.stringify(state));window.dispatchEvent(new CustomEvent('daily-space-notes-updated'));});
  assert.equal(await recent.locator('[data-command-id="note:note-command"]').count(),0);
  await recent.locator('input').fill('Review garden');assert.ok(await recent.locator('[data-command-id="todo:task-command"]').isVisible());
  await page.evaluate(()=>{document.documentElement.dataset.workspaceLocked='true';document.documentElement.dataset.workspaceReady='false';window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated'));});
  await recent.waitFor({state:'hidden'});assert.equal(await recent.locator('[role=option]').count(),0);assert.equal(await page.evaluate(()=>window.DailySpaceSearch.recent().length),0);
 });
 assert.deepEqual(errors,[]);
});
