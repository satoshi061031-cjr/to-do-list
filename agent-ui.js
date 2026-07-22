(function () {
  const api = window.DailySpaceAgentData;
  if (!api || typeof api.getSnapshot !== "function" || typeof api.applyActions !== "function") return;

  function currentPage() {
    const name = window.location.pathname.split("/").pop() || "index.html";
    return name.replace(/\.html$/i, "") || "welcome";
  }

  const panel = document.createElement("div");
  panel.className = "todo-agent";
  panel.innerHTML = `
    <button type="button" class="todo-agent-fab" aria-expanded="false" aria-controls="todo-agent-panel" aria-label="Open Daily Space Agent">
      <img class="todo-agent-fab-ghost" src="welcome-sticker.png" alt="" aria-hidden="true" />
    </button>
    <section class="todo-agent-panel" id="todo-agent-panel" hidden>
      <header class="todo-agent-header">
        <div>
          <p class="todo-agent-kicker">Daily Space</p>
          <h2 class="todo-agent-title">Daily Space Agent</h2>
        </div>
        <button type="button" class="todo-agent-close" aria-label="Close agent">×</button>
      </header>
      <div class="todo-agent-messages" id="todo-agent-messages" aria-live="polite"></div>
      <form class="todo-agent-form" autocomplete="off">
        <input
          class="todo-agent-input"
          type="text"
          maxlength="2000"
          placeholder="Add a task for today…"
          aria-label="Message for Daily Space Agent"
        />
        <button class="todo-agent-send" type="submit">Send</button>
      </form>
      <p class="todo-agent-hint">Optional helper — best for Todo / today. Also reaches Planner, Calendar, Tally, and private notes.</p>
    </section>
  `;
  document.body.appendChild(panel);

  const fab = panel.querySelector(".todo-agent-fab");
  const sheet = panel.querySelector(".todo-agent-panel");
  const closeBtn = panel.querySelector(".todo-agent-close");
  const form = panel.querySelector(".todo-agent-form");
  const input = panel.querySelector(".todo-agent-input");
  const messagesEl = panel.querySelector(".todo-agent-messages");
  const sendBtn = panel.querySelector(".todo-agent-send");
  const hintEl = panel.querySelector(".todo-agent-hint");

  if (
    !(fab instanceof HTMLButtonElement) ||
    !(sheet instanceof HTMLElement) ||
    !(closeBtn instanceof HTMLButtonElement) ||
    !(form instanceof HTMLFormElement) ||
    !(input instanceof HTMLInputElement) ||
    !(messagesEl instanceof HTMLElement) ||
    !(sendBtn instanceof HTMLButtonElement)
  ) {
    return;
  }

  let busy = false;
  let configured = null;
  let statusMessageShown = false;

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `todo-agent-msg todo-agent-msg-${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function applyConfiguredUi() {
    const ready = configured === true;
    sendBtn.disabled = busy || !ready;
    input.disabled = !ready;
    if (hintEl) {
      hintEl.textContent = ready
        ? "Optional helper — best for Todo / today. Also reaches Planner, Calendar, Tally, and private notes."
        : "Agent needs a server LLM key. You can still use Todo, Planner, and the rest without it.";
    }
  }

  function setOpen(open) {
    sheet.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "Close Daily Space Agent" : "Open Daily Space Agent");
    panel.classList.toggle("is-open", open);
    document.body.classList.toggle("todo-agent-open", open);
    if (open) {
      if (messagesEl.childElementCount === 0) {
        appendMessage(
          "assistant",
          "I can help with today’s tasks. Try: “Add buy milk today” or “Remind me tomorrow at 9:00.”"
        );
      }
      refreshStatus({ force: true });
      if (configured !== false) input.focus();
    } else {
      fab.focus();
    }
  }

  async function refreshStatus(options) {
    const force = Boolean(options && options.force);
    if (!force && configured != null) {
      applyConfiguredUi();
      return;
    }
    try {
      const response = await fetch("/api/agent/status");
      const data = await response.json().catch(function () {
        return {};
      });
      configured = Boolean(data.configured);
      if (!configured && !statusMessageShown) {
        statusMessageShown = true;
        appendMessage(
          "assistant",
          "Agent is optional and not configured yet. Add GROQ_API_KEY to a local .env or Render Environment, restart the server, then reopen this panel. Todo and other pages still work without it."
        );
      }
    } catch (_) {
      configured = false;
      if (!statusMessageShown) {
        statusMessageShown = true;
        appendMessage("assistant", "Could not reach the agent service right now.");
      }
    }
    applyConfiguredUi();
  }

  async function sendMessage(raw) {
    const message = String(raw || "").trim();
    if (!message || busy) return;

    if (configured !== true) {
      await refreshStatus({ force: true });
      if (configured !== true) {
        appendMessage(
          "user",
          message
        );
        appendMessage(
          "assistant",
          "Agent is not configured. Add GROQ_API_KEY (local .env or Render), restart, then try again — or add tasks directly in Todo."
        );
        return;
      }
    }

    busy = true;
    applyConfiguredUi();
    appendMessage("user", message);
    input.value = "";
    appendMessage("assistant", "Working…");
    const thinking = messagesEl.lastElementChild;

    try {
      const context = api.getSnapshot();
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          context,
          today: api.todayIso(),
          currentPage: currentPage(),
        }),
      });
      const data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error((data && data.error) || "Agent request failed.");
      }
      const actions = Array.isArray(data.actions) ? data.actions : [];
      if (api.needsConfirmation(actions)) {
        const confirmed = window.confirm(api.confirmationText(actions));
        if (!confirmed) {
          if (thinking) thinking.textContent = "Cancelled. No changes were applied.";
          return;
        }
      }
      const applied = api.applyActions(actions);
      const reply = typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "Done.";
      const summary =
        applied.length > 0
          ? `${reply}\n\nApplied ${applied.filter((a) => a && a.ok !== false).length} change(s).`
          : reply;
      if (thinking) thinking.textContent = summary;
      else appendMessage("assistant", summary);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Agent request failed.";
      if (thinking) thinking.textContent = text;
      else appendMessage("assistant", text);
    } finally {
      busy = false;
      applyConfiguredUi();
      if (configured === true) input.focus();
    }
  }

  fab.addEventListener("click", function () {
    setOpen(sheet.hidden);
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !sheet.hidden) setOpen(false);
  });
})();
