//! Native CLI replay verifier (WP-035 fixtures + WP-064 PokerEventV1 chains).
//!
//! ```text
//! cargo run -p poker-replay -- verify packages/game-rules/fixtures
//! cargo run -p poker-replay -- verify-events path/to/transcript.json
//! cargo run -p poker-replay -- verify-events --golden 03
//! ```

mod event_chain;

use event_chain::{verify_transcript_json, VERIFIER_BUILD_ID as EVENT_VERIFIER_BUILD_ID};
use poker_core::{run_fixture_file, verify_fixture_json, FixtureReport, RUST_ENGINE_BUILD_ID};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const FIXTURE_VERIFIER_BUILD_ID: &str = "mozetto-poker-replay-wp035";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliReport {
    work_packet: &'static str,
    verifier_build_id: &'static str,
    engine_build_id: &'static str,
    ok: bool,
    fixture_count: usize,
    passed: usize,
    failed: usize,
    reports: Vec<FixtureReport>,
}

fn usage() -> ! {
    eprintln!(
        "poker-replay — Mozetto WP-035/WP-064 native verifier\n\n\
         Usage:\n  \
           poker-replay verify <fixture.json|fixtures-dir>\n  \
           poker-replay verify-json <fixture.json-string-via-stdin>\n  \
           poker-replay verify-events <transcript.json>\n  \
           poker-replay verify-events --stdin\n  \
           poker-replay verify-events --golden 03|04\n\n\
         Build ids: fixture={FIXTURE_VERIFIER_BUILD_ID} events={EVENT_VERIFIER_BUILD_ID} engine={RUST_ENGINE_BUILD_ID}"
    );
    std::process::exit(2);
}

fn collect_fixture_paths(path: &Path) -> Result<Vec<PathBuf>, String> {
    if path.is_file() {
        return Ok(vec![path.to_path_buf()]);
    }
    if !path.is_dir() {
        return Err(format!("not a file or directory: {}", path.display()));
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    n.ends_with(".json")
                        && (n.starts_with("hu_")
                            || n.starts_with("multi_")
                            || n.starts_with("sixmax_"))
                })
                .unwrap_or(false)
        })
        .collect();
    paths.sort();
    Ok(paths)
}

fn verify_paths(paths: &[PathBuf]) -> CliReport {
    let mut reports = Vec::new();
    for p in paths {
        match run_fixture_file(p) {
            Ok(r) => reports.push(r),
            Err(e) => reports.push(FixtureReport {
                id: p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .into(),
                ok: false,
                checks: Vec::new(),
                error: Some(e),
                final_stacks: None,
                final_state_hash: None,
            }),
        }
    }
    let passed = reports.iter().filter(|r| r.ok).count();
    let failed = reports.len() - passed;
    CliReport {
        work_packet: "WP-035",
        verifier_build_id: FIXTURE_VERIFIER_BUILD_ID,
        engine_build_id: RUST_ENGINE_BUILD_ID,
        ok: failed == 0 && !reports.is_empty(),
        fixture_count: reports.len(),
        passed,
        failed,
        reports,
    }
}

