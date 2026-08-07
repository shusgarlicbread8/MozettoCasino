use crate::cards::{rank_value, Card};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandCategory {
    HighCard,
    Pair,
    TwoPair,
    ThreeKind,
    Straight,
    Flush,
    FullHouse,
    FourKind,
    StraightFlush,
}

impl HandCategory {
    pub fn score(self) -> u8 {
        match self {
            HandCategory::HighCard => 0,
            HandCategory::Pair => 1,
            HandCategory::TwoPair => 2,
            HandCategory::ThreeKind => 3,
            HandCategory::Straight => 4,
            HandCategory::Flush => 5,
            HandCategory::FullHouse => 6,
            HandCategory::FourKind => 7,
            HandCategory::StraightFlush => 8,
        }
    }

    /// Snake_case id matching TS `HandCategory`.
    pub fn as_str(self) -> &'static str {
        match self {
            HandCategory::HighCard => "high_card",
            HandCategory::Pair => "pair",
            HandCategory::TwoPair => "two_pair",
            HandCategory::ThreeKind => "three_kind",
            HandCategory::Straight => "straight",
            HandCategory::Flush => "flush",
            HandCategory::FullHouse => "full_house",
            HandCategory::FourKind => "four_kind",
            HandCategory::StraightFlush => "straight_flush",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "high_card" => Some(HandCategory::HighCard),
            "pair" => Some(HandCategory::Pair),
            "two_pair" => Some(HandCategory::TwoPair),
            "three_kind" => Some(HandCategory::ThreeKind),
            "straight" => Some(HandCategory::Straight),
            "flush" => Some(HandCategory::Flush),
            "full_house" => Some(HandCategory::FullHouse),
            "four_kind" => Some(HandCategory::FourKind),
            "straight_flush" => Some(HandCategory::StraightFlush),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RankedHand {
    pub category: HandCategory,
    /// Lexicographic compare vector (category first).
    pub score: Vec<u8>,
    pub label: String,
}

pub fn compare_scores(a: &[u8], b: &[u8]) -> i32 {
    let n = a.len().max(b.len());
    for i in 0..n {
        let av = a.get(i).copied().unwrap_or(0) as i32;
        let bv = b.get(i).copied().unwrap_or(0) as i32;
        let d = av - bv;
        if d != 0 {
            return d;
        }
    }
    0
}

fn combinations(arr: &[Card], k: usize) -> Vec<Vec<Card>> {
    if k == 0 {
        return vec![vec![]];
    }
    if arr.len() < k {
        return vec![];
    }
    let head = arr[0];
    let tail = &arr[1..];
    let mut with_head: Vec<Vec<Card>> = combinations(tail, k - 1)
        .into_iter()
        .map(|mut c| {
            c.insert(0, head);
            c
        })
        .collect();
    let without = combinations(tail, k);
    with_head.extend(without);
    with_head
}

fn is_straight(vals: &[u8]) -> Option<u8> {
    let mut uniq: Vec<u8> = {
        let mut v = vals.to_vec();
        v.sort_unstable_by(|a, b| b.cmp(a));
        v.dedup();
        v
    };
    if uniq.contains(&14) {
        uniq.push(1);
    }
    if uniq.len() >= 5 {
        for i in 0..=uniq.len() - 5 {
            let slice = &uniq[i..i + 5];
            if slice[0] - slice[4] == 4 {
                let mut set = slice.to_vec();
                set.sort_unstable();
                set.dedup();
                if set.len() == 5 {
                    return Some(if slice[0] == 14 && slice[4] == 1 {
                        5
                    } else {
                        slice[0]
                    });
                }
            }
        }
    }

    let mut asc: Vec<u8> = vals.to_vec();
    asc.sort_unstable();
    asc.dedup();
    let with_wheel: Vec<u8> = if asc.contains(&14) {
        let mut w = vec![1];
        w.extend(asc.iter().copied());
        w
    } else {
        asc
    };
    if with_wheel.len() >= 5 {
        for i in 0..=with_wheel.len() - 5 {
            let mut ok = true;
            for j in 1..5 {
                if with_wheel[i + j] != with_wheel[i] + j as u8 {
                    ok = false;
                    break;
                }
            }
            if ok {
                let high = with_wheel[i + 4];
                return Some(if high == 14 && with_wheel[i] == 10 {
                    14
                } else {
                    high
                });
            }
        }
    }
    None
}

/// Rank exactly five cards. Panics if `cards.len() != 5`.
pub fn rank_five(cards: &[Card]) -> RankedHand {
    assert_eq!(cards.len(), 5, "rank_five requires exactly 5 cards");
    let mut vals: Vec<u8> = cards.iter().map(|c| rank_value(c.rank)).collect();
    vals.sort_unstable_by(|a, b| b.cmp(a));
    let suits: Vec<_> = cards.iter().map(|c| c.suit).collect();
    let flush = suits.iter().all(|s| *s == suits[0]);

    let mut counts: Vec<(u8, u8)> = Vec::new();
    for v in &vals {
        if let Some(e) = counts.iter_mut().find(|(k, _)| k == v) {
            e.1 += 1;
        } else {
            counts.push((*v, 1));
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.cmp(&a.0)));
    let straight_high = is_straight(&vals);

    if flush {
        if let Some(sh) = straight_high {
            return RankedHand {
                category: HandCategory::StraightFlush,
                score: vec![HandCategory::StraightFlush.score(), sh],
                label: if sh == 14 {
                    "Royal flush".into()
                } else {
                    "Straight flush".into()
                },
            };
        }
    }
    if counts[0].1 == 4 {
        let kicker = counts.iter().find(|x| x.1 == 1).unwrap().0;
        return RankedHand {
            category: HandCategory::FourKind,
            score: vec![HandCategory::FourKind.score(), counts[0].0, kicker],
            label: "Four of a kind".into(),
        };
    }
    if counts[0].1 == 3 && counts.get(1).map(|x| x.1) == Some(2) {
        return RankedHand {
            category: HandCategory::FullHouse,
            score: vec![
                HandCategory::FullHouse.score(),
                counts[0].0,
                counts[1].0,
            ],
            label: "Full house".into(),
        };
    }
    if flush {
        let mut score = vec![HandCategory::Flush.score()];
        score.extend(vals.iter().copied());
        return RankedHand {
            category: HandCategory::Flush,
            score,
            label: "Flush".into(),
        };
    }
    if let Some(sh) = straight_high {
        return RankedHand {
            category: HandCategory::Straight,
            score: vec![HandCategory::Straight.score(), sh],
            label: "Straight".into(),
        };
    }
    if counts[0].1 == 3 {
        let kickers: Vec<u8> = counts.iter().filter(|x| x.1 == 1).map(|x| x.0).collect();
        let mut score = vec![HandCategory::ThreeKind.score(), counts[0].0];
        score.extend(kickers);
        return RankedHand {
            category: HandCategory::ThreeKind,
            score,
            label: "Three of a kind".into(),
        };
    }
    if counts[0].1 == 2 && counts.get(1).map(|x| x.1) == Some(2) {
        let mut pairs = [counts[0].0, counts[1].0];
        pairs.sort_unstable_by(|a, b| b.cmp(a));
        let kicker = counts.iter().find(|x| x.1 == 1).unwrap().0;
        return RankedHand {
            category: HandCategory::TwoPair,
            score: vec![
                HandCategory::TwoPair.score(),
                pairs[0],
                pairs[1],
                kicker,
            ],
            label: "Two pair".into(),
        };
    }
    if counts[0].1 == 2 {
        let kickers: Vec<u8> = counts.iter().filter(|x| x.1 == 1).map(|x| x.0).collect();
        let mut score = vec![HandCategory::Pair.score(), counts[0].0];
        score.extend(kickers);
        return RankedHand {
            category: HandCategory::Pair,
            score,
            label: "Pair".into(),
        };
    }
    let mut score = vec![HandCategory::HighCard.score()];
    score.extend(vals.iter().copied());
    RankedHand {
        category: HandCategory::HighCard,
        score,
        label: "High card".into(),
    }
}

pub fn best_hand(hole: &[Card], board: &[Card]) -> RankedHand {
    let mut all = Vec::with_capacity(hole.len() + board.len());
    all.extend_from_slice(hole);
    all.extend_from_slice(board);
    if all.len() < 5 {
        let pad = all[0];
        while all.len() < 5 {
            all.push(pad);
        }
        return rank_five(&all);
    }
    let mut best: Option<RankedHand> = None;
    for five in combinations(&all, 5) {
        let ranked = rank_five(&five);
        if best
            .as_ref()
            .map(|b| compare_scores(&ranked.score, &b.score) > 0)
            .unwrap_or(true)
        {
            best = Some(ranked);
        }
    }
    best.expect("at least one five-card combination")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::parse_card;

    fn c(s: &str) -> Card {
        parse_card(s).unwrap()
    }

    fn five(a: &str, b: &str, d: &str, e: &str, f: &str) -> RankedHand {
        rank_five(&[c(a), c(b), c(d), c(e), c(f)])
    }

    #[test]
    fn category_ordering_ladder() {
        let hands = [
            five("As", "Kd", "Qc", "Jh", "9s"), // high
            five("As", "Ad", "Kc", "Qh", "Js"), // pair
            five("As", "Ad", "Kc", "Kh", "Qs"), // two pair
            five("As", "Ad", "Ac", "Kh", "Qs"), // trips
            five("As", "Kd", "Qc", "Jh", "Ts"), // straight
            five("As", "Ks", "Qs", "9s", "2s"), // flush
            five("As", "Ad", "Ac", "Kh", "Ks"), // boat
            five("As", "Ad", "Ac", "Ah", "Ks"), // quads
            five("Ts", "Js", "Qs", "Ks", "As"), // royal
        ];
        for w in hands.windows(2) {
            assert!(
                compare_scores(&w[1].score, &w[0].score) > 0,
                "{} must beat {}",
                w[1].label,
                w[0].label
            );
        }
    }

    #[test]
    fn wheel_and_broadway() {
        let wheel = five("As", "2c", "3d", "4h", "5s");
        let six = five("2c", "3d", "4h", "5s", "6c");
        assert_eq!(wheel.category, HandCategory::Straight);
        assert_eq!(wheel.score, vec![4, 5]);
        assert!(compare_scores(&six.score, &wheel.score) > 0);
        let broadway = five("Ts", "Jh", "Qd", "Kc", "As");
        assert_eq!(broadway.score, vec![4, 14]);
    }

    #[test]
    fn kickers_pair_and_flush() {
        let ak = five("As", "Ad", "Kc", "7h", "2s");
        let aq = five("As", "Ad", "Qc", "7h", "2s");
        assert!(compare_scores(&ak.score, &aq.score) > 0);
        let f_high = five("As", "Ks", "Qs", "9s", "2s");
        let f_low = five("As", "Ks", "Js", "9s", "2s");
        assert!(compare_scores(&f_high.score, &f_low.score) > 0);
    }

    #[test]
    fn seven_card_best_of_three_pair() {
        // Board has three pair; best five is AA KK Q.
        let h = best_hand(
            &[c("2h"), c("3s")],
            &[c("Ac"), c("Ad"), c("Kc"), c("Kd"), c("Qh")],
        );
        assert_eq!(h.category, HandCategory::TwoPair);
        assert_eq!(h.score, vec![2, 14, 13, 12]);
    }

    #[test]
    fn aa_beats_kk() {
        let board = [c("2c"), c("3d"), c("4h"), c("5s"), c("7c")];
        let aa = best_hand(&[c("As"), c("Ah")], &board);
        let kk = best_hand(&[c("Kc"), c("Kd")], &board);
        assert!(compare_scores(&aa.score, &kk.score) > 0);
    }

    #[test]
    fn tie_identical_strength() {
        let board = [c("2c"), c("3d"), c("4h"), c("5s"), c("7c")];
        let a = best_hand(&[c("As"), c("Kh")], &board);
        let b = best_hand(&[c("Ad"), c("Kc")], &board);
        assert_eq!(compare_scores(&a.score, &b.score), 0);
    }
}
