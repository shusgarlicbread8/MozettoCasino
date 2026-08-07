-- Split products: Poker (Classic) = 6-max NLHE; Texas Hold'em = heads-up only.

-- Catalogue labels
update games
set name = 'Poker'
where id = 'holdem';

update game_variants
set name = 'Poker (Classic)',
    max_seats = 6,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"format":"6-max","product":"poker_classic"}'::jsonb
where id = 'nlhe_6max';

insert into game_variants (id, game_id, name, status, max_seats, metadata)
values (
  'nlhe_hu',
  'holdem',
  'Texas Hold''em',
  'enabled',
  2,
  '{"format":"hu","product":"texas_holdem"}'::jsonb
)
on conflict (id) do update
set name = excluded.name,
    status = excluded.status,
    max_seats = excluded.max_seats,
    metadata = excluded.metadata;

-- Rating pool display names
update rating_pools
set label = 'Texas Hold''em',
    description = 'Heads-up Texas Hold''em ranked matches'
where id = 'hu_holdem_standard';

update rating_pools
set label = 'Poker (Classic)',
    description = 'Multiway Poker (Classic) 6-max'
where id = 'nlhe_6max_standard';

-- Arena tables created as HU but tagged nlhe_6max → correct variant
update tables
set variant_id = 'nlhe_hu'
where max_seats = 2
  and variant_id = 'nlhe_6max';
