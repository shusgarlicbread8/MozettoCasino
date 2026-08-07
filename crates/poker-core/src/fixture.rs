//! Replay WP-030 golden fixtures against the Rust NLHE engine (HU + multi / six-max).
//! Also emits WP-034 differential traces for TS ↔ Rust comparison.

use crate::engine::{
    apply_action, continue_runout, create_table, get_legal_actions, seat_player, settle_showdown,
    start_hand,
};
use crate::legal::LegalAction;
use crate::pots::build_pots;
use crate::state_hash::{format_hash, hash_engine_state, hash_legal_actions};
use crate::types::{ActionKind, Chips, HoldemState, SeatState, Street, TableConfig};
use poker_eval::{parse_card, Card};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const SUPPORTED_FORMATS: &[&str] = &["hu", "multi", "sixmax"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureFile {
    id: String,
    format: String,
    seat_count: usize,
    config: FixtureConfig,
    seats: Vec<FixtureSeat>,
    #[serde(default)]
    initial_button: Option<u8>,
    steps: Vec<FixtureStep>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureConfig {
    pub table_id: String,
    pub small_blind: Chips,
    pub big_blind: Chips,
    pub rake_pct: f64,
    pub rake_cap: Option<Chips>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureSeat {
    pub seat_index: u8,
    pub stack: Chips,
    #[serde(default)]
    pub player_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op")]
enum FixtureStep {
    #[serde(rename = "startHand")]
    StartHand {
        #[serde(rename = "serverSeed")]
        server_seed: String,
        #[serde(rename = "handId")]
        hand_id: String,
    },
    #[serde(rename = "action")]
    Action {
        action: ActionKind,
        amount: Option<Chips>,
    },
    #[serde(rename = "continueRunout")]
    ContinueRunout,
    #[serde(rename = "settleShowdown")]
    SettleShowdown,
    #[serde(rename = "forceBettingState")]
    ForceBettingState(ForceBetting),
    #[serde(rename = "injectShowdown")]
    InjectShowdown(InjectShowdown),
    #[serde(rename = "expect")]
    Expect { expect: FixtureExpect },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForceBetting {
    street: Street,
    board: Vec<String>,
    pot: Chips,
    current_bet: Chips,
    min_raise: Chips,
    button: u8,
    acting_index: u8,
    #[serde(default)]
    last_raise_complete: Option<bool>,
    #[serde(default)]
    acted_this_street: Option<Vec<u8>>,
    seats: Vec<ForceSeat>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForceSeat {
    seat_index: u8,
    stack: Chips,
    bet: Chips,
    total_bet: Chips,
    #[serde(default)]
    folded: Option<bool>,
    #[serde(default)]
    all_in: Option<bool>,
    hole: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InjectShowdown {
    button: u8,
    board: Vec<String>,
    seats: Vec<InjectSeat>,
    #[serde(default)]
    rake_pct: Option<f64>,
    #[serde(default)]
    rake_cap: Option<Option<Chips>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InjectSeat {
    seat_index: u8,
    stack: Chips,
    total_bet: Chips,
    hole: Vec<String>,
    #[serde(default)]
    folded: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FixtureExpect {
    pub state_hash: Option<String>,
    pub legal_actions_hash: Option<String>,
    pub street: Option<Street>,
    pub button: Option<u8>,
    pub acting_index: Option<Option<u8>>,
    pub pot: Option<Chips>,
    pub current_bet: Option<Chips>,
    pub min_raise: Option<Chips>,
    pub last_raise_complete: Option<bool>,
    pub stacks: Option<Vec<Chips>>,
    pub winners: Option<Vec<ExpectWinner>>,
    pub rake: Option<Chips>,
    pub pot_layers: Option<Vec<ExpectPotLayer>>,
    pub legal_actions: Option<Vec<ExpectLegal>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectPotLayer {
    pub amount: Chips,
    pub eligible: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectWinner {
    pub seat_index: u8,
    pub amount: Chips,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectLegal {
    pub action: ActionKind,
    pub min_amount: Option<Chips>,
    pub max_amount: Option<Chips>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureReport {
    pub id: String,
    pub ok: bool,
    pub checks: Vec<CheckResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Final stacks in seat-index order after replay (when run completed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_stacks: Option<Vec<Chips>>,
    /// Final consensus state hash after replay (when run completed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_state_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub field: String,
    pub ok: bool,
    pub detail: String,
}

fn final_stacks(state: &HoldemState) -> Vec<Chips> {
    let mut pairs: Vec<_> = state.seats.iter().map(|s| (s.seat_index, s.stack)).collect();
    pairs.sort_by_key(|(i, _)| *i);
    pairs.into_iter().map(|(_, st)| st).collect()
}

fn rake_pct_to_bps(pct: f64) -> u32 {
    // Fixtures use 0 or 0.05; convert without relying on float chip math in the engine.
    ((pct * 10_000.0) + 0.5).floor() as u32
}

fn parse_cards(keys: &[String]) -> Result<Vec<Card>, String> {
    keys.iter().map(|k| parse_card(k)).collect()
}

fn hole2(keys: &[String]) -> Result<[Card; 2], String> {
    let c = parse_cards(keys)?;
    if c.len() != 2 {
        return Err(format!("expected 2 hole cards, got {}", c.len()));
    }
    Ok([c[0], c[1]])
}

fn setup_table(fx: &FixtureFile) -> HoldemState {
    let config = TableConfig {
        table_id: fx.config.table_id.clone(),
        small_blind: fx.config.small_blind,
        big_blind: fx.config.big_blind,
        rake_bps: rake_pct_to_bps(fx.config.rake_pct),
        rake_cap: fx.config.rake_cap,
    };
    let mut state = create_table(config, fx.seat_count);
    if let Some(b) = fx.initial_button {
        state.button = b;
    }
    for s in &fx.seats {
        state = seat_player(
            state,
            s.seat_index,
            s.player_id
                .clone()
                .unwrap_or_else(|| format!("p{}", s.seat_index)),
            s.agent_id
                .clone()
                .unwrap_or_else(|| format!("a{}", s.seat_index)),
            s.stack,
        );
    }
    state
}

fn apply_force(mut state: HoldemState, step: &ForceBetting) -> Result<HoldemState, String> {
    let board = parse_cards(&step.board)?;
    let seat_map: std::collections::HashMap<u8, &ForceSeat> =
        step.seats.iter().map(|s| (s.seat_index, s)).collect();
    let mut seats = Vec::with_capacity(state.seats.len());
    for s in &state.seats {
        if let Some(o) = seat_map.get(&s.seat_index) {
            seats.push(SeatState {
                seat_index: s.seat_index,
                player_id: if s.player_id.is_empty() {
                    format!("p{}", s.seat_index)
                } else {
                    s.player_id.clone()
                },
                agent_id: if s.agent_id.is_empty() {
                    format!("a{}", s.seat_index)
                } else {
                    s.agent_id.clone()
                },
                stack: o.stack,
                bet: o.bet,
                total_bet: o.total_bet,
                folded: o.folded.unwrap_or(false),
                all_in: o.all_in.unwrap_or(o.stack == 0),
                sit_out: false,
                hole: Some(hole2(&o.hole)?),
            });
        } else {
            seats.push(SeatState {
                sit_out: true,
                folded: true,
                stack: 0,
                bet: 0,
                total_bet: 0,
                hole: None,
                ..s.clone()
            });
        }
    }
    state.street = step.street;
    state.board = board;
    state.pot = step.pot;
    state.current_bet = step.current_bet;
    state.min_raise = step.min_raise;
    state.button = step.button;
    state.acting_index = Some(step.acting_index);
    state.last_raise_complete = step.last_raise_complete.unwrap_or(true);
    state.acted_this_street = step
        .acted_this_street
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect::<BTreeSet<_>>();
    if state.hand_id.is_none() {
        state.hand_id = Some("forced-hand".into());
    }
    if state.server_seed.is_none() {
        state.server_seed = Some("forced-seed".into());
    }
    if state.seed_commit.is_none() {
        state.seed_commit = Some("forced-commit".into());
    }
    state.seats = seats;
    Ok(state)
}

fn apply_inject(mut state: HoldemState, step: &InjectShowdown) -> Result<HoldemState, String> {
    let board = parse_cards(&step.board)?;
    let seat_map: std::collections::HashMap<u8, &InjectSeat> =
        step.seats.iter().map(|s| (s.seat_index, s)).collect();
    let mut seats = Vec::with_capacity(state.seats.len());
    for s in &state.seats {
        if let Some(o) = seat_map.get(&s.seat_index) {
            seats.push(SeatState {
                seat_index: s.seat_index,
                player_id: if s.player_id.is_empty() {
                    format!("p{}", s.seat_index)
                } else {
                    s.player_id.clone()
                },
                agent_id: if s.agent_id.is_empty() {
                    format!("a{}", s.seat_index)
                } else {
                    s.agent_id.clone()
                },
                stack: o.stack,
                bet: 0,
                total_bet: o.total_bet,
                folded: o.folded.unwrap_or(false),
                all_in: o.stack == 0,
                sit_out: false,
                hole: Some(hole2(&o.hole)?),
            });
        } else {
            seats.push(SeatState {
                sit_out: true,
                folded: true,
                stack: 0,
                bet: 0,
                total_bet: 0,
                hole: None,
                ..s.clone()
            });
        }
    }
    let pot: Chips = seats.iter().map(|s| s.total_bet).sum();
    if let Some(pct) = step.rake_pct {
        state.config.rake_bps = rake_pct_to_bps(pct);
    }
    if let Some(cap) = &step.rake_cap {
        state.config.rake_cap = *cap;
    }
    state.button = step.button;
    state.board = board;
    state.pot = pot;
    state.street = Street::Showdown;
    state.seats = seats;
    state.acting_index = None;
    if state.hand_id.is_none() {
        state.hand_id = Some("showdown-hand".into());
    }
    if state.server_seed.is_none() {
        state.server_seed = Some("showdown-seed".into());
    }
    if state.seed_commit.is_none() {
        state.seed_commit = Some("showdown-commit".into());
    }
    Ok(state)
}

fn check(field: &str, ok: bool, detail: impl Into<String>) -> CheckResult {
    CheckResult {
        field: field.into(),
        ok,
        detail: detail.into(),
    }
}

fn assert_expect(state: &HoldemState, exp: &FixtureExpect) -> Vec<CheckResult> {
    let mut out = Vec::new();
    let legal = get_legal_actions(state);
    let state_hash = format_hash(&hash_engine_state(state));
    let legal_hash = if legal.is_empty() {
        None
    } else {
        Some(format_hash(&hash_legal_actions(&legal)))
    };

    if let Some(want) = &exp.state_hash {
        let ok = state_hash.eq_ignore_ascii_case(want);
        out.push(check(
            "stateHash",
            ok,
            format!("expected {want}, got {state_hash}"),
        ));
    }
    if let Some(want) = &exp.legal_actions_hash {
        let got = legal_hash.as_deref().unwrap_or("<none>");
        let ok = legal_hash
            .as_ref()
            .map(|h| h.eq_ignore_ascii_case(want))
            .unwrap_or(false);
        out.push(check(
            "legalActionsHash",
            ok,
            format!("expected {want}, got {got}"),
        ));
    }
    if let Some(want) = exp.street {
        out.push(check(
            "street",
            state.street == want,
            format!("expected {:?}, got {:?}", want, state.street),
        ));
    }
    if let Some(want) = exp.button {
        out.push(check(
            "button",
            state.button == want,
            format!("expected {want}, got {}", state.button),
        ));
    }
    if let Some(want) = exp.acting_index {
        out.push(check(
            "actingIndex",
            state.acting_index == want,
            format!("expected {:?}, got {:?}", want, state.acting_index),
        ));
    }
    if let Some(want) = exp.pot {
        out.push(check(
            "pot",
            state.pot == want,
            format!("expected {want}, got {}", state.pot),
        ));
    }
    if let Some(want) = exp.current_bet {
        out.push(check(
            "currentBet",
            state.current_bet == want,
            format!("expected {want}, got {}", state.current_bet),
        ));
    }
    if let Some(want) = exp.min_raise {
        out.push(check(
            "minRaise",
            state.min_raise == want,
            format!("expected {want}, got {}", state.min_raise),
        ));
    }
    if let Some(want) = exp.last_raise_complete {
        out.push(check(
            "lastRaiseComplete",
            state.last_raise_complete == want,
            format!(
                "expected {want}, got {}",
                state.last_raise_complete
            ),
        ));
    }
    if let Some(want) = &exp.stacks {
        let mut pairs: Vec<_> = state.seats.iter().map(|s| (s.seat_index, s.stack)).collect();
        pairs.sort_by_key(|(i, _)| *i);
        let got: Vec<Chips> = pairs.into_iter().map(|(_, st)| st).collect();
        out.push(check(
            "stacks",
            &got == want,
            format!("expected {want:?}, got {got:?}"),
        ));
    }
    if let Some(want) = &exp.winners {
        let mut got: Vec<(u8, Chips)> = state
            .winners
            .iter()
            .map(|w| (w.seat_index, w.amount))
            .collect();
        got.sort_by_key(|(i, _)| *i);
        let mut want_s: Vec<(u8, Chips)> = want.iter().map(|w| (w.seat_index, w.amount)).collect();
        want_s.sort_by_key(|(i, _)| *i);
        out.push(check(
            "winners",
            got == want_s,
            format!("expected {want_s:?}, got {got:?}"),
        ));
    }
    if let Some(want) = exp.rake {
        out.push(check(
            "rake",
            state.rake == want,
            format!("expected {want}, got {}", state.rake),
        ));
    }
    if let Some(want) = &exp.pot_layers {
        let got: Vec<(Chips, Vec<u8>)> = build_pots(&state.seats)
            .into_iter()
            .map(|p| (p.amount, p.eligible))
            .collect();
        let want_s: Vec<(Chips, Vec<u8>)> = want
            .iter()
            .map(|p| (p.amount, p.eligible.clone()))
            .collect();
        out.push(check(
            "potLayers",
            got == want_s,
            format!("expected {want_s:?}, got {got:?}"),
        ));
    }
    if let Some(want) = &exp.legal_actions {
        let mut got: Vec<LegalAction> = legal;
        got.sort_by(|a, b| a.action.as_str().cmp(b.action.as_str()));
        let mut want_n = want.clone();
        want_n.sort_by(|a, b| a.action.as_str().cmp(b.action.as_str()));
        let ok = got.len() == want_n.len()
            && got.iter().zip(want_n.iter()).all(|(g, w)| {
                g.action == w.action && g.min_amount == w.min_amount && g.max_amount == w.max_amount
            });
        out.push(check(
            "legalActions",
            ok,
            format!("expected {want_n:?}, got {got:?}"),
        ));
    }
    out
}

/// Replay a WP-030 fixture JSON string (no filesystem). Used by WASM / CLI verifiers.
pub fn run_fixture_json(raw: &str) -> Result<FixtureReport, String> {
    let fx: FixtureFile = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if !SUPPORTED_FORMATS.contains(&fx.format.as_str()) {
        return Err(format!(
            "{}: unsupported fixture format={} (expected one of {:?})",
            fx.id, fx.format, SUPPORTED_FORMATS
        ));
    }
    let mut state = setup_table(&fx);
    let mut all_checks = Vec::new();

    for step in &fx.steps {
        match step {
            FixtureStep::StartHand {
                server_seed,
                hand_id,
            } => {
                let (s, _) = start_hand(state, server_seed, hand_id).map_err(|e| e.to_string())?;
                state = s;
            }
            FixtureStep::Action { action, amount } => {
                let (s, _) =
                    apply_action(state, *action, *amount).map_err(|e| e.to_string())?;
                state = s;
            }
            FixtureStep::ContinueRunout => {
                let (s, _) = continue_runout(state).map_err(|e| e.to_string())?;
                state = s;
            }
            FixtureStep::SettleShowdown => {
                let (s, _) = settle_showdown(state).map_err(|e| e.to_string())?;
                state = s;
            }
            FixtureStep::ForceBettingState(fb) => {
                state = apply_force(state, fb)?;
            }
            FixtureStep::InjectShowdown(inj) => {
                state = apply_inject(state, inj)?;
            }
            FixtureStep::Expect { expect } => {
                all_checks.extend(assert_expect(&state, expect));
            }
        }
    }

    let ok = all_checks.iter().all(|c| c.ok);
    Ok(FixtureReport {
        id: fx.id,
        ok,
        checks: all_checks,
        error: None,
        final_stacks: Some(final_stacks(&state)),
        final_state_hash: Some(format_hash(&hash_engine_state(&state))),
    })
}

/// Verify fixture JSON and always return a report (errors become `ok: false`).
pub fn verify_fixture_json(raw: &str) -> FixtureReport {
    match run_fixture_json(raw) {
        Ok(report) => report,
        Err(error) => FixtureReport {
            id: "<parse-or-run-error>".into(),
            ok: false,
            checks: Vec::new(),
            error: Some(error),
            final_stacks: None,
            final_state_hash: None,
        },
    }
}

pub fn run_fixture_file(path: &Path) -> Result<FixtureReport, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    run_fixture_json(&raw).map_err(|e| format!("{path:?}: {e}"))
}

/// HU-only entry point (WP-031). Rejects multi/sixmax files.
pub fn run_hu_fixture_file(path: &Path) -> Result<FixtureReport, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fx: FixtureFile = serde_json::from_str(&raw).map_err(|e| format!("{path:?}: {e}"))?;
    if fx.format != "hu" {
        return Err(format!("{}: not an HU fixture (format={})", fx.id, fx.format));
    }
    drop(fx);
    run_fixture_file(path)
}

fn run_fixtures_with_prefixes(
    dir: &Path,
    prefixes: &[&str],
) -> Result<Vec<FixtureReport>, String> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    n.ends_with(".json")
                        && prefixes.iter().any(|pre| n.starts_with(pre))
                })
                .unwrap_or(false)
        })
        .collect();
    paths.sort();
    let mut reports = Vec::new();
    for p in paths {
        match run_fixture_file(&p) {
            Ok(r) => reports.push(r),
            Err(e) => reports.push(FixtureReport {
                id: p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .into(),
                ok: false,
                checks: vec![],
                error: Some(e),
                final_stacks: None,
                final_state_hash: None,
            }),
        }
    }
    Ok(reports)
}

pub fn run_hu_fixtures_dir(dir: &Path) -> Result<Vec<FixtureReport>, String> {
    run_fixtures_with_prefixes(dir, &["hu_"])
}

/// Multi-way + six-max WP-030 fixtures (`multi_*`, `sixmax_*`).
pub fn run_multi_fixtures_dir(dir: &Path) -> Result<Vec<FixtureReport>, String> {
    run_fixtures_with_prefixes(dir, &["multi_", "sixmax_"])
}

// --- WP-034 differential traces ------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLegalAction {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_amount: Option<Chips>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_amount: Option<Chips>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffWinner {
    pub seat_index: u8,
    pub amount: Chips,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPotLayer {
    pub amount: Chips,
    pub eligible: Vec<u8>,
}

/// One comparable engine observation (after a mutating step or at an expect).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSnapshot {
    pub step_index: usize,
    pub op: String,
    pub street: String,
    pub button: u8,
    pub acting_index: Option<u8>,
    pub pot: Chips,
    pub current_bet: Chips,
    pub min_raise: Chips,
    pub last_raise_complete: bool,
    pub stacks: Vec<Chips>,
    pub state_hash: String,
    pub legal_actions_hash: Option<String>,
    pub legal_actions: Vec<DiffLegalAction>,
    pub winners: Vec<DiffWinner>,
    pub rake: Chips,
    pub pot_layers: Vec<DiffPotLayer>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFixtureTrace {
    pub id: String,
    pub format: String,
    pub engine: &'static str,
    pub snapshots: Vec<DiffSnapshot>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBundle {
    pub engine: &'static str,
    pub work_packet: &'static str,
    pub fixture_count: usize,
    pub fixtures: Vec<DiffFixtureTrace>,
}

fn snapshot_of(state: &HoldemState, step_index: usize, op: &str) -> DiffSnapshot {
    let legal = get_legal_actions(state);
    let mut legal_actions: Vec<DiffLegalAction> = legal
        .iter()
        .map(|a| DiffLegalAction {
            action: a.action.as_str().into(),
            min_amount: a.min_amount,
            max_amount: a.max_amount,
        })
        .collect();
    legal_actions.sort_by(|a, b| a.action.cmp(&b.action));

    let mut stacks_pairs: Vec<_> = state.seats.iter().map(|s| (s.seat_index, s.stack)).collect();
    stacks_pairs.sort_by_key(|(i, _)| *i);
    let stacks: Vec<Chips> = stacks_pairs.into_iter().map(|(_, st)| st).collect();

    let mut winners: Vec<DiffWinner> = state
        .winners
        .iter()
        .map(|w| DiffWinner {
            seat_index: w.seat_index,
            amount: w.amount,
        })
        .collect();
    winners.sort_by_key(|w| w.seat_index);

    let pot_layers: Vec<DiffPotLayer> = build_pots(&state.seats)
        .into_iter()
        .map(|p| DiffPotLayer {
            amount: p.amount,
            eligible: p.eligible,
        })
        .collect();

    DiffSnapshot {
        step_index,
        op: op.into(),
        street: state.street.as_str().into(),
        button: state.button,
        acting_index: state.acting_index,
        pot: state.pot,
        current_bet: state.current_bet,
        min_raise: state.min_raise,
        last_raise_complete: state.last_raise_complete,
        stacks,
        state_hash: format_hash(&hash_engine_state(state)),
        legal_actions_hash: if legal.is_empty() {
            None
        } else {
            Some(format_hash(&hash_legal_actions(&legal)))
        },
        legal_actions,
        winners,
        rake: state.rake,
        pot_layers,
    }
}

/// Dump a per-step differential trace for one fixture file.
pub fn dump_fixture_trace(path: &Path) -> Result<DiffFixtureTrace, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fx: FixtureFile = serde_json::from_str(&raw).map_err(|e| format!("{path:?}: {e}"))?;
    if !SUPPORTED_FORMATS.contains(&fx.format.as_str()) {
        return Err(format!(
            "{}: unsupported fixture format={}",
            fx.id, fx.format
        ));
    }
    let mut state = setup_table(&fx);
    let mut snapshots = Vec::new();
    let mut step_index = 0usize;

    for step in &fx.steps {
        match step {
            FixtureStep::StartHand {
                server_seed,
                hand_id,
            } => {
                let (s, _) = start_hand(state, server_seed, hand_id).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "startHand"));
                step_index += 1;
            }
            FixtureStep::Action { action, amount } => {
                let (s, _) =
                    apply_action(state, *action, *amount).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "action"));
                step_index += 1;
            }
            FixtureStep::ContinueRunout => {
                let (s, _) = continue_runout(state).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "continueRunout"));
                step_index += 1;
            }
            FixtureStep::SettleShowdown => {
                let (s, _) = settle_showdown(state).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "settleShowdown"));
                step_index += 1;
            }
            FixtureStep::ForceBettingState(fb) => {
                state = apply_force(state, fb)?;
                snapshots.push(snapshot_of(&state, step_index, "forceBettingState"));
                step_index += 1;
            }
            FixtureStep::InjectShowdown(inj) => {
                state = apply_inject(state, inj)?;
                snapshots.push(snapshot_of(&state, step_index, "injectShowdown"));
                step_index += 1;
            }
            FixtureStep::Expect { .. } => {
                snapshots.push(snapshot_of(&state, step_index, "expect"));
                step_index += 1;
            }
        }
    }

    Ok(DiffFixtureTrace {
        id: fx.id,
        format: fx.format,
        engine: "rust",
        snapshots,
    })
}

