const crypto = require('node:crypto');
const webPush = require('web-push');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch (_) { fail('Invalid push subscription.'); }
  // Browser-owned push services only. Never accept an arbitrary network destination.
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'updates-autopush.stage.mozaws.net', 'web.push.apple.com', 'wns.windows.com'];
  if (url.href.length > 4096 || url.protocol !== 'https:' || url.port || url.username || url.password || !allowed.some(host => url.hostname === host || (host === 'wns.windows.com' && url.hostname.endsWith('.wns.windows.com')))) fail('Unsupported push service.');
  const key = value?.keys;
  if (!key || !/^[\w-]{87}$/.test(key.p256dh) || !/^[\w-]{22}$/.test(key.auth)) fail('Invalid push encryption keys.');
  try { crypto.ECDH.convertKey(Buffer.from(key.p256dh, 'base64url'), 'prime256v1'); } catch (_) { fail('Invalid push public key.'); }
  return { endpoint: url.href, keys: { p256dh: key.p256dh, auth: key.auth } };
}
function nextMorning(now, timeZone) {
  // Calendar-day arithmetic across DST, rather than adding a fixed 24 hours.
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = epoch => Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(p => [p.type, p.value]));
  const today = parts(now);
  const target = new Date(Date.UTC(+today.year, +today.month - 1, +today.day + 1, 9));
  let epoch = target.getTime();
  for (let i = 0; i < 4; i++) { const p = parts(epoch); const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); epoch += target.getTime() - wall; }
  return epoch;
}
function createReminderStore(db, options = {}) {
  const now = options.now || Date.now;
  // Called with an owner whenever that owner's subscriptions or jobs change (used for the durable backup).
  const changed = typeof options.onChange === 'function' ? owner => { try { options.onChange(owner); } catch (_) { /* backup is best effort */ } } : () => {};
  const publicKey = options.publicKey ?? process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = options.privateKey ?? process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = options.subject ?? process.env.VAPID_SUBJECT ?? '';
  let configured = Boolean(publicKey && privateKey && subject);
  if (configured) { try { webPush.getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm');
    const pair = crypto.createECDH('prime256v1'); pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (!pair.getPublicKey().equals(Buffer.from(publicKey, 'base64url'))) throw new Error('Mismatched VAPID key pair.'); } catch (_) { configured = false; } }
  const deliver = options.send || ((subscription, payload) => webPush.sendNotification(subscription, payload, {
    vapidDetails: { subject, publicKey, privateKey }, TTL: 300, timeout: 10000,
  }));
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS push_owner ON push_subscriptions(owner);
    CREATE TABLE IF NOT EXISTS reminder_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, fingerprint TEXT NOT NULL, title TEXT NOT NULL, href TEXT NOT NULL, timezone TEXT NOT NULL, due INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, retry INTEGER NOT NULL DEFAULT 0, token_hash TEXT, updated INTEGER NOT NULL, UNIQUE(owner, source));
    CREATE INDEX IF NOT EXISTS reminder_due ON reminder_jobs(state, due, retry);`);
  // A crashed worker may leave an in-flight job; reclaim on the next process start.
  db.prepare("UPDATE reminder_jobs SET state='pending' WHERE state='sending'").run();
  function subscribe(owner, raw) {
    if (!configured) fail('Background reminders are not configured on this server.', 503);
    const subscription = validateSubscription(raw);
    const existing = db.prepare('SELECT owner FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);
    if (existing && existing.owner !== owner) fail('This device subscription belongs to another account. Disable it before switching accounts.', 409);
    if (!existing && db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner=?').get(owner).n >= 10) fail('Too many reminder devices.', 429);
    db.prepare('INSERT INTO push_subscriptions(endpoint,owner,payload,updated) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').run(subscription.endpoint, owner, JSON.stringify(subscription), now());
    changed(owner);
    return subscription.endpoint;
  }
  function unsubscribe(owner, endpoint) { db.prepare('DELETE FROM push_subscriptions WHERE owner=? AND endpoint=?').run(owner, String(endpoint || '')); changed(owner); }
  function revokeOwner(owner) { db.prepare('DELETE FROM push_subscriptions WHERE owner=?').run(owner); db.prepare('DELETE FROM reminder_jobs WHERE owner=?').run(owner); changed(owner); }
  function sync(owner, rawJobs) {
    if (!Array.isArray(rawJobs) || rawJobs.length > 500) fail('At most 500 reminder jobs are allowed.');
    const jobs = rawJobs.map(raw => {
      if (!raw || !/^(todo|reminder):.{1,200}$/.test(raw.source || '') || !Number.isSafeInteger(raw.dueAt) || raw.dueAt < now() - 86400000 || raw.dueAt > now() + 366 * 86400000) fail('Invalid reminder schedule.');
      const title = String(raw.title || '').trim().slice(0, 160); if (!title) fail('Reminder title is required.');
      const url = new URL(String(raw.href || ''), 'https://daily-space.invalid/');
      if (url.origin !== 'https://daily-space.invalid' || !['/todo.html','/calendar.html'].includes(url.pathname)) fail('Invalid reminder link.');
      const timezone = String(raw.timeZone || 'UTC'); try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch (_) { fail('Invalid time zone.'); }
      const href = url.pathname.slice(1) + url.search;
      return { source: raw.source, title, href, timezone, due: raw.dueAt, fingerprint: hash(JSON.stringify([raw.dueAt, title, href, timezone])) };
    });
    if (new Set(jobs.map(job => job.source)).size !== jobs.length) fail('Duplicate reminder source.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const keep = new Set(jobs.map(job => job.source));
      db.prepare('SELECT source FROM reminder_jobs WHERE owner=?').all(owner).forEach(job => { if (!keep.has(job.source)) db.prepare('DELETE FROM reminder_jobs WHERE owner=? AND source=?').run(owner, job.source); });
      for (const job of jobs) {
        // Matching source fingerprints preserve delivered/snoozed state across tabs and reloads.
        db.prepare(`INSERT INTO reminder_jobs(id,owner,source,fingerprint,title,href,timezone,due,updated) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(owner,source) DO UPDATE SET fingerprint=excluded.fingerprint,title=excluded.title,href=excluded.href,timezone=excluded.timezone,due=excluded.due,state='pending',attempts=0,retry=0,token_hash=NULL,updated=excluded.updated WHERE reminder_jobs.fingerprint<>excluded.fingerprint`).run(crypto.randomUUID(), owner, job.source, job.fingerprint, job.title, job.href, job.timezone, job.due, now());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(owner);
    return jobs.length;
  }
  function defer(id, token, action) {
    if (!['snooze', 'tomorrow'].includes(action) || typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) fail('Invalid reminder action.');
    const job = db.prepare("SELECT * FROM reminder_jobs WHERE id=? AND state='delivered'").get(String(id || ''));
    if (!job?.token_hash || !crypto.timingSafeEqual(Buffer.from(job.token_hash), Buffer.from(hash(token)))) fail('This reminder is no longer available.', 410);
    const due = action === 'snooze' ? now() + 600000 : nextMorning(now(), job.timezone);
    db.prepare("UPDATE reminder_jobs SET due=?,state='pending',attempts=0,retry=0,token_hash=NULL,updated=? WHERE id=?").run(due, now(), job.id);
    changed(job.owner);
    return due;
  }
  let running = false;
  async function tick() {
    if (!configured || running) return { sent: 0, skipped: true };
    running = true;
    const touched = new Set();
    let delivered = 0;
    try {
      db.prepare('DELETE FROM reminder_jobs WHERE due<?').run(now() - 86400000);
      const jobs = db.prepare("SELECT * FROM reminder_jobs WHERE state='pending' AND due<=? AND retry<=? LIMIT 50").all(now(), now());
      for (const job of jobs) {
        const subscriptions = db.prepare('SELECT endpoint,payload FROM push_subscriptions WHERE owner=?').all(job.owner);
        if (!subscriptions.length) continue;
        const token = crypto.randomBytes(32).toString('base64url');
        db.prepare("UPDATE reminder_jobs SET state='sending',token_hash=? WHERE id=? AND state='pending'").run(hash(token), job.id);
        let sent = false;
        for (const subscription of subscriptions) {
          try {
            await deliver(JSON.parse(subscription.payload), JSON.stringify({ title: 'dayfly', body: job.title, tag: `reminder-${job.id}`, data: { href: job.href, jobId: job.id, token } })); sent = true;
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(subscription.endpoint);
          }
        }
        // Completion/deletion/rescheduling during the send must win over a late response.
        db.prepare("UPDATE reminder_jobs SET state=?,attempts=attempts+1,retry=?,updated=? WHERE id=? AND state='sending' AND token_hash=?").run(sent ? 'delivered' : job.attempts >= 2 ? 'failed' : 'pending', now() + 60000 * 2 ** job.attempts, now(), job.id, hash(token));
        touched.add(job.owner);
        if (sent) delivered += 1;
      }
    } finally { running = false; touched.forEach(changed); }
    return { sent: delivered };
  }
  /** One owner's rows, for the durable backup. */
  function exportOwner(owner) {
    return {
      subscriptions: db.prepare('SELECT endpoint,payload,updated FROM push_subscriptions WHERE owner=?').all(owner),
      jobs: db.prepare('SELECT id,source,fingerprint,title,href,timezone,due,state,attempts,retry,token_hash,updated FROM reminder_jobs WHERE owner=?').all(owner),
    };
  }
  /** Bring back an owner's rows; rows that already exist here win. Returns how many rows were added. */
  function importOwner(owner, data) {
    let added = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of Array.isArray(data?.subscriptions) ? data.subscriptions.slice(0, 10) : []) {
        let subscription;
        try { subscription = validateSubscription(JSON.parse(row.payload)); } catch (_) { continue; }
        added += db.prepare('INSERT OR IGNORE INTO push_subscriptions(endpoint,owner,payload,updated) VALUES(?,?,?,?)').run(subscription.endpoint, owner, JSON.stringify(subscription), Number(row.updated) || now()).changes;
      }
      for (const row of Array.isArray(data?.jobs) ? data.jobs.slice(0, 500) : []) {
        if (!row || typeof row.id !== 'string' || !/^(todo|reminder):/.test(row.source || '') || !Number.isSafeInteger(row.due)) continue;
        // A send interrupted by the wipe is retried rather than lost.
        const state = ['pending', 'delivered', 'failed'].includes(row.state) ? row.state : 'pending';
        added += db.prepare(`INSERT OR IGNORE INTO reminder_jobs(id,owner,source,fingerprint,title,href,timezone,due,state,attempts,retry,token_hash,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(row.id, owner, row.source, String(row.fingerprint || ''), String(row.title || '').slice(0, 160), String(row.href || 'todo.html'), String(row.timezone || 'UTC'), row.due, state, Number(row.attempts) || 0, Number(row.retry) || 0, typeof row.token_hash === 'string' ? row.token_hash : null, Number(row.updated) || now()).changes;
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return added;
  }
  const hasOwnerRows = owner => Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE owner=? UNION ALL SELECT 1 FROM reminder_jobs WHERE owner=? LIMIT 1').get(owner, owner));
  return { configured, publicKey: configured ? publicKey : '', subscribe, unsubscribe, sync, defer, revokeOwner, tick, exportOwner, importOwner, hasOwnerRows,
    status: (owner, endpoint) => ({ configured, publicKey: configured ? publicKey : '', enabled: Boolean(owner && db.prepare('SELECT 1 FROM push_subscriptions WHERE owner=? AND endpoint=?').get(owner, String(endpoint || ''))) }),
  };
}
module.exports = { createReminderStore, validateSubscription, nextMorning };
