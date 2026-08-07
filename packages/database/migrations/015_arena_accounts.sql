-- Per-owner ArenaAccount custody identity (money) vs wallet_identities (login owner).

create table if not exists arena_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  chain_id int not null,
  owner_address text not null,
  arena_account_address text not null,
  factory_address text,
  implementation_address text,
  deployment_status text not null default 'predicted'
    check (deployment_status in ('predicted', 'pending', 'deployed', 'failed')),
  deploy_tx_hash text,
  deployed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, owner_address),
  unique (chain_id, arena_account_address)
);

create index if not exists arena_accounts_profile_idx on arena_accounts (profile_id);
create index if not exists arena_accounts_account_idx on arena_accounts (lower(arena_account_address));
create index if not exists arena_accounts_owner_idx on arena_accounts (lower(owner_address));

-- Off-chain exposure reservations for maxTotalAtRisk / maxConcurrentGames during matchmaking.
create table if not exists arena_exposure_reservations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  chain_id int not null,
  arena_account_address text not null,
  session_id text,
  batch_id uuid,
  buy_in_raw numeric(78,0) not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'confirmed', 'released', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arena_exposure_active_idx
  on arena_exposure_reservations (chain_id, lower(arena_account_address), status)
  where status = 'reserved';

alter table seat_tickets
  add column if not exists arena_account_address text,
  add column if not exists owner_address text,
  add column if not exists league_bit int,
  add column if not exists rated boolean default true;

alter table onchain_session_players
  add column if not exists arena_account_address text,
  add column if not exists owner_address text;

alter table contract_deployments
  add column if not exists arena_account_factory text,
  add column if not exists arena_account_implementation text,
  add column if not exists arena_vault_v1 text;

-- Backfill seat_tickets: historically wallet_address was the EOA money key.
update seat_tickets
set owner_address = lower(wallet_address),
    arena_account_address = coalesce(arena_account_address, lower(wallet_address))
where owner_address is null and wallet_address is not null;

update onchain_session_players
set owner_address = lower(wallet_address),
    arena_account_address = coalesce(arena_account_address, lower(wallet_address))
where owner_address is null and wallet_address is not null;
