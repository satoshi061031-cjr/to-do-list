const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentLimiter } = require("../server/agent-limiter");

test("Agent budgets include guests, users, shared IPs, and all clients", () => {
  let time = 0;
  const limiter = createAgentLimiter({ now: () => time, clientLimit: 2, ipLimit: 3, totalLimit: 4 });
  const limited = fn => assert.throws(fn, e => e.statusCode === 429 && e.retryAfter > 0);
  limiter.acquire("a")();
  limiter.acquire("a")();
  limited(() => limiter.acquire("a"));
  limiter.acquire("a", "alice")();
  limited(() => limiter.acquire("a", "bob"));
  limiter.acquire("b", "bob")();
  limited(() => limiter.acquire("c", "carol"));
  time = 60_000;
  limiter.acquire("a")();
});

test("Agent concurrency slots release exactly once, including failed calls", () => {
  const limiter = createAgentLimiter({ concurrency: 1 });
  const release = limiter.acquire("a");
  assert.throws(() => limiter.acquire("b"), e => e.statusCode === 429);
  release(); release();
  const next = limiter.acquire("b");
  assert.throws(() => limiter.acquire("c"), e => e.statusCode === 429);
  next();
});

test("Agent limiter bounds memory for many client identities", () => {
  const limiter = createAgentLimiter({ maxClients: 3 });
  limiter.acquire("a")();
  assert.throws(() => limiter.acquire("b"), e => e.statusCode === 429);
});
