/**
 * Durable copy of connected mailboxes.
 *
 * Mailbox rows live in the server's SQLite file, which a host without a
 * persistent disk (for example Render's free plan) wipes on every redeploy or
 * sleep. Signed-in users then still have their session cookie but lose Mail.
 * When Supabase is configured, each user's rows are mirrored to
 * `mail_account_backups` (tokens stay sealed with the server's encryption key)
 * and restored the next time that user needs Mail. Without Supabase this is a
 * no-op.
 */
const { createClient } = require("@supabase/supabase-js");

function createMailAccountBackup({ exportRows, importRows, config, client, log = console } = {}) {
  const settings = config || {
    url: String(process.env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
  const supabase = client || (settings.url && settings.serviceRoleKey
    ? createClient(settings.url, settings.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null);
  const restored = new Set();
  const pending = new Map();
  let warned = false;

  function warn(error) {
    if (warned) return;
    warned = true;
    log.error?.(`Mailbox backup unavailable (${error?.message || error}). Run supabase/migrations/006_mail_account_backups.sql.`);
  }

  /** Mirror the user's current rows; an empty set removes the backup. */
  async function save(userId) {
    if (!supabase || !userId) return;
    const rows = exportRows(userId);
    const query = rows.length
      ? supabase.from("mail_account_backups").upsert({ user_id: userId, accounts: rows, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      : supabase.from("mail_account_backups").delete().eq("user_id", userId);
    const { error } = await query;
    if (error) throw error;
  }

  /** Coalesce bursts (a refresh right after a sign-in) into one write per user. */
  function scheduleSave(userId) {
    if (!supabase || !userId) return;
    restored.add(userId); // local rows are now the source of truth for this user
    clearTimeout(pending.get(userId));
    pending.set(userId, setTimeout(() => {
      pending.delete(userId);
      save(userId).catch(warn);
    }, 300));
  }

  /** Bring back a user's mailboxes when this server has none of them. */
  async function ensureRestored(userId) {
    if (!supabase || !userId || restored.has(userId)) return 0;
    restored.add(userId);
    if (exportRows(userId).length) return 0;
    try {
      const { data, error } = await supabase.from("mail_account_backups").select("accounts").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data?.accounts ? importRows(userId, data.accounts) : 0;
    } catch (error) {
      restored.delete(userId); // try again on the next request
      warn(error);
      return 0;
    }
  }

  return { configured: Boolean(supabase), scheduleSave, ensureRestored, save };
}

module.exports = { createMailAccountBackup };
