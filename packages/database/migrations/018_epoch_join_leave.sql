-- WP-042: continuous cash-table epoch rotation — queued joins/leaves/top-ups.
-- Participant mutation applies only at epoch boundaries (between hands).
-- On-chain reseal of Epoch N+1 roots is deferred (no ArenaVault fights with WP-025).

create table if not exists table_epochs (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references tables(id) on delete cascade,
  epoch_number bigint not null check (epoch_number >= 1),
  status text not null default 'open'
    check (status in ('open', 'active', 'closing', 'closed')),
  hand_number_start bigint,
  hand_number_end bigint,
  -- Audit snapshot of seated owners/seats at epoch open (not a PROTOCOL root).
  participant_snapshot jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (table_id, epoch_number)
);

create index if not exists table_epochs_table_status_idx
  on table_epochs (table_id, status);

create index if not exists table_epochs_table_epoch_idx
  on table_epochs (table_id, epoch_number desc);

create table if not exists queued_seat_changes (
  id uuid primary key default gen_random_uuid(),
  table_id text not null references tables(id) on delete cascade,
  -- Epoch that will receive this change (current open epoch when between hands,
  -- or current+1 when queued mid-hand for the next boundary).
  target_epoch bigint not null check (target_epoch >= 1),
  change_type text not null check (change_type in ('join', 'leave', 'top_up')),
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'cancelled', 'rejected')),
  owner_id uuid not null references profiles(id),
  agent_id uuid references agent_identities(id),
  agent_config_id uuid references agent_configs(id),
  seat_index int check (seat_index is null or seat_index between 0 and 8),
  amount numeric(18,2),
  profile_key text,
  payload jsonb not null default '{}'::jsonb,
  reject_reason text,
  idempotency_key text,
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (table_id, idempotency_key)
);

create index if not exists queued_seat_changes_pending_idx
  on queued_seat_changes (table_id, target_epoch, status)
  where status = 'pending';

create index if not exists queued_seat_changes_owner_idx
  on queued_seat_changes (owner_id, requested_at desc);

alter table table_epochs enable row level security;
alter table queued_seat_changes enable row level security;

drop policy if exists table_epochs_service on table_epochs;
create policy table_epochs_service on table_epochs
  for all using (true) with check (true);

drop policy if exists queued_seat_changes_service on queued_seat_changes;
create policy queued_seat_changes_service on queued_seat_changes
  for all using (true) with check (true);
