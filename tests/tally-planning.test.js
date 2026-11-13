const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../tally-core.js');

const ledger = extra => Core.normalizeState({ baseCurrency: 'CNY', ...extra });
const bill = extra => ({ id: 'rent', name: 'Rent', amount: 1200, currency: 'CNY', nextDate: '2026-01-31', interval: 'monthly', category: 'Housing', ...extra });

test('category budget totals personal spending by month using saved currency conversion', () => {
  const state = ledger({ categoryBudgets: [
    { id: 'food', month: '2026-02', category: 'Food', amount: 100, currency: 'CNY' },
    { id: 'foreign', month: '2026-02', category: 'Travel', amount: 200, currency: 'USD' },
    { id: 'next', month: '2026-03', category: 'Food', amount: 500, currency: 'CNY' },
  ], records: [
    { id: 'local', date: '2026-02-03', amount: 50, category: 'food' },
    { id: 'foreign', date: '2026-02-04', amount: 10, currency: 'USD', fxRate: 7, category: 'Food' },
    { id: 'shared', date: '2026-02-04', amount: 500, category: 'Food', scope: 'shared' },
    { id: 'other-month', date: '2026-03-01', amount: 900, category: 'Food' },
  ] });
  const result = Core.categoryBudgetProgress(state, '2026-02');
  assert.equal(result.length, 1);
  assert.equal(result[0].spent, 120);
  assert.equal(result[0].remaining, -20);
  assert.equal(result[0].percent, 100);
  assert.equal(state.categoryBudgets.length, 3, 'Currency-specific budget is retained, never reinterpreted');
});

test('monthly and yearly bills retain their calendar anchors across short months', () => {
  const monthly = ledger({ recurringBills: [bill()] }).recurringBills[0];
  assert.equal(Core.nextBillDate(monthly, '2026-01-31'), '2026-02-28');
  assert.equal(Core.nextBillDate(monthly, '2026-02-28'), '2026-03-31');
  assert.equal(Core.nextBillDate(monthly, '2026-12-31'), '2027-01-31');
  const yearly = ledger({ recurringBills: [bill({ nextDate: '2024-02-29', interval: 'yearly' })] }).recurringBills[0];
  assert.equal(Core.nextBillDate(yearly, '2024-02-29'), '2025-02-28');
  assert.equal(Core.nextBillDate(yearly, '2027-02-28'), '2028-02-29');
});

test('bill confirmation is explicit, occurrence-based and idempotent after serialization', () => {
  const original = ledger({ recurringBills: [bill({ amount: 10, currency: 'USD', fxRate: 7.1 })] });
  assert.equal(original.records.length, 0, 'Loading an overdue bill does not record an expense');
  const future = Core.confirmRecurringBill(original, 'rent', '2026-01-31', '2026-01-30');
  assert.equal(future.changed, false);
  const result = Core.confirmRecurringBill(original, 'rent', '2026-01-31', '2026-02-10');
  assert.equal(result.record.date, '2026-01-31');
  assert.equal(result.record.scope, 'personal');
  assert.equal(Core.baseAmount(result.record), 71);
  assert.equal(result.state.recurringBills[0].nextDate, '2026-02-28');
  const restored = Core.normalizeState(JSON.parse(JSON.stringify(result.state)));
  assert.equal(restored.records[0].recurringBillId, 'rent');
  assert.equal(restored.records[0].recurringDate, '2026-01-31');
  const retry = Core.confirmRecurringBill(restored, 'rent', '2026-01-31', '2026-02-10');
  assert.equal(retry.changed, false);
  assert.equal(retry.state.records.length, 1);
  const manuallyRewound = { ...restored, recurringBills: restored.recurringBills.map(item => ({ ...item, nextDate: '2026-01-31' })) };
  const replay = Core.confirmRecurringBill(manuallyRewound, 'rent', '2026-01-31', '2026-02-10');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.state.records.length, 1, 'Rewinding a bill cannot recreate a handled occurrence');
  assert.equal(replay.state.recurringBills[0].nextDate, '2026-02-28');
});

test('skip advances one occurrence and editing retains confirmation history', () => {
  const state = ledger({ recurringBills: [bill()] });
  const skipped = Core.skipRecurringBill(state, 'rent', '2026-01-31', '2026-03-01');
  assert.equal(skipped.state.records.length, 0);
  assert.equal(skipped.state.recurringBills[0].nextDate, '2026-02-28');
  const edited = Core.saveRecurringBill(skipped.state, bill({ nextDate: '2026-02-28', amount: 1400, anchorDay: 31 }));
  assert.deepEqual(edited.recurringBills[0].handledDates, ['2026-01-31']);
  assert.equal(edited.recurringBills[0].amount, 1400);
  const confirmed = Core.confirmRecurringBill(edited, 'rent', '2026-02-28', '2026-03-01');
  assert.equal(confirmed.state.records[0].amount, 1400);
  assert.equal(confirmed.state.recurringBills[0].nextDate, '2026-03-31');
});

test('normalization rejects invalid financial planning values without altering ledger history', () => {
  const state = ledger({
    categoryBudgets: [{ month: '2026-13', category: 'Food', amount: 100 }, { month: '2026-02', category: 'Food', amount: -1 }, { month: '2026-02', category: 'Food', amount: 100 }, { month: '2026-02', category: 'food', amount: 200 }],
    recurringBills: [bill({ nextDate: '2026-02-30' }), bill({ id: 'bad-fx', currency: 'USD', fxRate: 0 }), bill({ id: 'paused', enabled: false })],
    records: [{ id: 'kept', date: '2026-01-01', amount: 50, category: 'Food' }],
  });
  assert.equal(state.categoryBudgets.length, 1);
  assert.equal(state.recurringBills.length, 1);
  assert.equal(state.records[0].id, 'kept');
  assert.equal(Core.confirmRecurringBill(state, 'paused', '2026-01-31', '2026-03-01').changed, false);
  assert.throws(() => Core.saveRecurringBill(state, bill({ amount: Infinity })), /Invalid/);
});

test('planning settings lock base currency and roundtrip with the existing ledger', () => {
  let stored;
  const storage = { setItem: (_key, value) => { stored = value; }, getItem: () => stored };
  const state = ledger({ categoryBudgets: [{ id: 'food', month: '2026-02', category: 'Food', amount: 100 }], recurringBills: [bill()] });
  Core.writeState(state, storage);
  const restored = Core.readState(storage);
  assert.deepEqual(restored.categoryBudgets, state.categoryBudgets);
  assert.deepEqual(restored.recurringBills, state.recurringBills);
  assert.equal(Core.changeBaseCurrency(restored, 'USD').blocked, true);
  assert.equal(Core.changeBaseCurrency(ledger({ recurringBills: [bill()] }), 'USD').blocked, true);
});