fn dump_fixtures_with_prefixes(
    dir: &Path,
    prefixes: &[&str],
) -> Result<DiffBundle, String> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    n.ends_with(".json")
                        && n != "manifest.json"
                        && prefixes.iter().any(|pre| n.starts_with(pre))
                })
                .unwrap_or(false)
        })
        .collect();
    paths.sort();
    let mut fixtures = Vec::new();
    for p in paths {
        fixtures.push(dump_fixture_trace(&p)?);
    }
    Ok(DiffBundle {
        engine: "rust",
        work_packet: "WP-034",
        fixture_count: fixtures.len(),
        fixtures,
    })
}

/// Dump traces for all WP-030 golden fixtures (hu_ / multi_ / sixmax_).
pub fn dump_all_fixture_traces(dir: &Path) -> Result<DiffBundle, String> {
    dump_fixtures_with_prefixes(dir, &["hu_", "multi_", "sixmax_"])
}

/// Ordered stream op for WP-034 random differential replay.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op")]
pub enum DiffStreamOp {
    #[serde(rename = "action")]
    Action {
        action: ActionKind,
        #[serde(default)]
        amount: Option<Chips>,
    },
    #[serde(rename = "continueRunout")]
    ContinueRunout,
    #[serde(rename = "settleShowdown")]
    SettleShowdown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStream {
    pub id: String,
    pub seat_count: usize,
    pub config: FixtureConfig,
    pub seats: Vec<FixtureSeat>,
    #[serde(default)]
    pub initial_button: Option<u8>,
    pub server_seed: String,
    pub hand_id: String,
    /// Preferred ordered ops (action / continueRunout / settleShowdown).
    #[serde(default)]
    pub ops: Vec<DiffStreamOp>,
    /// Legacy flat action list (used only when `ops` is empty).
    #[serde(default)]
    pub actions: Vec<DiffStreamLegacyAction>,
    #[serde(default)]
    pub tail: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStreamLegacyAction {
    pub action: ActionKind,
    #[serde(default)]
    pub amount: Option<Chips>,
}

/// Replay a generated action stream and dump snapshots (for TS-driven random fuzz).
pub fn dump_stream_trace(stream: &DiffStream) -> Result<DiffFixtureTrace, String> {
    let fx = FixtureFile {
        id: stream.id.clone(),
        format: if stream.seat_count == 2 {
            "hu".into()
        } else {
            "multi".into()
        },
        seat_count: stream.seat_count,
        config: FixtureConfig {
            table_id: stream.config.table_id.clone(),
            small_blind: stream.config.small_blind,
            big_blind: stream.config.big_blind,
            rake_pct: stream.config.rake_pct,
            rake_cap: stream.config.rake_cap,
        },
        seats: stream.seats.clone(),
        initial_button: stream.initial_button,
        steps: vec![],
    };
    let mut state = setup_table(&fx);
    let mut snapshots = Vec::new();
    let mut step_index = 0usize;

    let (s, _) = start_hand(state, &stream.server_seed, &stream.hand_id)
        .map_err(|e| e.to_string())?;
    state = s;
    snapshots.push(snapshot_of(&state, step_index, "startHand"));
    step_index += 1;

    let ops: Vec<DiffStreamOp> = if !stream.ops.is_empty() {
        stream.ops.clone()
    } else {
        let mut out: Vec<DiffStreamOp> = stream
            .actions
            .iter()
            .map(|a| DiffStreamOp::Action {
                action: a.action,
                amount: a.amount,
            })
            .collect();
        for t in &stream.tail {
            match t.as_str() {
                "continueRunout" => out.push(DiffStreamOp::ContinueRunout),
                "settleShowdown" => out.push(DiffStreamOp::SettleShowdown),
                other => return Err(format!("{}: unknown tail op {other}", stream.id)),
            }
        }
        out
    };

    for op in &ops {
        match op {
            DiffStreamOp::Action { action, amount } => {
                let (s, _) = apply_action(state, *action, *amount).map_err(|e| {
                    format!(
                        "{}: apply {:?} amount {:?}: {e}",
                        stream.id, action, amount
                    )
                })?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "action"));
                step_index += 1;
            }
            DiffStreamOp::ContinueRunout => {
                let (s, _) = continue_runout(state).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "continueRunout"));
                step_index += 1;
            }
            DiffStreamOp::SettleShowdown => {
                let (s, _) = settle_showdown(state).map_err(|e| e.to_string())?;
                state = s;
                snapshots.push(snapshot_of(&state, step_index, "settleShowdown"));
                step_index += 1;
            }
        }
    }

    Ok(DiffFixtureTrace {
        id: stream.id.clone(),
        format: fx.format,
        engine: "rust",
        snapshots,
    })
}
