-- Durable copy of background reminders (push subscriptions and scheduled
-- reminder jobs), so a server whose local SQLite file is wiped (redeploy or
-- sleep without a persistent disk) keeps sending reminders. Only the server
-- (service role) reads or writes this table.
create table if not exists public.reminder_backups (
  user_id text primary key,
  subscriptions jsonb not null default '[]'::jsonb,
  jobs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reminder_backups enable row level security;
-- No policies: anon and authenticated roles get no access; the service role bypasses RLS.
