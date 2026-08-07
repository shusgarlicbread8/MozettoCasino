-- Plan 19 §026 / WP-090 / WP-095 — Public verification packages.
-- Points at immutable/content-addressed artifacts and Base txs.
-- Complements proof_batches + proof_batch_inclusion_proofs (023).

create table if not exists verification_packages (
  id uuid primary key default gen_random_uuid(),
  package_id text not null unique,
  session_id text,
  chain_id int,
  content_hash text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded', 'withdrawn')),
  package_json jsonb not null default '{}'::jsonb,
  proof_batch_sequence bigint,
  tx_hash text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (content_hash)
);

create index if not exists verification_packages_session_idx
  on verification_packages (session_id, published_at desc nulls last)
  where session_id is not null;

create index if not exists verification_packages_batch_idx
  on verification_packages (proof_batch_sequence)
  where proof_batch_sequence is not null;

create table if not exists verification_artifacts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references verification_packages(id) on delete cascade,
  artifact_kind text not null
    check (artifact_kind in (
      'proof_batch',
      'inclusion_proof',
      'event_chain',
      'balance_root',
      'randomness',
      'replay_manifest',
      'watchtower_report',
      'other'
    )),
  content_address text not null,
  uri text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (package_id, artifact_kind, content_address)
);

create table if not exists public_replay_manifests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  hand_id text,
  manifest_hash text not null,
  manifest jsonb not null default '{}'::jsonb,
  package_id uuid references verification_packages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (manifest_hash)
);

create index if not exists public_replay_manifests_session_idx
  on public_replay_manifests (session_id, created_at desc);

create table if not exists watchtower_reports (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references verification_packages(id) on delete set null,
  session_id text,
  batch_sequence bigint,
  status text not null
    check (status in ('VERIFIED', 'FAILED', 'INCOMPLETE_PUBLIC_DATA', 'ERROR')),
  report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists watchtower_reports_session_idx
  on watchtower_reports (session_id, created_at desc)
  where session_id is not null;

create table if not exists verification_status_history (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  previous_status text,
  new_status text not null,
  reason_code text,
  actor_service text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists verification_status_history_session_idx
  on verification_status_history (session_id, created_at desc);

alter table verification_packages enable row level security;
alter table verification_artifacts enable row level security;
alter table public_replay_manifests enable row level security;
alter table watchtower_reports enable row level security;
alter table verification_status_history enable row level security;
