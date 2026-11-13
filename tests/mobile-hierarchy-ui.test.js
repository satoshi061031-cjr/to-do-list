const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright-core');

test('compact phone glance and desktop focus hierarchy retain existing actions', {timeout:90000}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-hierarchy-'));
  const port=56500+Math.floor(Math.random()*1500),base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(dir,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
  t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());
  const errors=[];
  async function pageFor(options={}){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'UTC',...options});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**/*',route=>route.abort());await page.clock.install({time:new Date('2026-11-13T09:00:00Z')});
    await page.addInitScript(()=>{
      if(sessionStorage.getItem('hierarchy-fixture'))return;sessionStorage.setItem('hierarchy-fixture','1');sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');localStorage.setItem('daily-space-language-v1','en');
      localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[{id:'timed',text:'Prepare the design review',dueDate:'2026-11-13',dueTime:'11:00',completed:false},{id:'plain',text:'Take an evening walk',dueDate:'2026-11-13',completed:false}]}));
      localStorage.setItem('calendar-app-v1',JSON.stringify({selectedDate:'2026-11-13',reminders:[{id:'meeting',text:'Meet the client',date:'2026-11-13',startTime:'14:00',endTime:'15:00',priority:'medium'}]}));
      localStorage.setItem('planner-app-v1',JSON.stringify({planners:[],boards:{}}));localStorage.setItem('tally-book-v1',JSON.stringify({baseCurrency:'CNY',records:[]}));
    });return page;
  }
  async function openPhone(page){await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});await page.locator('.phone-workbench-overview').waitFor({state:'visible'});}
  async function settled(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}

  await t.test('default glance is short, shows the actual next plan and never reserves zero-value tiles',async()=>{
    const page=await pageFor();await openPhone(page);
    const glance=page.locator('.phone-overview-summary'),toggle=page.locator('[data-phone-overview-toggle]');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.phone-overview-grid').isVisible(),false);
    assert.match(await page.locator('[data-phone-summary=tasks]').textContent(),/3.*To do today/);
    assert.match(await page.locator('[data-phone-summary=next]').textContent(),/11:00.*Prepare the design review/);
    assert.equal(await page.locator('[data-workbench-section=agenda]').isVisible(),false,'The compact summary is the only phone next-arrangement card, including when a future timed task exists');
    assert.ok((await glance.boundingBox()).height<=90);
    const first=await page.locator('#todo-list .todo-item').first().boundingBox();assert.ok(first.y+first.height<724,'The first complete task remains above the phone action area: '+JSON.stringify(first));
    await toggle.click();assert.equal(await page.locator('.phone-overview-grid').isVisible(),true);assert.equal(await page.locator('[data-phone-overview=projects] .phone-overview-value').textContent(),'0');
    assert.ok((await page.locator('.phone-overview-grid').boundingBox()).height>100,'Expanded metrics remain available without reserving their space in the compact default');
    await page.reload();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await toggle.click();await page.reload();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await page.locator('[data-phone-summary=tasks]').click();assert.equal(await page.evaluate(()=>window.DailySpaceTodo.getPlanningView().mode),'tasks');
  });

  await t.test('agenda and spending visibility carry through expanded glance and account transitions',async()=>{
    const page=await pageFor();await openPhone(page);
    await page.evaluate(()=>window.DailySpaceWorkbenchPreferences.save({...window.DailySpaceWorkbenchPreferences.read(),phoneOverviewExpanded:true,hidden:['agenda','spend']}));await settled(page);
    assert.equal(await page.locator('[data-phone-summary=next]').isVisible(),false);assert.equal(await page.locator('[data-phone-overview=schedule]').isVisible(),false);assert.equal(await page.locator('[data-phone-overview=spend]').isVisible(),false);
    const before=await page.evaluate(()=>localStorage.getItem('daily-space-workbench-v1'));
    await page.evaluate(()=>{document.documentElement.dataset.workspaceLocked='true';window.dispatchEvent(new CustomEvent('daily-space-user-sync-updated'));});await settled(page);
    assert.equal(await page.locator('.phone-workbench-overview').isVisible(),false);assert.equal(await page.locator('[data-phone-summary=next]').getAttribute('href'),'calendar.html#today');
    await page.locator('[data-phone-overview-toggle]').dispatchEvent('click');assert.equal(await page.evaluate(()=>localStorage.getItem('daily-space-workbench-v1')),before);
  });

  await t.test('failed expansion keeps the previous choice and works at 320px with keyboard access',async()=>{
    const page=await pageFor({viewport:{width:320,height:568}});await openPhone(page);
    await page.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='daily-space-workbench-v1')throw new Error('QuotaExceededError');return write.call(this,key,value);};});
    const toggle=page.locator('[data-phone-overview-toggle]');await toggle.focus();await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.match(await page.locator('.phone-overview-error').textContent(),/Could not save/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    for(const item of await page.locator('.phone-overview-summary button,.phone-overview-summary a').all()){const box=await item.boundingBox();if(box)assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));}
  });

  await t.test('Customize keeps the overview draft and desktop promotes focus while details remain usable',async()=>{
    const page=await pageFor();await openPhone(page);await page.locator('[data-workbench-settings]').click();const settings=page.locator('#workbench-settings');await settings.locator('[data-phone-overview-preference]').selectOption('expanded');await page.goBack();await settings.waitFor({state:'hidden'});await page.locator('[data-workbench-settings]').click();assert.equal(await settings.locator('[data-phone-overview-preference]').inputValue(),'expanded');await settings.locator('button[type=submit]').click();await settings.waitFor({state:'hidden'});assert.equal(await page.locator('[data-phone-overview-toggle]').getAttribute('aria-expanded'),'true');
    const desktop=await pageFor({isMobile:false,hasTouch:false,viewport:{width:1280,height:768}});await desktop.goto(`${base}/todo.html`,{waitUntil:'load'});
    const primary=await desktop.locator('[data-focus-card-start]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,token:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),color:getComputedStyle(el).color}));
    assert.notEqual(primary.background,'rgba(0, 0, 0, 0)');assert.notEqual(await desktop.locator('.overview-focus-open').evaluate(el=>getComputedStyle(el).backgroundColor),primary.background);
    await desktop.locator('.overview-focus-open').click();await desktop.locator('.task-desktop-editor').waitFor({state:'visible'});await desktop.goBack();await desktop.locator('.task-desktop-editor').waitFor({state:'hidden'});await desktop.locator('[data-focus-card-start]').click();await desktop.locator('#focus-sheet').waitFor({state:'visible'});
  });
  await t.test('a short phone exposes its first two title lines and checkbox above the New task action',async()=>{
    const page=await pageFor({viewport:{width:320,height:568}});await openPhone(page);await settled(page);
    await page.evaluate(()=>{const api=window.DailySpaceTodo,item=api.getTasks().find(task=>task.id==='timed');api.saveTask({...item,text:'Review the weekly research and choose the next important step for the project'},item.id);api.setPriority(item.id,'high');api.pinTask(item.id,true);});await settled(page);
    async function checkTitle(){
      const geometry=await page.locator('#todo-list .todo-item').first().evaluate(row=>{
        const label=row.querySelector('.todo-label'),range=document.createRange();range.selectNodeContents(label);
        const lines=[...range.getClientRects()].filter(rect=>rect.width&&rect.height).slice(0,2).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,hit:row.contains(document.elementFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2))}));
        const action=document.getElementById('m-add-task').getBoundingClientRect(),check=row.querySelector('.todo-check-target').getBoundingClientRect();
        return{id:row.dataset.id,text:label.textContent,lines,action:{left:action.left,right:action.right,top:action.top,bottom:action.bottom},checkboxVisible:row.contains(document.elementFromPoint(check.x+check.width/2,check.y+check.height/2))};
      });
      assert.equal(geometry.lines.length,2,'The regression uses a genuinely wrapped long title: '+JSON.stringify(geometry));assert.ok(geometry.checkboxVisible,JSON.stringify(geometry));
      for(const line of geometry.lines){assert.ok(line.hit,JSON.stringify(geometry));const a=geometry.action;assert.equal(line.left<a.right&&line.right>a.left&&line.top<a.bottom&&line.bottom>a.top,false,JSON.stringify(geometry));}
    }
    await checkTitle();assert.equal(await page.locator('.workbench-intro').isVisible(),false);
    await page.evaluate(()=>{const row=document.querySelector('.workspace-save-status');row.hidden=false;row.querySelector('span').textContent='Device storage failed · sync paused';row.querySelector('button').hidden=false;});await settled(page);
    assert.equal(await page.locator('.workspace-save-status').isVisible(),true,'A real visible sync/storage failure is never hidden by the compact rule');await checkTitle();
    for(const item of await page.locator('.page-action-cluster button,.phone-overview-summary button,.phone-overview-summary a').all()){const box=await item.boundingBox();if(box)assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));}
  });
  assert.deepEqual(errors,[]);
});
