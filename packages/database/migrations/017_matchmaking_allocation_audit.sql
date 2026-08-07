-- WP-040: audit trail for ranked random matchmaking decisions.
-- Stores enough to reconstruct why a player was allocated (or not) without
-- exposing anti-fraud secrets publicly.

create table if not exists matchmaking_allocation_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  league_id text not null,
  format text not null check (format in ('hu', 'classic')),
  arena_mode text not null,
  chain_id int,
  pool_key text not null,
  decision text not null
    check (decision in (
      'reuse_session',
      'join_existing',
      'create_table',
      'rejected'
    )),
  table_id text,
  reason_code text not null,
  candidate_count int not null default 0,
  eligible_count int not null default 0,
  rejected jsonb not null default '[]'::jsonb,
  seat_order int[],
  trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists matchmaking_allocation_log_profile_idx
  on matchmaking_allocation_log (profile_id, created_at desc);

create index if not exists matchmaking_allocation_log_pool_idx
  on matchmaking_allocation_log (pool_key, created_at desc);

create index if not exists matchmaking_allocation_log_table_idx
  on matchmaking_allocation_log (table_id, created_at desc)
  where table_id is not null;

alter table matchmaking_allocation_log enable row level security;

drop policy if exists matchmaking_allocation_log_service on matchmaking_allocation_log;
create policy matchmaking_allocation_log_service on matchmaking_allocation_log
  for all using (true) with check (true);
