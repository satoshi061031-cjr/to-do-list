create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  owner_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id text not null,
  role text not null,
  status text not null,
  label text,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  invited_by text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists idx_workspace_members_user
  on public.workspace_members(user_id, status);
create index if not exists idx_workspace_invites_token
  on public.workspace_invites(token);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.workspace_invites from anon, authenticated;
grant all on table public.workspaces to service_role;
grant all on table public.workspace_members to service_role;
grant all on table public.workspace_invites to service_role;

comment on table public.workspaces is
  'Daily Space shared workspaces. Accessed only via trusted backend service role.';

create table if not exists public.boards (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_columns (
  id text primary key,
  board_id text not null references public.boards(id) on delete cascade,
  title text not null,
  emoji text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_tasks (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  board_id text not null references public.boards(id) on delete cascade,
  column_id text not null references public.board_columns(id) on delete cascade,
  title text not null,
  note text,
  assignee_user_id text,
  due_date text,
  completed boolean not null default false,
  position integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boards_workspace on public.boards(workspace_id);
create index if not exists idx_board_columns_board on public.board_columns(board_id, position);
create index if not exists idx_board_tasks_board on public.board_tasks(board_id, column_id, position);
create index if not exists idx_board_tasks_assignee on public.board_tasks(assignee_user_id, completed);

alter table public.boards enable row level security;
alter table public.board_columns enable row level security;
alter table public.board_tasks enable row level security;

revoke all on table public.boards from anon, authenticated;
revoke all on table public.board_columns from anon, authenticated;
revoke all on table public.board_tasks from anon, authenticated;
grant all on table public.boards to service_role;
grant all on table public.board_columns to service_role;
grant all on table public.board_tasks to service_role;
