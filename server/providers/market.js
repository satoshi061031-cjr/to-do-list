const { env, fetchJson } = require("./http");

const ALPHA_BASE = "https://www.alphavantage.co/query";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const KNOWN_SYMBOLS = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  META: "Meta Platforms, Inc.",
  TSLA: "Tesla, Inc.",
  BRK_B: "Berkshire Hathaway Inc.",
  JPM: "JPMorgan Chase & Co.",
  V: "Visa Inc.",
};

function alphaKey() {
  return env("ALPHA_VANTAGE_API_KEY");
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace("-", ".");
}

async function searchSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  if (alphaKey()) {
    try {
      const params = new URLSearchParams({
        function: "SYMBOL_SEARCH",
        keywords: q,
        apikey: alphaKey(),
      });
      const payload = await fetchJson(`${ALPHA_BASE}?${params.toString()}`);
      const matches = Array.isArray(payload.bestMatches) ? payload.bestMatches : [];
      return matches
        .filter((match) => (match["4. region"] || "").toLowerCase() === "united states")
        .slice(0, 8)
        .map((match) => ({
          symbol: match["1. symbol"],
          name: match["2. name"],
          exchange: match["4. region"],
          currency: match["8. currency"],
          source: "Alpha Vantage",
        }));
    } catch (_) {
      /* Fall through to local validation. */
    }
  }

  const upper = normalizeSymbol(q);
  const results = Object.entries(KNOWN_SYMBOLS)
    .filter(([symbol, name]) => symbol.includes(upper) || name.toUpperCase().includes(upper))
    .map(([symbol, name]) => ({ symbol: symbol.replace("_", "."), name, source: "Local seed" }));

  if (/^[A-Z][A-Z0-9.]{0,9}$/.test(upper) && !results.some((item) => item.symbol === upper)) {
    results.unshift({ symbol: upper, name: upper, source: "Ticker validation" });
  }
  return results.slice(0, 8);
}

async function fetchQuote(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) throw new Error("Missing symbol.");

  if (alphaKey()) {
    try {
      return await fetchAlphaQuote(normalized);
    } catch (error) {
      const yahooQuote = await fetchYahooQuote(normalized);
      yahooQuote.warning = `Alpha Vantage failed: ${error.message}`;
      return yahooQuote;
    }
  }

  return fetchYahooQuote(normalized);
}

async function fetchAlphaQuote(symbol) {
  const params = new URLSearchParams({
    function: "GLOBAL_QUOTE",
    symbol,
    apikey: alphaKey(),
  });
  const payload = await fetchJson(`${ALPHA_BASE}?${params.toString()}`);
  const row = payload["Global Quote"];
  if (!row || !row["05. price"]) {
    throw new Error(payload.Note || payload.Information || "No quote returned.");
  }

  return {
    symbol,
    price: number(row["05. price"]),
    change: number(row["09. change"]),
    changePercent: percent(row["10. change percent"]),
    volume: integer(row["06. volume"]),
    previousClose: number(row["08. previous close"]),
    open: number(row["02. open"]),
    high: number(row["03. high"]),
    low: number(row["04. low"]),
    latestTradingDay: row["07. latest trading day"],
    source: "Alpha Vantage GLOBAL_QUOTE",
    fetchedAt: new Date().toISOString(),
    raw: payload,
  };
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = symbol.replace(".", "-");
  const payload = await fetchJson(`${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`);
  const result = payload.chart?.result?.[0];
  if (!result) {
    throw new Error(payload.chart?.error?.description || "No quote returned.");
  }

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];
  const lastIndex = Math.max(0, closes.length - 1);
  const price = number(meta.regularMarketPrice ?? closes[lastIndex]);
  const previousClose = number(meta.chartPreviousClose ?? meta.previousClose);
  const change = price != null && previousClose != null ? price - previousClose : null;
  const changePercent = change != null && previousClose ? (change / previousClose) * 100 : null;
  const latestTimestamp = timestamps[lastIndex] ? new Date(timestamps[lastIndex] * 1000).toISOString() : null;

  return {
    symbol,
    price,
    change,
    changePercent,
    volume: integer(meta.regularMarketVolume ?? quote.volume?.[lastIndex]),
    previousClose,
    open: number(quote.open?.[lastIndex]),
    high: number(quote.high?.[lastIndex]),
    low: number(quote.low?.[lastIndex]),
    latestTradingDay: latestTimestamp,
    source: "Yahoo Finance chart",
    fetchedAt: new Date().toISOString(),
    raw: payload,
  };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  if (typeof value === "string") return number(value.replace("%", ""));
  return number(value);
}

module.exports = {
  fetchQuote,
  searchSymbols,
};
