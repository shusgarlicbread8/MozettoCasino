-- MC-062–065 / MC-075: Control runtime overlays (session drain, city pause/drain, AI flags).
-- No balance/stack authority — operational gates only.

alter table admin_session_ops
  add column if not exists disable_new_seats boolean not null default false;

create table if not exists admin_city_ops (
  league_id text primary key,
  pause_matchmaking boolean not null default false,
  drain boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists admin_city_ops_flags_idx
  on admin_city_ops (pause_matchmaking, drain)
  where pause_matchmaking or drain;

alter table admin_city_ops enable row level security;

insert into feature_flags (key, enabled, meta) values
  ('ai_provider_groq', true, '{"note":"MC-075: when false, new Groq decisions fail closed to deterministic fallback"}'::jsonb),
  ('ai_new_sessions', true, '{"note":"MC-075: when false, block seating new AI-controlled sessions"}'::jsonb)
on conflict (key) do nothing;

create or replace function _mc042_grant_table(
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

select _mc042_grant_table('mozetto_api', 'select, insert, update', 'admin_city_ops');
select _mc042_grant_table('mozetto_api', 'select, insert, update', 'admin_session_ops');
select _mc042_grant_table('mozetto_api', 'select, update', 'feature_flags');
select _mc042_grant_table('mozetto_game', 'select', 'admin_session_ops');
select _mc042_grant_table('mozetto_game', 'select', 'admin_city_ops');
select _mc042_grant_table('mozetto_agent', 'select', 'feature_flags');

drop function if exists _mc042_grant_table(text, text, text);

comment on table admin_city_ops is
  'Control city/league runtime gates — pause/drain new matchmaking only (MC-063).';
comment on column admin_session_ops.disable_new_seats is
  'When true, refuse new joins; current hand continues (MC-063 drain table).';
