/** Templates and file transfer share one validated, merge-only data contract. */
(function (global) {
  const Tally = global?.DailySpaceTallyCore || (typeof require === 'function' ? require('./tally-core') : null);
  const TEMPLATE_KEY = 'task-templates-v1';
  const KEYS = ['todo-app-v2', 'calendar-app-v1', 'planner-app-v1', 'tally-book-v1', 'travel-book-v1', TEMPLATE_KEY];
  const SNAPSHOT_KEYS = [...KEYS, 'teamwork-page-v1', 'travel-shared-v1', 'daily-space-mail-accounts-v1', 'todo-theme'];
  const uid = () => Tally.uid('workspace');
  const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const fail = message => { throw new Error(message); };
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return null;
    const parsed = new Date(`${value}T12:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  const time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? value : null;
  function addDays(day, offset) { if (!date(day)) fail('Invalid date.'); const value = new Date(`${day}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); const result = value.toISOString().slice(0, 10); if (!date(result)) fail('Invalid date.'); return result; }
  function array(value, limit) { if (value == null) return []; if (!Array.isArray(value) || value.length > limit) fail('Too many or invalid records.'); return value; }
  function unique(list) { const ids = new Set(); for (const item of list) { if (ids.has(item.id)) fail('Duplicate record IDs in this file.'); ids.add(item.id); } return list; }
  function identity(value) { const id = text(value, 120); if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('Invalid record ID.'); return id; }
  function checklist(value) { return unique(array(value, 100).map(item => { if (!text(item?.text)) fail('Invalid subtask.'); return { id: item.id ? identity(item.id) : uid(), text: text(item.text), completed: completion(item.completed) }; })); }
  function completion(value) { if(value !== undefined && typeof value !== 'boolean') fail('Invalid completion state.'); return Boolean(value); }
  function todo(item) {
    if (!text(item?.text)) fail('Task text is required.');
    if (item.dueDate && !date(item.dueDate)) fail('Invalid date.'); if (item.dueTime && !time(item.dueTime)) fail('Invalid time.');
    return { id: identity(item.id), text: text(item.text), completed: completion(item.completed), dueDate: date(item.dueDate), dueTime: time(item.dueTime), categoryId: text(item.categoryId, 120) || null,
      notes: text(item.notes, 10000), subtasks: checklist(item.subtasks), repeat: ['daily','weekly','monthly'].includes(item.repeat) ? item.repeat : null,
      sourceMailId: text(item.sourceMailId, 120) || null, sourceMailUrl: /^https:\/\/mail\.google\.com\//.test(item.sourceMailUrl || '') ? text(item.sourceMailUrl, 2000) : null,
      sourcePlannerId: text(item.sourcePlannerId, 120) || null, sourceReminderId: text(item.sourceReminderId, 120) || null, externalEventId: text(item.externalEventId, 120) || null,
      sourceTripId: text(item.sourceTripId, 120) || null, sourceTripName: text(item.sourceTripName, 60) || null, sourceTripDate: date(item.sourceTripDate),
      // Imported notifications are not scheduled using stale device timestamps.
      remindAt: null };
  }
  function template(item) {
    if (!text(item?.name, 60)) fail('Template name is required.');
    const items = array(item.items, 100).map(task => {
      if (!text(task?.text)) fail('Task text is required.');
      if (!Number.isInteger(task.offsetDays ?? 0) || (task.offsetDays ?? 0) < 0 || (task.offsetDays ?? 0) > 365) fail('Invalid template day offset.');
      return { text: text(task.text), notes: text(task.notes, 10000), subtasks: array(task.subtasks, 100).map(sub => ({ text: text(sub.text) })).filter(sub => sub.text), offsetDays: task.offsetDays || 0, dueTime: time(task.dueTime), categoryName: text(task.categoryName, 48) };
    });
    if (!items.length) fail('A template needs at least one task.'); return { id: identity(item.id), name: text(item.name, 60), items };
  }
  function fromTasks(tasks, categories, name) {
    const first = tasks.map(task => date(task.dueDate)).filter(Boolean).sort()[0];
    return template({ id: uid(), name, items: tasks.map(task => ({ ...task, offsetDays: first && date(task.dueDate) ? Math.max(0, Math.round((Date.parse(task.dueDate) - Date.parse(first))/86400000)) : 0,
      categoryName: categories.find(category => category.id === task.categoryId)?.name || '' })) });
  }
  function instantiate(raw, day) { return template(raw).items.map(item => ({ ...item, dueDate: addDays(day, item.offsetDays), subtasks: item.subtasks.map(sub => ({ id: uid(), text: sub.text, completed: false })), repeat: null })); }
  function parseCsv(source) {
    const input = String(source).replace(/^\uFEFF/, ''); const rows = []; let row = [], cell = '', quoted = false, afterQuote = false;
    for (let i=0; i<input.length; i++) {
      const char = input[i];
      if (quoted) { if (char === '"' && input[i+1] === '"') { cell += '"'; i++; } else if (char === '"') { quoted = false; afterQuote = true; } else cell += char; continue; }
      if (char === '"') { if (cell || afterQuote) fail('Invalid CSV quoting.'); quoted = true; }
      else if (char === ',') { row.push(cell); cell = ''; afterQuote = false; }
      else if (char === '\n' || char === '\r') { if (char === '\r' && input[i+1] === '\n') i++; row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; afterQuote = false; }
      else { if (afterQuote && char.trim()) fail('Invalid CSV quoting.'); if (!afterQuote) cell += char; }
    }
    if (quoted) fail('Unclosed CSV quote.'); row.push(cell); if (row.some(value => value.trim())) rows.push(row);
    if (rows.length < 2 || rows.length > 1001) fail('CSV needs a header and 1–1000 rows.');
    const headers = rows.shift().map(value => value.trim()); if (new Set(headers).size !== headers.length) fail('Duplicate CSV column.');
    return rows.map((values, index) => { if (values.length !== headers.length) fail(`CSV row ${index+2} has the wrong number of columns.`); return Object.fromEntries(headers.map((key,i) => [key,values[i]])); });
  }
  function csvId(value, occurrence) {
    // Stable identities preserve distinct identical rows, and make re-import idempotent.
    const source = JSON.stringify(value) + ':' + occurrence; let a=2166136261,b=2246822519;
    for (let i=0;i<source.length;i++) { a=Math.imul(a ^ source.charCodeAt(i),16777619); b=Math.imul(b ^ source.charCodeAt(i),3266489917); }
    return `csv-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}`;
  }
  function csvCell(value) {
    const raw=String(value??'');const safe=/^[=+@-]/.test(raw)||raw.startsWith("'")?"'"+raw:raw;
    return /[",\r\n]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;
  }
  function csvPayload(source, kind, current) {
    const rows = parseCsv(source), seen = new Map(); const records = rows.map(row => {
      if(row._format==='daily-space-csv-v1')for(const key of Object.keys(row)){if(/^'(?:[=+@-]|')/.test(row[key]))row[key]=row[key].slice(1);}
      const pick = (...keys) => keys.map(key => row[key]).find(value => value !== undefined)?.trim() || '';
      let value;
      if (kind === 'todo') value = { text: pick('text','title','标题','任务'), dueDate: pick('dueDate','date','日期') || null, dueTime: pick('dueTime','time','时间') || null, completed: /^(true|1|yes|已完成)$/i.test(pick('completed','完成')), notes: pick('notes','备注'), categoryName: pick('category','分类') };
      else value = { date: pick('date','日期'), amount: pick('amount','金额'), currency: pick('currency','币种') || current.baseCurrency, fxRate: pick('fxRate','汇率') || '', category: pick('category','分类'), note: pick('note','备注'), scope: pick('scope','类型') || 'personal', paidById: pick('paidById'), splitAmongIds: pick('splitAmongIds').split('|').filter(Boolean), tripId: pick('tripId') || null, tripName: pick('tripName') };
      const canonical = JSON.stringify(value); const occurrence = seen.get(canonical) || 0; seen.set(canonical,occurrence+1); return { ...value, id: text(row.id,120) || csvId(value,occurrence) };
    });
    if (kind === 'todo') {
      const categories = []; records.forEach(record => { if (record.categoryName) { let category = categories.find(item => item.name === record.categoryName); if (!category) { category = { id: csvId({ category:record.categoryName },0), name:record.categoryName }; categories.push(category); } record.categoryId = category.id; } });
      return { 'todo-app-v2': { todos: records, categories } };
    }
    return { 'tally-book-v1': { ...current, records } };
  }
  function normalize(key, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid data file.');
    if (key === 'todo-app-v2') return { todos: unique(array(raw.todos,1000).map(todo)), categories: unique(array(raw.categories,100).map(item => { if (!text(item?.name,48)) fail('Category name is required.'); return { id: identity(item.id), name: text(item.name,48) }; })), selectedCategoryKey:'__all__' };
    if (key === TEMPLATE_KEY) return { templates: unique(array(raw.templates,50).map(template)) };
    if (key === 'calendar-app-v1') return { selectedDate: date(raw.selectedDate), reminders: unique(array(raw.reminders,1000).map(item => { if (!date(item?.date) || !text(item.text)) fail('Invalid reminder.'); if ((item.startTime && !time(item.startTime)) || (item.endTime && (!time(item.endTime) || (item.startTime && item.endTime < item.startTime)))) fail('Invalid time.'); return { id:identity(item.id),date:item.date,text:text(item.text,200),startTime:time(item.startTime),endTime:time(item.endTime),priority:['high','low'].includes(item.priority)?item.priority:'medium',linkedTodoId:text(item.linkedTodoId,120)||null,remindAt:null }; })) };
    if (key === 'tally-book-v1') {
      const validCurrency = value => typeof value === 'string' && (/^[A-Za-z]{3}$/.test(value.trim()) || ['¥','$','€','£','₩','₹','HK$','S$'].includes(value.trim()));
      if ((raw.baseCurrency && !validCurrency(raw.baseCurrency)) || (raw.currency && !raw.baseCurrency && !validCurrency(raw.currency))) fail('Invalid currency.');
      array(raw.people,24).forEach(person=>{identity(person.id);if(!text(person.name,60))fail('Invalid person.');});
      const state = Tally.normalizeState({ ...raw, records: [] });
      if (array(raw.people,24).length && new Set(raw.people.map(person=>person.id)).size !== raw.people.length) fail('Duplicate people in file.');
      state.records = unique(array(raw.records,1000).map(item => {
        if (!date(item?.date) || !Number.isFinite(Number(item.amount)) || Number(item.amount)<=0 || Number(item.amount)>1e12 || !text(item.category,40)) fail('Invalid expense.');
        if (item.currency && !validCurrency(item.currency)) fail('Invalid currency.');
        const currency = Tally.currencyCode(item.currency,state.baseCurrency);
        const fxRate = currency === state.baseCurrency ? 1 : Number(item.fxRate);
        if (!Number.isFinite(fxRate) || fxRate<=0 || fxRate>1e6) fail('Foreign currency expenses require a valid exchange rate.');
        if (item.scope === 'shared' && (!state.people.some(person=>person.id===item.paidById) || !Array.isArray(item.splitAmongIds) || !item.splitAmongIds.length || item.splitAmongIds.some(id=>!state.people.some(person=>person.id===id)))) fail('Shared expense participants are missing. Use a JSON backup.');
        return Tally.normalizeRecord({ ...item,id:identity(item.id),currency,fxRate },state);
      })); return state;
    }
    if (key === 'travel-book-v1') return { version:5,activeTripId:text(raw.activeTripId,120)||null,trips: unique(array(raw.trips,100).map(item => {
      if (!text(item?.name,60) || !date(item.startDate) || !date(item.endDate) || item.endDate<item.startDate) fail('Invalid trip dates.');
      const coordinates = value => Number.isFinite(value.lat) && Math.abs(value.lat)<=90 && Number.isFinite(value.lng) && Math.abs(value.lng)<=180;
      return { id:identity(item.id),linkedTodoId:text(item.linkedTodoId,120)||null,name:text(item.name,60),destination:text(item.destination,80),startDate:item.startDate,endDate:item.endDate,lat:coordinates(item)?item.lat:48.8566,lng:coordinates(item)?item.lng:2.3522,zoom:Math.max(1,Math.min(18,Number(item.zoom)||12)),
        stops:unique(array(item.stops,500).map(stop=>{if(!text(stop?.title,80)||!coordinates(stop))fail('Invalid trip stop.');return{id:identity(stop.id),title:text(stop.title,80),note:text(stop.note,160),day:Math.max(1,Math.min(366,Number(stop.day)||1)),lat:stop.lat,lng:stop.lng};})),
        reservations: unique(array(item.reservations,80).map(reservation=>{if(!text(reservation?.title,100)||!['flight','hotel','restaurant'].includes(reservation.kind))fail('Invalid reservation.');const result={id:identity(reservation.id),title:text(reservation.title,100),kind:reservation.kind,day:Math.max(1,Math.min(366,Number(reservation.day)||1))}; for(const key of ['sourceId','provider','startDate','endDate','startTime','endTime','location','origin','destination','confirmationCode','details','importedAt'])result[key]=text(reservation[key],key==='details'?500:260)||null;return result;})) };
    })) };
    if (key === 'planner-app-v1') {
      const planners = unique(array(raw.planners,30).map(item=>({id:identity(item.id),name:text(item.name,48)||'Projects'}))); const boards = {};
      planners.forEach(planner=>{const board=Object.hasOwn(raw.boards||{},planner.id)?raw.boards[planner.id]:{};const columns=unique(array(board.columns,30).map(column=>({id:identity(column.id),title:text(column.title,80)||'Planned',emoji:text(column.emoji,8),status:['planned','progress','done','hold'].includes(column.status)?column.status:'planned'})));
        const entries=unique(array(board.entries,1000).map(item=>{if(!text(item?.title,200)||!columns.some(column=>column.id===item.columnId)||(item.dueDate&&!date(item.dueDate)))fail('Invalid project card.');return{id:identity(item.id),columnId:item.columnId,title:text(item.title,200),note:text(item.note,500),completed:Boolean(item.completed),tags:array(item.tags,12).map(tag=>text(tag,40)),dueDate:date(item.dueDate),linkedTodoId:text(item.linkedTodoId,120)||null};})); boards[planner.id]={columns,entries};}); return{version:2,planners,boards,selectedPlannerId:planners.some(item=>item.id===raw.selectedPlannerId)?raw.selectedPlannerId:planners[0]?.id||null};
    }
    fail('Unsupported data type.');
  }
  function prepare(source, format, storage) {
    if (new TextEncoder().encode(source).length > 1024*1024) fail('File is too large (maximum 1 MB).');
    const read = key => { const raw=storage.getItem(key); if(!raw)return null; try{return JSON.parse(raw);}catch(_){fail('Current device data is invalid. Export a backup before importing.');} };
    let incoming, ignored = 0;
    if (format === 'json') { let parsed; try{parsed=JSON.parse(source);}catch(_){fail('Invalid JSON file.');} const payload=parsed?.payload||parsed;
      if (!payload || typeof payload!=='object'||Array.isArray(payload))fail('Use a Daily Space JSON backup.'); incoming={}; for(const [key,value] of Object.entries(payload)){if(!KEYS.includes(key)){ignored++;continue;} try{incoming[key]=typeof value==='string'?JSON.parse(value):value;}catch(_){fail('Invalid JSON data section.');}} if(!Object.keys(incoming).length)fail('No supported workspace data found.');
    } else incoming=csvPayload(source,format, Tally.normalizeState(read('tally-book-v1')||{}));
    const payload={}, summary=[]; const merge=(oldItems,newItems)=>{const oldIds=new Set(oldItems.map(item=>item.id));return{items:[...oldItems,...newItems.filter(item=>!oldIds.has(item.id))],added:newItems.filter(item=>!oldIds.has(item.id)).length,skipped:newItems.filter(item=>oldIds.has(item.id)).length};};
    for(const [key,value] of Object.entries(incoming)) {
      const imported=normalize(key,value); const original=read(key); const local=original||{}; let result;
      if(key==='todo-app-v2'){
        const categories=[...(local.categories||[])],mapping=new Map();let categoryAdded=0;
        for(const item of imported.categories){let current=categories.find(category=>category.id===item.id||category.name.toLowerCase()===item.name.toLowerCase());if(!current){current=item;categories.push(item);categoryAdded++;}mapping.set(item.id,current.id);}
        const records=merge(local.todos||[],imported.todos.map(task=>({...task,categoryId:mapping.get(task.categoryId)||task.categoryId})));result={...local,todos:records.items,categories,selectedCategoryKey:local.selectedCategoryKey||'__all__'}; summary.push({key,added:records.added,skipped:records.skipped,categoriesAdded:categoryAdded});
      }
      else if(key==='planner-app-v1'){
        const records=merge(local.planners||[],imported.planners),boards={...local.boards};let added=records.added,skipped=records.skipped;
        for(const [id,board]of Object.entries(imported.boards)){const old=boards[id]||{columns:[],entries:[]};const columns=merge(old.columns,board.columns),entries=merge(old.entries,board.entries);boards[id]={...old,columns:columns.items,entries:entries.items};added+=columns.added+entries.added;skipped+=columns.skipped+entries.skipped;}
        result={...imported,...local,planners:records.items,boards,selectedPlannerId:local.selectedPlannerId||imported.selectedPlannerId};summary.push({key,added,skipped});
      }
      else if(key==='tally-book-v1'){const old=Tally.normalizeState(local);if(old.records.length&&old.baseCurrency!==imported.baseCurrency)fail('The backup and current ledger use different base currencies.');const base=old.records.length?old:imported;const idMap=id=>id===imported.selfPersonId?base.selfPersonId:id;const people=merge(base.people,imported.people.filter(person=>person.id!==imported.selfPersonId));if(people.items.length>24)fail('Too many people after merge.');const records=merge(old.records,imported.records.map(record=>({...record,paidById:idMap(record.paidById),splitAmongIds:record.splitAmongIds.map(idMap)})));if(records.items.length>1000)fail('Too many expenses after merge.');result={...base,people:people.items,records:records.items,tripBudgets:{...imported.tripBudgets,...old.tripBudgets},settlements:merge(old.settlements||[],imported.settlements||[]).items};summary.push({key,...records,items:undefined});}
      else if(key==='travel-book-v1'){
        const records=merge(local.trips||[],imported.trips);let added=records.added,skipped=records.skipped;
        result={...imported,...local,trips:records.items.map(trip=>{const source=imported.trips.find(item=>item.id===trip.id);const existed=(local.trips||[]).some(item=>item.id===trip.id);if(!source||!existed)return trip;const stops=merge(trip.stops||[],source.stops),reservations=merge(trip.reservations||[],source.reservations);added+=stops.added+reservations.added;skipped+=stops.skipped+reservations.skipped;return{...trip,stops:stops.items,reservations:reservations.items};})};summary.push({key,added,skipped});
      }
      else{const field=key===TEMPLATE_KEY?'templates':key==='travel-book-v1'?'trips':'reminders';const records=merge(local[field]||[],imported[field]);if(key===TEMPLATE_KEY&&records.items.length>50)fail('Too many templates after merge.');result={...imported,...local,[field]:records.items};summary.push({key,...records,items:undefined});}
      payload[key]=JSON.stringify(result);
    }
    const full=Object.fromEntries(SNAPSHOT_KEYS.map(key=>[key,payload[key]??storage.getItem(key)]).filter(([,value])=>value!==null));
    if(new TextEncoder().encode(JSON.stringify(full)).length>1024*1024)fail('Merged workspace exceeds the 1 MB sync limit.');
    return {payload,summary,ignored,baseline:Object.fromEntries(Object.keys(payload).map(key=>[key,storage.getItem(key)]))};
  }
  function apply(plan, storage) {
    for(const [key,value] of Object.entries(plan.baseline))if(storage.getItem(key)!==value)fail('Device data changed. Preview the file again.');
    const full=Object.fromEntries(SNAPSHOT_KEYS.map(key=>[key,plan.payload[key]??storage.getItem(key)]).filter(([,value])=>value!==null));
    if(new TextEncoder().encode(JSON.stringify(full)).length>1024*1024)fail('Merged workspace exceeds the 1 MB sync limit.');
    const written=[];try{for(const [key,value] of Object.entries(plan.payload)){storage.setItem(key,value);written.push(key);}}catch(error){for(const key of written.reverse()){if(plan.baseline[key]===null)storage.removeItem(key);else storage.setItem(key,plan.baseline[key]);}throw error;}
  }
  function backup(storage) { return { format:'daily-space',version:1,exportedAt:new Date().toISOString(),payload:Object.fromEntries(KEYS.map(key=>[key,storage.getItem(key)]).filter(([,value])=>value!==null)) }; }
  const api={TEMPLATE_KEY,KEYS,uid,date,time,addDays,template,fromTasks,instantiate,parseCsv,csvCell,prepare,apply,backup};
  if(global)global.DailySpaceWorkspaceCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:null);
