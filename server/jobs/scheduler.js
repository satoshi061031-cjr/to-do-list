const { fetchEvents } = require("../providers/events");
const { fetchQuote } = require("../providers/market");
const { fetchCompanyProfile, fetchFilings, fetchFundamentals } = require("../providers/sec");
const { generateSignal } = require("../signals/engine");
const {
  getDb,
  getSummary,
  listWatchlist,
  logFetchRun,
  replaceEvents,
  replaceFilings,
  upsertFundamentals,
  upsertQuote,
  upsertSignal,
  upsertSymbol,
} = require("../db");

const QUOTE_INTERVAL_MS = Number(process.env.QUOTE_REFRESH_MS || 5 * 60 * 1000);
const DEEP_INTERVAL_MS = Number(process.env.DEEP_REFRESH_MS || 6 * 60 * 60 * 1000);

let quoteTimer = null;
let deepTimer = null;
const runningSymbols = new Set();

async function refreshSymbol(symbol, options = {}) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return getSummary(normalized);
  if (runningSymbols.has(normalized)) return getSummary(normalized);
  runningSymbols.add(normalized);

  try {
    await refreshQuote(normalized);
    if (options.deep !== false) {
      await refreshProfileAndFilings(normalized);
      await refreshEvents(normalized);
    }
    const summary = getSummary(normalized);
    const signal = generateSignal(summary);
    upsertSignal(normalized, signal);
    return getSummary(normalized);
  } finally {
    runningSymbols.delete(normalized);
  }
}

async function refreshQuote(symbol) {
  const startedAt = new Date().toISOString();
  try {
    const quote = await fetchQuote(symbol);
    upsertQuote(symbol, quote);
    logFetchRun(symbol, "market", "ok", quote.warning || quote.source, startedAt);
  } catch (error) {
    logFetchRun(symbol, "market", "error", error.message, startedAt);
  }
}

async function refreshProfileAndFilings(symbol) {
  const startedAt = new Date().toISOString();
  try {
    const profile = await fetchCompanyProfile(symbol);
    upsertSymbol(profile);
    const [filings, fundamentals] = await Promise.all([
      fetchFilings(symbol, profile.cik),
      fetchFundamentals(symbol, profile.cik),
    ]);
    replaceFilings(symbol, filings);
    upsertFundamentals(symbol, fundamentals);
    logFetchRun(symbol, "sec", "ok", `${filings.length} filings refreshed`, startedAt);
  } catch (error) {
    logFetchRun(symbol, "sec", "error", error.message, startedAt);
  }
}

async function refreshEvents(symbol) {
  const startedAt = new Date().toISOString();
  try {
    const events = await fetchEvents(symbol);
    replaceEvents(symbol, events);
    const status = events.some((event) => event.status === "sourceUnavailable") ? "warn" : "ok";
    logFetchRun(symbol, "events", status, `${events.length} events refreshed`, startedAt);
  } catch (error) {
    logFetchRun(symbol, "events", "error", error.message, startedAt);
  }
}

async function refreshWatchlist(options = {}) {
  getDb();
  const symbols = listWatchlist().map((item) => item.symbol);
  for (const symbol of symbols) {
    await refreshSymbol(symbol, options);
  }
}

function startScheduler() {
  if (quoteTimer || process.env.DISABLE_STOCK_SCHEDULER === "1") return;
  quoteTimer = setInterval(() => {
    refreshWatchlist({ deep: false }).catch((error) => {
      console.error("[stocks] quote refresh failed", error);
    });
  }, QUOTE_INTERVAL_MS);
  quoteTimer.unref?.();

  deepTimer = setInterval(() => {
    refreshWatchlist({ deep: true }).catch((error) => {
      console.error("[stocks] deep refresh failed", error);
    });
  }, DEEP_INTERVAL_MS);
  deepTimer.unref?.();

  refreshWatchlist({ deep: true }).catch((error) => {
    console.error("[stocks] initial refresh failed", error);
  });
}

module.exports = {
  refreshSymbol,
  refreshWatchlist,
  startScheduler,
};
