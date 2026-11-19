const { isAgentConfigured, getAgentConfig, callOpenAiChat, extractJsonObject } = require("./agent");

const MAX_MESSAGES = 30;
const IMPORTANT_COUNT = 5;

// Words that usually mean an email asks for something; English and Chinese.
const ACTION_WORDS = /\b(deadline|due|urgent|asap|action required|invoice|payment|overdue|bill|receipt|contract|sign|approve|approval|interview|offer|meeting|schedule|reschedul|confirm|confirmation|booking|reservation|flight|itinerary|visa|tax|security alert|verify|password|reminder)\b|截止|到期|紧急|尽快|发票|付款|账单|逾期|合同|签署|审批|面试|录用|会议|预约|确认|预订|航班|行程|签证|报税|税|安全|验证|提醒/i;
const BULK_SENDER = /no-?reply|noreply|newsletter|marketing|notifications?@|mailer|digest|promo|news@|deals?@/i;

function senderName(from) {
  return String(from || "").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || String(from || "");
}

/**
 * Rule-based importance used when no model is configured, and to fill any gap
 * the model leaves. Returns [{ id, score, reasons: [{ en, zh }] }], highest first.
 */
function scoreImportance(messages, todayIso) {
  const today = Date.parse(`${todayIso}T00:00:00Z`) || Date.now();
  return (Array.isArray(messages) ? messages : []).map((message, index) => {
    const reasons = [];
    let score = 0;
    const text = `${message.subject || ""} ${message.snippet || ""}`;
    if (message.starred) { score += 4; reasons.push({ en: "Starred", zh: "已加星标" }); }
    if (message.markedImportant) { score += 3; reasons.push({ en: "Marked important", zh: "标记为重要" }); }
    if (ACTION_WORDS.test(text)) { score += 3; reasons.push({ en: "Needs action", zh: "需要处理" }); }
    if (message.unread) { score += 2; reasons.push({ en: "Unread", zh: "未读" }); }
    const bulk = BULK_SENDER.test(String(message.from || ""));
    if (message.category && message.category !== "primary") score -= message.category === "promotions" ? 4 : 2;
    else if (!bulk) { score += 1; reasons.push({ en: "From a person", zh: "来自真人" }); }
    if (bulk) score -= 2;
    const received = Date.parse(message.receivedAt || "");
    if (Number.isFinite(received)) {
      const ageDays = Math.max(0, (today + 86_400_000 - received) / 86_400_000);
      score += Math.max(0, 2 - ageDays * 0.5); // fresher mail first among equals
    }
    return { id: message.id, score: score - index * 0.001, reasons };
  }).sort((a, b) => b.score - a.score);
}

function reasonText(reasons, preferZh) {
  const list = reasons.slice(0, 2).map(reason => (preferZh ? reason.zh : reason.en));
  return list.length ? list.join(preferZh ? " · " : " · ") : (preferZh ? "最近邮件" : "Recent");
}

/** Top messages by rules alone, with a short reason each. */
function ruleBasedImportant(messages, todayIso, preferZh) {
  // Only mail with some positive signal qualifies; a short list beats padding it with promotions.
  return scoreImportance(messages, todayIso).filter(item => item.score > 0.5).slice(0, IMPORTANT_COUNT)
    .map(item => ({ id: item.id, reason: reasonText(item.reasons, preferZh), source: "rules" }));
}

/** Keep the model's valid picks in order, then fill to five from the rules. */
function mergeImportant(modelItems, messages, todayIso, preferZh) {
  const known = new Map(messages.map(message => [message.id, message]));
  const picked = [];
  for (const item of Array.isArray(modelItems) ? modelItems : []) {
    if (!item || typeof item.id !== "string" || !known.has(item.id) || picked.some(entry => entry.id === item.id)) continue;
    const reason = typeof item.reason === "string" && item.reason.trim() ? item.reason.trim().slice(0, 80) : "";
    picked.push({ id: item.id, reason: reason || (preferZh ? "AI 判断为重要" : "Picked by AI"), source: "ai" });
    if (picked.length === IMPORTANT_COUNT) return picked;
  }
  for (const item of ruleBasedImportant(messages, todayIso, preferZh)) {
    if (picked.length === IMPORTANT_COUNT) break;
    if (!picked.some(entry => entry.id === item.id)) picked.push(item);
  }
  return picked;
}

