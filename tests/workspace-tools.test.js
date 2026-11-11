const test=require('node:test');const assert=require('node:assert/strict');const Core=require('../workspace-tools-core');const Tally=require('../tally-core');
function storage(seed={}){const values=new Map(Object.entries(seed).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]));return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
const task=(id,text='Existing')=>({id,text,completed:false,dueDate:'2026-10-14',notes:'private note',subtasks:[{id:'s',text:'Prepare',completed:true}]});
test('templates keep relative dates and notes, and produce fresh unchecked subtasks',()=>{
 const template=Core.fromTasks([task('a'),{...task('b'),dueDate:'2026-10-16',categoryId:'work'}],[{id:'work',name:'Work'}],'Review');const first=Core.instantiate(template,'2026-12-31'),second=Core.instantiate(template,'2026-12-31');
 assert.equal(first[1].dueDate,'2027-01-02');assert.equal(first[1].categoryName,'Work');assert.equal(first[0].notes,'private note');assert.equal(first[0].subtasks[0].completed,false);assert.notEqual(first[0].subtasks[0].id,second[0].subtasks[0].id);assert.equal(first[0].repeat,null);
 assert.equal(Core.addDays('2028-02-28',1),'2028-02-29');assert.equal(Core.date('2026-02-30'),null);assert.throws(()=>Core.template({id:'a',name:'X',items:[{text:'X',offsetDays:400}]}),/offset/);
});
test('CSV supports BOM, escaped quotes and multiline notes; duplicate identical rows remain distinct',()=>{
 const source='\uFEFFtext,dueDate,dueTime,category,notes\r\n"Review, notes",2026-10-15,14:00,Work,"Line 1\nLine ""2"""\r\nTask,2026-10-15,,Work,Note\r\nTask,2026-10-15,,Work,Note';
 const store=storage({'todo-app-v2':{categories:[{id:'work',name:'Work'}],todos:[]}}),plan=Core.prepare(source,'todo',store);Core.apply(plan,store);const state=JSON.parse(store.getItem('todo-app-v2'));
 assert.equal(state.todos.length,3);assert.equal(state.todos[0].notes,'Line 1\nLine "2"');assert.equal(state.categories.length,1);assert.equal(state.todos[0].categoryId,'work');assert.notEqual(state.todos[1].id,state.todos[2].id);
 Core.apply(Core.prepare(source,'todo',store),store);assert.equal(JSON.parse(store.getItem('todo-app-v2')).todos.length,3);
 assert.throws(()=>Core.parseCsv('text,date\n"unfinished'),/Unclosed/);assert.throws(()=>Core.parseCsv('text,date\nA'),/columns/);
});
test('JSON merge keeps local edits and imports templates without restoring accounts or permissions',()=>{
 const store=storage({'todo-app-v2':{todos:[task('a','Local version')],categories:[]}});
 const file=JSON.stringify({payload:{'todo-app-v2':JSON.stringify({todos:[task('a','Old backup'),task('b','New record')],categories:[]}),'task-templates-v1':JSON.stringify({templates:[{id:'template',name:'Work',items:[{text:'Focus'}]}]}),'daily-space-auth-v1':JSON.stringify({email:'attacker@example.test'}),'travel-shared-v1':JSON.stringify({mappings:{a:'private'}})}});
 const plan=Core.prepare(file,'json',store);assert.equal(plan.ignored,2);Core.apply(plan,store);const state=JSON.parse(store.getItem('todo-app-v2'));
 assert.equal(state.todos[0].text,'Local version');assert.equal(state.todos.length,2);assert.equal(store.getItem('daily-space-auth-v1'),null);assert.equal(store.getItem('travel-shared-v1'),null);assert.equal(JSON.parse(store.getItem('task-templates-v1')).templates.length,1);
 Core.apply(Core.prepare(file,'json',store),store);assert.equal(JSON.parse(store.getItem('todo-app-v2')).todos.length,2);
});
test('preview changes nothing; a stale plan and a quota failure preserve device data',()=>{
 const store=storage({'todo-app-v2':{todos:[task('a')],categories:[]}});const original=store.getItem('todo-app-v2');const file=JSON.stringify({'todo-app-v2':{todos:[task('b')],categories:[]},'calendar-app-v1':{reminders:[{id:'r',text:'Reminder',date:'2026-10-14'}]}});
 const plan=Core.prepare(file,'json',store);assert.equal(store.getItem('todo-app-v2'),original);store.setItem('todo-app-v2',JSON.stringify({todos:[task('changed')],categories:[]}));assert.throws(()=>Core.apply(plan,store),/changed/);store.setItem('todo-app-v2',original);
 const failing={...store,setItem:(key,value)=>{if(key==='calendar-app-v1')throw new Error('Quota');store.setItem(key,value);}};assert.throws(()=>Core.apply(plan,failing),/Quota/);assert.equal(store.getItem('todo-app-v2'),original);assert.equal(store.getItem('calendar-app-v1'),null);
});
test('invalid dates, foreign rates, duplicate IDs and unsafe IDs reject the whole import',()=>{
 const store=storage(),before=Core.backup(store);
 for(const todos of [[{...task('a'),dueDate:'2026-02-30'}],[task('a'),task('a')],[task('__proto__')],[{...task('wrong-state'),completed:'false'}]])assert.throws(()=>Core.prepare(JSON.stringify({'todo-app-v2':{todos,categories:[]}}),'json',store));
 assert.throws(()=>Core.prepare('date,amount,currency,category,note\n2026-10-14,10,USD,Coffee,Note','tally',store),/exchange rate/);
 assert.throws(()=>Core.prepare('date,amount,currency,category\n2026-10-14,10,not-a-code,Coffee','tally',store),/currency/);
 assert.throws(()=>Core.prepare('date,amount,category\n2026-10-14,Infinity,Coffee','tally',store),/expense/);assert.deepEqual(Core.backup(store).payload,before.payload);
});
test('expense imports preserve trip links, amounts, FX and local participant identity',()=>{
 const store=storage({'tally-book-v1':{baseCurrency:'CNY',people:[{id:'local-self',name:'Me',isSelf:true}],selfPersonId:'local-self',records:[{id:'existing',date:'2026-10-14',amount:1,category:'Food'}]}});
 const file=JSON.stringify({'tally-book-v1':{baseCurrency:'CNY',people:[{id:'import-self',name:'Me',isSelf:true},{id:'friend',name:'Friend'}],selfPersonId:'import-self',records:[{id:'new',date:'2026-10-14',amount:20,currency:'USD',fxRate:7.1,category:'Hotel',scope:'shared',paidById:'import-self',splitAmongIds:['import-self','friend'],tripId:'tokyo',tripName:'Tokyo'}]}});
 Core.apply(Core.prepare(file,'json',store),store);const state=Tally.readState(store),record=state.records.find(record=>record.id==='new');assert.equal(Tally.baseAmount(record),142);assert.equal(record.tripId,'tokyo');assert.equal(record.paidById,'local-self');assert.deepEqual(record.splitAmongIds,['local-self','friend']);
 const mismatch=JSON.stringify({'tally-book-v1':{baseCurrency:'JPY',records:[]}});assert.throws(()=>Core.prepare(mismatch,'json',store),/different base/);
});
test('project and trip child records merge within an existing board or trip',()=>{
 const board={planners:[{id:'b',name:'Local project'}],selectedPlannerId:'b',boards:{b:{columns:[{id:'todo',title:'Planned'}],entries:[{id:'a',title:'Local card',columnId:'todo'}]}}};
 const trip={id:'trip',name:'Local trip',startDate:'2026-10-14',endDate:'2026-10-15',destination:'Tokyo',stops:[],reservations:[]};const store=storage({'planner-app-v1':board,'travel-book-v1':{trips:[trip],activeTripId:'trip'}});
 const file=JSON.stringify({'planner-app-v1':{...board,boards:{b:{...board.boards.b,entries:[{id:'a',title:'Old title',columnId:'todo'},{id:'b-card',title:'New card',columnId:'todo'}]}}},'travel-book-v1':{trips:[{...trip,name:'Old name',role:'owner',members:[{email:'secret'}],stops:[{id:'stop',title:'Park',day:1,lat:35,lng:139}]}]}});
 Core.apply(Core.prepare(file,'json',store),store);const project=JSON.parse(store.getItem('planner-app-v1'));assert.equal(project.boards.b.entries.length,2);assert.equal(project.boards.b.entries[0].title,'Local card');assert.equal(JSON.parse(store.getItem('travel-book-v1')).trips[0].stops.length,1);
 const fresh=storage();Core.apply(Core.prepare(file,'json',fresh),fresh);const imported=JSON.parse(fresh.getItem('travel-book-v1')).trips[0];assert.equal(imported.role,undefined);assert.equal(imported.members,undefined);
});
test('travel task links and source snapshots survive a JSON backup round trip',()=>{
 const trip={id:'trip',name:'Tokyo',startDate:'2026-11-01',endDate:'2026-11-03',linkedTodoId:'trip-task',stops:[],reservations:[]};
 const linked={...task('trip-task','Tokyo'),sourceTripId:'trip',sourceTripName:'Tokyo',sourceTripDate:'2026-11-01'};
 const source=storage({'todo-app-v2':{todos:[linked],categories:[]},'travel-book-v1':{trips:[trip]}}),target=storage();
 Core.apply(Core.prepare(JSON.stringify(Core.backup(source)),'json',target),target);
 const imported=JSON.parse(target.getItem('todo-app-v2')).todos[0];
 assert.equal(imported.sourceTripId,'trip');assert.equal(imported.sourceTripName,'Tokyo');assert.equal(imported.sourceTripDate,'2026-11-01');
 assert.equal(JSON.parse(target.getItem('travel-book-v1')).trips[0].linkedTodoId,imported.id);
});
test('the merged size limit includes non-imported cloud sections and device backups omit credentials',()=>{
 const store=storage({'teamwork-page-v1':'x'.repeat(1024*1024),'daily-space-auth-v1':'secret','daily-space-mail-accounts-v1':'private accounts'});
 assert.throws(()=>Core.prepare('text\nA','todo',store),/sync limit/);const exported=Core.backup(store);assert.equal(exported.payload['daily-space-auth-v1'],undefined);assert.equal(exported.payload['daily-space-mail-accounts-v1'],undefined);
});

