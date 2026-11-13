const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../workbench-preferences');
const Transfer = require('../workspace-tools-core');

const bookmark = (id, extra = {}) => ({ id, title: id, url: `https://example.com/${id}`, group: 'Writing', tags: ['work'], icon: '✎', enabled: true, ...extra });
const storage = seed => {
  const map = new Map(Object.entries(seed || {}).map(([key,value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return { getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,String(value)), removeItem: key => map.delete(key) };
};
function browser(store) {
  const window = { dispatchEvent() {} }, document = { documentElement: { dataset: {} } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../workbench-preferences.js'),'utf8'), { window, document, localStorage: store, URL, CustomEvent: class { constructor(type,options) { this.type=type;this.detail=options?.detail; } } });
  return { api: window.DailySpaceWorkbenchPreferences, document };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('external tools accept only explicit safe web URLs, deduplicate identities and bound metadata', () => {
  const value = Core.normalize({ bookmarks: [bookmark('good', { title: '  Good tool  ', tags: ['work','work',' long '.repeat(20)], icon: 'A'.repeat(50) }), bookmark('good'),
    bookmark('script', {url:'javascript:alert(1)'}), bookmark('data', {url:'data:text/html,hello'}), bookmark('credentials', {url:'https://alice:secret@example.com'}), bookmark('__proto__'), bookmark('relative',{url:'/todo.html'}), bookmark('hidden',{enabled:false})] });
  assert.deepEqual(value.bookmarks.map(item => item.id), ['good','hidden']);
  assert.equal(value.bookmarks[0].title,'Good tool');
  assert.equal(value.bookmarks[0].tags.length,2); assert.equal(value.bookmarks[0].tags[1].length,30);
  assert.equal(value.bookmarks[0].icon.length,8);
  assert.deepEqual(Core.getBookmarks(value).map(item => item.id), ['good']);
  assert.equal(Core.safeUrl('https://example.com/a?q=b#c'),'https://example.com/a?q=b#c');
  assert.equal(Core.safeUrl('ftp://example.com'),null);
});

test('work/life profiles restore the matching sections and bookmarks without duplicating task data', () => {
  const initial = Core.normalize({ name:'My space', bookmarks:[bookmark('work'),bookmark('life',{enabled:false})], hidden:['travel'] });
  let work = Core.captureContext(initial,'work','Work');
  assert.equal(work.contexts.length,2); assert.equal(work.activeContext,'work');
  const life = Core.captureContext({ ...work, hidden:['spend'], sections:['tasks','travel'], bookmarks:work.bookmarks.map(item => ({...item,enabled:item.id==='life'})), desktopLayout:{order:['focus','tasks'],wide:'focus'} },'life','Life');
  const store = storage({[Core.KEY]:life,'todo-app-v2':{todos:[{id:'same-task',text:'Shared task'}]}}), {api}=browser(store);
  api.applyContext('work');
  assert.deepEqual(plain(api.getBookmarks()).map(item => item.id),['work']);
  assert.deepEqual(plain(api.read().hidden),['travel']);
  api.applyContext('life');
  assert.deepEqual(plain(api.getBookmarks()).map(item => item.id),['life']);
  assert.equal(api.read().desktopLayout.wide,'focus'); assert.equal(api.read().sections[0],'tasks');
  api.applyContext('');
  assert.deepEqual(plain(api.read().hidden),['travel']); assert.equal(api.read().name,'My space');
  assert.equal(JSON.parse(store.getItem('todo-app-v2')).todos.length,1);
  assert.throws(() => api.applyContext('deleted'), /no longer available/);
});

test('website search includes group/tags, and account transitions expose no prior-owner links', () => {
  const store=storage({[Core.KEY]:{bookmarks:[bookmark('tool',{title:'Read papers',tags:['research'],group:'Study',enabled:false})]}}), c=browser(store);
  assert.equal(c.api.searchBookmarks('RESEARCH').length,1); assert.equal(c.api.searchBookmarks('study').length,1);
  assert.equal(c.api.getBookmarks().length,0);
  store.setItem('daily-space-auth-v1',JSON.stringify({email:'new@example.com'}));
  store.setItem('daily-space-workspace-owner-v1',JSON.stringify({owner:'old@example.com'}));
  assert.equal(c.api.searchBookmarks('research').length,0);
  assert.throws(() => c.api.applyContext('work'), /not ready/);
});

test('external tools and layouts survive portable backup/import with validated URLs', () => {
  const settings=Core.captureContext({bookmarks:[bookmark('reader')],desktopLayout:{order:['focus','agenda'],wide:'focus'}},'travel','Travel');
  const source=storage({[Core.KEY]:settings}), target=storage();
  const backup=Transfer.backup(source), plan=Transfer.prepare(JSON.stringify(backup),'json',target);
  Transfer.apply(plan,target);
  assert.deepEqual(JSON.parse(target.getItem(Core.KEY)),settings);
  assert.deepEqual(Core.normalize({desktopLayout:{order:['focus','focus','bad'],wide:'detail'}}).desktopLayout,{order:['focus','tasks','agenda','detail'],wide:'tasks'});
});
