const crypto = require("node:crypto");
const Tally = require("../tally-core");
const { dateInZone, validTimeZone, createLimiter } = require("./quick-add");
const { readStore } = require("./snapshot-values");
const { createWatchPush } = require("./watch-push");

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function createWatchSpending(db, getSnapshotStore, now = Date.now, pushSender = null) {
  const waiting = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS watch_spending_devices (
    owner TEXT PRIMARY KEY, code_hash TEXT UNIQUE, expires_at INTEGER, token_hash TEXT UNIQUE
  )`);
  const throttle = createLimiter({ limit: 15, now, code: "WATCH_RATE_LIMITED" });
  const reader = db.prepare("SELECT owner FROM watch_spending_devices WHERE token_hash = ?");
  const push = createWatchPush(db, pushSender);
  const unsubscribePush = pushSender && getSnapshotStore().onSaved((owner, payload) => {
    try { push.invalidate(owner, payload[Tally.STORAGE_KEY]); }
    catch { console.warn("Unable to queue watch refresh after ledger save."); }
  });
  function issue(owner) {
    throttle("issue:" + owner);
    // 40 random bits, grouped for entry on the watch. Keep the previous device until redemption.
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    const expiresAt = now() + 600_000;
    db.prepare(`INSERT INTO watch_spending_devices (owner, code_hash, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at`)
      .run(owner, digest(code), expiresAt);
    return { code: code.slice(0, 5) + "-" + code.slice(5), expiresAt };
  }
  function redeem(input, ip) {
    throttle("pair:" + ip);
    const code = typeof input === "string" ? input.replace(/[\s-]/g, "").toUpperCase() : "";
    const token = "dfw_" + crypto.randomBytes(32).toString("base64url");
    const device = /^[A-F0-9]{10}$/.test(code) && db.prepare(`UPDATE watch_spending_devices
      SET token_hash = ?, code_hash = NULL, expires_at = NULL WHERE code_hash = ? AND expires_at > ? RETURNING owner`)
      .get(digest(token), digest(code), now());
    if (!device) throw error("Invalid or expired pairing code.", 401);
    push.remove(device.owner);
    waiting.get(device.owner)?.();
    return { token };
  }
  function revoke(owner) {
    push.remove(owner);
    db.prepare("DELETE FROM watch_spending_devices WHERE owner = ?").run(owner);
    waiting.get(owner)?.();
  }
  function deviceFor(authorization) {
    const token = /^Bearer (dfw_[A-Za-z0-9_-]{43})$/.exec(authorization || "")?.[1];
    const key = token && digest(token);
    const owner = key && reader.get(key)?.owner;
    if (!owner) throw error("Pair this watch again.", 401);
    return { key, owner };
  }
  async function today(authorization, zone) {
    const { key, owner } = deviceFor(authorization);
    const timeZone = validTimeZone(zone);
    if (!timeZone) throw error("A valid time zone is required.", 400);
    const snapshot = await getSnapshotStore().getSnapshot(owner);
    if (reader.get(key)?.owner !== owner) throw error("Pair this watch again.", 401);
    const raw = readStore(snapshot?.payload, Tally.STORAGE_KEY);
    if (!raw || !Array.isArray(raw.records)) throw error("Open the ledger and sync it to dayfly.", 409);
    const book = Tally.normalizeState(raw);
    const checkedAt = now();
    const date = dateInZone(checkedAt, timeZone);
    const total = Tally.personalRecords(book.records).filter(record => record.date === date)
      .reduce((sum, record) => sum + Tally.baseAmount(record), 0);
    if (!Number.isFinite(total)) throw error("Ledger total is unavailable.", 422);
    return { date, currency: book.baseCurrency, amount: total.toFixed(2), checkedAt };
  }
  // The tag covers only what the watch is allowed to see. Subscribe before
  // reading so a commit during the initial database read cannot be missed.
  const changeTag = value => digest(JSON.stringify([value.date, value.currency, value.amount]));
  async function read(authorization, zone, previous, signal) {
    if (!previous) return today(authorization, zone);
    const { owner } = deviceFor(authorization);
    if (!/^[a-f0-9]{64}$/.test(previous)) throw error("Invalid change tag.", 400);
    if (waiting.has(owner)) throw error("A watch request is already waiting.", 429);
    let wake;
    const changed = new Promise(resolve => { wake = resolve; });
    waiting.set(owner, wake);
    const unsubscribe = getSnapshotStore().onCommit(owner, wake);
    const timer = setTimeout(wake, 22_000);
    signal?.addEventListener("abort", wake, { once: true });
    try {
      const current = await today(authorization, zone);
      if (signal?.aborted || changeTag(current) !== previous) return current;
      await changed;
      if (signal?.aborted) return;
      return await today(authorization, zone);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", wake);
      unsubscribe();
      waiting.delete(owner);
    }
  }
  function configurePush(authorization, device) {
    const { key, owner } = deviceFor(authorization);
    if (device === null) push.remove(owner);
    else push.register(owner, key, device);
  }
  return { issue, redeem, revoke, today, read, changeTag, configurePush, close() {
    unsubscribePush?.();
    push.close();
  } };
}

module.exports = { createWatchSpending };