test('own CSV exports round-trip formula-like text and apostrophes without changing IDs',()=>{
 const header=['id','date','amount','currency','category','note','_format'];const notes=['=SUM(1,2)',"'=literal",'-a note',"'a quote"];
 const csv=[header.map(Core.csvCell).join(','),...notes.map((note,index)=>[`-id-${index}`,'2026-10-14',10,'CNY','Food',note,'daily-space-csv-v1'].map(Core.csvCell).join(','))].join('\n');
 assert.ok(csv.includes("'-id-0"));const store=storage({'tally-book-v1':{baseCurrency:'CNY',records:[]}});Core.apply(Core.prepare(csv,'tally',store),store);
 const records=Tally.readState(store).records;assert.deepEqual(records.map(record=>record.note),notes);assert.equal(records[0].id,'-id-0');Core.apply(Core.prepare(csv,'tally',store),store);assert.equal(Tally.readState(store).records.length,4);
});

test('promoted trip totals include old personal links once and exclude unrelated expenses',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const store=storage({'travel-shared-v1':{mappings:{'local-trip':'server-trip'}}});const window={DailySpaceTallyCore:Tally,DailySpaceView:{owner:()=> 'guest'},addEventListener(){}};
 const context=vm.createContext({window,localStorage:store,document:{readyState:'loading',addEventListener(){}},URLSearchParams});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../trip-expenses.js'),'utf8'),context);
 const result=window.DailySpaceTripExpenses.stats({records:[{id:'old',tripId:'local-trip',amount:10,fxRate:7,category:'Hotel',date:'2026-10-14'},{id:'new',tripId:'shared:server-trip',amount:30,fxRate:1,category:'Food',date:'2026-10-15'},{id:'other',tripId:'other-trip',amount:200,fxRate:1,category:'Other',date:'2026-10-14'}]},'shared:server-trip');
 assert.equal(result.total,100);assert.equal(result.records.length,2);assert.equal(result.categories.length,2);assert.equal(result.days.length,2);
 const budget={amount:200,currency:'CNY'};assert.deepEqual(window.DailySpaceTripExpenses.budget({tripBudgets:{'local-trip':budget}},'shared:server-trip'),budget);
});

