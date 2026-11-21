const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../tally-core.js');

const ledger = extra => Core.normalizeState({ baseCurrency: 'CNY', ...extra });
let serial = 0;
const record = (date, amount, category, note = '', extra = {}) => ({ id: `r${++serial}`, date, amount, category, note, ...extra });
const monthly = (name, dates, amount = 68, extra = {}) => dates.map(date => record(date, amount, 'Streaming', name, extra));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('category breakdown ranks personal base-currency spending for one month', () => {
  const state = ledger({ records: [
    record('2026-11-02', 30, 'Food'), record('2026-11-03', 20, 'food'),
    record('2026-11-04', 10, 'Books', '', { currency: 'USD', fxRate: 7 }),
    record('2026-11-05', 500, 'Food', '', { scope: 'shared' }),
    record('2026-10-31', 999, 'Food'), record('2026-12-01', 999, 'Food'),
  ] });
  const result = Core.categoryBreakdown(state, 2026, 11);
  assert.equal(result.total, 120);
  assert.equal(result.count, 3);
  assert.deepEqual(result.items.map(item => [item.category, item.amount, item.count]), [['Books', 70, 1], ['Food', 50, 2]]);
  close(result.items[0].share, 70 / 120);
  assert.equal(result.items.some(item => item.other), false);
});

test('category breakdown keeps the top six and folds the rest, and any "Other", into one Other row', () => {
  const amounts = { Rent: 900, Food: 400, Travel: 300, Coffee: 200, Health: 150, Books: 120, Gifts: 30, Pets: 20 };
  const state = ledger({ records: [
    ...Object.entries(amounts).map(([category, amount]) => record('2026-11-10', amount, category)),
    record('2026-11-11', 15, 'Other'), record('2026-11-12', 5, '其他'),
  ] });
  const result = Core.categoryBreakdown(state, 2026, 11);
  assert.deepEqual(result.items.map(item => item.category), ['Rent', 'Food', 'Travel', 'Coffee', 'Health', 'Books', 'Other']);
  const other = result.items.at(-1);
  assert.equal(other.other, true);
  assert.equal(other.amount, 70);
  assert.equal(other.categories, 4, 'Gifts, Pets, Other and 其他');
  close(result.items.reduce((sum, item) => sum + item.share, 0), 1);
  // A large "Other" still sits last, as the remainder, never as a second "Other" row.
  const big = Core.categoryBreakdown(ledger({ records: [record('2026-11-01', 1000, 'Other'), record('2026-11-02', 10, 'Food')] }), 2026, 11);
  assert.deepEqual(big.items.map(item => [item.category, item.other, item.categories]), [['Food', false, 1], ['Other', true, 1]]);
});

test('category breakdown is empty for a quiet or invalid month', () => {
  const state = ledger({ records: [record('2026-11-01', 10, 'Food')] });
  assert.deepEqual(Core.categoryBreakdown(state, 2026, 10), { year: 2026, month: 10, total: 0, count: 0, items: [] });
  assert.equal(Core.categoryBreakdown(state, 2026, 13).items.length, 0);
  assert.equal(Core.categoryBreakdown(state, 'x', 1).total, 0);
});

test('monthly totals cover a window ending at the given month, oldest first, across a year boundary', () => {
  const state = ledger({ records: [
    record('2025-09-30', 10, 'Food'), record('2025-12-31', 20, 'Food'), record('2026-01-01', 5, 'Food', '', { currency: 'USD', fxRate: 7 }),
    record('2026-02-28', 40, 'Food'), record('2026-02-28', 400, 'Food', '', { scope: 'shared' }),
    record('2025-08-31', 999, 'Food'), record('2026-03-01', 999, 'Food'),
  ] });
  const months = Core.monthlyTotals(state, 2026, 2, 6);
  assert.deepEqual(months.map(item => [item.key, item.total, item.count]), [
    ['2025-09', 10, 1], ['2025-10', 0, 0], ['2025-11', 0, 0], ['2025-12', 20, 1], ['2026-01', 35, 1], ['2026-02', 40, 1],
  ]);
  assert.deepEqual(months.at(-1), { year: 2026, month: 2, key: '2026-02', total: 40, count: 1 });
  assert.equal(Core.monthlyTotals(state, 2026, 2).length, 6, 'six months by default');
  assert.equal(Core.monthlyTotals(state, 2026, 2, 1)[0].key, '2026-02');
  assert.equal(Core.monthlyTotals(state, 2026, 2, 0).length, 6, 'an invalid count falls back to six');
  assert.deepEqual(Core.monthlyTotals(state, 2026, 0, 6), []);
});

