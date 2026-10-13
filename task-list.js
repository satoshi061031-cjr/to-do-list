/** Keep task rows stable across edits; only new rows animate in. */
(function () {
  const lists = new WeakMap();

  function render(container, items, { signature, create, completedId, fallbackFocus }) {
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
      if (id === completedId && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && row.node.animate) {
        row.node.classList.add("completed", "is-leaving");
        const check = row.node.querySelector(".todo-check");
        if (check) check.checked = true;
        row.node.inert = true;
        const style = getComputedStyle(row.node);
        row.leaving = row.node.animate([
          { height: `${row.node.getBoundingClientRect().height}px`, opacity: 1,
            paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, overflow: "hidden" },
          { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" },
        ], { duration: 180, delay: 120, easing: "ease-out", fill: "forwards" });
        row.leaving.finished.then(() => {
          if (state.rows.get(id) === row) { row.node.remove(); state.rows.delete(id); }
        }).catch(() => { /* Reopening the task cancels its departure. */ });
      } else {
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
