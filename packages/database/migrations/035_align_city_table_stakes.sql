-- Align every cash table's blinds / buy-in band with the Season 1 city ladder.
--
-- Pre-Cities tables (and sticky Find Match) could leave a "Porto" row sitting
-- with Dubai blinds or a fixed $100 buy-in. Active mismatches are deactivated
-- so Find Match opens a fresh city-correct table instead of resurrecting them.

-- Deactivate live tables whose stored stakes disagree with their city.
update tables
set is_active = false
where is_active = true
  and (
    (league_id = 'casual'   and (small_blind is distinct from 0.25 or big_blind is distinct from 0.50
                              or min_buy_in is distinct from 20 or max_buy_in is distinct from 50))
    or (league_id = 'bronze'   and (small_blind is distinct from 0.50 or big_blind is distinct from 1.00
                              or min_buy_in is distinct from 40 or max_buy_in is distinct from 100))
    or (league_id = 'silver'   and (small_blind is distinct from 1.00 or big_blind is distinct from 2.00
                              or min_buy_in is distinct from 80 or max_buy_in is distinct from 200))
    or (league_id = 'gold'     and (small_blind is distinct from 2.50 or big_blind is distinct from 5.00
                              or min_buy_in is distinct from 200 or max_buy_in is distinct from 500))
    or (league_id = 'platinum' and (small_blind is distinct from 5.00 or big_blind is distinct from 10.00
                              or min_buy_in is distinct from 400 or max_buy_in is distinct from 1000))
    or (league_id = 'diamond'  and (small_blind is distinct from 25.00 or big_blind is distinct from 50.00
                              or min_buy_in is distinct from 2000 or max_buy_in is distinct from 5000))
  );

-- Rewrite stakes on every city table (active or not) so history and lobby agree.
update tables set small_blind = 0.25, big_blind =  0.50, min_buy_in =   20, max_buy_in =   50 where league_id = 'casual';
update tables set small_blind = 0.50, big_blind =  1.00, min_buy_in =   40, max_buy_in =  100 where league_id = 'bronze';
update tables set small_blind = 1.00, big_blind =  2.00, min_buy_in =   80, max_buy_in =  200 where league_id = 'silver';
update tables set small_blind = 2.50, big_blind =  5.00, min_buy_in =  200, max_buy_in =  500 where league_id = 'gold';
update tables set small_blind = 5.00, big_blind = 10.00, min_buy_in =  400, max_buy_in = 1000 where league_id = 'platinum';
update tables set small_blind =25.00, big_blind = 50.00, min_buy_in = 2000, max_buy_in = 5000 where league_id = 'diamond';
