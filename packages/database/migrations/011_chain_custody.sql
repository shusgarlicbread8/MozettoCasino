-- Chain custody projections: indexer is sole authority for vault mirror credits.

create table if not exists contract_deployments (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  chain_id int not null,
  protocol_version text not null,
  arena_vault text,
  table_registry text,
  settlement_hub text,
  checkpoint_registry text,
  randomness_coordinator text,
  fee_treasury text,
  usdc text,
  deployment_block bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (chain_id, protocol_version)
);

create table if not exists chain_cursors (
  chain_id int primary key,
  last_block bigint not null default 0,
  last_log_index int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists chain_events (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  block_number bigint not null,
  block_hash text,
  address text not null,
  event_name text not null,
  args jsonb not null default '{}',
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create index if not exists chain_events_block_idx on chain_events (chain_id, block_number);

create table if not exists chain_reorgs (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  from_block bigint not null,
  detected_at timestamptz not null default now(),
  detail jsonb
);

create table if not exists vault_deposits (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  block_number bigint not null,
  wallet_address text not null,
  amount_raw numeric(78,0) not null,
  amount_usdc numeric(18,6) not null,
  profile_id uuid references profiles(id),
  mirrored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create table if not exists vault_withdrawals (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  tx_hash text not null,
  log_index int not null,
  block_number bigint not null,
  wallet_address text not null,
  to_address text,
  amount_raw numeric(78,0) not null,
  amount_usdc numeric(18,6) not null,
  profile_id uuid references profiles(id),
  mirrored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chain_id, tx_hash, log_index)
);

create table if not exists vault_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  taken_at timestamptz not null default now(),
  token_balance_raw numeric(78,0) not null,
  mirror_available_sum numeric(18,6),
  mirror_escrow_sum numeric(18,6),
  difference_usdc numeric(18,6),
  ok boolean not null default true
);

create table if not exists reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb
);

create table if not exists seat_tickets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  wallet_address text not null,
  chain_id int not null,
  game_template_id text not null,
  buy_in numeric(18,6) not null,
  controller_hash text not null,
  agent_profile_hash text not null,
  expires_at timestamptz not null,
  nonce numeric(78,0) not null,
  matchmaking_pool text not null,
  signature text not null,
  status text not null default 'queued'
    check (status in ('queued', 'matched', 'opened', 'expired', 'cancelled', 'failed')),
  batch_id uuid,
  session_id text,
  created_at timestamptz not null default now(),
  unique (chain_id, wallet_address, nonce)
);

create index if not exists seat_tickets_queue_idx
  on seat_tickets (status, chain_id, matchmaking_pool, created_at);

create table if not exists matchmaking_batches (
  id uuid primary key default gen_random_uuid(),
  chain_id int not null,
  game_template_id text not null,
  session_id text,
  open_tx_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'opened', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  opened_at timestamptz
);

create table if not exists onchain_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  chain_id int not null,
  game_template_id text not null,
  table_id text references tables(id),
  dealer_root text,
  engine_hash text,
  profile_set_hash text,
  open_tx_hash text,
  open_block bigint,
  status text not null default 'pending'
    check (status in ('pending', 'opened', 'playing', 'settling', 'settled', 'blocked', 'emergency')),
  last_sequence bigint not null default 0,
  last_balance_root text,
  last_event_root text,
  settlement_tx_hash text,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  settled_at timestamptz
);

create table if not exists onchain_session_players (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references onchain_sessions(session_id) on delete cascade,
  profile_id uuid references profiles(id),
  wallet_address text not null,
  buy_in_raw numeric(78,0) not null,
  seat int,
  controller_hash text,
  agent_profile_hash text,
  unique (session_id, wallet_address)
);

-- Extend seat locks for session model
alter table onchain_seat_locks
  add column if not exists session_id text,
  add column if not exists wallet_address text,
  add column if not exists chain_id int;

