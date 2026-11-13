const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function client(seedValues) {
  const values = seedValues || new Map([["daily-space-auth-v1", JSON.stringify({
    provider: "Google", label: "Alice", email: "alice@example.com",
  })], ["daily-space-workspace-owner-v1", JSON.stringify({ owner: "alice@example.com" })]]);
  const requests = [], exports = [];
  const events = [], timers = new Map();
  let timerId = 0;
  let cloud = { revision: 1, payload: { "todo-app-v2": "original" }, updatedAt: "first" };
  const window = { dispatchEvent(event) { events.push(event); }, location: { reload() {} }, setInterval: () => 1, clearInterval() {} };
  const context = vm.createContext({
    window, navigator: { onLine: true }, Blob, AbortController,
    URL: { createObjectURL: blob => { exports.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    document: { readyState: "loading", hidden: false, documentElement: { dataset: {} }, body: {appendChild() {}}, createElement: () => ({click() {},remove() {}}),
      getElementById: () => null, querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    fetch: async (_, options) => {
      requests.push(options);
      if (options.method === "GET") return { ok: true, json: async () => structuredClone(cloud) };
      const body = JSON.parse(options.body);
      if (body.baseRevision !== cloud.revision) {
        return { ok: false, status: 409, json: async () => ({ code: "SNAPSHOT_CONFLICT", error: "Conflict" }) };
      }
      cloud = { revision: cloud.revision + 1, payload: body.payload, updatedAt: "next" };
      return { ok: true, json: async () => ({ ok: true, ...structuredClone(cloud) }) };
    },
  });
  // Expose the real controller functions only in this VM; production globals stay unchanged.
  const source = fs.readFileSync(path.resolve(__dirname, "../theme.js"), "utf8").replace(
    "\n  applyTheme(storedTheme());\n\n  if (document.readyState",
    `\n  window.sync = { load: loadSnapshotForCurrentUser, tick: userSnapshotTick,
      flush: flushUserSnapshotOnPageHide, keepLocal: keepLocalSnapshotOverCloud,
      useCloud: applyCloudSnapshotPreferringRemote,
      refresh: refreshUserSnapshotSession,
      stop: stopUserSnapshotSync,
      download: downloadUserDataExport,
      state: () => ({ status: userSnapshotStatus, revision: userSnapshotRevision,
        owner: readWorkspaceOwner(), recovery: Boolean(readSnapshotRecovery()) }) };
    applyTheme(storedTheme());\n\n  if (document.readyState`
  );
  vm.runInContext(source, context);
  return { sync: window.sync, values, requests, context, events, timers, exports,
    changeCloud: payload => { cloud = { ...cloud, payload, revision: cloud.revision + 1 }; } };
}

test("client keeps local edits when another device advances the cloud revision", async () => {
  const c = client();
  await c.sync.load();
  c.values.set("todo-app-v2", "local edits");
  c.changeCloud({ "todo-app-v2": "other device" });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "local edits");
  const count = c.requests.length;
  await c.sync.tick(); c.sync.flush();
  assert.equal(c.requests.length, count, "conflicts stop automatic writes");
  await c.sync.keepLocal();
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.sync.state().revision, 3);
  assert.equal(JSON.parse(c.requests.at(-1).body).baseRevision, 2);
});

test("cloud selection applies current data and the next edit uses its revision", async () => {
  const c = client();
  await c.sync.load();
  c.changeCloud({ "todo-app-v2": "remote" });
  await c.sync.useCloud();
  assert.equal(c.values.get("todo-app-v2"), "remote");
  c.values.set("todo-app-v2", "next edit");
  await c.sync.tick();
  assert.equal(JSON.parse(c.requests.at(-1).body).baseRevision, 2);
  assert.equal(c.sync.state().revision, 3);
});

test("page-hide writes detect conflict and unknown revisions never write", async () => {
  const c = client();
  c.values.set("todo-app-v2", "offline");
  c.sync.flush();
  assert.equal(c.requests.length, 0);
  await c.sync.load();
  c.values.set("todo-app-v2", "local");
  c.changeCloud({ "todo-app-v2": "remote" });
  c.sync.flush(); c.sync.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.requests.filter(r => r.method === "PUT").length, 1);
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "local");
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test("idle desktop pulls phone updates and removes deleted domains without reloading", async () => {
  const c = client();
  await c.sync.load();
  c.changeCloud({ "calendar-app-v1": "phone calendar" });
  await c.sync.tick();
  assert.equal(c.values.get("todo-app-v2"), undefined);
  assert.equal(c.values.get("calendar-app-v1"), "phone calendar");
  assert.equal(c.sync.state().status, "ok");
  const update = c.events.findLast(event => event.type === "daily-space-agent-data-updated");
  assert.ok(update.detail.domains.includes("todo") && update.detail.domains.includes("calendar"));
});

test("cloud updates wait for an active editor and never overwrite edits during a slow read", async () => {
  const c = client(); await c.sync.load();
  c.context.document.activeElement = { matches: () => true, value: "Unfinished draft" };
  c.changeCloud({ "todo-app-v2": "phone" });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "remote-pending");
  assert.equal(c.values.get("todo-app-v2"), "original");
  c.context.document.activeElement = null;
  await c.sync.tick();
  assert.equal(c.values.get("todo-app-v2"), "phone");
  let release;
  c.context.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = c.sync.tick();
  c.values.set("todo-app-v2", "typed while loading");
  release({ ok: true, json: async () => ({ revision: 3, updatedAt: "latest", payload: { "todo-app-v2": "new phone edit" } }) });
  await pending;
  assert.equal(c.sync.state().status, "conflict");
  assert.equal(c.values.get("todo-app-v2"), "typed while loading");
});

