const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright-core');

test('responsive surfaces and explicit sheet handles preserve navigation and drafts',{timeout:120000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-surfaces-'));
  const port=57500+Math.floor(Math.random()*1500),base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(directory,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
  t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(directory,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());
  const errors=[];
  async function pageFor(width=390,height=844,reducedMotion='no-preference'){
    const context=await browser.newContext({viewport:{width,height},isMobile:width<820,hasTouch:width<820,reducedMotion,serviceWorkers:'block'});t.after(()=>context.close());
    const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');localStorage.setItem('daily-space-language-v1','en');const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[{id:'surface-task',text:'Keep reading this task',dueDate:day,completed:false}]}));});
    await page.goto(`${base}/${width<820?'todo-m.html':'todo.html'}`,{waitUntil:'load'});await page.waitForFunction(()=>window.DailySpaceFocus&&window.DailySpaceWorkbenchPreferences.ready());return page;
  }
  const tools=page=>page.locator('[data-surface-key="task-filters"]');
  async function openTools(page){await page.locator('[data-task-filters-open]').click();await tools(page).waitFor({state:'visible'});}
  async function settle(panel){await panel.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));}
  async function drag(page,handle,distance){const box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+distance,{steps:8});await page.mouse.up();}

  await t.test('desktop menu is anchored, edge-clamped and does not move the task list',async()=>{
    const page=await pageFor(1280,768),first=page.locator('#todo-list .todo-item').first(),before=await first.boundingBox(),length=await page.evaluate(()=>history.length);
    await openTools(page);await settle(tools(page).locator('.interaction-surface-panel'));
    const after=await first.boundingBox(),box=await tools(page).locator('.interaction-surface-panel').boundingBox();
    assert.equal(after.y,before.y);assert.ok(box.x>=0&&box.x+box.width<=1280&&box.y>=0&&box.y+box.height<=768,JSON.stringify(box));
    assert.equal(await tools(page).locator('[role=dialog]').getAttribute('aria-modal'),'false');assert.equal(await page.evaluate(()=>history.length),length);
    await page.keyboard.press('Escape');await tools(page).waitFor({state:'hidden'});assert.ok(await page.locator('[data-task-filters-open]').evaluate(node=>node===document.activeElement));
    await openTools(page);await page.locator('[data-page-header] h1').click();await tools(page).waitFor({state:'hidden'});
  });
  await t.test('phone templates are available in task creation and Back preserves the editor',async()=>{
    const page=await pageFor(320,680),row=await page.locator('#todo-list .todo-item').first().boundingBox();
    assert.equal(await page.locator('.m-add-bar .workspace-task-shortcuts button').count(),0);
    await page.locator('#m-add-task').click();await page.locator('#m-task-title').fill('Keep this task draft');
    await page.locator('#m-task-editor [data-task-templates] button').click();await page.locator('#workspace-tools-sheet').waitFor({state:'visible'});
    await page.goBack();await page.locator('#workspace-tools-sheet').waitFor({state:'hidden'});assert.equal(await page.locator('#m-task-title').inputValue(),'Keep this task draft');
    await page.goBack();await page.locator('#m-task-editor').waitFor({state:'hidden'});
    assert.equal((await page.locator('#todo-list .todo-item').first().boundingBox()).y,row.y);
  });
  await t.test('small or cancelled handle movement keeps the editor; intentional drag preserves its draft',async()=>{
    const page=await pageFor();await page.locator('[data-workspace-agent]').focus();await page.evaluate(()=>window.DailySpaceNotes.open(null,{list:true}));const sheet=page.locator('#notes-sheet');await sheet.waitFor({state:'visible'});
    await sheet.locator('[data-note-new]').click();await sheet.locator('[name=title]').fill('A draft kept through dragging');await sheet.locator('[name=body]').fill('Do not save or discard this automatically.');await settle(sheet.locator('.notes-panel'));
    const handle=sheet.locator('[data-sheet-drag-handle]');assert.equal(await handle.count(),1);const bounds=await handle.boundingBox();assert.ok(bounds.height>=44);
    await drag(page,handle,24);assert.ok(await sheet.isVisible());assert.equal(await sheet.locator('[name=title]').inputValue(),'A draft kept through dragging');
    await handle.dispatchEvent('pointerdown',{pointerId:37,isPrimary:true,button:0,clientX:100,clientY:100});await handle.dispatchEvent('pointermove',{pointerId:37,isPrimary:true,clientX:100,clientY:230});await handle.dispatchEvent('pointercancel',{pointerId:37,isPrimary:true});
    assert.ok(await sheet.isVisible());assert.equal(await sheet.locator('.notes-panel').evaluate(node=>node.style.translate),'');
    await settle(sheet.locator('.notes-panel'));
    await drag(page,handle,150);await sheet.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-workspace-agent]'));
    await page.locator('[data-workspace-agent]').focus();await page.evaluate(()=>window.DailySpaceNotes.open(null,{list:true}));await sheet.locator('[data-note-new]').click();assert.equal(await sheet.locator('[name=title]').inputValue(),'A draft kept through dragging');
  });
  await t.test('an underlying handle cannot dismiss a newer nested modal',async()=>{
    const page=await pageFor();await page.locator('[data-workspace-agent]').focus();await page.evaluate(()=>window.DailySpaceNotes.open(null,{list:true}));const notes=page.locator('#notes-sheet');await notes.waitFor({state:'visible'});
    const background=notes.locator('[data-sheet-drag-handle]');await background.dispatchEvent('pointerdown',{pointerId:41,isPrimary:true,button:0,clientX:100,clientY:100});await background.dispatchEvent('pointermove',{pointerId:41,isPrimary:true,clientX:100,clientY:120});
    await page.evaluate(()=>window.DailySpaceHistory.open());const historySheet=page.locator('#record-history-sheet');await historySheet.waitFor({state:'visible'});await settle(historySheet.locator('.record-history-panel'));
    await background.dispatchEvent('pointerup',{pointerId:41,isPrimary:true,clientX:100,clientY:350});
    await background.dispatchEvent('pointerdown',{pointerId:42,isPrimary:true,button:0,clientX:100,clientY:100});await background.dispatchEvent('pointermove',{pointerId:42,isPrimary:true,clientX:100,clientY:350});await background.dispatchEvent('pointerup',{pointerId:42,isPrimary:true,clientX:100,clientY:350});
    assert.ok(await notes.isVisible());assert.ok(await historySheet.isVisible());
    await drag(page,historySheet.locator('[data-sheet-drag-handle]'),150);await historySheet.waitFor({state:'hidden'});assert.ok(await notes.isVisible());
  });
  await t.test('a locked workspace closes menu contents and refuses stale actions',async()=>{
    const page=await pageFor();await openTools(page);await page.evaluate(()=>{document.documentElement.dataset.workspaceLocked='true';document.documentElement.dataset.workspaceReady='false';window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated'));});
    await tools(page).waitFor({state:'hidden'});await page.evaluate(()=>window.DailySpaceNotes.open(null,{list:true}));assert.equal(await page.locator('#notes-sheet').isVisible(),false);
  });
  await t.test('custom Agent role roots drag their visual panel through the original close path',async()=>{
    const page=await pageFor();await page.locator('[data-workspace-agent]').click();const overlay=page.locator('#todo-agent-overlay');await overlay.waitFor({state:'visible'});
    await overlay.locator('.todo-agent-input').fill('Keep my unsent question');
    const handle=overlay.locator('.todo-agent-panel [data-sheet-drag-handle]');assert.equal(await handle.count(),1);
    await settle(overlay.locator('.todo-agent-panel'));await drag(page,handle,150);await overlay.waitFor({state:'hidden'});
    await page.locator('[data-workspace-agent]').click();await overlay.waitFor({state:'visible'});assert.equal(await overlay.locator('.todo-agent-input').inputValue(),'Keep my unsent question');
  });
  await t.test('an open filter keeps its name draft and focused field across phone and desktop surfaces',async()=>{
    const page=await pageFor(1280,768);await page.setViewportSize({width:390,height:844});
    await page.locator('[data-task-filters-open]').click();const filter=page.locator('[data-surface-key="task-filters"]');await filter.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('[data-surface-key="task-filters"] [role=dialog]').getAttribute('aria-modal')==='true');
    const input=filter.locator('[data-task-view-name]');await input.fill('Keep this unsaved view');await input.focus();
    await page.setViewportSize({width:1280,height:768});await page.waitForFunction(()=>document.querySelector('[data-surface-key="task-filters"] [role=dialog]').getAttribute('aria-modal')==='false');
    await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-surface-key="task-filters"] [data-task-view-name]'));
    assert.equal(await input.inputValue(),'Keep this unsaved view');assert.ok(await filter.isVisible());
  });
  await t.test('reduced motion retains phone handle dismissal without a closing animation',async()=>{
    const page=await pageFor(390,640,'reduce');await page.evaluate(()=>window.DailySpaceFocus.open());const sheet=page.locator('#focus-sheet');await sheet.waitFor({state:'visible'});await drag(page,sheet.locator('[data-sheet-drag-handle]'),150);await sheet.waitFor({state:'hidden'});assert.equal(await sheet.evaluate(node=>node.classList.contains('is-closing')),false);
  });
  assert.deepEqual(errors,[]);
});
