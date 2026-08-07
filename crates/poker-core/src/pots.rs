use crate::types::{Chips, SeatState};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PotLayer {
    pub amount: Chips,
    pub contributors: Vec<u8>,
    pub eligible: Vec<u8>,
}

/// Main + side pots from each seat's `total_bet` (TS `buildPots`).
pub fn build_pots(seats: &[SeatState]) -> Vec<PotLayer> {
    let contributors: Vec<&SeatState> = seats.iter().filter(|s| s.total_bet > 0).collect();
    if contributors.is_empty() {
        return vec![];
    }
    let mut levels: Vec<Chips> = contributors.iter().map(|s| s.total_bet).collect();
    levels.sort_unstable();
    levels.dedup();

    let mut pots = Vec::new();
    let mut prev: Chips = 0;
    for level in levels {
        let in_layer: Vec<&SeatState> = contributors
            .iter()
            .copied()
            .filter(|s| s.total_bet >= level)
            .collect();
        let amount = (level - prev) * in_layer.len() as Chips;
        let eligible: Vec<u8> = in_layer
            .iter()
            .filter(|s| !s.folded)
            .map(|s| s.seat_index)
            .collect();
        if amount > 0 && !eligible.is_empty() {
            pots.push(PotLayer {
                amount,
                contributors: in_layer.iter().map(|s| s.seat_index).collect(),
                eligible,
            });
        }
        prev = level;
    }
    pots
}

pub fn seats_after_button(button: u8, seat_count: usize) -> Vec<u8> {
    let mut order = Vec::with_capacity(seat_count);
    for i in 1..=seat_count {
        order.push(((button as usize + i) % seat_count) as u8);
    }
    order
}
