/**
 * Quick add: record a Tally expense from outside the app (for example an iOS
 * Shortcut) with a personal key instead of a browser session.
 *
 * The key is a signed, stateless token. Its identifier lives in the owner's
 * synced Tally book (`quickAddKeyId`), so replacing or clearing that
 * identifier revokes the key without any server-side table, and the expense is
 * written into the same account snapshot every device already syncs.
 */
const crypto = require("node:crypto");
const TallyCore = require("../tally-core.js");
const { readStore, writeStore } = require("./snapshot-values");

const TOKEN_PREFIX = "dfq_";
const TALLY_KEY = "tally-book-v1";
const MAX_WRITE_ATTEMPTS = 4;

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

function validTimeZone(value) {
  const zone = typeof value === "string" ? value.trim().slice(0, 64) : "";
  if (!zone) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); return zone; } catch (_) { return null; }
}

function dateInZone(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const pick = type => parts.find(part => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Accepts 32, "32.5", "¥32", "1,280" — what a person types or dictates into a Shortcut. */
function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/[\s,，¥￥$€£]/g, "");
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

async function defaultFetchRate(from, to) {
  const endpoint = new URL("https://api.frankfurter.app/latest");
  endpoint.searchParams.set("amount", "1"); endpoint.searchParams.set("from", from); endpoint.searchParams.set("to", to);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8_000) });
  const rate = response.ok ? Number((await response.json())?.rates?.[to]) : NaN;
  if (!(rate > 0)) throw fail("Exchange rate is unavailable. Send fxRate, or use your ledger's base currency.", 502, "FX_UNAVAILABLE");
  return rate;
}

function createLimiter({ now = Date.now, windowMs = 60_000, limit = 30, maxKeys = 10_000 } = {}) {
  const buckets = new Map();
  return function hit(key) {
    const timestamp = now();
    for (const [name, bucket] of buckets) if (timestamp >= bucket.resetAt) buckets.delete(name);
    const bucket = buckets.get(key) || (buckets.size < maxKeys ? { count: 0, resetAt: timestamp + windowMs } : null);
    if (!bucket || bucket.count >= limit) {
      throw Object.assign(fail("Too many requests. Try again shortly.", 429, "QUICK_ADD_RATE_LIMITED"),
        { retryAfter: Math.max(1, Math.ceil(((bucket?.resetAt || timestamp + windowMs) - timestamp) / 1000)) });
    }
    bucket.count += 1; buckets.set(key, bucket);
  };
}

