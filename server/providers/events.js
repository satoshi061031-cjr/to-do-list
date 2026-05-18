const { env, fetchText } = require("./http");

const ALPHA_BASE = "https://www.alphavantage.co/query";

async function fetchEvents(symbol) {
  if (env("ALPHA_VANTAGE_API_KEY")) {
    try {
      const params = new URLSearchParams({
        function: "EARNINGS_CALENDAR",
        symbol,
        horizon: "3month",
        apikey: env("ALPHA_VANTAGE_API_KEY"),
      });
      const csv = await fetchText(`${ALPHA_BASE}?${params.toString()}`);
      const rows = parseCsv(csv);
      const events = rows
        .filter((row) => String(row.symbol || "").toUpperCase() === String(symbol).toUpperCase())
        .slice(0, 6)
        .map((row) => ({
          id: `${symbol}:earnings:${row.reportDate || row.fiscalDateEnding}`,
          type: "earnings",
          title: "Expected earnings report",
          eventTime: row.reportDate || null,
          fiscalDateEnding: row.fiscalDateEnding || null,
          estimate: number(row.estimate),
          currency: row.currency || "USD",
          source: "Alpha Vantage EARNINGS_CALENDAR",
          status: "ok",
          fetchedAt: new Date().toISOString(),
        }));
      if (events.length) return events;
    } catch (error) {
      return unavailableEvent(symbol, `Earnings calendar unavailable: ${error.message}`);
    }
  }

  return unavailableEvent(
    symbol,
    "Earnings calendar needs ALPHA_VANTAGE_API_KEY or another configured events provider."
  );
}

function unavailableEvent(symbol, message) {
  return [
    {
      id: `${String(symbol).toUpperCase()}:events:unavailable`,
      type: "provider-status",
      title: message,
      eventTime: null,
      fiscalDateEnding: null,
      estimate: null,
      currency: null,
      source: "events provider",
      status: "sourceUnavailable",
      fetchedAt: new Date().toISOString(),
    },
  ];
}

function parseCsv(csv) {
  const lines = String(csv || "").trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0].includes(",")) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (const char of String(line)) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  fetchEvents,
};
