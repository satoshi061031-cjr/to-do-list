const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.STOCKS_DB_PATH || path.join(DATA_DIR, "stocks.sqlite");

let db;

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function getDb() {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      cik TEXT,
      exchange TEXT,
      currency TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      symbol TEXT PRIMARY KEY,
      price REAL,
      change REAL,
      change_percent REAL,
      volume INTEGER,
      previous_close REAL,
      open REAL,
      high REAL,
      low REAL,
      latest_trading_day TEXT,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS fundamentals (
      symbol TEXT PRIMARY KEY,
      revenue REAL,
      revenue_growth REAL,
      eps REAL,
      eps_growth REAL,
      fiscal_period TEXT,
      fiscal_year INTEGER,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS filings (
      accession_number TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      cik TEXT,
      form TEXT NOT NULL,
      filing_date TEXT,
      report_date TEXT,
      description TEXT,
      url TEXT,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      event_time TEXT,
      fiscal_date_ending TEXT,
      estimate REAL,
      currency TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      symbol TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      score REAL NOT NULL,
      confidence REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      source_timestamps_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fetch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      email TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      scope TEXT,
      expires_at TEXT,
      profile_json TEXT,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, email)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      email_hint TEXT,
      return_to TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function listWatchlist() {
  return getDb()
    .prepare(
      `SELECT w.symbol, COALESCE(w.name, s.name, w.symbol) AS name, w.added_at AS addedAt,
        q.price, q.change, q.change_percent AS changePercent, q.fetched_at AS quoteFetchedAt,
        sig.label AS signalLabel, sig.score AS signalScore, sig.confidence AS signalConfidence
       FROM watchlist w
       LEFT JOIN symbols s ON s.symbol = w.symbol
       LEFT JOIN quotes q ON q.symbol = w.symbol
       LEFT JOIN signals sig ON sig.symbol = w.symbol
       ORDER BY w.added_at ASC`
    )
    .all();
}

function addWatchlist(symbol, name) {
  const normalized = normalizeSymbol(symbol);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    const error = new Error("Use a valid US ticker symbol.");
    error.statusCode = 400;
    throw error;
  }

  const timestamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO watchlist (symbol, name, added_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
        name = COALESCE(excluded.name, watchlist.name),
        updated_at = excluded.updated_at`
    )
    .run(normalized, name || normalized, timestamp, timestamp);
  upsertSymbol({ symbol: normalized, name: name || normalized });
  return { symbol: normalized, name: name || normalized };
}

function removeWatchlist(symbol) {
  const normalized = normalizeSymbol(symbol);
  return getDb().prepare("DELETE FROM watchlist WHERE symbol = ?").run(normalized).changes > 0;
}

function upsertSymbol(info) {
  const symbol = normalizeSymbol(info.symbol);
  if (!symbol) return;
  getDb()
    .prepare(
      `INSERT INTO symbols (symbol, name, cik, exchange, currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
        name = COALESCE(excluded.name, symbols.name),
        cik = COALESCE(excluded.cik, symbols.cik),
        exchange = COALESCE(excluded.exchange, symbols.exchange),
        currency = COALESCE(excluded.currency, symbols.currency),
        updated_at = excluded.updated_at`
    )
    .run(symbol, info.name || null, info.cik || null, info.exchange || null, info.currency || null, nowIso());
}

function upsertQuote(symbol, quote) {
  getDb()
    .prepare(
      `INSERT INTO quotes (
        symbol, price, change, change_percent, volume, previous_close, open, high, low,
        latest_trading_day, source, fetched_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        price = excluded.price,
        change = excluded.change,
        change_percent = excluded.change_percent,
        volume = excluded.volume,
        previous_close = excluded.previous_close,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        latest_trading_day = excluded.latest_trading_day,
        source = excluded.source,
        fetched_at = excluded.fetched_at,
        raw_json = excluded.raw_json`
    )
    .run(
      normalizeSymbol(symbol),
      quote.price ?? null,
      quote.change ?? null,
      quote.changePercent ?? null,
      quote.volume ?? null,
      quote.previousClose ?? null,
      quote.open ?? null,
      quote.high ?? null,
      quote.low ?? null,
      quote.latestTradingDay || null,
      quote.source || "unknown",
      quote.fetchedAt || nowIso(),
      toJson(quote.raw || quote)
    );
}

function replaceFilings(symbol, filings) {
  const database = getDb();
  const normalized = normalizeSymbol(symbol);
  const insert = database.prepare(
    `INSERT INTO filings (
      accession_number, symbol, cik, form, filing_date, report_date, description, url, source, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(accession_number) DO UPDATE SET
      form = excluded.form,
      filing_date = excluded.filing_date,
      report_date = excluded.report_date,
      description = excluded.description,
      url = excluded.url,
      source = excluded.source,
      fetched_at = excluded.fetched_at`
  );
  database.prepare("DELETE FROM filings WHERE symbol = ?").run(normalized);
  for (const filing of filings) {
    insert.run(
      filing.accessionNumber,
      normalized,
      filing.cik || null,
      filing.form,
      filing.filingDate || null,
      filing.reportDate || null,
      filing.description || null,
      filing.url || null,
      filing.source || "SEC EDGAR",
      filing.fetchedAt || nowIso()
    );
  }
}

function replaceEvents(symbol, events) {
  const database = getDb();
  const normalized = normalizeSymbol(symbol);
  const insert = database.prepare(
    `INSERT INTO events (
      id, symbol, type, title, event_time, fiscal_date_ending, estimate, currency, source, status, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      event_time = excluded.event_time,
      fiscal_date_ending = excluded.fiscal_date_ending,
      estimate = excluded.estimate,
      currency = excluded.currency,
      source = excluded.source,
      status = excluded.status,
      fetched_at = excluded.fetched_at`
  );
  database.prepare("DELETE FROM events WHERE symbol = ?").run(normalized);
  for (const event of events) {
    insert.run(
      event.id,
      normalized,
      event.type,
      event.title,
      event.eventTime || null,
      event.fiscalDateEnding || null,
      event.estimate ?? null,
      event.currency || null,
      event.source || "unknown",
      event.status || "ok",
      event.fetchedAt || nowIso()
    );
  }
}

function upsertFundamentals(symbol, fundamentals) {
  if (!fundamentals) return;
  getDb()
    .prepare(
      `INSERT INTO fundamentals (
        symbol, revenue, revenue_growth, eps, eps_growth, fiscal_period, fiscal_year, source, fetched_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        revenue = excluded.revenue,
        revenue_growth = excluded.revenue_growth,
        eps = excluded.eps,
        eps_growth = excluded.eps_growth,
        fiscal_period = excluded.fiscal_period,
        fiscal_year = excluded.fiscal_year,
        source = excluded.source,
        fetched_at = excluded.fetched_at,
        raw_json = excluded.raw_json`
    )
    .run(
      normalizeSymbol(symbol),
      fundamentals.revenue ?? null,
      fundamentals.revenueGrowth ?? null,
      fundamentals.eps ?? null,
      fundamentals.epsGrowth ?? null,
      fundamentals.fiscalPeriod || null,
      fundamentals.fiscalYear ?? null,
      fundamentals.source || "SEC companyfacts",
      fundamentals.fetchedAt || nowIso(),
      toJson(fundamentals.raw || fundamentals)
    );
}

function upsertSignal(symbol, signal) {
  getDb()
    .prepare(
      `INSERT INTO signals (
        symbol, label, score, confidence, reasons_json, source_timestamps_json, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        label = excluded.label,
        score = excluded.score,
        confidence = excluded.confidence,
        reasons_json = excluded.reasons_json,
        source_timestamps_json = excluded.source_timestamps_json,
        generated_at = excluded.generated_at`
    )
    .run(
      normalizeSymbol(symbol),
      signal.label,
      signal.score,
      signal.confidence,
      toJson(signal.reasons || []),
      toJson(signal.sourceTimestamps || {}),
      signal.generatedAt || nowIso()
    );
}

function logFetchRun(symbol, provider, status, message, startedAt) {
  getDb()
    .prepare(
      `INSERT INTO fetch_runs (symbol, provider, status, message, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(normalizeSymbol(symbol) || null, provider, status, message || null, startedAt || nowIso(), nowIso());
}

function getSummary(symbol) {
  const normalized = normalizeSymbol(symbol);
  const database = getDb();
  const symbolInfo = database.prepare("SELECT * FROM symbols WHERE symbol = ?").get(normalized);
  const quote = database.prepare("SELECT * FROM quotes WHERE symbol = ?").get(normalized);
  const fundamentals = database.prepare("SELECT * FROM fundamentals WHERE symbol = ?").get(normalized);
  const filings = database
    .prepare("SELECT * FROM filings WHERE symbol = ? ORDER BY filing_date DESC LIMIT 8")
    .all(normalized);
  const events = database
    .prepare("SELECT * FROM events WHERE symbol = ? ORDER BY COALESCE(event_time, fetched_at) ASC LIMIT 8")
    .all(normalized);
  const signalRow = database.prepare("SELECT * FROM signals WHERE symbol = ?").get(normalized);
  const runs = database
    .prepare("SELECT * FROM fetch_runs WHERE symbol = ? ORDER BY id DESC LIMIT 6")
    .all(normalized);

  return {
    symbol: normalized,
    name: symbolInfo?.name || normalized,
    cik: symbolInfo?.cik || null,
    quote: quote
      ? {
          price: quote.price,
          change: quote.change,
          changePercent: quote.change_percent,
          volume: quote.volume,
          previousClose: quote.previous_close,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          latestTradingDay: quote.latest_trading_day,
          source: quote.source,
          fetchedAt: quote.fetched_at,
        }
      : null,
    fundamentals: fundamentals
      ? {
          revenue: fundamentals.revenue,
          revenueGrowth: fundamentals.revenue_growth,
          eps: fundamentals.eps,
          epsGrowth: fundamentals.eps_growth,
          fiscalPeriod: fundamentals.fiscal_period,
          fiscalYear: fundamentals.fiscal_year,
          source: fundamentals.source,
          fetchedAt: fundamentals.fetched_at,
        }
      : null,
    filings: filings.map((filing) => ({
      accessionNumber: filing.accession_number,
      form: filing.form,
      filingDate: filing.filing_date,
      reportDate: filing.report_date,
      description: filing.description,
      url: filing.url,
      source: filing.source,
      fetchedAt: filing.fetched_at,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      eventTime: event.event_time,
      fiscalDateEnding: event.fiscal_date_ending,
      estimate: event.estimate,
      currency: event.currency,
      source: event.source,
      status: event.status,
      fetchedAt: event.fetched_at,
    })),
    signal: signalRow
      ? {
          label: signalRow.label,
          score: signalRow.score,
          confidence: signalRow.confidence,
          reasons: fromJson(signalRow.reasons_json, []),
          sourceTimestamps: fromJson(signalRow.source_timestamps_json, {}),
          generatedAt: signalRow.generated_at,
        }
      : null,
    fetchRuns: runs.map((run) => ({
      provider: run.provider,
      status: run.status,
      message: run.message,
      startedAt: run.started_at,
      endedAt: run.ended_at,
    })),
  };
}

function listMailAccounts() {
  return getDb()
    .prepare(
      `SELECT id, provider, email, token_type AS tokenType, scope, expires_at AS expiresAt,
              connected_at AS connectedAt, updated_at AS updatedAt
       FROM mail_accounts
       ORDER BY updated_at DESC`
    )
    .all();
}

function getMailAccountById(id) {
  const row = getDb()
    .prepare("SELECT * FROM mail_accounts WHERE id = ?")
    .get(String(id || ""));
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenType: row.token_type,
    scope: row.scope,
    expiresAt: row.expires_at,
    profile: fromJson(row.profile_json, {}),
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function upsertMailAccount(input) {
  const provider = String(input.provider || "").trim().toLowerCase();
  const email = String(input.email || "").trim().toLowerCase();
  if (!provider || !email) {
    const error = new Error("Provider and email are required.");
    error.statusCode = 400;
    throw error;
  }

  const now = nowIso();
  const existing = getDb()
    .prepare("SELECT id, connected_at AS connectedAt FROM mail_accounts WHERE provider = ? AND email = ?")
    .get(provider, email);
  const id = existing?.id || `${provider}:${email}`;
  const connectedAt = existing?.connectedAt || now;
  getDb()
    .prepare(
      `INSERT INTO mail_accounts (
        id, provider, email, access_token, refresh_token, token_type, scope, expires_at, profile_json, connected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, email) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, mail_accounts.refresh_token),
        token_type = excluded.token_type,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      provider,
      email,
      input.accessToken || null,
      input.refreshToken || null,
      input.tokenType || null,
      input.scope || null,
      input.expiresAt || null,
      toJson(input.profile || {}),
      connectedAt,
      now
    );
  return getDb().prepare("SELECT * FROM mail_accounts WHERE id = ?").get(id);
}

function removeMailAccount(id) {
  return getDb().prepare("DELETE FROM mail_accounts WHERE id = ?").run(String(id || "")).changes > 0;
}

function createOauthState(input) {
  const state = String(input.state || "").trim();
  if (!state) return;
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO oauth_states (state, provider, email_hint, return_to, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      state,
      String(input.provider || "").trim().toLowerCase(),
      input.emailHint || null,
      input.returnTo || null,
      nowIso()
    );
}

function consumeOauthState(state, maxAgeMinutes = 20) {
  const normalized = String(state || "").trim();
  if (!normalized) return null;
  const row = getDb().prepare("SELECT * FROM oauth_states WHERE state = ?").get(normalized);
  getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(normalized);
  if (!row) return null;
  const ageMs = Date.now() - Date.parse(row.created_at);
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMinutes * 60_000) return null;
  return {
    state: row.state,
    provider: row.provider,
    emailHint: row.email_hint || null,
    returnTo: row.return_to || null,
    createdAt: row.created_at,
  };
}

module.exports = {
  addWatchlist,
  consumeOauthState,
  createOauthState,
  getDb,
  getMailAccountById,
  getSummary,
  listWatchlist,
  listMailAccounts,
  logFetchRun,
  normalizeSymbol,
  removeMailAccount,
  removeWatchlist,
  replaceEvents,
  replaceFilings,
  upsertMailAccount,
  upsertFundamentals,
  upsertQuote,
  upsertSignal,
  upsertSymbol,
};
