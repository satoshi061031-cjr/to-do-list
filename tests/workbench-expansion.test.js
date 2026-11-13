const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../workspace-tools-core');
const Tally = require('../tally-core');
const Focus = require('../focus-core');
const History = require('../record-history-core');
const Sources = require('../agent-sources');
const { normalizeGlobalResult } = require('../server/global-agent');
const { sanitizeSnapshotPayload } = require('../server/user-snapshot-store');

function storage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return { getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key) };
}
const task = (id = 'task') => ({ id, text:'Plan the trip', completed:false, dueDate:'2026-11-13', priority:'high', inbox:true,
  todayPinDate:'2026-11-13',todayPinOrder:1,createdAt:1700000000000,completedAt:null,sourceUrl:'https://example.com/guide',notes:'Keep this note',subtasks:[] });

test('all personal workbench records survive a portable backup and idempotent merge', () => {
  const now = Date.now(), original = task();
  let history = History.capture({},'todo-app-v2',{todos:[{...original,text:'Before editing'}]},{todos:[original]},now-1000);
  const source=storage({
    'todo-app-v2':{todos:[original],categories:[]},
    'dayfly-task-views-v1':{views:[{id:'work',name:'Important work',priority:'high',mode:'inbox',dayMode:'all',filter:'active',source:'assigned'}]},
    'dayfly-notes-v1':{notes:[{id:'note',title:'Trip guide',body:'Bring passport',links:[{type:'todo',id:'task'}],createdAt:now,updatedAt:now}]},
    'dayfly-focus-v1':{sessions:[{id:'session',taskId:'task',taskTitle:'Plan the trip',startedAt:now-61000,endedAt:now-1000,durationMs:60000,targetMs:0}]},
    'dayfly-history-v1':history,
    'daily-space-workbench-v1':{phoneOverviewExpanded:true,bookmarks:[{id:'site',title:'Guide',url:'https://example.com',group:'Travel',tags:['guide']}],contexts:[]},
    'tally-book-v1':Tally.normalizeState({baseCurrency:'CNY',categoryBudgets:[{id:'food',month:'2026-11',category:'Food',amount:500,currency:'CNY'}],
      recurringBills:[{id:'rent',name:'Rent',amount:100,currency:'CNY',category:'Housing',nextDate:'2026-11-13',interval:'monthly',anchorDay:13,anchorMonth:11,enabled:true}]})
  });
  const target=storage(), backup=JSON.stringify(Core.backup(source));
  Core.apply(Core.prepare(backup,'json',target),target);
  const restored=JSON.parse(target.getItem('todo-app-v2')).todos[0];
  for(const key of ['priority','inbox','todayPinDate','todayPinOrder','createdAt','sourceUrl'])assert.equal(restored[key],original[key]);
  assert.equal(JSON.parse(target.getItem('dayfly-notes-v1')).notes[0].links[0].id,'task');
  assert.equal(JSON.parse(target.getItem('dayfly-focus-v1')).sessions[0].durationMs,60000);
  assert.equal(JSON.parse(target.getItem('dayfly-history-v1')).entries[0].value.text,'Before editing');
  const ledger=Tally.readState(target);assert.equal(ledger.categoryBudgets[0].amount,500);assert.equal(ledger.recurringBills[0].id,'rent');
  assert.equal(JSON.parse(target.getItem('daily-space-workbench-v1')).bookmarks[0].title,'Guide');
  assert.equal(JSON.parse(target.getItem('daily-space-workbench-v1')).phoneOverviewExpanded,true);
  assert.equal(JSON.parse(target.getItem('dayfly-task-views-v1')).views[0].source,'assigned');
  Core.apply(Core.prepare(backup,'json',target),target);
  for(const [key,field] of [['dayfly-task-views-v1','views'],['dayfly-notes-v1','notes'],['dayfly-focus-v1','sessions'],['dayfly-history-v1','entries']])assert.equal(JSON.parse(target.getItem(key))[field].length,1);
});

test('backup restores pause imported focus and preserve an existing device session', () => {
  const now=Date.now(), imported=Focus.start({},task('imported'),0,now-5000,'imported-session');
  const file=JSON.stringify({'dayfly-focus-v1':imported});
  const empty=storage();Core.apply(Core.prepare(file,'json',empty),empty);
  assert.equal(JSON.parse(empty.getItem(Focus.KEY)).active.resumedAt,null);
  assert.equal(JSON.parse(empty.getItem(Focus.KEY)).active.elapsedMs,0,'A backup does not charge unattended wall-clock time');
  const local=storage({[Focus.KEY]:Focus.start({},task('local'),0,now-1000,'local-session')});
  Core.apply(Core.prepare(file,'json',local),local);
  assert.equal(JSON.parse(local.getItem(Focus.KEY)).active.id,'local-session');
});

test('new stores are allowed in snapshots without weakening the private-key allowlist', () => {
  const payload=Object.fromEntries(['dayfly-task-views-v1','dayfly-focus-v1','dayfly-notes-v1','dayfly-history-v1'].map(key=>[key,'{}']));
  assert.deepEqual(sanitizeSnapshotPayload({...payload,'daily-space-auth-v1':'secret'}),payload);
});

test('Agent citations resolve only known records into encoded internal links', () => {
  const context={todo:{todos:[{id:'task &/?',text:'Plan'}]},notes:[{id:'private',title:'Selected note'}]};
  const normalized=normalizeGlobalResult({reply:'Read these',actions:[],sources:['todo:task','note:private','https://evil.example','note:missing','note:private']});
  const resolved=Sources.resolve(context,normalized.sources);
  assert.deepEqual(resolved,[{key:'note:private',label:'Selected note',href:'todo.html?focus=note&id=private'}]);
  assert.ok(Sources.references(context)[0].href.includes('task%20%26%2F%3F'));
  const encoded=normalizeGlobalResult({reply:'Plan',actions:[],sources:['todo:task &/?']});
  assert.equal(Sources.resolve(context,encoded.sources)[0].href,'todo.html?focus=todo&id=task%20%26%2F%3F');
  assert.deepEqual(Sources.resolve(context,['javascript:alert(1)','note:unselected']),[]);
});

