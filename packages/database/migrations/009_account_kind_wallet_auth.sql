-- Separate Demo (email) vs On-chain (wallet) profiles.
-- Note: ledger already uses enum account_kind for book types — profiles use profile_kind.

do $$ begin
  create type profile_kind as enum ('demo', 'onchain');
exception when duplicate_object then null; end $$;

alter table profiles
  add column if not exists profile_kind profile_kind not null default 'demo';

alter table profiles
  add column if not exists primary_chain_id int;

-- Existing rows are demo (email) accounts.
update profiles set profile_kind = 'demo' where profile_kind is null or profile_kind = 'demo';

-- Wallet identity: one on-chain profile per (chain family address). Address is case-normalized lowercase.
-- chain_id on the identity is the chain used at last verify; profile can switch Sepolia/Mainnet.
alter table wallet_identities
  add column if not exists profile_id uuid references profiles(id) on delete cascade;

-- Backfill profile_id from user_id if present
update wallet_identities set profile_id = user_id where profile_id is null and user_id is not null;

create unique index if not exists wallet_identities_address_uq
  on wallet_identities (lower(address));

create table if not exists siwe_nonces (
  address text not null,
  nonce text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (address, nonce)
);

create index if not exists siwe_nonces_expires_idx on siwe_nonces (expires_at);

-- Optional: tables may tag which chain they settle on (null for demo).
alter table tables
  add column if not exists chain_id int;

create index if not exists tables_chain_mode_idx
  on tables (arena_mode, chain_id)
  where is_active = true;

-- Demo signup: ONLY demo ledger accounts (no on-chain twins).
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

  insert into profiles (id, auth_user_id, handle, display_name, league, active_arena_mode, profile_kind)
  values (
    gen_random_uuid(),
    new.id,
    v_handle,
    coalesce(new.raw_user_meta_data->>'display_name', initcap(v_base)),
    'bronze',
    'demo',
    'demo'
  )
  returning id into v_profile_id;

  insert into wallets (user_id, chain, label, arena_mode)
  values (v_profile_id, 'demo', 'primary', 'demo');

  insert into ledger_accounts (owner_id, kind, currency, label, arena_mode) values
    (v_profile_id, 'user_available', 'USDC', 'available', 'demo'),
    (v_profile_id, 'user_table_escrow', 'USDC', 'escrow', 'demo');

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
  values (
    v_profile_id,
    'Welcome to Mozetto Demo',
    'Your demo account is funded with $5,000 paper USDC. On-chain play uses a separate wallet account.',
    '/poker'
  );

  return new;
end;
$$;

-- Helper: bootstrap an on-chain profile (called from API after SIWE).
create or replace function public.bootstrap_onchain_profile(
  p_address text,
  p_chain_id int,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_handle text;
  v_agent_handle text;
  v_base text;
  v_agent_id uuid;
  v_addr text := lower(p_address);
begin
  -- Reuse existing profile for this address
  select wi.user_id into v_profile_id
  from wallet_identities wi
  where lower(wi.address) = v_addr
  limit 1;

  if v_profile_id is not null then
    update profiles set primary_chain_id = p_chain_id, updated_at = now() where id = v_profile_id;
    update wallet_identities
      set chain_id = p_chain_id, verified_at = now(), profile_id = v_profile_id
      where lower(address) = v_addr;
    return v_profile_id;
  end if;

  v_base := 'w' || substr(regexp_replace(v_addr, '^0x', ''), 1, 8);
  v_handle := v_base;
  while exists (select 1 from profiles where handle = v_handle) loop
    v_handle := v_base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  v_agent_handle := upper(substr(v_handle, 1, 10));
  while exists (select 1 from agent_identities where handle = v_agent_handle) loop
    v_agent_handle := upper(substr(v_handle, 1, 6) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 3));
  end loop;

  insert into profiles (
    id, auth_user_id, handle, display_name, league,
    active_arena_mode, profile_kind, primary_chain_id
  ) values (
    gen_random_uuid(),
    null,
    v_handle,
    coalesce(nullif(trim(p_display_name), ''), 'Wallet ' || substr(v_addr, 1, 6) || '…' || substr(v_addr, -4)),
    'bronze',
    'onchain',
    'onchain',
    p_chain_id
  )
  returning id into v_profile_id;

  insert into wallets (user_id, chain, label, arena_mode, address)
  values (v_profile_id, case when p_chain_id = 8453 then 'base' else 'base-sepolia' end, 'primary', 'onchain', v_addr);

  insert into ledger_accounts (owner_id, kind, currency, label, arena_mode) values
    (v_profile_id, 'user_available', 'USDC', 'available', 'onchain'),
    (v_profile_id, 'user_table_escrow', 'USDC', 'escrow', 'onchain');

  insert into wallet_identities (user_id, profile_id, chain_id, address, verified_at)
  values (v_profile_id, v_profile_id, p_chain_id, v_addr, now())
  on conflict (chain_id, address) do update
    set user_id = excluded.user_id,
        profile_id = excluded.profile_id,
        verified_at = now();

  -- Unique on address alone may conflict with (chain_id, address) — also try address-only path
  insert into agent_identities (id, owner_id, handle, display_name, glyph, color, current_version)
  values (gen_random_uuid(), v_profile_id, v_agent_handle, v_agent_handle, '◆', '#00E676', 'v1')
  returning id into v_agent_id;

  insert into agent_versions (agent_id, version, notes, config_hash)
  values (v_agent_id, 'v1', 'On-chain agent', 'cfg_v1');

  insert into agent_configs (agent_id, profile_key, risk, instruction, is_active)
  values (v_agent_id, 'fox', 'balanced', null, true);

  insert into ratings (agent_id, variant_id, elo, hands_played, profit)
  values (v_agent_id, 'nlhe_6max', 1500, 0, 0);

  insert into user_settings (user_id) values (v_profile_id);

  insert into notifications (user_id, title, body, href)
  values (
    v_profile_id,
    'On-chain account ready',
    'Deposit Base USDC into ArenaVault to play real-money tables. This account is separate from Demo.',
    '/wallet'
  );

  return v_profile_id;
end;
$$;
