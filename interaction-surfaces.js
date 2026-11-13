/** One small surface: an anchored desktop popover or a phone action sheet. */
(function () {
  let current = null;
  const mobile = () => document.body.classList.contains('todo-mobile') || document.body.classList.contains('has-mobile-dock') || matchMedia('(max-width: 819px)').matches;
  const owner = () => window.DailySpaceView?.owner() || 'guest';
  const ready = () => window.DailySpaceWorkbenchPreferences?.ready() !== false && document.documentElement.dataset.workspaceLocked !== 'true' && document.documentElement.dataset.workspaceReady !== 'false';
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  function create({ key, trigger, title, content, onClose }) {
    if (!/^[a-z][a-z0-9-]*$/i.test(key) || !trigger || !content || !window.DailySpaceDialogHistory) throw new Error('Invalid interaction surface.');
    const root = document.createElement('div'); root.id = `surface-${key}`; root.className = 'interaction-surface'; root.hidden = true; root.dataset.dialogRoot = ''; root.dataset.surfaceKey = key; root.dataset.i18nIgnore = '';
    const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.className = 'interaction-surface-backdrop'; backdrop.dataset.dialogClose = ''; backdrop.tabIndex = -1;
    const panel = document.createElement('section'); panel.className = 'interaction-surface-panel'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','false'); panel.tabIndex = -1;
    const header = document.createElement('header'), heading = document.createElement('h2'); heading.id = `surface-${key}-title`; panel.setAttribute('aria-labelledby',heading.id);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'interaction-surface-close'; dismiss.dataset.dialogClose = ''; dismiss.textContent = '×';
    header.append(heading,dismiss); const body = document.createElement('div'); body.className = 'interaction-surface-body'; body.append(content); panel.append(header,body); root.append(backdrop,panel); document.body.append(root);
    const motion = window.DailySpaceDialogHistory.motion(root), fit = window.DailySpaceDialogHistory.fitViewport(root);
    let openedOwner = '', historyEntry = false, frame = 0, restoring = false;
    const controller = window.DailySpaceDialogHistory.create(`surface-${key}`, { transient:true, isOpen:()=>!root.hidden&&!motion.closing,
      restore:()=>open({fromHistory:true}), close:()=>close({history:false}) });
    trigger.setAttribute('aria-haspopup','dialog'); trigger.setAttribute('aria-controls',root.id); trigger.setAttribute('aria-expanded','false');
    function labels() { heading.textContent = typeof title === 'function' ? title() : title; dismiss.setAttribute('aria-label',t('Close','关闭')); backdrop.setAttribute('aria-label',t('Close','关闭')); }
    function notify(opened) { trigger.setAttribute('aria-expanded',String(opened)); root.dispatchEvent(new CustomEvent('surfacechange',{detail:{open:opened}})); }
    function position() {
      cancelAnimationFrame(frame); frame = 0;
      if (root.hidden || motion.closing) return;
      const sheet = mobile(), wasSheet = root.classList.contains('is-sheet'), focused = document.activeElement;
      const keepFocus = wasSheet !== sheet && panel.contains(focused);
      root.classList.toggle('is-sheet',sheet); panel.setAttribute('aria-modal',String(sheet)); fit();
      if(keepFocus)requestAnimationFrame(()=>{if(api.isOpen()&&focused.isConnected&&(document.activeElement===trigger||document.activeElement===focused||document.activeElement===document.body))focused.focus({preventScroll:true});});
      panel.style.removeProperty('left'); panel.style.removeProperty('top'); panel.style.removeProperty('max-height');
      if (sheet) {
        if (!historyEntry && !restoring) historyEntry = controller.push({});
        return;
      }
      const viewport = window.visualViewport, top = viewport?.offsetTop || 0, left = viewport?.offsetLeft || 0;
      const styles=getComputedStyle(panel), gap=parseFloat(styles.getPropertyValue('--space-sm'))||8, edge=parseFloat(styles.getPropertyValue('--space-md'))||18;
      const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
      const anchor = trigger.getBoundingClientRect();
      panel.style.maxHeight = `${Math.max(44,height-edge*2)}px`;
      const box = panel.getBoundingClientRect();
      const x = Math.max(left+edge,Math.min(anchor.right-box.width,left+width-edge-box.width));
      const below = anchor.bottom+gap, above = anchor.top-gap-box.height;
      const y = below+box.height<=top+height-edge ? below : above>=top+edge ? above : Math.max(top+edge,Math.min(below,top+height-edge-box.height));
      panel.style.left = `${x}px`; panel.style.top = `${y}px`;
    }
    function schedule() { if (!frame) frame=requestAnimationFrame(position); }
    function open(options={}) {
      if (!ready() || !trigger.isConnected || trigger.disabled || trigger.closest('[inert]')) return false;
      if (!root.hidden && !motion.closing) { schedule(); return true; }
      current?.close({immediate:true,restoreFocus:false,history:false}); openedOwner=owner(); restoring=Boolean(options.fromHistory); historyEntry=restoring;
      const needsEntry=mobile()||(history.state?.workspaceSheet?.transient&&history.state.workspaceSheet.owner===owner());
      if (needsEntry && !restoring && !controller.push({})) return false;
      if (needsEntry) historyEntry=true;
      labels(); motion.open(); position(); restoring=false; current=api; notify(true);
      requestAnimationFrame(()=>{
        if (root.hidden||motion.closing||openedOwner!==owner())return;
        (body.querySelector('input:not(:disabled),select:not(:disabled),button:not(:disabled),a[href]')||dismiss).focus({preventScroll:true});
      });
      return true;
    }
    function close(options={}) {
      if (root.hidden||motion.closing) return;
      const restore=options.restoreFocus!==false, who=openedOwner; cancelAnimationFrame(frame); frame=0; notify(false);
      if (options.history!==false && historyEntry) controller.back(); historyEntry=false;
      motion.close(()=>{
        if (current===api)current=null;
        onClose?.();
        if (restore&&who===owner()&&ready()&&trigger.isConnected&&!trigger.closest('[inert]'))trigger.focus({preventScroll:true});
      },Boolean(options.immediate));
    }
    const api={root,panel,open,close,toggle:()=>root.hidden||motion.closing?open():close(),isOpen:()=>!root.hidden&&!motion.closing,reposition:schedule};
    trigger.addEventListener('click',event=>{event.preventDefault();api.toggle();}); backdrop.addEventListener('click',()=>close()); dismiss.addEventListener('click',()=>close());
    body.addEventListener('click',event=>{if(!api.isOpen()||!ready()||openedOwner!==owner()){event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener('pointerdown',event=>{if(api.isOpen()&&!root.contains(event.target)&&!trigger.contains(event.target))close({restoreFocus:false});},true);
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||!api.isOpen())return;
      const top=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(node=>!node.closest('[hidden]')).at(-1);
      if(top&&top!==panel)return;
      event.preventDefault();event.stopImmediatePropagation();close();
    },true);
    root.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(api.isOpen()&&!mobile()&&!root.contains(document.activeElement)&&document.activeElement!==trigger)close({restoreFocus:false});}));
    for(const event of ['resize','scroll'])window.addEventListener(event,schedule,{capture:true,passive:true});
    for(const event of ['resize','scroll'])window.visualViewport?.addEventListener(event,schedule,{passive:true});
    window.addEventListener('daily-space-locale-changed',()=>{labels();schedule();});
    window.addEventListener('daily-space-auth-updated',()=>close({history:false,restoreFocus:false,immediate:true}));
    window.addEventListener('daily-space-user-sync-updated',()=>{if(!ready()&&api.isOpen())close({history:false,restoreFocus:false,immediate:true});});
    labels(); return api;
  }
  window.DailySpaceSurfaces={create};
})();
