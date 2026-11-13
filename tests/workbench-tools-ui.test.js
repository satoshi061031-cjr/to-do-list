const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('combined workbench keeps tasks reachable with anchored menus and phone action sheets', {timeout:120_000}, async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-tools-')), port=55000+Math.floor(Math.random()*1000), base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(directory,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
  t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(directory,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());const errors=[];
  for(const width of [320,390,1280,1440])await t.test(`${width}px shows tasks and restores tool focus after dialogs`,async()=>{
    const mobile=width<820,context=await browser.newContext({viewport:{width,height:mobile?844:width===1280?768:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});t.after(()=>context.close());
    const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(width=>{
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');localStorage.setItem('daily-space-language-v1','en');
      const date=new Date(),today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[{id:'first-task',text:'Prepare the weekly project update',dueDate:today,priority:'high',todayPinDate:today,todayPinOrder:0,completed:false},{id:'second-task',text:'Book a train',dueDate:today,completed:false}]}));
      if(width===1280)localStorage.setItem('daily-space-workbench-v1',JSON.stringify({name:'My workbench',displayName:'Jun',desktopLayout:{order:['focus','tasks','agenda','detail'],wide:'focus'},bookmarks:[{id:'library',title:'Research library',url:'https://example.com/library'}]}));
    },width);
    await page.goto(`${base}/${mobile?'todo-m.html':'todo.html'}`,{waitUntil:'load'});
    const tools=page.locator('#workbench-tools'),trigger=page.locator('[data-workbench-tools-trigger]');
    const surface=page.locator('[data-surface-key=workbench-tools]'),content=page.locator('#workbench-tools-content');
    await tools.waitFor(); assert.equal(await trigger.getAttribute('aria-expanded'),'false'); assert.equal(await content.isVisible(),false);
    assert.equal(await content.locator('[data-focus-open]').count(),1);assert.equal(await content.locator('[data-focus-review]').count(),1);assert.equal(await content.locator('[data-notes-open]').count(),1);assert.equal(await content.locator('[data-history-open]').count(),1);
    assert.equal(await content.locator('[data-workbench-templates]').count(),1,'Original Templates action remains available inside Tools');
    if(mobile){assert.equal(await page.locator('.m-add-bar .workspace-task-shortcuts button').count(),0);assert.equal(await page.locator('.m-add-bar #m-add-task').count(),1,'New task is the single bottom action');}
    const first=page.locator('#todo-list .todo-item').first(),rect=await first.boundingBox();assert.ok(rect.y<(mobile?650:900),`First task starts at ${rect.y}`);
    if(width===1280){const input=await page.locator('#todo-input').boundingBox();assert.ok(input.y<600&&rect.y+rect.height<740,JSON.stringify({input,first:rect}));}
    await first.locator('.todo-check-target').click({trial:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    async function openTools(){await trigger.click();await surface.waitFor({state:'visible'});assert.equal(await trigger.getAttribute('aria-expanded'),'true');}
    await openTools();const after=await first.boundingBox();assert.ok(Math.abs(after.y-rect.y)<1,'Tools does not push the task list');
    await page.keyboard.press('Escape');await surface.waitFor({state:'hidden'});assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.ok(await trigger.evaluate(node=>node===document.activeElement));
    await openTools();if(mobile)await surface.locator('.interaction-surface-backdrop').click({position:{x:4,y:4}});else await page.locator('[data-page-header] h1').click();await surface.waitFor({state:'hidden'});
    for(const [selector,dialog] of [['[data-focus-open]','#focus-sheet'],['[data-notes-open]','#notes-sheet'],['[data-history-open]','#record-history-sheet']]){
      await openTools();await content.locator(selector).click();await page.locator(dialog).waitFor({state:'visible'});await surface.waitFor({state:'hidden'});
      await page.goBack();await page.locator(dialog).waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-workbench-tools-trigger]'));
    }
    await openTools();await content.locator('[data-focus-open]').click();await page.locator('[data-focus-task]').selectOption('first-task');await page.locator('[data-focus-start]').click();await page.goBack();await page.locator('#focus-sheet').waitFor({state:'hidden'});
    await page.waitForFunction(()=>/Focusing/.test(document.querySelector('[data-workbench-tools-trigger]').getAttribute('aria-label')));assert.match(await trigger.textContent(),/\d+:\d+/);
    assert.equal(await page.locator('#todo-list [data-id=first-task]').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  assert.deepEqual(errors,[]);
});
