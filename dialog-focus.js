/** Shared keyboard and background isolation for all modal dialogs. */
(function () {
  const selector = '[role="dialog"][aria-modal="true"]';
  const focusSelector = 'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]';
  const frames = [];
  const isolated = new Map();
  let lastInteraction = null;
  let lastFocus = null;
  let overflow = null;
  let synchronizing = false;
  let lastHistorySheet = history.state?.workspaceSheet || null;
  let changingSheetHistory = false, historyChangeTimer = null;
  function markHistoryTraversal() {
    changingSheetHistory = true; clearTimeout(historyChangeTimer);
    // popstate precedes the hashchange from the same Back/Forward traversal.
    historyChangeTimer = setTimeout(() => { changingSheetHistory = false; }, 0);
  }
  window.addEventListener('popstate', event => {
    const next = event.state?.workspaceSheet || null;
    if (lastHistorySheet || next) markHistoryTraversal();
    lastHistorySheet = next;
  }, true);

  // Only the explicit handle owns this gesture; form scrolling remains native.
  function sheetDrag(root, panel) {
    if (root.dataset.sheetDragReady) return panel.querySelector('[data-sheet-drag-handle]');
    root.dataset.sheetDragReady = 'true';
    panel.dataset.sheetPanel = '';
    const semanticDialog = panel.matches(selector) ? panel : root.matches(selector) ? root : root.querySelector(selector) || panel;
    const handle = panel.querySelector('.m-sheet-handle') || document.createElement('div');
    handle.classList.add('workspace-sheet-handle'); handle.dataset.sheetDragHandle = ''; handle.setAttribute('aria-hidden','true');
    if (!handle.parentElement) panel.prepend(handle);
    let drag = null, resetTimer = 0;
    const isPhone = () => document.body.classList.contains('todo-mobile') || document.body.classList.contains('has-mobile-dock') || matchMedia('(max-width: 819px)').matches;
    function reset(animate=false) {
      drag=null; if(root.classList.contains('workspace-sheet-dragging'))root.classList.remove('workspace-sheet-dragging');
      if(root.classList.contains('workspace-sheet-snap')!==animate)root.classList.toggle('workspace-sheet-snap',animate); panel.style.removeProperty('translate');
      clearTimeout(resetTimer); if(animate)resetTimer=setTimeout(()=>{if(root.classList.contains('workspace-sheet-snap'))root.classList.remove('workspace-sheet-snap');},160);
    }
    handle.addEventListener('pointerdown',event=>{
      if(!isPhone()||root.hidden||root.classList.contains('is-closing')||event.button!==0||event.isPrimary===false)return;
      sync(); if(frames.at(-1)?.dialog!==semanticDialog)return;
      reset(); drag={id:event.pointerId,x:event.clientX,y:event.clientY,lastY:event.clientY,time:performance.now(),distance:0};
      try{handle.setPointerCapture(event.pointerId);}catch(_){}
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      sync(); if(frames.at(-1)?.dialog!==semanticDialog){reset(true);return;}
      const dy=event.clientY-drag.y, dx=Math.abs(event.clientX-drag.x);
      if(dx>Math.max(12,Math.abs(dy)*1.25)){reset(true);return;}
      drag.distance=Math.max(0,dy);drag.lastY=event.clientY;
      if(drag.distance<6)return;
      event.preventDefault(); root.classList.add('workspace-sheet-dragging');panel.style.translate=`0 ${Math.min(drag.distance,panel.getBoundingClientRect().height*.8)}px`;
    });
    handle.addEventListener('pointerup',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      sync(); if(frames.at(-1)?.dialog!==semanticDialog){reset(true);return;}
      const elapsed=Math.max(1,performance.now()-drag.time), distance=drag.distance;
      const dismiss=distance>=Math.min(112,panel.getBoundingClientRect().height*.24)||(distance>44&&distance/elapsed>.6);
      reset(!dismiss);
      if(dismiss)root.querySelector('[data-dialog-close]')?.click();
    });
    for(const event of ['pointercancel','lostpointercapture'])handle.addEventListener(event,()=>{if(drag)reset(true);});
    new MutationObserver(()=>{if(root.hidden||root.classList.contains('is-closing'))reset();}).observe(root,{attributes:true,attributeFilter:['hidden','class']});
    window.addEventListener('blur',()=>reset());
    return handle;
  }

  function visible(element) {
    return element.isConnected && !element.closest('[hidden]') && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden";
  }

  function focusable(dialog) {
    return [...dialog.querySelectorAll(focusSelector)].filter(element =>
      visible(element) && !element.matches(":disabled") && element.tabIndex >= 0 && !element.closest("[inert]"));
  }

  function restoreBackground() {
    for (const [element, inert] of isolated) element.inert = inert;
    isolated.clear();
  }

  function isolate(root) {
    for (let branch = root; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children || []) {
        if (sibling !== branch) {
          isolated.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
    }
  }

  function focusInside(dialog) {
    const target = focusable(dialog)[0];
    if (target) target.focus({ preventScroll: true });
    else {
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      dialog.focus({ preventScroll: true });
    }
  }

  function sync(previousFocus) {
    if (synchronizing || !document.body) return;
    synchronizing = true;
    try {
      const dialogs = [...document.querySelectorAll(selector)].filter(visible);
      const oldTop = frames.at(-1);
      const closed = frames.filter(frame => !dialogs.includes(frame.dialog));
      for (let i = frames.length - 1; i >= 0; i--) {
        if (!dialogs.includes(frames[i].dialog)) frames.splice(i, 1);
      }
      for (const dialog of dialogs) {
        if (frames.some(frame => frame.dialog === dialog)) continue;
        const root = dialog.closest("[data-dialog-root]") || dialog;
        const opener = [lastInteraction, previousFocus, lastFocus, document.activeElement]
          .find(element => element instanceof HTMLElement && element.isConnected && !root.contains(element));
        frames.push({ dialog, root, opener });
        lastInteraction = null;
      }
      const top = frames.at(-1);
      if (top !== oldTop) {
        restoreBackground();
        if (top) {
          if (overflow === null) { overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
          isolate(top.root);
          const returning = closed.find(frame => frame === oldTop)?.opener;
          if (returning && top.dialog.contains(returning)) returning.focus({ preventScroll: true });
          if (!top.dialog.contains(document.activeElement)) focusInside(top.dialog);
        } else {
          if (overflow !== null) { document.body.style.overflow = overflow; overflow = null; }
          const opener = closed.find(frame => frame === oldTop)?.opener;
          if (opener && visible(opener) && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
        }
      }
    } finally { synchronizing = false; }
  }

  document.addEventListener("pointerdown", event => {
    lastInteraction = event.target.closest('button, a[href], [tabindex], [contenteditable="true"]');
  }, true);
  document.addEventListener("focusin", event => {
    sync(event.relatedTarget);
    const top = frames.at(-1);
    if (top && !top.dialog.contains(event.target)) focusInside(top.dialog);
    lastFocus = document.activeElement;
  }, true);
  document.addEventListener("keydown", event => {
    sync();
    const top = frames.at(-1);
    if (!top) return;
    if (event.key === "Escape") {
      const close = top.root.querySelector('[data-dialog-close]');
      if (close) { event.preventDefault(); event.stopImmediatePropagation(); close.click(); }
    } else if (event.key === "Tab") {
      const controls = focusable(top.dialog);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); focusInside(top.dialog); }
      else if (!top.dialog.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  }, true);

  function start() {
    new MutationObserver(() => sync()).observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class", "style", "aria-modal"],
    });
    sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  // Use one history entry per editor so the phone Back gesture closes it first.
  window.DailySpaceDialogHistory = {
    isChangingHistory() { return changingSheetHistory; },
    attachGesture(root, panel = root.matches('[role="dialog"]') ? root : root.querySelector('[role="dialog"]')) {
      return panel ? sheetDrag(root,panel) : null;
    },
    // Keep isolation and focus trapping active until the exit finishes.
    motion(root) {
      let timer = null;
      root.classList.add("workspace-sheet-motion");
      const panel = root.querySelector('[role="dialog"]'); panel.dataset.sheetPanel = "";
      sheetDrag(root,panel);
      root.firstElementChild.dataset.sheetBackdrop = "";
      const cancel = () => { clearTimeout(timer); timer = null; root.classList.remove("is-closing"); };
      return {
        get closing() { return root.classList.contains("is-closing"); },
        open() { cancel(); root.hidden = false; },
        close(done, immediate = false) {
          cancel();
          const finish = () => { root.hidden = true; cancel(); done?.(); window.DailySpaceUndo?.reposition(); };
          if (root.hidden || immediate || matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
          else { root.classList.add("is-closing"); timer = setTimeout(finish, 160); }
        },
      };
    },
    create(key, { isOpen, restore, close, transient = false }) {
      let closing = false;
      window.addEventListener("popstate", () => {
        if (closing) { closing = false; return; }
        const state = history.state?.workspaceSheet;
        if (state?.key === key && state.owner === window.DailySpaceView?.owner()) restore(state.data);
        else if (isOpen()) close(true);
      });
      return {
        push(data) {
          if (closing) return false;
          const owner = window.DailySpaceView?.owner();
          const next = { ...history.state, workspaceSheet: { key, data, owner, ...(transient ? { transient:true } : {}) } };
          const previous = history.state?.workspaceSheet;
          if (previous?.key === key || (previous?.transient && previous.owner === owner)) history.replaceState(next, "", location.href);
          else history.pushState(next, "", location.href);
          lastHistorySheet = next.workspaceSheet;
          return true;
        },
        back() {
          if (history.state?.workspaceSheet?.key !== key) return;
          closing = true;
          lastHistorySheet = history.state.workspaceSheet; markHistoryTraversal();
          history.back();
        },
      };
    },
    fitViewport(root) {
      const update = () => {
        root.style.setProperty("--workspace-sheet-height", `${window.visualViewport?.height || innerHeight}px`);
        root.style.setProperty("--workspace-sheet-top", `${window.visualViewport?.offsetTop || 0}px`);
      };
      window.visualViewport?.addEventListener("resize", update);
      window.visualViewport?.addEventListener("scroll", update);
      window.addEventListener("resize", update);
      update();
      return update;
    },
  };
})();
