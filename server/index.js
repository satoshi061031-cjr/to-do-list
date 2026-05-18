const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { addWatchlist, getDb, getSummary, listWatchlist, removeWatchlist, upsertSymbol } = require("./db");
const { refreshSymbol, startScheduler } = require("./jobs/scheduler");
const { searchSymbols } = require("./providers/market");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const manualRefreshes = new Map();

loadEnv();
getDb();

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendError(response, error);
  });
});

server.listen(PORT, () => {
  console.log(`Daily Space stock server running at http://localhost:${PORT}`);
  startScheduler();
});

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  serveStatic(response, url.pathname);
}

async function handleApi(request, response, url) {
  const method = request.method || "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, {
      ok: true,
      now: new Date().toISOString(),
      alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/stocks/search") {
    const q = url.searchParams.get("q") || "";
    sendJson(response, { results: await searchSymbols(q) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/watchlist") {
    sendJson(response, { watchlist: listWatchlist() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/watchlist") {
    const body = await readJson(request);
    const item = addWatchlist(body.symbol, body.name);
    upsertSymbol(item);
    const summary = await refreshSymbol(item.symbol, { deep: true });
    sendJson(response, { item, summary }, 201);
    return;
  }

  const watchlistDelete = url.pathname.match(/^\/api\/watchlist\/([^/]+)$/);
  if (method === "DELETE" && watchlistDelete) {
    const removed = removeWatchlist(decodeURIComponent(watchlistDelete[1]));
    sendJson(response, { removed });
    return;
  }

  const summaryMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/summary$/);
  if (method === "GET" && summaryMatch) {
    const symbol = decodeURIComponent(summaryMatch[1]).toUpperCase();
    let summary = getSummary(symbol);
    if (!summary.quote && !summary.signal) {
      summary = await refreshSymbol(symbol, { deep: true });
    }
    sendJson(response, { summary });
    return;
  }

  const refreshMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/refresh$/);
  if (method === "POST" && refreshMatch) {
    const symbol = decodeURIComponent(refreshMatch[1]).toUpperCase();
    enforceRefreshLimit(symbol);
    const summary = await refreshSymbol(symbol, { deep: true });
    sendJson(response, { summary });
    return;
  }

  const error = new Error("API route not found.");
  error.statusCode = 404;
  throw error;
}

function enforceRefreshLimit(symbol) {
  const now = Date.now();
  const last = manualRefreshes.get(symbol) || 0;
  if (now - last < 60_000) {
    const error = new Error("Manual refresh is limited to once per minute per symbol.");
    error.statusCode = 429;
    throw error;
  }
  manualRefreshes.set(symbol, now);
}

function serveStatic(response, pathname) {
  const cleanPath = decodeURIComponent(pathname.split("?")[0]);
  let relative = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  if (relative === "stocks") relative = "stocks.html";

  const filePath = path.resolve(ROOT_DIR, relative);
  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(response, "Forbidden", 403);
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, "Not found", 404);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendError(response, error) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(error);
  sendJson(response, { error: error.message || "Unexpected server error." }, status);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[ext] || "application/octet-stream"
  );
}

function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}
