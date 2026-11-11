const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

test("team Planner isolates board requests and private account views", { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planner-isolation-"));
  const port = 47000 + Math.floor(Math.random() * 5000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"], {
    cwd: path.resolve(__dirname, ".."), env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, "test.sqlite"),
      GROQ_API_KEY: "", OPENAI_API_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, stdio: "ignore",
  });
  t.after(async () => {
    if (server.exitCode === null) await new Promise(resolve => { server.once("exit", resolve); server.kill("SIGTERM"); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
  t.after(() => browser.close());

  async function fixture() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**/*", route => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem("daily-space-auth-v1", JSON.stringify({ provider: "Google", email: "alice@example.com", label: "Alice" }));
      localStorage.setItem("daily-space-last-user-v1", "alice@example.com");
      localStorage.setItem("planner-app-v1", JSON.stringify({version:2,selectedPlannerId:"personal",planners:[{id:"personal",name:"Personal notebook"}],boards:{personal:{columns:[{id:"personal-col",title:"Planned",status:"planned",systemKey:"planned"}],entries:[{id:"personal-entry",columnId:"personal-col",title:"My personal card",note:"",completed:false,expanded:false,tags:[]}]}}}));
      // Deliberately ignore abort in this fixture: the context checks must also
      // protect against replies already queued by a service worker or transport.
      const nativeFetch = window.fetch;
      window.fetch = (url, init) => nativeFetch(url, { ...init, signal: undefined });
    });
    let user = { userId: "alice@example.com", email: "alice@example.com", provider: "Google", label: "Alice" };
    const clouds = new Map(); const requests = []; const held = [];
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const board = (id, owner = user?.label || "Signed out") => ({ id, name: id === "a" ? "Alpha" : "Beta", workspaceId: "w",
      columns: [{ id: `col-${id}`, title: "Planned", status: "planned" }],
      tasks: [{ id: `secret-${id}`, columnId: `col-${id}`, title: `${owner} private ${id}`, note: "", completed: false }] });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      requests.push(`${method} ${url.pathname}`);
      let body = {}, status = 200;
      if (url.pathname === "/api/auth/me") body = { user };
      else if (url.pathname === "/api/user/snapshot") {
        const owner = user?.email || "guest";
        let cloud = clouds.get(owner) || { payload: {}, revision: 0, updatedAt: null };
        if (method === "PUT") { cloud = { payload: route.request().postDataJSON().payload, revision: cloud.revision + 1, updatedAt: new Date().toISOString() }; clouds.set(owner, cloud); }
        body = { ok: true, ...cloud };
      } else if (url.pathname === "/api/workspaces") body = {workspaces:[{id:"w",name:"Workspace",role:"owner",capabilities:{manageBoards:true}}]};
      else if (url.pathname === "/api/workspaces/w/boards") body = {boards:[board("a"),board("b")]};
      else if (url.pathname === "/api/workspaces/w/members") body = {members:[]};
      else if (/^\/api\/boards\/[ab]$/.test(url.pathname)) {
        body = user ? {board:board(url.pathname.at(-1))} : {error:"Please sign in first."}; status = user ? 200 : 401;
      } else if (/^\/api\/(?:tasks|boards)\//.test(url.pathname)) body = {ok:true};
      else if (url.pathname.includes("notifications")) body = {notifications:[]};
      const waiting = held.find(item => !item.claimed && item.method === method && item.path === url.pathname);
      if (waiting) {
        waiting.claimed = true;
        return new Promise(resolve => waiting.start({ reply: async (value = body, responseStatus = status) => {
          await json(route, value, responseStatus).catch(() => {}); resolve();
        } }));
      }
      return json(route, body, status);
    });
    await page.goto(`${base}/planner.html`, {waitUntil:"load"});
    await page.locator('[aria-label="Team board Alpha"]').waitFor({state:"attached"});
    return { page, requests, errors, board,
      hold(method, requestPath) { return new Promise(start => held.push({ method, path:requestPath, start, claimed:false })); },
      setUser(next) { user = next; },
      async select(name) { await page.locator(`[aria-label="Team board ${name}"]`).evaluate(node => node.click()); },
      async private(id, name = "Alice") { await page.waitForFunction(({id,name}) => document.querySelector(`[data-entry-id="secret-${id}"] .planner-card-title`)?.value === `${name} private ${id}`, {id,name}); },
      async flush() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); },
    };
  }

  await t.test("late success and failure cannot replace the last selected board", async () => {
    for (const status of [200,503]) {
      const f = await fixture(); const held = f.hold("GET","/api/boards/a");
      await f.select("Alpha"); const request = await held;
      await f.select("Beta"); await f.private("b");
      await request.reply(status===200?{board:f.board("a")}:{error:"Old Alpha failure"},status); await f.flush();
      assert.equal(await f.page.locator('[data-entry-id="secret-a"]').count(),0);
      assert.equal(await f.page.locator('[data-entry-id="secret-b"]').count(),1);
      assert.equal(await f.page.locator('.planner-team-status').isVisible(),false);
      assert.deepEqual(f.errors,[]);
    }
  });

  await t.test("late task mutation callbacks do not reload or show errors on a different board", async () => {
    const f=await fixture(); await f.select("Alpha"); await f.private("a");
    const held=f.hold("PATCH","/api/tasks/secret-a");
    await f.page.locator('[data-entry-id="secret-a"] .planner-card-title').evaluate(input=>{input.value="Pending edit";input.dispatchEvent(new Event("change",{bubbles:true}));});
    const request=await held;
    await f.select("Beta"); await f.private("b");
    const before=f.requests.filter(item=>item==='GET /api/boards/b').length;
    await request.reply({error:"Old mutation failed"},503); await f.flush();
    assert.equal(f.requests.filter(item=>item==='GET /api/boards/b').length,before);
    assert.equal(await f.page.locator('.planner-team-status').isVisible(),false);
    assert.equal(await f.page.locator('[data-entry-id="secret-b"]').count(),1);
    assert.deepEqual(f.errors,[]);
  });

  await t.test("a removed card's delayed change cannot patch a different selected board", async () => {
    const f=await fixture(); await f.select("Alpha"); await f.private("a");
    await f.page.evaluate(()=>{window.removedPlannerInput=document.querySelector('[data-entry-id="secret-a"] .planner-card-title');});
    await f.select("Beta"); await f.private("b");
    const before=f.requests.filter(item=>item.startsWith('PATCH /api/tasks/')).length;
    await f.page.evaluate(()=>{window.removedPlannerInput.value='Delayed blur';window.removedPlannerInput.dispatchEvent(new Event('change',{bubbles:true}));}); await f.flush();
    assert.equal(f.requests.filter(item=>item.startsWith('PATCH /api/tasks/')).length,before);
  });

  await t.test("sign-out clears private cards immediately and never requests the previous board again", async () => {
    const f=await fixture(); await f.select("Alpha"); await f.private("a");
    const before=f.requests.filter(item=>item==='GET /api/boards/a').length;
    f.setUser(null);
    const cleared=await f.page.evaluate(()=>{
      localStorage.removeItem('daily-space-auth-v1');window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));
      return !document.querySelector('[data-entry-id="secret-a"]');
    });
    assert.equal(cleared,true); await f.flush();
    assert.equal(f.requests.filter(item=>item==='GET /api/boards/a').length,before);
    assert.equal(await f.page.locator('[data-entry-id="secret-a"]').count(),0);
    assert.deepEqual(f.errors,[]);
  });

  await t.test("a previous identity's pending read cannot replace the new identity's board", async () => {
    const f=await fixture(); const held=f.hold('GET','/api/boards/a');
    await f.select('Alpha'); const request=await held;
    f.setUser({userId:'bob@example.com',email:'bob@example.com',provider:'Google',label:'Bob'});
    await f.page.evaluate(()=>{localStorage.setItem('daily-space-auth-v1',JSON.stringify({provider:'Google',email:'bob@example.com',label:'Bob'}));window.dispatchEvent(new CustomEvent('daily-space-auth-updated'));});
    await f.page.locator('[aria-label="Team board Beta"]').waitFor({state:'attached'}); await f.select('Beta'); await f.private('b','Bob');
    await request.reply({board:f.board('a','Alice')}); await f.flush();
    assert.equal(await f.page.locator('[data-entry-id="secret-a"]').count(),0);
    assert.equal(await f.page.locator('[data-entry-id="secret-b"] .planner-card-title').inputValue(),'Bob private b');
    assert.deepEqual(f.errors,[]);
  });

  await t.test("returning to the same personal board never stores shared cards in the personal ledger", async () => {
    const f=await fixture(); await f.select('Alpha'); await f.private('a');
    await f.page.locator('#planner-workspace-list .category-btn').first().evaluate(node=>node.click());
    assert.equal(await f.page.locator('[data-entry-id="secret-a"]').count(),0);
    assert.equal(await f.page.locator('[data-entry-id="personal-entry"]').count(),1);
    assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('planner-app-v1')).boards.personal.entries.some(entry=>entry.id==='secret-a')),false);
    await f.page.locator('#planner-workspace-list .category-btn').first().evaluate(node=>node.click());
    await f.page.locator('[data-entry-id="personal-entry"] .planner-card-title').evaluate(input=>{input.value='Still editable after selecting the active board';input.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('planner-app-v1')).boards.personal.entries[0].title),'Still editable after selecting the active board');
    await f.select('Alpha'); await f.private('a');
    await f.page.locator('#toggle-new-planner').evaluate(node=>node.click());
    await f.page.locator('#new-planner-name').fill('Another personal notebook');
    await f.page.locator('#save-planner').evaluate(node=>node.click());
    assert.equal(await f.page.locator('#planner-mode-badge').textContent(),'Personal');
    assert.equal(await f.page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('planner-app-v1')).boards).some(board=>board.entries.some(entry=>entry.id==='secret-a'))),false);
    await f.select('Alpha'); await f.private('a');
    f.page.once('dialog',dialog=>dialog.accept());
    await f.page.locator('[aria-label="Delete planner Another personal notebook"]').evaluate(node=>node.click());
    assert.equal(await f.page.locator('[data-entry-id="secret-a"]').count(),1);
    assert.equal(await f.page.evaluate(()=>JSON.parse(localStorage.getItem('planner-app-v1')).planners.length),1);
    assert.equal(await f.page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('planner-app-v1')).boards).some(board=>board.entries.some(entry=>entry.id==='secret-a'))),false);
    assert.deepEqual(f.errors,[]);
  });

  await t.test("a late Guest session check preserves a phone card deep link and its selected column", async () => {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    t.after(()=>context.close());
    const page=await context.newPage(); page.setDefaultTimeout(5000);
    await page.route('https://**/*',route=>route.abort());
    await page.addInitScript(()=>{
      localStorage.setItem('todo-app-v2',JSON.stringify({todos:[],categories:[]}));
      localStorage.setItem('planner-app-v1',JSON.stringify({version:2,selectedPlannerId:'personal',planners:[{id:'personal',name:'Personal notebook'}],boards:{personal:{columns:[{id:'hold',title:'On Hold',status:'hold',systemKey:'hold'}],entries:[{id:'hold-card',columnId:'hold',title:'Deep linked held card',note:'',completed:false,expanded:false,tags:[]}]}}}));
    });
    let release;
    const started=new Promise(resolve=>{
      page.route('**/api/auth/me',route=>new Promise(done=>{
        release=async()=>{await route.fulfill({contentType:'application/json',body:JSON.stringify({user:null})});done();};
        resolve();
      }));
    });
    await page.goto(`${base}/planner.html?focus=card&board=personal&id=hold-card`,{waitUntil:'load'});
    await started;
    await page.locator('[data-entry-id="hold-card"] .planner-card-title').waitFor({state:'visible'});
    await page.evaluate(()=>{window.linkedCardBeforeGuestCheck=document.querySelector('[data-entry-id="hold-card"]');});
    await release();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-entry-id="hold-card"] .planner-card-title').isVisible(),true);
    assert.match(await page.locator('.planner-status-chip.is-selected').textContent(),/Hold/);
    assert.equal(await page.evaluate(()=>window.linkedCardBeforeGuestCheck===document.querySelector('[data-entry-id="hold-card"]')),true,'Guest discovery must not rebuild the personal reading view');
  });
});