function largeLedger(){
 const records=Array.from({length:1001},(_,index)=>({id:`history-${index}`,date:'2026-11-11',amount:1,currency:'CNY',category:'Food',tripId:'tokyo',tripName:'Tokyo'}));
 Object.assign(records[0],{amount:2,currency:'USD',fxRate:7.5,scope:'shared',paidById:'backup-self',splitAmongIds:['backup-self','friend']});
 return Tally.normalizeState({baseCurrency:'CNY',selfPersonId:'backup-self',people:[{id:'backup-self',name:'Me',isSelf:true},{id:'friend',name:'Friend'}],records,
  settlements:Array.from({length:201},(_,index)=>({id:`settlement-${index}`,fromId:'backup-self',toId:'friend',amountBase:1})),
  tripBudgets:{tokyo:{amount:3000,currency:'CNY'},kyoto:{amount:400,currency:'USD'}}});
}

test('large ledger JSON backups restore all expenses, settlements, rates and trip budgets',()=>{
 const ledger=largeLedger(),source=storage({'tally-book-v1':ledger}),target=storage();
 const file=JSON.stringify(Core.backup(source));
 assert.ok(new TextEncoder().encode(file).length<1024*1024);
 const plan=Core.prepare(file,'json',target);
 assert.equal(plan.summary[0].added,1001);
 Core.apply(plan,target);
 const restored=Tally.readState(target);
 assert.deepEqual(restored.records,ledger.records);
 assert.deepEqual(restored.settlements,ledger.settlements);
 assert.deepEqual(restored.tripBudgets,ledger.tripBudgets);
 assert.deepEqual(Tally.computeBalances(restored),Tally.computeBalances(ledger));
 Core.apply(Core.prepare(file,'json',target),target);
 assert.equal(Tally.readState(target).records.length,1001);
 assert.equal(Tally.readState(target).settlements.length,201);
});