test("local-only offline edits upload on reload and changes during a write remain pending", async () => {
  const c = client(); await c.sync.load();
  c.values.set("todo-app-v2", "offline edit");
  await c.sync.load();
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.values.get("todo-app-v2"), "offline edit");
  const fetch = c.context.fetch;
  let release;
  c.context.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (options.method === "PUT") await new Promise(resolve => { release = resolve; });
    return response;
  };
  c.values.set("todo-app-v2", "submitted edit");
  const pending = c.sync.tick(); await settle();
  c.values.set("todo-app-v2", "later edit"); release(); await pending;
  assert.equal(c.values.get("todo-app-v2"), "later edit");
  c.context.fetch = fetch;
  await c.sync.tick();
  assert.equal(JSON.parse(c.requests.at(-1).body).payload["todo-app-v2"], "later edit");
});

test("expired sessions stop automatic writes, preserve local data and recover after reauthentication", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  c.values.set("todo-app-v2", "private unsynced edit");
  c.context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Please sign in first." }) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "auth-required");
  assert.equal(c.timers.size, 0);
  assert.equal(c.values.get("todo-app-v2"), "private unsynced edit");
  assert.ok(c.values.has("daily-space-auth-v1"));
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "auth-required");
  await c.sync.refresh(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(JSON.parse(c.requests.at(-1).body).payload["todo-app-v2"], "private unsynced edit");
});

test("temporary failures back off and a lost write acknowledgment reconciles without conflict", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  c.context.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "unavailable");
  assert.equal([...c.timers.values()][0].delay, 5000);
  await c.sync.tick(true);
  assert.equal([...c.timers.values()][0].delay, 10000);
  c.context.fetch = fetch;
  const retry = [...c.timers.entries()].find(([,timer])=>timer.delay===10000);
  c.timers.delete(retry[0]); retry[1].fn(); await settle();
  assert.equal(c.sync.state().status,"ok","Scheduled retries resume without a manual click");
  c.context.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (options.method === "PUT") throw new TypeError("Connection dropped after commit");
    return response;
  };
  c.values.set("todo-app-v2", "saved despite lost reply");
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "error");
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.timers.size, 0);
  assert.equal(c.values.get("todo-app-v2"), "saved despite lost reply");
});

test("bounded requests time out even when fetch ignores abort and ignore their late replies", async () => {
  const c = client(); await c.sync.load();
  const fetch = c.context.fetch;
  let release;
  c.context.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = c.sync.tick();
  const deadline = [...c.timers.entries()].find(([, timer]) => timer.delay === 20000);
  c.timers.delete(deadline[0]); deadline[1].fn(); await pending;
  assert.equal(c.sync.state().status, "timeout");
  release({ ok: true, json: async () => ({ revision: 99, updatedAt: "late", payload: { "todo-app-v2": "late data" } }) });
  await settle();
  assert.equal(c.values.get("todo-app-v2"), "original");
  c.context.fetch = fetch;
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "ok");
  assert.equal(c.sync.state().revision, 1);
});

