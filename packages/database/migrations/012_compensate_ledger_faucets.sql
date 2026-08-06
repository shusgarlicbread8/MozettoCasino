-- Compensate historical unbacked on-chain faucet / welcome ledger credits.
-- Preserves original audit rows; posts reversing double-entry transfers.

do $$
declare
  r record;
  available_id uuid;
  clearing_id uuid;
  amount numeric;
  tx_id uuid;
begin
  for r in
    select t.id, t.idempotency_key, t.reference_id, a.owner_id as profile_id, e.amount
    from ledger_transactions t
    join ledger_entries e on e.transaction_id = t.id
    join ledger_accounts a on a.id = e.account_id
    where (
         t.reference_type = 'faucet'
      or t.idempotency_key like 'onchain-deposit-onchain-faucet-%'
      or t.idempotency_key like 'onchain-deposit-welcome-faucet-%'
      or t.reference_id like 'onchain-faucet-%'
      or t.reference_id like 'welcome-faucet-%'
    )
      and a.kind = 'user_available'
      and a.arena_mode = 'onchain'
      and e.amount > 0
  loop
    if exists (
      select 1 from ledger_transactions
      where idempotency_key = 'compensate-faucet-' || r.id::text
    ) then
      continue;
    end if;

    amount := r.amount;
    if amount is null or amount <= 0 or r.profile_id is null then
      continue;
    end if;

    select id into available_id
    from ledger_accounts
    where owner_id = r.profile_id and kind = 'user_available' and arena_mode = 'onchain'
    limit 1;

    select id into clearing_id
    from ledger_accounts
    where owner_id is null and kind = 'system_clearing' and arena_mode = 'onchain'
    limit 1;

    if available_id is null or clearing_id is null then
      continue;
    end if;

    tx_id := gen_random_uuid();
    insert into ledger_transactions (id, idempotency_key, description, status, reference_type, reference_id)
    values (
      tx_id,
      'compensate-faucet-' || r.id::text,
      'Compensate unbacked faucet credit ' || coalesce(r.reference_id, r.idempotency_key),
      'posted',
      'faucet_compensation',
      r.id::text
    );
    insert into ledger_entries (transaction_id, account_id, amount) values (tx_id, available_id, -amount);
    insert into ledger_entries (transaction_id, account_id, amount) values (tx_id, clearing_id, amount);
  end loop;
end $$;
