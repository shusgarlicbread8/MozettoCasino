-- MC-092 — Governance proposal archive (metadata + hashes; no private keys).

create table if not exists governance_proposals (
  id uuid primary key default gen_random_uuid(),
  creator_wallet text,
  creator_principal_id uuid references admin_principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  action_id text not null,
  action_type text not null,
  parameters jsonb not null default '{}'::jsonb,
  target_address text,
  chain_id integer not null,
  proposal_mode text not null default 'direct'
    check (proposal_mode in ('direct', 'timelockController')),
  calldata_hash text not null,
  safe_json_hash text not null,
  simulation_result jsonb,
  incident_id text,
  change_ticket text,
  status text not null default 'prepared'
    check (status in (
      'prepared', 'exported', 'submitted', 'executed', 'verified', 'failed', 'cancelled'
    )),
  execution_tx_hash text,
  post_verification jsonb,
  preview jsonb,
  safe_tx_builder jsonb,
  notes jsonb not null default '[]'::jsonb
);

create index if not exists governance_proposals_created_idx
  on governance_proposals (created_at desc);

create index if not exists governance_proposals_status_idx
  on governance_proposals (status, created_at desc);

create index if not exists governance_proposals_action_idx
  on governance_proposals (action_id, created_at desc);

alter table governance_proposals enable row level security;

create or replace function _mc040_grant_table(
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

select _mc040_grant_table('mozetto_api', 'select, insert, update', 'governance_proposals');
select _mc040_grant_table('mozetto_api', 'select, update', 'admin_principals');
select _mc040_grant_table('mozetto_api', 'select, update', 'admin_sessions');

drop function if exists _mc040_grant_table(text, text, text);

comment on table governance_proposals is
  'Mozetto Control governance proposal archive — hashes + metadata only; MC-092.';
