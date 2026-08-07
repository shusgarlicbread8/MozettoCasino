use crate::types::{ActionKind, Chips, HoldemState};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegalAction {
    pub action: ActionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_amount: Option<Chips>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_amount: Option<Chips>,
}

pub fn get_legal_actions(state: &HoldemState) -> Vec<LegalAction> {
    let Some(acting) = state.acting_index else {
        return vec![];
    };
    let seat = state
        .seats
        .iter()
        .find(|s| s.seat_index == acting)
        .expect("acting seat");
    if seat.folded || seat.all_in {
        return vec![];
    }
    let to_call = state.current_bet - seat.bet;
    let mut actions = Vec::new();
    let capped = !state.last_raise_complete && state.acted_this_street.contains(&seat.seat_index);

    if to_call <= 0 {
        actions.push(LegalAction {
            action: ActionKind::Check,
            min_amount: None,
            max_amount: None,
        });
        if seat.stack > 0 && !capped {
            actions.push(LegalAction {
                action: ActionKind::Bet,
                min_amount: Some(state.config.big_blind.min(seat.stack)),
                max_amount: Some(seat.stack),
            });
            actions.push(LegalAction {
                action: ActionKind::AllIn,
                min_amount: Some(seat.stack),
                max_amount: Some(seat.stack),
            });
        }
    } else {
        actions.push(LegalAction {
            action: ActionKind::Fold,
            min_amount: None,
            max_amount: None,
        });
        if seat.stack > to_call {
            actions.push(LegalAction {
                action: ActionKind::Call,
                min_amount: Some(to_call),
                max_amount: Some(to_call),
            });
            if !capped {
                let min_raise_extra = state.current_bet + state.min_raise - seat.bet;
                actions.push(LegalAction {
                    action: ActionKind::Raise,
                    min_amount: Some(min_raise_extra.min(seat.stack)),
                    max_amount: Some(seat.stack),
                });
                actions.push(LegalAction {
                    action: ActionKind::AllIn,
                    min_amount: Some(seat.stack),
                    max_amount: Some(seat.stack),
                });
            }
        } else {
            actions.push(LegalAction {
                action: ActionKind::AllIn,
                min_amount: Some(seat.stack),
                max_amount: Some(seat.stack),
            });
            if seat.stack == to_call {
                actions.push(LegalAction {
                    action: ActionKind::Call,
                    min_amount: Some(to_call),
                    max_amount: Some(to_call),
                });
            }
        }
    }
    actions
}
