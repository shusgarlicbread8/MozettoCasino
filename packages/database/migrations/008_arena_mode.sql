-- Dual-mode platform: demo (off-chain paper) vs onchain (Base USDC vault).
-- One account can access both; balances and tables never mix.

do $$ begin
  create type arena_mode as enum ('demo', 'onchain');
exception when duplicate_object then null; end $$;

alter table profiles
  add column if not exists active_arena_mode arena_mode not null default 'demo';

alter table tables
  add column if not exists arena_mode arena_mode not null default 'demo';

create index if not exists tables_arena_mode_active_idx
  on tables (arena_mode, is_active, league_id)
  where is_active = true;

-- Mode-scoped ledger accounts (existing rows become demo).
alter table ledger_accounts
  add column if not exists arena_mode arena_mode not null default 'demo';

alter table ledger_accounts
  drop constraint if exists ledger_accounts_owner_id_kind_currency_label_key;

create unique index if not exists ledger_accounts_owner_mode_uq
  on ledger_accounts (owner_id, kind, currency, label, arena_mode)
  where owner_id is not null;

create unique index if not exists ledger_accounts_system_mode_uq
  on ledger_accounts (kind, currency, label, arena_mode)
  where owner_id is null;

-- On-chain system books (separate from demo clearing/rake).
insert into ledger_accounts (owner_id, kind, currency, label, arena_mode)
values
  (null, 'system_clearing', 'USDC', 'clearing', 'onchain'),
  (null, 'platform_rake', 'USDC', 'rake', 'onchain'),
  (null, 'house_bankroll', 'USDC', 'house', 'onchain')
on conflict do nothing;

-- Ensure every existing user has on-chain available + escrow accounts (zero balance).
insert into ledger_accounts (owner_id, kind, currency, label, arena_mode)
select p.id, 'user_available', 'USDC', 'available', 'onchain'
from profiles p
where not exists (
  select 1 from ledger_accounts a
  where a.owner_id = p.id and a.kind = 'user_available' and a.arena_mode = 'onchain'
);

insert into ledger_accounts (owner_id, kind, currency, label, arena_mode)
select p.id, 'user_table_escrow', 'USDC', 'escrow', 'onchain'
from profiles p
where not exists (
  select 1 from ledger_accounts a
  where a.owner_id = p.id and a.kind = 'user_table_escrow' and a.arena_mode = 'onchain'
);

-- Chain identity link (wallet address for on-chain mode).
alter table wallets
  add column if not exists arena_mode arena_mode not null default 'demo';

alter table wallets drop constraint if exists wallets_user_id_label_key;
create unique index if not exists wallets_user_label_mode_uq
  on wallets (user_id, label, arena_mode);

-- Wallet link requests / verified addresses for on-chain deposits.
create table if not exists wallet_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  chain_id int not null,
  address text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chain_id, address)
);

create index if not exists wallet_identities_user_idx on wallet_identities (user_id);

-- Mirror of vault locks pending indexer confirmation.
create table if not exists onchain_seat_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  table_id text not null references tables(id) on delete cascade,
  amount numeric(18,6) not null,
  controller_hash text,
  tx_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'settled')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Update signup bootstrap: demo fund + empty on-chain accounts + active mode demo.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text;
  v_agent_handle text;
  v_profile_id uuid;
  v_agent_id uuid;
  v_base text;
begin
  v_base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9]+', '', 'g'));
  if v_base is null or length(v_base) < 2 then
    v_base := 'player';
  end if;
  v_handle := v_base;
  while exists (select 1 from profiles where handle = v_handle) loop
    v_handle := v_base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  v_agent_handle := upper(substr(v_handle, 1, 10));
  while exists (select 1 from agent_identities where handle = v_agent_handle) loop
    v_agent_handle := upper(substr(v_handle, 1, 6) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 3));
  end loop;

  insert into profiles (id, auth_user_id, handle, display_name, league, active_arena_mode)
  values (gen_random_uuid(), new.id, v_handle, coalesce(new.raw_user_meta_data->>'display_name', initcap(v_base)), 'bronze', 'demo')
  returning id into v_profile_id;

  insert into wallets (user_id, chain, label, arena_mode) values
    (v_profile_id, 'base-sepolia', 'primary', 'demo'),
    (v_profile_id, 'base-sepolia', 'primary', 'onchain');

  insert into ledger_accounts (owner_id, kind, currency, label, arena_mode) values
    (v_profile_id, 'user_available', 'USDC', 'available', 'demo'),
    (v_profile_id, 'user_table_escrow', 'USDC', 'escrow', 'demo'),
    (v_profile_id, 'user_available', 'USDC', 'available', 'onchain'),
    (v_profile_id, 'user_table_escrow', 'USDC', 'escrow', 'onchain');

  insert into ledger_transactions (idempotency_key, description, status, reference_type, reference_id)
  values ('signup-fund-' || v_profile_id::text, 'Welcome demo USDC deposit', 'posted', 'deposit', 'signup');

  insert into ledger_entries (transaction_id, account_id, amount)
  select t.id, a.id, -5000
  from ledger_transactions t, ledger_accounts a
  where t.idempotency_key = 'signup-fund-' || v_profile_id::text
    and a.kind = 'system_clearing' and a.label = 'clearing' and a.arena_mode = 'demo';

  insert into ledger_entries (transaction_id, account_id, amount)
  select t.id, a.id, 5000
  from ledger_transactions t, ledger_accounts a
  where t.idempotency_key = 'signup-fund-' || v_profile_id::text
    and a.owner_id = v_profile_id and a.kind = 'user_available' and a.arena_mode = 'demo';

  insert into agent_identities (id, owner_id, handle, display_name, glyph, color, current_version)
  values (gen_random_uuid(), v_profile_id, v_agent_handle, v_agent_handle, '◆', '#00E676', 'v1')
  returning id into v_agent_id;

  insert into agent_versions (agent_id, version, notes, config_hash)
  values (v_agent_id, 'v1', 'Initial personality', 'cfg_v1');

  insert into agent_configs (agent_id, profile_key, risk, instruction, is_active)
  values (v_agent_id, 'fox', 'balanced', null, true);

  insert into ratings (agent_id, variant_id, elo, hands_played, profit)
  values (v_agent_id, 'nlhe_6max', 1500, 0, 0);

  insert into user_settings (user_id) values (v_profile_id);

  insert into notifications (user_id, title, body, href)
  values (v_profile_id, 'Welcome to Mozetto', 'Demo wallet funded with $5,000 paper USDC. Switch to On-chain when you are ready for real Base USDC.', '/poker');

  return new;
end;
$$;
