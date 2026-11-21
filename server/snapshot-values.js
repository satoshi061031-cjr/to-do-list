/**
 * Account snapshot values: each store (todo-app-v2, tally-book-v1, ...) is a
 * JSON string. Large values travel and are stored gzip-compressed as
 * "gz1:<base64>", which keeps years of data under the snapshot size limit.
 * Plain JSON strings remain valid, so old clients and old rows keep working.
 *
 * Server code must read and write stores through readStore/writeStore rather
 * than JSON.parse(payload[key]) directly.
 */
const zlib = require("node:zlib");

const PREFIX = "gz1:";
// Small stores stay readable plain JSON; compression only pays off on larger ones.
const COMPRESS_FROM_BYTES = 2048;

function isCompressed(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** The plain JSON text of a stored value, or null when it is missing or unreadable. */
function decodeValue(value) {
  if (typeof value !== "string") return null;
  if (!isCompressed(value)) return value;
  try {
    return zlib.gunzipSync(Buffer.from(value.slice(PREFIX.length), "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
  } catch (_) {
    return null;
  }
}

/** Store text, compressed when it is large enough to benefit. */
function encodeValue(text, { compress = true } = {}) {
  const raw = String(text);
  if (!compress || Buffer.byteLength(raw, "utf8") < COMPRESS_FROM_BYTES) return raw;
  return PREFIX + zlib.gzipSync(Buffer.from(raw, "utf8"), { level: 9 }).toString("base64");
}

/** Parsed store object from a snapshot payload (null when absent or invalid). */
function readStore(payload, key) {
  const text = decodeValue(payload && typeof payload === "object" ? payload[key] : undefined);
  if (text == null) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

/** A new payload with one store replaced; other stores are carried over untouched. */
function writeStore(payload, key, value) {
  return { ...(payload && typeof payload === "object" ? payload : {}), [key]: encodeValue(JSON.stringify(value)) };
}

/** Every value as plain JSON text, e.g. for a user's data export. */
function decodePayload(payload) {
  const result = {};
  for (const [key, value] of Object.entries(payload && typeof payload === "object" ? payload : {})) {
    const text = decodeValue(value);
    if (text != null) result[key] = text;
  }
  return result;
}

module.exports = { PREFIX, COMPRESS_FROM_BYTES, isCompressed, decodeValue, encodeValue, readStore, writeStore, decodePayload };
