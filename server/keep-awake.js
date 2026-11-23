/**
 * Keep a sleeping free-plan server awake so background reminders go out on time.
 *
 * Render's free plan stops a service after 15 minutes without inbound traffic,
 * and the reminder scheduler stops with it. A request to the service's own
 * public address goes out through Render's edge and back in, so it counts as
 * traffic. Render sets RENDER_EXTERNAL_URL automatically; KEEP_AWAKE_URL
 * overrides it for other hosts. KEEP_AWAKE=off disables the ping.
 *
 * It only runs when push reminders are configured: there is nothing to keep
 * awake for otherwise, and a free plan's monthly hours are limited.
 */
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

function keepAwakeUrl(env = process.env) {
  if (/^(0|false|off|no)$/i.test(String(env.KEEP_AWAKE || "").trim())) return null;
  const raw = String(env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch (_) { return null; }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password) return null;
  return new URL("/api/health", url.origin).href;
}

function createKeepAwake({ env = process.env, enabled = true, intervalMs = DEFAULT_INTERVAL_MS, fetchImpl = fetch, log = console } = {}) {
  const target = enabled ? keepAwakeUrl(env) : null;
  let timer = null;
  let failures = 0;

  async function ping() {
    try {
      const response = await fetchImpl(target, { headers: { "User-Agent": "dayfly-keep-awake" }, signal: AbortSignal.timeout(15_000) });
      failures = response.ok ? 0 : failures + 1;
    } catch (_) {
      failures += 1;
    }
    // One line after repeated failures, so a wrong URL is visible in the logs without flooding them.
    if (failures === 3) log.error?.(`Keep-awake ping to ${target} keeps failing; check RENDER_EXTERNAL_URL or KEEP_AWAKE_URL.`);
    return failures === 0;
  }

  function start() {
    if (!target || timer) return false;
    timer = setInterval(ping, intervalMs);
    timer.unref?.();
    log.info?.(`Keeping the server awake for reminders (${target} every ${Math.round(intervalMs / 60000)} min).`);
    return true;
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { target, start, stop, ping };
}

module.exports = { createKeepAwake, keepAwakeUrl };
