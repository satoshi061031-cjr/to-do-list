/** Keep task rows stable across edits; only new rows animate in. */
(function () {
  const lists = new WeakMap();

  function motionToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) return fallback;
    if (name.startsWith("--ease")) return value;
    const time = parseFloat(value);
    return Number.isFinite(time) ? (value.endsWith("ms") ? time : time * 1000) : fallback;
  }

  /**
   * An explicit completion or delete fades the row with transform/opacity only,
   * then the rows below slide up through the shared layout motion. Nothing
   * animates height or padding, so the list never re-lays out per frame.
   */
  function depart(container, state, id, row, kind) {
    const node = row.node;
    window.DailySpaceLayoutMotion?.cancelNode(node);
    node.classList.add("is-leaving");
    if (kind === "complete") {
      node.classList.add("completed");
      const check = node.querySelector(".todo-check");
      if (check) check.checked = true;
    }
    node.inert = true;
    const exit = kind === "complete"
      ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(12px) scale(0.98)" }]
      : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-16px)" }];
    row.leaving = node.animate(exit, {
      duration: motionToken("--motion-base", 180),
      // Let the check mark register before a completed row leaves.
      delay: kind === "complete" ? motionToken("--motion-fast", 150) : 0,
      easing: motionToken("--ease-out", "cubic-bezier(0.22, 1, 0.36, 1)"),
      fill: "forwards",
    });
    row.leaving.finished.then(() => {
      if (state.rows.get(id) !== row) return;
      state.rows.delete(id);
      const motion = window.DailySpaceLayoutMotion;
      if (motion && container.contains(node)) motion.run(container, () => node.remove());
      else node.remove();
    }).catch(() => { /* Reopening or restoring the task cancels its departure. */ });
  }

  function render(container, items, { signature, create, completedId, removedId, fallbackFocus }) {
    let state = lists.get(container);
    if (!state) {
      state = { rows: new Map(), initialized: false };
      container.replaceChildren();
      lists.set(container, state);
    }
    const wanted = new Set(items.map(item => item.id));
    let focus = null;
    for (const [id, row] of state.rows) {
      if (wanted.has(id) || row.leaving) continue;
      if (row.node.contains(document.activeElement)) focus = { removed: true, index: [...container.children].indexOf(row.node) };
      const kind = id === completedId ? "complete" : id === removedId ? "delete" : null;
      if (kind && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && row.node.animate) {
        depart(container, state, id, row, kind);
      } else {
        window.DailySpaceLayoutMotion?.cancelNode(row.node);
        row.node.remove();
        state.rows.delete(id);
      }
    }

    items.forEach((item, index) => {
      let row = state.rows.get(item.id);
      const nextSignature = signature(item);
      const editing = row?.node.contains(document.activeElement) && document.activeElement.isContentEditable;
      if (!editing && (!row || row.signature !== nextSignature || row.leaving)) {
        const previous = row?.node;
        const active = previous?.contains(document.activeElement) ? document.activeElement : null;
        const focusedClass = active && [...active.classList][0];
        row?.leaving?.cancel();
        const node = create(item);
        if (previous) {
          window.DailySpaceLayoutMotion?.cancelNode(previous);
          previous.replaceWith(node);
        } else if (state.initialized) {
          node.classList.add("is-entering");
          node.addEventListener("animationend", () => node.classList.remove("is-entering"), { once: true });
        }
        row = { node, signature: nextSignature };
        state.rows.set(item.id, row);
        if (active) focus = { node: active.isConnected ? active : focusedClass && node.querySelector(`.${CSS.escape(focusedClass)}`) };
      }
      const current = [...container.children].filter(node => !node.classList.contains("is-leaving"));
      if (current[index] !== row.node) container.insertBefore(row.node, current[index] || null);
    });
    state.initialized = true;
    if (focus?.removed) {
      const rows = [...container.children].filter(node => !node.inert);
      const next = rows[Math.min(focus.index, rows.length - 1)];
      (next?.querySelector(".todo-check") || fallbackFocus)?.focus({ preventScroll: true });
    } else if (focus?.node) focus.node.focus({ preventScroll: true });
  }

  window.DailySpaceTaskList = { render };
})();