function fallbackDigest(messages, reason, preferZh, options) {
  const count = messages.length;
  const subjects = messages
    .map((message) => String(message.subject || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  let digest;
  if (preferZh) {
    digest =
      count === 0
        ? "收件箱很安静 — 没有最近邮件。"
        : count === 1
          ? "收件箱有 1 封最近邮件。"
          : `收件箱有 ${count} 封最近邮件。`;
    if (count > 0 && subjects.length) digest = `${digest} 重点：${subjects.join(" · ")}`;
  } else {
    digest =
      count === 0
        ? "Inbox is quiet — no recent messages."
        : count === 1
          ? "1 recent message in your inbox."
          : `${count} recent messages in your inbox.`;
    if (count > 0 && subjects.length) digest = `${digest} Focus: ${subjects.join(" · ")}`;
  }
  const summaries = {};
  for (const message of messages) {
    const snippet = String(message.snippet || "").trim();
    summaries[message.id] = snippet
      ? snippet.slice(0, 160)
      : String(message.subject || "(No subject)").slice(0, 120);
  }
  return {
    digest,
    summaries,
    important: ruleBasedImportant(messages, options?.todayIso, preferZh),
    summarized: false,
    fallbackReason: reason || "llm_failed",
  };
}

async function summarizeInboxMessages(messages, todayIso, options) {
  const rows = Array.isArray(messages) ? messages.slice(0, MAX_MESSAGES) : [];
  const locale = String((options && options.lang) || "").toLowerCase();
  const preferZh = locale.startsWith("zh");
  if (!rows.length) {
    return {
      digest: preferZh ? "收件箱很安静 — 没有最近邮件。" : "Inbox is quiet — no recent messages.",
      summaries: {},
      important: [],
      summarized: false,
      fallbackReason: "empty",
    };
  }

  if (!isAgentConfigured()) {
    return fallbackDigest(rows, "agent_not_configured", preferZh, { todayIso });
  }

  const { apiKey, baseUrl, model } = getAgentConfig();
  const languageLine = preferZh
    ? "Write concise, actionable Chinese (简体中文) for digest and item summaries."
    : "Write concise, actionable English for digest and item summaries.";
  const system = [
    "You summarize an email inbox for dayfly.",
    `Today is ${todayIso} (YYYY-MM-DD).`,
    languageLine,
    "Respond with ONLY valid JSON:",
    '{ "digest": string, "items": [ { "id": string, "summary": string } ], "important": [ { "id": string, "reason": string } ] }',
    "digest: 1-2 sentences covering what needs attention today.",
    "items: one summary per input message id (max ~20 words each).",
    "important: the 5 messages that most need the reader's attention, most important first.",
    "Prefer messages from real people, anything needing a reply, a decision, a payment, a deadline, travel or security; prefer unread, starred and important-marked mail.",
    "Rank newsletters, promotions and automated notifications last unless they need action. reason: max ~8 words, why it matters.",
    "Do not invent message ids. Do not include raw HTML.",
  ].join("\n");

  const user = JSON.stringify(
    {
      today: todayIso,
      messages: rows.map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from,
        receivedAt: m.receivedAt,
        snippet: m.snippet || "",
        unread: Boolean(m.unread),
        starred: Boolean(m.starred),
        markedImportant: Boolean(m.markedImportant),
        category: m.category || "primary",
      })),
    },
    null,
    2
  );

  try {
    const content = await callOpenAiChat({ apiKey, baseUrl, model, system, user });
    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed !== "object") {
      return fallbackDigest(rows, "llm_failed", preferZh, { todayIso });
    }
    const digest =
      typeof parsed.digest === "string" && parsed.digest.trim()
        ? parsed.digest.trim().slice(0, 400)
        : fallbackDigest(rows, "llm_failed", preferZh, { todayIso }).digest;
    const summaries = {};
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (!item || typeof item.id !== "string") continue;
      if (typeof item.summary !== "string" || !item.summary.trim()) continue;
      summaries[item.id] = item.summary.trim().slice(0, 220);
    }
    for (const message of rows) {
      if (!summaries[message.id]) {
        const snippet = String(message.snippet || "").trim();
        summaries[message.id] = snippet
          ? snippet.slice(0, 160)
          : String(message.subject || "(No subject)").slice(0, 120);
      }
    }
    const important = mergeImportant(parsed.important, rows, todayIso, preferZh);
    return { digest, summaries, important, summarized: true };
  } catch (_) {
    return fallbackDigest(rows, "llm_failed", preferZh, { todayIso });
  }
}

module.exports = {
  summarizeInboxMessages,
  fallbackDigest,
  scoreImportance,
  mergeImportant,
  senderName,
};
