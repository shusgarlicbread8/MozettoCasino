//! Hold'em hand evaluation — five-card ranking over seven-card sets.
//! Ported from `packages/game-rules/src/hand-rank.ts` for TS freeze parity.
//!
//! Shared golden vectors: `vectors/hand_eval_v1.json` (WP-033).
//! PokerKit differential harness is deferred to WP-034 (`oracle` hook).

mod cards;
mod oracle;
mod rank;

pub use cards::{
    card_code, card_from_code, card_key, full_deck, parse_card, rank_index, rank_value, suit_index,
    Card, Rank, Suit, FULL_DECK_LEN,
};
pub use oracle::{DIFFERENTIAL_ORACLE_ID, DIFFERENTIAL_ORACLE_STATUS};
pub use rank::{best_hand, compare_scores, rank_five, HandCategory, RankedHand};
