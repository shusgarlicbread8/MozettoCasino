-- Minute-bucketed on-chain net-worth snapshots for wallet charts (server-side only).
create table if not exists wallet_net_worth_snapshots (
  id bigserial primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  chain_id integer not null,
  bucket_at timestamptz not null,
  wallet_usdc numeric(24, 6) not null default 0,
  locked_usdc numeric(24, 6) not null default 0,
  legacy_mozetto_usdc numeric(24, 6) not null default 0,
  total_usdc numeric(24, 6) not null default 0,
  created_at timestamptz not null default now(),
  unique (profile_id, chain_id, bucket_at)
);

create index if not exists wallet_net_worth_snapshots_lookup_idx
  on wallet_net_worth_snapshots (profile_id, chain_id, bucket_at desc);

alter table wallet_net_worth_snapshots enable row level security;
-- No public policies: API / indexer use service role only.
