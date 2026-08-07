use crate::deck::{commit_seed, shuffle_deck};
use crate::events::{BlindKind, BlindPost, EngineEvent};
use crate::legal::get_legal_actions as legal_actions_impl;
use crate::pots::{build_pots as build_pots_impl, seats_after_button, PotLayer};
use crate::types::{
    ActionKind, Chips, EngineError, HoldemState, SeatState, Street, TableConfig, Transition,
    WinnerPay,
};
use poker_eval::{best_hand, compare_scores, Card};
use std::collections::BTreeSet;

pub use crate::legal::get_legal_actions;
pub use crate::pots::build_pots;

fn next_seat<F>(state: &HoldemState, from: u8, mut pred: F) -> Option<u8>
where
    F: FnMut(&SeatState) -> bool,
{
    let n = state.seats.len();
    for i in 1..=n {
        let idx = ((from as usize + i) % n) as u8;
        if let Some(seat) = state.seats.iter().find(|s| s.seat_index == idx) {
            if pred(seat) {
                return Some(idx);
            }
        }
    }
    None
}

fn take_chips(seat: &mut SeatState, amount: Chips) -> Chips {
    let paid = amount.min(seat.stack);
    seat.stack -= paid;
    seat.bet += paid;
    seat.total_bet += paid;
    if seat.stack == 0 {
        seat.all_in = true;
    }
    paid
}

pub fn create_table(config: TableConfig, seat_count: usize) -> HoldemState {
    assert!((2..=6).contains(&seat_count), "seat_count 2..=6");
    HoldemState {
        min_raise: config.big_blind,
        config,
        hand_id: None,
        hand_number: 0,
        street: Street::Waiting,
        button: (seat_count - 1) as u8,
        deck: vec![],
        board: vec![],
        pot: 0,
        seats: (0..seat_count as u8)
            .map(|i| SeatState {
                seat_index: i,
                player_id: String::new(),
                agent_id: String::new(),
                stack: 0,
                bet: 0,
                total_bet: 0,
                hole: None,
                folded: true,
                all_in: false,
                sit_out: true,
            })
            .collect(),
        acting_index: None,
        current_bet: 0,
        last_aggressor: None,
        first_to_act: None,
        server_seed: None,
        seed_commit: None,
        winners: vec![],
        rake: 0,
        acted_this_street: BTreeSet::new(),
        last_raise_complete: true,
    }
}

pub fn seat_player(
    mut state: HoldemState,
    seat_index: u8,
    player_id: impl Into<String>,
    agent_id: impl Into<String>,
    stack: Chips,
) -> HoldemState {
    let player_id = player_id.into();
    let agent_id = agent_id.into();
    for s in &mut state.seats {
        if s.seat_index == seat_index {
            s.player_id = player_id;
            s.agent_id = agent_id;
            s.stack = stack;
            s.folded = false;
            s.all_in = false;
            s.sit_out = false;
            s.bet = 0;
            s.total_bet = 0;
            s.hole = None;
            break;
        }
    }
    state
}

pub fn clear_seat(mut state: HoldemState, seat_index: u8) -> HoldemState {
    for s in &mut state.seats {
        if s.seat_index == seat_index {
            s.player_id.clear();
            s.agent_id.clear();
            s.stack = 0;
            s.sit_out = true;
            s.folded = true;
            s.hole = None;
            s.bet = 0;
            s.total_bet = 0;
            s.all_in = false;
            break;
        }
    }
    state
}

pub fn fold_seat(mut state: HoldemState, seat_index: u8) -> HoldemState {
    for s in &mut state.seats {
        if s.seat_index == seat_index {
            s.folded = true;
            s.hole = None;
            s.all_in = false;
            break;
        }
    }
    state
}

