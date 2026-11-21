/**
 * Durable copy of background reminders.
 *
 * Push subscriptions and scheduled reminder jobs live in the server's SQLite
 * file, which a host without a persistent disk (for example Render's free
 * plan) wipes on every redeploy. Without a copy, every device silently stops
 * getting reminders: the browser sees its subscription is unknown and drops it.
 *
 * When Supabase is configured, each owner's rows are mirrored to
 * `reminder_backups`. Every owner is restored when the server starts, before
 * the scheduler or any reminder request runs, because reminders must fire even
 * if nobody opens the app. Without Supabase this is a no-op.
 */
const { createClient } = require("@supabase/supabase-js");

const TABLE = "reminder_backups";
const PAGE = 500;

function createReminderBackup({ store, config, client, log = console, delayMs = 500 } = {}) {
  const settings = config || {
    url: String(process.env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
  const supabase = client || (settings.url && settings.serviceRoleKey
    ? createClient(settings.url, settings.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null);
  const pending = new Map();
  let warned = false;

  function warn(error) {
    if (warned) return;
    warned = true;
    log.error?.(`Reminder backup unavailable (${error?.message || error}). Run supabase/migrations/007_reminder_backups.sql.`);
  }

  async function save(owner) {
    if (!supabase || !owner || !store) return;
    const rows = store.exportOwner(owner);
    const query = rows.subscriptions.length || rows.jobs.length
      ? supabase.from(TABLE).upsert({ user_id: owner, subscriptions: rows.subscriptions, jobs: rows.jobs, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      : supabase.from(TABLE).delete().eq("user_id", owner);
    const { error } = await query;
    if (error) throw error;
  }

  /** Coalesce bursts (a sync right after a subscribe, a tick sending several jobs) into one write. */
  function scheduleSave(owner) {
    if (!supabase || !owner) return;
    clearTimeout(pending.get(owner));
    const timer = setTimeout(() => {
      pending.delete(owner);
      save(owner).catch(warn);
    }, delayMs);
    timer.unref?.();
    pending.set(owner, timer);
  }

  /** Write every queued owner now (used before the process exits). */
  async function flush() {
    const owners = [...pending.keys()];
    owners.forEach((owner) => { clearTimeout(pending.get(owner)); pending.delete(owner); });
    await Promise.all(owners.map((owner) => save(owner).catch(warn)));
  }

  /** Restore every owner this server has no rows for. Resolves with how many owners were restored. */
  async function restoreAll() {
    if (!supabase || !store) return 0;
    let restored = 0;
    try {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(TABLE).select("user_id,subscriptions,jobs").order("user_id").range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data || []) {
          if (!row?.user_id || store.hasOwnerRows(row.user_id)) continue;
          if (store.importOwner(row.user_id, row) > 0) restored += 1;
        }
        if (!data || data.length < PAGE) break;
      }
    } catch (error) {
      warn(error);
    }
    if (restored) log.info?.(`Restored background reminders for ${restored} account(s).`);
    return restored;
  }

  return { configured: Boolean(supabase), scheduleSave, save, flush, restoreAll };
}

module.exports = { createReminderBackup };
