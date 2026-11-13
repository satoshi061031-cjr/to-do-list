const test = require('node:test');
const assert = require('node:assert/strict');
const Preferences = require('../workbench-preferences');
const Transfer = require('../workspace-tools-core');
function storage(seed={}) { const values=new Map(Object.entries(seed).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]));return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}; }

test('phone overview is compact by default and only explicitly saved boolean choices extend the preferences', () => {
  assert.equal(Object.hasOwn(Preferences.defaults(),'phoneOverviewExpanded'),false);
  assert.equal(Object.hasOwn(Preferences.normalize({phoneOverviewExpanded:'true'}),'phoneOverviewExpanded'),false);
  assert.equal(Preferences.normalize({phoneOverviewExpanded:true}).phoneOverviewExpanded,true);
  assert.equal(Preferences.normalize({phoneOverviewExpanded:false}).phoneOverviewExpanded,false);
});

test('an explicit overview choice survives context capture and portable backup', () => {
  const config=Preferences.captureContext({phoneOverviewExpanded:true,hidden:['spend'],shortcuts:['planner']},'work','Work');
  assert.equal(config.phoneOverviewExpanded,true);
  const source=storage({[Preferences.KEY]:config}), target=storage();
  Transfer.apply(Transfer.prepare(JSON.stringify(Transfer.backup(source)),'json',target),target);
  assert.equal(JSON.parse(target.getItem(Preferences.KEY)).phoneOverviewExpanded,true);
  assert.deepEqual(JSON.parse(target.getItem(Preferences.KEY)).hidden,['spend']);
});
