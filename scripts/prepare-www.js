#!/usr/bin/env node
/**
 * Copy the static Daily Space client into www/ for Capacitor.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "www");

const files = [
  "index.html",
  "todo.html",
  "todo-m.html",
  "planner.html",
  "calendar.html",
  "tally.html",
  "travel.html",
  "teamwork.html",
  "mail.html",
  "manifest.json",
  "sw.js",
  "styles.css",
  "todo-mobile.css",
  "m-dock.css",
  "planner.css",
  "calendar.css",
  "tally.css",
  "travel.css",
  "teamwork.css",
  "mail.css",
  "theme.js",
  "device-route.js",
  "todo-mobile.js",
  "i18n.js",
  "app.js",
  "planner.js",
  "calendar.js",
  "tally.js",
  "travel.js",
  "teamwork.js",
  "mail.js",
  "agent-data.js",
  "agent-ui.js",
  "daily-loop.js",
  "bento-rail.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
  "light-background.png",
  "dark-background.png",
  "welcome-sticker.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
];

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