test('a steady monthly merchant is suggested with the next charge one month after the last', () => {
  const state = ledger({ records: [
    ...monthly('Netflix · Premium', ['2026-08-05', '2026-09-05']),
    record('2026-10-04', 68, 'Streaming', 'netflix'),
    record('2026-11-05', 70, 'Streaming', '  NETFLIX  ·  family '),
    record('2026-11-06', 25, 'Coffee', 'Manner'),
  ] });
  const [suggestion, ...rest] = Core.detectSubscriptions(state, '2026-11-20');
  assert.equal(rest.length, 0);
  assert.equal(suggestion.key, 'netflix');
  assert.equal(suggestion.name, 'NETFLIX', 'the latest charge names it');
  assert.equal(suggestion.interval, 'monthly');
  assert.equal(suggestion.count, 4);
  assert.deepEqual([suggestion.amount, suggestion.currency, suggestion.fxRate, suggestion.category], [70, 'CNY', 1, 'Streaming']);
  assert.deepEqual([suggestion.firstDate, suggestion.lastDate, suggestion.nextDate], ['2026-08-05', '2026-11-05', '2026-12-05']);
});

test('monthly detection needs three charges at 26–35 day intervals within 15% of the latest amount', () => {
  const detect = records => Core.detectSubscriptions(ledger({ records }), '2026-11-20');
  assert.equal(detect(monthly('Spotify', ['2026-10-01', '2026-11-01'])).length, 0, 'two monthly charges are not enough');
  assert.equal(detect(monthly('Spotify', ['2026-09-20', '2026-10-15', '2026-11-10'])).length, 0, '25-day gaps are too short');
  assert.equal(detect(monthly('Spotify', ['2026-08-01', '2026-09-06', '2026-10-12'])).length, 0, '36-day gaps are too long');
  assert.equal(detect(monthly('Spotify', ['2026-09-10', '2026-10-06', '2026-11-10'])).length, 1, '26 and 35 days are inside the range');
  // Tolerance is measured against the latest charge, the price a bill would use.
  assert.equal(detect([...monthly('Gym', ['2026-09-01', '2026-10-01'], 100), record('2026-11-01', 118, 'Health', 'Gym')]).length, 0, '100 is 15.3% below 118');
  assert.equal(detect([...monthly('Gym', ['2026-09-01', '2026-10-01'], 100), record('2026-11-01', 114, 'Health', 'Gym')]).length, 1, '100 is 12.3% below 114');
  assert.equal(detect([record('2026-09-01', 86, 'Health', 'Gym'), record('2026-10-01', 114, 'Health', 'Gym'), record('2026-11-01', 100, 'Health', 'Gym')]).length, 1, 'both within ±15% of 100');
  // An old price ends the run without hiding three newer steady charges.
  const raised = detect([...monthly('Gym', ['2026-05-01', '2026-06-01', '2026-07-01'], 60), ...monthly('Gym', ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'], 90)]);
  assert.deepEqual(raised.map(item => [item.amount, item.count, item.firstDate]), [[90, 4, '2026-08-01']]);
  // A missed month splits the history; only the run that reaches the newest charge counts.
  assert.equal(detect(monthly('iCloud', ['2026-06-03', '2026-07-03', '2026-08-03', '2026-10-03', '2026-11-03'], 6)).length, 0);
  assert.equal(detect(monthly('iCloud', ['2026-06-03', '2026-07-03', '2026-09-03', '2026-10-03', '2026-11-03'], 6))[0].count, 3);
  // Mixed currencies are different charges, not one subscription.
  assert.equal(detect([...monthly('VPN', ['2026-09-02', '2026-10-02'], 10, { currency: 'USD', fxRate: 7 }), record('2026-11-02', 10, 'Tools', 'VPN')]).length, 0);
});

test('a same-day duplicate counts once, and frequent purchases are never a subscription', () => {
  const duplicate = Core.detectSubscriptions(ledger({ records: [...monthly('Netflix', ['2026-09-05', '2026-10-05', '2026-11-05']), record('2026-11-05', 68, 'Streaming', 'Netflix')] }), '2026-11-20');
  assert.equal(duplicate[0].count, 3);
  const coffee = [];
  for (let day = 1; day <= 28; day += 3) for (const month of ['09', '10', '11']) coffee.push(record(`2026-${month}-${String(day).padStart(2, '0')}`, 30, 'Coffee', 'Manner'));
  assert.equal(Core.detectSubscriptions(ledger({ records: coffee }), '2026-11-30').length, 0);
});

test('yearly charges need two occurrences 350–380 days apart', () => {
  const domain = [record('2024-11-28', 12, 'Web', 'Domain renewal · example.com', { currency: 'USD', fxRate: 7.2 }), record('2025-11-28', 12, 'Web', 'Domain renewal', { currency: 'USD', fxRate: 7.15 })];
  const [yearly] = Core.detectSubscriptions(ledger({ records: domain }), '2026-11-20');
  assert.deepEqual([yearly.key, yearly.interval, yearly.count, yearly.nextDate, yearly.currency, yearly.fxRate], ['domain renewal', 'yearly', 2, '2026-11-28', 'USD', 7.15]);
  const leap = [record('2023-02-28', 99, 'Web', 'Hosting'), record('2024-02-29', 99, 'Web', 'Hosting')];
  assert.equal(Core.detectSubscriptions(ledger({ records: leap }), '2024-06-01')[0].nextDate, '2025-02-28');
  assert.equal(Core.detectSubscriptions(ledger({ records: [record('2025-01-10', 99, 'Web', 'Hosting'), record('2025-11-10', 99, 'Web', 'Hosting')] }), '2025-12-01').length, 0, '304 days is neither monthly nor yearly');
  assert.equal(Core.detectSubscriptions(ledger({ records: [domain[1]] }), '2026-11-20').length, 0);
});

test('a subscription whose last charge is more than about two intervals old has ended', () => {
  const records = monthly('Netflix', ['2026-07-05', '2026-08-05', '2026-09-05']);
  assert.equal(Core.detectSubscriptions(ledger({ records }), '2026-11-06').length, 1, '62 days after the last charge');
  assert.equal(Core.detectSubscriptions(ledger({ records }), '2026-11-07').length, 0, '63 days after the last charge');
  const yearly = [record('2023-03-01', 99, 'Web', 'Hosting'), record('2024-03-01', 99, 'Web', 'Hosting')];
  assert.equal(Core.detectSubscriptions(ledger({ records: yearly }), '2026-03-01').length, 1);
  assert.equal(Core.detectSubscriptions(ledger({ records: yearly }), '2026-03-03').length, 0);
});

test('month-end charges keep their day: Jan 31, Feb 28 and Mar 31 continue on Apr 30', () => {
  const [march] = Core.detectSubscriptions(ledger({ records: monthly('Rent', ['2026-01-31', '2026-02-28', '2026-03-31'], 4200) }), '2026-04-10');
  assert.deepEqual([march.anchorDay, march.nextDate], [31, '2026-04-30']);
  const [february] = Core.detectSubscriptions(ledger({ records: monthly('Rent', ['2025-12-31', '2026-01-31', '2026-02-28'], 4200) }), '2026-03-10');
  assert.deepEqual([february.anchorDay, february.nextDate], [31, '2026-03-31']);
});

test('merchants come from the note before " · ", falling back to the category, never to a generic Other', () => {
  const state = ledger({ records: [
    ...['2026-09-01', '2026-10-01', '2026-11-01'].map(date => record(date, 300, 'Gym')),
    ...['2026-09-09', '2026-10-09', '2026-11-09'].map(date => record(date, 45, 'Other')),
    ...['2026-09-10', '2026-10-10', '2026-11-10'].map(date => record(date, 45, '其他')),
    ...['2026-09-11', '2026-10-11', '2026-11-11'].map(date => record(date, 45, '')),
    ...['2026-09-12', '2026-10-12', '2026-11-12'].map(date => record(date, 15, 'Music', 'Spotify', { scope: 'shared' })),
  ] });
  assert.deepEqual(Core.detectSubscriptions(state, '2026-11-20').map(item => [item.key, item.name]), [['gym', 'Gym']]);
  assert.equal(Core.subscriptionKey('  Apple   Music · Family  '), 'apple music');
  assert.equal(Core.subscriptionKey('x'.repeat(200)).length, 60, 'keys never outgrow a bill name');
});

test('recurring bills and dismissals cover a merchant', () => {
  const records = monthly('Netflix · Premium', ['2026-09-05', '2026-10-05', '2026-11-05']);
  const bill = { id: 'netflix', name: '  netflix ', amount: 68, currency: 'CNY', nextDate: '2026-12-05', interval: 'monthly' };
  assert.equal(Core.detectSubscriptions(ledger({ records, recurringBills: [bill] }), '2026-11-20').length, 0, 'bill name matches');
  assert.equal(Core.detectSubscriptions(ledger({ records, recurringBills: [{ ...bill, name: 'TV', note: 'Netflix · plan' }] }), '2026-11-20').length, 0, 'bill note matches');
  assert.equal(Core.detectSubscriptions(ledger({ records, recurringBills: [{ ...bill, name: 'TV', enabled: false }] }), '2026-11-20').length, 1);
  const confirmed = records.map((item, index) => index === 2 ? { ...item, recurringBillId: 'old-bill', recurringDate: item.date } : item);
  assert.equal(Core.detectSubscriptions(ledger({ records: confirmed }), '2026-11-20').length, 0, 'records a bill created cover the merchant');
  assert.equal(Core.detectSubscriptions(ledger({ records, dismissedSubscriptions: [' NETFLIX '] }), '2026-11-20').length, 0);
  assert.equal(Core.detectSubscriptions(ledger({ records }), 'not a date').length, 0);
});

test('adding a suggestion uses the recurring-bill save path and then stops suggesting it', () => {
  const state = ledger({ records: [
    ...monthly('Netflix', ['2026-09-05', '2026-10-05', '2026-11-05']),
    ...['2026-09-02', '2026-10-02', '2026-11-02'].map(date => record(date, 15, 'Software', 'Notion · plus', { currency: 'USD', fxRate: 7.1 })),
  ] });
  const suggestions = Core.detectSubscriptions(state, '2026-11-20');
  assert.deepEqual(suggestions.map(item => item.key), ['netflix', 'notion']);
  let next = state;
  for (const suggestion of suggestions) next = Core.saveRecurringBill(next, Core.subscriptionBill(suggestion));
  assert.equal(next.records.length, state.records.length, 'nothing is recorded until a bill is confirmed');
  const notion = next.recurringBills.find(item => item.name === 'Notion');
  assert.deepEqual([notion.amount, notion.currency, notion.fxRate, notion.category, notion.interval, notion.nextDate, notion.anchorDay, notion.enabled],
    [15, 'USD', 7.1, 'Software', 'monthly', '2026-12-02', 2, true]);
  const restored = Core.normalizeState(JSON.parse(JSON.stringify(next)));
  assert.equal(restored.recurringBills.length, 2);
  assert.equal(Core.detectSubscriptions(restored, '2026-11-20').length, 0);
  const confirmed = Core.confirmRecurringBill(restored, notion.id, '2026-12-02', '2026-12-02');
  assert.equal(confirmed.record.note, 'Notion');
  assert.equal(Core.detectSubscriptions(confirmed.state, '2026-12-03').length, 0, 'confirmed charges stay covered');
});

test('dismissed subscription keys are normalized, bounded and survive a round trip', () => {
  const state = ledger({ dismissedSubscriptions: ['  Spotify ', 'spotify', 5, null, '', 'Apple Music · Family', 'x'.repeat(300)] });
  assert.deepEqual(state.dismissedSubscriptions, ['spotify', 'apple music', 'x'.repeat(60)]);
  assert.deepEqual(Core.normalizeState({ dismissedSubscriptions: 'spotify' }).dismissedSubscriptions, []);
  const many = Core.normalizeState({ dismissedSubscriptions: Array.from({ length: 250 }, (_, index) => `shop ${index}`) }).dismissedSubscriptions;
  assert.equal(many.length, 200);
  assert.equal(many[0], 'shop 50', 'the oldest dismissals give way first');
  let next = Core.dismissSubscription(ledger({ dismissedSubscriptions: ['a', 'b'] }), ' A ');
  assert.deepEqual(next.dismissedSubscriptions, ['b', 'a'], 'dismissing again moves a key to the newest end');
  next = Core.restoreSubscription(next, 'B');
  assert.deepEqual(next.dismissedSubscriptions, ['a']);
  assert.equal(Core.dismissSubscription(next, '   '), next);
  const storage = new Map();
  const fake = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  Core.writeState(Core.dismissSubscription(ledger({}), 'Netflix'), fake);
  assert.deepEqual(Core.readState(fake).dismissedSubscriptions, ['netflix']);
});
