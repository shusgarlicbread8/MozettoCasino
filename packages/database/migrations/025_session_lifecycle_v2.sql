-- Plan 19 §018 — Session lifecycle V2 coordination layer.
-- Does NOT override on-chain SessionLifecycleV2 state; mirrors + audits transitions.
-- Existing onchain_sessions.status CHECK is preserved (legacy mirror values).

-- Honest labelling for demo / Anvil V2 vs V3 verified sessions (Plan 19 backfill rules).
alter table onchain_sessions
  add column if not exists lifecycle_state text,
  add column if not exists attestation_class text not null default 'legacy_attested',
  add column if not exists protocol_version int not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onchain_sessions_attestation_class_check'
  ) then
    alter table onchain_sessions
      add constraint onchain_sessions_attestation_class_check
      check (attestation_class in (
        'legacy_attested',
        'v3_verified',
        'demo_unranked',
        'under_review'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'onchain_sessions_lifecycle_state_check'
  ) then
    alter table onchain_sessions
      add constraint onchain_sessions_lifecycle_state_check
      check (
        lifecycle_state is null or lifecycle_state in (
          'draft',
          'sealed',
          'randomness_pending',
          'ready',
          'active',
          'settling',
          'settled',
          'aborted_before_active',
          'under_review',
          'emergency_exit_available',
          'emergency_exited'
        )
      );
  end if;
end $$;

comment on column onchain_sessions.lifecycle_state is
  'Plan 19 / SessionLifecycleV2 projection. Null = not yet backfilled; status column remains legacy mirror.';
comment on column onchain_sessions.attestation_class is
  'legacy_attested = pre-V3 / Anvil V2; v3_verified only after real VRF+proof path; never invent fake roots.';

-- Append-only transition log (idempotent via idempotency_key).
create table if not exists session_state_transitions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  previous_state text,
  new_state text not null
    check (new_state in (
      'draft',
      'sealed',
      'randomness_pending',
      'ready',
      'active',
      'settling',
      'settled',
      'aborted_before_active',
      'under_review',
      'emergency_exit_available',
      'emergency_exited'
    )),
  reason_code text not null,
  actor_service text not null,
  source_tx_hash text,
  source_event text,
  idempotency_key text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);

create index if not exists session_state_transitions_session_idx
  on session_state_transitions (session_id, created_at desc);

-- Synonyms / companions for Plan 19 naming (opening leaves already as balance_leaves).
create table if not exists session_controller_commitments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  seat int not null,
  wallet_address text not null,
  controller_hash text not null,
  agent_profile_hash text,
  committed_at timestamptz not null default now(),
  unique (session_id, seat)
);

create table if not exists opening_balance_leaves (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  wallet_address text not null,
  seat int,
  opening_balance numeric(18,6) not null,
  leaf_hash text not null,
  created_at timestamptz not null default now(),
  unique (session_id, wallet_address)
);

-- Plan 19 §019 companions still missing after migration 019.
create table if not exists hand_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch bigint not null default 0,
  hand_number bigint not null,
  state_hash text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, epoch, hand_number)
);

create table if not exists table_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch bigint not null default 0,
  sequence bigint not null,
  state_hash text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, epoch, sequence)
);

create table if not exists state_divergence_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch bigint,
  sequence bigint,
  expected_state_hash text,
  observed_state_hash text,
  severity text not null default 'critical'
    check (severity in ('critical', 'warning', 'info')),
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists state_divergence_alerts_open_idx
  on state_divergence_alerts (status, created_at desc)
  where status = 'open';

-- Mark existing rows honestly (no fake VRF/proof roots).
update onchain_sessions
set attestation_class = 'legacy_attested'
where attestation_class is null or attestation_class = 'legacy_attested';

alter table session_state_transitions enable row level security;
alter table session_controller_commitments enable row level security;
alter table opening_balance_leaves enable row level security;
alter table hand_snapshots enable row level security;
alter table table_snapshots enable row level security;
alter table state_divergence_alerts enable row level security;