test("account generations ignore late success and errors even after switching away and back", async () => {
  for (const success of [true, false]) {
    const c = client(); await c.sync.load();
    const fetch = c.context.fetch;
    let release;
    c.context.fetch = () => new Promise(resolve => { release = resolve; });
    const pending = c.sync.tick();
    c.values.set("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Bob", email: "bob@example.com" }));
    c.context.fetch = fetch; await c.sync.refresh(true);
    c.values.set("daily-space-auth-v1", JSON.stringify({ provider: "Google", label: "Alice", email: "alice@example.com" }));
    await c.sync.refresh(true);
    release({ ok: success, status: success ? 200 : 401, json: async () => ({ revision: 99, updatedAt: "late", payload: { "todo-app-v2": "wrong account response" } }) });
    await pending; await settle();
    assert.equal(c.values.get("todo-app-v2"), "original");
    assert.equal(c.sync.state().status, "ok");
    assert.equal(c.sync.state().revision, 1);
  }
});

test("invalid successful responses are rejected and an oversized local snapshot never uploads", async () => {
  const c = client(); await c.sync.load();
  c.context.fetch = async () => ({ ok: true, json: async () => ({}) });
  await c.sync.tick();
  assert.equal(c.sync.state().status, "unavailable");
  c.values.set("todo-app-v2", "x".repeat(1024 * 1024));
  await c.sync.tick(true);
  assert.equal(c.sync.state().status, "too-large");
  assert.equal(c.timers.size, 0);
  assert.ok(c.values.get("todo-app-v2").length >= 1024 * 1024);
});

test("an empty second account clears the first account's data before any automatic upload", async () => {
  const c=client(); await c.sync.load();
  c.values.set('todo-app-v2','Alice private pending edit');
  c.values.set('daily-space-auth-v1',JSON.stringify({provider:'Google',label:'Bob',email:'bob@example.com'}));
  let puts=0;
  c.context.fetch=async (_, options)=>{
    if(options.method==='PUT') puts++;
    return {ok:true,json:async()=>({revision:0,payload:{},updatedAt:null,userId:'bob@example.com'})};
  };
  await c.sync.refresh(true); await c.sync.tick();
  assert.equal(c.values.get('todo-app-v2'),undefined);
  assert.equal(puts,0);
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:alice@example.com'))['todo-app-v2'],'Alice private pending edit');
});

function useAccount(c, email) {
  c.values.set('daily-space-auth-v1', JSON.stringify({provider:'Google',label:email,email}));
}

for (const failure of ['503','401','offline']) {
  test(`failed account switch (${failure}) never caches or flushes the old owner's workspace under the new account`, async()=>{
    const c=client();await c.sync.load();c.values.set('todo-app-v2','Alice private pending work');
    useAccount(c,'bob@example.com');
    if(failure==='offline') c.context.navigator.onLine=false;
    else c.context.fetch=async()=>({ok:false,status:Number(failure),json:async()=>({error:'Failed'})});
    await c.sync.refresh(true);c.sync.flush();
    assert.equal(c.values.get('daily-space-user-cache-v1:bob@example.com'),undefined);
    assert.equal(c.sync.state().owner,'alice@example.com');
    assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:alice@example.com'))['todo-app-v2'],'Alice private pending work');
    // A new tab/reload must still know the data belongs to Alice, not the auth UI.
    const reloaded=client(c.values);let uploaded=[];
    reloaded.context.fetch=async(_,options)=>{
      if(options.method==='PUT')uploaded.push(JSON.parse(options.body).payload);
      return {ok:true,json:async()=>({userId:'bob@example.com',revision:0,payload:{},updatedAt:null})};
    };
    await reloaded.sync.refresh(true);
    assert.deepEqual(uploaded,[]);
    assert.equal(reloaded.values.get('todo-app-v2'),undefined);
    assert.equal(reloaded.sync.state().owner,'bob@example.com');
  });
}

