const { isAgentConfigured, getAgentConfig, callOpenAiChat, extractJsonObject } = require("./agent");

const MAX_MESSAGES = 20;

function fallbackDigest(messages) {
  const count = messages.length;
  const digest =
    count === 0
      ? "Inbox is quiet — no recent messages."
      : count === 1
        ? "1 recent message in your inbox."
        : `${count} recent messages in your inbox.`;
  const summaries = {};
  for (const message of messages) {
    const snippet = String(message.snippet || "").trim();
    summaries[message.id] = snippet
      ? snippet.slice(0, 160)
      : String(message.subject || "(No subject)").slice(0, 120);
  }
  return { digest, summaries, summarized: false };
}

async function summarizeInboxMessages(messages, todayIso) {
  const rows = Array.isArray(messages) ? messages.slice(0, MAX_MESSAGES) : [];
  if (!rows.length) {
    return { digest: "Inbox is quiet — no recent messages.", summaries: {}, summarized: false };
  }

  if (!isAgentConfigured()) {
    return fallbackDigest(rows);
  }

  const { apiKey, baseUrl, model } = getAgentConfig();
  const system = [
    "You summarize an email inbox for Daily Space.",
    `Today is ${todayIso} (YYYY-MM-DD).`,
    "Write concise, actionable Chinese or English matching the message language.",
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
      return fallbackDigest(rows);
    }
    const digest =
      typeof parsed.digest === "string" && parsed.digest.trim()
        ? parsed.digest.trim().slice(0, 400)
        : fallbackDigest(rows).digest;
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
    return fallbackDigest(rows);
  }
}

module.exports = {
  summarizeInboxMessages,
};
