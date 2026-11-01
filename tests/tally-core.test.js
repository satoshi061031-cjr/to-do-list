const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeBalances,
  normalizeState,
  monthSpending,
  personalRecords,
  sharedRecords,
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

test("monthly spending sums saved exchange rates within the chosen ledger and valid calendar days", () => {
  const state = normalizeState({ baseCurrency: "CNY", records: [
    { date: "2024-02-01", amount: 100, currency: "CNY", scope: "personal" },
    { date: "2024-02-29", amount: 10, currency: "USD", fxRate: 7.2, scope: "personal" },
    { date: "2024-02-29", amount: 20, currency: "CNY", scope: "personal" },
    { date: "2024-02-29", amount: 90, currency: "CNY", scope: "shared" },
    { date: "2024-03-01", amount: 2000, currency: "CNY" },
    { date: "2024-02-30", amount: 3000, currency: "CNY" },
  ] });
  const personal = monthSpending(personalRecords(state.records), 2024, 2);
  assert.equal(personal.days.length, 29);
  assert.equal(personal.firstWeekday, 4);
  assert.equal(personal.total, 192);
  assert.equal(personal.average, 192 / 29);
  assert.deepEqual(personal.days[28], { date: "2024-02-29", amount: 92, count: 2 });
  assert.deepEqual(personal.days[1], { date: "2024-02-02", amount: 0, count: 0 });
  assert.equal(monthSpending(sharedRecords(state.records), 2024, 2).total, 90);
});

test("monthly spending uses real month lengths, zero-spend days and year boundaries", () => {
  assert.equal(monthSpending([], 2025, 2).days.length, 28);
  assert.equal(monthSpending([], 2024, 4).days.length, 30);
  const december = monthSpending([], 2026, 12);
  assert.equal(december.days.length, 31);
  assert.equal(december.total, 0);
  assert.equal(december.average, 0);
  assert.equal(december.days.at(-1).date, "2026-12-31");
  assert.equal(monthSpending([], 2027, 1).days[0].date, "2027-01-01");
});
