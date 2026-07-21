const DEFAULT_OPENAI_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const MAX_MESSAGE_CHARS = 2000;
const MAX_TODOS_IN_CONTEXT = 80;

function getAgentConfig() {
  const apiKey = String(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE)
    .trim()
    .replace(/\/+$/, "");
  const model = String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function isAgentConfigured() {
  return Boolean(getAgentConfig().apiKey);
}

function buildSystemPrompt(todayIso) {
  return [
    "You are Daily Space Todo Agent.",
    "Help the user manage their to-do list by returning JSON actions the app can apply.",
    `Today's date is ${todayIso} (YYYY-MM-DD). Resolve relative dates like today/tomorrow against this.`,
    "Only modify todos when the user clearly asks. Otherwise answer briefly with actions=[].",
    "Prefer matching existing todos by id from the provided list. If id is unknown, use matchText with distinctive wording.",
    "Keep task text concise. dueDate must be YYYY-MM-DD or null.",
    "Respond with ONLY valid JSON matching this schema:",
    '{ "reply": string, "actions": Action[] }',
    "Action types:",
    '- {"type":"add","text":string,"dueDate":string|null,"categoryName":string|null}',
    '- {"type":"complete","todoId":string|null,"matchText":string|null}',
    '- {"type":"uncomplete","todoId":string|null,"matchText":string|null}',
    '- {"type":"update","todoId":string|null,"matchText":string|null,"text":string|null,"dueDate":string|null,"categoryName":string|null}',
    '- {"type":"delete","todoId":string|null,"matchText":string|null}',
    '- {"type":"add_category","name":string}',
    "Never invent todo ids that are not in the list.",
  ].join("\n");
}

function sanitizeTodoSnapshot(rawTodos, rawCategories) {
  const categories = Array.isArray(rawCategories)
    ? rawCategories
        .filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
        .slice(0, 40)
        .map((c) => ({ id: c.id, name: String(c.name).slice(0, 48) }))
    : [];
  const todos = Array.isArray(rawTodos)
    ? rawTodos
        .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
        .slice(0, MAX_TODOS_IN_CONTEXT)
        .map((t) => ({
          id: t.id,
          text: String(t.text).slice(0, 200),
          completed: Boolean(t.completed),
          dueDate: typeof t.dueDate === "string" ? t.dueDate : null,
          categoryId: typeof t.categoryId === "string" ? t.categoryId : null,
        }))
    : [];
  return { todos, categories };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    /* continue */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {
      /* continue */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
  return null;
}

function normalizeAgentResult(payload) {
  const reply =
    payload && typeof payload.reply === "string" && payload.reply.trim()
      ? payload.reply.trim().slice(0, 1200)
      : "Done.";
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  const allowed = new Set(["add", "complete", "uncomplete", "update", "delete", "add_category"]);
  const normalized = [];
  for (const action of actions.slice(0, 20)) {
    if (!action || typeof action !== "object") continue;
    const type = String(action.type || "").trim();
    if (!allowed.has(type)) continue;
    if (type === "add") {
      const text = String(action.text || "").trim().slice(0, 500);
      if (!text) continue;
      normalized.push({
        type,
        text,
        dueDate: typeof action.dueDate === "string" ? action.dueDate : null,
        categoryName:
          typeof action.categoryName === "string" ? action.categoryName.trim().slice(0, 48) : null,
      });
      continue;
    }
    if (type === "add_category") {
      const name = String(action.name || "").trim().slice(0, 48);
      if (!name) continue;
      normalized.push({ type, name });
      continue;
    }
    normalized.push({
      type,
      todoId: typeof action.todoId === "string" ? action.todoId : null,
      matchText: typeof action.matchText === "string" ? action.matchText.trim().slice(0, 200) : null,
      text: typeof action.text === "string" ? action.text.trim().slice(0, 500) : null,
      dueDate: Object.prototype.hasOwnProperty.call(action, "dueDate")
        ? typeof action.dueDate === "string"
          ? action.dueDate
          : null
        : undefined,
      categoryName:
        typeof action.categoryName === "string" ? action.categoryName.trim().slice(0, 48) : null,
    });
  }
  return { reply, actions: normalized };
}

async function callOpenAiChat({ apiKey, baseUrl, model, system, user }) {
  async function request(withJsonMode) {
    const body = {
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (withJsonMode) body.response_format = { type: "json_object" };
    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  let response = await request(true);
  if (!response.ok && response.status === 400) {
    response = await request(false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      (data && data.error && (data.error.message || data.error)) ||
      `LLM request failed (${response.status}).`;
    const error = new Error(typeof detail === "string" ? detail : "LLM request failed.");
    error.statusCode = 502;
    throw error;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const error = new Error("The model returned an empty response.");
    error.statusCode = 502;
    throw error;
  }
  return content;
}

async function runTodoAgent({ message, todos, categories, today }) {
  if (!isAgentConfigured()) {
    const error = new Error(
      "Todo Agent is not configured. Set GROQ_API_KEY (or OPENAI_API_KEY) on Render Environment."
    );
    error.statusCode = 503;
    throw error;
  }

  const trimmed = String(message || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmed) {
    const error = new Error("Message is required.");
    error.statusCode = 400;
    throw error;
  }

  const todayIso =
    typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
      ? today
      : new Date().toISOString().slice(0, 10);
  const snapshot = sanitizeTodoSnapshot(todos, categories);
  const { apiKey, baseUrl, model } = getAgentConfig();
  const userPayload = JSON.stringify(
    {
      message: trimmed,
      today: todayIso,
      categories: snapshot.categories,
      todos: snapshot.todos,
    },
    null,
    2
  );

  const content = await callOpenAiChat({
    apiKey,
    baseUrl,
    model,
    system: buildSystemPrompt(todayIso),
    user: userPayload,
  });
  const parsed = extractJsonObject(content);
  if (!parsed) {
    const error = new Error("The model returned invalid JSON.");
    error.statusCode = 502;
    throw error;
  }
  return normalizeAgentResult(parsed);
}

module.exports = {
  isAgentConfigured,
  getAgentConfig,
  callOpenAiChat,
  extractJsonObject,
  runTodoAgent,
};
