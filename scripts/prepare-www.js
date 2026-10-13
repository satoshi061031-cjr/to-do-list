#!/usr/bin/env node
/**
 * Copy the static Daily Space client into www/ for Capacitor.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "www");

const files = require("../server/public-assets");

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

rmDir(outDir);
ensureDir(outDir);

let copied = 0;
let missing = 0;
for (const file of files) {
  const from = path.join(root, file);
  const to = path.join(outDir, file);
  if (!fs.existsSync(from)) {
    console.warn(`[cap:prepare] skip missing: ${file}`);
    missing += 1;
    continue;
  }
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  copied += 1;
}

// Capacitor expects an index at webDir root.
const indexSrc = path.join(outDir, "index.html");
if (!fs.existsSync(indexSrc) && fs.existsSync(path.join(outDir, "todo.html"))) {
  fs.copyFileSync(path.join(outDir, "todo.html"), indexSrc);
}

console.log(`[cap:prepare] copied ${copied} files → www/${missing ? ` (${missing} missing)` : ""}`);
