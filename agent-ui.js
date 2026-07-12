(function () {
  if (!document.querySelector(".task-module")) return;

  const panel = document.createElement("div");
  panel.className = "todo-agent";
  panel.innerHTML = `
    <button type="button" class="todo-agent-fab" aria-expanded="false" aria-controls="todo-agent-panel">
      <span class="todo-agent-fab-label">Agent</span>
    </button>
    <section class="todo-agent-panel" id="todo-agent-panel" hidden>
      <header class="todo-agent-header">
        <div>
          <p class="todo-agent-kicker">Daily Space</p>
          <h2 class="todo-agent-title">Todo Agent</h2>
        </div>
        <button type="button" class="todo-agent-close" aria-label="Close agent">×</button>
      </header>
      <div class="todo-agent-messages" id="todo-agent-messages" aria-live="polite"></div>
      <form class="todo-agent-form" autocomplete="off">
        <input
          class="todo-agent-input"
          type="text"
          maxlength="2000"
          placeholder="e.g. Add buy milk for tomorrow"
          aria-label="Message for Todo Agent"
        />
        <button class="todo-agent-send" type="submit">Send</button>
      </form>
      <p class="todo-agent-hint">Can add, complete, update, or delete tasks.</p>
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

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `todo-agent-msg todo-agent-msg-${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setOpen(open) {
    sheet.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("is-open", open);
    if (open) {
      if (messagesEl.childElementCount === 0) {
        appendMessage(
          "assistant",
          "Tell me what to change. Example: “Add three tasks for tomorrow: groceries, rent, email reply.”"
        );
      }
      input.focus();
      refreshStatus();
    }
  }

  async function refreshStatus() {
    if (configured != null) return;
    try {
      const response = await fetch("/api/agent/status");
      const data = await response.json().catch(function () {
        return {};
      });
      configured = Boolean(data.configured);
      if (!configured) {
        appendMessage(
          "assistant",
          "Agent is not configured yet. Add GROQ_API_KEY in Render Environment, then redeploy."
        );
      }
    } catch (_) {
      configured = false;
      appendMessage("assistant", "Could not reach the agent service right now.");
    }
  }

  async function sendMessage(raw) {
    const message = String(raw || "").trim();
    if (!message || busy) return;
    const api = window.DailySpaceTodo;
    if (!api || typeof api.getSnapshot !== "function" || typeof api.applyActions !== "function") {
      appendMessage("assistant", "Todo bridge is unavailable on this page.");
      return;
    }

    busy = true;
    sendBtn.disabled = true;
    appendMessage("user", message);
    input.value = "";
    appendMessage("assistant", "Working…");
    const thinking = messagesEl.lastElementChild;

    try {
      const snapshot = api.getSnapshot();
      const response = await fetch("/api/agent/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          todos: snapshot.todos,
          categories: snapshot.categories,
          today: snapshot.today,
        }),
      });
      const data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error((data && data.error) || "Agent request failed.");
      }
      const applied = api.applyActions(data.actions || []);
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
      sendBtn.disabled = false;
      input.focus();
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
