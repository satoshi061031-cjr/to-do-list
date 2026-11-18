/**
 * Static files with compression, validators and versioned asset URLs.
 *
 * - Text files are sent brotli/gzip compressed when the client accepts it.
 * - Every response carries an ETag, so an unchanged file answers 304.
 * - HTML pages reference local scripts and stylesheets as `file.js?v=<hash>`.
 *   A request whose `v` matches the file's current hash is immutable and can
 *   be cached for a year; any other request is revalidated with the ETag.
 *
 * Files are re-read when their modification time changes, so editing a page
 * during development never serves stale content.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".webmanifest"]);
const VERSIONED = new Set([".js", ".css"]);
const ASSET_REFERENCE = /(\s(?:src|href)=")([A-Za-z0-9_./-]+\.(?:js|css))(")/g;

function createStaticAssets({ rootDir, publicAssets, contentType }) {
  const entries = new Map();

  async function load(relative) {
    const filePath = path.join(rootDir, relative);
    const realPath = await fs.promises.realpath(filePath);
    // Reject symlinks into private files, even when their public filename is allowed.
    if (realPath !== filePath) return { forbidden: true };
    const stat = await fs.promises.stat(realPath);
    const cached = entries.get(relative);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && !(await referencesChanged(cached))) return cached;
    let data = await fs.promises.readFile(realPath);
    const ext = path.extname(relative).toLowerCase();
    let references = [];
    if (ext === ".html") {
      const rewritten = await versionReferences(data.toString("utf8"), relative);
      data = Buffer.from(rewritten.html, "utf8");
      references = rewritten.references;
    }
    const hash = crypto.createHash("sha256").update(data).digest("base64url").slice(0, 12);
    const entry = {
      mtimeMs: stat.mtimeMs, size: stat.size, data, hash, ext,
      etag: `"${hash}"`, type: contentType(realPath), encoded: new Map(),
      // A page's own bytes change when a referenced file changes its hash.
      references,
    };
    entries.set(relative, entry);
    return entry;
  }

  async function referencesChanged(entry) {
    for (const [name, version] of entry.references || []) {
      try { if ((await load(name)).hash !== version) return true; } catch (_) { return true; }
    }
    return false;
  }

  async function versionReferences(html, page) {
    const base = path.posix.dirname(page);
    const references = [];
    const jobs = [];
    html.replace(ASSET_REFERENCE, (match, before, ref) => { jobs.push(ref); return match; });
    const versions = new Map();
    for (const ref of new Set(jobs)) {
      const target = path.posix.normalize(path.posix.join(base === "." ? "" : base, ref));
      if (!publicAssets.has(target) || !VERSIONED.has(path.extname(target))) continue;
      try {
        const entry = await load(target);
        if (entry.forbidden) continue;
        versions.set(ref, entry.hash); references.push([target, entry.hash]);
      } catch (_) { /* A missing asset keeps its plain URL and answers 404 as before. */ }
    }
    return {
      html: html.replace(ASSET_REFERENCE, (match, before, ref, after) => versions.has(ref) ? `${before}${ref}?v=${versions.get(ref)}${after}` : match),
      references,
    };
  }

  function encodingFor(request, entry) {
    if (!COMPRESSIBLE.has(entry.ext) || entry.data.length < 1024) return null;
    const accepted = String(request.headers["accept-encoding"] || "");
    if (/\bbr\b/.test(accepted)) return "br";
    if (/\bgzip\b/.test(accepted)) return "gzip";
    return null;
  }

  function encodedBody(entry, encoding) {
    if (!encoding) return entry.data;
    if (!entry.encoded.has(encoding)) {
      entry.encoded.set(encoding, encoding === "br"
        ? zlib.brotliCompressSync(entry.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.data.length } })
        : zlib.gzipSync(entry.data, { level: 9 }));
    }
    return entry.encoded.get(encoding);
  }

  /** Returns false when the path is not a public file, so the caller can answer 404. */
  async function serve(request, response, relative, searchParams) {
    if (!publicAssets.has(relative)) return false;
    let entry;
    try { entry = await load(relative); } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
      throw error;
    }
    if (entry.forbidden) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return true;
    }
    const immutable = VERSIONED.has(entry.ext) && searchParams.get("v") === entry.hash;
    const headers = {
      "Content-Type": entry.type,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: entry.etag,
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
    };
    const tags = String(request.headers["if-none-match"] || "").split(",").map(tag => tag.trim().replace(/^W\//, ""));
    if (tags.includes(entry.etag) || tags.includes("*")) {
      response.writeHead(304, headers);
      response.end();
      return true;
    }
    const encoding = encodingFor(request, entry);
    const body = encodedBody(entry, encoding);
    if (encoding) headers["Content-Encoding"] = encoding;
    headers["Content-Length"] = String(body.length);
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  }

  return { serve };
}

module.exports = { createStaticAssets };
