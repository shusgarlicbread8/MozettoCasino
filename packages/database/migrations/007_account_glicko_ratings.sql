-- Account-owned Glicko-2 Arena Ratings.
-- Agents are loadouts; they do not own matchmaking ratings.

create table if not exists public.rating_pools (
  id text primary key,
  label text not null,
  game text not null,          -- holdem | omaha | tournament | reputation
  format text not null,        -- hu | 6max | mtt | account
  model_class text not null default 'standard', -- standard | open
  description text
);

insert into public.rating_pools (id, label, game, format, model_class, description) values
  ('hu_holdem_standard', 'Texas Hold''em', 'holdem', 'hu', 'standard', 'Heads-up Texas Hold''em ranked matches'),
  ('nlhe_6max_standard', 'Poker (Classic)', 'holdem', '6max', 'standard', 'Multiway Poker (Classic) 6-max'),
  ('hu_omaha_standard', 'Heads-Up Omaha', 'omaha', 'hu', 'standard', 'Heads-up Pot-Limit Omaha'),
  ('tournament_standard', 'Tournament', 'tournament', 'mtt', 'standard', 'Scheduled poker tournaments'),
  ('reputation', 'Overall Reputation', 'reputation', 'account', 'standard', 'Reliability / account history')
on conflict (id) do nothing;

create table if not exists public.account_ratings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  pool_id text not null references public.rating_pools(id),
  -- Glicko-2 (display scale ~ Elo)
  rating numeric(10,4) not null default 1500,
  rd numeric(10,4) not null default 350,          -- rating deviation
  volatility numeric(12,8) not null default 0.06,
  matches_played int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  hands_played int not null default 0,
  profit numeric(18,2) not null default 0,
  provisional boolean not null default true,
  last_rated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, pool_id)
);

create index if not exists account_ratings_pool_rating_idx
  on public.account_ratings (pool_id, rating desc);

create table if not exists public.rated_matches (
  id uuid primary key default gen_random_uuid(),
  pool_id text not null references public.rating_pools(id),
  table_id text references public.tables(id) on delete set null,
  -- Owners (accounts), not agents
  owner_a uuid not null references public.profiles(id),
  owner_b uuid not null references public.profiles(id),
  agent_a uuid references public.agent_identities(id),
  agent_b uuid references public.agent_identities(id),
  score_a numeric(3,1) not null, -- 1 | 0.5 | 0 from A's perspective
  weight numeric(4,2) not null default 1.0,
  hands int not null default 0,
  stake numeric(18,2),
  status text not null default 'settled', -- settled | void | aborted
  reason text,
  event_log_root text,
  rated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (owner_a <> owner_b),
  check (score_a in (0, 0.5, 1))
);

create index if not exists rated_matches_owners_idx on public.rated_matches (owner_a, owner_b, rated_at desc);
create index if not exists rated_matches_pool_idx on public.rated_matches (pool_id, rated_at desc);

create table if not exists public.rating_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  pool_id text not null references public.rating_pools(id),
  match_id uuid references public.rated_matches(id) on delete set null,
  rating numeric(10,4) not null,
  rd numeric(10,4) not null,
  volatility numeric(12,8) not null,
  recorded_at timestamptz not null default now()
);

create index if not exists rating_history_owner_pool_idx
  on public.rating_history (owner_id, pool_id, recorded_at);

-- Opportunity-adjusted aggression / style metrics (descriptive, not skill).
create table if not exists public.aggression_stats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  pool_id text not null references public.rating_pools(id),
  agent_id uuid references public.agent_identities(id) on delete set null,
  -- Raw opportunity counts
  opportunities_preflop int not null default 0,
  raises_preflop int not null default 0,
  opportunities_3bet int not null default 0,
  three_bets int not null default 0,
  opportunities_steal int not null default 0,
  steals int not null default 0,
  opportunities_postflop int not null default 0,
  bets_raises_postflop int not null default 0,
  opportunities_vs_bet int not null default 0,
  raises_vs_bet int not null default 0,
  sizing_samples int not null default 0,
  sizing_sum numeric(18,4) not null default 0,
  opportunities_allin int not null default 0,
  allins int not null default 0,
  hands int not null default 0,
  -- Composite 0–100 (Bayesian-shrunk)
  aggression numeric(6,2) not null default 50,
  preflop_pressure numeric(6,2) not null default 50,
  postflop_pressure numeric(6,2) not null default 50,
  bet_sizing_intensity numeric(6,2) not null default 50,
  volatility_score numeric(6,2) not null default 50,
  updated_at timestamptz not null default now(),
  unique (owner_id, pool_id, agent_id)
);

