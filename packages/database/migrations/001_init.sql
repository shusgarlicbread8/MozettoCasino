-- Mozetto initial schema: poker-first platform with double-entry ledger
create extension if not exists "pgcrypto";

-- Enums
do $$ begin
  create type game_status as enum ('enabled', 'coming_soon', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type table_privacy as enum ('public', 'private', 'invite_only');
exception when duplicate_object then null; end $$;

do $$ begin
  create type seat_status as enum ('empty', 'occupied', 'sit_out', 'reserved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('active', 'completed', 'refunded', 'paused');
exception when duplicate_object then null; end $$;

do $$ begin
  create type hand_status as enum ('running', 'settled', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_tx_status as enum ('pending', 'posted', 'reversed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_kind as enum (
    'user_available',
    'user_table_escrow',
    'platform_rake',
    'house_bankroll',
    'system_clearing'
  );
exception when duplicate_object then null; end $$;

-- Profiles (1:1 with auth.users when auth is wired; demo users allowed)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  league text not null default 'bronze',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  chain text not null default 'base-sepolia',
  address text,
  label text not null default 'primary',
  created_at timestamptz not null default now(),
  unique (user_id, label)
);

create table if not exists agent_identities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  handle text unique not null,
  display_name text not null,
  glyph text not null default '◆',
  color text not null default '#00E676',
  current_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create table if not exists agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_identities(id) on delete cascade,
  version text not null,
  notes text,
  config_hash text,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create table if not exists agent_configs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_identities(id) on delete cascade,
  profile_key text not null check (profile_key in ('shark', 'professor', 'fox', 'machine')),
  risk text not null default 'balanced',
  instruction text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id text primary key,
  name text not null,
  category text not null check (category in ('poker', 'casino', 'tournament')),
  status game_status not null default 'coming_soon',
  sort_order int not null default 0
);

create table if not exists game_variants (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  name text not null,
  status game_status not null default 'coming_soon',
  max_seats int not null default 6,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists leagues (
  id text primary key,
  name text not null,
  color text not null,
  min_buy_in numeric(18,2) not null,
  sort_order int not null default 0
);

create table if not exists tables (
  id text primary key,
  name text not null,
  variant_id text not null references game_variants(id),
  league_id text not null references leagues(id),
  small_blind numeric(18,2) not null,
  big_blind numeric(18,2) not null,
  min_buy_in numeric(18,2) not null,
  max_buy_in numeric(18,2) not null,
  max_seats int not null default 6,
  rake_pct numeric(6,4) not null default 0.025,
  rake_cap numeric(18,2),
  privacy table_privacy not null default 'public',
  invite_code text unique,
  pace text not null default 'normal',
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists table_seats (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references tables(id) on delete cascade,
  seat_index int not null check (seat_index between 0 and 8),
  status seat_status not null default 'empty',
  agent_id uuid references agent_identities(id),
  owner_id uuid references profiles(id),
  stack numeric(18,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (table_id, seat_index)
);

create table if not exists table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references tables(id),
  owner_id uuid not null references profiles(id),
  agent_id uuid not null references agent_identities(id),
  agent_config_id uuid references agent_configs(id),
  seat_index int not null,
  buy_in numeric(18,2) not null,
  stack numeric(18,2) not null,
  status session_status not null default 'active',
  stop_loss numeric(18,2),
  profit_target numeric(18,2),
  max_duration_minutes int,
  auto_rebuy boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  server_seed_commit text,
  server_seed_reveal text
);

create table if not exists hands (
  id text primary key,
  table_id text not null references tables(id),
  hand_number bigint not null,
  status hand_status not null default 'running',
  button_seat int,
  board jsonb not null default '[]'::jsonb,
  pot numeric(18,2) not null default 0,
  street text not null default 'preflop',
  seed_commit text,
  seed_reveal text,
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (table_id, hand_number)
);

create table if not exists hand_events (
  id bigserial primary key,
  table_id text not null references tables(id),
  hand_id text references hands(id),
  sequence bigint not null,
  event_type text not null,
  timestamp timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  visibility text not null default 'public' check (visibility in ('public', 'owner_private', 'system')),
  prev_event_hash text,
  event_hash text not null,
  unique (table_id, sequence)
);

create table if not exists agent_decisions (
  id uuid primary key default gen_random_uuid(),
  hand_id text not null references hands(id) on delete cascade,
  agent_id uuid not null references agent_identities(id),
  sequence bigint not null,
  legal_actions jsonb not null,
  action text not null,
  amount numeric(18,2),
  reason_code text,
  compute_used int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create table if not exists game_snapshots (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references tables(id),
  hand_id text references hands(id),
  sequence bigint not null,
  public_state jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  kind account_kind not null,
  currency text not null default 'USDC',
  label text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, kind, currency, label)
);

create table if not exists ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique not null,
  description text not null,
  status ledger_tx_status not null default 'posted',
  reference_type text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references ledger_transactions(id) on delete cascade,
  account_id uuid not null references ledger_accounts(id),
  amount numeric(18,2) not null,
  created_at timestamptz not null default now(),
  check (amount <> 0)
);

create table if not exists escrow_sessions (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null unique references table_sessions(id) on delete cascade,
  locked_amount numeric(18,2) not null,
  status text not null default 'locked',
  created_at timestamptz not null default now()
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  escrow_session_id uuid references escrow_sessions(id),
  result_hash text,
  rake_amount numeric(18,2) not null default 0,
  payouts jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  nonce text unique,
  created_at timestamptz not null default now()
);

create table if not exists blockchain_transactions (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid references settlements(id),
  chain text not null default 'base-sepolia',
  tx_hash text,
  status text not null default 'stub',
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_identities(id) on delete cascade,
  variant_id text not null references game_variants(id),
  elo numeric(10,2) not null default 1500,
  hands_played int not null default 0,
  profit numeric(18,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (agent_id, variant_id)
);

create table if not exists risk_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  daily_loss_limit numeric(18,2),
  session_loss_limit numeric(18,2),
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  notifications jsonb not null default '{}'::jsonb,
  spectating jsonb not null default '{}'::jsonb,
  my_ai jsonb not null default '{}'::jsonb,
  account jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_tables_variant on tables(variant_id);
create index if not exists idx_hand_events_table_seq on hand_events(table_id, sequence);
create index if not exists idx_hands_table on hands(table_id, started_at desc);
create index if not exists idx_ledger_entries_account on ledger_entries(account_id);
create index if not exists idx_sessions_owner on table_sessions(owner_id, status);
create index if not exists idx_notifications_user on notifications(user_id, created_at desc);

-- Ledger balance view
create or replace view ledger_balances as
select
  a.id as account_id,
  a.owner_id,
  a.kind,
  a.currency,
  a.label,
  coalesce(sum(e.amount), 0)::numeric(18,2) as balance
from ledger_accounts a
left join ledger_entries e on e.account_id = a.id
group by a.id, a.owner_id, a.kind, a.currency, a.label;

-- RLS
alter table profiles enable row level security;
alter table wallets enable row level security;
alter table agent_identities enable row level security;
alter table agent_versions enable row level security;
alter table agent_configs enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table table_sessions enable row level security;
alter table hands enable row level security;
alter table hand_events enable row level security;
alter table agent_decisions enable row level security;
alter table game_snapshots enable row level security;
alter table ledger_accounts enable row level security;
alter table ledger_transactions enable row level security;
alter table ledger_entries enable row level security;
alter table escrow_sessions enable row level security;
alter table settlements enable row level security;
alter table blockchain_transactions enable row level security;
alter table ratings enable row level security;
alter table risk_limits enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table user_settings enable row level security;
alter table games enable row level security;
alter table game_variants enable row level security;
alter table leagues enable row level security;

-- Public read for directory data
create policy games_read on games for select using (true);
create policy variants_read on game_variants for select using (true);
create policy leagues_read on leagues for select using (true);
create policy tables_read on tables for select using (true);
create policy seats_read on table_seats for select using (true);
create policy ratings_read on ratings for select using (true);
create policy agents_public_read on agent_identities for select using (true);
create policy hands_public_read on hands for select using (true);
create policy hand_events_public_read on hand_events for select using (visibility = 'public');
create policy snapshots_public_read on game_snapshots for select using (true);
create policy profiles_public_read on profiles for select using (true);

-- Service role bypasses RLS; app uses service key on API/game-server.
-- Authenticated policies (when auth.uid mapped via profiles.auth_user_id):
create policy notifications_own on notifications for select
  using (user_id in (select id from profiles where auth_user_id = auth.uid()));
create policy settings_own on user_settings for all
  using (user_id in (select id from profiles where auth_user_id = auth.uid()));
create policy ledger_accounts_own on ledger_accounts for select
  using (owner_id in (select id from profiles where auth_user_id = auth.uid()) or owner_id is null);
create policy sessions_own on table_sessions for select
  using (owner_id in (select id from profiles where auth_user_id = auth.uid()));
