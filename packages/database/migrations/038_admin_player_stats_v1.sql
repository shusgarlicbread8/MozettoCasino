-- MC-043: read-only player reporting projection for Mozetto Control.
-- NOT authoritative for balances — operator speed read model only.

create or replace view admin_player_stats_v1 as
with onchain_available as (
  select
    a.owner_id,
    coalesce(sum(e.amount), 0)::numeric(18, 6) as balance
  from ledger_accounts a
  left join ledger_entries e on e.account_id = a.id
  where a.kind = 'user_available'
    and a.arena_mode = 'onchain'
  group by a.owner_id
),
onchain_escrow as (
  select
    a.owner_id,
    coalesce(sum(e.amount), 0)::numeric(18, 6) as balance
  from ledger_accounts a
  left join ledger_entries e on e.account_id = a.id
  where a.kind = 'user_table_escrow'
    and a.arena_mode = 'onchain'
  group by a.owner_id
),
player_rake as (
  select
    osp.profile_id,
    coalesce(sum(latest_rake.rake), 0)::numeric(18, 6) as rake_contributed_usdc
  from onchain_session_players osp
  join lateral (
    select bl.cumulative_rake as rake
    from balance_leaves bl
    where bl.session_id = osp.session_id
      and lower(bl.wallet_address) = lower(osp.wallet_address)
    order by bl.sequence desc
    limit 1
  ) latest_rake on true
  where osp.profile_id is not null
  group by osp.profile_id
),
player_sessions as (
  select
    osp.profile_id,
    count(distinct osp.session_id)::int as session_count,
    max(coalesce(os.opened_at, os.created_at)) as last_session_at
  from onchain_session_players osp
  left join onchain_sessions os on os.session_id = osp.session_id
  where osp.profile_id is not null
  group by osp.profile_id
),
player_hands as (
  select
    osp.profile_id,
    count(distinct hr.hand_id)::int as hands_played
  from onchain_session_players osp
  join hand_roots hr on hr.session_id = osp.session_id
  where osp.profile_id is not null
  group by osp.profile_id
),
vault_dep as (
  select
    profile_id,
    coalesce(sum(amount_usdc), 0)::numeric(18, 6) as total
  from vault_deposits
  where profile_id is not null
  group by profile_id
),
vault_wdr as (
  select
    profile_id,
    coalesce(sum(amount_usdc), 0)::numeric(18, 6) as total
  from vault_withdrawals
  where profile_id is not null
  group by profile_id
),
primary_wallet as (
  select distinct on (user_id)
    user_id,
    address
  from wallets
  where arena_mode = 'onchain'
    and address is not null
  order by user_id, created_at
),
primary_arena as (
  select distinct on (profile_id)
    profile_id,
    arena_account_address
  from arena_accounts
  order by profile_id, created_at
),
hu_rating as (
  select
    owner_id,
    rating,
    matches_played,
    hands_played,
    profit,
    provisional
  from account_ratings
  where pool_id = 'hu_holdem_standard'
)
select
  p.id as profile_id,
  p.handle,
  p.display_name,
  p.profile_kind::text as profile_kind,
  pw.address as wallet_address,
  pa.arena_account_address,
  coalesce(oa.balance, 0) as current_available_usdc,
  coalesce(oe.balance, 0) as at_tables_usdc,
  coalesce(vd.total, 0) as lifetime_deposits_usdc,
  coalesce(vw.total, 0) as lifetime_withdrawals_usdc,
  hr.profit as session_net_usdc,
  coalesce(pr.rake_contributed_usdc, 0) as rake_contributed_usdc,
  coalesce(ph.hands_played, hr.hands_played, 0) as hands,
  coalesce(ps.session_count, 0) as sessions,
  hr.rating as rating,
  hr.provisional as rating_provisional,
  hr.matches_played as rating_matches,
  greatest(p.updated_at, ps.last_session_at) as last_active_at,
  p.created_at as profile_created_at
from profiles p
left join primary_wallet pw on pw.user_id = p.id
left join primary_arena pa on pa.profile_id = p.id
left join onchain_available oa on oa.owner_id = p.id
left join onchain_escrow oe on oe.owner_id = p.id
left join player_rake pr on pr.profile_id = p.id
left join player_sessions ps on ps.profile_id = p.id
left join player_hands ph on ph.profile_id = p.id
left join vault_dep vd on vd.profile_id = p.id
left join vault_wdr vw on vw.profile_id = p.id
left join hu_rating hr on hr.owner_id = p.id;

comment on view admin_player_stats_v1 is
  'MC-043 read-only player reporting projection. NOT authoritative for balances.';

-- Grant read to application roles when present.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mozetto_api') then
    grant select on admin_player_stats_v1 to mozetto_api;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on admin_player_stats_v1 to service_role;
  end if;
exception
  when insufficient_privilege then null;
end $$;
