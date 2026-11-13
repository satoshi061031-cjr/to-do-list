const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../notes-core');
const note = (id, extra = {}) => ({ id, title: `Note ${id}`, body: 'Keep a source and one next step.', createdAt: 1000, updatedAt: 1000, ...extra });

test('notes normalize bounded private content, safe sources and deduplicated typed relations', () => {
  const result = Core.normalize({ version: 99, credential: 'not portable', notes: [note('a', {
    tags: ['#work', 'work', '旅行', '', 'x'.repeat(60)],
    sourceUrl: 'https://example.com/article?q=one#section',
    links: [{ type: 'todo', id: 't1' }, { type: 'todo', id: 't1' }, { type: 'trip', id: 'p1' }, { type: 'unknown', id: 'p1' }, { type: 'todo', id: '__proto__' }],
    token: 'drop this',
  }), note('a'), { id: '__proto__', title: 'invalid' }] });
  assert.equal(result.version, 1); assert.equal(result.notes.length, 1); assert.equal(result.credential, undefined);
  assert.deepEqual(result.notes[0].links, [{ type: 'todo', id: 't1' }, { type: 'trip', id: 'p1' }]);
  assert.deepEqual(result.notes[0].tags, ['work', '旅行', 'x'.repeat(32)]);
  assert.equal(result.notes[0].token, undefined);
  assert.equal(result.notes[0].sourceUrl, 'https://example.com/article?q=one#section');
});

test('external source URLs only accept absolute http(s) without credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '/private', '//example.com', 'file:///etc/passwd', 'https://alice:secret@example.com', 'not a url']) assert.equal(Core.safeUrl(url), null, url);
  assert.equal(Core.safeUrl('http://example.com/a'), 'http://example.com/a');
  assert.equal(Core.safeUrl('https://example.com'), 'https://example.com/');
});

test('upsert retains creation time and stable identity while updating selected note only', () => {
  const state = Core.normalize({ notes: [note('a'), note('b')] });
  const updated = Core.upsert(state, note('a', { title: 'Changed', createdAt: 99999 }), 2000);
  assert.equal(updated.notes[0].createdAt, 1000); assert.equal(updated.notes[0].updatedAt, 2000);
  assert.equal(updated.notes[0].title, 'Changed'); assert.deepEqual(updated.notes[1], state.notes[1]);
  assert.equal(state.notes[0].title, 'Note a', 'Does not mutate its caller');
  assert.equal(Core.upsert(null, { id: 'new', body: 'A thought\nMore detail' }, 3000).notes[0].title, 'A thought');
  assert.throws(() => Core.upsert(state, { id: 'empty' }, 4000), /title or some text/);
});

test('large note additions fail without silently evicting existing private content', () => {
  assert.throws(() => Core.normalize({ notes: Array.from({ length: 101 }, (_, i) => note(`n${i}`)) }), error => error.code === 'NOTES_LIMIT');
  assert.throws(() => Core.normalize({ notes: Array.from({ length: 20 }, (_, i) => note(`n${i}`, { body: '汉'.repeat(10000) })) }), error => error.code === 'NOTES_SIZE');
  const state = Core.normalize({ notes: [note('a')] });
  assert.deepEqual(state.notes[0].body, 'Keep a source and one next step.');
});

test('relations are bidirectional queries over unchanged IDs, including deleted target IDs', () => {
  const state = { notes: [note('a', { links: [{ type: 'todo', id: 'task1' }] }), note('b', { links: [{ type: 'trip', id: 'trip1' }, { type: 'todo', id: 'task1' }] }), note('c')] };
  assert.deepEqual(Core.forEntity(state, { type: 'todo', id: 'task1' }).map(item => item.id), ['a', 'b']);
  assert.deepEqual(Core.forEntity(state, { type: 'trip', id: 'trip1' }).map(item => item.id), ['b']);
  assert.deepEqual(Core.forEntity(state, { type: 'unknown', id: 'task1' }), []);
  assert.equal(Core.href({ type: 'planner', id: 'a&b' }), 'planner.html?focus=card&id=a%26b');
  assert.equal(Core.href({ type: 'unknown', id: 'a' }), null);
});

test('Agent receives only explicitly selected saved notes with bounded content and source links', () => {
  const state = { notes: Array.from({ length: 7 }, (_, i) => note(`n${i}`, { body: 'x'.repeat(4000), sourceUrl: 'https://example.com' })) };
  assert.deepEqual(Core.context(state, []), []);
  const selected = Core.context(state, ['n3', 'n1', 'missing']);
  assert.deepEqual(selected.map(item => item.id), ['n1', 'n3']);
  assert.ok(selected.every(item => item.body.length === 3000 && item.href.startsWith('todo.html?focus=note&id=')));
  assert.equal(Core.context(state, state.notes.map(item => item.id)).length, 5);
});
