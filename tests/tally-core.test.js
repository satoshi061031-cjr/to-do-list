const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeBalances,
  normalizeState,
  personalRecords,
  settlementSuggestions,
} = require("../tally-core.js");

test("migrates personal Tally records without adding them to shared balances", () => {
  const state = normalizeState({
    version: 1,
    budget: 1000,
    currency: "¥",
    records: [
      { id: "old", date: "2026-08-15", amount: 40, category: "Lunch", note: "" },
    ],
  });
  assert.equal(state.version, 2);
  assert.equal(state.baseCurrency, "JPY");
  assert.equal(state.people.length, 1);
  assert.equal(personalRecords(state.records).length, 1);
  assert.deepEqual(computeBalances(state), { "tally-self": 0 });
});

test("computes equal-split balances and a minimal settlement", () => {
  const state = normalizeState({
    version: 2,
    currency: "USD",
    baseCurrency: "USD",
    selfPersonId: "me",
    people: [
      { id: "me", name: "Me", isSelf: true },
      { id: "alex", name: "Alex" },
      { id: "sam", name: "Sam" },
    ],
    records: [
      {
        id: "dinner",
        date: "2026-08-15",
        amount: 90,
        currency: "USD",
        category: "Dinner",
        scope: "shared",
        paidById: "me",
        splitAmongIds: ["me", "alex", "sam"],
      },
    ],
  });
  assert.deepEqual(computeBalances(state), { me: 60, alex: -30, sam: -30 });
  assert.deepEqual(settlementSuggestions(state), [
    { fromId: "alex", toId: "me", amount: 30 },
    { fromId: "sam", toId: "me", amount: 30 },
  ]);
});

test("converts foreign-currency expenses before splitting", () => {
  const state = normalizeState({
    version: 2,
    currency: "USD",
    baseCurrency: "USD",
    selfPersonId: "me",
    people: [
      { id: "me", name: "Me", isSelf: true },
      { id: "alex", name: "Alex" },
    ],
    records: [
      {
        id: "train",
        date: "2026-08-15",
        amount: 1000,
        currency: "JPY",
        fxRate: 0.01,
        category: "Train",
        scope: "shared",
        paidById: "alex",
        splitAmongIds: ["me", "alex"],
      },
    ],
  });
  assert.deepEqual(computeBalances(state), { me: -5, alex: 5 });
});
