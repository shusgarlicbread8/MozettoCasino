//! Deterministic deck shuffle matching TS `packages/game-rules/src/cards.ts`.

use hmac::{Hmac, Mac};
use poker_eval::{full_deck, Card};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// `sha256(serverSeed)` hex — matches Node `createHash("sha256")`.
pub fn commit_seed(server_seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server_seed.as_bytes());
    hex_encode(&hasher.finalize())
}

/// HMAC-SHA256 Fisher–Yates matching TS `shuffleDeck`.
pub fn shuffle_deck(server_seed: &str, hand_id: &str) -> Vec<Card> {
    let mut deck = full_deck().to_vec();
    let mut counter: u32 = 0;
    for i in (1..deck.len()).rev() {
        let mut mac =
            HmacSha256::new_from_slice(server_seed.as_bytes()).expect("HMAC key length");
        mac.update(format!("{hand_id}:{counter}").as_bytes());
        counter += 1;
        let digest = mac.finalize().into_bytes();
        let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
        let j = (n as usize) % (i + 1);
        deck.swap(i, j);
    }
    deck
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use poker_eval::card_key;

    #[test]
    fn commit_seed_sha256() {
        // echo -n 'wp030-hu-blinds' | shasum -a 256
        let h = commit_seed("wp030-hu-blinds");
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn shuffle_is_deterministic() {
        let a = shuffle_deck("seed", "hand-1");
        let b = shuffle_deck("seed", "hand-1");
        assert_eq!(
            a.iter().map(|c| card_key(*c)).collect::<Vec<_>>(),
            b.iter().map(|c| card_key(*c)).collect::<Vec<_>>()
        );
        let c = shuffle_deck("seed", "hand-2");
        assert_ne!(
            a.iter().map(|c| card_key(*c)).collect::<Vec<_>>(),
            c.iter().map(|c| card_key(*c)).collect::<Vec<_>>()
        );
    }
}
