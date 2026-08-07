-- Plan 19 §022 / WP-072 / WP-074 — Agent Brain, Energy, and profile persistence.
-- Structured state only; no raw chain-of-thought. Service-role access (RLS deny-by-default).
-- Never store plaintext private observations without ciphertext + retention meta.

create table if not exists strategy_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  display_name text,
  status text not null default 'active'
    check (status in ('draft', 'active', 'deprecated', 'retired')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists strategy_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null references strategy_profiles(profile_key) on delete cascade,
  semantic_version text not null,
  profile_hash text not null,
  frozen boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (profile_key, semantic_version),
  unique (profile_hash)
);

-- Align with existing agent_profile_versions seed (011) without breaking it.
insert into strategy_profiles (profile_key, display_name, status)
values
  ('SHARK_V1', 'Shark', 'active'),
  ('PROFESSOR_V1', 'Professor', 'active'),
  ('FOX_V1', 'Fox', 'active'),
  ('MACHINE_V1', 'Machine', 'active')
on conflict (profile_key) do nothing;

insert into strategy_profile_versions (profile_key, semantic_version, profile_hash, frozen, meta)
select profile_key, '1.0.0', profile_hash, frozen, meta
from agent_profile_versions
on conflict (profile_key, semantic_version) do nothing;

-- WP-072 AgentState live row + checkpoints (matches AGENT_STATE_SCHEMA_SQL_STUB).
create table if not exists agent_session_states (
  session_id text not null,
  hand_id text not null,
  seat smallint not null,
  schema_version smallint not null default 1,
  profile_hash text not null,
  energy_remaining smallint not null,
  public_event_cursor integer not null,
  memory_version integer not null,
  state_json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, hand_id, seat)
);

create table if not exists agent_state_checkpoints (
  checkpoint_id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text not null,
  seat smallint not null,
  schema_version smallint not null,
  memory_version integer not null,
  public_event_cursor integer not null,
  state_json jsonb not null,
  saved_at timestamptz not null default now()
);

create index if not exists agent_state_checkpoints_lookup
  on agent_state_checkpoints (session_id, hand_id, seat, saved_at desc);

-- Optional normalized memory items (WP-072 keeps most memory inside state_json).
create table if not exists agent_memory_items (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text not null,
  seat smallint not null,
  memory_kind text not null,
  summary text not null,
  source_event_refs jsonb not null default '[]'::jsonb,
  confidence real,
  created_at timestamptz not null default now()
);

create index if not exists agent_memory_items_lookup
  on agent_memory_items (session_id, hand_id, seat, created_at desc);

-- WP-074 Energy ledger — one ledger per session/hand/seat/policy version.
create table if not exists agent_energy_ledgers (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text not null,
  seat smallint not null,
  energy_policy_hash text not null,
  starting_energy smallint not null default 100,
  remaining_energy smallint not null,
  ending_energy smallint,
  seat_active boolean not null default true,
  status text not null default 'open'
    check (status in ('open', 'expired')),
  ops_root text,
  ledger_hash text,
  ops_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expired_at timestamptz,
  unique (session_id, hand_id, seat, energy_policy_hash)
);

create table if not exists agent_inference_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  seat smallint,
  request_id text not null unique,
  model_id text,
  observation_hash text,
  energy_op_type int,
  status text not null default 'pending'
    check (status in ('pending', 'executed', 'cancelled', 'failed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agent_inference_results (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references agent_inference_requests(request_id) on delete cascade,
  result_hash text not null,
  legal_action text,
  latency_ms int,
  token_usage int,
  fallback_used boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (request_id)
);

create table if not exists agent_fallback_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  seat smallint,
  reason_code text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists model_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  model_id text not null,
  taken_at timestamptz not null default now(),
  ok boolean not null default true,
  latency_p50_ms int,
  latency_p99_ms int,
  error_rate real,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists model_health_snapshots_model_idx
  on model_health_snapshots (model_id, taken_at desc);

alter table strategy_profiles enable row level security;
alter table strategy_profile_versions enable row level security;
alter table agent_session_states enable row level security;
alter table agent_state_checkpoints enable row level security;
alter table agent_memory_items enable row level security;
alter table agent_energy_ledgers enable row level security;
alter table agent_inference_requests enable row level security;
alter table agent_inference_results enable row level security;
alter table agent_fallback_events enable row level security;
alter table model_health_snapshots enable row level security;
