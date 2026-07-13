create table if not exists public.user_snapshots (
  user_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_snapshots enable row level security;

revoke all on table public.user_snapshots from anon, authenticated;
grant all on table public.user_snapshots to service_role;

comment on table public.user_snapshots is
  'Daily Space workspace snapshots. Access is restricted to the trusted backend service role.';
