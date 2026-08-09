-- Per-city HU Arena Rating pools (Berlin → Monaco) plus clearer combined label.
-- Casual (Porto) stays unrated — no city pool.
-- Combined ranked skill remains hu_holdem_standard (updated alongside each city pool).

insert into public.rating_pools (id, label, game, format, model_class, description) values
  ('hu_holdem_city_bronze',   'Berlin',     'holdem', 'hu', 'standard', 'Ranked HU results in Berlin ($0.50/$1)'),
  ('hu_holdem_city_silver',   'London',     'holdem', 'hu', 'standard', 'Ranked HU results in London ($1/$2)'),
  ('hu_holdem_city_gold',     'Singapore',  'holdem', 'hu', 'standard', 'Ranked HU results in Singapore ($2.50/$5)'),
  ('hu_holdem_city_platinum', 'Dubai',      'holdem', 'hu', 'standard', 'Ranked HU results in Dubai ($5/$10)'),
  ('hu_holdem_city_diamond',  'Monaco',     'holdem', 'hu', 'standard', 'Ranked HU results in Monaco ($25/$50)')
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description;

update public.rating_pools
set label = 'Arena Rating (combined)',
    description = 'Combined ranked HU Arena Rating across Berlin → Monaco. Stake size never scales Glicko.'
where id = 'hu_holdem_standard';

-- Seed empty rows for existing profiles so UI never 404s a city pool.
insert into public.account_ratings (owner_id, pool_id)
select p.id, rp.id
from public.profiles p
cross join public.rating_pools rp
where rp.id like 'hu_holdem_city_%'
on conflict (owner_id, pool_id) do nothing;