test('stale tabs cache the durable workspace owner rather than the account they last loaded', async()=>{
  const c=client();await c.sync.load();
  // Another tab has materialized Bob while this tab still has old in-memory state.
  c.values.set('daily-space-workspace-owner-v1',JSON.stringify({owner:'bob@example.com'}));
  c.values.set('todo-app-v2','Bob current workspace'); useAccount(c,'bob@example.com');
  c.context.navigator.onLine=false; await c.sync.refresh(true); c.sync.flush();
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:bob@example.com'))['todo-app-v2'],'Bob current workspace');
  assert.notEqual(JSON.parse(c.values.get('daily-space-user-cache-v1:alice@example.com'))['todo-app-v2'],'Bob current workspace');
});

function guestClient(text='Guest unsynced work') {
  return client(new Map([
    ['daily-space-auth-v1',JSON.stringify({provider:'Google',label:'Alice',email:'alice@example.com'})],
    ['daily-space-workspace-owner-v1',JSON.stringify({owner:''})],
    ['todo-app-v2',text],
  ]));
}

test('first Guest sign-in preserves work, asks for a version, and restores the Guest backup after logout', async()=>{
  const c=guestClient();await c.sync.load();
  assert.equal(c.sync.state().status,'conflict');
  assert.equal(c.sync.state().owner,'');
  assert.equal(c.values.get('todo-app-v2'),'Guest unsynced work');
  assert.equal(c.requests.filter(request=>request.method==='PUT').length,0);
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:__guest__'))['todo-app-v2'],'Guest unsynced work');
  const reloaded=client(c.values);await reloaded.sync.refresh(true);
  assert.equal(reloaded.sync.state().status,'conflict');
  await reloaded.sync.useCloud();
  assert.equal(reloaded.values.get('todo-app-v2'),'original');
  reloaded.values.delete('daily-space-auth-v1');await reloaded.sync.refresh(true);reloaded.sync.stop();
  assert.equal(reloaded.values.get('todo-app-v2'),'Guest unsynced work');
  assert.equal(reloaded.sync.state().owner,'');
});

test('explicitly keeping Guest work uploads only after the choice and retains later offline edits on a failed write', async()=>{
  const c=guestClient();await c.sync.load();
  const fetch=c.context.fetch;
  c.context.fetch=async(url,options)=> options.method==='PUT'
    ? {ok:false,status:503,json:async()=>({error:'Temporarily unavailable'})} : fetch(url,options);
  c.values.set('todo-app-v2','Guest edited after conflict');
  await assert.rejects(c.sync.keepLocal());
  assert.equal(c.sync.state().owner,'alice@example.com');
  assert.equal(c.values.get('todo-app-v2'),'Guest edited after conflict');
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:__guest__'))['todo-app-v2'],'Guest edited after conflict');
  c.context.fetch=fetch;await c.sync.tick(true);
  assert.equal(c.sync.state().status,'ok');
  assert.equal(JSON.parse(c.requests.at(-1).body).payload['todo-app-v2'],'Guest edited after conflict');
});

test('Guest edits made while cloud data loads participate in the version choice and backup', async()=>{
  const c=guestClient();let release;
  c.context.fetch=()=>new Promise(resolve=>{release=resolve;});
  const pending=c.sync.tick();c.values.set('todo-app-v2','Guest latest edit during read');
  release({ok:true,json:async()=>({revision:1,updatedAt:'cloud',payload:{'todo-app-v2':'Cloud work'}})});
  await pending;
  assert.equal(c.sync.state().status,'conflict');
  assert.equal(c.values.get('todo-app-v2'),'Guest latest edit during read');
  assert.equal(JSON.parse(c.values.get('daily-space-user-cache-v1:__guest__'))['todo-app-v2'],'Guest latest edit during read');
});

test('a failed Guest backup leaves the current workspace untouched and does not start a cloud request',async()=>{
  const c=guestClient();const setItem=c.context.localStorage.setItem;
  c.context.localStorage.setItem=(key,value)=>{if(key==='daily-space-user-cache-v1:__guest__')throw new Error('QuotaExceededError');setItem(key,value);};
  await c.sync.tick();
  assert.equal(c.sync.state().status,'storage-error');
  assert.equal(c.values.get('todo-app-v2'),'Guest unsynced work');
  assert.equal(c.requests.length,0);
});

