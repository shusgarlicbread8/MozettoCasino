-- Plan 19 §024 / WP-043 / Plan 12 — Matchmaking integrity + identity clusters.
-- Sensitive anti-fraud signals: RLS deny-by-default; never expose via public APIs.
-- Complements matchmaking_allocation_log (017) and seat_tickets / matchmaking_batches (011).

create table if not exists matchmaking_intents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  league_id text not null,
  format text not null check (format in ('hu', 'classic')),
  arena_mode text not null default 'demo',
  chain_id int,
  buy_in numeric(18,6),
  status text not null default 'queued'
    check (status in ('queued', 'matched', 'cancelled', 'expired', 'failed')),
  seat_ticket_id uuid references seat_tickets(id) on delete set null,
  session_id text,
  table_id text,
  idempotency_key text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, idempotency_key)
);

create index if not exists matchmaking_intents_queue_idx
  on matchmaking_intents (status, format, league_id, created_at)
  where status = 'queued';

create table if not exists pairing_history (
  id uuid primary key default gen_random_uuid(),
  account_a uuid not null references profiles(id) on delete cascade,
  account_b uuid not null references profiles(id) on delete cascade,
  session_id text,
  format text not null default 'hu',
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (account_a <> account_b)
);

create index if not exists pairing_history_pair_idx
  on pairing_history (account_a, account_b, created_at desc);

create table if not exists rating_weight_overrides (
  id uuid primary key default gen_random_uuid(),
  account_a uuid not null references profiles(id) on delete cascade,
  account_b uuid not null references profiles(id) on delete cascade,
  pool_id text not null,
  weight numeric(8,4) not null check (weight >= 0 and weight <= 1),
  reason_code text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_a, account_b, pool_id)
);

create table if not exists identity_clusters (
  id uuid primary key default gen_random_uuid(),
  label text,
  status text not null default 'active'
    check (status in ('active', 'merged', 'dismissed')),
  risk_score real,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity_cluster_edges (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references identity_clusters(id) on delete cascade,
  account_id uuid not null references profiles(id) on delete cascade,
  linked_account_id uuid not null references profiles(id) on delete cascade,
  reason text not null
    check (reason in ('manual', 'funding', 'device', 'wallet_cluster', 'admin', 'stub')),
  confidence real not null default 1 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  check (account_id <> linked_account_id),
  unique (account_id, linked_account_id, reason)
);

create index if not exists identity_cluster_edges_account_idx
  on identity_cluster_edges (account_id);

create index if not exists identity_cluster_edges_linked_idx
  on identity_cluster_edges (linked_account_id);

create table if not exists matchmaking_exclusions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references profiles(id) on delete cascade,
  excluded_account_id uuid not null references profiles(id) on delete cascade,
  reason_code text not null,
  source text not null default 'identity_cluster',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (account_id <> excluded_account_id),
  unique (account_id, excluded_account_id, reason_code)
);

create table if not exists collusion_signals (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  account_ids uuid[] not null default '{}',
  signal_kind text not null,
  score real,
  confidence real,
  evidence jsonb not null default '{}'::jsonb,
  suggested_action text
    check (suggested_action is null or suggested_action in (
      'flag_review', 'seat_exclusion', 'monitor', 'none'
    )),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists integrity_cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  severity text not null default 'info'
    check (severity in ('critical', 'warning', 'info')),
  account_ids uuid[] not null default '{}',
  signal_ids uuid[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table matchmaking_intents enable row level security;
alter table pairing_history enable row level security;
alter table rating_weight_overrides enable row level security;
alter table identity_clusters enable row level security;
alter table identity_cluster_edges enable row level security;
alter table matchmaking_exclusions enable row level security;
alter table collusion_signals enable row level security;
alter table integrity_cases enable row level security;
