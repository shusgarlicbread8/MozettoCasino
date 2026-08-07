//! WP-033 golden vectors — shared with TS `@mozetto/game-rules`.

use poker_eval::{
    best_hand, card_code, card_from_code, compare_scores, parse_card, rank_five, Card, HandCategory,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct VectorFile {
    version: u32,
    vectors: Vec<Vector>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Vector {
    FiveCard {
        id: String,
        cards: Vec<String>,
        #[serde(default)]
        codes: Option<Vec<u8>>,
        expect: RankExpect,
    },
    CompareFive {
        id: String,
        #[serde(rename = "cardsA")]
        cards_a: Vec<String>,
        #[serde(rename = "cardsB")]
        cards_b: Vec<String>,
        expect: CmpExpect,
    },
    HoldemCompare {
        id: String,
        #[serde(rename = "holeA")]
        hole_a: Vec<String>,
        #[serde(rename = "holeB")]
        hole_b: Vec<String>,
        board: Vec<String>,
        expect: HoldemCmpExpect,
    },
    HoldemBest {
        id: String,
        hole: Vec<String>,
        board: Vec<String>,
        expect: RankExpect,
    },
}

#[derive(Debug, Deserialize)]
struct RankExpect {
    category: String,
    score: Vec<u8>,
    label: String,
}

#[derive(Debug, Deserialize)]
struct CmpExpect {
    cmp: i32,
}

#[derive(Debug, Deserialize)]
struct HoldemCmpExpect {
    cmp: i32,
    #[serde(rename = "categoryA")]
    category_a: Option<String>,
    #[serde(rename = "categoryB")]
    category_b: Option<String>,
}

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vectors/hand_eval_v1.json")
}

fn parse_cards(keys: &[String]) -> Vec<Card> {
    keys.iter()
        .map(|s| parse_card(s).unwrap_or_else(|e| panic!("{e}")))
        .collect()
}

fn load() -> VectorFile {
    let raw = std::fs::read_to_string(vectors_path()).expect("read hand_eval_v1.json");
    serde_json::from_str(&raw).expect("parse hand_eval_v1.json")
}

fn assert_rank(id: &str, got: &poker_eval::RankedHand, expect: &RankExpect) {
    let cat = HandCategory::from_str(&expect.category)
        .unwrap_or_else(|| panic!("{id}: unknown category {}", expect.category));
    assert_eq!(got.category, cat, "{id}: category");
    assert_eq!(got.category.as_str(), expect.category.as_str(), "{id}: category str");
    assert_eq!(got.score, expect.score, "{id}: score");
    assert_eq!(got.label, expect.label, "{id}: label");
}

fn cmp_sign(v: i32) -> i32 {
    v.signum()
}

#[test]
fn hand_eval_v1_vectors() {
    let file = load();
    assert_eq!(file.version, 1);
    assert!(!file.vectors.is_empty());

    for v in &file.vectors {
        match v {
            Vector::FiveCard {
                id,
                cards,
                codes,
                expect,
            } => {
                let parsed = parse_cards(cards);
                assert_eq!(parsed.len(), 5, "{id}: five cards");
                if let Some(codes) = codes {
                    assert_eq!(codes.len(), 5, "{id}: codes len");
                    for (i, code) in codes.iter().enumerate() {
                        assert_eq!(card_code(parsed[i]), *code, "{id}: code[{i}]");
                        assert_eq!(
                            card_from_code(*code).unwrap(),
                            parsed[i],
                            "{id}: from_code[{i}]"
                        );
                    }
                }
                let ranked = rank_five(&parsed);
                assert_rank(id, &ranked, expect);
            }
            Vector::CompareFive {
                id,
                cards_a,
                cards_b,
                expect,
            } => {
                let a = rank_five(&parse_cards(cards_a));
                let b = rank_five(&parse_cards(cards_b));
                assert_eq!(
                    cmp_sign(compare_scores(&a.score, &b.score)),
                    expect.cmp,
                    "{id}: cmp (A={:?} B={:?})",
                    a.score,
                    b.score
                );
            }
            Vector::HoldemCompare {
                id,
                hole_a,
                hole_b,
                board,
                expect,
            } => {
                let board_c = parse_cards(board);
                let a = best_hand(&parse_cards(hole_a), &board_c);
                let b = best_hand(&parse_cards(hole_b), &board_c);
                assert_eq!(
                    cmp_sign(compare_scores(&a.score, &b.score)),
                    expect.cmp,
                    "{id}: cmp"
                );
                if let Some(cat) = &expect.category_a {
                    assert_eq!(a.category.as_str(), cat.as_str(), "{id}: categoryA");
                }
                if let Some(cat) = &expect.category_b {
                    assert_eq!(b.category.as_str(), cat.as_str(), "{id}: categoryB");
                }
            }
            Vector::HoldemBest {
                id,
                hole,
                board,
                expect,
            } => {
                let ranked = best_hand(&parse_cards(hole), &parse_cards(board));
                assert_rank(id, &ranked, expect);
            }
        }
    }
}
