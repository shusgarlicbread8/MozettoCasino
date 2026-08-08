-- MC-051 — Player restriction overlays (no balance / stack edits).
-- Restrict new matchmaking, under-review flags, integrity-review routing only.

create table if not exists admin_player_ops (
  profile_id uuid primary key references profiles(id) on delete cascade,
  restrict_new_matchmaking boolean not null default false,
  under_review boolean not null default false,
  require_integrity_review boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists admin_player_ops_flags_idx
  on admin_player_ops (restrict_new_matchmaking, under_review, require_integrity_review)
  where restrict_new_matchmaking or under_review or require_integrity_review;

alter table admin_player_ops enable row level security;

-- API read/write for Control player risk surfaces (MC-050–051).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mozetto_api') then
    grant select, insert, update on admin_player_ops to mozetto_api;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on admin_player_ops to service_role;
  end if;
end $$;

-- Sensitive integrity tables — read-only for API (if roles exist).
-- Note: _wp110_grant_table is dropped at end of 030; use a local helper.
create or replace function _mc039_grant_table(
  p_role text,
  p_privs text,
  p_table text
) returns void
language plpgsql
as $$
begin
  if not exists (select 1 from pg_roles where rolname = p_role) then
    return;
  end if;
  if to_regclass(format('%I.%I', 'public', p_table)) is null then
    return;
  end if;
  execute format('grant %s on table public.%I to %I', p_privs, p_table, p_role);
exception
  when insufficient_privilege then
    null;
end;
$$;

select _mc039_grant_table('mozetto_api', 'select', t) from unnest(array[
  'collusion_signals',
  'integrity_cases',
  'rat_hole_exits',
  'admin_session_ops'
]) as t;

select _mc039_grant_table('mozetto_api', 'select, insert, update', 'admin_player_ops');

drop function if exists _mc039_grant_table(text, text, text);
