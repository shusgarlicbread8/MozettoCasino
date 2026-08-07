use poker_eval::Card;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

/// Chip amounts are integer base units (no floats).
pub type Chips = i64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    Fold,
    Check,
    Call,
    Bet,
    Raise,
    AllIn,
}

impl ActionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ActionKind::Fold => "fold",
            ActionKind::Check => "check",
            ActionKind::Call => "call",
            ActionKind::Bet => "bet",
            ActionKind::Raise => "raise",
            ActionKind::AllIn => "all_in",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Street {
    Waiting,
    Dealing,
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
    Settlement,
}

impl Street {
    pub fn as_str(self) -> &'static str {
        match self {
            Street::Waiting => "waiting",
            Street::Dealing => "dealing",
            Street::Preflop => "preflop",
            Street::Flop => "flop",
            Street::Turn => "turn",
            Street::River => "river",
            Street::Showdown => "showdown",
            Street::Settlement => "settlement",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableConfig {
    pub table_id: String,
    pub small_blind: Chips,
    pub big_blind: Chips,
    /// Rake in basis points (10000 = 100%). Matches TS `rakePct` via `rake_bps / 10000`.
    pub rake_bps: u32,
    pub rake_cap: Option<Chips>,
}

impl TableConfig {
    /// Plan 11 integer rake: `min(floor(pot * rake_bps / 10000), rake_cap)`.
    ///
    /// - `ended_before_flop == Some(true)` ⇒ 0 (noFlopNoDrop)
    /// - `ended_before_flop == None` and `live_hands <= 1` ⇒ 0 (legacy fold-win)
    /// - `ended_before_flop == Some(false)` allows rake with a single live hand (postflop fold-win)
    pub fn compute_rake(&self, pot: Chips, live_hands: usize) -> Chips {
        self.compute_rake_ex(pot, live_hands, None)
    }

    pub fn compute_rake_ex(
        &self,
        pot: Chips,
        live_hands: usize,
        ended_before_flop: Option<bool>,
    ) -> Chips {
        if self.rake_bps == 0 || pot <= 0 {
            return 0;
        }
        if ended_before_flop == Some(true) {
            return 0;
        }
        if ended_before_flop != Some(false) && live_hands <= 1 {
            return 0;
        }
        let mut rake = pot.saturating_mul(self.rake_bps as i64) / 10_000;
        if let Some(cap) = self.rake_cap {
            rake = rake.min(cap);
        }
        rake
    }
}

#[cfg(test)]
mod rake_tests {
    use super::*;

    fn cfg(bps: u32, cap: Option<Chips>) -> TableConfig {
        TableConfig {
            table_id: "t".into(),
            small_blind: 50,
            big_blind: 100,
            rake_bps: bps,
            rake_cap: cap,
        }
    }

    #[test]
    fn plan11_floor_and_cap() {
        assert_eq!(cfg(500, None).compute_rake(1000, 2), 50);
        assert_eq!(cfg(500, Some(20)).compute_rake(1000, 2), 20);
        assert_eq!(cfg(275, None).compute_rake(1000, 2), 27);
    }

    #[test]
    fn no_rake_single_live_hand() {
        assert_eq!(cfg(300, None).compute_rake(150, 1), 0);
    }

    #[test]
    fn zero_bps_or_pot() {
        assert_eq!(cfg(0, None).compute_rake(1000, 2), 0);
        assert_eq!(cfg(300, None).compute_rake(0, 2), 0);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatState {
    pub seat_index: u8,
    pub player_id: String,
    pub agent_id: String,
    pub stack: Chips,
    pub bet: Chips,
    pub total_bet: Chips,
    pub hole: Option<[Card; 2]>,
    pub folded: bool,
    pub all_in: bool,
    pub sit_out: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WinnerPay {
    pub seat_index: u8,
    pub amount: Chips,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoldemState {
    pub config: TableConfig,
    pub hand_id: Option<String>,
    pub hand_number: u64,
    pub street: Street,
    pub button: u8,
    pub deck: Vec<Card>,
    pub board: Vec<Card>,
    pub pot: Chips,
    pub seats: Vec<SeatState>,
    pub acting_index: Option<u8>,
    pub current_bet: Chips,
    pub min_raise: Chips,
    pub last_aggressor: Option<u8>,
    pub first_to_act: Option<u8>,
    /// Private; excluded from consensus state hash.
    pub server_seed: Option<String>,
    pub seed_commit: Option<String>,
    pub winners: Vec<WinnerPay>,
    pub rake: Chips,
    pub acted_this_street: BTreeSet<u8>,
    pub last_raise_complete: bool,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("{0}")]
    Msg(String),
    #[error("illegal action {0}")]
    IllegalAction(String),
    #[error("illegal amount {amount} for {action}")]
    IllegalAmount { action: String, amount: Chips },
    #[error("nobody to act")]
    NobodyToAct,
    #[error("need at least 2 players")]
    NeedPlayers,
}

pub type Transition = Result<(HoldemState, Vec<crate::events::EngineEvent>), EngineError>;
