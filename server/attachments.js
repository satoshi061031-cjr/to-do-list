/**
 * Task attachments: files a signed-in person adds to a task.
 *
 * The task keeps only a reference ({ id, name, type, size, createdAt }) in the
 * synced snapshot; the bytes live in a private Supabase Storage bucket, or in a
 * folder beside the SQLite file when Supabase is not configured (for local and
 * Docker use; a host that wipes its disk loses that folder).
 *
 * Files are stored under a hash of the owner's account, so an id alone never
 * reaches another account's file. Removing an attachment from a task does not
 * delete the file at once: undo and record history can bring the reference
 * back. A sweep deletes files that no store in the owner's snapshot mentions
 * any more, once they are a few days old.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { decodePayload } = require("./snapshot-values");

const BUCKET = "task-attachments";
const ID = /^[A-Za-z0-9_-]{22}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
// Only these are shown in the browser; everything else downloads as bytes.
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const MB = 1024 * 1024;

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

function ownerKey(userId) {
  return crypto.createHash("sha256").update(String(userId || "").trim().toLowerCase()).digest("hex").slice(0, 32);
}

function cleanType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  return MIME.test(type) ? type : "application/octet-stream";
}

/** A file name that is safe in a Content-Disposition header. */
function cleanName(value) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const name = String(value || "").replace(/[\u0000-\u001f\u007f"\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return name || "attachment";
}

/** The request body as one Buffer, refusing anything larger than maxBytes. */
function readBody(request, maxBytes) {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) return Promise.reject(fail(`Files can be at most ${Math.round(maxBytes / MB)} MB.`, 413, "ATTACHMENT_TOO_LARGE"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    request.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(fail(`Files can be at most ${Math.round(maxBytes / MB)} MB.`, 413, "ATTACHMENT_TOO_LARGE"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    request.on("error", (error) => { if (!done) { done = true; reject(error); } });
  });
}

function supabaseBackend(supabase) {
  let ready = null;
  const bucket = () => supabase.storage.from(BUCKET);
  async function ensureBucket() {
    ready ||= (async () => {
      const { data, error } = await supabase.storage.getBucket(BUCKET);
      if (data && !error) return;
      const created = await supabase.storage.createBucket(BUCKET, { public: false });
      if (created.error && !/already exists/i.test(created.error.message || "")) throw created.error;
    })().catch((error) => { ready = null; throw error; });
    return ready;
  }
  return {
    kind: "supabase",
    async put(owner, id, buffer, type) {
      // Storage records its own creation time, which the sweep reads from list().
      await ensureBucket();
      const { error } = await bucket().upload(`${owner}/${id}`, buffer, { contentType: type, upsert: false });
      if (error) throw error;
    },
    async get(owner, id) {
      await ensureBucket();
      const { data, error } = await bucket().download(`${owner}/${id}`);
      if (error || !data) return null;
      return { buffer: Buffer.from(await data.arrayBuffer()), type: cleanType(data.type) };
    },
    async list(owner) {
      await ensureBucket();
      const files = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket().list(owner, { limit: 1000, offset });
        if (error) throw error;
        for (const item of data || []) {
          if (!ID.test(item.name)) continue;
          files.push({ id: item.name, size: Number(item.metadata?.size) || 0, createdAt: Date.parse(item.created_at) || 0 });
        }
        if (!data || data.length < 1000) break;
      }
      return files;
    },
    async remove(owner, ids) {
      if (!ids.length) return;
      await ensureBucket();
      const { error } = await bucket().remove(ids.map((id) => `${owner}/${id}`));
      if (error) throw error;
    },
  };
}

function diskBackend(root) {
  const folder = (owner) => path.join(root, owner);
  return {
    kind: "disk",
    async put(owner, id, buffer, type, createdAt = Date.now()) {
      await fs.promises.mkdir(folder(owner), { recursive: true });
      await fs.promises.writeFile(path.join(folder(owner), id), buffer, { flag: "wx" });
      await fs.promises.writeFile(path.join(folder(owner), `${id}.json`), JSON.stringify({ type, createdAt }));
    },
    async get(owner, id) {
      try {
        const [buffer, meta] = await Promise.all([
          fs.promises.readFile(path.join(folder(owner), id)),
          fs.promises.readFile(path.join(folder(owner), `${id}.json`), "utf8").then(JSON.parse).catch(() => ({})),
        ]);
        return { buffer, type: cleanType(meta.type) };
      } catch (_) {
        return null;
      }
    },
    async list(owner) {
      let names;
      try { names = await fs.promises.readdir(folder(owner)); } catch (_) { return []; }
      const files = [];
      for (const name of names.filter((item) => ID.test(item))) {
        const stat = await fs.promises.stat(path.join(folder(owner), name)).catch(() => null);
        if (!stat) continue;
        const meta = await fs.promises.readFile(path.join(folder(owner), `${name}.json`), "utf8").then(JSON.parse).catch(() => ({}));
        files.push({ id: name, size: stat.size, createdAt: Number.isFinite(meta.createdAt) ? meta.createdAt : stat.mtimeMs });
      }
      return files;
    },
    async remove(owner, ids) {
      for (const id of ids) {
        await fs.promises.rm(path.join(folder(owner), id), { force: true });
        await fs.promises.rm(path.join(folder(owner), `${id}.json`), { force: true });
      }
    },
  };
}

function defaultDiskRoot() {
  const db = process.env.DAILY_SPACE_DB_PATH || process.env.STOCKS_DB_PATH || path.join(__dirname, "data", "daily-space.sqlite");
  return process.env.ATTACHMENTS_DIR || path.join(path.dirname(db), "attachments");
}

function createAttachments({
  config, client, backend, getSnapshotStore, now = Date.now, log = console,
  maxFileBytes = (Number(process.env.ATTACHMENT_MAX_MB) || 10) * MB,
  quotaBytes = (Number(process.env.ATTACHMENT_QUOTA_MB) || 200) * MB,
  sweepEveryMs = 12 * 60 * 60 * 1000, graceMs = 3 * 24 * 60 * 60 * 1000,
} = {}) {
  const settings = config || {
    url: String(process.env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
  const supabase = client || (settings.url && settings.serviceRoleKey
    ? createClient(settings.url, settings.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null);
  const store = backend || (supabase ? supabaseBackend(supabase) : diskBackend(defaultDiskRoot()));
  const lastSweep = new Map();

  async function upload(userId, request, { name, type } = {}) {
    if (!userId) throw fail("Sign in to attach files.", 401);
    const owner = ownerKey(userId);
    const buffer = await readBody(request, maxFileBytes);
    if (!buffer.length) throw fail("The file is empty.", 400, "ATTACHMENT_EMPTY");
    const files = await store.list(owner);
    const used = files.reduce((sum, file) => sum + file.size, 0);
    if (used + buffer.length > quotaBytes) {
      throw fail(`Attachments are full (${Math.round(quotaBytes / MB)} MB). Remove some files from tasks; space frees up within a few days.`, 413, "ATTACHMENT_QUOTA");
    }
    const id = crypto.randomBytes(16).toString("base64url");
    const contentType = cleanType(type);
    await store.put(owner, id, buffer, contentType, now());
    return {
      attachment: { id, name: cleanName(name), type: contentType, size: buffer.length, createdAt: now() },
      usage: { used: used + buffer.length, quota: quotaBytes },
    };
  }

  async function download(userId, id, name) {
    if (!userId) throw fail("Sign in to open attachments.", 401);
    if (!ID.test(String(id || ""))) throw fail("Attachment not found.", 404);
    const file = await store.get(ownerKey(userId), id);
    if (!file) throw fail("Attachment not found. It may have been removed.", 404);
    const inline = INLINE.has(file.type);
    const filename = cleanName(name);
    const headers = {
      "Content-Type": inline ? file.type : "application/octet-stream",
      "Content-Length": String(file.buffer.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Ids never change content, but the file is personal.
      "Cache-Control": "private, max-age=31536000, immutable",
    };
    // Images can never run script; a sandbox would only stop Chrome's PDF viewer, which is isolated anyway.
    if (file.type.startsWith("image/")) headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
    return { headers, body: file.buffer };
  }

  async function usage(userId) {
    if (!userId) throw fail("Sign in first.", 401);
    const files = await store.list(ownerKey(userId));
    return { used: files.reduce((sum, file) => sum + file.size, 0), quota: quotaBytes, maxFile: maxFileBytes, count: files.length, storage: store.kind };
  }

  /** Delete files no store mentions any more. Returns how many were removed. */
  async function sweep(userId) {
    const snapshotStore = getSnapshotStore?.();
    if (!userId || !snapshotStore) return 0;
    const owner = ownerKey(userId);
    const files = await store.list(owner);
    const old = files.filter((file) => now() - file.createdAt >= graceMs);
    if (!old.length) return 0;
    const snapshot = await snapshotStore.getSnapshot(userId);
    // Without a readable snapshot nothing can be proven unused.
    if (!snapshot?.payload) return 0;
    const text = Object.values(decodePayload(snapshot.payload)).join("\n");
    const unused = old.filter((file) => !text.includes(file.id)).map((file) => file.id);
    await store.remove(owner, unused);
    return unused.length;
  }

  /** At most one sweep per account per interval, never blocking the request that triggered it. */
  function scheduleSweep(userId) {
    if (!userId) return;
    const key = ownerKey(userId);
    if (now() - (lastSweep.get(key) || 0) < sweepEveryMs) return;
    lastSweep.set(key, now());
    setTimeout(() => {
      sweep(userId).then((removed) => { if (removed) log.info?.(`Removed ${removed} unused attachment(s).`); })
        .catch((error) => log.error?.(`Attachment sweep failed: ${error?.message || error}`));
    }, 0).unref?.();
  }

  return { storage: store.kind, upload, download, usage, sweep, scheduleSweep, maxFileBytes, quotaBytes };
}

module.exports = { createAttachments, ownerKey, cleanName, cleanType, diskBackend, BUCKET };
