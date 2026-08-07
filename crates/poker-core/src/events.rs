use crate::types::{ActionKind, Chips};
use poker_eval::Card;

/// Runtime engine events (not Protocol V3 ABI encoding — that is WP-015 / poker-events).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineEvent {
    HandStarted {
        hand_id: String,
        hand_number: u64,
        seed_commit: String,
        button: u8,
    },
    BlindsPosted {
        posts: Vec<BlindPost>,
    },
    HoleCardsDealt {
        private: Vec<(u8, [Card; 2])>,
    },
    PlayerActed {
        seat_index: u8,
        action: ActionKind,
        amount: Option<Chips>,
    },
    StreetDealt {
        street: String,
        cards: Vec<Card>,
    },
    PotUpdated {
        pot: Chips,
    },
    ShowdownRevealed {
        reveals: Vec<(u8, [Card; 2], String)>,
    },
    HandSettled {
        winners: Vec<(u8, Chips, String)>,
        rake: Chips,
        seed_reveal: String,
    },
    StacksUpdated {
        stacks: Vec<(u8, Chips)>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlindPost {
    pub seat_index: u8,
    pub amount: Chips,
    pub kind: BlindKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlindKind {
    Sb,
    Bb,
}
