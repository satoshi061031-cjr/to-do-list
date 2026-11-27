const { createPrivateKey, sign, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const http2 = require("node:http2");

function createAppleSender(env = process.env, connect = http2.connect) {
  const { DAYFLY_APNS_TEAM_ID: team, DAYFLY_APNS_KEY_ID: kid, DAYFLY_APNS_KEY_FILE: file,
    DAYFLY_APNS_WIDGET_TOPIC: topic, DAYFLY_APNS_ENVIRONMENT: environment } = env;
  if (!team || !kid || !file || !topic || !["sandbox", "production"].includes(environment)) return null;
  let key;
  try { key = createPrivateKey(readFileSync(file)); }
  catch { console.warn("Watch push disabled: could not load APNs signing key."); return null; }
  const base64 = object => Buffer.from(JSON.stringify(object)).toString("base64url");
  let jwt, issuedAt = 0;
  return deviceToken => new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    if (!jwt || now - issuedAt > 45 * 60) {
      const header = base64({ alg: "ES256", kid }) + "." + base64({ iss: team, iat: now });
      jwt = header + "." + sign("sha256", Buffer.from(header), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
      issuedAt = now;
    }
    const host = environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const client = connect("https://" + host);
    const timer = setTimeout(() => client.destroy(new Error("APNs timeout")), 10_000);
    client.once("error", reject);
    client.once("close", () => { clearTimeout(timer); reject(new Error("APNs connection closed")); });
    const request = client.request({ ":method": "POST", ":path": "/3/device/" + deviceToken,
      authorization: "bearer " + jwt, "apns-push-type": "widgets", "apns-topic": topic,
      "apns-priority": "5", "apns-collapse-id": "dayfly-spending" });
    let status = 0, body = "";
    request.on("response", headers => { status = headers[":status"]; });
    request.setEncoding("utf8").on("data", chunk => { body += chunk; });
    request.once("error", error => { reject(error); client.destroy(); });
    request.once("end", () => {
      clearTimeout(timer);
      client.close();
      if (status === 200) return resolve("sent");
      let reason;
      try { reason = JSON.parse(body).reason; } catch { /* Empty APNs response. */ }
      if (status === 410 || (status === 400 && reason === "BadDeviceToken")) return resolve("expired");
      reject(new Error("Widget push rejected: HTTP " + status));
    });
    request.end(JSON.stringify({ aps: { "content-changed": true } }));
  });
}

// Persist pending invalidations. APNs receives only a wake-up hint; the
// widget must still authenticate to read the ledger after every notification.
function createWatchPush(db, send) {
  db.exec(`CREATE TABLE IF NOT EXISTS watch_widget_subscriptions (
    owner TEXT PRIMARY KEY REFERENCES watch_spending_devices(owner) ON DELETE CASCADE,
    credential TEXT NOT NULL, device TEXT NOT NULL, ledger_hash TEXT NOT NULL DEFAULT '',
    pending INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0)`);
  const next = db.prepare(`SELECT w.* FROM watch_widget_subscriptions w JOIN watch_spending_devices d
    ON d.owner=w.owner AND d.token_hash=w.credential WHERE pending=1 AND retry_at<=? ORDER BY retry_at LIMIT 1`);
  const registered = db.prepare("SELECT 1 FROM watch_widget_subscriptions WHERE owner=?");
  let running = false;
  async function flush() {
    if (!send || running) return;
    running = true;
    try {
      let item;
      while ((item = next.get(Date.now()))) {
        const { owner, credential, device, ledger_hash: hash } = item;
        try {
          const result = await send(device);
          if (result === "expired") {
            db.prepare("DELETE FROM watch_widget_subscriptions WHERE owner=? AND credential=? AND device=?").run(owner, credential, device);
          } else {
            db.prepare("UPDATE watch_widget_subscriptions SET pending=0 WHERE owner=? AND credential=? AND device=? AND ledger_hash=?")
              .run(owner, credential, device, hash);
          }
        } catch {
          db.prepare("UPDATE watch_widget_subscriptions SET retry_at=? WHERE owner=? AND credential=? AND device=?")
            .run(Date.now() + 60_000, owner, credential, device);
        }
      }
    } finally { running = false; }
  }
  function register(owner, credential, device) {
    if (!send) throw Object.assign(new Error("Widget push is not configured."), { statusCode: 503 });
    if (typeof device !== "string" || !/^(?:[0-9a-f]{2}){16,256}$/.test(device)) {
      throw Object.assign(new Error("Invalid widget push token."), { statusCode: 400 });
    }
    db.prepare(`INSERT INTO watch_widget_subscriptions (owner, credential, device) VALUES (?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET credential=excluded.credential, device=excluded.device, retry_at=0`).run(owner, credential, device);
  }
  function invalidate(owner, rawBook) {
    if (!send || !registered.get(owner)) return;
    const hash = createHash("sha256").update(rawBook || "").digest("hex");
    const { changes } = db.prepare("UPDATE watch_widget_subscriptions SET ledger_hash=?, pending=1 WHERE owner=? AND ledger_hash<>?")
      .run(hash, owner, hash);
    if (changes) void flush().catch(() => {});
  }
  const timer = send && setInterval(() => { void flush().catch(() => {}); }, 60_000).unref();
  return { register, invalidate, flush, remove(owner) {
    db.prepare("DELETE FROM watch_widget_subscriptions WHERE owner=?").run(owner);
  }, close() { clearInterval(timer); } };
}

module.exports = { createAppleSender, createWatchPush };