test('completed task timestamps and recurring expense identities survive import', () => {
  const item={...task(),completed:true,completedAt:Date.now()-1000};
  const target=storage();Core.apply(Core.prepare(JSON.stringify({'todo-app-v2':{todos:[item],categories:[]}}),'json',target),target);
  assert.equal(JSON.parse(target.getItem('todo-app-v2')).todos[0].completedAt,item.completedAt);
  const ledger=storage({'tally-book-v1':{baseCurrency:'CNY'}});
  Core.apply(Core.prepare('id,date,amount,currency,category,recurringBillId,recurringDate\nbill-row,2026-11-13,100,CNY,Rent,rent,2026-11-13','tally',ledger),ledger);
  assert.equal(Tally.readState(ledger).records[0].recurringBillId,'rent');
  assert.equal(Tally.readState(ledger).records[0].recurringDate,'2026-11-13');
});

test('imports reject budget, bill and focus overflow without silently dropping records', () => {
  const bill=id=>({id,name:id,nextDate:'2026-11-13',interval:'monthly',amount:20,currency:'CNY'});
  const local=storage({'tally-book-v1':Tally.normalizeState({baseCurrency:'CNY',recurringBills:Array.from({length:100},(_,i)=>bill(`bill-${i}`))})});
  const original=local.getItem('tally-book-v1');
  assert.throws(()=>Core.prepare(JSON.stringify({'tally-book-v1':{baseCurrency:'CNY',recurringBills:[bill('extra')]}}),'json',local),/Too many budgets or bills/);
  assert.equal(local.getItem('tally-book-v1'),original);
  assert.throws(()=>Core.prepare(JSON.stringify({'tally-book-v1':{baseCurrency:'CNY',recurringBills:[{...bill('bad'),amount:-1}]}}),'json',storage()),/Invalid or duplicate budget or bill/);
  const now=Date.now(), session=i=>({id:`session-${i}`,taskId:'task',startedAt:now-(i+2)*2000,endedAt:now-(i+2)*2000+1000,durationMs:1000});
  const sessions=storage({[Focus.KEY]:{sessions:Array.from({length:200},(_,i)=>session(i))}});
  assert.throws(()=>Core.prepare(JSON.stringify({[Focus.KEY]:{sessions:[session(201)]}}),'json',sessions),/Too many focus sessions/);
  assert.equal(JSON.parse(sessions.getItem(Focus.KEY)).sessions.length,200);
});

test('imported views follow remapped categories regardless of JSON section order', () => {
  const target=storage({'todo-app-v2':{todos:[],categories:[{id:'local-food',name:'Food'}]}});
  const file=JSON.stringify({
    'dayfly-task-views-v1':{views:[{id:'food-view',name:'Food',categoryId:'imported-food',dayMode:'all'}]},
    'todo-app-v2':{todos:[{...task(),categoryId:'imported-food'}],categories:[{id:'imported-food',name:'Food'}]}
  });
  Core.apply(Core.prepare(file,'json',target),target);
  assert.equal(JSON.parse(target.getItem('dayfly-task-views-v1')).views[0].categoryId,'local-food');
  assert.equal(JSON.parse(target.getItem('todo-app-v2')).todos[0].categoryId,'local-food');
});

test('category budget merge keeps the existing semantic category without double-counting additions', () => {
  const budget=(id,amount)=>({id,month:'2026-11',category:'Food',amount,currency:'CNY'});
  const target=storage({'tally-book-v1':Tally.normalizeState({baseCurrency:'CNY',categoryBudgets:[budget('local',500)]})});
  const plan=Core.prepare(JSON.stringify({'tally-book-v1':{baseCurrency:'CNY',categoryBudgets:[budget('imported',999)]}}),'json',target);
  assert.equal(plan.summary[0].added,0);assert.equal(plan.summary[0].skipped,1);
  Core.apply(plan,target);assert.equal(Tally.readState(target).categoryBudgets[0].amount,500);
});

test('Account data exports restore the materialized local personal records and ignore credentials', () => {
  const now=Date.now(), target=storage();
  const file=JSON.stringify({source:'daily-space',local:{
    'dayfly-notes-v1':JSON.stringify({notes:[{id:'local',title:'Device note',body:'Keep pending edits',createdAt:now,updatedAt:now}]}),
    'daily-space-mail-accounts-v1':'private connection metadata'
  },cloud:{'dayfly-notes-v1':JSON.stringify({notes:[{id:'cloud',title:'Older cloud note',body:'Old'}]})}});
  const plan=Core.prepare(file,'json',target);Core.apply(plan,target);
  assert.equal(JSON.parse(target.getItem('dayfly-notes-v1')).notes[0].id,'local');
  assert.equal(target.getItem('daily-space-mail-accounts-v1'),null);
  assert.equal(plan.ignored,1);
});

test('merging backups cannot silently create more than three daily priorities', () => {
  const local=storage({'todo-app-v2':{todos:[task('one'),task('two')],categories:[]}});
  const before=local.getItem('todo-app-v2');
  const file=JSON.stringify({'todo-app-v2':{todos:[task('three'),task('four')],categories:[]}});
  assert.throws(()=>Core.prepare(file,'json',local),/exceed Today Top 3/);
  assert.equal(local.getItem('todo-app-v2'),before);
});