pub fn start_hand(
    state: HoldemState,
    server_seed: impl Into<String>,
    hand_id: impl Into<String>,
) -> Transition {
    let server_seed = server_seed.into();
    let hand_id = hand_id.into();
    let eligible: Vec<&SeatState> = state
        .seats
        .iter()
        .filter(|s| !s.sit_out && !s.player_id.is_empty() && s.stack > 0)
        .collect();
    if eligible.len() < 2 {
        return Err(EngineError::NeedPlayers);
    }

    let button = next_seat(&state, state.button, |s| !s.sit_out && s.stack > 0)
        .unwrap_or(eligible[0].seat_index);
    let deck = shuffle_deck(&server_seed, &hand_id);
    let seed_commit = commit_seed(&server_seed);

    let seats: Vec<SeatState> = state
        .seats
        .iter()
        .map(|s| SeatState {
            bet: 0,
            total_bet: 0,
            all_in: false,
            hole: None,
            folded: s.sit_out || s.player_id.is_empty() || s.stack <= 0,
            ..s.clone()
        })
        .collect();

    let mut next = HoldemState {
        hand_id: Some(hand_id.clone()),
        hand_number: state.hand_number + 1,
        button,
        deck,
        board: vec![],
        pot: 0,
        street: Street::Preflop,
        server_seed: Some(server_seed),
        seed_commit: Some(seed_commit.clone()),
        winners: vec![],
        rake: 0,
        current_bet: state.config.big_blind,
        min_raise: state.config.big_blind,
        acted_this_street: BTreeSet::new(),
        last_raise_complete: true,
        seats,
        acting_index: None,
        last_aggressor: None,
        first_to_act: None,
        config: state.config,
    };

    let mut events = vec![EngineEvent::HandStarted {
        hand_id,
        hand_number: next.hand_number,
        seed_commit,
        button,
    }];

    let heads_up = eligible.len() == 2;
    let sb = if heads_up {
        button
    } else {
        next_seat(&next, button, |s| !s.folded).ok_or_else(|| {
            EngineError::Msg("no SB".into())
        })?
    };
    let bb = if heads_up {
        next_seat(&next, button, |s| !s.folded).ok_or_else(|| {
            EngineError::Msg("no BB".into())
        })?
    } else {
        next_seat(&next, sb, |s| !s.folded).ok_or_else(|| {
            EngineError::Msg("no BB".into())
        })?
    };

    let mut posts = Vec::new();
    {
        let sb_seat = next.seats.iter_mut().find(|s| s.seat_index == sb).unwrap();
        let sb_paid = take_chips(sb_seat, next.config.small_blind);
        posts.push(BlindPost {
            seat_index: sb,
            amount: sb_paid,
            kind: BlindKind::Sb,
        });
    }
    {
        let bb_seat = next.seats.iter_mut().find(|s| s.seat_index == bb).unwrap();
        let bb_paid = take_chips(bb_seat, next.config.big_blind);
        posts.push(BlindPost {
            seat_index: bb,
            amount: bb_paid,
            kind: BlindKind::Bb,
        });
        next.pot = posts.iter().map(|p| p.amount).sum();
        next.last_aggressor = Some(bb);
    }
    events.push(EngineEvent::BlindsPosted { posts });
    events.push(EngineEvent::PotUpdated { pot: next.pot });

    let mut private_cards = Vec::new();
    for s in &mut next.seats {
        if s.folded {
            continue;
        }
        let c0 = next.deck.remove(0);
        let c1 = next.deck.remove(0);
        s.hole = Some([c0, c1]);
        private_cards.push((s.seat_index, [c0, c1]));
    }
    events.push(EngineEvent::HoleCardsDealt {
        private: private_cards,
    });

    let first = if heads_up {
        sb
    } else {
        next_seat(&next, bb, |s| !s.folded && !s.all_in).ok_or_else(|| {
            EngineError::Msg("no first to act".into())
        })?
    };
    next.acting_index = Some(first);
    next.first_to_act = Some(first);
    Ok((next, events))
}

fn reset_street_bets(mut state: HoldemState) -> HoldemState {
    for s in &mut state.seats {
        s.bet = 0;
    }
    state.current_bet = 0;
    state.min_raise = state.config.big_blind;
    state.last_aggressor = None;
    state.acted_this_street.clear();
    state.last_raise_complete = true;
    state
}

fn deal_board(
    mut state: HoldemState,
    count: usize,
    street: Street,
) -> (HoldemState, Vec<Card>) {
    state.deck.remove(0); // burn
    let mut cards = Vec::with_capacity(count);
    for _ in 0..count {
        cards.push(state.deck.remove(0));
    }
    state.board.extend(cards.iter().copied());
    state.street = street;
    state = reset_street_bets(state);
    let first = next_seat(&state, state.button, |s| !s.folded && !s.all_in && s.stack > 0);
    state.acting_index = first;
    state.first_to_act = first;
    (state, cards)
}

