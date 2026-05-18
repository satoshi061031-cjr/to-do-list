const { fetchJson } = require("./http");

const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || "DailySpaceStockSignals/1.0 contact@example.com",
};

let tickerCache = null;
let tickerCacheAt = 0;

async function fetchCompanyProfile(symbol) {
  const ticker = normalizeTicker(symbol);
  const tickers = await fetchTickerMap();
  const match = tickers.find((item) => item.ticker === ticker || item.ticker.replace("-", ".") === ticker);
  if (!match) {
    return { symbol: ticker, name: ticker, cik: null, source: "SEC company_tickers" };
  }
  return {
    symbol: ticker.replace("-", "."),
    name: match.title,
    cik: padCik(match.cik_str),
    source: "SEC company_tickers",
  };
}

async function fetchFilings(symbol, cik) {
  const profile = cik ? { cik: padCik(cik), symbol: normalizeTicker(symbol) } : await fetchCompanyProfile(symbol);
  if (!profile.cik) return [];

  const payload = await fetchJson(`https://data.sec.gov/submissions/CIK${profile.cik}.json`, {
    headers: SEC_HEADERS,
  });
  const recent = payload.filings?.recent || {};
  const forms = recent.form || [];
  const accessionNumbers = recent.accessionNumber || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const descriptions = recent.primaryDocDescription || [];
  const primaryDocs = recent.primaryDocument || [];
  const accepted = new Set(["10-K", "10-Q", "8-K"]);
  const filings = [];

  for (let index = 0; index < forms.length && filings.length < 10; index += 1) {
    const form = forms[index];
    if (!accepted.has(form)) continue;
    const accessionNumber = accessionNumbers[index];
    const accessionPath = String(accessionNumber || "").replace(/-/g, "");
    const primaryDoc = primaryDocs[index] || "";
    filings.push({
      accessionNumber,
      cik: profile.cik,
      form,
      filingDate: filingDates[index] || null,
      reportDate: reportDates[index] || null,
      description: descriptions[index] || `${form} filing`,
      url: accessionPath && primaryDoc
        ? `https://www.sec.gov/Archives/edgar/data/${Number(profile.cik)}/${accessionPath}/${primaryDoc}`
        : null,
      source: "SEC EDGAR submissions",
      fetchedAt: new Date().toISOString(),
    });
  }

  return filings;
}

async function fetchFundamentals(symbol, cik) {
  const profile = cik ? { cik: padCik(cik), symbol: normalizeTicker(symbol) } : await fetchCompanyProfile(symbol);
  if (!profile.cik) return null;

  const payload = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${profile.cik}.json`, {
    headers: SEC_HEADERS,
  });
  const facts = payload.facts?.["us-gaap"] || {};
  const revenueSeries =
    facts.Revenues?.units?.USD ||
    facts.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.USD ||
    [];
  const epsSeries = facts.EarningsPerShareDiluted?.units?.["USD/shares"] || [];

  const revenue = latestAnnual(revenueSeries);
  const previousRevenue = previousAnnual(revenueSeries, revenue);
  const eps = latestAnnual(epsSeries);
  const previousEps = previousAnnual(epsSeries, eps);

  if (!revenue && !eps) return null;

  return {
    revenue: revenue?.val ?? null,
    revenueGrowth: growth(revenue?.val, previousRevenue?.val),
    eps: eps?.val ?? null,
    epsGrowth: growth(eps?.val, previousEps?.val),
    fiscalPeriod: revenue?.fp || eps?.fp || null,
    fiscalYear: revenue?.fy || eps?.fy || null,
    source: "SEC companyfacts",
    fetchedAt: new Date().toISOString(),
    raw: {
      revenue,
      previousRevenue,
      eps,
      previousEps,
    },
  };
}

async function fetchTickerMap() {
  const oneDay = 24 * 60 * 60 * 1000;
  if (tickerCache && Date.now() - tickerCacheAt < oneDay) return tickerCache;

  const payload = await fetchJson("https://www.sec.gov/files/company_tickers.json", {
    headers: SEC_HEADERS,
  });
  tickerCache = Object.values(payload).map((item) => ({
    cik_str: item.cik_str,
    ticker: normalizeTicker(item.ticker),
    title: item.title,
  }));
  tickerCacheAt = Date.now();
  return tickerCache;
}

function latestAnnual(series) {
  return normalizedAnnual(series)[0] || null;
}

function previousAnnual(series, latest) {
  return normalizedAnnual(series).find((item) => !latest || item.end !== latest.end || item.fy !== latest.fy) || null;
}

function normalizedAnnual(series) {
  return (Array.isArray(series) ? series : [])
    .filter((item) => item && item.form === "10-K" && item.val != null && item.fy)
    .sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")));
}

function growth(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function normalizeTicker(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(".", "-");
}

function padCik(cik) {
  return String(cik || "").replace(/\D/g, "").padStart(10, "0");
}

module.exports = {
  fetchCompanyProfile,
  fetchFilings,
  fetchFundamentals,
};
