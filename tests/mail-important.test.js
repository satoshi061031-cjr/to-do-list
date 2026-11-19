const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeInboxMessages, scoreImportance, mergeImportant } = require("../server/mail-digest");
const { createMailAccountBackup } = require("../server/mail-account-backup");

const inbox = [
  { id: "promo", subject: "Weekly newsletter: 10 tips", from: "News <newsletter@shop.com>", snippet: "Deals inside", category: "promotions", unread: true, receivedAt: "2026-11-19T08:00:00Z" },
  { id: "invoice", subject: "Invoice #123 due Friday", from: "Alice <alice@client.com>", snippet: "Please process payment", unread: true, receivedAt: "2026-11-18T08:00:00Z" },
  { id: "lunch", subject: "Lunch?", from: "Bob <bob@gmail.com>", snippet: "Are you free", receivedAt: "2026-11-19T07:00:00Z" },
  { id: "interview", subject: "面试安排确认", from: "HR <hr@corp.cn>", snippet: "请确认周四的面试时间", unread: true, markedImportant: true, receivedAt: "2026-11-17T08:00:00Z" },
  { id: "shipped", subject: "Your order shipped", from: "noreply@store.com", snippet: "Tracking", category: "updates", receivedAt: "2026-11-19T09:00:00Z" },
  { id: "contract", subject: "Contract to sign", from: "Carol <carol@law.com>", starred: true, receivedAt: "2026-11-10T08:00:00Z" },
  { id: "promo2", subject: "Sale ends tonight", from: "deals@shop.com", category: "promotions", receivedAt: "2026-11-19T10:00:00Z" },
];

test("without a model, the five most important messages are chosen by rules with reasons", async () => {
  const result = await summarizeInboxMessages(inbox, "2026-11-19", { lang: "zh" });
  assert.equal(result.fallbackReason, "agent_not_configured");
  // Only mail with a positive signal qualifies: promotions and a shipping notice are left out.
  assert.deepEqual(result.important.map((item) => item.id), ["interview", "contract", "invoice", "lunch"]);
  assert.match(result.important[0].reason, /标记为重要/);
  assert.equal((await summarizeInboxMessages(inbox, "2026-11-19", { lang: "en" })).important[0].reason, "Marked important · Needs action");
});

test("a model's picks keep their order; unknown or repeated ids are dropped and rules fill the rest", () => {
  const merged = mergeImportant([{ id: "lunch", reason: "Friend asking" }, { id: "missing" }, { id: "lunch" }, { id: "shipped", reason: "" }], inbox, "2026-11-19", false);
  assert.deepEqual(merged.map((item) => item.id), ["lunch", "shipped", "interview", "contract", "invoice"]);
  assert.deepEqual(merged.slice(0, 2).map((item) => [item.source, item.reason]), [["ai", "Friend asking"], ["ai", "Picked by AI"]]);
  assert.equal(merged[2].source, "rules");
  assert.equal(scoreImportance([], "2026-11-19").length, 0);
});

test("mailboxes are mirrored to the backup and restored only when the server has none", async () => {
  const local = new Map();
  const remote = new Map();
  const client = {
    from: () => ({
      upsert: async (row) => { remote.set(row.user_id, row.accounts); return { error: null }; },
      delete: () => ({ eq: async (column, value) => { remote.delete(value); return { error: null }; } }),
      select: () => ({ eq: (column, value) => ({ maybeSingle: async () => ({ data: remote.has(value) ? { accounts: remote.get(value) } : null, error: null }) }) }),
    }),
  };
  const backup = createMailAccountBackup({
    client,
    exportRows: (user) => local.get(user) || [],
    importRows: (user, rows) => { local.set(user, rows); return rows.length; },
  });
  local.set("a@example.test", [{ id: "a:gmail", provider: "gmail", email: "a@example.test", refresh_token: "enc:v1:sealed" }]);
  await backup.save("a@example.test");
  assert.equal(remote.get("a@example.test")[0].refresh_token, "enc:v1:sealed");

  local.clear(); // the server's SQLite file was wiped
  const fresh = createMailAccountBackup({ client, exportRows: (user) => local.get(user) || [], importRows: (user, rows) => { local.set(user, rows); return rows.length; } });
  assert.equal(await fresh.ensureRestored("a@example.test"), 1);
  assert.equal(local.get("a@example.test")[0].refresh_token, "enc:v1:sealed");
  assert.equal(await fresh.ensureRestored("a@example.test"), 0, "restores once per user and process");

  local.set("a@example.test", []);
  await backup.save("a@example.test");
  assert.equal(remote.has("a@example.test"), false, "disconnecting every mailbox removes the backup");
  assert.equal(createMailAccountBackup({ config: { url: "", serviceRoleKey: "" }, exportRows: () => [], importRows: () => 0 }).configured, false);
});