pub fn settle_showdown(state: HoldemState) -> Transition {
    let mut events = Vec::new();
    let live: Vec<&SeatState> = state
        .seats
        .iter()
        .filter(|s| !s.folded && s.hole.is_some())
        .collect();

    let ranked: Vec<(u8, [Card; 2], String, Vec<u8>)> = live
        .iter()
        .map(|s| {
            let hole = s.hole.unwrap();
            let hand = best_hand(&hole, &state.board);
            (s.seat_index, hole, hand.label.clone(), hand.score)
        })
        .collect();

    events.push(EngineEvent::ShowdownRevealed {
        reveals: ranked
            .iter()
            .map(|(i, cards, label, _)| (*i, *cards, label.clone()))
            .collect(),
    });

    let layers = build_pots_impl(&state.seats);
    let total_pot: Chips = layers.iter().map(|p| p.amount).sum();
    let pot_pool = if total_pot > 0 { total_pot } else { state.pot };
    let rake = state.config.compute_rake(pot_pool, live.len());

    let mut rake_left = rake;
    let net_layers: Vec<PotLayer> = layers
        .iter()
        .enumerate()
        .map(|(i, layer)| {
            let layer_rake = if rake > 0 && pot_pool > 0 {
                if i + 1 == layers.len() {
                    rake_left
                } else {
                    let lr = (layer.amount * rake) / pot_pool;
                    rake_left -= lr;
                    lr
                }
            } else {
                0
            };
            PotLayer {
                amount: layer.amount - layer_rake,
                contributors: layer.contributors.clone(),
                eligible: layer.eligible.clone(),
            }
        })
        .collect();

    let mut seats = state.seats.clone();
    let mut won: Vec<(u8, Chips, String)> = Vec::new();
    let button_order = seats_after_button(state.button, state.seats.len());

    for layer in &net_layers {
        if layer.amount <= 0 || layer.eligible.is_empty() {
            continue;
        }
        let mut contenders: Vec<&(u8, [Card; 2], String, Vec<u8>)> = ranked
            .iter()
            .filter(|(idx, _, _, _)| layer.eligible.contains(idx))
            .collect();
        if contenders.is_empty() {
            continue;
        }
        // Highest score first (compare_scores(b,a) > 0 ⇒ b stronger).
        contenders.sort_by(|a, b| compare_scores(&b.3, &a.3).cmp(&0));
        let top = &contenders[0].3;
        let mut winners: Vec<&(u8, [Card; 2], String, Vec<u8>)> = contenders
            .into_iter()
            .filter(|c| compare_scores(&c.3, top) == 0)
            .collect();
        winners.sort_by(|a, b| {
            let ia = button_order
                .iter()
                .position(|&x| x == a.0)
                .unwrap_or(usize::MAX);
            let ib = button_order
                .iter()
                .position(|&x| x == b.0)
                .unwrap_or(usize::MAX);
            ia.cmp(&ib)
        });
        let share = layer.amount / winners.len() as Chips;
        let mut rem = layer.amount - share * winners.len() as Chips;
        for w in winners {
            let amount = share + if rem > 0 { 1 } else { 0 };
            if rem > 0 {
                rem -= 1;
            }
            if let Some(seat) = seats.iter_mut().find(|s| s.seat_index == w.0) {
                seat.stack += amount;
            }
            if let Some(prev) = won.iter_mut().find(|(i, _, _)| *i == w.0) {
                prev.1 += amount;
            } else {
                won.push((w.0, amount, w.2.clone()));
            }
        }
    }

    let pays: Vec<WinnerPay> = won
        .iter()
        .map(|(i, a, l)| WinnerPay {
            seat_index: *i,
            amount: *a,
            label: l.clone(),
        })
        .collect();

    let next = HoldemState {
        seats: seats.clone(),
        pot: 0,
        rake,
        winners: pays.clone(),
        street: Street::Settlement,
        acting_index: None,
        ..state
    };

    let seed_reveal = next.server_seed.clone().unwrap_or_default();
    events.push(EngineEvent::HandSettled {
        winners: pays
            .iter()
            .map(|p| (p.seat_index, p.amount, p.label.clone()))
            .collect(),
        rake,
        seed_reveal,
    });
    events.push(EngineEvent::StacksUpdated {
        stacks: seats.iter().map(|s| (s.seat_index, s.stack)).collect(),
    });
    Ok((next, events))
}