/// Embed golden vector 03/04 as a PokerEventV1 transcript for CLI smoke.
fn golden_transcript(which: &str) -> Result<String, String> {
    use alloy_primitives::{B256, U256};
    use event_chain::{PokerEventV1Json, SettlementProposalJson};
    use protocol_vectors_rs::{
        action_payload_hash, blind_payload_hash, event_hash, keccak_str, parse_b256,
    };
    use serde_json::Value;

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../specs/canonical-vectors");
    let session_f: Value = serde_json::from_str(
        &fs::read_to_string(root.join("01_session_hu.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let session = parse_b256(
        session_f["expectedDecodedStructure"]["sessionId"]
            .as_str()
            .ok_or("sessionId")?,
    );
    let eng = keccak_str("mozetto-nlhe-engine-v3-draft");

    let (hand, specs): (u64, Vec<(u16, bool, u8, B256, B256, u64)>) = match which {
        "03" => {
            let hole_pub = keccak_str("hole-dealt-committed");
            let hole_priv = keccak_str("private-hole-commitment");
            (
                1,
                vec![
                    (1, false, 0, keccak_str("hand-start-1"), B256::ZERO, 0),
                    (
                        2,
                        true,
                        0,
                        blind_payload_hash(0, U256::from(500_000u64)),
                        B256::ZERO,
                        10,
                    ),
                    (
                        2,
                        true,
                        1,
                        blind_payload_hash(1, U256::from(1_000_000u64)),
                        B256::ZERO,
                        20,
                    ),
                    (3, false, 0, hole_pub, hole_priv, 50),
                    (
                        14,
                        true,
                        0,
                        action_payload_hash(0, 14, U256::from(3_000_000u64)),
                        B256::ZERO,
                        4200,
                    ),
                    (
                        12,
                        true,
                        1,
                        action_payload_hash(1, 12, U256::from(2_000_000u64)),
                        B256::ZERO,
                        8100,
                    ),
                ],
            )
        }
        "04" => (
            2,
            vec![
                (
                    14,
                    true,
                    0,
                    action_payload_hash(0, 14, U256::from(3_000_000u64)),
                    B256::ZERO,
                    3000,
                ),
                (
                    15,
                    true,
                    1,
                    action_payload_hash(1, 15, U256::from(2_500_000u64)),
                    B256::ZERO,
                    5500,
                ),
                (
                    12,
                    true,
                    0,
                    action_payload_hash(0, 12, U256::from(0u64)),
                    B256::ZERO,
                    7000,
                ),
            ],
        ),
        other => return Err(format!("unknown golden {other}; use 03 or 04")),
    };

    let tip_file = if which == "03" {
        "03_preflop_sequence.json"
    } else {
        "04_incomplete_allin_raise.json"
    };
    let tip_f: Value = serde_json::from_str(
        &fs::read_to_string(root.join(tip_file)).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let expected_tip = tip_f["keccak256"].as_str().ok_or("tip")?.to_string();

    let mut prev = B256::ZERO;
    let mut events = Vec::new();
    for (i, (etype, has, seat, pubh, privc, elapsed)) in specs.into_iter().enumerate() {
        let h = event_hash(
            3, session, 0, hand, i as u64, etype, has, seat, pubh, privc, elapsed, prev, eng,
        );
        events.push(PokerEventV1Json {
            protocol_version: 3,
            session_id: format!("{session:#x}"),
            epoch: 0,
            hand_number: hand,
            sequence: i as u64,
            event_type: etype,
            has_actor_seat: has,
            actor_seat: seat,
            public_payload_hash: format!("{pubh:#x}"),
            private_payload_commitment: format!("{privc:#x}"),
            elapsed_ms: elapsed,
            previous_event_hash: format!("{prev:#x}"),
            engine_hash: format!("{eng:#x}"),
            event_hash: Some(format!("{h:#x}")),
        });
        prev = h;
    }

    let last_seq = events.last().map(|e| e.sequence).unwrap_or(0);
    let body = serde_json::json!({
        "schemaKind": "poker_event_v1",
        "sessionId": format!("{session:#x}"),
        "epoch": 0,
        "expectedTip": expected_tip,
        "events": events,
        "settlementProposal": SettlementProposalJson {
            final_sequence: last_seq,
            event_root: format!("{prev:#x}"),
            hand_root: None,
            balance_root: None,
            total_rake: Some("0".into()),
        }
    });
    Ok(serde_json::to_string(&body).expect("serialize"))
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let cmd = match args.next() {
        Some(c) => c,
        None => usage(),
    };

    match cmd.as_str() {
        "verify" => {
            let target = args.next().unwrap_or_else(|| usage());
            let paths = match collect_fixture_paths(Path::new(&target)) {
                Ok(p) if !p.is_empty() => p,
                Ok(_) => {
                    eprintln!("no hu_/multi_/sixmax_ fixtures under {target}");
                    return ExitCode::from(1);
                }
                Err(e) => {
                    eprintln!("{e}");
                    return ExitCode::from(1);
                }
            };
            let report = verify_paths(&paths);
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialize")
            );
            if report.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        "verify-json" => {
            let raw = match fs::read_to_string("/dev/stdin") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("stdin read failed: {e}");
                    return ExitCode::from(1);
                }
            };
            let r = verify_fixture_json(&raw);
            let passed = if r.ok { 1 } else { 0 };
            let report = CliReport {
                work_packet: "WP-035",
                verifier_build_id: FIXTURE_VERIFIER_BUILD_ID,
                engine_build_id: RUST_ENGINE_BUILD_ID,
                ok: r.ok,
                fixture_count: 1,
                passed,
                failed: 1 - passed,
                reports: vec![r],
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialize")
            );
            if report.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        "verify-events" => {
            let first = args.next().unwrap_or_else(|| usage());
            let raw = if first == "--golden" {
                let which = args.next().unwrap_or_else(|| usage());
                match golden_transcript(&which) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("{e}");
                        return ExitCode::from(1);
                    }
                }
            } else if first == "--stdin" {
                match fs::read_to_string("/dev/stdin") {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("stdin read failed: {e}");
                        return ExitCode::from(1);
                    }
                }
            } else {
                match fs::read_to_string(&first) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("read {first}: {e}");
                        return ExitCode::from(1);
                    }
                }
            };
            if raw.trim().is_empty() {
                eprintln!("empty transcript");
                return ExitCode::from(1);
            }
            let report = verify_transcript_json(&raw);
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialize")
            );
            if report.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        "version" | "--version" => {
            println!("poker-replay fixture={FIXTURE_VERIFIER_BUILD_ID} events={EVENT_VERIFIER_BUILD_ID} engine={RUST_ENGINE_BUILD_ID}");
            ExitCode::SUCCESS
        }
        _ => usage(),
    }
}
