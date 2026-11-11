const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('data integrity and recovery workflows', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-space-integrity-'));
  const port = 51000 + Math.floor(Math.random() * 4000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, 'test.sqlite'), GROQ_API_KEY:'', OPENAI_API_KEY:'', SUPABASE_URL:'', SUPABASE_SERVICE_ROLE_KEY:'' }, stdio:'ignore'
  });
  t.after(async () => { if(server.exitCode===null) await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');}); fs.rmSync(directory,{recursive:true,force:true}); });
  let ready=false;
  for(let i=0;i<50;i++){ try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch(_){} await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.ok(ready,'Isolated test server starts');
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});
  t.after(()=>browser.close());
  const errors=[];
  async function pageFor(options={}) {
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',...options});t.after(()=>context.close());
    const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{
      if(sessionStorage.getItem('integrity-fixture'))return;sessionStorage.setItem('integrity-fixture','1');
      sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');
      const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[{id:'private',text:'Private device task',dueDate:date,completed:false}]}));
      localStorage.setItem('tally-book-v1',JSON.stringify({baseCurrency:'CNY',budget:3000,records:[
        {id:'base',date,amount:70,currency:'CNY',fxRate:1,category:'Lunch',tripId:'trip-a',tripName:'Kyoto'},
        {id:'foreign',date,amount:10,currency:'USD',fxRate:7,category:'Train',tripId:'trip-a',tripName:'Kyoto'}]}));
      localStorage.setItem('travel-book-v1',JSON.stringify({version:5,activeTripId:'trip-a',trips:[{id:'trip-a',name:'Kyoto',destination:'Kyoto',startDate:date,endDate:date,lat:35, lng:135,zoom:12,stops:[]}]}));
    });
    return page;
  }
  const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  async function signedApi(page,user){
    await page.addInitScript(user=>localStorage.setItem('daily-space-auth-v1',JSON.stringify(user)),user);
    let cloud={payload:{},revision:0,updatedAt:null};
    await page.route('**/api/user/snapshot',route=>{
      if(route.request().method()==='PUT')cloud={payload:route.request().postDataJSON().payload,revision:cloud.revision+1,updatedAt:new Date().toISOString()};
      return json(route,{ok:true,...cloud});
    });
    await page.route('**/api/auth/me',route=>json(route,{user:{...user,userId:user.email}}));
  }
  async function capture(page,name){if(!process.env.UI_CAPTURE_DIR)return;fs.mkdirSync(process.env.UI_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_CAPTURE_DIR,name),animations:'disabled',style:'#sidebar-hint{visibility:hidden}'});}

  await t.test('ledger preserves currency history, inherits trip scope and supports consecutive capture with one history entry',async()=>{
    const page=await pageFor({isMobile:true,hasTouch:true});
    await page.goto(`${base}/tally.html?tripFilter=trip-a`,{waitUntil:'load'});
    assert.equal(await page.locator('#tally-month-total').textContent(),'CN¥140.00');
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('tally-book-v1')).records);
    await page.locator('#tally-tools > summary').click();await page.locator('#tally-settings-toggle').click();
    assert.equal(await page.locator('#tally-currency').isEditable(),false);
    await page.locator('#tally-currency').evaluate(input=>{input.value='USD';input.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await page.locator('#tally-month-total').textContent(),'CN¥140.00');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tally-book-v1')).records),before);
    await page.evaluate(()=>window.DailySpaceI18n.setLocale('zh'));
    await page.locator('#tally-add-open').click();
    assert.equal(await page.locator('#tally-trip').inputValue(),'trip-a');
    const date=await page.locator('#tally-date').inputValue(),historyLength=await page.evaluate(()=>history.length);
    await page.locator('#tally-amount').fill('25');await page.locator('#tally-category').fill('Coffee');
    await page.locator('#tally-save-another').click();
    assert.equal(await page.locator('#tally-add-sheet').isVisible(),true);
    assert.equal(await page.locator('#tally-amount').inputValue(),'');
    assert.equal(await page.locator('#tally-category').inputValue(),'Coffee');
    assert.equal(await page.locator('#tally-date').inputValue(),date);
    assert.equal(await page.locator('#tally-trip').inputValue(),'trip-a');
    assert.equal(await page.evaluate(()=>history.length),historyLength);
    assert.equal(await page.locator('#tally-month-total').textContent(),'CN¥165.00');
    for(const width of [390,320]){
      await page.setViewportSize({width,height:420});
      await page.evaluate(()=>window.DailySpaceI18n.setLocale('zh'));
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>['tally-save-another','tally-submit'].every(id=>{const box=document.getElementById(id).getBoundingClientRect();return box.y>=0&&box.bottom<=innerHeight;}));
      for(const id of ['tally-save-another','tally-submit']){const box=await page.locator(`#${id}`).boundingBox();assert.ok(box.width>=44&&box.height>=44&&box.y>=0&&box.y+box.height<=420,`${id}: ${JSON.stringify(box)}`);}
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await capture(page,`tally-continue-${width}-420.png`);
    }
    await page.locator('#tally-amount').fill('30');await page.locator('#tally-submit').click();await page.locator('#tally-add-sheet').waitFor({state:'hidden'});
    const linked=await page.evaluate(()=>JSON.parse(localStorage.getItem('tally-book-v1')).records.filter(record=>record.category==='Coffee'));
    assert.deepEqual(linked.map(record=>record.amount),[30,25]);assert.ok(linked.every(record=>record.tripId==='trip-a'));
    await page.setViewportSize({width:390,height:844});
    await page.locator('#tally-quick-options > summary').click();await page.locator('#tally-quick-amount').fill('5');await page.locator('#tally-quick-form button').click();
    assert.equal(await page.locator('#tally-month-total').textContent(),'CN¥200.00');
    await page.locator('.tally-record').first().click();assert.equal(await page.locator('#tally-save-another').isVisible(),false);
  });

  await t.test('late team board replies and signout never expose a previously selected board',async()=>{
    const page=await pageFor({viewport:{width:1280,height:900}});
    const user={provider:'Google',email:'alice@example.com',label:'Alice'};await signedApi(page,user);
    let signed=true,hold=false,release,arrived;
    const waiting=new Promise(resolve=>{arrived=resolve;});
    const board=id=>({id,name:id==='a'?'Alpha':'Beta',workspaceId:'w',columns:[{id:'col',title:'Planned',status:'planned'}],tasks:[{id:`secret-${id}`,columnId:'col',title:`Private ${id.toUpperCase()}`,note:'',completed:false}]});
    await page.route('**/api/auth/me',route=>json(route,{user:signed?{...user,userId:user.email}:null}));
    await page.route('**/api/workspaces',route=>json(route,{workspaces:signed?[{id:'w',name:'Team',role:'owner',capabilities:{manageBoards:true}}]:[]}));
    await page.route('**/api/workspaces/w/boards',route=>json(route,{boards:[board('a'),board('b')]}));
    await page.route('**/api/workspaces/w/members',route=>json(route,{members:[]}));
    await page.route('**/api/boards/*',route=>{
      const id=route.request().url().split('/').at(-1);
      if(!signed)return json(route,{error:'Please sign in first.'},401);
      if(id==='a'&&hold)return new Promise(resolve=>{release=async()=>{await json(route,{board:board('a')}).catch(()=>{});resolve();};arrived();});
      return json(route,{board:board(id)});
    });
    await page.goto(`${base}/planner.html`,{waitUntil:'load'});
    await page.locator('[aria-label="Team board Alpha"]').waitFor({state:'attached'});
    hold=true;await page.locator('[aria-label="Team board Alpha"]').evaluate(button=>button.click());await waiting;
    await page.locator('[aria-label="Team board Beta"]').evaluate(button=>button.click());await page.locator('[data-entry-id="secret-b"]').waitFor({state:'visible'});
    await release();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-entry-id="secret-a"]').count(),0);assert.ok(await page.locator('[data-entry-id="secret-b"]').isVisible());
    signed=false;
    await page.evaluate(()=>{localStorage.removeItem('daily-space-auth-v1');window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));});
    assert.equal(await page.locator('[data-entry-id="secret-b"]').count(),0);
    assert.equal(await page.locator('[data-entry-id="secret-a"]').count(),0);
  });

  await t.test('mail times out a fetch ignoring abort, preserves selection and rejects its late reply after retry',async()=>{
    const page=await pageFor({isMobile:true,hasTouch:true});await page.clock.install();
    await signedApi(page,{provider:'Google',email:'mail@example.com',label:'Mail'});
    await page.route('**/api/mail/accounts',route=>json(route,{accounts:[{id:'personal',provider:'Gmail',email:'mail@example.com',hasCredentials:true}]}));
    const message={id:'message',subject:'Original mail',from:'Reader',receivedAt:new Date().toISOString(),snippet:'Mail preview'};
    let fresh=false;
    await page.route('**/api/mail/accounts/personal/digest?*',route=>json(route,{messages:[{...message,subject:fresh?'Fresh mail':message.subject}],digest:'Summary',summarized:true}));
    await page.addInitScript(()=>{
      const original=window.fetch;
      window.fetch=(url,options)=>{
        if(window.hangMail&&String(url).includes('/digest?')){window.hangMail=false;return new Promise(resolve=>{window.lateMail=()=>resolve(new Response(JSON.stringify({messages:[{id:'late',subject:'Late stale mail'}],digest:'Late',summarized:true}),{status:200,headers:{'Content-Type':'application/json'}}));});}
        return original(url,options);
      };
    });
    await page.goto(`${base}/mail.html`,{waitUntil:'load'});await page.locator('[data-open-mail="message"]').waitFor();
    await page.locator('#mail-select-toggle').click();await page.locator('[data-mail-check="message"]').check();
    await page.evaluate(()=>window.hangMail=true);await page.locator('#mail-refresh').click();
    await page.waitForFunction(()=>typeof window.lateMail==='function');
    await page.clock.runFor(20050);
    await page.locator('#mail-status .mail-retry-btn').waitFor({state:'visible'});
    assert.equal(await page.locator('#mail-refresh').isDisabled(),false);assert.ok(await page.locator('[data-mail-check="message"]').isChecked());
    fresh=true;await page.locator('#mail-status .mail-retry-btn').click();await page.locator('#mail-status').waitFor({state:'hidden'});
    assert.ok((await page.locator('[data-open-mail="message"]').textContent()).includes('Fresh mail'));
    await page.evaluate(()=>window.lateMail());
    assert.equal(await page.locator('[data-open-mail="late"]').count(),0);assert.ok(await page.locator('[data-mail-check="message"]').isChecked());
  });
  await t.test('first Google sign-in preserves Guest work through cloud choice, reload and signout',async()=>{
    const page=await pageFor({isMobile:true,hasTouch:true});
    const user={email:'guest-login@example.com',provider:'Google',label:'Reader'};
    const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const remote={'todo-app-v2':JSON.stringify({categories:[],todos:[{id:'cloud',text:'Cloud account task',dueDate:date,completed:false}]})};
    let puts=0;
    await page.route('**/api/user/snapshot',route=>{if(route.request().method()==='PUT')puts++;return json(route,{ok:true,userId:user.email,payload:remote,revision:1,updatedAt:'2026-11-01T10:00:00Z'});});
    await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
    assert.ok(await page.locator('#todo-list [data-id="private"]').isVisible());
    await page.evaluate(user=>{localStorage.setItem('daily-space-auth-v1',JSON.stringify(user));window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));},user);
    await page.waitForFunction(()=>document.querySelector('.workspace-save-status')?.textContent.includes('choose which version'));
    assert.ok(await page.locator('#todo-list [data-id="private"]').isVisible());assert.equal(puts,0);
    assert.ok(await page.evaluate(()=>localStorage.getItem('daily-space-user-cache-v1:__guest__')?.includes('Private device task')));
    await page.locator('.workspace-save-status button').click();await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('[data-sync-choice="cloud"]').click()]);
    await page.locator('#todo-list [data-id="cloud"]').waitFor({state:'visible'});
    await page.evaluate(()=>{localStorage.removeItem('daily-space-auth-v1');window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));});
    await page.locator('#todo-list [data-id="private"]').waitFor({state:'visible'});assert.equal(await page.locator('#todo-list [data-id="cloud"]').count(),0);
  });

  await t.test('a failed local cloud apply pauses sync, keeps recovery data and retries without uploading stale data',async()=>{
    const page=await pageFor({isMobile:true,hasTouch:true});const user={email:'storage-reader@example.com',provider:'Google',label:'Reader'};
    await page.addInitScript(user=>localStorage.setItem('daily-space-auth-v1',JSON.stringify(user)),user);
    let cloud={payload:{},revision:0,updatedAt:null},puts=0;
    await page.route('**/api/user/snapshot',route=>{
      if(route.request().method()==='PUT'){puts++;cloud={payload:route.request().postDataJSON().payload,revision:cloud.revision+1,updatedAt:new Date().toISOString()};}
      return json(route,{ok:true,userId:user.email,...cloud});
    });
    await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelector('.workspace-save-status')?.textContent.includes('Synced to cloud'));
    const tasks=JSON.parse(cloud.payload['todo-app-v2']);tasks.todos.find(task=>task.id==='private').text='Updated on another device';
    cloud={payload:{...cloud.payload,'todo-app-v2':JSON.stringify(tasks)},revision:cloud.revision+1,updatedAt:new Date().toISOString()};const writesBefore=puts;
    await page.evaluate(()=>{
      window.originalStorageSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='todo-app-v2')throw new DOMException('Storage full','QuotaExceededError');return window.originalStorageSetItem.call(this,key,value);};
      document.activeElement?.blur();window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(()=>document.querySelector('.workspace-save-status')?.textContent.includes('Device storage failed'));
    assert.equal(puts,writesBefore);assert.ok(await page.locator('#todo-list [data-id="private"]').textContent().then(text=>text.includes('Private device task')));
    assert.ok(await page.evaluate(()=>Boolean(localStorage.getItem('daily-space-snapshot-recovery-v1'))));
    await page.evaluate(()=>Storage.prototype.setItem=window.originalStorageSetItem);
    await page.locator('[data-workspace-gate-retry]').click();
    await page.waitForFunction(()=>document.querySelector('#todo-list [data-id="private"] .todo-label')?.textContent==='Updated on another device');
    assert.equal(puts,writesBefore);
    assert.equal(await page.evaluate(()=>localStorage.getItem('daily-space-snapshot-recovery-v1')),null);
  });
  await t.test('another tab changing the account cannot leave writable controls for the old workspace',async()=>{
    const page=await pageFor({viewport:{width:1280,height:900}});
    const date=new Date().toISOString().slice(0,10);
    const alice={categories:[],todos:[{id:'alice-private',text:'Alice private task',completed:false,dueDate:date}]};
    const bob={categories:[],todos:[{id:'bob-private',text:'Bob private task',completed:false,dueDate:date}]};
    await page.addInitScript(data=>{
      localStorage.setItem('daily-space-auth-v1',JSON.stringify({provider:'Google',label:'Alice',email:'alice@example.com'}));
      localStorage.setItem('daily-space-last-user-v1','alice@example.com');
      localStorage.setItem('daily-space-workspace-owner-v1',JSON.stringify({owner:'alice@example.com'}));
      localStorage.setItem('todo-app-v2',JSON.stringify(data));
    },alice);
    let block=false,identity='alice@example.com';const held=[];
    const reply=route=>json(route,{ok:true,userId:identity,revision:1,updatedAt:'2026-11-01T00:00:00Z',payload:{'todo-app-v2':JSON.stringify(identity==='alice@example.com'?alice:bob)}});
    await page.route('**/api/user/snapshot',route=>{if(block){held.push(route);return;}return reply(route);});
    await page.goto(`${base}/todo.html?device=desktop`,{waitUntil:'load'});
    await page.locator('#todo-list [data-id="alice-private"]').waitFor();
    await page.waitForFunction(()=>document.querySelector('.workspace-save-status')?.textContent.includes('Synced to cloud'));
    const peer=await page.context().newPage();await peer.goto(`${base}/manifest.json`);
    block=true;identity='bob@example.com';
    await peer.evaluate(data=>{
      localStorage.setItem('daily-space-auth-v1',JSON.stringify({provider:'Google',label:'Bob',email:'bob@example.com'}));
      localStorage.setItem('todo-app-v2',JSON.stringify(data));
      localStorage.setItem('daily-space-workspace-owner-v1',JSON.stringify({owner:'bob@example.com'}));
    },bob);
    await page.waitForFunction(()=>{
      const old=document.querySelector('#todo-list [data-id="alice-private"]');
      return !old||Boolean(old.closest('[inert]'))||old.getBoundingClientRect().height===0;
    });
    block=false;for(const route of held)await reply(route).catch(()=>{});
    await page.locator('#todo-list [data-id="bob-private"]').waitFor({state:'visible'});
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('todo-app-v2')));
    assert.equal(stored.todos.some(task=>task.id==='alice-private'),false);
    assert.equal(stored.todos.some(task=>task.id==='bob-private'),true);
  });

  await t.test('storage failure during logout hides the previous account and keeps a reachable recovery path',async()=>{
    const page=await pageFor({isMobile:true,hasTouch:true});
    await signedApi(page,{provider:'Google',email:'logout@example.com',label:'Reader'});
    await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
    await page.waitForFunction(()=>document.querySelector('.workspace-save-status')?.textContent.includes('Synced to cloud'));
    await page.evaluate(()=>window.DailySpaceI18n.setLocale('zh'));
    await page.evaluate(()=>{
      window.savedStorageSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
      localStorage.removeItem('daily-space-auth-v1');window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
    });
    await page.waitForFunction(()=>document.documentElement.dataset.workspaceLocked==='true');
    assert.equal(await page.locator('.main-area').isVisible(),false);
    const gate=page.locator('.workspace-account-gate');assert.ok(await gate.isVisible());
    assert.equal(await gate.locator('h2').textContent(),'工作区已保护');
    await page.setViewportSize({width:320,height:568});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const button of await gate.locator('button').all()){const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44&&box.y>=0&&box.y+box.height<=568);}
    await capture(page,'workspace-recovery-320.png');
    await page.evaluate(()=>Storage.prototype.setItem=window.savedStorageSetItem);
    await gate.locator('[data-workspace-gate-retry]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.workspaceLocked==='false');
    assert.equal(await page.locator('.main-area').isVisible(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('daily-space-auth-v1')),null);
  });
  assert.deepEqual(errors,[],'No browser JavaScript errors');
});