pub fn fold_win(state: HoldemState) -> Transition {
    let winner = state
        .seats
        .iter()
        .find(|s| !s.folded && !s.player_id.is_empty() && !s.sit_out);
    let Some(winner) = winner else {
        return Ok((
            HoldemState {
                pot: 0,
                street: Street::Settlement,
                acting_index: None,
                winners: vec![],
                ..state
            },
            vec![],
        ));
    };
    let win_idx = winner.seat_index;
    let pot = state.pot;
    let seats: Vec<SeatState> = state
        .seats
        .iter()
        .map(|s| {
            let mut s = s.clone();
            if s.seat_index == win_idx {
                s.stack += pot;
            }
            s.bet = 0;
            s
        })
        .collect();
    let pays = vec![WinnerPay {
        seat_index: win_idx,
        amount: pot,
        label: "Won without showdown".into(),
    }];
    let next = HoldemState {
        seats: seats.clone(),
        pot: 0,
        rake: 0,
        winners: pays.clone(),
        street: Street::Settlement,
        acting_index: None,
        ..state
    };
    let seed_reveal = next.server_seed.clone().unwrap_or_default();
    Ok((
        next,
        vec![
            EngineEvent::HandSettled {
                winners: pays
                    .iter()
                    .map(|p| (p.seat_index, p.amount, p.label.clone()))
                    .collect(),
                rake: 0,
                seed_reveal,
            },
            EngineEvent::StacksUpdated {
                stacks: seats.iter().map(|s| (s.seat_index, s.stack)).collect(),
            },
        ],
    ))
}

pub fn is_all_in_runout(state: &HoldemState) -> bool {
    if state.hand_id.is_none() {
        return false;
    }
    if matches!(
        state.street,
        Street::Waiting | Street::Settlement | Street::Showdown
    ) {
        return false;
    }
    let live: Vec<&SeatState> = state
        .seats
        .iter()
        .filter(|s| !s.folded && !s.player_id.is_empty())
        .collect();
    if live.len() < 2 {
        return false;
    }
    let can_act = live.iter().filter(|s| !s.all_in && s.stack > 0).count();
    can_act <= 1
}

pub fn continue_runout(state: HoldemState) -> Transition {
    let mut s0 = state;
    s0.acting_index = None;
    let live: Vec<&SeatState> = s0.seats.iter().filter(|x| !x.folded).collect();
    if live.len() == 1 {
        return fold_win(s0);
    }
    if live.len() < 2 {
        return Ok((
            HoldemState {
                street: Street::Settlement,
                pot: 0,
                ..s0
            },
            vec![],
        ));
    }

    if s0.board.is_empty() {
        let (mut d, cards) = deal_board(s0, 3, Street::Flop);
        d.acting_index = None;
        return Ok((
            d,
            vec![EngineEvent::StreetDealt {
                street: "flop".into(),
                cards,
            }],
        ));
    }
    if s0.board.len() == 3 {
        let (mut d, cards) = deal_board(s0, 1, Street::Turn);
        d.acting_index = None;
        return Ok((
            d,
            vec![EngineEvent::StreetDealt {
                street: "turn".into(),
                cards,
            }],
        ));
    }
    if s0.board.len() == 4 {
        let (mut d, cards) = deal_board(s0, 1, Street::River);
        d.acting_index = None;
        return Ok((
            d,
            vec![EngineEvent::StreetDealt {
                street: "river".into(),
                cards,
            }],
        ));
    }
    settle_showdown(HoldemState {
        street: Street::Showdown,
        ..s0
    })
}

fn maybe_runout(state: HoldemState, mut events: Vec<EngineEvent>) -> Transition {
    let live: Vec<&SeatState> = state.seats.iter().filter(|x| !x.folded).collect();
    if live.len() == 1 {
        let (s, ev) = fold_win(state)?;
        events.extend(ev);
        return Ok((s, events));
    }

    let contenders = live.iter().filter(|x| !x.all_in).count();
    let auto = contenders <= 1;

    if !auto {
        if state.acting_index.is_some() {
            return Ok((state, events));
        }
        if state.board.is_empty() {
            let (d, cards) = deal_board(state, 3, Street::Flop);
            events.push(EngineEvent::StreetDealt {
                street: "flop".into(),
                cards,
            });
            return Ok((d, events));
        }
        if state.board.len() == 3 {
            let (d, cards) = deal_board(state, 1, Street::Turn);
            events.push(EngineEvent::StreetDealt {
                street: "turn".into(),
                cards,
            });
            return Ok((d, events));
        }
        if state.board.len() == 4 {
            let (d, cards) = deal_board(state, 1, Street::River);
            events.push(EngineEvent::StreetDealt {
                street: "river".into(),
                cards,
            });
            return Ok((d, events));
        }
        if state.street == Street::River || state.board.len() >= 5 {
            let (s, ev) = settle_showdown(HoldemState {
                street: Street::Showdown,
                ..state
            })?;
            events.extend(ev);
            return Ok((s, events));
        }
        return Ok((state, events));
    }

    if state.board.len() >= 5 {
        let (s, ev) = settle_showdown(HoldemState {
            street: Street::Showdown,
            ..state
        })?;
        events.extend(ev);
        return Ok((s, events));
    }
    Ok((
        HoldemState {
            acting_index: None,
            ..state
        },
        events,
    ))
}

