(function () {
  const api = window.DailySpaceAgentData;
  const AGENT_REQUEST_TIMEOUT_MS = 22_000;
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const owner = () => window.DailySpaceView.owner();
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

    let m = raw.match(/^(?:(?:complete|done|finish)\s+|(?:完成|搞定|做完)\s*)(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_complete", matchText: m[1].trim() }],
        reply: t("Marked complete (offline).", "已在本机标记完成。"),
      };
    }

    m = raw.match(/^(?:(?:uncomplete|reopen)\s+|(?:恢复|取消完成)\s*)(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_uncomplete", matchText: m[1].trim() }],
        reply: t("Reopened (offline).", "已在本机恢复为待办。"),
      };
    }

    m = raw.match(/^(?:(?:delete|remove)\s+|(?:删除|去掉)\s*)(.+)/i);
    if (m) {
      return {
        actions: [{ type: "todo_delete", matchText: m[1].trim() }],
        reply: t("Deleted (offline).", "已在本机删除。"),
      };
    }

    const add = raw.match(/^(?:(?:add|create|new|todo)\s+|(?:请|帮我)?(?:添加|创建|新增|加个|加一下|加)\s*)(.+)/i);
    if (!add) return { actions: [], reply: t('Offline mode only accepts explicit task commands, such as “Add buy milk today”. Your message was not saved as a task.', '离线模式只处理明确的任务指令，例如“添加 今天买牛奶”。这条消息没有被保存为任务。') };
    let text = add[1].trim();
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
      reply: dueDate ? t(`Added for ${dueDate} (offline).`, `已在本机添加到 ${dueDate}。`) : t("Added (offline).", "已在本机添加。"),
    };
  }

  const pageMode = document.body.classList.contains("todo-agent-page");
  const mobileTodo = document.body.classList.contains("todo-mobile");
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
  panel.className = "todo-agent";
  panel.innerHTML = `
    <button type="button" class="todo-agent-fab" aria-expanded="false" aria-controls="todo-agent-overlay" aria-label="Open Daily Space Agent">
      <img class="todo-agent-fab-ghost" src="welcome-sticker.png" width="28" height="28" alt="" aria-hidden="true" draggable="false" />
    </button>
    <div data-dialog-root class="todo-agent-overlay" id="todo-agent-overlay" hidden>
      <button type="button" class="todo-agent-backdrop" aria-label="Close agent"></button>
      <section class="todo-agent-panel" id="todo-agent-panel" role="dialog" aria-modal="true" aria-labelledby="todo-agent-title">
        <header class="todo-agent-header">
          <div>
            <p class="todo-agent-kicker">Daily Space</p>
            <h2 class="todo-agent-title" id="todo-agent-title">${agentTitle}</h2>
          </div>
          <button type="button" data-dialog-close class="todo-agent-close" aria-label="Close agent">×</button>
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
          <button class="btn btn-primary todo-agent-send" type="submit">Send</button>
        </form>
        <p class="todo-agent-hint">${agentHint}</p>
      </section>
    </div>
  `;

  document.body.appendChild(panel);

  const generatedFab = panel.querySelector(".todo-agent-fab");
  const fab = document.querySelector(".page-action-cluster #m-agent-toggle, .page-action-cluster #daily-loop-focus") || generatedFab;
  if (fab !== generatedFab) {
    fab.replaceChildren(...generatedFab.childNodes);
    generatedFab.remove();
  }
  fab.classList.remove("btn", "btn-primary", "daily-loop-focus", "m-agent-toggle");
  fab.classList.add("todo-agent-fab", "workspace-icon-button", "workspace-agent-button");
  fab.setAttribute("data-workspace-agent", "");
  fab.setAttribute("aria-controls", "todo-agent-overlay");
  const overlay = panel.querySelector(".todo-agent-overlay");
  const sheet = panel.querySelector(".todo-agent-panel");
  const backdrop = panel.querySelector(".todo-agent-backdrop");
  const closeBtn = panel.querySelector(".todo-agent-close");
  const form = panel.querySelector(".todo-agent-form");
  const input = panel.querySelector(".todo-agent-input");
  const messagesEl = panel.querySelector(".todo-agent-messages");
  const sendBtn = panel.querySelector(".todo-agent-send");
  const hintEl = panel.querySelector(".todo-agent-hint");

  if (
    !(fab instanceof HTMLButtonElement) ||
    !(overlay instanceof HTMLElement) ||
    !(sheet instanceof HTMLElement) ||
    !(backdrop instanceof HTMLButtonElement) ||
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
  let identity = owner(), generation = 0, activeRequest = null;
  let statusVersion = 0, statusController = null, connection = 'unknown';
  const isCurrent = request => request === activeRequest && request.owner === owner() && request.generation === generation;
  function restoreInput(message) { if (!input.value.trim()) input.value = message; }
  function applyConfirmed(actions, request) {
    if (!isCurrent(request)) return null;
    if (api.needsConfirmation(actions) && !window.confirm(api.confirmationText(actions))) return null;
    return isCurrent(request) ? api.applyActions(actions) : null;
  }
  const agentHistory = window.DailySpaceDialogHistory.create("agent", {
    isOpen: () => !overlay.hidden,
    restore: () => setOpen(true, true),
    close: () => setOpen(false, true),
  });

  function publishStatus() {
    document.body.dataset.agentConfigured = configured === true ? "1" : "0";
    document.dispatchEvent(
      new CustomEvent("daily-space-agent-status", {
        detail: { configured: configured === true, connection },
      })
    );
  }

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `todo-agent-msg todo-agent-msg-${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function applyConfiguredUi() {
    const ready = configured === true;
    // Input always works — LLM when ready, local Todo capture otherwise.
    sendBtn.disabled = busy;
    input.disabled = false;
    if (hintEl) {
      hintEl.textContent = configured == null
        ? connection === 'error'
          ? t('Agent status could not be checked. Explicit local task commands remain available.', '暂时无法检查助手状态，仍可使用明确的本地任务指令。')
          : t('Checking agent availability…', '正在检查助手状态…')
        : !ready
          ? t('Local task mode. Use an explicit command, e.g. “Add buy milk today”.', '本地任务模式。请输入明确指令，例如“添加 今天买牛奶”。')
          : connection === 'error'
            ? t('The last AI request failed. Retry, or use an explicit local task command.', '上次 AI 请求失败，可重试或使用明确的本地任务指令。')
            : connection === 'verified'
              ? t('AI responded successfully in this session. Todo, Calendar, Planner and Tally are available.', '本次会话已收到 AI 回复，可操作任务、日历、项目和记账。')
              : t('AI is configured; model connectivity has not been verified yet.', 'AI 已配置，模型连通性尚未验证。');
    }
    publishStatus();
  }

  function setOpen(open, fromHistory = false) {
    const wasOpen = !overlay.hidden;
    if (open && !wasOpen && !fromHistory && !agentHistory.push({})) return false;
    if (host instanceof HTMLElement) {
      host.hidden = !open;
    }
    overlay.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "Close Daily Space Agent" : "Open Daily Space Agent");
    panel.classList.toggle("is-open", open);
    document.body.classList.toggle("todo-agent-open", open);
    document.body.classList.toggle("m-agent-sheet-open", mobileTodo && open);
    document.dispatchEvent(new CustomEvent("daily-space-agent-open", { detail: { open } }));
    if (!open && wasOpen && !fromHistory) agentHistory.back();
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
    }
  }

  async function refreshStatus(options) {
    if (!options?.force && configured != null) return;
    const version = ++statusVersion, requestedOwner = owner(), requestedGeneration = generation;
    statusController?.abort();
    const controller = new AbortController(); statusController = controller;
    const timer = setTimeout(() => controller.abort(), 6000);
    const current = () => version === statusVersion && requestedOwner === owner() && requestedGeneration === generation;
    try {
      const response = await fetch('/api/agent/status', { signal: controller.signal });
      const data = await response.json();
      if (!response.ok || typeof data.configured !== 'boolean') throw new Error('Invalid agent status');
      if (!current()) return;
      configured = data.configured;
      if (!configured) connection = 'unconfigured';
      else if (connection !== 'verified' && connection !== 'error') connection = 'unverified';
    } catch (_) {
      if (!current()) return;
      configured = null; connection = 'error';
    } finally {
      clearTimeout(timer);
      if (current()) {
        if (statusController === controller) statusController = null;
        applyConfiguredUi();
      }
    }
  }

  async function sendMessage(raw) {
    const message = String(raw || '').trim();
    if (!message || busy) return;
    const request = { owner: owner(), generation, controller: new AbortController() };
    activeRequest = request; busy = true; applyConfiguredUi();
    input.value = '';
    let timer, thinking, mayFallback = true;
    try {
      if (configured !== true) await refreshStatus({ force: true });
      if (!isCurrent(request)) return;
      appendMessage('user', message);
      thinking = appendMessage('assistant', t('Working…', '处理中…'));
      if (configured !== true) {
        const parsed = localTodoActions(message, api.todayIso());
        const applied = parsed.actions.length ? applyConfirmed(parsed.actions, request) : [];
        if (!isCurrent(request)) return;
        if (applied === null) { thinking.textContent = t('Cancelled. No changes were applied.', '已取消，未执行任何修改。'); restoreInput(message); }
        else {
          const changed = applied.some(action => action && action.ok !== false);
          thinking.textContent = parsed.actions.length && !changed ? t('No matching task was changed. Check the task name and retry.', '未修改任何匹配的任务，请核对任务名称后重试。') : parsed.reply;
          if (!changed) restoreInput(message);
        }
        return;
      }
      timer = setTimeout(() => request.controller.abort(), AGENT_REQUEST_TIMEOUT_MS);
      const response = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context: api.getSnapshot(), today: api.todayIso(), currentPage: currentPage() }),
        signal: request.controller.signal,
      });
      const data = await response.json();
      if (!isCurrent(request)) return;
      if (request.controller.signal.aborted) throw new Error('Agent request timed out.');
      if (!response.ok) throw new Error(data.error || 'Agent request failed.');
      if (!Array.isArray(data.actions) || typeof data.reply !== 'string') throw new Error('Invalid agent response.');
      mayFallback = false; connection = 'verified';
      const applied = applyConfirmed(data.actions, request);
      if (!isCurrent(request)) return;
      if (applied === null) { thinking.textContent = t('Cancelled. No changes were applied.', '已取消，未执行任何修改。'); restoreInput(message); return; }
      const count = applied.filter(action => action && action.ok !== false).length;
      thinking.textContent = (data.reply.trim() || t('Done.', '已完成。')) + (applied.length ? `\n\n${t('Applied', '已执行')} ${count} ${t('change(s).', '项改动。')}` : '');
    } catch (error) {
      if (!isCurrent(request)) return;
      connection = 'error';
      const parsed = mayFallback ? localTodoActions(message, api.todayIso()) : { actions: [] };
      if (parsed.actions.length) {
        const applied = applyConfirmed(parsed.actions, request);
        if (!isCurrent(request)) return;
        if (applied === null) { thinking.textContent = t('Cancelled. No changes were applied.', '已取消，未执行任何修改。'); restoreInput(message); }
        else {
          const changed = applied.some(action => action && action.ok !== false);
          thinking.textContent = changed
            ? t('Agent unreachable — processed as an explicit local task command.', 'AI 暂时不可用，已按明确的本地任务指令处理。')
            : t('No matching task was changed. Check the task name and retry.', '未修改任何匹配的任务，请核对任务名称后重试。');
          if (!changed) restoreInput(message);
        }
      } else {
        const text = request.controller.signal.aborted
          ? t('Agent request timed out. No local changes were applied; your message is ready to retry.', '助手请求超时，未执行本地修改，已保留消息供重试。')
          : t('Agent request failed. No automatic local changes were applied; your message is ready to retry.', '助手请求失败，未自动执行本地修改，已保留消息供重试。');
        if (thinking) thinking.textContent = text;
        restoreInput(message);
      }
    } finally {
      clearTimeout(timer);
      if (isCurrent(request)) {
        activeRequest = null; busy = false; applyConfiguredUi();
        if (!overlay.hidden) input.focus();
      }
    }
  }

  function resetForIdentityChange(force = false) {
    if (!force && identity === owner()) return;
    identity = owner(); generation++; statusVersion++;
    activeRequest?.controller.abort(); statusController?.abort();
    activeRequest = null; statusController = null; busy = false; configured = null; connection = 'unknown';
    messagesEl.replaceChildren(); input.value = '';
    if (!overlay.hidden) setOpen(false, true);
    applyConfiguredUi();
  }
  window.addEventListener('daily-space-auth-updated', () => resetForIdentityChange());
  window.addEventListener('storage', event => {
    if (event.key === 'daily-space-auth-v1' || event.key === null) resetForIdentityChange(true);
  });

  fab.addEventListener("click", function () {
    setOpen(overlay.hidden);
  });

  function closeAgent() {
    setOpen(false);
  }

  closeBtn.addEventListener("click", closeAgent);
  backdrop.addEventListener("click", closeAgent);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !overlay.hidden) closeAgent();
  });
  setOpen(false);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });

  function mountInHeader() {
    const actions = document.querySelector("[data-page-header] .page-action-cluster");
    if (!(actions instanceof HTMLElement)) return false;
    actions.classList.add("has-workspace-agent");
    panel.classList.add("todo-agent-header-host");
    if (actions.lastElementChild !== fab) actions.appendChild(fab);
    return true;
  }
  mountInHeader();
  document.addEventListener("DOMContentLoaded", mountInHeader);
  document.addEventListener("dailyspace:bento-rail-ready", mountInHeader);

  function focusComposer(seed) {
    if (setOpen(true) === false) return;
    const text = typeof seed === "string" ? seed.trim() : "";
    if (text) input.value = text;
    queueMicrotask(function () {
      if (overlay.hidden) return;
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
    mountInHeader,
    setOpen,
    focusComposer,
    isPageMode: pageMode,
  };
  if (history.state?.workspaceSheet?.key === "agent" && history.state.workspaceSheet.owner === window.DailySpaceView.owner()) setOpen(true, true);
})();
