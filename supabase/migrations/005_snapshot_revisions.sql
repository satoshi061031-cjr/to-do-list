-- Run after 001_user_snapshots.sql, before deploying the revision-aware server.
alter table public.user_snapshots
  add column if not exists revision bigint not null default 1;

create or replace function public.save_user_snapshot(
  p_user_id text, p_payload jsonb, p_base_revision bigint
) returns setof public.user_snapshots
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'base revision must be nonnegative';
  end if;
  if p_base_revision = 0 then
    return query
      insert into public.user_snapshots (user_id, payload, updated_at, revision)
      values (p_user_id, p_payload, clock_timestamp(), 1)
      on conflict (user_id) do nothing
      returning *;
  else
    return query
      update public.user_snapshots
      set payload = p_payload, updated_at = clock_timestamp(), revision = revision + 1
      where user_id = p_user_id and revision = p_base_revision
      returning *;
  end if;
end;
$$;

revoke all on function public.save_user_snapshot(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_user_snapshot(text, jsonb, bigint) to service_role;
