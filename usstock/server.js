const http = require("http");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { URL } = require("url");

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (_err) {
    // Ignore missing or unreadable env files.
  }
}

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, ".env.local"));

const BASE_PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const POLYGON_API_KEY_RAW = String(process.env.POLYGON_API_KEY || "").trim();
const POLYGON_API_KEY =
  !POLYGON_API_KEY_RAW || POLYGON_API_KEY_RAW === "your_polygon_api_key_here"
    ? ""
    : POLYGON_API_KEY_RAW;

const USER_AGENT =
  process.env.SEC_USER_AGENT ||
  "usstock-signal-tracker/1.0 (contact: example@example.com)";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA"];

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { value, time: Date.now() });
}

function sanitizeSymbols(input) {
  if (!Array.isArray(input)) return DEFAULT_SYMBOLS;
  const symbols = input
    .map((s) => String(s || "").trim().toUpperCase())
    .filter((s) => /^[A-Z.]{1,6}$/.test(s));
  return symbols.length ? symbols.slice(0, 10) : DEFAULT_SYMBOLS;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }
  return response.json();
}

function isoDateOffset(daysBack) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function fetchPolygon(pathname, query = {}) {
  if (!POLYGON_API_KEY) {
    throw new Error("POLYGON_API_KEY is not set");
  }
  const url = new URL(`https://api.polygon.io${pathname}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("apiKey", POLYGON_API_KEY);
  return fetchJson(url.toString(), { headers: { Accept: "application/json" } });
}

function scoreFromNews(newsItems) {
  const positiveWords = [
    "beat",
    "surge",
    "growth",
    "bullish",
    "record",
    "strong",
    "upgrade",
    "partnership",
    "expands",
    "profit",
  ];
  const negativeWords = [
    "miss",
    "drop",
    "lawsuit",
    "downgrade",
    "weak",
    "cut",
    "decline",
    "loss",
    "investigation",
    "risk",
  ];

  let score = 0;
  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
    for (const w of positiveWords) {
      if (text.includes(w)) score += 1;
    }
    for (const w of negativeWords) {
      if (text.includes(w)) score -= 1;
    }
  }
  return score;
}

function scoreFromSecFilings(filings) {
  let score = 0;
  for (const filing of filings) {
    const form = (filing.form || "").toUpperCase();
    if (form === "8-K") score += 0.5;
    if (form === "10-Q" || form === "10-K") score += 1;
    if (form === "S-3" || form === "424B5") score -= 0.5;
  }
  return score;
}

function scoreFromVolume(volume, avgVolume) {
  if (!volume || !avgVolume) return 0;
  const ratio = volume / avgVolume;
  if (ratio > 1.5) return 1;
  if (ratio < 0.7) return -1;
  return 0;
}

function signalLabel(total) {
  if (total >= 3) return "Strong Bullish";
  if (total >= 1) return "Bullish";
  if (total <= -3) return "Strong Bearish";
  if (total <= -1) return "Bearish";
  return "Neutral";
}

async function getCompanyCikMap() {
  const key = "sec-company-tickers";
  const hit = getCached(key);
  if (hit) return hit;

  const data = await fetchJson("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  const map = {};
  for (const row of Object.values(data)) {
    map[row.ticker?.toUpperCase()] = String(row.cik_str).padStart(10, "0");
  }
  setCached(key, map);
  return map;
}

async function getSecFilingsForSymbol(symbol, cikMap) {
  const cik = cikMap[symbol];
  if (!cik) return [];

  const key = `sec-submissions-${symbol}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const data = await fetchJson(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    const recent = data?.filings?.recent || {};
    const forms = recent.form || [];
    const dates = recent.filingDate || [];
    const accessionNumbers = recent.accessionNumber || [];

    const filings = forms.slice(0, 6).map((form, i) => ({
      form,
      filingDate: dates[i],
      accessionNumber: accessionNumbers[i],
      secUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(
        accessionNumbers[i] || ""
      ).replace(/-/g, "")}`,
    }));
    setCached(key, filings);
    return filings;
  } catch (err) {
    return [];
  }
}

async function getPolygonQuoteAndNews(symbol) {
  const key = `polygon-${symbol}`;
  const cached = getCached(key);
  if (cached) return cached;

  const from = isoDateOffset(120);
  const to = isoDateOffset(0);
  const [tickerRes, newsRes, aggsRes] = await Promise.allSettled([
    fetchPolygon(`/v3/reference/tickers/${encodeURIComponent(symbol)}`),
    fetchPolygon("/v2/reference/news", {
      ticker: symbol,
      limit: 6,
      order: "desc",
      sort: "published_utc",
    }),
    fetchPolygon(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      limit: 120,
    }),
  ]);

  const tickerData = tickerRes.status === "fulfilled" ? tickerRes.value : {};
  const newsData = newsRes.status === "fulfilled" ? newsRes.value : {};
  const aggsData = aggsRes.status === "fulfilled" ? aggsRes.value : {};

  const news = (newsData.results || []).slice(0, 6).map((n) => ({
    title: n.title || "",
    publisher: n.publisher?.name || "Polygon",
    link: n.article_url || "",
    publishedAt: n.published_utc || null,
    description: n.description || "",
  }));

  const bars = aggsData.results || [];
  const latest = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const latestPrice = latest?.c ?? null;
  const prevClose = prev?.c ?? null;
  const changePercent =
    latestPrice !== null && prevClose
      ? ((latestPrice - prevClose) / prevClose) * 100
      : null;

  const volumeBars = bars.slice(-60);
  const avgVolume =
    volumeBars.length > 0
      ? Math.round(
          volumeBars.reduce((sum, b) => sum + (Number(b?.v) || 0), 0) / volumeBars.length
        )
      : null;

  const subStatus = {
    ticker:
      tickerRes.status === "fulfilled"
        ? { ok: true, message: "ok" }
        : { ok: false, message: tickerRes.reason?.message || "fetch failed" },
    news:
      newsRes.status === "fulfilled"
        ? { ok: true, message: "ok" }
        : { ok: false, message: newsRes.reason?.message || "fetch failed" },
    aggs:
      aggsRes.status === "fulfilled"
        ? { ok: true, message: "ok" }
        : { ok: false, message: aggsRes.reason?.message || "fetch failed" },
  };

  const result = {
    price: latestPrice,
    changePercent,
    volume: latest?.v ?? null,
    avgVolume,
    exchange: tickerData?.results?.primary_exchange || null,
    shortName: tickerData?.results?.name || symbol,
    news,
    polygonSubStatus: subStatus,
  };
  setCached(key, result);
  return result;
}

function mergeNews(primary, fallback) {
  const seen = new Set();
  const merged = [];
  for (const item of [...primary, ...fallback]) {
    if (!item?.title) continue;
    const key = `${item.title}::${item.link || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= 8) break;
  }
  return merged;
}

async function buildSignalForSymbol(symbol, cikMap) {
  const [marketRes, secRes] = await Promise.allSettled([
    getPolygonQuoteAndNews(symbol),
    getSecFilingsForSymbol(symbol, cikMap),
  ]);

  const market =
    marketRes.status === "fulfilled"
      ? marketRes.value
      : {
          price: null,
          changePercent: null,
          volume: null,
          avgVolume: null,
          exchange: null,
          shortName: symbol,
          news: [],
        };
  const secFilings = secRes.status === "fulfilled" ? secRes.value : [];
  const sourceStatus = {
    polygon:
      marketRes.status === "fulfilled"
        ? {
            ok: Boolean(
              marketRes.value.price !== null ||
                marketRes.value.news.length ||
                marketRes.value.exchange
            ),
            message:
              marketRes.value.polygonSubStatus &&
              Object.values(marketRes.value.polygonSubStatus).some((s) => !s.ok)
                ? JSON.stringify(marketRes.value.polygonSubStatus)
                : "ok",
          }
        : { ok: false, message: marketRes.reason?.message || "fetch failed" },
    sec:
      secRes.status === "fulfilled"
        ? { ok: true, message: "ok" }
        : { ok: false, message: secRes.reason?.message || "fetch failed" },
  };

  const news = market.news || [];

  const newsScore = scoreFromNews(news);
  const secScore = scoreFromSecFilings(secFilings);
  const volumeScore = scoreFromVolume(market.volume, market.avgVolume);
  const totalScore = newsScore + secScore + volumeScore;

  return {
    symbol,
    company: market.shortName || symbol,
    market: {
      price: market.price,
      changePercent: market.changePercent,
      volume: market.volume,
      avgVolume3m: market.avgVolume,
      exchange: market.exchange,
    },
    secFilings,
    news,
    signal: {
      label: signalLabel(totalScore),
      totalScore,
      parts: {
        newsScore,
        secScore,
        volumeScore,
      },
      note: "Rule-based signal. For education only, not investment advice.",
    },
    sourceStatus,
  };
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function serveStatic(req, res, pathname) {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      json(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  } catch (_err) {
    json(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        app: "usstock-signal-tracker",
        polygonConfigured: Boolean(POLYGON_API_KEY),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/signal") {
      const raw = await readRequestBody(req);
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (_err) {
          json(res, 400, { error: "Invalid JSON body" });
          return;
        }
      }
      try {
        const symbols = sanitizeSymbols(body?.symbols || DEFAULT_SYMBOLS);
        let cikMap = {};
        try {
          cikMap = await getCompanyCikMap();
        } catch (_err) {
          cikMap = {};
        }
        const results = await Promise.all(
          symbols.map(async (s) => {
            try {
              return await buildSignalForSymbol(s, cikMap);
            } catch (err) {
              return {
                symbol: s,
                company: s,
                market: {
                  price: null,
                  changePercent: null,
                  volume: null,
                  avgVolume3m: null,
                  exchange: null,
                },
                secFilings: [],
                news: [],
                signal: {
                  label: "Neutral",
                  totalScore: 0,
                  parts: { newsScore: 0, secScore: 0, volumeScore: 0 },
                  note: `Data fetch partially failed: ${err.message}`,
                },
              };
            }
          })
        );
        json(res, 200, { symbols, generatedAt: new Date().toISOString(), results });
      } catch (err) {
        json(res, 500, {
          error: "Failed to fetch stock data",
          detail: err.message,
          hint:
            "For SEC API, set SEC_USER_AGENT env var with your contact info to reduce blocked requests.",
        });
      }
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, pathname);
      return;
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    json(res, 500, { error: "Server error", detail: err.message });
  }
});

let currentPort = BASE_PORT;

function startServer(port) {
  currentPort = port;
  server.listen(port, () => {
    console.log(`US stock tracker running: http://localhost:${port}`);
  });
}

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    const nextPort = currentPort + 1;
    console.warn(`Port ${currentPort} in use, retrying with ${nextPort}...`);
    setTimeout(() => startServer(nextPort), 100);
    return;
  }
  console.error("Failed to start server:", err);
  process.exit(1);
});

startServer(BASE_PORT);
