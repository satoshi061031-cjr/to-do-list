/** One command surface over the existing search, records and entry sheets. */
(function () {
  const INTENT_PREFIX = 'dayfly-command-intent:';
  const INTENT_TTL = 5 * 60 * 1000;
  const COMMANDS = new Set(['new-task','capture-inbox','add-expense','start-focus','notes','filters','templates']);
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const owner = () => String(window.DailySpaceView?.owner?.() || 'guest').trim().toLowerCase();
  const ready = () => window.DailySpaceSearch?.ready?.() === true;
  const page = () => String(location.pathname).split('/').pop();
  const onTodo = () => /^todo(?:-m)?\.html$/.test(page());
  let consumeFrame = 0, consuming = false;

  function perform(command) {
    if (!ready() || !COMMANDS.has(command)) return false;
    if (command === 'add-expense') {
      const trigger = document.getElementById('tally-add-open');
      if (!trigger || trigger.disabled || page() !== 'tally.html') return false;
      trigger.click(); return true;
    }
    if (command === 'notes') { if (page() !== 'notes.html' || !window.DailySpaceNotes?.open) return false; return window.DailySpaceNotes.open(null, { list: true }) !== false; }
    if (!onTodo() || !window.DailySpaceTodo) return false;
    if (command === 'templates') { if (!window.DailySpaceWorkspaceTools?.openTemplates) return false; window.DailySpaceWorkspaceTools.openTemplates(); return true; }
    if (command === 'new-task') {
      if (document.body.classList.contains('todo-mobile')) {
        if (!window.DailySpaceMobileTodo?.openNew) return false;
        window.DailySpaceMobileTodo.openNew();
      } else {
        const input = document.getElementById('todo-input'); if (!input) return false;
        window.DailySpaceTodo.setPlanningView?.({ mode:'tasks', priority:'all', source:'personal' });
        input.scrollIntoView({ block:'center', behavior:'instant' }); input.focus({ preventScroll:true });
      }
      return true;
    }
    if (command === 'capture-inbox') {
      if (!window.DailySpaceTaskPlanning?.openInbox) return false;
      window.DailySpaceTaskPlanning.openInbox();
      requestAnimationFrame(() => {
        if (!ready()) return;
        const input=document.querySelector('[data-inbox-text]'); input?.scrollIntoView({block:'center',behavior:'instant'});input?.focus({preventScroll:true});
      });
      return true;
    }
    if (command === 'start-focus') { if (!window.DailySpaceFocus?.open) return false; window.DailySpaceFocus.open(); return true; }
    if (command === 'filters') {
      if (window.DailySpaceTaskPlanning?.openFilters) { window.DailySpaceTaskPlanning.openFilters(); return true; }
      const options=document.querySelector('.task-planning-options');if(!options)return false;
      options.open=true;options.querySelector('summary')?.focus({preventScroll:true});return true;
    }
    return false;
  }

  function removeIntent(who=owner()) { try { sessionStorage.removeItem(INTENT_PREFIX+who); } catch(_) {} }
  function cleanIntentUrl() { const url=new URL(location.href);url.searchParams.delete('command');history.replaceState(history.state,'',url.pathname+url.search+url.hash); }
  function consumeIntent() {
    consumeFrame=0;
    if(consuming||!ready())return;
    const command=new URLSearchParams(location.search).get('command');
    if(!COMMANDS.has(command))return;
    let intent;
    try { intent=JSON.parse(sessionStorage.getItem(INTENT_PREFIX+owner())||'null'); } catch(_){removeIntent();cleanIntentUrl();return;}
    if(!intent||intent.owner!==owner()||intent.command!==command||!Number.isFinite(intent.at)||Date.now()-intent.at<0||Date.now()-intent.at>INTENT_TTL){removeIntent();cleanIntentUrl();return;}
    const target=command==='add-expense'?'tally.html':command==='notes'?'notes.html':'todo.html';
    if(target==='todo.html'?!onTodo():page()!==target)return;
    consuming=true;
    const original=location.href;cleanIntentUrl();
    try {
      if(!perform(command)){history.replaceState(history.state,'',original);return;}
      removeIntent();
    } finally {consuming=false;}
  }
  function scheduleIntent() { if(!consumeFrame)consumeFrame=requestAnimationFrame(consumeIntent); }
  function navigate(entry) {
    if(typeof entry?.href!=='string')return false;
    if(entry.external){
      try {const url=new URL(entry.href);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;}catch(_){return false;}
    }else if(!/^(todo(?:-m)?|calendar|planner|mail|tally|travel|teamwork|tools|notes|review)\.html(?:[?#].*)?$/.test(entry.href))return false;
    const href = !entry.external && /^todo\.html(?:[?#]|$)/.test(entry.href) && window.matchMedia('(max-width: 819px)').matches ? entry.href.replace(/^todo\.html/, 'todo-m.html') : entry.href;
    location.assign(href);return true;
  }
  function execute(entry) {
    if(!ready())return false;
    const current=window.DailySpaceSearch.resolve(typeof entry==='string'?entry:entry?.id);
    if(!current)return false;
    if(current.kind!=='action'){window.DailySpaceSearch.remember(current);return navigate(current);}
    if(!COMMANDS.has(current.command))return false;
    window.DailySpaceSearch.remember(current);
    if(perform(current.command))return true;
    try {sessionStorage.setItem(INTENT_PREFIX+owner(),JSON.stringify({owner:owner(),command:current.command,at:Date.now()}));}
    catch(_){return false;}
    return navigate(current);
  }

  function mount({palette,input,list,empty}) {
    if(!palette||!input||!list||palette.dataset.commandMounted)return window.DailySpaceSearchUi;
    palette.dataset.commandMounted='';palette.dataset.dialogRoot='';palette.classList.add('workspace-command');palette.dataset.i18nIgnore='';
    const panel=palette.querySelector('.command-palette-panel');if(!panel)return null;
    palette.removeAttribute('role');palette.removeAttribute('aria-modal');palette.removeAttribute('aria-label');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',t('Search and commands','搜索与操作'));
    const backdrop=palette.querySelector('.command-palette-backdrop');backdrop?.setAttribute('data-dialog-close','');
    const header=document.createElement('div');header.className='workspace-command-header';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='workspace-command-close';dismiss.dataset.dialogClose='';dismiss.textContent='×';
    input.before(header);header.append(input,dismiss);
    const help=document.createElement('p');help.className='workspace-command-help';panel.append(help);
    const suggestions=document.createElement('div');suggestions.className='workspace-command-suggestions';suggestions.hidden=true;panel.append(suggestions);
    const status=document.createElement('p');status.className='workspace-command-status';status.setAttribute('role','status');status.hidden=true;panel.append(status);
    if(!list.id)list.id='workspace-command-results';list.setAttribute('role','listbox');
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
    const fit=window.DailySpaceDialogHistory?.fitViewport(palette),motion=window.DailySpaceDialogHistory?.motion(palette);
    let items=[],activeIndex=0,renderOwner='',composing=false,closing=false;
    const historyController=window.DailySpaceDialogHistory?.create('workspace-command',{isOpen:()=>!palette.hidden&&!closing,restore:()=>open(true),close:()=>close(true)});
    function labels(){
      input.placeholder=t('Search records or choose an action…','搜索记录或选择操作…');input.setAttribute('aria-label',t('Search dayfly','搜索 dayfly'));
      dismiss.setAttribute('aria-label',t('Close search','关闭搜索'));help.textContent=t('↑ ↓ to move · Enter to open · Esc to close','↑ ↓ 选择 · Enter 打开 · Esc 关闭');
      panel.setAttribute('aria-label',t('Search and commands','搜索与操作'));
    }
    function highlight(){
      const options=[...list.querySelectorAll('[role=option]')];
      options.forEach((node,index)=>{node.classList.toggle('is-active',index===activeIndex);node.setAttribute('aria-selected',String(index===activeIndex));});
      const current=options[activeIndex];if(current){input.setAttribute('aria-activedescendant',current.id);current.scrollIntoView({block:'nearest',behavior:'instant'});}else input.removeAttribute('aria-activedescendant');
    }
    function render(query=''){
      const prior=items[activeIndex]?.id, q=String(query).trim(),seen=new Set();
      const values=window.DailySpaceSearch.search(q,20);
      const recents=q?[]:window.DailySpaceSearch.recent(4).map(item=>({...item,group:'recent'}));
      items=[...recents,...values].filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).slice(0,24);
      const names={recent:t('Recent','最近使用'),pages:t('Pages','页面'),records:t('Records','记录'),actions:t('Actions','操作')};
      const grouped=[];for(const group of ['recent','pages','records','actions'])grouped.push(...items.filter(item=>item.group===group));items=grouped;
      list.replaceChildren();let group='';
      for(const [index,item] of items.entries()){
        if(item.group!==group){group=item.group;const title=document.createElement('li');title.className='workspace-command-group';title.setAttribute('role','presentation');title.dataset.commandGroup=group;title.textContent=names[group]||group;list.append(title);}
        const row=document.createElement('li');row.className='command-palette-item';row.id=`workspace-command-option-${index}`;row.setAttribute('role','option');row.tabIndex=-1;row.dataset.commandId=item.id;row.dataset.commandGroup=item.group;
        const copy=document.createElement('span');copy.className='workspace-command-copy';
        const label=document.createElement('span');label.className='command-palette-label';label.textContent=item.label;if(item.kind==='item')label.dataset.i18nIgnore='';
        const hint=document.createElement('span');hint.className='command-palette-hint';hint.textContent=item.hint||'';
        const kind=document.createElement('span');kind.className='workspace-command-kind';kind.textContent=item.kind==='action'?t('Action','操作'):item.external?t('Website','网站'):item.kind==='item'?t('Record','记录'):t('Page','页面');
        copy.append(label,hint);row.append(copy,kind);row.addEventListener('click',()=>run(item));list.append(row);
      }
      activeIndex=Math.max(0,items.findIndex(item=>item.id===prior));
      if(empty){empty.textContent=t('No matches. Try a title, date, “add task” or “add expense”.','没有匹配结果。试试标题、日期、“新建任务”或“记账”。');empty.hidden=items.length>0;}
      suggestions.replaceChildren();suggestions.hidden=items.length>0;
      if(!items.length)for(const id of ['action:new-task','action:add-expense']){
        const entry=window.DailySpaceSearch.resolve(id);if(!entry)continue;
        const button=document.createElement('button');button.type='button';button.textContent=entry.label;button.dataset.commandSuggestion=id;button.addEventListener('click',()=>run(entry));suggestions.append(button);
      }
      status.hidden=true;highlight();
    }
    function open(fromHistory=false){
      if(!ready())return false;
      if(!fromHistory&&palette.hidden&&historyController&&!historyController.push({}))return false;
      renderOwner=owner();closing=false;labels();input.value='';activeIndex=0;
      if(motion)motion.open();else palette.hidden=false;
      fit?.();input.setAttribute('aria-expanded','true');render('');
      requestAnimationFrame(()=>{if(!palette.hidden&&renderOwner===owner())input.focus({preventScroll:true});});return true;
    }
    function close(fromHistory=false,after){
      if(palette.hidden||closing)return;
      closing=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
      const who=renderOwner;let hidden=false,settled=fromHistory||history.state?.workspaceSheet?.key!=='workspace-command';
      const done=()=>{if(hidden&&settled&&after&&who===owner()&&ready()){const next=after;after=null;requestAnimationFrame(next);}};
      if(!settled){window.addEventListener('popstate',()=>{settled=true;done();},{once:true});historyController?.back();}
      const finish=()=>{palette.hidden=true;closing=false;hidden=true;done();};
      if(motion)motion.close(finish);else finish();
    }
    function run(entry){
      if(closing||renderOwner!==owner()||!ready())return;
      const current=window.DailySpaceSearch.resolve(entry?.id);
      if(!current){render(input.value);status.textContent=t('That item is no longer available. Choose another result.','这条记录已不存在，请选择其他结果。');status.hidden=false;return;}
      close(false,()=>execute(current));
    }
    input.addEventListener('input',()=>{if(!closing){activeIndex=0;render(input.value);}});
    input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;render(input.value);});
    input.addEventListener('keydown',event=>{
      if(composing||event.isComposing||event.keyCode===229)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();activeIndex=(activeIndex+(event.key==='ArrowDown'?1:-1)+Math.max(1,items.length))%Math.max(1,items.length);highlight();}
      else if(event.key==='Enter'){event.preventDefault();run(items[activeIndex]);}
      else if(event.key==='Escape'){event.preventDefault();close();}
    });
    dismiss.addEventListener('click',()=>close());backdrop?.addEventListener('click',()=>close());
    document.addEventListener('keydown',event=>{
      if(!(event.metaKey||event.ctrlKey)||String(event.key).toLowerCase()!=='k'||event.isComposing||event.keyCode===229)return;
      event.preventDefault();if(palette.hidden)open();else close();
    });
    function refresh(){
      if(renderOwner&&renderOwner!==owner()||!ready()){
        removeIntent(renderOwner);palette.hidden=true;closing=false;input.value='';list.replaceChildren();items=[];
        input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');status.textContent='';status.hidden=true;suggestions.replaceChildren();suggestions.hidden=true;
        renderOwner='';return;
      }
      if(!palette.hidden&&!closing){labels();render(input.value);}
    }
    for(const type of ['daily-space-auth-updated','daily-space-user-sync-updated','daily-space-agent-data-updated','daily-space-notes-updated','daily-space-workbench-updated','daily-space-locale-changed','storage'])window.addEventListener(type,refresh);
    labels();window.DailySpaceSearchUi={open,close:()=>close()};return window.DailySpaceSearchUi;
  }

  window.DailySpaceCommand={mount,execute,consumeIntent,scheduleIntent};
  for(const type of ['daily-space-user-sync-updated','daily-space-auth-updated','daily-space-agent-data-updated'])window.addEventListener(type,scheduleIntent);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleIntent,{once:true});else scheduleIntent();
})();
