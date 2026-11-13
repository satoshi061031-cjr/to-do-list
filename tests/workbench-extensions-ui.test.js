const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('external websites, context layouts and desktop widget choices work through the UI', {timeout:90_000}, async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-links-')), port=53500+Math.floor(Math.random()*1500), base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(directory,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
  t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(directory,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());
  const errors=[];
  async function pageFor(mobile=true){
    const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});t.after(()=>context.close());
    const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.stack || error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{if(sessionStorage.getItem('extension-seeded'))return;sessionStorage.setItem('extension-seeded','1');sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');localStorage.setItem('daily-space-language-v1','en');localStorage.setItem('todo-app-v2',JSON.stringify({categories:[],todos:[]}));});
    await page.goto(`${base}/${mobile?'todo-m.html':'todo.html'}`,{waitUntil:'load'});return page;
  }
  async function settings(page){await page.locator('[data-workbench-settings]').click();const root=page.locator('#workbench-settings');await root.waitFor({state:'visible'});return root;}
  async function save(root){await root.locator('button[type=submit]').click();await root.waitFor({state:'hidden'});}
  async function addWebsite(root,title,url){await root.locator('.workbench-bookmark-settings > summary').click();await root.locator('[data-bookmark-add]').click();const row=root.locator('[data-bookmark-row]').last();await row.locator('[data-bookmark-field=title]').fill(title);await row.locator('[data-bookmark-field=url]').fill(url);return row;}

  await t.test('phone adds a safe external tool, preserves a draft on Back and switches work/life links', async()=>{
    const page=await pageFor(), root=await settings(page);const row=await addWebsite(root,'Research library','https://example.com/library');await row.locator('[data-bookmark-field=group]').fill('Research');await row.locator('[data-bookmark-field=tags]').fill('papers, reading');
    await page.goBack();await root.waitFor({state:'hidden'});await page.locator('[data-workbench-settings]').click();await root.waitFor({state:'visible'});
    assert.equal(await root.locator('[data-bookmark-field=title]').inputValue(),'Research library');
    await root.locator('.workbench-context-settings > summary').click();await root.locator('[data-context-save=work]').click();await save(root);
    const link=page.locator('[data-workbench-section=shortcuts] [data-bookmark-id]');assert.equal(await link.getAttribute('href'),'https://example.com/library');assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
    const edit=await settings(page);await edit.locator('.workbench-bookmark-settings > summary').click();await edit.locator('[data-bookmark-field=enabled]').uncheck();await edit.locator('[data-bookmark-add]').click();const life=edit.locator('[data-bookmark-row]').last();await life.locator('[data-bookmark-field=title]').fill('Life list');await life.locator('[data-bookmark-field=url]').fill('https://example.com/life');await edit.locator('.workbench-context-settings > summary').click();await edit.locator('[data-context-save=life]').click();await save(edit);
    assert.equal(await page.locator('[data-workbench-context]').inputValue(),'life');assert.match(await link.textContent(),/Life list/);
    await page.locator('[data-workbench-context]').selectOption('work');assert.match(await link.textContent(),/Research library/);assert.equal(await link.count(),1);
    await page.reload();assert.equal(await page.locator('[data-workbench-context]').inputValue(),'work');assert.match(await page.locator('[data-workbench-section=shortcuts] [data-bookmark-id]').textContent(),/Research library/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });

  await t.test('invalid URLs and quota failure keep the unsaved form available', async()=>{
    const page=await pageFor(),root=await settings(page),row=await addWebsite(root,'Unsafe','javascript:alert(1)');await root.locator('button[type=submit]').click();assert.ok(await root.locator('[role=alert]').isVisible());assert.ok(await root.isVisible());
    await row.locator('[data-bookmark-field=url]').fill('https://example.com/safe');
    await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='daily-space-workbench-v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value);};});
    await root.locator('button[type=submit]').click();assert.ok(await root.isVisible());assert.match(await root.locator('[role=alert]').textContent(),/could not be saved/);assert.equal(await row.locator('[data-bookmark-field=url]').inputValue(),'https://example.com/safe');
  });

  await t.test('desktop reorders widgets and expands one card without overlapping controls', async()=>{
    const page=await pageFor(false),root=await settings(page);await root.locator('.workbench-widget-settings > summary').click();await root.locator('[data-widget-up=focus]').click();await root.locator('[data-widget-up=focus]').click();await root.locator('[data-widget-wide]').selectOption('focus');await save(root);
    const overview=page.locator('.workbench-desktop-overview');assert.equal(await overview.getAttribute('data-custom-layout'),'true');assert.equal(await overview.locator('.workbench-overview-grid > section').first().getAttribute('data-overview-widget'),'focus');assert.equal(await overview.locator('[data-overview-widget=focus]').getAttribute('data-wide-widget'),'true');
    const cards=await overview.locator('.workbench-overview-grid > section:visible').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)assert.ok(cards[i].right<=cards[j].x+1||cards[j].right<=cards[i].x+1||cards[i].bottom<=cards[j].y+1||cards[j].bottom<=cards[i].y+1,'Cards must not overlap');
    await page.reload();assert.equal(await page.locator('.workbench-overview-grid > section').first().getAttribute('data-overview-widget'),'focus');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  assert.deepEqual(errors,[]);
});
