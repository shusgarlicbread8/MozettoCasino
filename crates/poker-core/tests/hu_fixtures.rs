//! WP-031: replay WP-030 HU golden fixtures against Rust poker-core.

use poker_core::run_hu_fixtures_dir;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/game-rules/fixtures")
}

#[test]
fn all_hu_fixtures_pass_outcome_and_hash_checks() {
    let dir = fixtures_dir();
    assert!(dir.is_dir(), "missing fixtures dir: {}", dir.display());

    let reports = run_hu_fixtures_dir(&dir).expect("load fixtures");
    assert_eq!(
        reports.len(),
        12,
        "expected 12 HU fixtures, found {}",
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
            "{} / {} HU fixtures failed:\n\n{}",
            failed.len(),
            reports.len(),
            failed.join("\n\n")
        );
    }
}

#[test]
fn fold_win_stacks_and_winners() {
    use poker_core::{
        apply_action, create_table, seat_player, start_hand, ActionKind, TableConfig,
    };

    let cfg = TableConfig {
        table_id: "t".into(),
        small_blind: 50,
        big_blind: 100,
        rake_bps: 0,
        rake_cap: None,
    };
    let mut s = create_table(cfg, 2);
    s = seat_player(s, 0, "p0", "a0", 10_000);
    s = seat_player(s, 1, "p1", "a1", 10_000);
    let (s, _) = start_hand(s, "seed", "hand-1").unwrap();
    let (s, _) = apply_action(s, ActionKind::Fold, None).unwrap();
    assert_eq!(s.street, poker_core::Street::Settlement);
    assert_eq!(s.rake, 0);
    assert_eq!(s.winners.len(), 1);
    assert_eq!(s.winners[0].seat_index, 1);
    assert_eq!(s.winners[0].amount, 150);
    let stacks: Vec<_> = {
        let mut p: Vec<_> = s.seats.iter().map(|x| (x.seat_index, x.stack)).collect();
        p.sort_by_key(|(i, _)| *i);
        p.into_iter().map(|(_, st)| st).collect()
    };
    assert_eq!(stacks, vec![9950, 10050]);
}
