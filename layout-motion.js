/** Small layout and shared-title transitions, opted into by an explicit action. */
(function () {
  // Read the shared CSS motion tokens (styles.css :root) so JS and CSS stay in step.
  const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const ms = (name, fallback) => { const value = token(name, ''), time = parseFloat(value); return Number.isFinite(time) ? (value.endsWith('ms') ? time : time * 1000) : fallback; };
  const running = new Map();
  const pending = new Map();
  const versions = new WeakMap();
  const held = new Set();
  const titles = new Map();
  const surfaces = new Map();
  const hosts = new WeakMap();
  const continuity = () => token('--ease-continuity', 'cubic-bezier(.32, .72, 0, 1)');
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
    if (item) { running.delete(node); if (item.raised) node.style.zIndex = item.zIndex; item.animation.cancel(); }
  }
  function cancel(container, { finishSurfaces = true, preserveSurfaces = false, preserveTitles = false } = {}) {
    for (const [panel, surface] of [...surfaces]) if (!preserveSurfaces && (!container || panel === container || container.contains(panel))) {
      if (finishSurfaces) surface.finish(); else surface.cancel();
    }
    for (const [scope, title] of titles) if (!preserveTitles && (!container || scope === container || container.contains(scope))) title.cancel();
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
  function play(snapshot, options = {}) {
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
        const animation = node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], { duration: options.duration || ms('--motion-base', 180), easing: options.easing || token('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)') });
        const zIndex = node.style.zIndex, raised = key(node) === snapshot.focus?.key;
        if (raised) node.style.zIndex = '1';
        running.set(node, { container, animation, snapshot, zIndex, raised });
        const clear = () => { if (running.get(node)?.animation === animation) { running.delete(node); if (raised) node.style.zIndex = zIndex; } };
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

  // A visual snapshot only: the real editor stays focused and usable, including
  // the initiating phone gesture that opens its keyboard. Never copy markup.
  function captureTitle(node) {
    for (const title of titles.values()) if (title.nodes.includes(node)) {
      const snapshot = captureTitle(title.copy);
      if (snapshot) { const scale = Math.abs(new DOMMatrixReadOnly(getComputedStyle(title.copy).transform).m11); snapshot.size *= scale; snapshot.line *= scale; snapshot.sourceNodes = title.nodes; }
      return snapshot;
    }
    if (reduced.matches || !visible(node) || !ready()) return null;
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    const text = String('value' in node ? node.value : node.textContent).trim();
    const size = parseFloat(style.fontSize), line = parseFloat(style.lineHeight) || size * 1.5;
    const field = node.matches('input, textarea');
    const x = rect.left + (field ? parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) : 0);
    const y = field ? rect.top + (rect.height - line) / 2 : rect.top;
    const width = rect.width - (field ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : 0);
    // Wrapped/clipped text has no faithful single-line match. Keep those views
    // quiet rather than flying a misleading copy across the screen.
    if (!text || (!field && rect.height > line * 1.6) || node.scrollLeft > 0 || node.scrollWidth > node.clientWidth + 1 || y < 0 || y + line > innerHeight) return null;
    return { node, text, x, y, width, size, line, font: style.font, color: style.color, spacing: style.letterSpacing, owner: owner() };
  }
  function carryTitle(before, target, { container = target, returning = false, duration: time, easing: curve } = {}) {
    titles.get(container)?.cancel();
    const after = captureTitle(target);
    if (!before || !after || before.owner !== owner() || before.text !== after.text || document.hidden || typeof target.animate !== 'function') return;
    const sheet = target.closest('[data-sheet-panel]');
    if (sheet && !sheet.closest('.workspace-sheet-dragging')) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
      after.x -= matrix.m41; after.y -= matrix.m42;
    }
    const dx = before.x - after.x, dy = before.y - after.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    const copy = document.createElement('span');
    copy.className = 'continuity-title'; copy.textContent = after.text; copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
    Object.assign(copy.style, { left: `${after.x}px`, top: `${after.y}px`, width: `${after.width}px`, font: after.font, lineHeight: `${after.line}px`, color: after.color, letterSpacing: after.spacing });
    document.body.append(copy);
    const hidden = [...new Set([before.node, ...(before.sourceNodes || []), target])].filter(node => node?.isConnected);
    hidden.forEach(node => node.classList.add('continuity-title-target'));
    const animation = copy.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${before.size / after.size})` }, { transform: 'translate(0px, 0px) scale(1)' }], { duration: time || (returning ? ms('--motion-exit', 160) : ms('--motion-base', 180)), easing: curve || token('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)'), fill: 'both' });
    let cancelled = false;
    const item = {
      returning, nodes: hidden, copy,
      snapshot: { width: innerWidth, height: innerHeight, scrollX, scrollY, scroll: scrollPositions(target) },
      rebase() {
        const rect = captureTitle(target);
        if (!rect) { item.cancel(); return; }
        copy.style.left = `${rect.x}px`; copy.style.top = `${rect.y}px`;
        item.snapshot = { width: innerWidth, height: innerHeight, scrollX, scrollY, scroll: scrollPositions(target) };
      },
      cancel() {
        if (cancelled) return;
        cancelled = true; animation.cancel(); copy.remove();
        hidden.forEach(node => node.classList.remove('continuity-title-target'));
        if (titles.get(container) === item) titles.delete(container);
      },
    };
    titles.set(container, item); animation.finished.then(() => item.cancel(), () => item.cancel());
  }

  function surfaceTiming(kind = 'panel', returning = false) {
    const phone = document.body.classList.contains('todo-mobile') || matchMedia('(max-width: 819px)').matches;
    const full = kind === 'panel';
    return { duration: phone ? full ? returning ? 400 : 480 : returning ? 300 : 360 : full ? returning ? 260 : 320 : returning ? 200 : 240, easing: continuity() };
  }
  function captureOpacity(nodes) {
    return new Map([...nodes].map(node => [node, visible(node) && node.getBoundingClientRect().height > 0 ? Number(getComputedStyle(node).opacity) : 0]));
  }
  function captureSurface(node) {
    const active = surfaces.get(node);
    if (active) return { ...captureSurface(active.frame), interrupted: true };
    if (!visible(node)) return null;
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (rect.width < 1 || rect.height < 1) return null;
    // Composite the existing ancestor fills into one opaque material. Canvas
    // accepts the same rgb/color-mix/oklab values as the design's CSS tokens.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'), layers = [];
    for (let parent = node; parent; parent = parent.parentElement) layers.unshift(getComputedStyle(parent).backgroundColor);
    context.fillStyle = style.getPropertyValue('--panel-fill').trim() || 'Canvas'; context.fillRect(0, 0, 1, 1);
    for (const color of layers) { context.fillStyle = color; context.fillRect(0, 0, 1, 1); }
    const color = context.getImageData(0, 0, 1, 1).data, background = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    const radius = Math.min((parseFloat(style.borderTopLeftRadius) || 0) * (node.classList.contains('continuity-surface') ? rect.width / node.offsetWidth : 1), rect.width / 2, rect.height / 2);
    return { node, x: rect.left, y: rect.top, width: rect.width, height: rect.height, radius, background, border: style.borderTopColor, borderWidth: style.borderTopWidth, shadow: style.boxShadow, owner: owner() };
  }
  function morphSurface(panel, { host = panel.parentElement, from, to, returning = false, incoming = !returning, kind = 'panel', keepFill = false, above = false, contents, contentOpacity, retiring = [], onFinish } = {}) {
    surfaces.get(panel)?.cancel();
    if (reduced.matches || !from || from.owner !== owner() || !ready() || !visible(panel) || typeof panel.animate !== 'function') { retiring.forEach(node => node.remove()); onFinish?.(); return null; }
    const savedPanel = { position: panel.style.position, zIndex: panel.style.zIndex };
    const savedHost = hosts.get(host) || { count: 0, position: host.style.position, zIndex: host.style.zIndex };
    if (!savedHost.count && getComputedStyle(host).position === 'static') { host.style.position = 'relative'; host.style.zIndex = 'auto'; }
    savedHost.count++; hosts.set(host, savedHost);
    panel.dataset.continuitySurface = ''; panel.classList.add('continuity-panel-active');
    to ||= captureSurface(panel);
    if (!keepFill) panel.classList.add('continuity-clear-fill');
    if (getComputedStyle(panel).position === 'static') panel.style.position = 'relative';
    panel.style.zIndex = '1';
    if (!to || to.owner !== owner()) { panel.classList.remove('continuity-panel-active', 'continuity-clear-fill'); panel.style.position = savedPanel.position; panel.style.zIndex = savedPanel.zIndex; retiring.forEach(node => node.remove()); if (!--savedHost.count) { host.style.position = savedHost.position; host.style.zIndex = savedHost.zIndex; hosts.delete(host); } onFinish?.(); return null; }
    const bounds = host.getBoundingClientRect(), frame = document.createElement('div');
    frame.className = 'continuity-surface'; frame.setAttribute('aria-hidden', 'true'); frame.inert = true;
    Object.assign(frame.style, { left: `${to.x - bounds.left + host.scrollLeft - host.clientLeft}px`, top: `${to.y - bounds.top + host.scrollTop - host.clientTop}px`, width: `${to.width}px`, height: `${to.height}px`, border: `${to.borderWidth} solid ${to.border}`, backgroundColor: to.background, zIndex: above ? '2' : '0' });
    host.append(frame);
    const timing = surfaceTiming(kind, returning), dx = from.x - to.x, dy = from.y - to.y;
    const keys = [0, .25, .5, .75, 1].map(offset => {
      const sx = (from.width + (to.width - from.width) * offset) / to.width;
      const sy = (from.height + (to.height - from.height) * offset) / to.height;
      const radius = from.radius + (to.radius - from.radius) * offset;
      return { offset, transform: `translate(${dx * (1 - offset)}px, ${dy * (1 - offset)}px) scale(${sx}, ${sy})`, borderRadius: `${radius / sx}px / ${radius / sy}px` };
    });
    keys[0].backgroundColor = from.background; keys[4].backgroundColor = to.background;
    keys[0].borderColor = from.border; keys[4].borderColor = to.border;
    keys[0].boxShadow = from.shadow; keys[4].boxShadow = to.shadow;
    const animation = frame.animate(keys, { ...timing, fill: 'both' });
    const animations = [];
    for (const node of contents || [...panel.children]) {
      animations.push(node.animate([{ opacity: contentOpacity?.get(node) ?? (incoming ? 0 : 1) }, { opacity: incoming ? 1 : 0 }], { duration: timing.duration * (incoming ? .55 : .3), delay: incoming ? timing.duration * .45 : 0, fill: 'both', easing: 'ease-out' }));
    }
    retiring.forEach(node => animations.push(node.animate([{ opacity: Number(getComputedStyle(node).opacity) }, { opacity: 0 }], { duration: timing.duration * .3, fill: 'both' })));
    let stopped = false, destinationObserver = null;
    function cleanup(finish) {
      if (stopped) return; stopped = true;
      destinationObserver?.disconnect();
      if (surfaces.get(panel) === controller) surfaces.delete(panel);
      animation.cancel(); animations.forEach(item => item.cancel()); frame.remove(); retiring.forEach(node => node.remove());
      panel.classList.remove('continuity-panel-active', 'continuity-clear-fill'); panel.style.position = savedPanel.position; panel.style.zIndex = savedPanel.zIndex;
      if (!--savedHost.count) { host.style.position = savedHost.position; host.style.zIndex = savedHost.zIndex; hosts.delete(host); }
      if (finish) onFinish?.();
    }
    const controller = {
      frame, ...timing, returning, panel,
      snapshot: { width: innerWidth, height: innerHeight, scrollX, scrollY, scroll: scrollPositions(host) },
      rebase() {
        const destination = to.node?.isConnected ? to.node.getBoundingClientRect() : to;
        const bounds = host.getBoundingClientRect();
        frame.style.left = `${destination.x - bounds.left + host.scrollLeft - host.clientLeft}px`;
        frame.style.top = `${destination.y - bounds.top + host.scrollTop - host.clientTop}px`;
        controller.snapshot = { width: innerWidth, height: innerHeight, scrollX, scrollY, scroll: scrollPositions(host) };
      },
      finish: () => cleanup(true), cancel: () => cleanup(false),
    };
    surfaces.set(panel, controller); animation.finished.then(controller.finish, controller.cancel);
    if (returning && to.node && to.node !== panel) {
      destinationObserver = new MutationObserver(() => { if (!to.node.isConnected || !to.node.getClientRects().length) controller.finish(); });
      destinationObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }
    return controller;
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
  // A second interaction never has to wait for the title snapshot.
  document.addEventListener('pointerdown', () => { for (const title of [...titles.values()]) title.cancel(); }, true);
  document.addEventListener('keydown', () => { for (const title of [...titles.values()]) title.cancel(); }, true);
  document.addEventListener('input', () => { for (const title of [...titles.values()]) title.cancel(); }, true);
  document.addEventListener('input', () => { for (const surface of [...surfaces.values()]) if (!surface.returning || !surface.panel.closest('[data-dialog-root]')) surface.finish(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); else if (['Enter', ' '].includes(event.key)) cancelForInteraction(event); }, true);
  document.addEventListener('scroll', () => {
    for (const surface of [...surfaces.values()]) if (viewportChanged(surface.snapshot)) surface.finish();
    for (const title of [...titles.values()]) if (viewportChanged(title.snapshot)) title.cancel();
    // A queued scroll event from bringing the clicked control into view may
    // arrive after capture. Cancel only a real change since that capture.
    for (const [container, request] of pending) if (request.snapshot && viewportChanged(request.snapshot)) cancel(container);
    for (const item of [...running.values()]) if (viewportChanged(item.snapshot)) cancel(item.container);
  }, true);
  const viewportSignature = () => [innerWidth, innerHeight, window.visualViewport?.width, window.visualViewport?.height, window.visualViewport?.offsetLeft, window.visualViewport?.offsetTop, window.visualViewport?.scale].join(':');
  let lastViewport = viewportSignature();
  function viewportChange() {
    const nextViewport = viewportSignature();
    if (nextViewport === lastViewport) return;
    lastViewport = nextViewport;
    const phone = document.body.classList.contains('todo-mobile') || matchMedia('(max-width: 819px)').matches;
    let continuing = false;
    for (const surface of [...surfaces.values()]) {
      // A phone keyboard only changes the height: keep both opening and returning
      // panels moving, re-aimed at their latest position, instead of jumping to the end.
      if (phone && surface.snapshot.width === innerWidth) { surface.rebase(); continuing = true; }
      else surface.finish();
    }
    for (const title of [...titles.values()]) { if (continuing) title.rebase(); else title.cancel(); }
    cancel(undefined, { preserveSurfaces: true, preserveTitles: true });
  }
  window.addEventListener('resize', viewportChange);
  window.visualViewport?.addEventListener('resize', viewportChange);
  window.visualViewport?.addEventListener('scroll', viewportChange);
  window.addEventListener('blur', () => cancel());
  window.addEventListener('storage', () => cancel());
  window.addEventListener('daily-space-auth-updated', () => cancel());
  window.addEventListener('daily-space-user-sync-updated', () => { if (!ready()) cancel(); });
  window.addEventListener('daily-space-agent-data-updated', event => { if (event.detail?.source === 'cloud-sync') cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    for (const surface of [...surfaces.values()]) surface.finish();
    for (const title of [...titles.values()]) title.cancel();
    for (const node of [...running.keys()]) cancelNode(node);
    // Changing motion preference must not discard keyboard focus restoration.
    for (const request of pending.values()) request.snapshot.motion = false;
  });
  window.DailySpaceLayoutMotion = { capture, play, run, cancel, cancelNode, captureTitle, carryTitle, captureSurface, morphSurface, surfaceTiming, captureOpacity };
})();
