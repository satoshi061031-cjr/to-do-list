const { isAgentConfigured, getAgentConfig, callOpenAiChat, extractJsonObject } = require("./agent");

const MAX_MESSAGES = 20;

function fallbackDigest(messages, reason, preferZh) {
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
      summarized: false,
      fallbackReason: "empty",
    };
  }

  if (!isAgentConfigured()) {
    return fallbackDigest(rows, "agent_not_configured", preferZh);
  }

  const { apiKey, baseUrl, model } = getAgentConfig();
  const languageLine = preferZh
    ? "Write concise, actionable Chinese (简体中文) for digest and item summaries."
    : "Write concise, actionable English for digest and item summaries.";
  const system = [
    "You summarize an email inbox for Daily Space.",
    `Today is ${todayIso} (YYYY-MM-DD).`,
    languageLine,
    "Respond with ONLY valid JSON:",
    '{ "digest": string, "items": [ { "id": string, "summary": string } ] }',
    "digest: 1-2 sentences covering what needs attention today.",
    "items: one summary per input message id (max ~20 words each).",
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
      })),
    },
    null,
    2
  );

  try {
    const content = await callOpenAiChat({ apiKey, baseUrl, model, system, user });
    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed !== "object") {
      return fallbackDigest(rows, "llm_failed", preferZh);
    }
    const digest =
      typeof parsed.digest === "string" && parsed.digest.trim()
        ? parsed.digest.trim().slice(0, 400)
        : fallbackDigest(rows, "llm_failed", preferZh).digest;
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
    return { digest, summaries, summarized: true };
  } catch (_) {
    return fallbackDigest(rows, "llm_failed", preferZh);
  }
}

module.exports = {
  summarizeInboxMessages,
  fallbackDigest,
};
