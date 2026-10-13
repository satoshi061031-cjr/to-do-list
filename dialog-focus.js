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
})();
