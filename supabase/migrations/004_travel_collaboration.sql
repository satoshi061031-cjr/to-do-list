create table if not exists public.travel_trips (
  id text primary key,
  owner_user_id text not null,
  title text not null,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.travel_trip_members (
  trip_id text not null references public.travel_trips(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner', 'editor')),
  label text,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.travel_stops (
  id text primary key,
  trip_id text not null references public.travel_trips(id) on delete cascade,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.travel_reservations (
  id text primary key,
  trip_id text not null references public.travel_trips(id) on delete cascade,
  source_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, source_id)
);

create table if not exists public.travel_invites (
  id text primary key,
  trip_id text not null references public.travel_trips(id) on delete cascade,
  token_hash text not null unique,
  invite_type text not null check (invite_type in ('one_time', 'reusable')),
  email text,
  created_by text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  accepted_at timestamptz,
  check (invite_type <> 'reusable' or email is null)
);

create index if not exists idx_travel_members_user
  on public.travel_trip_members(user_id, trip_id);
create index if not exists idx_travel_stops_trip
  on public.travel_stops(trip_id, position);
create index if not exists idx_travel_reservations_trip
  on public.travel_reservations(trip_id);
create index if not exists idx_travel_invites_trip
  on public.travel_invites(trip_id, created_at desc);
create index if not exists idx_travel_invites_token
  on public.travel_invites(token_hash);

alter table public.travel_trips enable row level security;
alter table public.travel_trip_members enable row level security;
alter table public.travel_stops enable row level security;
alter table public.travel_reservations enable row level security;
alter table public.travel_invites enable row level security;

revoke all on table public.travel_trips from anon, authenticated;
revoke all on table public.travel_trip_members from anon, authenticated;
revoke all on table public.travel_stops from anon, authenticated;
revoke all on table public.travel_reservations from anon, authenticated;
revoke all on table public.travel_invites from anon, authenticated;

grant all on table public.travel_trips to service_role;
grant all on table public.travel_trip_members to service_role;
grant all on table public.travel_stops to service_role;
grant all on table public.travel_reservations to service_role;
grant all on table public.travel_invites to service_role;

comment on table public.travel_trips is
  'Shared Travel collaboration records. The current runtime uses the SQLite store; this schema is the service-role seam for a future Supabase adapter.';
comment on column public.travel_invites.token_hash is
  'SHA-256 hash only. Raw high-entropy invite tokens are returned once and never persisted.';
