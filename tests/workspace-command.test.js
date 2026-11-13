const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function create(){
 const values=new Map(),session=new Map();let currentOwner='guest',isReady=true,bookmarks=[],chinese=false;
 const storage=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)});
 const window={DailySpaceView:{owner:()=>currentOwner},DailySpaceI18n:{t:(en,zh)=>chinese?zh:en},DailySpaceWorkbenchPreferences:{ready:()=>isReady,searchBookmarks:()=>bookmarks}};
 const context=vm.createContext({window,localStorage:storage(values),sessionStorage:storage(session),URLSearchParams,URL,document:{documentElement:{dataset:{}}}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../workspace-search.js'),'utf8'),context);
 return{api:window.DailySpaceSearch,values,session,setOwner:value=>currentOwner=value,setReady:value=>isReady=value,setBookmarks:value=>bookmarks=value,setChinese:value=>chinese=value};
}
test('search groups existing exact record routes, public pages and explicit entry actions',()=>{
 const c=create();c.values.set('todo-app-v2',JSON.stringify({todos:[{id:'a &/?',text:'Book Kyoto',completed:false}]}));
 c.values.set('dayfly-notes-v1',JSON.stringify({notes:[{id:'note',title:'Kyoto guide',body:'Garden'}]}));
 const records=c.api.search('Kyoto',20);assert.equal(records.length,2);assert.ok(records.every(item=>item.group==='records'));
 assert.equal(records[0].href,'todo.html?focus=todo&id=a%20%26%2F%3F');
 const action=c.api.search('add expense',20)[0];assert.equal(action.kind,'action');assert.equal(action.group,'actions');assert.equal(action.command,'add-expense');
 assert.equal(c.api.search('Calendar',20)[0].group,'pages');
 assert.equal(c.api.actions().length,6);
 assert.equal(c.values.get('tally-book-v1'),undefined,'Searching an entry action never records an expense');
});
test('recent commands store identities only, resolve current titles and prune deleted records',()=>{
 const c=create();c.values.set('todo-app-v2',JSON.stringify({todos:[{id:'private',text:'Private title',completed:false}]}));
 assert.equal(c.api.remember(c.api.search('Private title')[0]),true);
 const stored=[...c.session.values()][0];assert.ok(!stored.includes('Private title'));assert.ok(stored.includes('todo:private'));
 c.values.set('todo-app-v2',JSON.stringify({todos:[{id:'private',text:'Renamed title',completed:false}]}));assert.equal(c.api.recent()[0].label,'Renamed title');
 c.values.set('todo-app-v2',JSON.stringify({todos:[]}));assert.equal(c.api.recent().length,0);
 assert.equal(c.api.remember({id:'invented',href:'javascript:alert(1)'}),false);
});
test('recent titles and actions remain isolated across owner and workspace transitions',()=>{
 const c=create();c.values.set('todo-app-v2',JSON.stringify({todos:[{id:'alice',text:'Alice private',completed:false}]}));
 c.setOwner('alice@example.com');c.api.remember(c.api.search('Alice private')[0]);assert.equal(c.api.recent().length,1);
 c.setOwner('bob@example.com');assert.equal(c.api.recent().length,0);
 c.setReady(false);assert.equal(c.api.search('Alice private').length,0);assert.equal(c.api.actions().length,0);assert.equal(c.api.collectEntries().length,0);assert.equal(c.api.remember('jump-today'),false);
 assert.ok(c.api.search('Calendar').length,'Public page names do not expose private record titles');
 c.setOwner('alice@example.com');c.setReady(true);assert.equal(c.api.recent()[0].label,'Alice private');
});
test('page and action labels follow the current language without translating private titles',()=>{
 const c=create();c.setChinese(true);assert.equal(c.api.search('日历')[0].label,'日历');assert.equal(c.api.search('新建任务')[0].label,'新建任务');
 c.values.set('todo-app-v2',JSON.stringify({todos:[{id:'mine',text:'Calendar',completed:false}]}));assert.equal(c.api.search('Calendar').find(item=>item.id==='todo:mine').label,'Calendar');
});
