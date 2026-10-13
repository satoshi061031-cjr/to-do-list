// Process-wide limits apply to both Agent routes. Never trust client-supplied IP headers.
function createAgentLimiter({ now = Date.now, windowMs = 60_000, clientLimit = 20,
  ipLimit = 60, totalLimit = 100, concurrency = 4, maxClients = 10_000 } = {}) {
  const buckets = new Map();
  let active = 0;

  function reject(retryAfter) {
    throw Object.assign(new Error("Agent is busy. Please try again shortly."), {
      statusCode: 429, code: "AGENT_RATE_LIMITED", retryAfter,
    });
  }

  function acquire(ip, userId) {
    const timestamp = now();
    for (const [key, bucket] of buckets) {
      if (timestamp >= bucket.resetAt) buckets.delete(key);
    }
    if (active >= concurrency) reject(1);
    const rules = [
      ["global", totalLimit],
      [`ip:${ip || "unknown"}`, ipLimit],
      [userId ? `user:${userId}` : `guest:${ip || "unknown"}`, clientLimit],
    ];
    const missing = rules.filter(([key]) => !buckets.has(key)).length;
    if (buckets.size + missing > maxClients) reject(Math.ceil(windowMs / 1000));
    for (const [key, limit] of rules) {
      const bucket = buckets.get(key);
      if (bucket && bucket.count >= limit) {
        reject(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000)));
      }
    }
    for (const [key] of rules) {
      const bucket = buckets.get(key) || { count: 0, resetAt: timestamp + windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    active += 1;
    let released = false;
    return () => {
      if (!released) { active -= 1; released = true; }
    };
  }
  return { acquire };
}

module.exports = { createAgentLimiter };
