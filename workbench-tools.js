/** Occasional tools share one responsive surface while tasks keep their place. */
(function () {
  function boot() {
    const row=document.querySelector('.m-task-controls, .today-list-actions'),Surfaces=window.DailySpaceSurfaces;
    if(!row||!Surfaces||document.querySelector('[data-workbench-tools]'))return;
    const t=(en,zh)=>window.DailySpaceI18n?.t(en,zh)||en;
    const owner=()=>window.DailySpaceView?.owner()||'guest';
    const ready=()=>window.DailySpaceWorkbenchPreferences?.ready()!==false&&document.documentElement.dataset.workspaceReady!=='false'&&document.documentElement.dataset.workspaceLocked!=='true';
    const wrapper=document.createElement('div');wrapper.id='workbench-tools';wrapper.className='workbench-tools';wrapper.dataset.workbenchTools='';wrapper.dataset.i18nIgnore='';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='workbench-tools-trigger';trigger.dataset.workbenchToolsTrigger='';
    const label=document.createElement('span'),status=document.createElement('span');status.className='workbench-tools-status';status.setAttribute('aria-live','off');trigger.append(label,status);wrapper.append(trigger);row.append(wrapper);
    const content=document.createElement('div');content.className='workbench-tools-content';content.id='workbench-tools-content';
    const bar=document.querySelector('.focus-workbench-bar');if(bar)content.append(bar);
    for(const button of document.querySelectorAll('[data-notes-open], [data-history-open]')){
      const launch=button.closest('.notes-launch');content.append(button);if(launch&&!launch.children.length)launch.remove();
    }
    for(const group of document.querySelectorAll('.workspace-task-shortcuts')){
      for(const button of group.querySelectorAll('button')){button.dataset.workbenchTemplates='';content.append(button);}
      if(!group.children.length)group.remove();
    }
    const surface=Surfaces.create({key:'workbench-tools',trigger,title:()=>t('Tools','工具'),content});
    surface.root.dataset.workbenchToolsSurface='';
    Object.defineProperty(wrapper,'open',{get:surface.isOpen,set:value=>value?surface.open():surface.close()});
    wrapper.toggleAttribute('open',false);surface.root.addEventListener('surfacechange',event=>{wrapper.toggleAttribute('open',event.detail.open);if(event.detail.open)launchOwner=owner();});
    document.body.classList.add('has-workbench-tools');
    // Group the original card actions without changing their original listeners.
    const card=document.querySelector('.overview-focus-card'),open=card?.querySelector('.overview-focus-open'),start=card?.querySelector('[data-focus-card-start]');
    if(card&&open&&start&&!open.parentElement.classList.contains('overview-focus-actions')){const actions=document.createElement('div');actions.className='overview-focus-actions';open.before(actions);actions.append(open,start);}
    let restorePending=false,restoreFrame=0,launchOwner='';
    const dialogs=[...document.querySelectorAll('#focus-sheet, #notes-sheet, #record-history-sheet, #workspace-tools-sheet')];
    const dialogOpen=()=>dialogs.some(dialog=>!dialog.hidden);
    function labels(){
      label.textContent=t('Tools','工具');trigger.disabled=!ready();
      const value=ready()?bar?.querySelector('.focus-mini')?.textContent.trim()||'':'';
      const clock=value.match(/\d+:\d+(?::\d+)?/),text=value?` · ${clock?.[0]||t('Focus','专注')}`:'';
      if(status.textContent!==text)status.textContent=text;
      trigger.title=value||t('Focus, weekly review, notes, history and templates','专注、每周复盘、笔记、历史与模板');
      trigger.setAttribute('aria-label',value?`${t('Tools','工具')} · ${value}`:t('Tools','工具'));
    }
    function restoreFocus(){
      if(!restorePending||dialogOpen())return;cancelAnimationFrame(restoreFrame);
      restoreFrame=requestAnimationFrame(()=>{if(!restorePending||dialogOpen())return;restorePending=false;if(ready()&&!document.body.classList.contains('task-selecting'))trigger.focus({preventScroll:true});});
    }
    content.addEventListener('click',event=>{
      if(surface.isOpen()&&ready()&&launchOwner===owner())return;
      event.preventDefault();event.stopImmediatePropagation();
    },true);
    content.addEventListener('click',event=>{
      if(!event.target.closest('button')||event.target.closest('button').disabled||!dialogOpen())return;
      restorePending=true;surface.close({history:false,restoreFocus:false,immediate:true});
    });
    for(const dialog of dialogs)new MutationObserver(restoreFocus).observe(dialog,{attributes:true,attributeFilter:['hidden','class']});
    if(bar)new MutationObserver(labels).observe(bar,{subtree:true,characterData:true,childList:true});
    for(const event of ['daily-space-focus-updated','daily-space-locale-changed','daily-space-user-sync-updated'])window.addEventListener(event,labels);
    window.addEventListener('daily-space-auth-updated',()=>{restorePending=false;cancelAnimationFrame(restoreFrame);labels();});
    window.DailySpaceWorkbenchTools={...surface,trigger,content};labels();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
