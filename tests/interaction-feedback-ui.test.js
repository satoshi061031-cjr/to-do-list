const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

test('inline note feedback distinguishes successful local saves from retryable failures', { timeout: 45000 }, async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dayfly-feedback-'));
  const port=57000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['--experimental-sqlite','--disable-warning=ExperimentalWarning','server/index.js'],{
    cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DAILY_SPACE_DB_PATH:path.join(dir,'test.sqlite'),GROQ_API_KEY:'',OPENAI_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'
  });
  t.after(async()=>{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<50;i++){try{if((await fetch(`${base}/api/health`)).ok)break;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:process.env.CHROMIUM_NO_SANDBOX==='1'?['--no-sandbox']:[]});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});t.after(()=>context.close());
  const page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(()=>{localStorage.setItem('daily-space-language-v1','en');sessionStorage.setItem('daily-space-guest-save-dismissed-v1','1');});
  await page.goto(`${base}/todo-m.html`,{waitUntil:'load'});
  await page.locator('[data-workbench-tools-trigger]').click();
  await page.locator('[data-notes-open]').click();
  const sheet=page.locator('#notes-sheet');await sheet.waitFor({state:'visible'});
  await sheet.locator('[data-note-new]').click();
  await sheet.locator('[name=title]').fill('Feedback check');await sheet.locator('[name=body]').fill('Saved text');
  await sheet.getByRole('button',{name:'Save note',exact:true}).click();
  const status=sheet.locator('.notes-status');
  assert.equal(await status.getAttribute('data-feedback'),'success');assert.equal(await status.getAttribute('role'),'status');
  assert.match(await status.textContent(),/Saved on this device/);
  const original=await page.evaluate(()=>localStorage.getItem('dayfly-notes-v1'));
  await page.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='dayfly-notes-v1')throw new Error('QuotaExceededError');return write.call(this,key,value);};});
  await sheet.locator('[name=body]').fill('Keep this retry draft');await sheet.getByRole('button',{name:'Save note',exact:true}).click();
  assert.equal(await status.getAttribute('data-feedback'),'error');assert.equal(await status.getAttribute('role'),'alert');
  assert.match(await status.textContent(),/Could not save/);
  assert.equal(await sheet.locator('[name=body]').inputValue(),'Keep this retry draft');assert.equal(await page.evaluate(()=>localStorage.getItem('dayfly-notes-v1')),original);
  assert.deepEqual(errors,[]);
});
