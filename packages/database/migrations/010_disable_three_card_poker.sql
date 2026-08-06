-- Remove Three Card Poker from the live catalogue.
update games set status = 'disabled' where id = 'three_card_poker';
update game_variants set status = 'disabled' where game_id = 'three_card_poker';