test('large ledger merges retain local history and remap settlement participant identity',()=>{
 const ledger=largeLedger();
 const target=storage({'tally-book-v1':{baseCurrency:'CNY',selfPersonId:'local-self',people:[{id:'local-self',name:'Me',isSelf:true},{id:'friend',name:'Local friend'}],
  records:[{id:'local-expense',date:'2026-11-10',amount:5,currency:'CNY',category:'Local'}],
  settlements:[{id:'local-settlement',fromId:'friend',toId:'local-self',amountBase:3}],tripBudgets:{tokyo:{amount:3500,currency:'CNY'}}}});
 const file=JSON.stringify({'tally-book-v1':ledger});
 Core.apply(Core.prepare(file,'json',target),target);
 const merged=Tally.readState(target);
 assert.equal(merged.records.length,1002);
 assert.equal(merged.records[0].id,'local-expense');
 assert.equal(merged.records.find(record=>record.id==='history-0').paidById,'local-self');
 assert.equal(merged.settlements.length,202);
 assert.equal(merged.settlements[0].id,'local-settlement');
 assert.ok(merged.settlements.slice(1).every(item=>item.fromId==='local-self'&&item.toId==='friend'));
 assert.deepEqual(merged.tripBudgets.tokyo,{amount:3500,currency:'CNY'});
 assert.deepEqual(merged.tripBudgets.kyoto,ledger.tripBudgets.kyoto);
 Core.apply(Core.prepare(file,'json',target),target);
 assert.equal(Tally.readState(target).records.length,1002);
 assert.equal(Tally.readState(target).settlements.length,202);
});

test('ledger CSV imports can exceed 1000 rows while task CSV keeps its existing bound',()=>{
 const csv=['id,date,amount,currency,category',...Array.from({length:1001},(_,index)=>`csv-${index},2026-11-11,2.50,CNY,Food`)].join('\n');
 const target=storage({'tally-book-v1':{baseCurrency:'CNY',records:[]}});
 Core.apply(Core.prepare(csv,'tally',target),target);
 assert.equal(Tally.readState(target).records.length,1001);
 assert.equal(Tally.readState(target).records.at(-1).id,'csv-1000');
 Core.apply(Core.prepare(csv,'tally',target),target);
 assert.equal(Tally.readState(target).records.length,1001);
 assert.throws(()=>Core.parseCsv(csv),/1000/);
 assert.throws(()=>Core.prepare(csv,'todo',storage()),/1000/);
});

test('large imports keep byte limits and reject invalid late records without writing',()=>{
 const ledger=largeLedger(),file=JSON.stringify({'tally-book-v1':ledger});
 const full=storage({'teamwork-page-v1':'x'.repeat(1024*1024)}),before=new Map(full.values);
 assert.throws(()=>Core.prepare(file,'json',full),/1 MB sync limit/);
 assert.deepEqual(full.values,before);
 const changedCapacity=storage(),plan=Core.prepare(file,'json',changedCapacity);
 changedCapacity.setItem('teamwork-page-v1','x'.repeat(1024*1024));
 assert.throws(()=>Core.apply(plan,changedCapacity),/1 MB sync limit/);
 assert.equal(changedCapacity.getItem('tally-book-v1'),null);
 assert.throws(()=>Core.prepare(file+' '.repeat(1024*1024),'json',storage()),/File is too large/);
 for(const corrupt of [value=>{value.records.at(-1).amount=-1;},value=>{value.records.at(-1).id=value.records[0].id;}]){
  const invalid=structuredClone(ledger);corrupt(invalid);const target=storage();
  assert.throws(()=>Core.prepare(JSON.stringify({'tally-book-v1':invalid}),'json',target));
  assert.equal(target.getItem('tally-book-v1'),null);
 }
});

test('settlement and trip budget history also prevent mismatched base currency imports',()=>{
 const incoming=JSON.stringify({'tally-book-v1':{baseCurrency:'USD',records:[]}});
 for(const history of [{settlements:[{id:'payment',fromId:'me',toId:'friend',amountBase:3}]},{tripBudgets:{trip:{amount:50,currency:'CNY'}}}]){
  const target=storage({'tally-book-v1':{baseCurrency:'CNY',records:[],...history}}),before=target.getItem('tally-book-v1');
  assert.throws(()=>Core.prepare(incoming,'json',target),/different base currencies/);
  assert.equal(target.getItem('tally-book-v1'),before);
 }
 const empty=storage({'tally-book-v1':{baseCurrency:'CNY',records:[]}});
 Core.apply(Core.prepare(incoming,'json',empty),empty);
 assert.equal(Tally.readState(empty).baseCurrency,'USD');
});
