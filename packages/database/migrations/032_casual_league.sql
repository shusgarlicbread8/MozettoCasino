-- Casual (unranked) league — same find-match / custody flow as Bronze stakes,
-- but seat tickets mint rated=false and Glicko settlement is skipped.
insert into leagues (id, name, color, min_buy_in, sort_order) values
  ('casual', 'Casual', '#9AA88A', 100, 0)
on conflict (id) do update set
  name = excluded.name,
  color = excluded.color,
  min_buy_in = excluded.min_buy_in,
  sort_order = excluded.sort_order;
