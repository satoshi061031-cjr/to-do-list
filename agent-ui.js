(function () {
  const api = window.DailySpaceAgentData;
  const AGENT_REQUEST_TIMEOUT_MS = 22_000;
  if (!api || typeof api.getSnapshot !== "function" || typeof api.applyActions !== "function") return;

  function currentPage() {
    const name = window.location.pathname.split("/").pop() || "index.html";
    const page = name.replace(/\.html$/i, "") || "welcome";
    return page === "todo-m" ? "todo" : page;
  }

  function shiftIso(iso, days) {
    const [y, mo, da] = String(iso || "").split("-").map(Number);
    if (!y || !mo || !da) return iso;
    const dt = new Date(y, mo - 1, da);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  /** Lightweight offline capture so Todo never depends on an LLM key. */
  function localTodoActions(message, today) {
    const raw = String(message || "").trim();
    if (!raw) return { actions: [], reply: "" };

    let m = raw.match(/^(?:complete|done|finish|完成|搞定|做完)\s+(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_complete", matchText: m[1].trim() }],
        reply: "Marked complete (offline).",
      };
    }

    m = raw.match(/^(?:uncomplete|reopen|恢复|取消完成)\s+(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_uncomplete", matchText: m[1].trim() }],
        reply: "Reopened (offline).",
      };
    }

    m = raw.match(/^(?:delete|remove|删除|去掉)\s+(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_delete", matchText: m[1].trim() }],
        reply: "Deleted (offline).",
      };
    }

    let text = raw.replace(/^(?:add|create|new|todo|添加|创建|加个|加一下|帮我加)\s+/i, "").trim() || raw;
    let dueDate = null;
    if (/\b(today|tonight)\b/i.test(text) || /今天|今晚/.test(text)) {
      dueDate = today;
      text = text
        .replace(/\b(today|tonight)\b/gi, "")
        .replace(/今天|今晚/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    } else if (/\b(tomorrow)\b/i.test(text) || /明天/.test(text)) {
      dueDate = shiftIso(today, 1);
      text = text
        .replace(/\b(tomorrow)\b/gi, "")
        .replace(/明天/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    if (!text) {
      return { actions: [], reply: "Say what to add — e.g. “buy milk today”." };
    }

    return {
      actions: [{ type: "todo_add", text, dueDate, dueTime: null, categoryName: null }],
      reply: dueDate ? `Added for ${dueDate} (offline).` : "Added (offline).",
    };
  }

  const pageMode = document.body.classList.contains("todo-agent-page");
  const host = document.getElementById("todo-agent-host");
  const onMail = currentPage() === "mail";
  const agentTitle = pageMode ? "Ask to add a task" : onMail ? "Ask about your inbox" : "Daily Space Agent";
  const agentPlaceholder = pageMode
    ? "e.g. Add buy milk today…"
    : onMail
      ? "e.g. Turn the digest into today’s tasks…"
      : "Add a task for today…";
  const agentHint = pageMode
    ? "Tell the agent what to add, complete, or reschedule. Your list updates below."
    : onMail
      ? "Use the digest or ask the agent to turn important mail into Today."
      : "Primary capture for Todo — also reaches Planner, Calendar, and Tally.";

  const panel = document.createElement("div");
  panel.className = "todo-agent" + (pageMode ? " todo-agent-page-embed" : "");
  panel.innerHTML = `
    <button type="button" class="todo-agent-fab" aria-expanded="false" aria-controls="todo-agent-panel" aria-label="Open Daily Space Agent">
      <img class="todo-agent-fab-ghost" src="welcome-sticker.png" alt="" aria-hidden="true" />
    </button>
    <section class="todo-agent-panel" id="todo-agent-panel" hidden>
      <header class="todo-agent-header">
        <div>
          <p class="todo-agent-kicker">Daily Space</p>
          <h2 class="todo-agent-title">${agentTitle}</h2>
        </div>
        <button type="button" class="todo-agent-close" aria-label="Close agent">×</button>
      </header>
      <div class="todo-agent-messages" id="todo-agent-messages" aria-live="polite"></div>
      <form class="todo-agent-form" autocomplete="off">
        <input
          class="todo-agent-input"
          type="text"
          maxlength="2000"
          placeholder="${agentPlaceholder}"
          aria-label="Message for Daily Space Agent"
        />
        <button class="todo-agent-send" type="submit">Send</button>
      </form>
      <p class="todo-agent-hint">${agentHint}</p>
    </section>
  `;

  if (pageMode && host instanceof HTMLElement) {
    host.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

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

  function publishStatus() {
    document.body.dataset.agentConfigured = configured === true ? "1" : "0";
    document.dispatchEvent(
      new CustomEvent("daily-space-agent-status", {
        detail: { configured: configured === true },
      })
    );
  }

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `todo-agent-msg todo-agent-msg-${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function applyConfiguredUi() {
    const ready = configured === true;
    // Input always works — LLM when ready, local Todo capture otherwise.
    sendBtn.disabled = busy;
    input.disabled = false;
    if (hintEl) {
      if (pageMode) {
        hintEl.textContent = ready
          ? "Tell the agent what to add, complete, or reschedule. Your list updates below."
          : "Offline mode: type a task (e.g. “buy milk today”). Add GROQ_API_KEY for full agent.";
      } else if (onMail) {
        hintEl.textContent = ready
          ? "Use the digest or ask the agent to turn important mail into Today."
          : "Offline mode still adds Todo locally. Connect mail + agent for digest help.";
      } else {
        hintEl.textContent = ready
          ? "Primary capture for Todo — also reaches Planner, Calendar, and Tally."
          : "Offline mode adds Todo items locally. Add GROQ_API_KEY for the full agent.";
      }
    }
    publishStatus();
  }

  function setOpen(open) {
    if (pageMode) open = true;
    sheet.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "Close Daily Space Agent" : "Open Daily Space Agent");
    panel.classList.toggle("is-open", open);
    document.body.classList.toggle("todo-agent-open", open);
    if (open) {
      if (messagesEl.childElementCount === 0) {
        appendMessage(
          "assistant",
          pageMode
            ? "This is your Todo agent. Try: “Add buy milk today” or “Remind me tomorrow at 9:00.”"
            : "I can help with today’s tasks. Try: “Add buy milk today” or “Remind me tomorrow at 9:00.”"
        );
      }
      refreshStatus({ force: true });
      input.focus();
    } else if (!pageMode) {
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
          "Full agent is offline (no GROQ_API_KEY). You can still add, complete, or delete Todo items here — type naturally."
        );
      }
    } catch (_) {
      configured = false;
      if (!statusMessageShown) {
        statusMessageShown = true;
        appendMessage(
          "assistant",
          "Could not reach the agent service. Offline Todo capture still works in this box."
        );
      }
    }
    applyConfiguredUi();
  }

  async function sendOffline(message) {
    const today = typeof api.todayIso === "function" ? api.todayIso() : new Date().toISOString().slice(0, 10);
    const parsed = localTodoActions(message, today);
    appendMessage("user", message);
    input.value = "";
    if (!parsed.actions.length) {
      appendMessage("assistant", parsed.reply || "Could not understand that offline. Try “buy milk today”.");
      return;
    }
    if (api.needsConfirmation(parsed.actions)) {
      const confirmed = window.confirm(api.confirmationText(parsed.actions));
      if (!confirmed) {
        appendMessage("assistant", "Cancelled. No changes were applied.");
        return;
      }
    }
    const applied = api.applyActions(parsed.actions);
    const ok = applied.filter((a) => a && a.ok !== false).length;
    appendMessage(
      "assistant",
      ok > 0 ? `${parsed.reply}\n\nApplied ${ok} change(s).` : parsed.reply || "Nothing changed."
    );
  }

  async function sendMessage(raw) {
    const message = String(raw || "").trim();
    if (!message || busy) return;

    if (configured !== true) {
      await refreshStatus({ force: true });
    }

    if (configured !== true) {
      busy = true;
      applyConfiguredUi();
      try {
        await sendOffline(message);
      } finally {
        busy = false;
        applyConfiguredUi();
        input.focus();
      }
      return;
    }

    busy = true;
    applyConfiguredUi();
    appendMessage("user", message);
    input.value = "";
    appendMessage("assistant", "Working…");
    const thinking = messagesEl.lastElementChild;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, AGENT_REQUEST_TIMEOUT_MS);

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
        signal: controller.signal,
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
      const requestError = controller.signal.aborted
        ? new Error("Agent request timed out. Please try again.")
        : error;
      // Network/LLM failure → fall back to local Todo capture so the hub never dead-ends.
      const today = typeof api.todayIso === "function" ? api.todayIso() : new Date().toISOString().slice(0, 10);
      const parsed = localTodoActions(message, today);
      if (parsed.actions.length) {
        const applied = api.applyActions(parsed.actions);
        const ok = applied.filter((a) => a && a.ok !== false).length;
        const text =
          ok > 0
            ? `Agent unreachable — applied offline.\n${parsed.reply}`
            : requestError instanceof Error
              ? requestError.message
              : "Agent request failed.";
        if (thinking) thinking.textContent = text;
        else appendMessage("assistant", text);
      } else {
        const text = requestError instanceof Error ? requestError.message : "Agent request failed.";
        if (thinking) thinking.textContent = text;
        else appendMessage("assistant", text);
      }
    } finally {
      window.clearTimeout(timeoutId);
      busy = false;
      applyConfiguredUi();
      input.focus();
    }
  }

  if (pageMode) {
    fab.hidden = true;
    closeBtn.hidden = true;
    setOpen(true);
  } else {
    fab.addEventListener("click", function () {
      setOpen(sheet.hidden);
    });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !sheet.hidden) setOpen(false);
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });

  function mountFabUnderBrand() {
    if (pageMode) return false;
    const brand = document.querySelector(".bento-rail-brand");
    if (!(brand instanceof HTMLElement)) return false;
    fab.classList.add("todo-agent-fab-rail");
    panel.classList.add("todo-agent-rail-docked");
    if (fab.previousElementSibling !== brand) {
      brand.insertAdjacentElement("afterend", fab);
    }
    return true;
  }

  if (!pageMode) {
    if (!mountFabUnderBrand()) {
      document.addEventListener("DOMContentLoaded", mountFabUnderBrand);
      document.addEventListener("dailyspace:bento-rail-ready", mountFabUnderBrand);
    }
  }

  function focusComposer(seed) {
    if (!pageMode) setOpen(true);
    const text = typeof seed === "string" ? seed.trim() : "";
    if (text) input.value = text;
    queueMicrotask(function () {
      input.focus();
      if (text) {
        const len = input.value.length;
        try {
          input.setSelectionRange(len, len);
        } catch (_) {
          /* ignore */
        }
      }
    });
  }

  window.DailySpaceAgentUi = {
    mountFabUnderBrand,
    setOpen,
    focusComposer,
    isPageMode: pageMode,
  };
})();
