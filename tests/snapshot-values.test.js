const test = require("node:test");
const assert = require("node:assert/strict");
const { PREFIX, decodeValue, encodeValue, readStore, writeStore, decodePayload } = require("../server/snapshot-values");

test("large stores are gzip-compressed and decode back to the same text", () => {
  const big = JSON.stringify({ todos: Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, text: "Prepare the weekly review", notes: "", priority: "normal", sourceUrl: null, remindAt: null })) });
  const stored = encodeValue(big);
  assert.ok(stored.startsWith(PREFIX));
  assert.ok(stored.length < big.length / 5, `compressed ${stored.length} vs ${big.length}`);
  assert.equal(decodeValue(stored), big);
  assert.equal(encodeValue('{"small":true}'), '{"small":true}', "small stores stay plain JSON");
  assert.equal(encodeValue(big, { compress: false }), big);
});

test("readStore and writeStore accept plain and compressed values and keep other stores", () => {
  const plain = { "tally-book-v1": JSON.stringify({ records: [1] }), "todo-theme": "dark" };
  assert.deepEqual(readStore(plain, "tally-book-v1"), { records: [1] });
  const next = writeStore(plain, "tally-book-v1", { records: Array.from({ length: 400 }, (_, i) => ({ id: i, note: "coffee" })) });
  assert.ok(next["tally-book-v1"].startsWith(PREFIX));
  assert.equal(next["todo-theme"], "dark");
  assert.equal(readStore(next, "tally-book-v1").records.length, 400);
  assert.equal(readStore(next, "missing"), null);
  assert.equal(readStore({ bad: `${PREFIX}not-base64-gzip` }, "bad"), null);
  assert.equal(readStore({ bad: "{not json" }, "bad"), null);
  assert.deepEqual(Object.keys(decodePayload(next)).sort(), ["tally-book-v1", "todo-theme"]);
  assert.ok(!decodePayload(next)["tally-book-v1"].startsWith(PREFIX));
});
