-- Cities replace the Bronze/Silver/Gold ladder as the stake definition.
--
-- The table's blind level determines how much money may enter the game; a
-- player's bankroll never raises that ceiling. Each city fixes its blinds and
-- accepts buy-ins from 40BB to 100BB. `leagues.min_buy_in` therefore now means
-- the city's 40BB FLOOR, not a single fixed entry amount.
--
-- The `id` values are unchanged on purpose: they are carried by `tables.league_id`
-- and by minted seat tickets, so renaming them would churn settlement history
-- for no functional gain. Only the display name and stakes change.
--
-- Canonical source of truth is CITIES in @mozetto/game-rules/cities.ts — this
-- migration exists so the legacy `/v1/leagues` endpoint cannot disagree with it.

alter table leagues add column if not exists small_blind numeric(18, 2);
alter table leagues add column if not exists big_blind numeric(18, 2);
alter table leagues add column if not exists max_buy_in numeric(18, 2);

insert into leagues (id, name, color, min_buy_in, sort_order) values
  ('casual',   'Porto',     '#9AA88A',   20, 0),
  ('bronze',   'Berlin',    '#B87333',   40, 1),
  ('silver',   'London',    '#B8C0C8',   80, 2),
  ('gold',     'Singapore', '#C9A227',  200, 3),
  ('platinum', 'Dubai',     '#8FE3D2',  400, 4),
  ('diamond',  'Monaco',    '#8FB8FF', 2000, 5)
on conflict (id) do update set
  name       = excluded.name,
  color      = excluded.color,
  min_buy_in = excluded.min_buy_in,
  sort_order = excluded.sort_order;

-- Stakes and the 100BB ceiling, kept in step with cities.ts.
update leagues set small_blind = 0.25, big_blind =  0.50, max_buy_in =   50 where id = 'casual';
update leagues set small_blind = 0.50, big_blind =  1.00, max_buy_in =  100 where id = 'bronze';
update leagues set small_blind = 1.00, big_blind =  2.00, max_buy_in =  200 where id = 'silver';
update leagues set small_blind = 2.50, big_blind =  5.00, max_buy_in =  500 where id = 'gold';
update leagues set small_blind = 5.00, big_blind = 10.00, max_buy_in = 1000 where id = 'platinum';
update leagues set small_blind =25.00, big_blind = 50.00, max_buy_in = 5000 where id = 'diamond';

-- Sovereign is not part of the Season 1 city ladder. Remove it only when no
-- table still references it: `tables.league_id` has a foreign key to
-- `leagues(id)`, and 002_seed.sql seeds an (inactive) Sovereign demo table, so
-- an unconditional delete aborts a from-zero migration with an FK violation.
--
-- Retire the seeded demo table first, then drop the league if it is now
-- unreferenced. A Sovereign row that some other table still points at is left
-- in place and simply never surfaces, because CITIES drives the lobby.
delete from table_seats
where table_id in (select id from tables where league_id = 'sovereign' and created_by is null);

delete from tables
where league_id = 'sovereign'
  and created_by is null
  and not exists (select 1 from table_sessions ts where ts.table_id = tables.id);

delete from leagues l
where l.id = 'sovereign'
  and not exists (select 1 from tables t where t.league_id = l.id);