test('failed cloud application never advances its baseline or uploads stale data and explicit retry recovers',async()=>{
  const c=client();await c.sync.load();
  const baseline=c.values.get('daily-space-user-baseline-v1:alice@example.com');
  c.changeCloud({'todo-app-v2':'Phone new task'});
  const setItem=c.context.localStorage.setItem;
  c.context.localStorage.setItem=(key,value)=>{if(key==='todo-app-v2')throw new Error('QuotaExceededError');setItem(key,value);};
  await c.sync.tick();
  assert.equal(c.sync.state().status,'storage-error');
  assert.equal(c.values.get('daily-space-user-baseline-v1:alice@example.com'),baseline);
  assert.equal(c.values.get('todo-app-v2'),'original');
  const puts=c.requests.filter(request=>request.method==='PUT').length;
  c.sync.flush();await c.sync.tick();await assert.rejects(c.sync.keepLocal(),{code:'SYNC_STORAGE'});
  assert.equal(c.requests.filter(request=>request.method==='PUT').length,puts);
  c.context.localStorage.setItem=setItem;await c.sync.tick(true);
  assert.equal(c.sync.state().status,'ok');assert.equal(c.values.get('todo-app-v2'),'Phone new task');
  assert.equal(c.requests.filter(request=>request.method==='PUT').length,puts);
});

test('a partially applied snapshot survives reload as a recovery copy and can never be uploaded as local edits',async()=>{
  const c=client();await c.sync.load();
  c.changeCloud({'todo-app-v2':'new phone tasks','tally-book-v1':'new phone expenses'});
  const setItem=c.context.localStorage.setItem;let partial=false;
  c.context.localStorage.setItem=(key,value)=>{
    if(key==='tally-book-v1'){partial=true;throw new Error('QuotaExceededError');}
    if(partial && key==='todo-app-v2')throw new Error('Rollback also blocked');
    setItem(key,value);
  };
  await c.sync.tick();
  assert.equal(c.sync.state().status,'storage-error');assert.equal(c.sync.state().recovery,true);
  assert.equal(c.values.get('todo-app-v2'),'new phone tasks');
  const c2=client(c.values);let puts=0;
  c2.context.fetch=async(_,options)=>{if(options.method==='PUT')puts++;return{ok:true,json:async()=>({revision:2,payload:{'todo-app-v2':'new phone tasks','tally-book-v1':'new phone expenses'},updatedAt:'cloud'})};};
  c2.sync.flush();await c2.sync.tick(true);
  assert.equal(c2.sync.state().status,'ok');assert.equal(c2.sync.state().recovery,false);
  assert.equal(c2.values.get('tally-book-v1'),'new phone expenses');assert.equal(puts,0);
});

test('empty normalized Guest app shells do not force a needless version choice',async()=>{
  const c=guestClient(JSON.stringify({categories:[],todos:[]}));
  c.values.set('tally-book-v1',JSON.stringify({version:2,budget:1000,baseCurrency:'JPY',people:[{id:'self',name:'Me'}],records:[]}));
  c.values.set('planner-app-v1',JSON.stringify({version:2,planners:[{id:'default',name:'My board'}],boards:{default:{columns:[{id:'planned'}],entries:[]}}}));
  await c.sync.load();
  assert.equal(c.sync.state().status,'ok');assert.equal(c.values.get('todo-app-v2'),'original');
  assert.equal(c.sync.state().owner,'alice@example.com');
  assert.ok(c.values.has('daily-space-user-cache-v1:__guest__'));
});

test('exports label Guest conflict work separately and never leak a previous signed-in workspace',async()=>{
  const guest=guestClient();await guest.sync.load();await guest.sync.download();
  const first=JSON.parse(await guest.exports[0].text());
  assert.equal(first.guest.owner,'guest');assert.equal(first.guest.payload['todo-app-v2'],'Guest unsynced work');
  assert.equal(first.local['todo-app-v2'],undefined);
  const c=client();await c.sync.load();c.values.set('todo-app-v2','Alice secret after initial sync');useAccount(c,'bob@example.com');
  c.context.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Unavailable'})});await c.sync.refresh(true);
  await c.sync.download();const second=JSON.parse(await c.exports[0].text());
  assert.equal(second.local['todo-app-v2'],undefined);assert.equal(second.guest,undefined);
  assert.equal(JSON.stringify(second).includes('Alice secret'),false);
  assert.equal(c.context.document.documentElement.dataset.workspaceLocked,'true');
});