create table if not exists randomness_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch_id text not null,
  dealer_root text not null,
  vrf_request_id text,
  status text not null default 'committed'
    check (status in ('committed', 'requested', 'fulfilled', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists randomness_fulfillments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch_id text not null,
  vrf_word numeric(78,0) not null,
  tx_hash text,
  fulfilled_at timestamptz not null default now()
);

create table if not exists dealer_commitments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  dealer_root text not null,
  secret_count int not null default 256,
  revealed_after_settlement boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists canonical_game_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  sequence bigint not null,
  event_hash text not null,
  previous_event_hash text not null,
  event_type text not null,
  public_payload jsonb not null default '{}',
  private_payload_commitment text,
  engine_hash text,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table if not exists hand_roots (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text not null,
  hand_number int not null,
  hand_root text not null,
  created_at timestamptz not null default now(),
  unique (session_id, hand_id)
);

create table if not exists session_checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  sequence bigint not null,
  hand_number int,
  event_root text not null,
  balance_root text not null,
  randomness_epoch text,
  tx_hash text,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table if not exists balance_leaves (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  sequence bigint not null,
  wallet_address text not null,
  seat int,
  table_balance numeric(18,6) not null,
  cumulative_rake numeric(18,6) not null default 0,
  leaf_hash text not null,
  unique (session_id, sequence, wallet_address)
);

create table if not exists settlement_proposals (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  final_sequence bigint not null,
  event_root text not null,
  hand_root text not null,
  balance_root text not null,
  total_rake numeric(18,6) not null,
  balances jsonb not null,
  deadline timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'attesting', 'submitted', 'confirmed', 'rejected', 'blocked')),
  created_at timestamptz not null default now()
);

create table if not exists settlement_attestations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references settlement_proposals(id) on delete cascade,
  attestor_role text not null check (attestor_role in ('game', 'replay', 'dealer')),
  attestor_address text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  unique (proposal_id, attestor_role)
);

create table if not exists settlement_transactions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references settlement_proposals(id) on delete cascade,
  tx_hash text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

create table if not exists emergency_exit_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  wallet_address text not null,
  table_balance numeric(18,6) not null,
  sequence bigint not null,
  tx_hash text,
  status text not null default 'requested',
  created_at timestamptz not null default now()
);

create table if not exists agent_invocations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  sequence bigint,
  model_id text,
  model_deployment_version text,
  profile_hash text,
  observation_hash text,
  response_hash text,
  selected_mode text,
  energy_before int,
  energy_after int,
  token_usage int,
  latency_ms int,
  legal_action text,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists agent_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  profile_hash text not null,
  frozen boolean not null default true,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists agent_decision_hashes (
  id uuid primary key default gen_random_uuid(),
  invocation_id uuid references agent_invocations(id) on delete cascade,
  decision_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists admin_roles (
  user_id uuid primary key references profiles(id) on delete cascade,
  role text not null check (role in ('viewer', 'operator', 'risk', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references profiles(id),
  role text,
  action text not null,
  reason text,
  previous_state jsonb,
  new_state jsonb,
  request_id text,
  safe_tx_id text,
  created_at timestamptz not null default now()
);

create table if not exists security_incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info',
  title text not null,
  detail jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default true,
  meta jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into feature_flags (key, enabled, meta) values
  ('onchain_matchmaking', true, '{"note":"disabled automatically on reconciliation failure"}'),
  ('client_credit_deposit', false, '{"note":"removed — indexer only"}')
on conflict (key) do nothing;

insert into agent_profile_versions (profile_key, profile_hash, meta) values
  ('SHARK_V1', encode(sha256('SHARK_V1'::bytea), 'hex'), '{"energy":60}'),
  ('PROFESSOR_V1', encode(sha256('PROFESSOR_V1'::bytea), 'hex'), '{"energy":60}'),
  ('FOX_V1', encode(sha256('FOX_V1'::bytea), 'hex'), '{"energy":60}'),
  ('MACHINE_V1', encode(sha256('MACHINE_V1'::bytea), 'hex'), '{"energy":60}')
on conflict (profile_key) do nothing;