function createQuickAdd({ getSecret, getSnapshotStore, fetchRate = defaultFetchRate, now = Date.now } = {}) {
  const limitUser = createLimiter({ now, limit: 30 });
  const limitFailures = createLimiter({ now, limit: 30 });

  function sign(payloadJson) {
    const secret = getSecret();
    if (!secret) throw fail("Quick add is not configured on this server.", 503, "QUICK_ADD_UNAVAILABLE");
    // Domain-separated from session cookies, which use the same secret.
    return crypto.createHmac("sha256", secret).update(`quick-add:v1:${payloadJson}`).digest("base64url");
  }

  function issueKey(userId, timeZone) {
    const owner = String(userId || "").trim().toLowerCase();
    if (!owner) throw fail("Please sign in first.", 401);
    const keyId = crypto.randomBytes(18).toString("base64url");
    const payloadJson = JSON.stringify({ u: owner, k: keyId, z: validTimeZone(timeZone) });
    return { keyId, token: `${TOKEN_PREFIX}${Buffer.from(payloadJson, "utf8").toString("base64url")}.${sign(payloadJson)}` };
  }

  function verify(token) {
    const raw = typeof token === "string" ? token.trim() : "";
    if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 1024) return null;
    const [payloadPart, signature, extra] = raw.slice(TOKEN_PREFIX.length).split(".");
    if (!payloadPart || !signature || extra !== undefined) return null;
    let payloadJson, parsed;
    try { payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8"); parsed = JSON.parse(payloadJson); } catch (_) { return null; }
    const expected = Buffer.from(sign(payloadJson)), given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (!parsed || typeof parsed.u !== "string" || !parsed.u || typeof parsed.k !== "string" || !parsed.k) return null;
    return { userId: parsed.u, keyId: parsed.k, timeZone: validTimeZone(parsed.z) };
  }

  function bearer(header) {
    const match = /^Bearer\s+(\S+)$/i.exec(String(header || "").trim());
    return match ? match[1] : "";
  }

  async function addExpense({ authorization, body, ip }) {
    const key = verify(bearer(authorization));
    if (!key) { limitFailures(`ip:${ip || "unknown"}`); throw fail("Invalid or missing quick-add key.", 401, "QUICK_ADD_KEY_INVALID"); }
    limitUser(`user:${key.userId}`);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("Send a JSON object.", 400);

    const amount = parseAmount(body.amount);
    if (!(amount > 0) || amount > 1e12) throw fail("amount must be a number greater than 0.", 400, "INVALID_AMOUNT");
    const timeZone = validTimeZone(body.timeZone) || key.timeZone;
    let date = dateInZone(now(), timeZone);
    if (body.date != null && body.date !== "") {
      date = TallyCore.validDate(String(body.date).trim().slice(0, 10));
      if (!date) throw fail("date must look like 2026-01-31.", 400, "INVALID_DATE");
    }
    const requestedCurrency = body.currency == null || body.currency === "" ? null : String(body.currency).trim().toUpperCase();
    if (requestedCurrency && !/^[A-Z]{3}$/.test(requestedCurrency)) throw fail("currency must be a 3-letter code such as CNY.", 400, "INVALID_CURRENCY");
    const requestId = typeof body.id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(body.id.trim()) ? `quick-${body.id.trim()}` : null;
    if (body.id != null && body.id !== "" && !requestId) throw fail("id may only contain letters, digits and _ . : -", 400, "INVALID_ID");

    const store = getSnapshotStore();
    let rate = null;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await store.getSnapshot(key.userId);
      const book = readStore(snapshot?.payload, TALLY_KEY);
      // An unknown, replaced or cleared identifier all read the same: the key no longer works.
      if (!book || book.quickAddKeyId !== key.keyId) {
        limitFailures(`ip:${ip || "unknown"}`);
        throw fail("This quick-add key is not active. Create a new one in Tally.", 401, "QUICK_ADD_KEY_INACTIVE");
      }
      const state = TallyCore.normalizeState(book);
      const duplicate = requestId && state.records.find(record => record.id === requestId);
      if (duplicate) return summary(state, duplicate, true);

      const currency = requestedCurrency || state.baseCurrency;
      let fxRate = 1;
      if (currency !== state.baseCurrency) {
        const given = Number(body.fxRate);
        if (body.fxRate != null && body.fxRate !== "" && !(given > 0 && given <= 1e6)) throw fail("fxRate must be a positive number.", 400, "INVALID_FX_RATE");
        fxRate = given > 0 ? given : (rate ?? (rate = await fetchRate(currency, state.baseCurrency)));
      }
      const record = TallyCore.normalizeRecord({
        id: requestId || `quick-${crypto.randomUUID()}`, date, amount, currency, fxRate, scope: "personal",
        category: typeof body.category === "string" ? body.category : "", note: typeof body.note === "string" ? body.note : "",
      }, state);
      if (!record) throw fail("The expense could not be recorded.", 400);
      if (!String(body.category || "").trim()) record.category = "Other";
      state.records.unshift(record);
      try {
        await store.upsertSnapshot(key.userId, writeStore(snapshot.payload, TALLY_KEY, state), snapshot.revision || 0);
        return summary(state, record, false);
      } catch (error) {
        // Another device synced in between: re-read and apply the expense on top of it.
        if (error?.code !== "SNAPSHOT_CONFLICT") throw error;
      }
    }
    throw fail("Your account is syncing right now. Try again in a moment.", 503, "QUICK_ADD_BUSY");
  }

  function summary(state, record, duplicate) {
    const dayTotal = state.records.filter(item => item.scope === "personal" && item.date === record.date)
      .reduce((sum, item) => sum + Number(item.amount) * Number(item.fxRate || 1), 0);
    const money = (value, currency) => `${currency} ${Number(value.toFixed(2))}`;
    return {
      ok: true, duplicate,
      record: { id: record.id, date: record.date, amount: record.amount, currency: record.currency, category: record.category, note: record.note },
      dayTotal: Number(dayTotal.toFixed(2)), baseCurrency: state.baseCurrency,
      message: `${duplicate ? "Already recorded" : "Recorded"} ${money(record.amount, record.currency)} · ${record.category} · ${record.date}. Day total ${money(dayTotal, state.baseCurrency)}.`,
    };
  }

  return { issueKey, verify, addExpense };
}

module.exports = { createQuickAdd, parseAmount, dateInZone };