fn street_complete(state: &HoldemState) -> bool {
    let live: Vec<&SeatState> = state.seats.iter().filter(|s| !s.folded).collect();
    if live.len() <= 1 {
        return true;
    }
    let active: Vec<&SeatState> = live.iter().copied().filter(|s| !s.all_in).collect();
    if active.is_empty() {
        return true;
    }
    if active.iter().any(|s| s.bet != state.current_bet) {
        return false;
    }
    active
        .iter()
        .all(|s| state.acted_this_street.contains(&s.seat_index))
}

pub fn apply_action(state: HoldemState, action: ActionKind, amount: Option<Chips>) -> Transition {
    if state.acting_index.is_none() {
        return Err(EngineError::NobodyToAct);
    }
    let legal = legal_actions_impl(&state);
    let match_la = legal
        .iter()
        .find(|l| l.action == action)
        .ok_or_else(|| EngineError::IllegalAction(action.as_str().into()))?;
    if let (Some(min_a), Some(max_a), Some(amt)) = (match_la.min_amount, match_la.max_amount, amount)
    {
        if amt < min_a || amt > max_a {
            return Err(EngineError::IllegalAmount {
                action: action.as_str().into(),
                amount: amt,
            });
        }
    }

    let mut events = Vec::new();
    let mut seats = state.seats.clone();
    let acting = state.acting_index.unwrap();
    let seat = seats.iter_mut().find(|s| s.seat_index == acting).unwrap();

    let mut current_bet = state.current_bet;
    let mut min_raise = state.min_raise;
    let mut last_aggressor = state.last_aggressor;
    let mut pot = state.pot;
    let mut last_raise_complete = state.last_raise_complete;
    let mut acted = state.acted_this_street.clone();

    let mut paid: Chips = 0;
    match action {
        ActionKind::Fold => {
            seat.folded = true;
        }
        ActionKind::Check => {
            paid = 0;
        }
        ActionKind::Call => {
            paid = take_chips(seat, current_bet - seat.bet);
            pot += paid;
        }
        ActionKind::Bet => {
            let bet_amt = amount
                .or(match_la.min_amount)
                .unwrap_or(state.config.big_blind);
            paid = take_chips(seat, bet_amt);
            pot += paid;
            min_raise = paid;
            current_bet = seat.bet;
            last_aggressor = Some(seat.seat_index);
            last_raise_complete = true;
            acted.clear();
        }
        ActionKind::Raise => {
            let target = amount
                .or(match_la.min_amount)
                .unwrap_or(current_bet + min_raise - seat.bet);
            paid = take_chips(seat, target);
            pot += paid;
            let raise_size = seat.bet - current_bet;
            if raise_size >= min_raise {
                min_raise = raise_size;
            }
            current_bet = seat.bet;
            last_aggressor = Some(seat.seat_index);
            last_raise_complete = true;
            acted.clear();
        }
        ActionKind::AllIn => {
            paid = take_chips(seat, seat.stack);
            pot += paid;
            if seat.bet > current_bet {
                let raise_size = seat.bet - current_bet;
                if raise_size >= min_raise {
                    min_raise = raise_size;
                    last_aggressor = Some(seat.seat_index);
                    last_raise_complete = true;
                    acted.clear();
                } else {
                    last_raise_complete = false;
                }
                current_bet = seat.bet;
            }
        }
    }

    acted.insert(seat.seat_index);
    events.push(EngineEvent::PlayerActed {
        seat_index: seat.seat_index,
        action,
        amount: if paid > 0 { Some(paid) } else { None },
    });
    events.push(EngineEvent::PotUpdated { pot });

    let mut next = HoldemState {
        seats,
        pot,
        current_bet,
        min_raise,
        last_aggressor,
        acted_this_street: acted.clone(),
        last_raise_complete,
        ..state
    };

    if street_complete(&next) {
        if next.street == Street::River {
            let (s, ev) = settle_showdown(HoldemState {
                street: Street::Showdown,
                ..next
            })?;
            events.extend(ev);
            return Ok((s, events));
        }
        next.acting_index = None;
        return maybe_runout(next, events);
    }

    let n = next_seat(&next, acting, |s| {
        !s.folded && !s.all_in && (s.bet < current_bet || !acted.contains(&s.seat_index))
    });
    next.acting_index = n;
    if n.is_none() {
        return maybe_runout(
            HoldemState {
                acting_index: None,
                ..next
            },
            events,
        );
    }
    Ok((next, events))
}
