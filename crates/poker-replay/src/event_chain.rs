//! PokerEventV1 hash-chain verification (WP-064).
//!
//! Recomputes ABI `eventHash` via `protocol-vectors-rs` and checks
//! `previousEventHash` continuity. Detects divergent / mutated transcripts.
//! Settlement proposal tip/sequence checks are optional.

use alloy_primitives::B256;
use protocol_vectors_rs::{event_hash, parse_b256};
use serde::{Deserialize, Serialize};

pub const ZERO_EVENT_HASH: B256 = B256::ZERO;
pub const VERIFIER_BUILD_ID: &str = "mozetto-poker-replay-wp064";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PokerEventV1Json {
    pub protocol_version: u16,
    pub session_id: String,
    pub epoch: u64,
    pub hand_number: u64,
    pub sequence: u64,
    pub event_type: u16,
    pub has_actor_seat: bool,
    pub actor_seat: u8,
    pub public_payload_hash: String,
    #[serde(default = "zero_hex")]
    pub private_payload_commitment: String,
    pub elapsed_ms: u64,
    pub previous_event_hash: String,
    pub engine_hash: String,
    /// Optional stored hash — when present, must match recomputation.
    #[serde(default)]
    pub event_hash: Option<String>,
}

fn zero_hex() -> String {
    format!("0x{}", "00".repeat(32))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementProposalJson {
    pub final_sequence: u64,
    pub event_root: String,
    #[serde(default)]
    pub hand_root: Option<String>,
    #[serde(default)]
    pub balance_root: Option<String>,
    #[serde(default)]
    pub total_rake: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTranscriptJson {
    #[serde(default = "default_schema")]
    pub schema_kind: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub epoch: Option<u64>,
    pub events: Vec<PokerEventV1Json>,
    #[serde(default)]
    pub expected_tip: Option<String>,
    #[serde(default)]
    pub settlement_proposal: Option<SettlementProposalJson>,
}

fn default_schema() -> String {
    "poker_event_v1".into()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChainIssueCode {
    HashMismatch,
    PrevBreak,
    SequenceGap,
    ActorSeatInvalid,
    TipMismatch,
    ProposalRootMismatch,
    ProposalSequenceMismatch,
    EmptyChain,
    SchemaUnsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainIssue {
    pub sequence: Option<u64>,
    pub code: ChainIssueCode,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerifyReport {
    pub work_packet: &'static str,
    pub verifier_build_id: &'static str,
    pub schema_kind: String,
    pub ok: bool,
    pub tip: String,
    pub final_sequence: Option<u64>,
    pub event_count: usize,
    pub issues: Vec<ChainIssue>,
    pub proposal_ok: Option<bool>,
}

fn hex_b256(s: &str) -> B256 {
    parse_b256(s)
}

fn fmt_b256(h: B256) -> String {
    format!("{h:#x}")
}

/// Verify an ordered PokerEventV1 transcript (recompute hashes + prev linkage).
pub fn verify_poker_event_v1_chain(
    events: &[PokerEventV1Json],
    expected_tip: Option<&str>,
    proposal: Option<&SettlementProposalJson>,
) -> ChainVerifyReport {
    let mut issues = Vec::new();
    if events.is_empty() {
        issues.push(ChainIssue {
            sequence: None,
            code: ChainIssueCode::EmptyChain,
            detail: "no events".into(),
        });
        return ChainVerifyReport {
            work_packet: "WP-064",
            verifier_build_id: VERIFIER_BUILD_ID,
            schema_kind: "poker_event_v1".into(),
            ok: false,
            tip: fmt_b256(ZERO_EVENT_HASH),
            final_sequence: None,
            event_count: 0,
            issues,
            proposal_ok: None,
        };
    }

    let mut expected_prev = ZERO_EVENT_HASH;
    let mut tip = ZERO_EVENT_HASH;
    let mut last_seq = 0u64;

    for (i, ev) in events.iter().enumerate() {
        if ev.sequence != i as u64 {
            issues.push(ChainIssue {
                sequence: Some(ev.sequence),
                code: ChainIssueCode::SequenceGap,
                detail: format!("index {i} has sequence {}", ev.sequence),
            });
        }
        if !ev.has_actor_seat && ev.actor_seat != 0 {
            issues.push(ChainIssue {
                sequence: Some(ev.sequence),
                code: ChainIssueCode::ActorSeatInvalid,
                detail: "actorSeat MUST be 0 when hasActorSeat=false".into(),
            });
        }

        let prev = hex_b256(&ev.previous_event_hash);
        if prev != expected_prev {
            issues.push(ChainIssue {
                sequence: Some(ev.sequence),
                code: ChainIssueCode::PrevBreak,
                detail: format!(
                    "previousEventHash {} != expected {}",
                    fmt_b256(prev),
                    fmt_b256(expected_prev)
                ),
            });
        }

        let recomputed = event_hash(
            ev.protocol_version,
            hex_b256(&ev.session_id),
            ev.epoch,
            ev.hand_number,
            ev.sequence,
            ev.event_type,
            ev.has_actor_seat,
            ev.actor_seat,
            hex_b256(&ev.public_payload_hash),
            hex_b256(&ev.private_payload_commitment),
            ev.elapsed_ms,
            prev,
            hex_b256(&ev.engine_hash),
        );

        if let Some(stored) = &ev.event_hash {
            let stored_h = hex_b256(stored);
            if stored_h != recomputed {
                issues.push(ChainIssue {
                    sequence: Some(ev.sequence),
                    code: ChainIssueCode::HashMismatch,
                    detail: format!(
                        "stored {} != recomputed {}",
                        fmt_b256(stored_h),
                        fmt_b256(recomputed)
                    ),
                });
            }
        }

        tip = recomputed;
        expected_prev = recomputed;
        last_seq = ev.sequence;
    }

    if let Some(exp) = expected_tip {
        let exp_h = hex_b256(exp);
        if exp_h != tip {
            issues.push(ChainIssue {
                sequence: Some(last_seq),
                code: ChainIssueCode::TipMismatch,
                detail: format!(
                    "expected tip {} != recomputed {}",
                    fmt_b256(exp_h),
                    fmt_b256(tip)
                ),
            });
        }
    }

    let mut proposal_ok = None;
    if let Some(p) = proposal {
        let mut prop_ok = true;
        let claimed = hex_b256(&p.event_root);
        if claimed != tip {
            prop_ok = false;
            issues.push(ChainIssue {
                sequence: Some(last_seq),
                code: ChainIssueCode::ProposalRootMismatch,
                detail: format!(
                    "proposal eventRoot {} != chain tip {}",
                    fmt_b256(claimed),
                    fmt_b256(tip)
                ),
            });
        }
        if p.final_sequence != last_seq {
            prop_ok = false;
            issues.push(ChainIssue {
                sequence: Some(last_seq),
                code: ChainIssueCode::ProposalSequenceMismatch,
                detail: format!(
                    "proposal finalSequence {} != last sequence {}",
                    p.final_sequence, last_seq
                ),
            });
        }
        proposal_ok = Some(prop_ok);
    }

    ChainVerifyReport {
        work_packet: "WP-064",
        verifier_build_id: VERIFIER_BUILD_ID,
        schema_kind: "poker_event_v1".into(),
        ok: issues.is_empty(),
        tip: fmt_b256(tip),
        final_sequence: Some(last_seq),
        event_count: events.len(),
        issues,
        proposal_ok,
    }
}

pub fn verify_transcript_json(raw: &str) -> ChainVerifyReport {
    let t: EventTranscriptJson = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return ChainVerifyReport {
                work_packet: "WP-064",
                verifier_build_id: VERIFIER_BUILD_ID,
                schema_kind: "unknown".into(),
                ok: false,
                tip: fmt_b256(ZERO_EVENT_HASH),
                final_sequence: None,
                event_count: 0,
                issues: vec![ChainIssue {
                    sequence: None,
                    code: ChainIssueCode::SchemaUnsupported,
                    detail: format!("invalid transcript JSON: {e}"),
                }],
                proposal_ok: None,
            };
        }
    };

    if t.schema_kind != "poker_event_v1" {
        return ChainVerifyReport {
            work_packet: "WP-064",
            verifier_build_id: VERIFIER_BUILD_ID,
            schema_kind: t.schema_kind,
            ok: false,
            tip: fmt_b256(ZERO_EVENT_HASH),
            final_sequence: None,
            event_count: t.events.len(),
            issues: vec![ChainIssue {
                sequence: None,
                code: ChainIssueCode::SchemaUnsupported,
                detail: "poker-replay verify-events expects schemaKind=poker_event_v1 (legacy JSON is TS-service path)".into(),
            }],
            proposal_ok: None,
        };
    }

    verify_poker_event_v1_chain(
        &t.events,
        t.expected_tip.as_deref(),
        t.settlement_proposal.as_ref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::U256;
    use protocol_vectors_rs::{
        action_payload_hash, blind_payload_hash, keccak_str, parse_b256,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;

    fn vectors_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../specs/canonical-vectors")
    }

    fn load(name: &str) -> Value {
        let raw = fs::read_to_string(vectors_dir().join(name)).expect("vector");
        serde_json::from_str(&raw).expect("json")
    }

    fn session_id_hu() -> B256 {
        let f = load("01_session_hu.json");
        parse_b256(
            f["expectedDecodedStructure"]["sessionId"]
                .as_str()
                .expect("sessionId"),
        )
    }

    fn engine() -> B256 {
        keccak_str("mozetto-nlhe-engine-v3-draft")
    }

    fn build_03() -> (Vec<PokerEventV1Json>, B256) {
        let session = session_id_hu();
        let eng = engine();
        let hole_pub = keccak_str("hole-dealt-committed");
        let hole_priv = keccak_str("private-hole-commitment");
        let specs: Vec<(u16, bool, u8, B256, B256, u64)> = vec![
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
        ];

        let mut prev = B256::ZERO;
        let mut events = Vec::new();
        for (i, (etype, has, seat, pubh, privc, elapsed)) in specs.into_iter().enumerate() {
            let h = event_hash(
                3,
                session,
                0,
                1,
                i as u64,
                etype,
                has,
                seat,
                pubh,
                privc,
                elapsed,
                prev,
                eng,
            );
            events.push(PokerEventV1Json {
                protocol_version: 3,
                session_id: format!("{session:#x}"),
                epoch: 0,
                hand_number: 1,
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
        (events, prev)
    }

    #[test]
    fn vector_03_chain_verifies() {
        let f = load("03_preflop_sequence.json");
        let (events, tip) = build_03();
        let expected = parse_b256(f["keccak256"].as_str().unwrap());
        assert_eq!(tip, expected);
        let report = verify_poker_event_v1_chain(&events, Some(&format!("{expected:#x}")), None);
        assert!(report.ok, "{:?}", report.issues);
        assert_eq!(report.event_count, 6);
    }

    #[test]
    fn mutation_elapsed_diverges() {
        let (mut events, tip) = build_03();
        let last = events.last_mut().unwrap();
        last.elapsed_ms = 8101;
        // clear stored hash so we only detect tip mismatch vs golden
        last.event_hash = None;
        let report = verify_poker_event_v1_chain(&events, Some(&format!("{tip:#x}")), None);
        assert!(!report.ok);
        assert!(report
            .issues
            .iter()
            .any(|i| i.code == ChainIssueCode::TipMismatch));
    }

    #[test]
    fn mutation_prev_break_detected() {
        let (mut events, _) = build_03();
        events[2].previous_event_hash = format!("{:#x}", B256::ZERO);
        events[2].event_hash = None;
        let report = verify_poker_event_v1_chain(&events, None, None);
        assert!(!report.ok);
        assert!(report
            .issues
            .iter()
            .any(|i| i.code == ChainIssueCode::PrevBreak));
    }

    #[test]
    fn divergent_proposal_rejected() {
        let (events, tip) = build_03();
        let bad = SettlementProposalJson {
            final_sequence: 5,
            event_root: format!("{:#x}", keccak_str("wrong-root")),
            hand_root: None,
            balance_root: None,
            total_rake: None,
        };
        let report = verify_poker_event_v1_chain(&events, Some(&format!("{tip:#x}")), Some(&bad));
        assert!(!report.ok);
        assert_eq!(report.proposal_ok, Some(false));
        assert!(report
            .issues
            .iter()
            .any(|i| i.code == ChainIssueCode::ProposalRootMismatch));
    }

    #[test]
    fn honest_proposal_accepted() {
        let (events, tip) = build_03();
        let good = SettlementProposalJson {
            final_sequence: 5,
            event_root: format!("{tip:#x}"),
            hand_root: Some(format!("{:#x}", keccak_str("hand"))),
            balance_root: Some(format!("{:#x}", keccak_str("bal"))),
            total_rake: Some("0".into()),
        };
        let report = verify_poker_event_v1_chain(&events, Some(&format!("{tip:#x}")), Some(&good));
        assert!(report.ok, "{:?}", report.issues);
        assert_eq!(report.proposal_ok, Some(true));
    }
}
