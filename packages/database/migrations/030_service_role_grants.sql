-- WP-110 — Per-service Postgres roles + least-privilege GRANTs.
-- Idempotent: creates NOLOGIN roles when missing; GRANTs only when role + table exist.
-- Roles get BYPASSRLS so deny-by-default RLS tables remain reachable without
-- inventing permissive anon policies. Application secrets still use DATABASE_URL;
-- SET ROLE / dedicated DSNs are an ops follow-up.

create or replace function _wp110_grant_table(
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

do $$
declare
  r text;
  roles text[] := array[
    'mozetto_api',
    'mozetto_game',
    'mozetto_agent',
    'mozetto_dealer',
    'mozetto_indexer',
    'mozetto_worker',
    'mozetto_verifier'
  ];
begin
  foreach r in array roles loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
    begin
      execute format('alter role %I bypassrls', r);
    exception
      when insufficient_privilege then
        null;
    end;
    execute format('grant usage on schema public to %I', r);
  end loop;
end $$;

-- API: identity / matchmaking / verify / admin coordination
select _wp110_grant_table('mozetto_api', 'select', t) from unnest(array[
  'protocol_versions','protocol_artifacts','game_template_manifests','engine_builds',
  'model_policy_versions','energy_policy_versions','profile_set_versions',
  'onchain_sessions','onchain_session_players','session_state_transitions',
  'table_epochs','queued_seat_changes',
  'verification_packages','verification_artifacts','public_replay_manifests',
  'watchtower_reports','verification_status_history',
  'proof_batches','proof_batch_inclusion_proofs',
  'matchmaking_intents','matchmaking_batches','pairing_history',
  'identity_clusters','identity_cluster_edges','matchmaking_exclusions',
  'account_ratings','rated_matches','rating_history',
  'feature_flags','admin_roles','admin_actions','security_incidents',
  'vault_balance_snapshots','reconciliation_runs','reconciliation_differences',
  'seat_tickets','arena_accounts'
]) as t;

select _wp110_grant_table('mozetto_api', 'select, insert, update', t) from unnest(array[
  'matchmaking_intents','admin_actions','security_incidents','verification_status_history'
]) as t;

-- Game / table actor
select _wp110_grant_table('mozetto_game', 'select, insert, update', t) from unnest(array[
  'hand_events','canonical_game_events','public_event_payloads',
  'private_payload_ciphertexts','event_persistence_outbox',
  'tables','table_seats','table_epochs','queued_seat_changes',
  'hand_snapshots','table_snapshots','state_divergence_alerts',
  'session_state_transitions','session_controller_commitments',
  'opening_balance_leaves','hand_roots','balance_leaves','session_checkpoints',
  'onchain_sessions','onchain_session_players'
]) as t;

select _wp110_grant_table('mozetto_game', 'select', t) from unnest(array[
  'dealer_commitments','randomness_requests','randomness_fulfillments',
  'seat_tickets','matchmaking_batches','protocol_versions'
]) as t;

-- Agent runtime brain / energy
select _wp110_grant_table('mozetto_agent', 'select, insert, update, delete', t) from unnest(array[
  'agent_session_states','agent_state_checkpoints','agent_memory_items',
  'agent_energy_ledgers','agent_inference_requests','agent_inference_results',
  'agent_fallback_events','model_health_snapshots',
  'agent_invocations','agent_decision_hashes'
]) as t;

select _wp110_grant_table('mozetto_agent', 'select', t) from unnest(array[
  'strategy_profiles','strategy_profile_versions','agent_profile_versions',
  'energy_policy_versions','model_policy_versions','profile_set_versions'
]) as t;

-- Dealer
select _wp110_grant_table('mozetto_dealer', 'select, insert, update', t) from unnest(array[
  'dealer_commitments','dealer_secret_batches','deck_batches','deck_commitments',
  'card_openings','dealer_attestations','enclave_measurements',
  'randomness_requests','randomness_incidents'
]) as t;

select _wp110_grant_table('mozetto_dealer', 'select', t) from unnest(array[
  'randomness_fulfillments','onchain_sessions'
]) as t;

-- Chain indexer
select _wp110_grant_table('mozetto_indexer', 'select, insert, update', t) from unnest(array[
  'contract_deployments','chain_cursors','chain_events','chain_reorgs',
  'vault_deposits','vault_withdrawals','vault_balance_snapshots',
  'randomness_requests','randomness_fulfillments',
  'onchain_sessions','onchain_session_players',
  'settlement_transactions','wallet_net_worth_snapshots'
]) as t;

select _wp110_grant_table('mozetto_indexer', 'select', t) from unnest(array[
  'settlement_proposals','settlement_attestations','seat_tickets','arena_accounts'
]) as t;

-- Settlement / proof worker
select _wp110_grant_table('mozetto_worker', 'select, insert, update', t) from unnest(array[
  'settlement_proposals','settlement_attestations','settlement_transactions',
  'emergency_exit_requests','proof_batches','proof_batch_inclusion_proofs',
  'hand_roots','balance_leaves','session_checkpoints',
  'reconciliation_runs','reconciliation_differences'
]) as t;

select _wp110_grant_table('mozetto_worker', 'select', t) from unnest(array[
  'canonical_game_events','onchain_sessions','dealer_commitments',
  'randomness_fulfillments','verification_packages'
]) as t;

-- Replay / verify
select _wp110_grant_table('mozetto_verifier', 'select', t) from unnest(array[
  'verification_packages','verification_artifacts','public_replay_manifests',
  'watchtower_reports','verification_status_history',
  'proof_batches','proof_batch_inclusion_proofs',
  'canonical_game_events','public_event_payloads','hand_roots','balance_leaves',
  'session_checkpoints','onchain_sessions','dealer_commitments',
  'deck_commitments','card_openings','randomness_fulfillments'
]) as t;

select _wp110_grant_table('mozetto_verifier', 'select, insert, update', 'verification_status_history');

-- Supabase service_role: ensure privileges when present (single-DSN hosted path).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
exception
  when insufficient_privilege then
    null;
end $$;

drop function if exists _wp110_grant_table(text, text, text);

comment on schema public is
  'WP-110: mozetto_* NOLOGIN roles hold least-privilege GRANTs; ops may SET ROLE or issue dedicated DSNs.';
