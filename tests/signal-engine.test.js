const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSignal } = require("../server/signals/engine");

test("positive momentum and growth produce a bullish signal", () => {
  const signal = generateSignal({
    quote: {
      changePercent: 4.2,
      fetchedAt: new Date().toISOString(),
    },
    fundamentals: {
      revenueGrowth: 18,
      epsGrowth: 12,
      fetchedAt: new Date().toISOString(),
    },
    filings: [
      {
        form: "10-K",
        filingDate: "2026-02-01",
        fetchedAt: new Date().toISOString(),
      },
    ],
    events: [],
  });

  assert.equal(signal.label, "bullish");
  assert.ok(signal.score > 18);
  assert.ok(signal.reasons.some((reason) => reason.includes("Price momentum")));
});

test("missing or unavailable data stays in watch/neutral territory", () => {
  const signal = generateSignal({
    quote: null,
    fundamentals: null,
    filings: [],
    events: [
      {
        status: "sourceUnavailable",
      },
    ],
  });

  assert.equal(signal.label, "watch");
  assert.ok(signal.confidence < 0.35);
});
