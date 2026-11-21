const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../habits-core');

// Friday 20 November 2026. Weeks start on Monday 16 November.
const TODAY = '2026-11-20';
const LONG_AGO = new Date(2026, 0, 1, 12).getTime();
const habit = (id, frequency = { type: 'daily' }, extra = {}) => ({ id, name: `Habit ${id}`, icon: '', color: 'primary', frequency, createdAt: LONG_AGO, archivedAt: null, ...extra });
const done = (...dates) => Object.fromEntries(dates.map(date => [date, 1]));
const range = (from, to) => { const dates = []; for (let day = from; day <= to; day = Core.addDays(day, 1)) dates.push(day); return dates; };
const MWF = { type: 'weekdays', days: [1, 3, 5] };
const TWICE = { type: 'weekly', times: 2 };

test('dates are local calendar days with Monday weeks and Sunday as weekday 0', () => {
  assert.equal(Core.weekday(TODAY), 5);
  assert.equal(Core.weekday('2026-11-22'), 0);
  assert.equal(Core.weekStart(TODAY), '2026-11-16');
  assert.equal(Core.weekStart('2026-11-22'), '2026-11-16');
  assert.equal(Core.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(Core.addDays('2026-03-29', -1), '2026-03-28', 'DST changes never skip a day');
  assert.equal(Core.validDate('2026-02-30'), null);
  assert.equal(Core.localDate(new Date(2026, 10, 20, 23, 59).getTime()), TODAY);
});

test('normalization keeps a bounded, canonical store and drops invalid input', () => {
  const raw = {
    version: 9, token: 'drop me',
    habits: [
      { ...habit('b'), name: '  Read\n\tbooks  ', icon: '📚', color: 'pink', order: 2, extra: 'drop' },
      { ...habit('a'), name: 'x'.repeat(45), icon: 'ab', order: 1, frequency: { type: 'weekdays', days: [5, 1, 1, 9, 3] } },
      { ...habit('a'), name: 'Duplicate id' },
      { ...habit('c'), name: '' },
      { ...habit('__proto__') }, { ...habit('toString') }, { ...habit('prototype') }, { ...habit(' spaced') }, null, 'text',
      { ...habit('d'), icon: '😀😀', frequency: { type: 'weekdays', days: [] }, archivedAt: 'yesterday', order: 0 },
      { ...habit('e'), icon: '👩‍💻', frequency: { type: 'weekly', times: 9 } },
      { ...habit('f'), icon: '🇯🇵', frequency: { type: 'weekly', times: 3 }, createdAt: -5 },
    ],
    checkins: {
      a: { '2026-11-19': 1, '2026-02-30': 1, '2026-11-18': 2, '2026-11-17': true, nope: 1 },
      b: [],
      missing: { '2026-11-19': 1 },
      d: { [Core.addDays(TODAY, -(Core.HISTORY_DAYS - 1))]: 1, [Core.addDays(TODAY, -Core.HISTORY_DAYS)]: 1, [Core.addDays(TODAY, 2)]: 1, [Core.addDays(TODAY, 3)]: 1 },
    },
  };
  const state = Core.normalize(raw, TODAY);
  assert.deepEqual(Object.keys(state), ['version', 'habits', 'checkins']);
  assert.equal(state.version, 1);
  assert.deepEqual(state.habits.map(item => item.id), ['d', 'a', 'b', 'e', 'f'], 'sorted by order, then input order');
  assert.deepEqual(state.habits.map(item => item.order), [0, 1, 2, 3, 4]);
  const byId = Object.fromEntries(state.habits.map(item => [item.id, item]));
  assert.deepEqual(Object.keys(byId.b), ['id', 'name', 'icon', 'color', 'frequency', 'createdAt', 'archivedAt', 'order']);
  assert.equal(byId.b.name, 'Read books');
  assert.equal(byId.b.icon, '📚');
  assert.equal(byId.b.color, 'primary');
  assert.equal(byId.a.name, 'x'.repeat(40));
  assert.equal(byId.a.icon, '');
  assert.deepEqual(byId.a.frequency, { type: 'weekdays', days: [1, 3, 5] });
  assert.equal(byId.d.icon, '', 'two emoji are not one icon');
  assert.deepEqual(byId.d.frequency, { type: 'daily' });
  assert.equal(byId.d.archivedAt, null);
  assert.equal(byId.e.icon, '👩‍💻');
  assert.deepEqual(byId.e.frequency, { type: 'daily' });
  assert.equal(byId.f.icon, '🇯🇵');
  assert.deepEqual(byId.f.frequency, { type: 'weekly', times: 3 });
  assert.equal(byId.f.createdAt, null);
  assert.deepEqual(state.checkins.a, done('2026-11-17', '2026-11-19'));
  assert.deepEqual(Object.keys(state.checkins), ['d', 'a'], 'only known habits with check-ins, in habit order');
  assert.deepEqual(Object.keys(state.checkins.d), [Core.addDays(TODAY, -(Core.HISTORY_DAYS - 1)), Core.addDays(TODAY, 2)], 'three years of history; another time zone may be a day ahead');
  assert.deepEqual(Core.normalize(state, TODAY), state, 'normalizing is idempotent');
  assert.deepEqual(Core.normalize(null), Core.defaults());
  assert.deepEqual(Core.normalize([habit('a')]), Core.defaults());
});

test('names count characters, not code units, and control characters are removed', () => {
  const state = Core.normalize({ habits: [{ ...habit('a'), name: `${'🙂'.repeat(39)}ab` }, { ...habit('b'), name: 'Walk\u0000 the dog' }] }, TODAY);
  assert.equal(Array.from(state.habits[0].name).length, 40);
  assert.equal(state.habits[1].name, 'Walk the dog');
  assert.equal(Core.cleanIcon('✍️'), '✍️');
  assert.equal(Core.cleanIcon('👍🏽'), '👍🏽');
  for (const value of ['1️⃣', 'a', ' ', '<img>', 7, null]) assert.equal(Core.cleanIcon(value), '', String(value));
});

test('habit count and history size stay bounded without throwing on stored data', () => {
  const many = { habits: Array.from({ length: 60 }, (_, index) => habit(`h${index}`)) };
  assert.equal(Core.normalize(many, TODAY).habits.length, Core.MAX_HABITS);
  assert.throws(() => Core.strict(many, TODAY), error => error.code === 'HABITS_LIMIT');
  const history = range(Core.addDays(TODAY, -(Core.HISTORY_DAYS - 1)), TODAY);
  const full = { habits: Array.from({ length: 50 }, (_, index) => habit(`habit-${index}`)), checkins: {} };
  for (const item of full.habits) full.checkins[item.id] = done(...history);
  const state = Core.normalize(full, TODAY);
  assert.ok(Core.bytes(state) <= Core.MAX_BYTES, 'the store fits its sync budget');
  for (const item of state.habits) assert.equal(state.checkins[item.id][TODAY], 1, 'recent check-ins are kept');
  const oldest = Object.values(state.checkins).flatMap(map => Object.keys(map)).sort()[0];
  assert.ok(oldest > history[0], 'the oldest check-ins roll off first');
  assert.throws(() => Core.strict(full, TODAY), error => error.code === 'HABITS_SIZE');
});

test('strict validation rejects anything a lenient read would silently drop', () => {
  const valid = { habits: [habit('a', MWF, { icon: '📚', color: 'success' })], checkins: { a: done('2026-11-18') } };
  assert.deepEqual(Core.strict(valid, TODAY), Core.normalize(valid, TODAY));
  const invalid = [
    { habits: [{ ...habit('a'), color: 'pink' }] },
    { habits: [{ ...habit('a'), icon: 'ab' }] },
    { habits: [{ ...habit('a'), name: 'x'.repeat(41) }] },
    { habits: [{ ...habit('a'), frequency: { type: 'weekdays', days: [1, 1] } }] },
    { habits: [{ ...habit('a'), frequency: { type: 'weekly', times: 0 } }] },
    { habits: [{ ...habit('a'), archivedAt: 'soon' }] },
    { habits: [habit('a'), habit('a')] },
    { habits: [habit('__proto__')] },
    { habits: [habit('a')], checkins: { b: done(TODAY) } },
    { habits: [habit('a')], checkins: { a: { [TODAY]: 2 } } },
    { habits: [habit('a')], checkins: { a: done(Core.addDays(TODAY, 3)) } },
    { habits: [habit('a')], checkins: [] },
    { habits: 'a' },
  ];
  for (const raw of invalid) assert.throws(() => Core.strict(raw, TODAY), Error, JSON.stringify(raw));
});

test('parsed check-ins cannot pollute prototypes', () => {
  const raw = JSON.parse(`{"habits":[{"id":"a","name":"A","frequency":{"type":"daily"}}],"checkins":{"__proto__":{"polluted":1},"a":{"__proto__":{"polluted":1},"${TODAY}":1}}}`);
  const state = Core.normalize(raw, TODAY);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(state.checkins, { a: done(TODAY) });
  assert.deepEqual(Core.checkinsFor(state, 'toString'), {});
});

test('toggling a check-in is immutable and limited to today and earlier saved days', () => {
  const state = Core.normalize({ habits: [habit('a'), habit('z', undefined, { archivedAt: LONG_AGO })] }, TODAY);
  const snapshot = JSON.stringify(state);
  const on = Core.toggleCheckin(state, 'a', TODAY, TODAY);
  assert.deepEqual(on.checkins, { a: done(TODAY) });
  assert.equal(JSON.stringify(state), snapshot, 'the input state is unchanged');
  const past = Core.toggleCheckin(on, 'a', '2026-11-14', TODAY);
  assert.deepEqual(Object.keys(past.checkins.a), ['2026-11-14', TODAY]);
  const off = Core.toggleCheckin(Core.toggleCheckin(past, 'a', TODAY, TODAY), 'a', '2026-11-14', TODAY);
  assert.deepEqual(off.checkins, {}, 'a habit without check-ins leaves no empty map');
  assert.equal(Core.isDone(on, 'a', TODAY), true);
  assert.deepEqual(Core.setCheckin(on, 'a', TODAY, true, TODAY), on, 'setting the current value changes nothing');
  assert.throws(() => Core.toggleCheckin(state, 'a', Core.addDays(TODAY, 1), TODAY), error => error.code === 'HABIT_DATE');
  assert.throws(() => Core.toggleCheckin(state, 'a', Core.addDays(TODAY, -Core.HISTORY_DAYS), TODAY), error => error.code === 'HABIT_DATE');
  assert.throws(() => Core.toggleCheckin(state, 'a', 'yesterday', TODAY), error => error.code === 'HABIT_DATE');
  assert.throws(() => Core.toggleCheckin(state, 'z', TODAY, TODAY), error => error.code === 'HABIT_ARCHIVED');
  assert.throws(() => Core.toggleCheckin(state, 'missing', TODAY, TODAY), error => error.code === 'HABIT_MISSING');
});

test('schedules: daily and weekly every day, weekdays only on chosen days', () => {
  assert.equal(Core.isDue(habit('a'), TODAY), true);
  assert.equal(Core.isDue(habit('a', MWF), TODAY), true);
  assert.equal(Core.isDue(habit('a', MWF), '2026-11-19'), false);
  assert.equal(Core.isDue(habit('a', { type: 'weekdays', days: [0, 6] }), '2026-11-22'), true);
  assert.equal(Core.isDue(habit('a', TWICE), '2026-11-19'), true);
  assert.equal(Core.isDue(habit('a'), 'bad'), false);
  // A weekly habit leaves Today once its target is met, unless it was done today.
  assert.equal(Core.dueToday(habit('a', TWICE), done('2026-11-16'), TODAY), true);
  assert.equal(Core.dueToday(habit('a', TWICE), done('2026-11-16', '2026-11-17'), TODAY), false);
  assert.equal(Core.dueToday(habit('a', TWICE), done('2026-11-16', TODAY), TODAY), true);
  assert.equal(Core.dueToday(habit('a', MWF), {}, '2026-11-19'), false);
});

test('daily streaks: gaps break them, an unfinished today does not', () => {
  const daily = habit('a');
  assert.equal(Core.currentStreak(daily, done('2026-11-18', '2026-11-19', TODAY), TODAY), 3);
  assert.equal(Core.currentStreak(daily, done('2026-11-17', '2026-11-18', '2026-11-19'), TODAY), 3, 'today not done yet');
  const gap = done(...range('2026-11-12', '2026-11-16'), '2026-11-18', '2026-11-19');
  assert.equal(Core.currentStreak(daily, gap, TODAY), 2);
  assert.equal(Core.bestStreak(daily, gap, TODAY), 5);
  const broken = done(...range('2026-11-10', '2026-11-18'));
  assert.equal(Core.currentStreak(daily, broken, TODAY), 0, 'missed yesterday and not done today');
  assert.equal(Core.bestStreak(daily, broken, TODAY), 9);
  assert.equal(Core.currentStreak(daily, {}, TODAY), 0);
  assert.equal(Core.bestStreak(daily, {}, TODAY), 0);
  assert.equal(Core.currentStreak(daily, done(Core.addDays(TODAY, 1)), TODAY), 0, 'a check-in dated ahead in another time zone does not count yet');
});

test('weekday streaks count only scheduled days', () => {
  const gym = habit('a', MWF);
  assert.equal(Core.currentStreak(gym, done('2026-11-16', '2026-11-18'), TODAY), 2, 'today is scheduled but not done yet');
  const steady = done('2026-11-13', '2026-11-16', '2026-11-18', TODAY);
  assert.equal(Core.currentStreak(gym, steady, TODAY), 4, 'Tuesday and Thursday are not required');
  assert.equal(Core.currentStreak(gym, { ...steady, ...done('2026-11-17', '2026-11-14') }, TODAY), 4, 'check-ins on rest days do not count');
  const gap = done('2026-11-09', '2026-11-11', '2026-11-13', '2026-11-18', TODAY);
  assert.equal(Core.currentStreak(gym, gap, TODAY), 2, 'missing Monday breaks the streak');
  assert.equal(Core.bestStreak(gym, gap, TODAY), 3);
  assert.equal(Core.currentStreak(gym, done('2026-11-14', '2026-11-15'), TODAY), 0);
  assert.equal(Core.bestStreak(gym, done('2026-11-14', '2026-11-15'), TODAY), 0);
  const weekend = habit('b', { type: 'weekdays', days: [0, 6] });
  assert.equal(Core.currentStreak(weekend, done('2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15'), TODAY), 4, 'weekdays between weekends are rest days');
});

test('weekly streaks count consecutive weeks that met the target', () => {
  const call = habit('a', TWICE);
  const twoWeeks = done('2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17');
  assert.equal(Core.currentStreak(call, twoWeeks, TODAY), 2, 'the unfinished current week does not break the streak');
  assert.equal(Core.currentStreak(call, { ...twoWeeks, ...done('2026-11-19') }, TODAY), 3, 'the current week counts once met');
  assert.equal(Core.bestStreak(call, { ...twoWeeks, ...done('2026-11-19') }, TODAY), 3);
  const gap = done('2026-10-05', '2026-10-06', '2026-10-12', '2026-10-13', '2026-10-19', '2026-10-20', '2026-10-27', '2026-10-28', '2026-11-03', '2026-11-10', '2026-11-11', '2026-11-16', TODAY);
  assert.equal(Core.currentStreak(call, gap, TODAY), 2, 'a week below target breaks the streak');
  assert.equal(Core.bestStreak(call, gap, TODAY), 4);
  assert.equal(Core.currentStreak(habit('b', { type: 'weekly', times: 3 }), done('2026-11-16', '2026-11-17', TODAY), TODAY), 1);
});

test('completion rate covers the last 30 days from the habit start, with today and the current week only once done', () => {
  const recent = habit('a', undefined, { createdAt: new Date(2026, 10, 11, 12).getTime() });
  const hits = range('2026-11-11', '2026-11-19').filter(day => day !== '2026-11-15');
  assert.deepEqual(Core.completionRate(recent, done(...hits), TODAY), { done: 8, due: 9, rate: 8 / 9, unit: 'day' });
  assert.deepEqual(Core.completionRate(recent, done(...hits, TODAY), TODAY), { done: 9, due: 10, rate: 0.9, unit: 'day' });
  const old = habit('b');
  assert.equal(Core.completionRate(old, done(...range('2026-10-01', TODAY)), TODAY).due, 30, 'only the last 30 days');
  assert.equal(Core.completionRate(old, done(...range('2026-10-01', TODAY)), TODAY).rate, 1);
  const gym = habit('c', MWF);
  const scheduled = range('2026-10-22', '2026-11-19').filter(day => [1, 3, 5].includes(Core.weekday(day)) && day !== '2026-11-04');
  assert.deepEqual(Core.completionRate(gym, done(...scheduled, '2026-11-14'), TODAY), { done: 11, due: 12, rate: 11 / 12, unit: 'day' });
  const weekly = Core.completionRate(habit('d', TWICE), done('2026-10-19', '2026-10-21', '2026-10-27', '2026-11-02', '2026-11-04', '2026-11-09', '2026-11-13', '2026-11-17'), TODAY);
  assert.deepEqual(weekly, { done: 3, due: 4, rate: 0.75, unit: 'week' });
  const fresh = Core.completionRate(habit('e', TWICE, { createdAt: new Date(2026, 10, 17, 12).getTime() }), done('2026-11-17'), TODAY);
  assert.deepEqual(fresh, { done: 0, due: 0, rate: null, unit: 'week' }, 'nothing to judge yet');
  assert.equal(Core.completionRate(habit('f', undefined, { createdAt: new Date(2026, 10, 20, 9).getTime() }), {}, TODAY).rate, null);
});

test('heatmap: twelve Monday-first weeks ending with the current one', () => {
  const daily = habit('a', undefined, { createdAt: new Date(2026, 10, 11, 12).getTime() });
  const weeks = Core.heatmap(daily, done('2026-11-11', '2026-11-13', '2026-11-19'), TODAY);
  assert.equal(weeks.length, 12);
  assert.equal(weeks[0].start, '2026-08-31');
  assert.equal(weeks[11].start, '2026-11-16');
  assert.ok(weeks.every(week => week.days.length === 7 && Core.weekday(week.days[0].date) === 1));
  const states = Object.fromEntries(weeks.flatMap(week => week.days).map(cell => [cell.date, cell.state]));
  assert.equal(states['2026-11-10'], 'before');
  assert.equal(states['2026-11-11'], 'done');
  assert.equal(states['2026-11-12'], 'missed');
  assert.equal(states['2026-11-19'], 'done');
  assert.equal(states[TODAY], 'pending');
  assert.equal(states['2026-11-21'], 'future');
  assert.equal(weeks[11].count, 1);
  assert.equal(weeks[11].met, null);
  const gym = Object.fromEntries(Core.heatmap(habit('b', MWF), done('2026-11-16', '2026-11-17'), TODAY).flatMap(week => week.days).map(cell => [cell.date, cell.state]));
  assert.equal(gym['2026-11-16'], 'done');
  assert.equal(gym['2026-11-17'], 'extra');
  assert.equal(gym['2026-11-18'], 'missed');
  assert.equal(gym['2026-11-19'], 'rest');
  const weekly = Core.heatmap(habit('c', TWICE), done('2026-11-10', '2026-11-12', '2026-11-17'), TODAY);
  assert.deepEqual(weekly.slice(-2).map(week => week.met), [true, false]);
  assert.equal(weekly[11].days[3].state, 'open', 'a weekly habit has no missed days');
  assert.equal(Core.heatmap(daily, {}, TODAY, 4).length, 4);
});

test('the seven-day strip ends today and marks rest days', () => {
  const days = Core.lastDays(habit('a', MWF), done('2026-11-16'), TODAY);
  assert.deepEqual(days.map(day => day.date), range('2026-11-14', TODAY));
  assert.deepEqual(days.map(day => day.state), ['rest', 'rest', 'done', 'rest', 'missed', 'rest', 'pending']);
  assert.deepEqual(days.map(day => day.weekday), [6, 0, 1, 2, 3, 4, 5]);
  const stats = Core.stats(habit('a', MWF), done('2026-11-16', TODAY), TODAY);
  assert.equal(stats.current, 1); assert.equal(stats.best, 1); assert.equal(stats.total, 2); assert.equal(stats.doneToday, true);
  const state = Core.normalize({ habits: [habit('a'), habit('b', MWF), habit('c', TWICE), habit('d', { type: 'weekdays', days: [2] }), habit('e', undefined, { archivedAt: LONG_AGO })], checkins: { a: done(TODAY), c: done('2026-11-16', '2026-11-17') } }, TODAY);
  assert.deepEqual(Core.summary(state, TODAY), { due: 2, done: 1 }, 'Tuesday-only, met-weekly and archived habits are not due');
});

test('create, edit, archive, reorder, delete and restore keep identities and history', () => {
  let state = Core.create(null, { id: 'read', name: ' Read ', icon: '📚', color: 'success', frequency: MWF }, LONG_AGO, TODAY);
  state = Core.create(state, { id: 'walk', name: 'Walk' }, LONG_AGO + 1, TODAY);
  state = Core.create(state, { id: 'water', name: 'Water', frequency: TWICE }, LONG_AGO + 2, TODAY);
  assert.deepEqual(state.habits.map(item => [item.id, item.order]), [['read', 0], ['walk', 1], ['water', 2]]);
  assert.deepEqual(state.habits[0], { id: 'read', name: 'Read', icon: '📚', color: 'success', frequency: MWF, createdAt: LONG_AGO, archivedAt: null, order: 0 });
  assert.throws(() => Core.create(state, { name: '   ' }, LONG_AGO, TODAY), error => error.code === 'HABIT_NAME');
  assert.throws(() => Core.create(state, { id: 'x', name: 'X', frequency: { type: 'weekdays', days: [] } }, LONG_AGO, TODAY), error => error.code === 'HABIT_FREQUENCY');
  assert.throws(() => Core.create(state, { id: 'read', name: 'Again' }, LONG_AGO, TODAY), error => error.code === 'HABIT_EXISTS');
  assert.match(Core.create(state, { name: 'Generated' }, LONG_AGO, TODAY).habits[3].id, /^habit-/);
  const full = { habits: Array.from({ length: 50 }, (_, index) => habit(`h${index}`)) };
  assert.throws(() => Core.create(full, { name: 'One more' }, LONG_AGO, TODAY), error => error.code === 'HABITS_LIMIT');

  state = Core.setCheckin(state, 'read', '2026-11-18', true, TODAY);
  const edited = Core.update(state, 'read', { name: 'Read more', icon: '', frequency: { type: 'daily' } }, TODAY);
  assert.deepEqual(edited.habits[0], { ...state.habits[0], name: 'Read more', icon: '', frequency: { type: 'daily' } });
  assert.deepEqual(edited.checkins, state.checkins, 'editing keeps history');
  assert.throws(() => Core.update(state, 'gone', { name: 'X' }, TODAY), error => error.code === 'HABIT_MISSING');

  const archived = Core.archive(state, 'walk', true, LONG_AGO + 5, TODAY);
  assert.equal(archived.habits[1].archivedAt, LONG_AGO + 5);
  const moved = Core.move(archived, 'water', -1, TODAY);
  assert.deepEqual(moved.habits.map(item => item.id), ['water', 'walk', 'read'], 'moves skip archived habits');
  assert.deepEqual(Core.move(moved, 'water', -1, TODAY), moved, 'the first habit cannot move up');
  assert.equal(Core.archive(archived, 'walk', false, LONG_AGO + 9, TODAY).habits[1].archivedAt, null);

  const { state: removed, removed: undo } = Core.remove(state, 'read', TODAY);
  assert.deepEqual(removed.habits.map(item => item.id), ['walk', 'water']);
  assert.deepEqual(removed.checkins, {});
  const restored = Core.restore(removed, undo, TODAY);
  assert.deepEqual(restored, state, 'undo restores the habit in place with its check-ins');
  assert.deepEqual(Core.restore(restored, undo, TODAY), restored, 'restoring twice changes nothing');
});

test('backup import adds new habits and missing check-ins and rejects invalid files', () => {
  const Workspace = require('../workspace-tools-core');
  const today = Core.localDate(), yesterday = Core.addDays(today, -1), before = Core.addDays(today, -2);
  const values = new Map(), store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  store.setItem(Core.KEY, JSON.stringify({ version: 1, habits: [{ ...habit('a'), name: 'Local name' }], checkins: { a: done(before) } }));
  const file = { version: 1, habits: [{ ...habit('a'), name: 'Backup name' }, habit('b', MWF, { icon: '📚' })], checkins: { a: done(yesterday), b: done(today) } };
  assert.ok(Workspace.KEYS.includes(Core.KEY));
  const plan = Workspace.prepare(JSON.stringify({ format: 'daily-space', version: 1, payload: { [Core.KEY]: JSON.stringify(file) } }), 'json', store);
  assert.deepEqual(plan.summary, [{ key: Core.KEY, added: 1, skipped: 1 }]);
  Workspace.apply(plan, store);
  const merged = JSON.parse(store.getItem(Core.KEY));
  assert.deepEqual(merged.habits.map(item => [item.id, item.name]), [['a', 'Local name'], ['b', 'Habit b']]);
  assert.deepEqual(merged.checkins, { a: done(before, yesterday), b: done(today) });
  assert.equal(Workspace.prepare(JSON.stringify({ payload: { [Core.KEY]: file } }), 'json', store).summary[0].added, 0, 'importing again adds nothing');
  assert.ok(Workspace.backup(store).payload[Core.KEY]);
  for (const broken of [{ habits: [{ ...habit('c'), color: 'pink' }] }, { habits: [habit('c')], checkins: { d: done(today) } }, { habits: [habit('c'), habit('c')] }]) {
    assert.throws(() => Workspace.prepare(JSON.stringify({ payload: { [Core.KEY]: broken } }), 'json', store), Error);
  }
  const crowded = { habits: Array.from({ length: 50 }, (_, index) => habit(`n${index}`)) };
  assert.throws(() => Workspace.prepare(JSON.stringify({ payload: { [Core.KEY]: crowded } }), 'json', store), /Too many habits/);
});

test('the habits store is registered for account sync, backup and the public site', () => {
  const root = path.join(__dirname, '..');
  const theme = fs.readFileSync(path.join(root, 'theme.js'), 'utf8');
  const keys = theme.slice(theme.indexOf('const USER_SNAPSHOT_KEYS'), theme.indexOf('];', theme.indexOf('const USER_SNAPSHOT_KEYS')));
  assert.match(keys, /"dayfly-habits-v1"/);
  assert.match(theme, /"dayfly-habits-v1": "habits"/);
  assert.ok(require('../server/user-snapshot-store').ALLOWED_SNAPSHOT_KEYS.has(Core.KEY));
  const assets = require('../server/public-assets');
  for (const file of ['habits.html', 'habits.js', 'habits-core.js', 'habits.css']) assert.ok(assets.includes(file), file);
  for (const page of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, page), 'utf8'), tools = html.indexOf('<script src="workspace-tools-core.js">');
    if (tools < 0) continue;
    const core = html.indexOf('<script src="habits-core.js">');
    assert.ok(core >= 0 && core < tools, `${page} validates habit backups`);
  }
});
