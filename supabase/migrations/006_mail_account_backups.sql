-- Durable copy of connected mailboxes, so a server whose local SQLite file is
-- wiped (redeploy or sleep without a persistent disk) can restore Mail without
-- asking the user to reconnect. Tokens are stored already sealed (AES-GCM) with
-- the server's MAIL_TOKEN_ENCRYPTION_KEY; only the server (service role) reads
-- or writes this table.
create table if not exists public.mail_account_backups (
  user_id text primary key,
  accounts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.mail_account_backups enable row level security;
-- No policies: anon and authenticated roles get no access; the service role bypasses RLS.
