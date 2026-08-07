//! WP-032: replay WP-030 multi / six-max golden fixtures against Rust poker-core.

use poker_core::{
    apply_action, create_table, seat_player, start_hand, ActionKind, TableConfig,
};
use poker_core::run_multi_fixtures_dir;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/game-rules/fixtures")
}

#[test]
fn all_multi_and_sixmax_fixtures_pass() {
    let dir = fixtures_dir();
    assert!(dir.is_dir(), "missing fixtures dir: {}", dir.display());

    let reports = run_multi_fixtures_dir(&dir).expect("load fixtures");
    assert_eq!(
        reports.len(),
        8,
        "expected 8 multi/sixmax fixtures, found {}",
        reports.len()
    );

    let mut failed = Vec::new();
    for r in &reports {
        if let Some(err) = &r.error {
            failed.push(format!("{}: load/run error: {err}", r.id));
            continue;
        }
        let bad: Vec<_> = r.checks.iter().filter(|c| !c.ok).collect();
        if !bad.is_empty() {
            let details = bad
                .iter()
                .map(|c| format!("  - {}: {}", c.field, c.detail))
                .collect::<Vec<_>>()
                .join("\n");
            failed.push(format!("{} failed checks:\n{details}", r.id));
        }
    }

    if !failed.is_empty() {
        panic!(
            "{} / {} multi/sixmax fixtures failed:\n\n{}",
            failed.len(),
            reports.len(),
            failed.join("\n\n")
        );
    }
}

#[test]
fn sixmax_blinds_utg_first_to_act() {
    let cfg = TableConfig {
        table_id: "t".into(),
        small_blind: 50,
        big_blind: 100,
        rake_bps: 0,
        rake_cap: None,
    };
    let mut s = create_table(cfg, 6);
    for i in 0..6u8 {
        s = seat_player(s, i, format!("p{i}"), format!("a{i}"), 10_000);
    }
    let (s, _) = start_hand(s, "seed", "hand-1").unwrap();
    // button advances from seat 5 → 0; SB=1, BB=2, UTG=3
    assert_eq!(s.button, 0);
    assert_eq!(s.acting_index, Some(3));
    assert_eq!(s.pot, 150);
    assert_eq!(s.seats[1].stack, 9950);
    assert_eq!(s.seats[2].stack, 9900);
}

#[test]
fn sixmax_fold_to_bb() {
    let cfg = TableConfig {
        table_id: "t".into(),
        small_blind: 50,
        big_blind: 100,
        rake_bps: 0,
        rake_cap: None,
    };
    let mut s = create_table(cfg, 6);
    for i in 0..6u8 {
        s = seat_player(s, i, format!("p{i}"), format!("a{i}"), 10_000);
    }
    let (mut s, _) = start_hand(s, "seed", "hand-1").unwrap();
    for _ in 0..5 {
        let (next, _) = apply_action(s, ActionKind::Fold, None).unwrap();
        s = next;
    }
    assert_eq!(s.street, poker_core::Street::Settlement);
    assert_eq!(s.winners.len(), 1);
    assert_eq!(s.winners[0].seat_index, 2);
    assert_eq!(s.winners[0].amount, 100); // WP-109: eligible pot after uncalled return
}

#[test]
fn sit_out_skips_blinds_and_utg() {
    use poker_core::{create_table, seat_player, set_sit_out, start_hand, TableConfig};

    let cfg = TableConfig {
        table_id: "t".into(),
        small_blind: 50,
        big_blind: 100,
        rake_bps: 0,
        rake_cap: None,
    };
    let mut s = create_table(cfg, 6);
    for i in 0..6u8 {
        s = seat_player(s, i, format!("p{i}"), format!("a{i}"), 10_000);
    }
    s = set_sit_out(s, 3, true);
    let (s, _) = start_hand(s, "seed", "hand-1").unwrap();
    assert!(s.seats[3].folded);
    assert!(s.seats[3].hole.is_none());
    assert_eq!(s.pot, 150);
    assert_eq!(s.acting_index, Some(4));
}

#[test]
fn timeout_fallback_prefers_fold() {
    use poker_core::{
        create_table, seat_player, start_hand, timeout_fallback_action, ActionKind, TableConfig,
    };

    let cfg = TableConfig {
        table_id: "t".into(),
        small_blind: 50,
        big_blind: 100,
        rake_bps: 0,
        rake_cap: None,
    };
    let mut s = create_table(cfg, 2);
    s = seat_player(s, 0, "p0", "a0", 1000);
    s = seat_player(s, 1, "p1", "a1", 1000);
    let (s, _) = start_hand(s, "seed", "hand-1").unwrap();
    let fb = timeout_fallback_action(&s).expect("timeout action");
    assert_eq!(fb.action, ActionKind::Fold);
}
