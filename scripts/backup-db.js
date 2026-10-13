#!/usr/bin/env node
// VACUUM INTO makes a consistent copy, including committed WAL data, without stopping the server.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const source = path.resolve(process.env.DAILY_SPACE_DB_PATH || process.env.STOCKS_DB_PATH ||
  path.join(__dirname, "../server/data/daily-space.sqlite"));
const destination = process.argv[2] && path.resolve(process.argv[2]);
let database;
let copy;
let reserved = false;
try {
  if (!destination) throw new Error("Usage: npm run db:backup -- /absolute/path/backup.sqlite");
  if (!fs.existsSync(source)) throw new Error("Source database does not exist.");
  // Exclusive creation prevents clobbering an existing backup or source database.
  fs.closeSync(fs.openSync(destination, "wx", 0o600));
  reserved = true;
  database = new DatabaseSync(source, { readOnly: true });
  database.exec("PRAGMA busy_timeout = 5000");
  database.prepare("VACUUM INTO ?").run(destination);
  copy = new DatabaseSync(destination, { readOnly: true });
  const result = copy.prepare("PRAGMA integrity_check").all();
  if (result.length !== 1 || result[0].integrity_check !== "ok") {
    throw new Error("Backup integrity check failed.");
  }
  console.log(`Verified SQLite backup: ${destination}`);
} catch (error) {
  console.error(error.message);
  if (reserved) {
    copy?.close(); copy = null;
    fs.rmSync(destination, { force: true });
  }
  process.exitCode = 1;
} finally {
  copy?.close();
  database?.close();
}
