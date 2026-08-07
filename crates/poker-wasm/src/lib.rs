//! Mozetto WP-035 — WASM replay verifier.
//!
//! Public replays: fixture JSON already carries committed deck openings (`serverSeed` /
//! `handId`) plus the action stream. No private dealer TEE material is required.
//!
//! Exposed surface (JSON in / JSON out):
//! - `verify_fixture(json)` → single fixture report (stacks + stateHash + expect checks)
//! - `verify_fixtures(json_array)` → batch summary
//! - `engine_build_id()` / `verifier_build_id()`

use poker_core::{verify_fixture_json, FixtureReport, RUST_ENGINE_BUILD_ID};
use serde::Serialize;
use wasm_bindgen::prelude::*;

pub const VERIFIER_BUILD_ID: &str = "mozetto-poker-wasm-wp035";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchReport {
    work_packet: &'static str,
    verifier_build_id: &'static str,
    engine_build_id: &'static str,
    ok: bool,
    fixture_count: usize,
    passed: usize,
    failed: usize,
    reports: Vec<FixtureReport>,
}

/// Rust engine build id embedded in the WASM module.
#[wasm_bindgen]
pub fn engine_build_id() -> String {
    RUST_ENGINE_BUILD_ID.to_string()
}

/// WASM verifier package build id (WP-035).
#[wasm_bindgen]
pub fn verifier_build_id() -> String {
    VERIFIER_BUILD_ID.to_string()
}

/// Replay one WP-030 fixture JSON string; return a JSON [`FixtureReport`].
///
/// Always returns JSON (never panics). Parse/run failures set `ok: false` + `error`.
#[wasm_bindgen]
pub fn verify_fixture(fixture_json: &str) -> String {
    let report = verify_fixture_json(fixture_json);
    serde_json::to_string(&report).unwrap_or_else(|e| {
        format!(
            r#"{{"id":"<serialize-error>","ok":false,"checks":[],"error":{}}}"#,
            serde_json::to_string(&e.to_string()).unwrap_or_else(|_| "\"?\"".into())
        )
    })
}

/// Replay a JSON array of fixture objects; return a batch summary JSON.
#[wasm_bindgen]
pub fn verify_fixtures(fixtures_json_array: &str) -> String {
    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(fixtures_json_array);
    let reports = match parsed {
        Ok(items) => items
            .into_iter()
            .map(|v| verify_fixture_json(&v.to_string()))
            .collect::<Vec<_>>(),
        Err(e) => {
            return serde_json::to_string(&BatchReport {
                work_packet: "WP-035",
                verifier_build_id: VERIFIER_BUILD_ID,
                engine_build_id: RUST_ENGINE_BUILD_ID,
                ok: false,
                fixture_count: 0,
                passed: 0,
                failed: 1,
                reports: vec![FixtureReport {
                    id: "<batch-parse-error>".into(),
                    ok: false,
                    checks: Vec::new(),
                    error: Some(e.to_string()),
                    final_stacks: None,
                    final_state_hash: None,
                }],
            })
            .unwrap_or_else(|_| r#"{"ok":false}"#.into());
        }
    };

    let passed = reports.iter().filter(|r| r.ok).count();
    let failed = reports.len() - passed;
    let batch = BatchReport {
        work_packet: "WP-035",
        verifier_build_id: VERIFIER_BUILD_ID,
        engine_build_id: RUST_ENGINE_BUILD_ID,
        ok: failed == 0 && !reports.is_empty(),
        fixture_count: reports.len(),
        passed,
        failed,
        reports,
    };
    serde_json::to_string(&batch).unwrap_or_else(|_| r#"{"ok":false}"#.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_minimal_fold_fixture() {
        // Same tableId + seed as hu_02 so stateHash matches the WP-030 freeze.
        let json = r#"{
          "id": "hu_smoke",
          "format": "hu",
          "seatCount": 2,
          "config": {
            "tableId": "freeze-hu",
            "smallBlind": 50,
            "bigBlind": 100,
            "rakePct": 0,
            "rakeCap": null
          },
          "seats": [
            { "seatIndex": 0, "stack": 10000 },
            { "seatIndex": 1, "stack": 10000 }
          ],
          "steps": [
            { "op": "startHand", "serverSeed": "wp030-hu-fold", "handId": "hand-hu-fold" },
            { "op": "action", "action": "fold" },
            {
              "op": "expect",
              "expect": {
                "street": "settlement",
                "stacks": [9950, 10050],
                "stateHash": "0x9bc5b91a53df4bbd57dbc4fbb2469a1d6c9b723ecc0c98afc56338a960226b54"
              }
            }
          ]
        }"#;
        let out = verify_fixture(json);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "report={out}");
        assert_eq!(v["finalStacks"], serde_json::json!([9950, 10050]));
        assert_eq!(
            v["finalStateHash"],
            "0x9bc5b91a53df4bbd57dbc4fbb2469a1d6c9b723ecc0c98afc56338a960226b54"
        );
    }
}
