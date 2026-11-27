// A loopback-only development ledger for the independent watchOS app.
const { randomBytes } = require("node:crypto");
const readline = require("node:readline");
Object.assign(process.env, {
  DAYFLY_BIND_HOST: "127.0.0.1", DAILY_SPACE_DB_PATH: ":memory:",
  SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
  APP_SESSION_SECRET: randomBytes(32).toString("hex"),
  GROQ_API_KEY: "", OPENAI_API_KEY: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "",
});
const { getDb, upsertUserSnapshot } = require("../server/db");
const { getDefaultStore } = require("../server/user-snapshot-store");
const { createWatchSpending } = require("../server/watch-spending");
const { writeStore } = require("../server/snapshot-values");
const { dateInZone } = require("../server/quick-add");
const owner = "watch-demo@example.test";
const date = dateInZone(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
const book = { baseCurrency: "CNY", records: [
  { date, amount: 54, currency: "CNY" },
  { date, amount: 3, currency: "USD", fxRate: 7.1 },
  { date, amount: 100, currency: "CNY", scope: "shared" },
] };
upsertUserSnapshot(owner, writeStore({}, "tally-book-v1", book), 0);
const watch = createWatchSpending(getDb(), getDefaultStore);
require("../server/index");
function showCode() {
  try { console.log("手表开发配对码（10 分钟有效）：", watch.issue(owner).code); }
  catch (error) { console.error(error.message); }
}
console.log("临时测试账本 ·", date, "· CNY 75.30；按回车可生成新码。");
showCode();
if (process.stdin.isTTY) readline.createInterface({ input: process.stdin }).on("line", showCode);