create index if not exists aggression_stats_owner_idx on public.aggression_stats (owner_id, pool_id);

-- Per-agent descriptive records (not matchmaking identity).
create table if not exists public.agent_records (
  agent_id uuid primary key references public.agent_identities(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  hands int not null default 0,
  profit numeric(18,2) not null default 0,
  aggression numeric(6,2) not null default 50,
  profile_key text,
  updated_at timestamptz not null default now()
);

alter table public.account_ratings enable row level security;
alter table public.rated_matches enable row level security;
alter table public.rating_history enable row level security;
alter table public.aggression_stats enable row level security;
alter table public.agent_records enable row level security;
alter table public.rating_pools enable row level security;

drop policy if exists account_ratings_select on public.account_ratings;
create policy account_ratings_select on public.account_ratings for select using (true);
drop policy if exists rated_matches_select on public.rated_matches;
create policy rated_matches_select on public.rated_matches for select using (true);
drop policy if exists rating_history_select on public.rating_history;
create policy rating_history_select on public.rating_history for select using (true);
drop policy if exists aggression_stats_select on public.aggression_stats;
create policy aggression_stats_select on public.aggression_stats for select using (true);
drop policy if exists agent_records_select on public.agent_records;
create policy agent_records_select on public.agent_records for select using (true);
drop policy if exists rating_pools_select on public.rating_pools;
create policy rating_pools_select on public.rating_pools for select using (true);

-- Bootstrap every profile into default pools (account-owned).
insert into public.account_ratings (owner_id, pool_id)
select p.id, pool.id
from public.profiles p
cross join public.rating_pools pool
on conflict (owner_id, pool_id) do nothing;

-- Seed history point at current rating for charts.
insert into public.rating_history (owner_id, pool_id, rating, rd, volatility)
select owner_id, pool_id, rating, rd, volatility
from public.account_ratings ar
where not exists (
  select 1 from public.rating_history h
  where h.owner_id = ar.owner_id and h.pool_id = ar.pool_id
);

-- Agent records from identities + active profile key.
insert into public.agent_records (agent_id, owner_id, profile_key)
select a.id, a.owner_id, c.profile_key
from public.agent_identities a
left join public.agent_configs c on c.agent_id = a.id and c.is_active = true
on conflict (agent_id) do update set profile_key = excluded.profile_key;

-- Backfill hands / profit from completed sessions into 6-max pool (descriptive).
with sess as (
  select
    s.owner_id,
    count(*)::int as sessions,
    coalesce(sum(greatest(0, s.stack - s.buy_in)), 0) as profit_pos,
    coalesce(sum(least(0, s.stack - s.buy_in)), 0) as profit_neg
  from public.table_sessions s
  where s.status in ('completed', 'active')
  group by s.owner_id
)
update public.account_ratings ar
set profit = coalesce((select profit_pos + profit_neg from sess where sess.owner_id = ar.owner_id), ar.profit),
    updated_at = now()
where ar.pool_id in ('nlhe_6max_standard', 'hu_holdem_standard');

-- Approximate hands from settled hands at tables the owner sat.
with owner_hands as (
  select ts.owner_id, count(distinct h.id)::int as hands
  from public.hands h
  join public.table_sessions ts on ts.table_id = h.table_id
  where h.status = 'settled'
  group by ts.owner_id
)
update public.account_ratings ar
set hands_played = greatest(ar.hands_played, coalesce((select hands from owner_hands oh where oh.owner_id = ar.owner_id), 0)),
    updated_at = now()
where ar.pool_id in ('nlhe_6max_standard', 'hu_holdem_standard');
