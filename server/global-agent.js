const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const MAX_MESSAGE_CHARS = 2000;
const MAX_ACTIONS = 16;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

const ACTION_TYPES = new Set([
  "todo_add",
  "todo_complete",
  "todo_uncomplete",
  "todo_update",
  "todo_delete",
  "todo_add_category",
  "planner_add_workspace",
  "planner_add_column",
  "planner_update_column",
  "planner_delete_column",
  "planner_add_card",
  "planner_update_card",
  "planner_complete_card",
  "planner_uncomplete_card",
  "planner_move_card",
  "planner_delete_card",
  "calendar_add_reminder",
  "calendar_update_reminder",
  "calendar_delete_reminder",
  "tally_add_expense",
  "tally_update_expense",
  "tally_delete_expense",
  "tally_set_budget",
  "teamwork_update_field",
  "teamwork_add_member",
  "teamwork_update_member",
  "teamwork_delete_member",
  "teamwork_add_task",
  "teamwork_update_task",
  "teamwork_delete_task",
]);

function getAgentConfig() {
  const apiKey = String(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const model = String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

function buildSystemPrompt(today) {
  return [
    "You are the optional Daily Space Agent — a helper, not the primary UI.",
    "Prefer Todo / today actions when the user intent is about getting work done.",
    "Interpret the user's intent and return actions for Todo, Planner, Calendar, Tally Book, or Teamwork private notes.",
    "The user may request a change to any module regardless of the currently open page.",
    `Today is ${today}. Resolve relative dates against it.`,
    'Phrases like "today", "今天", "tonight", or "今晚" for a task mean dueDate = today.',
    'Phrases like "tomorrow" / "明天" mean the next calendar day.',
    'When the user names a clock time (e.g. "3pm", "15:00", "下午3点", "三点"), you MUST keep that time.',
    'Timed reminders / 提醒 / 叫我 / alert me → calendar_add_reminder with startTime as 24h HH:MM (下午3点 = 15:00).',
    'Timed personal tasks → todo_add with dueDate and dueTime (HH:MM). Do not drop dueTime.',
    "Use IDs from context when available. Otherwise provide a distinctive matchText/name/title.",
    "Do not invent IDs. Do not perform a mutation unless the user clearly requests it.",
    "Destructive deletes are confirmed in the client UI — still only emit them when clearly requested.",
    "Return ONLY valid JSON: {\"reply\":string,\"actions\":Action[]}. The actions value MUST always be a JSON array, even for one action.",
    "Allowed actions and fields:",
    'todo_add {text,dueDate|null,dueTime|null,categoryName|null}',
    'todo_complete|todo_uncomplete|todo_delete {todoId|null,matchText|null}',
    'todo_update {todoId|null,matchText|null,text?,dueDate?,dueTime?,categoryName?}',
    'todo_add_category {name}',
    'planner_add_workspace {name}',
    'planner_add_column {workspaceId|null,workspaceName|null,title,emoji|null}',
    'planner_update_column|planner_delete_column {workspaceId|null,workspaceName|null,columnId|null,columnTitle|null,title?,emoji?}',
    'planner_add_card {workspaceId|null,workspaceName|null,columnId|null,columnTitle|null,title,note|null,tags|null}',
    'planner_update_card {workspaceId|null,workspaceName|null,cardId|null,matchText|null,title?,note?,tags?}',
    'planner_complete_card|planner_uncomplete_card|planner_delete_card {workspaceId|null,workspaceName|null,cardId|null,matchText|null}',
    'planner_move_card {workspaceId|null,workspaceName|null,cardId|null,matchText|null,columnId|null,columnTitle|null}',
    'calendar_add_reminder {text,date,startTime|null,endTime|null,priority}',
    'calendar_update_reminder {reminderId|null,matchText|null,text?,date?,startTime?,endTime?,priority?}',
    'calendar_delete_reminder {reminderId|null,matchText|null,date|null}',
    'tally_add_expense {amount,category,date,note|null}',
    'tally_update_expense {recordId|null,matchText|null,amount?,category?,date?,note?}',
    'tally_delete_expense {recordId|null,matchText|null,date|null,amount|null}',
    'tally_set_budget {budget}',
    'teamwork_update_field {field,value}',
    'teamwork_add_member {name,role|null}',
    'teamwork_update_member|teamwork_delete_member {memberId|null,memberName|null,name?,role?}',
    'teamwork_add_task {memberId|null,memberName|null,text}',
    'teamwork_update_task {memberId|null,memberName|null,taskIndex|null,matchText|null,text}',
    'teamwork_delete_task {memberId|null,memberName|null,taskIndex|null,matchText|null}',
    "Dates must be YYYY-MM-DD, times HH:MM (24-hour), expense amounts and budgets positive.",
    "For a spending statement such as 'lunch 30 yuan', use tally_add_expense, not todo_add.",
    "For an appointment, alarm, or timed reminder, use calendar_add_reminder and always include startTime when a clock time was given.",
    "For a general personal task, use todo_add with dueDate when the user mentions today/明天/etc., and dueTime when they name a clock time.",
  ].join("\n");
}

function text(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function optionalId(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;
}

function optionalDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

function optionalTime(value) {
  return normalizeTime(value);
}

/** Accept HH:MM, H:MM, HH:MM:SS, and 3pm / 3:00 PM style strings. */
function normalizeTime(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (TIME_24H.test(raw)) return raw;
  const withSec = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (withSec) {
    return `${String(Number(withSec[1])).padStart(2, "0")}:${withSec[2]}`;
  }
  const ampm = raw.match(/^(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2] || "00";
    const isPm = /^p/i.test(ampm[3]);
    if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null;
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  return null;
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== "object") return null;
  let source = raw;
  let type = String(source.type || "").trim();
  if (!type) {
    const nestedType = Object.keys(source).find((key) => ACTION_TYPES.has(key));
    if (nestedType && source[nestedType] && typeof source[nestedType] === "object") {
      type = nestedType;
      source = { type, ...source[nestedType] };
    }
  }
  if (!ACTION_TYPES.has(type)) return null;
  const action = { type };
  raw = source;

  if (type === "todo_add") {
    action.text = text(raw.text, 500);
    if (!action.text) return null;
    action.dueDate = optionalDate(raw.dueDate);
    action.dueTime = optionalTime(raw.dueTime);
    action.categoryName = text(raw.categoryName, 48);
  } else if (type === "todo_add_category") {
    action.name = text(raw.name, 48);
    if (!action.name) return null;
  } else if (type.startsWith("todo_")) {
    action.todoId = optionalId(raw.todoId);
    action.matchText = text(raw.matchText, 200);
    if (!action.todoId && !action.matchText) return null;
    if (type === "todo_update") {
      if (Object.hasOwn(raw, "text")) action.text = text(raw.text, 500);
      if (Object.hasOwn(raw, "dueDate")) action.dueDate = optionalDate(raw.dueDate);
      if (Object.hasOwn(raw, "dueTime")) action.dueTime = optionalTime(raw.dueTime);
      if (Object.hasOwn(raw, "categoryName")) action.categoryName = text(raw.categoryName, 48);
    }
  } else if (type === "planner_add_workspace") {
    action.name = text(raw.name, 48);
    if (!action.name) return null;
  } else if (type.startsWith("planner_")) {
    action.workspaceId = optionalId(raw.workspaceId);
    action.workspaceName = text(raw.workspaceName, 48);
    action.columnId = optionalId(raw.columnId);
    action.columnTitle = text(raw.columnTitle, 80);
    action.cardId = optionalId(raw.cardId);
    action.matchText = text(raw.matchText, 200);
    if (type === "planner_add_column") {
      action.title = text(raw.title, 80) || "New column";
      action.emoji = text(raw.emoji, 8);
    } else if (type === "planner_add_card") {
      action.title = text(raw.title, 200);
      if (!action.title) return null;
      action.note = text(raw.note, 1000);
      action.tags = Array.isArray(raw.tags)
        ? raw.tags.filter((tag) => typeof tag === "string").slice(0, 12).map((tag) => tag.slice(0, 32))
        : [];
    } else if (type === "planner_update_column") {
      if (!action.columnId && !action.columnTitle) return null;
      action.title = text(raw.title, 80);
      action.emoji = text(raw.emoji, 8);
    } else if (type === "planner_delete_column") {
      if (!action.columnId && !action.columnTitle) return null;
    } else {
      if (!action.cardId && !action.matchText) return null;
      if (type === "planner_update_card") {
        action.title = text(raw.title, 200);
        action.note = text(raw.note, 1000);
        action.tags = Array.isArray(raw.tags)
          ? raw.tags.filter((tag) => typeof tag === "string").slice(0, 12).map((tag) => tag.slice(0, 32))
          : null;
      }
    }
  } else if (type.startsWith("calendar_")) {
    if (type === "calendar_add_reminder") {
      action.text = text(raw.text, 200);
      action.date = optionalDate(raw.date);
      if (!action.text || !action.date) return null;
    } else {
      action.reminderId = optionalId(raw.reminderId);
      action.matchText = text(raw.matchText, 200);
      if (!action.reminderId && !action.matchText) return null;
      if (Object.hasOwn(raw, "date")) action.date = optionalDate(raw.date);
      if (Object.hasOwn(raw, "text")) action.text = text(raw.text, 200);
    }
    if (Object.hasOwn(raw, "startTime")) action.startTime = optionalTime(raw.startTime);
    if (Object.hasOwn(raw, "endTime")) action.endTime = optionalTime(raw.endTime);
    if (Object.hasOwn(raw, "priority")) {
      action.priority = ["high", "medium", "low"].includes(raw.priority) ? raw.priority : "medium";
    }
  } else if (type.startsWith("tally_")) {
    if (type === "tally_add_expense") {
      action.amount = optionalNumber(raw.amount);
      action.category = text(raw.category, 40);
      action.date = optionalDate(raw.date);
      action.note = text(raw.note, 120) || "";
      if (!(action.amount > 0) || !action.category || !action.date) return null;
    } else if (type === "tally_set_budget") {
      action.budget = optionalNumber(raw.budget);
      if (!(action.budget > 0)) return null;
    } else {
      action.recordId = optionalId(raw.recordId);
      action.matchText = text(raw.matchText, 120);
      action.date = optionalDate(raw.date);
      action.amount = optionalNumber(raw.amount);
      if (!action.recordId && !action.matchText && !action.date && action.amount == null) return null;
      if (type === "tally_update_expense") {
        if (Object.hasOwn(raw, "category")) action.category = text(raw.category, 40);
        if (Object.hasOwn(raw, "note")) action.note = text(raw.note, 120) || "";
        if (Object.hasOwn(raw, "amount") && !(action.amount > 0)) return null;
      }
    }
  } else if (type.startsWith("teamwork_")) {
    if (type === "teamwork_update_field") {
      action.field = text(raw.field, 40);
      action.value = text(raw.value, 1000) || "";
      if (!action.field) return null;
    } else if (type === "teamwork_add_member") {
      action.name = text(raw.name, 80);
      action.role = text(raw.role, 80) || "Member";
      if (!action.name) return null;
    } else {
      action.memberId = optionalId(raw.memberId);
      action.memberName = text(raw.memberName, 80);
      if (!action.memberId && !action.memberName) return null;
      if (type === "teamwork_update_member") {
        action.name = text(raw.name, 80);
        action.role = text(raw.role, 80);
      } else if (type === "teamwork_add_task") {
        action.text = text(raw.text, 300);
        if (!action.text) return null;
      } else if (type === "teamwork_update_task" || type === "teamwork_delete_task") {
        action.taskIndex = Number.isInteger(raw.taskIndex) ? raw.taskIndex : null;
        action.matchText = text(raw.matchText, 300);
        if (action.taskIndex == null && !action.matchText) return null;
        if (type === "teamwork_update_task") {
          action.text = text(raw.text, 300);
          if (!action.text) return null;
        }
      }
    }
  }
  return action;
}

function normalizeGlobalResult(payload) {
  const reply = text(payload?.reply, 1200) || "Done.";
  const rawActions = Array.isArray(payload?.actions)
    ? payload.actions
    : payload?.actions && typeof payload.actions === "object"
      ? [payload.actions]
      : [];
  const actions = rawActions.slice(0, MAX_ACTIONS).map(normalizeAction).filter(Boolean);
  return { reply, actions };
}

function compactContext(raw) {
  if (!raw || typeof raw !== "object") return {};
  const json = JSON.stringify(raw);
  if (json.length <= 60000) return raw;
  return { warning: "Context was too large. Ask the user to narrow the request." };
}

function extractJsonObject(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch (_) {
        return null;
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }
}

async function callModel({ apiKey, baseUrl, model, system, user }) {
  async function request(jsonMode) {
    const body = {
      model,
      temperature: 0.15,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (jsonMode) body.response_format = { type: "json_object" };
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
  if (!response.ok && response.status === 400) response = await request(false);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || `LLM request failed (${response.status}).`;
    const error = new Error(typeof detail === "string" ? detail : "LLM request failed.");
    error.statusCode = 502;
    throw error;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("The model returned an empty response.");
    error.statusCode = 502;
    throw error;
  }
  return content;
}

async function runGlobalAgent({ message, context, today, currentPage }) {
  const { apiKey, baseUrl, model } = getAgentConfig();
  if (!apiKey) {
    const error = new Error("Daily Space Agent is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const trimmed = text(message, MAX_MESSAGE_CHARS);
  if (!trimmed) {
    const error = new Error("Message is required.");
    error.statusCode = 400;
    throw error;
  }
  const todayIso = optionalDate(today) || new Date().toISOString().slice(0, 10);
  const content = await callModel({
    apiKey,
    baseUrl,
    model,
    system: buildSystemPrompt(todayIso),
    user: JSON.stringify({
      message: trimmed,
      currentPage: text(currentPage, 30) || "unknown",
      today: todayIso,
      context: compactContext(context),
    }),
  });
  const parsed = extractJsonObject(content);
  if (!parsed) {
    const error = new Error("The model returned invalid JSON.");
    error.statusCode = 502;
    throw error;
  }
  return normalizeGlobalResult(parsed);
}

module.exports = {
  ACTION_TYPES,
  normalizeGlobalResult,
  runGlobalAgent,
};
