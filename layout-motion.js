/** Small position-only transitions, opted into by an explicit reorder action. */
(function () {
  const duration = 180;
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const running = new Map();
  const pending = new Map();
  const versions = new WeakMap();
  const held = new Set();
  let releaseFrame = 0;
  let generation = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const owner = () => window.DailySpaceView?.owner() || 'guest';
  const ready = () => document.documentElement.dataset.workspaceLocked !== 'true' && document.documentElement.dataset.workspaceReady !== 'false';

  function key(node) {
    return node.dataset.motionKey || node.dataset.id || node.dataset.workbenchSection || node.dataset.overviewWidget ||
      node.querySelector('[data-section-visibility]')?.dataset.sectionVisibility ||
      node.querySelector('[data-widget-up]')?.dataset.widgetUp || node.querySelector('[data-widget-down]')?.dataset.widgetDown || null;
  }
  function visible(node) {
    return node?.isConnected && !node.closest('[hidden]') && node.getClientRects().length > 0;
  }
  function interactiveMovement(node) {
    return node.matches('.is-swiping, .is-leaving, [data-swipe="open"]') || Boolean(node.querySelector('.is-swiping, [data-swipe="open"]'));
  }
  function cancelNode(node) {
    const item = running.get(node);
    if (item) { running.delete(node); item.animation.cancel(); }
  }
  function cancel(container) {
    if (container) versions.set(container, (versions.get(container) || 0) + 1);
    else generation++;
    for (const [target, request] of pending) {
      if (!container || target === container || container.contains(target)) {
        cancelAnimationFrame(request.frame); pending.delete(target);
      }
    }
    for (const [node, item] of running) if (!container || item.container === container || container.contains(node)) cancelNode(node);
    for (const target of held) if (!container || target === container || container.contains(target)) held.delete(target);
    if (!held.size) { cancelAnimationFrame(releaseFrame); releaseFrame = 0; }
  }
  function scrollPositions(container) {
    const result = [];
    for (let node = container; node; node = node.parentElement) result.push([node, node.scrollTop, node.scrollLeft]);
    return result;
  }
  function focusPosition(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active)) return null;
    const row = [...container.children].find(node => node.contains(active));
    if (!row || !key(row)) return null;
    return { active, key: key(row), id: active.id, tag: active.tagName, text: active.textContent,
      move: active.dataset.planningMove, delta: active.dataset.planningDelta,
      label: active.getAttribute('aria-label'), name: active.getAttribute('name') };
  }
  function viewportChanged(snapshot) {
    return snapshot.width !== innerWidth || snapshot.height !== innerHeight || snapshot.scrollX !== scrollX || snapshot.scrollY !== scrollY ||
      snapshot.scroll.some(([node, top, left]) => node.scrollTop !== top || node.scrollLeft !== left);
  }
  function capture(container) {
    if (!container || !visible(container) || document.hidden || !ready()) return null;
    const positions = new Map();
    const parent = container.getBoundingClientRect();
    for (const child of container.children) {
      const id = key(child);
      if (!id || !visible(child) || interactiveMovement(child)) continue;
      const rect = child.getBoundingClientRect();
      positions.set(id, { left: rect.left - parent.left, top: rect.top - parent.top });
    }
    const snapshot = { container, owner: owner(), positions, focus: focusPosition(container), motion: !reduced.matches, width: innerWidth, height: innerHeight,
      scrollX, scrollY, scroll: scrollPositions(container), played: false };
    // Read the currently painted positions before removing an interrupted move.
    cancel(container);
    snapshot.version = versions.get(container); snapshot.generation = generation;
    return snapshot;
  }
  function restoreFocus(snapshot) {
    const wanted = snapshot.focus;
    if (!wanted ||
        (document.activeElement !== document.body && !snapshot.container.contains(document.activeElement))) return;
    if (wanted.active.isConnected && visible(wanted.active) && !wanted.active.disabled) {
      if (document.activeElement !== wanted.active) wanted.active.focus({ preventScroll: true });
      return;
    }
    const row = [...snapshot.container.children].find(node => key(node) === wanted.key);
    if (!row) return;
    const candidates = [...row.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(node => visible(node) && !node.disabled);
    let match;
    if (wanted.move) {
      match = candidates.find(node => node.dataset.planningMove === wanted.move && node.dataset.planningDelta === wanted.delta) ||
        candidates.find(node => node.dataset.planningMove === wanted.move);
    } else {
      match = candidates.find(node => wanted.id && node.id === wanted.id) ||
        candidates.find(node => node.tagName === wanted.tag && (wanted.label ? node.getAttribute('aria-label') === wanted.label : wanted.name ? node.getAttribute('name') === wanted.name : node.textContent === wanted.text));
    }
    match?.focus({ preventScroll: true });
  }
  function play(snapshot) {
    if (!snapshot || snapshot.played || snapshot.version !== versions.get(snapshot.container) || snapshot.generation !== generation) return;
    snapshot.played = true;
    const { container } = snapshot;
    // Focus belongs to the reorder, including when reduced motion, scrolling,
    // or another gesture prevents its visual transition from playing.
    queueMicrotask(() => {
      if (visible(container) && ready() && !document.hidden && snapshot.owner === owner()) restoreFocus(snapshot);
    });
    const request = { frame: 0, snapshot };
    pending.set(container, request);
    request.frame = requestAnimationFrame(() => {
      if (pending.get(container) !== request) return;
      pending.delete(container);
      if (!visible(container) || document.hidden || !ready() || snapshot.version !== versions.get(container) || snapshot.generation !== generation || snapshot.owner !== owner() ||
          viewportChanged(snapshot)) return;
      if (!snapshot.motion || reduced.matches) return;
      const parent = container.getBoundingClientRect();
      for (const node of container.children) {
        const before = snapshot.positions.get(key(node));
        if (!before || !visible(node) || interactiveMovement(node) || typeof node.animate !== 'function') continue;
        const style = getComputedStyle(node);
        // Existing swipe/entry transforms own their visual channel. Leave them alone.
        if (style.transform !== 'none') continue;
        const rect = node.getBoundingClientRect(), dx = before.left - (rect.left - parent.left), dy = before.top - (rect.top - parent.top);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        const animation = node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], { duration, easing });
        running.set(node, { container, animation, snapshot });
        const clear = () => { if (running.get(node)?.animation === animation) running.delete(node); };
        animation.finished.then(clear, clear);
      }
    });
  }
  function run(container, change) {
    const snapshot = capture(container);
    let result;
    try { result = change(); } catch (error) { play(snapshot); throw error; }
    if (result && typeof result.then === 'function') return Promise.resolve(result).finally(() => play(snapshot));
    play(snapshot); return result;
  }
  function cancelForInteraction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[data-planning-move], [data-section-up], [data-section-down], [data-widget-up], [data-widget-down]')) return;
    for (const container of new Set([...running.values()].map(item => item.container).concat([...pending.keys()]))) {
      if (container.contains(target)) cancel(container);
    }
  }
  function holdForPointer(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[data-planning-move], [data-section-up], [data-section-down], [data-widget-up], [data-widget-down]')) return;
    if (event.touches?.length > 1 || event.isPrimary === false) { cancel(); return; }
    // Keep the painted hit target under the finger until click has dispatched.
    // Cancelling a translate on pointerdown would move a checkbox between down
    // and up, dropping the click or activating a different row instead.
    for (const container of [...pending.keys()]) if (container.contains(target)) cancel(container);
    const containers = new Set([...running.values()].filter(item => item.container.contains(target)).map(item => item.container));
    for (const item of running.values()) if (containers.has(item.container)) { item.animation.pause(); held.add(item.container); }
  }
  function releasePointer() {
    if (!held.size) return;
    cancelAnimationFrame(releaseFrame);
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0;
      const containers = new Set(held); held.clear();
      for (const item of running.values()) if (containers.has(item.container) && item.animation.playState === 'paused') item.animation.play();
    });
  }
  document.addEventListener('pointerdown', holdForPointer, true);
  document.addEventListener('touchstart', holdForPointer, { capture: true, passive: true });
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('touchend', releasePointer, { capture: true, passive: true });
  document.addEventListener('click', releasePointer, true);
  document.addEventListener('pointercancel', () => cancel(), true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); else if (['Enter', ' '].includes(event.key)) cancelForInteraction(event); }, true);
  document.addEventListener('scroll', () => {
    // A queued scroll event from bringing the clicked control into view may
    // arrive after capture. Cancel only a real change since that capture.
    for (const [container, request] of pending) if (request.snapshot && viewportChanged(request.snapshot)) cancel(container);
    for (const item of [...running.values()]) if (viewportChanged(item.snapshot)) cancel(item.container);
  }, true);
  window.addEventListener('resize', () => cancel());
  window.addEventListener('blur', () => cancel());
  window.addEventListener('storage', () => cancel());
  window.addEventListener('daily-space-auth-updated', () => cancel());
  window.addEventListener('daily-space-user-sync-updated', () => { if (!ready()) cancel(); });
  window.addEventListener('daily-space-agent-data-updated', event => { if (event.detail?.source === 'cloud-sync') cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    for (const node of [...running.keys()]) cancelNode(node);
    // Changing motion preference must not discard keyboard focus restoration.
    for (const request of pending.values()) request.snapshot.motion = false;
  });
  window.DailySpaceLayoutMotion = { capture, play, run, cancel, cancelNode };
})();