test('workbench settings sync remotely, emit their domain and retain local settings until divergent changes are resolved', async () => {
  const c = client(); await c.sync.load();
  const key = 'daily-space-workbench-v1';
  c.changeCloud({ 'todo-app-v2': 'original', [key]: JSON.stringify({ name: 'From the other device' }) });
  await c.sync.tick();
  assert.equal(JSON.parse(c.values.get(key)).name, 'From the other device');
  const update = c.events.findLast(event => event.type === 'daily-space-agent-data-updated');
  assert.ok(update.detail.domains.includes('workbench')); assert.equal(update.detail.source, 'cloud-sync');
  c.values.set(key, JSON.stringify({ name: 'Local edited desk' }));
  c.changeCloud({ 'todo-app-v2': 'original', [key]: JSON.stringify({ name: 'Remote edited desk' }) });
  await c.sync.tick(); assert.equal(c.sync.state().status, 'conflict');
  assert.equal(JSON.parse(c.values.get(key)).name, 'Local edited desk');
});

test('Guest-only workbench choices participate in the cloud version choice and survive signout', async () => {
  const c = guestClient(), key = 'daily-space-workbench-v1';
  c.values.delete('todo-app-v2'); c.values.set(key, JSON.stringify({ name: 'Guest desk', shortcuts: ['travel'] }));
  await c.sync.load(); assert.equal(c.sync.state().status, 'conflict');
  assert.equal(c.sync.state().owner, ''); assert.equal(c.requests.filter(request => request.method === 'PUT').length, 0);
  const cached = JSON.parse(c.values.get('daily-space-user-cache-v1:__guest__'));
  assert.equal(JSON.parse(cached[key]).name, 'Guest desk');
  await c.sync.useCloud(); assert.equal(c.values.get(key), undefined);
  c.values.delete('daily-space-auth-v1'); await c.sync.refresh(true); c.sync.stop();
  assert.equal(JSON.parse(c.values.get(key)).name, 'Guest desk');
});

test('adding personal workspace keys upgrades old baselines without manufacturing a cloud conflict', async () => {
  const c = client(); await c.sync.load();
  const baselineKey = 'daily-space-user-baseline-v1:alice@example.com';
  const signature = c.values.get(baselineKey);
  const addedKeys = ['daily-space-workbench-v1','dayfly-task-views-v1','dayfly-focus-v1','dayfly-notes-v1','dayfly-history-v1'];
  const suffix = addedKeys.map(key => `|${key}:0:`).join('');
  assert.ok(signature.endsWith(suffix));
  c.values.set(baselineKey, signature.slice(0, -suffix.length));
  c.values.set('todo-app-v2', 'A local edit pending across the application upgrade');
  await c.sync.tick();
  assert.equal(c.sync.state().status, 'ok');
  assert.equal(JSON.parse(c.requests.at(-1).body).payload['todo-app-v2'], 'A local edit pending across the application upgrade');
});

test('personal view, focus, note and history stores sync and clear together on signout', async () => {
  const c=client();await c.sync.load();
  const payload={
    'todo-app-v2':'original',
    'dayfly-task-views-v1':JSON.stringify({views:[{id:'view',name:'My work'}]}),
    'dayfly-focus-v1':JSON.stringify({sessions:[{id:'session'}]}),
    'dayfly-notes-v1':JSON.stringify({notes:[{id:'note',title:'Private'}]}),
    'dayfly-history-v1':JSON.stringify({entries:[{id:'version'}]})
  };
  c.changeCloud(payload);await c.sync.tick();
  for(const [key,value] of Object.entries(payload))assert.equal(c.values.get(key),value);
  const domains=c.events.findLast(event=>event.type==='daily-space-agent-data-updated').detail.domains;
  for(const domain of ['task-views','focus','notes','history'])assert.ok(domains.includes(domain));
  c.values.delete('daily-space-auth-v1');await c.sync.refresh(true);c.sync.stop();
  for(const key of Object.keys(payload).filter(key=>key.startsWith('dayfly-')))assert.equal(c.values.get(key),undefined);
  const cached=JSON.parse(c.values.get('daily-space-user-cache-v1:alice@example.com'));
  assert.equal(cached['dayfly-notes-v1'],payload['dayfly-notes-v1']);
});
