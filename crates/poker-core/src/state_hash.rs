//! TS freeze-oracle state hash (`MOZETTO_TS_ENGINE_STATE_V1`).
//! Matches `packages/game-rules/src/state-hash.ts` for differential parity.

use crate::legal::LegalAction;
use crate::types::{HoldemState, TableConfig};
use alloy_primitives::{keccak256, B256};
use poker_eval::card_key;
use std::fmt::Write as _;

pub const TS_ENGINE_STATE_DOMAIN: &str = "MOZETTO_TS_ENGINE_STATE_V1";
pub const TS_ENGINE_BUILD_ID: &str = "mozetto-nlhe-ts-freeze-wp030";

/// Format rake_bps as the TS JSON number for `rakePct` (e.g. 500 → `0.05`, 0 → `0`).
pub fn format_rake_pct(bps: u32) -> String {
    if bps == 0 {
        return "0".into();
    }
    // bps / 10000 as decimal without scientific notation; trim trailing zeros.
    let whole = bps / 10_000;
    let frac = bps % 10_000;
    let mut s = format!("{whole}.{frac:04}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    s
}

fn stable_stringify_null() -> &'static str {
    "null"
}

fn escape_json_string(s: &str) -> String {
    serde_json::to_string(s).expect("string serialize")
}

