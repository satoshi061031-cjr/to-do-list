/** Trips reference expenses in the user's own Tally ledger; no member data is shared. */
(function () {
  const Core=window.DailySpaceTallyCore, t=(en,zh)=>window.DailySpaceI18n?.t(en,zh)||en;
  const owner=()=>window.DailySpaceView?.owner()||'guest';let shared=[],generation=0;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch(_){return{};}};
  function trips(){const local=read('travel-book-v1').trips||[];const mappings=read('travel-shared-v1').mappings||{};return [...local.map(trip=>({...trip,ref:trip.id})),...shared.map(trip=>({...trip,ref:`shared:${trip.id}`}))].filter((trip,index,all)=>all.findIndex(item=>item.ref===trip.ref)===index);}
  function populate(select, current, oldName){const chosen=current??select.value;const savedName=oldName||select.selectedOptions[0]?.dataset.tripName||'';select.replaceChildren(new Option(t('No trip','不关联行程'),''));trips().forEach(trip=>{const option=new Option(trip.name,trip.ref);option.dataset.tripName=trip.name;select.add(option);});if(chosen&&!trips().some(trip=>trip.ref===chosen)){const option=new Option(`${savedName||t('Unavailable trip','已失效行程')} · ${t('saved link','保留关联')}`,chosen);option.dataset.tripName=savedName;select.add(option);}select.value=chosen||'';}
  async function refreshShared(){const ticket=++generation,currentOwner=owner();const auth=read('daily-space-auth-v1');shared=[];if(!/google|gmail/i.test(auth.provider||''))return;
    try{const response=await fetch('/api/travel/trips',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const result=await response.json();if(ticket!==generation||currentOwner!==owner())return;shared=(result.trips||[]).map(trip=>({id:trip.id,name:trip.title||trip.name||t('Trip','行程'),startDate:trip.data?.startDate||trip.startDate,endDate:trip.data?.endDate||trip.endDate}));window.dispatchEvent(new Event('daily-space-trip-options-updated'));}catch(_){/* Personal trips and existing links remain usable offline. */}}
  function matches(record,ref){const mappings=read('travel-shared-v1').mappings||{};return record.tripId===ref || (ref.startsWith('shared:') && mappings[record.tripId]===ref.slice(7));}
  function budget(state,ref){const mappings=read('travel-shared-v1').mappings||{};const previous=ref.startsWith('shared:')?Object.keys(mappings).find(key=>mappings[key]===ref.slice(7)):null;return state.tripBudgets?.[ref]||state.tripBudgets?.[previous]||null;}
  function stats(state,ref){const records=state.records.filter(record=>matches(record,ref)),byCategory=new Map(),byDate=new Map();for(const record of records){const amount=Core.baseAmount(record);byCategory.set(record.category,(byCategory.get(record.category)||0)+amount);byDate.set(record.date,(byDate.get(record.date)||0)+amount);}return{records,total:records.reduce((sum,record)=>sum+Core.baseAmount(record),0),categories:[...byCategory].sort((a,b)=>b[1]-a[1]),days:[...byDate].sort(([a],[b])=>a.localeCompare(b))};}
  const views = new WeakMap();
  function node(tag, cls) { const element = document.createElement(tag); if (cls) element.className = cls; return element; }
  function text(element, value) { if (element.textContent !== value) element.textContent = value; }
  function buildView(root, ref) {
    const view = { owner: owner(), ref, currency: '', previousRef: null, categoryKey: '', recordKey: '' };
    view.summary = node('summary'); view.info = node('p', 'trip-expense-note');
    view.add = node('a', 'trip-expense-add'); view.daily = node('p');
    const label = node('label', 'trip-expense-budget'); view.budgetTitle = node('span'); view.budget = node('input');
    view.budget.type = 'number'; view.budget.min = '0'; view.budget.step = '0.01'; label.append(view.budgetTitle, view.budget);
    view.balance = node('p', 'trip-expense-note'); view.categories = node('ul', 'trip-expense-list');
    view.history = node('details', 'trip-expense-history'); view.historyTitle = node('summary'); view.records = node('div', 'trip-expense-records');
    view.history.append(view.historyTitle, view.records); view.all = node('a');
    root.replaceChildren(view.summary, view.info, view.add, view.daily, label, view.balance, view.categories, view.history);
    root.dataset.i18nIgnore = ''; root.dataset.owner = view.owner; views.set(root, view);
    view.budget.addEventListener('change', () => {
      if (view.owner !== owner() || views.get(root) !== view || root.hidden || !view.budget.checkValidity()) return;
      const current = Core.readState(), amount = Number(view.budget.value);
      if (current.baseCurrency !== view.currency || !Number.isFinite(amount)) return;
      if (amount > 0) current.tripBudgets[ref] = { amount, currency: current.baseCurrency };
      else { delete current.tripBudgets[ref]; if (view.previousRef) delete current.tripBudgets[view.previousRef]; }
      Core.writeState(current);
      window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['tally'] } }));
    });
    return view;
  }
  function render(trip, day) {
    const root = document.getElementById('travel-expenses'); if (!root) return;
    root.hidden = !trip;
    if (!trip) { root.replaceChildren(); views.delete(root); return; }
    const state = Core.readState(), ref = trip.ref || trip.id, result = stats(state, ref);
    const money = amount => Core.formatAmount(state, amount, state.baseCurrency);
    let view = views.get(root);
    if (!view || view.owner !== owner() || view.ref !== ref) view = buildView(root, ref);
    text(view.summary, `${t('Trip expenses','旅行费用')} · ${money(result.total)}`);
    text(view.info, t('Linked to your own ledger. Other trip members cannot see these expenses.','关联你的个人账本，其他行程成员无法查看这些费用。'));
    let date = trip.startDate;
    try { date = window.DailySpaceWorkspaceCore.addDays(trip.startDate, Math.max(0, (day || 1) - 1)); } catch (_) {}
    text(view.daily, `${date} · ${t('This day','当日')} ${money(new Map(result.days).get(date) || 0)}`);
    text(view.budgetTitle, `${t('Trip budget','行程预算')} · ${state.baseCurrency}`);
    view.budget.placeholder = t('Optional','可选'); view.budget.setAttribute('aria-label', t('Trip budget','行程预算'));
    const mappings = read('travel-shared-v1').mappings || {};
    view.previousRef = ref.startsWith('shared:') ? Object.keys(mappings).find(key => mappings[key] === ref.slice(7)) : null;
    const saved = budget(state,ref);
    if (document.activeElement !== view.budget || view.currency !== state.baseCurrency) {
      view.budget.value = saved?.currency === state.baseCurrency ? String(saved.amount) : '';
    }
    view.currency = state.baseCurrency;
    text(view.balance, saved && saved.currency === state.baseCurrency
      ? `${result.total > saved.amount ? t('Over budget','已超预算') : t('Remaining budget','剩余预算')} · ${money(Math.abs(saved.amount - result.total))}`
      : t('Totals use the exchange rates saved in your ledger.','汇总按账本中保存的汇率换算。'));
    const categories = result.categories.map(([category, amount]) => [category, money(amount)]);
    const categoryKey = JSON.stringify(categories);
    if (view.categoryKey !== categoryKey) {
      view.categories.replaceChildren(...categories.map(([category, amount]) => {
        const row = node('li'), name = node('span'), value = node('span'); text(name, category); text(value, amount); row.append(name, value); return row;
      })); view.categoryKey = categoryKey;
    }
    text(view.historyTitle, `${t('Ledger records','账本记录')} · ${result.records.length}`);
    const records = [...result.records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
      .map(record => [record.id, `${record.date} · ${record.category} · ${money(Core.baseAmount(record))}`]);
    const recordKey = JSON.stringify(records);
    if (view.recordKey !== recordKey) {
      view.records.replaceChildren(...records.map(([id, label]) => { const link = node('a'); link.href = `tally.html?focus=expense&id=${encodeURIComponent(id)}`; text(link, label); return link; }));
      view.recordKey = recordKey;
    }
    text(view.add, t('Add trip expense','记一笔旅行费用'));
    view.add.href = `tally.html?${new URLSearchParams({ trip: ref, tripName: trip.name, date })}`;
    if (result.records.length > 8) { if (view.all.parentElement !== root) root.append(view.all); }
    else view.all.remove();
    view.all.href = `tally.html?tripFilter=${encodeURIComponent(ref)}`;
    text(view.all, t('View ledger records','查看账本记录'));
  }
  window.DailySpaceTripExpenses={trips,populate,stats,matches,budget,render,refreshShared};
  window.addEventListener('daily-space-auth-updated',()=>{generation++;shared=[];refreshShared();});
  window.addEventListener('daily-space-trip-options-updated',()=>{const select=document.getElementById('tally-trip');if(select)populate(select);});
  window.addEventListener('daily-space-locale-changed',()=>{const select=document.getElementById('tally-trip');if(select)populate(select);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshShared);else refreshShared();
})();
