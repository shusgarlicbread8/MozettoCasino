use serde::{Deserialize, Serialize};

pub const FULL_DECK_LEN: usize = 52;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    C,
    D,
    H,
    S,
}

impl Suit {
    pub fn as_char(self) -> char {
        match self {
            Suit::C => 'c',
            Suit::D => 'd',
            Suit::H => 'h',
            Suit::S => 's',
        }
    }

    pub fn from_char(c: char) -> Option<Self> {
        match c {
            'c' => Some(Suit::C),
            'd' => Some(Suit::D),
            'h' => Some(Suit::H),
            's' => Some(Suit::S),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Rank {
    #[serde(rename = "2")]
    R2,
    #[serde(rename = "3")]
    R3,
    #[serde(rename = "4")]
    R4,
    #[serde(rename = "5")]
    R5,
    #[serde(rename = "6")]
    R6,
    #[serde(rename = "7")]
    R7,
    #[serde(rename = "8")]
    R8,
    #[serde(rename = "9")]
    R9,
    #[serde(rename = "T")]
    T,
    #[serde(rename = "J")]
    J,
    #[serde(rename = "Q")]
    Q,
    #[serde(rename = "K")]
    K,
    #[serde(rename = "A")]
    A,
}

impl Rank {
    pub fn as_char(self) -> char {
        match self {
            Rank::R2 => '2',
            Rank::R3 => '3',
            Rank::R4 => '4',
            Rank::R5 => '5',
            Rank::R6 => '6',
            Rank::R7 => '7',
            Rank::R8 => '8',
            Rank::R9 => '9',
            Rank::T => 'T',
            Rank::J => 'J',
            Rank::Q => 'Q',
            Rank::K => 'K',
            Rank::A => 'A',
        }
    }

    pub fn from_char(c: char) -> Option<Self> {
        match c {
            '2' => Some(Rank::R2),
            '3' => Some(Rank::R3),
            '4' => Some(Rank::R4),
            '5' => Some(Rank::R5),
            '6' => Some(Rank::R6),
            '7' => Some(Rank::R7),
            '8' => Some(Rank::R8),
            '9' => Some(Rank::R9),
            'T' => Some(Rank::T),
            'J' => Some(Rank::J),
            'Q' => Some(Rank::Q),
            'K' => Some(Rank::K),
            'A' => Some(Rank::A),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}

pub fn card_key(c: Card) -> String {
    format!("{}{}", c.rank.as_char(), c.suit.as_char())
}

pub fn parse_card(s: &str) -> Result<Card, String> {
    let mut chars = s.chars();
    let r = chars.next().ok_or_else(|| format!("bad card: {s}"))?;
    let u = chars.next().ok_or_else(|| format!("bad card: {s}"))?;
    if chars.next().is_some() {
        return Err(format!("bad card: {s}"));
    }
    Ok(Card {
        rank: Rank::from_char(r).ok_or_else(|| format!("bad rank: {s}"))?,
        suit: Suit::from_char(u).ok_or_else(|| format!("bad suit: {s}"))?,
    })
}

pub fn rank_value(r: Rank) -> u8 {
    match r {
        Rank::R2 => 2,
        Rank::R3 => 3,
        Rank::R4 => 4,
        Rank::R5 => 5,
        Rank::R6 => 6,
        Rank::R7 => 7,
        Rank::R8 => 8,
        Rank::R9 => 9,
        Rank::T => 10,
        Rank::J => 11,
        Rank::Q => 12,
        Rank::K => 13,
        Rank::A => 14,
    }
}

/// Protocol V3 rank index: 0=2 … 12=A.
pub fn rank_index(r: Rank) -> u8 {
    rank_value(r) - 2
}

/// Protocol V3 suit index: 0=c, 1=d, 2=h, 3=s.
pub fn suit_index(s: Suit) -> u8 {
    match s {
        Suit::C => 0,
        Suit::D => 1,
        Suit::H => 2,
        Suit::S => 3,
    }
}

/// Canonical card code `0..51` (suit-major): `suitIndex * 13 + rankIndex`.
pub fn card_code(c: Card) -> u8 {
    suit_index(c.suit) * 13 + rank_index(c.rank)
}

pub fn card_from_code(code: u8) -> Result<Card, String> {
    if code > 51 {
        return Err(format!("card code out of range: {code}"));
    }
    const SUITS: [Suit; 4] = [Suit::C, Suit::D, Suit::H, Suit::S];
    const RANKS: [Rank; 13] = [
        Rank::R2,
        Rank::R3,
        Rank::R4,
        Rank::R5,
        Rank::R6,
        Rank::R7,
        Rank::R8,
        Rank::R9,
        Rank::T,
        Rank::J,
        Rank::Q,
        Rank::K,
        Rank::A,
    ];
    Ok(Card {
        suit: SUITS[(code / 13) as usize],
        rank: RANKS[(code % 13) as usize],
    })
}

/// Suit-major order matching TS `fullDeck()` / Protocol V3 `0..51`.
pub fn full_deck() -> [Card; FULL_DECK_LEN] {
    const SUITS: [Suit; 4] = [Suit::C, Suit::D, Suit::H, Suit::S];
    const RANKS: [Rank; 13] = [
        Rank::R2,
        Rank::R3,
        Rank::R4,
        Rank::R5,
        Rank::R6,
        Rank::R7,
        Rank::R8,
        Rank::R9,
        Rank::T,
        Rank::J,
        Rank::Q,
        Rank::K,
        Rank::A,
    ];
    let mut deck = [Card {
        rank: Rank::R2,
        suit: Suit::C,
    }; FULL_DECK_LEN];
    let mut i = 0;
    for suit in SUITS {
        for rank in RANKS {
            deck[i] = Card { rank, suit };
            i += 1;
        }
    }
    deck
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_v3_card_codes() {
        assert_eq!(card_code(parse_card("2c").unwrap()), 0);
        assert_eq!(card_code(parse_card("Ac").unwrap()), 12);
        assert_eq!(card_code(parse_card("2d").unwrap()), 13);
        assert_eq!(card_code(parse_card("Ad").unwrap()), 25);
        assert_eq!(card_code(parse_card("2h").unwrap()), 26);
        assert_eq!(card_code(parse_card("Ah").unwrap()), 38);
        assert_eq!(card_code(parse_card("2s").unwrap()), 39);
        assert_eq!(card_code(parse_card("As").unwrap()), 51);
        for code in 0u8..=51 {
            let c = card_from_code(code).unwrap();
            assert_eq!(card_code(c), code);
            assert_eq!(card_key(c), card_key(full_deck()[code as usize]));
        }
    }
}
