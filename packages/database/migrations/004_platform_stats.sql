-- Platform stats + helper indexes for real lobby/live counts

create or replace view public.platform_stats as
select
  (select count(*)::int from tables where is_active = true) as active_tables,
  (select count(*)::int from table_seats where status = 'occupied') as occupied_seats,
  (select count(*)::int from table_sessions where status = 'active') as active_sessions,
  (select count(*)::int from hands where status = 'settled') as settled_hands,
  (select count(*)::int from profiles) as profiles,
  (select count(*)::int from agent_identities) as agents;

create index if not exists table_seats_occupied_idx on table_seats (table_id) where status = 'occupied';
create index if not exists tables_active_variant_idx on tables (variant_id, is_active);
create index if not exists hands_settled_at_idx on hands (settled_at desc nulls last);
create index if not exists table_sessions_owner_active_idx on table_sessions (owner_id) where status = 'active';

-- Allow authenticated users to read public lobby tables (RLS already on; ensure select policy)
drop policy if exists tables_select_public on tables;
create policy tables_select_public on tables for select using (true);

drop policy if exists seats_select_public on table_seats;
create policy seats_select_public on table_seats for select using (true);
