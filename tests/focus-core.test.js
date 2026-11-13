const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../focus-core');
const task = { id: 'one', text: 'Prepare the trip', completed: false };
const startTime = new Date(2026, 10, 9, 10, 0).getTime();

test('focus resumes after reload using elapsed timestamps, caps at the target, and finishes once', () => {
  const initial = Core.defaults();
  const running = Core.start(initial, task, 1500000, startTime, 'first-session');
  assert.equal(initial.active, null, 'Starting does not mutate the previous saved state');
  assert.equal(Core.elapsed(Core.normalize(JSON.parse(JSON.stringify(running)), startTime + 600000).active, startTime + 600000), 600000);
  assert.equal(Core.elapsed(running.active, startTime + 2 * 3600000), 1500000);
  const result = Core.finish(running, startTime + 2 * 3600000);
  assert.equal(result.state.active, null);
  assert.equal(result.session.durationMs, 1500000);
  assert.equal(result.session.endedAt, startTime + 1500000, 'Returning late does not extend a 25-minute session');
  assert.equal(result.session.id, 'first-session');
  assert.equal(Core.finish(result.state, startTime + 3 * 3600000).state.sessions.length, 1);
});

test('pauses exclude idle time and survive reload without an interval-based clock', () => {
  const running = Core.start(null, task, 3000000, startTime, 'pause-session');
  const paused = Core.pause(running, startTime + 300000);
  assert.equal(paused.active.resumedAt, null);
  assert.equal(Core.elapsed(paused.active, startTime + 5 * 3600000), 300000);
  const restored = Core.normalize(JSON.parse(JSON.stringify(paused)), startTime + 5 * 3600000);
  const resumed = Core.resume(restored, startTime + 5 * 3600000);
  const ended = Core.finish(resumed, startTime + 5 * 3600000 + 120000);
  assert.equal(ended.session.durationMs, 420000);
  assert.equal(ended.session.dayTotals.reduce((sum, item) => sum + item.durationMs, 0), 420000);
});

test('focus spanning a week boundary allocates actual time to each week', () => {
  const sunday = new Date(2026, 10, 8, 23, 50).getTime();
  const session = Core.finish(Core.start(null, task, 0, sunday, 'overnight'), sunday + 20 * 60000).state;
  const now = sunday + 60 * 60000;
  const previous = Core.review([], session, { start: '2026-11-02', end: '2026-11-08' }, now);
  const current = Core.review([], session, { start: '2026-11-09', end: '2026-11-15' }, now);
  assert.equal(previous.focusMs, 10 * 60000);
  assert.equal(current.focusMs, 10 * 60000);
  assert.equal(previous.focusMs + current.focusMs, session.sessions[0].durationMs);
});

test('a paused interval across midnight adds no focus to the paused day', () => {
  const sunday = new Date(2026, 10, 8, 23, 40).getTime();
  const monday = new Date(2026, 10, 9, 8).getTime();
  const paused = Core.pause(Core.start(null, task, 0, sunday, 'night-pause'), sunday + 5 * 60000);
  const done = Core.finish(Core.resume(paused, monday), monday + 5 * 60000);
  assert.deepEqual(done.session.dayTotals, [{ date: '2026-11-08', durationMs: 5 * 60000 }, { date: '2026-11-09', durationMs: 5 * 60000 }]);
});

test('weekly completion uses actual timestamps and excludes legacy undated completions', () => {
  const now = startTime + 60000, old = new Date(2026, 10, 1, 10).getTime();
  const tasks = [
    { id: 'finished', completed: true, completedAt: startTime },
    { id: 'legacy', completed: true },
    { id: 'old', completed: true, completedAt: old },
    { id: 'reopened', completed: false, completedAt: startTime },
    { id: 'overdue', completed: false, dueDate: '2026-11-01' },
    { id: 'inbox', completed: false, inbox: true },
  ];
  const review = Core.review(tasks, null, { start: '2026-11-09', end: '2026-11-15' }, now);
  assert.deepEqual(review.completedTasks.map(item => item.id), ['finished']);
  assert.deepEqual(review.overdueTasks.map(item => item.id), ['overdue']);
  assert.equal(review.inboxCount, 1);
  assert.equal(review.legacyCompletedCount, 1);
  assert.throws(() => Core.review([], null, { start: '2026-02-30', end: '2026-11-15' }), /valid review/);
});

test('sessions are bounded, deduplicated and reject invalid dates and identities', () => {
  const sessions = Array.from({ length: 250 }, (_, index) => ({ id: `session-${index}`, taskId: 'one', taskTitle: 'Read', startedAt: startTime + index * 1000, endedAt: startTime + index * 1000 + 100, durationMs: 100, targetMs: 0 }));
  const normalized = Core.normalize({ sessions: [sessions[0], ...sessions, { ...sessions.at(-1) }, { ...sessions[0], id: '__proto__' }, { ...sessions[0], id: 'future', endedAt: startTime + 86400000 }] }, startTime + 300000);
  assert.equal(normalized.sessions.length, Core.MAX_SESSIONS);
  assert.equal(new Set(normalized.sessions.map(item => item.id)).size, Core.MAX_SESSIONS);
  assert.equal(normalized.sessions[0].id, 'session-50');
  assert.equal(normalized.sessions.some(item => item.id === 'future'), false);
  const invalid = { id: 'malformed', taskId: 'one', startedAt: startTime, endedAt: startTime + 1000, durationMs: 10000000, dayTotals: [{ date: '2026-02-30', durationMs: 1000 }] };
  const session = Core.normalize({ sessions: [invalid] }, startTime + 1000).sessions[0];
  assert.equal(session.durationMs, 1000);
  assert.deepEqual(session.dayTotals, [{ date: Core.localDate(startTime), durationMs: 1000 }]);
});

test('completed session IDs cannot also resume as active and free focus stops at twelve hours', () => {
  const running = Core.start(null, task, 0, startTime, 'same');
  assert.equal(Core.elapsed(running.active, startTime + 7 * 86400000), Core.MAX_DURATION);
  const ended = Core.finish(running, startTime + 7 * 86400000);
  assert.equal(ended.session.durationMs, Core.MAX_DURATION);
  assert.equal(ended.session.endedAt, startTime + Core.MAX_DURATION);
  assert.equal(Core.normalize({ ...ended.state, active: running.active }, startTime + 7 * 86400000).active, null);
});

test('focus start requires a valid unfinished task and supported duration', () => {
  assert.throws(() => Core.start(null, { ...task, completed: true }, 0, startTime), /unfinished/);
  assert.throws(() => Core.start(null, { ...task, id: '__proto__' }, 0, startTime), /unfinished/);
  assert.throws(() => Core.start(null, task, 1000, startTime), /25 minutes/);
  const state = Core.start(null, task, 0, startTime, 'running');
  assert.throws(() => Core.start(state, task, 0, startTime + 1000), /current focus/);
  assert.equal(Core.pause(state, startTime + 1000).active.elapsedMs, 1000);
});

test('week navigation starts on local Monday and advances by calendar days', () => {
  assert.deepEqual(Core.weekBounds(new Date(2026, 10, 15, 12).getTime()), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(Core.weekBounds(new Date(2026, 10, 9, 12).getTime(), -1), { start: '2026-11-02', end: '2026-11-08' });
});
