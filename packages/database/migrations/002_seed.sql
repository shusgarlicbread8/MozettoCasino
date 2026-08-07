-- Seed reference data + demo owner (VELVET) with fake USDC ledger

insert into games (id, name, category, status, sort_order) values
  ('holdem', 'Poker', 'poker', 'enabled', 1),
  ('plo', 'Pot-Limit Omaha', 'poker', 'coming_soon', 2),
  ('shortdeck', 'Short Deck', 'poker', 'coming_soon', 3),
  ('blackjack', 'Blackjack', 'casino', 'coming_soon', 4),
  ('three_card_poker', 'Three Card Poker', 'casino', 'coming_soon', 5),
  ('tournaments', 'Tournaments', 'tournament', 'coming_soon', 6)
on conflict (id) do update set status = excluded.status, name = excluded.name;

insert into game_variants (id, game_id, name, status, max_seats, metadata) values
  ('nlhe_6max', 'holdem', 'Poker (Classic)', 'enabled', 6, '{"format":"6-max","product":"poker_classic"}'),
  ('nlhe_hu', 'holdem', 'Texas Hold''em', 'enabled', 2, '{"format":"hu","product":"texas_holdem"}'),
  ('plo_6max', 'plo', '6-Max PLO', 'coming_soon', 6, '{}'),
  ('shortdeck_6max', 'shortdeck', 'Short Deck', 'coming_soon', 6, '{}'),
  ('bj_standard', 'blackjack', 'Blackjack', 'coming_soon', 1, '{}'),
  ('tcp_standard', 'three_card_poker', 'Three Card Poker', 'coming_soon', 1, '{}')
on conflict (id) do update set status = excluded.status, name = excluded.name, max_seats = excluded.max_seats, metadata = excluded.metadata;

insert into leagues (id, name, color, min_buy_in, sort_order) values
  ('bronze', 'Bronze', '#B87333', 10, 1),
  ('silver', 'Silver', '#B8C0C8', 50, 2),
  ('gold', 'Gold', '#C9A227', 250, 3),
  ('platinum', 'Platinum', '#8FE3D2', 1000, 4),
  ('diamond', 'Diamond', '#8FB8FF', 5000, 5),
  ('sovereign', 'Sovereign', '#C89BFF', 25000, 6)
on conflict (id) do update set color = excluded.color, min_buy_in = excluded.min_buy_in;

-- Demo user
insert into profiles (id, handle, display_name, league)
values ('11111111-1111-1111-1111-111111111111', 'velvet-owner', 'Velvet Owner', 'gold')
on conflict (id) do nothing;

insert into agent_identities (id, owner_id, handle, display_name, glyph, color, current_version)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'VELVET', 'VELVET', '◆', '#00E676', 'v4')
on conflict (handle) do nothing;

insert into agent_versions (agent_id, version, notes, config_hash)
select '22222222-2222-2222-2222-222222222222', v, n, h
from (values
  ('v1', 'Initial personality', 'cfg_v1'),
  ('v2', 'Tighter preflop', 'cfg_v2'),
  ('v3', 'Improved river bluffs', 'cfg_v3'),
  ('v4', 'Current production', 'cfg_v4')
) as t(v, n, h)
on conflict do nothing;

insert into agent_configs (id, agent_id, profile_key, risk, instruction, is_active)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'fox',
  'balanced',
  'Prefer semi-bluffs on flush draws. Avoid spewy rivers.',
  true
)
on conflict do nothing;

-- Rival agents (system-owned for bot seats)
insert into profiles (id, handle, display_name, league) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'system', 'System', 'diamond')
on conflict (id) do nothing;