/// Stable JSON with sorted object keys (arrays keep order) — mirrors TS `stableStringify`.
pub fn stable_stringify_value(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => stable_stringify_null().into(),
        serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.into(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => escape_json_string(s),
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(stable_stringify_value).collect();
            format!("[{}]", parts.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        escape_json_string(k),
                        stable_stringify_value(&map[k])
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

fn config_json(cfg: &TableConfig) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    obj.insert("tableId".into(), cfg.table_id.clone().into());
    obj.insert("smallBlind".into(), cfg.small_blind.into());
    obj.insert("bigBlind".into(), cfg.big_blind.into());
    // Emit rakePct as JSON number matching TS (not an integer bps field).
    let pct = format_rake_pct(cfg.rake_bps);
    let num: serde_json::Number = pct.parse().expect("rake pct number");
    obj.insert("rakePct".into(), serde_json::Value::Number(num));
    obj.insert(
        "rakeCap".into(),
        match cfg.rake_cap {
            Some(c) => c.into(),
            None => serde_json::Value::Null,
        },
    );
    serde_json::Value::Object(obj)
}

pub fn to_consensus_snapshot(state: &HoldemState) -> serde_json::Value {
    let mut seats: Vec<_> = state.seats.iter().collect();
    seats.sort_by_key(|s| s.seat_index);

    let seat_vals: Vec<serde_json::Value> = seats
        .into_iter()
        .map(|s| {
            let hole = match &s.hole {
                Some(h) => serde_json::Value::Array(
                    h.iter()
                        .map(|c| serde_json::Value::String(card_key(*c)))
                        .collect(),
                ),
                None => serde_json::Value::Null,
            };
            let mut o = serde_json::Map::new();
            o.insert("seatIndex".into(), s.seat_index.into());
            o.insert("stack".into(), s.stack.into());
            o.insert("bet".into(), s.bet.into());
            o.insert("totalBet".into(), s.total_bet.into());
            o.insert("hole".into(), hole);
            o.insert("folded".into(), s.folded.into());
            o.insert("allIn".into(), s.all_in.into());
            o.insert("sitOut".into(), s.sit_out.into());
            o.insert("occupied".into(), (!s.player_id.is_empty()).into());
            serde_json::Value::Object(o)
        })
        .collect();

    let winners: Vec<serde_json::Value> = state
        .winners
        .iter()
        .map(|w| {
            let mut o = serde_json::Map::new();
            o.insert("seatIndex".into(), w.seat_index.into());
            o.insert("amount".into(), w.amount.into());
            serde_json::Value::Object(o)
        })
        .collect();

    let acted: Vec<serde_json::Value> = state
        .acted_this_street
        .iter()
        .map(|i| serde_json::Value::from(*i))
        .collect();

    let mut snap = serde_json::Map::new();
    snap.insert("domain".into(), TS_ENGINE_STATE_DOMAIN.into());
    snap.insert("buildId".into(), TS_ENGINE_BUILD_ID.into());
    snap.insert("config".into(), config_json(&state.config));
    snap.insert(
        "handId".into(),
        match &state.hand_id {
            Some(h) => h.clone().into(),
            None => serde_json::Value::Null,
        },
    );
    snap.insert("handNumber".into(), state.hand_number.into());
    snap.insert("street".into(), state.street.as_str().into());
    snap.insert("button".into(), state.button.into());
    snap.insert(
        "deck".into(),
        serde_json::Value::Array(
            state
                .deck
                .iter()
                .map(|c| serde_json::Value::String(card_key(*c)))
                .collect(),
        ),
    );
    snap.insert(
        "board".into(),
        serde_json::Value::Array(
            state
                .board
                .iter()
                .map(|c| serde_json::Value::String(card_key(*c)))
                .collect(),
        ),
    );
    snap.insert("pot".into(), state.pot.into());
    snap.insert("seats".into(), serde_json::Value::Array(seat_vals));
    snap.insert(
        "actingIndex".into(),
        match state.acting_index {
            Some(i) => i.into(),
            None => serde_json::Value::Null,
        },
    );
    snap.insert("currentBet".into(), state.current_bet.into());
    snap.insert("minRaise".into(), state.min_raise.into());
    snap.insert(
        "lastAggressor".into(),
        match state.last_aggressor {
            Some(i) => i.into(),
            None => serde_json::Value::Null,
        },
    );
    snap.insert(
        "firstToAct".into(),
        match state.first_to_act {
            Some(i) => i.into(),
            None => serde_json::Value::Null,
        },
    );
    snap.insert(
        "seedCommit".into(),
        match &state.seed_commit {
            Some(s) => s.clone().into(),
            None => serde_json::Value::Null,
        },
    );
    snap.insert("winners".into(), serde_json::Value::Array(winners));
    snap.insert("rake".into(), state.rake.into());
    snap.insert("actedThisStreet".into(), serde_json::Value::Array(acted));
    snap.insert("lastRaiseComplete".into(), state.last_raise_complete.into());
    serde_json::Value::Object(snap)
}

pub fn hash_engine_state(state: &HoldemState) -> B256 {
    let snapshot = to_consensus_snapshot(state);
    let body_str = stable_stringify_value(&snapshot);
    let body = keccak256(body_str.as_bytes());
    let domain_tag = keccak256(TS_ENGINE_STATE_DOMAIN.as_bytes());
    let mut concat = [0u8; 64];
    concat[..32].copy_from_slice(domain_tag.as_slice());
    concat[32..].copy_from_slice(body.as_slice());
    keccak256(concat)
}

pub fn hash_legal_actions(actions: &[LegalAction]) -> B256 {
    let mut normalized: Vec<serde_json::Value> = actions
        .iter()
        .map(|a| {
            let mut o = serde_json::Map::new();
            o.insert("action".into(), a.action.as_str().into());
            o.insert(
                "minAmount".into(),
                match a.min_amount {
                    Some(v) => v.into(),
                    None => serde_json::Value::Null,
                },
            );
            o.insert(
                "maxAmount".into(),
                match a.max_amount {
                    Some(v) => v.into(),
                    None => serde_json::Value::Null,
                },
            );
            serde_json::Value::Object(o)
        })
        .collect();
    normalized.sort_by(|a, b| {
        let aa = a["action"].as_str().unwrap_or("");
        let bb = b["action"].as_str().unwrap_or("");
        aa.cmp(bb)
    });
    let domain = format!("{TS_ENGINE_STATE_DOMAIN}:legal");
    let body_str = stable_stringify_value(&serde_json::Value::Array(normalized));
    let body = keccak256(body_str.as_bytes());
    let domain_tag = keccak256(domain.as_bytes());
    let mut concat = [0u8; 64];
    concat[..32].copy_from_slice(domain_tag.as_slice());
    concat[32..].copy_from_slice(body.as_slice());
    keccak256(concat)
}

pub fn format_hash(h: &B256) -> String {
    let mut s = String::with_capacity(66);
    s.push_str("0x");
    for b in h.as_slice() {
        let _ = write!(s, "{b:02x}");
    }
    s
}
