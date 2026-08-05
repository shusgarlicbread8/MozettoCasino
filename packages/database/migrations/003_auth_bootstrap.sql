-- Bootstrap profile + ledger + default AI when a Supabase auth user is created
create extension if not exists pgcrypto;

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

  insert into profiles (id, auth_user_id, handle, display_name, league)
  values (gen_random_uuid(), new.id, v_handle, coalesce(new.raw_user_meta_data->>'display_name', initcap(v_base)), 'bronze')
  returning id into v_profile_id;

  insert into wallets (user_id, chain, label) values (v_profile_id, 'base-sepolia', 'primary');

  insert into ledger_accounts (owner_id, kind, currency, label) values
    (v_profile_id, 'user_available', 'USDC', 'available'),
    (v_profile_id, 'user_table_escrow', 'USDC', 'escrow');

  -- starter fake USDC so new accounts can join tables immediately
  insert into ledger_transactions (idempotency_key, description, status, reference_type, reference_id)
  values ('signup-fund-' || v_profile_id::text, 'Welcome fake USDC deposit', 'posted', 'deposit', 'signup');

  insert into ledger_entries (transaction_id, account_id, amount)
  select t.id, a.id, -5000
  from ledger_transactions t, ledger_accounts a
  where t.idempotency_key = 'signup-fund-' || v_profile_id::text
    and a.kind = 'system_clearing' and a.label = 'clearing';

  insert into ledger_entries (transaction_id, account_id, amount)
  select t.id, a.id, 5000
  from ledger_transactions t, ledger_accounts a
  where t.idempotency_key = 'signup-fund-' || v_profile_id::text
    and a.owner_id = v_profile_id and a.kind = 'user_available';

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
  values (v_profile_id, 'Welcome to Mozetto', 'Your account is funded with $5,000 fake USDC. Join a Hold’em table to begin.', '/poker');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Allow authenticated users to read/update their own profile row via auth mapping
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update
  using (auth_user_id = auth.uid());
