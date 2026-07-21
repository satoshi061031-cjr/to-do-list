create table if not exists public.notifications (
  id text primary key,
  user_id text not null,
  type text not null,
  title text not null,
  body text not null default '',
  entity_type text,
  entity_id text,
  meta_json text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, read_at);

alter table public.notifications enable row level security;
