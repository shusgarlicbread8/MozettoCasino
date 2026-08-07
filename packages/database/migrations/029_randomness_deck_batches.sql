-- Plan 19 §020 — Randomness and deck batches (coordination + public proofs).
-- Extends 011 randomness_requests / fulfillments / dealer_commitments.
-- NEVER store plaintext private dealer secrets in Postgres.

-- Operator synonym views (Plan 19 table names → existing 011 tables).
create or replace view vrf_requests as
  select
    id,
    session_id,
    epoch_id,
    dealer_root,
    vrf_request_id,
    status,
    created_at
  from randomness_requests;

create or replace view vrf_fulfillments as
  select
    id,
    session_id,
    epoch_id,
    vrf_word,
    tx_hash,
    fulfilled_at
  from randomness_fulfillments;

create table if not exists dealer_secret_batches (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch_id text not null,
  -- Commitment / root only — never the secret material.
  secret_batch_commitment text not null,
  secret_count int not null default 256,
  revealed_after_settlement boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, epoch_id)
);

create table if not exists deck_batches (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  epoch_id text not null,
  hand_id text,
  deck_root text not null,
  hand_seed_commitment text,
  shuffle_proof_meta jsonb not null default '{}'::jsonb,
  status text not null default 'committed'
    check (status in ('committed', 'active', 'revealed', 'void')),
  created_at timestamptz not null default now(),
  unique (session_id, epoch_id, deck_root)
);

create index if not exists deck_batches_session_idx
  on deck_batches (session_id, created_at desc);

create table if not exists deck_commitments (
  id uuid primary key default gen_random_uuid(),
  deck_batch_id uuid references deck_batches(id) on delete cascade,
  session_id text not null,
  commitment text not null,
  commitment_kind text not null default 'deck_root'
    check (commitment_kind in ('deck_root', 'dealer_root', 'card_leaf', 'other')),
  created_at timestamptz not null default now(),
  unique (session_id, commitment, commitment_kind)
);

create table if not exists card_openings (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text not null,
  deck_root text not null,
  position int not null check (position >= 0 and position < 52),
  -- Public opening proof data only (card code after open; salt + merkle proof).
  card_code int,
  card_salt text,
  merkle_proof jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  unique (session_id, hand_id, position)
);

create table if not exists dealer_attestations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  attestor_address text not null,
  payload_digest text not null,
  signature text not null,
  attestation_kind text not null default 'dealer_v3',
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'invalid')),
  created_at timestamptz not null default now(),
  unique (session_id, payload_digest, attestor_address)
);

create table if not exists enclave_measurements (
  id uuid primary key default gen_random_uuid(),
  enclave_id text not null,
  measurement_hash text not null,
  platform text not null default 'nitro_mock'
    check (platform in ('nitro_mock', 'nitro_live', 'other')),
  status text not null default 'registered'
    check (status in ('registered', 'trusted', 'revoked')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (enclave_id, measurement_hash)
);

create table if not exists randomness_incidents (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  epoch_id text,
  severity text not null default 'warning'
    check (severity in ('critical', 'warning', 'info')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists randomness_incidents_open_idx
  on randomness_incidents (status, severity, created_at desc)
  where status = 'open';

alter table dealer_secret_batches enable row level security;
alter table deck_batches enable row level security;
alter table deck_commitments enable row level security;
alter table card_openings enable row level security;
alter table dealer_attestations enable row level security;
alter table enclave_measurements enable row level security;
alter table randomness_incidents enable row level security;