insert into agent_identities (id, owner_id, handle, display_name, glyph, color, current_version) values
  ('b1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'KESTREL', 'KESTREL', '▲', '#8FB8FF', 'v3'),
  ('b2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ORBIT', 'ORBIT', '●', '#FFB020', 'v2'),
  ('b3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'GLASS', 'GLASS', '◇', '#8FE3D2', 'v2'),
  ('b4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ARBOR', 'ARBOR', '▣', '#B87333', 'v1'),
  ('b5555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NULLSET', 'NULLSET', '⊘', '#FF5252', 'v5'),
  ('b6666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'VANTA-7', 'VANTA-7', '⬢', '#C89BFF', 'v7')
on conflict (handle) do nothing;

insert into agent_configs (agent_id, profile_key, risk, is_active)
select id,
  case handle
    when 'KESTREL' then 'shark'
    when 'ORBIT' then 'professor'
    when 'GLASS' then 'machine'
    when 'ARBOR' then 'fox'
    when 'NULLSET' then 'shark'
    else 'machine'
  end,
  'balanced',
  true
from agent_identities
where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
on conflict do nothing;

-- Ledger accounts for demo user
insert into ledger_accounts (id, owner_id, kind, currency, label) values
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'user_available', 'USDC', 'available'),
  ('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'user_table_escrow', 'USDC', 'escrow'),
  ('c3333333-3333-3333-3333-333333333333', null, 'platform_rake', 'USDC', 'rake'),
  ('c4444444-4444-4444-4444-444444444444', null, 'system_clearing', 'USDC', 'clearing')
on conflict do nothing;

-- Fund demo wallet: 7400 USDC via clearing
insert into ledger_transactions (id, idempotency_key, description, status, reference_type, reference_id)
values (
  'd1111111-1111-1111-1111-111111111111',
  'seed-fund-velvet-7400',
  'Initial fake USDC deposit',
  'posted',
  'deposit',
  'seed'
)
on conflict (idempotency_key) do nothing;

insert into ledger_entries (transaction_id, account_id, amount)
select 'd1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', -7400
where not exists (
  select 1 from ledger_entries where transaction_id = 'd1111111-1111-1111-1111-111111111111'
);
insert into ledger_entries (transaction_id, account_id, amount)
select 'd1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 7400
where (select count(*) from ledger_entries where transaction_id = 'd1111111-1111-1111-1111-111111111111') = 1;

-- NLHE tables
insert into tables (
  id, name, variant_id, league_id, small_blind, big_blind, min_buy_in, max_buy_in,
  max_seats, rake_pct, rake_cap, privacy, pace, is_active
) values
  ('tbl_monaco_12', 'Monaco 12', 'nlhe_6max', 'gold', 25, 50, 1000, 10000, 6, 0.025, 20, 'public', 'normal', false),
  ('tbl_emerald_4', 'Emerald 4', 'nlhe_6max', 'silver', 5, 10, 200, 1000, 6, 0.025, 5, 'public', 'fast', false),
  ('tbl_harbour_9', 'Harbour 9', 'nlhe_6max', 'gold', 10, 20, 400, 2000, 6, 0.025, 10, 'public', 'normal', false),
  ('tbl_viper_high', 'Viper High', 'nlhe_6max', 'platinum', 50, 100, 2000, 20000, 6, 0.025, 40, 'public', 'normal', false),
  ('tbl_seoul_2', 'Seoul 2', 'nlhe_6max', 'bronze', 1, 2, 40, 200, 6, 0.05, 2, 'public', 'fast', false),
  ('tbl_meridian_private', 'Meridian Private', 'nlhe_6max', 'sovereign', 200, 400, 10000, 100000, 6, 0.02, 100, 'invite_only', 'normal', false)
on conflict (id) do update set is_active = excluded.is_active;

update tables set invite_code = 'MERIDIAN' where id = 'tbl_meridian_private' and invite_code is null;

-- Pre-create seats
insert into table_seats (table_id, seat_index, status)
select t.id, s.i, 'empty'
from tables t
cross join generate_series(0, 5) as s(i)
where t.variant_id = 'nlhe_6max'
on conflict (table_id, seat_index) do nothing;

-- Demo bot seating removed — lobby only shows player-created tables (see 006_real_tables_only.sql).

insert into ratings (agent_id, variant_id, elo, hands_played, profit) values
  ('22222222-2222-2222-2222-222222222222', 'nlhe_6max', 1620, 1280, 12400),
  ('b1111111-1111-1111-1111-111111111111', 'nlhe_6max', 1710, 5400, 42000),
  ('b5555555-5555-5555-5555-555555555555', 'nlhe_6max', 1840, 9200, 88000),
  ('b6666666-6666-6666-6666-666666666666', 'nlhe_6max', 1905, 11000, 102000)
on conflict (agent_id, variant_id) do update set elo = excluded.elo;

insert into notifications (user_id, title, body, href)
select * from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Welcome to Mozetto', 'Your fake USDC wallet is funded. Join Monaco 12 to play NLHE.', '/poker'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'NLHE is live', 'PLO, Short Deck, and casino games are Coming Soon.', '/poker')
) as v(user_id, title, body, href)
where not exists (select 1 from notifications n where n.user_id = v.user_id and n.title = v.title);

insert into user_settings (user_id) values ('11111111-1111-1111-1111-111111111111')
on conflict do nothing;
