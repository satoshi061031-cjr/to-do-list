const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeBalances,
  changeBaseCurrency,
  baseAmount,
  readState,
  writeState,
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

test("read and save preserve more than 1000 expenses and all settlements", () => {
  const records = Array.from({ length: 1001 }, (_, index) => ({
    id: `expense-${index}`, date: "2026-11-11", amount: index + 1, currency: "CNY", category: "History",
  }));
  const settlements = Array.from({ length: 201 }, (_, index) => ({
    id: `settlement-${index}`, fromId: "me", toId: "friend", amountBase: index + 1,
  }));
  let stored = JSON.stringify({ baseCurrency: "CNY", records, settlements });
  const storage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  const loaded = readState(storage);
  assert.equal(loaded.records.length, 1001);
  assert.deepEqual(loaded.settlements, settlements);
  loaded.records.unshift({ id: "new", date: "2026-11-12", amount: 10, currency: "CNY", category: "New" });
  writeState(loaded, storage);
  const saved = readState(storage);
  assert.equal(saved.records.length, 1002);
  assert.equal(saved.records[0].id, "new");
  assert.equal(saved.records.at(-1).id, "expense-1000");
  assert.deepEqual(saved.settlements, settlements);
});

test("base currency changes cannot alter historical amounts or saved foreign rates", () => {
  const state = normalizeState({ baseCurrency: "CNY", records: [
    { id: "cny", date: "2026-11-11", amount: 70, currency: "CNY", fxRate: 1 },
    { id: "usd", date: "2026-11-11", amount: 10, currency: "USD", fxRate: 7 },
  ] });
  const before = JSON.stringify(state);
  const attempt = changeBaseCurrency(state, "USD");
  assert.equal(attempt.blocked, true);
  assert.equal(attempt.changed, false);
  assert.equal(attempt.reason, "history");
  assert.equal(attempt.state, state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(attempt.state.records.reduce((sum, record) => sum + baseAmount(record), 0), 140);
  assert.equal(attempt.state.records[1].fxRate, 7);
  const sameCurrency = changeBaseCurrency(attempt.state, "CNY");
  assert.equal(sameCurrency.blocked, false);
  assert.equal(sameCurrency.changed, false);
  assert.equal(JSON.stringify(sameCurrency.state), before);
});

test("empty ledgers can select a base currency while settlement and trip budget history stay protected", () => {
  const empty = normalizeState({ baseCurrency: "CNY" });
  const choice = changeBaseCurrency(empty, "myr");
  assert.equal(choice.changed, true);
  assert.equal(choice.blocked, false);
  assert.equal(choice.state.baseCurrency, "MYR");
  assert.equal(choice.state.currency, "MYR");
  assert.equal(empty.baseCurrency, "CNY");
  const withSettlement = { ...empty, settlements: [{ fromId: "me", toId: "friend", amountBase: 8 }] };
  const withBudget = { ...empty, tripBudgets: { trip: { amount: 500, currency: "CNY" } } };
  for (const state of [withSettlement, withBudget]) {
    const result = changeBaseCurrency(state, "USD");
    assert.equal(result.blocked, true);
    assert.equal(result.state, state);
  }
});
