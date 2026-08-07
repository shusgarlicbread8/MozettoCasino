//! Pure deterministic No-Limit Hold'em engine (Mozetto WP-031 / WP-032).
//!
//! Transition: `CurrentState + LegalAction → NextState + Events`.
//! No I/O, wall-clock, network, chain, AI, or floating-point chip math.
//!
//! Supports 2–6 seats: HU parity (WP-031) and six-max / multiway (WP-032).

mod deck;
mod engine;
mod events;
mod fixture;
mod legal;
mod pots;
mod state_hash;
mod types;

pub use deck::{commit_seed, shuffle_deck};
pub use engine::{
    apply_action, build_pots, clear_seat, continue_runout, create_table, fold_seat, fold_win,
    get_legal_actions, is_all_in_runout, seat_player, settle_showdown, start_hand,
};
pub use events::EngineEvent;
pub use fixture::{
    dump_all_fixture_traces, dump_fixture_trace, dump_stream_trace, run_fixture_file,
    run_fixture_json, run_hu_fixture_file, run_hu_fixtures_dir, run_multi_fixtures_dir,
    verify_fixture_json, CheckResult, DiffBundle, DiffFixtureTrace, DiffSnapshot, DiffStream,
    FixtureExpect, FixtureReport,
};
pub use legal::LegalAction;
pub use pots::PotLayer;
pub use state_hash::{hash_engine_state, hash_legal_actions, TS_ENGINE_BUILD_ID, TS_ENGINE_STATE_DOMAIN};
pub use types::{
    ActionKind, EngineError, HoldemState, SeatState, Street, TableConfig, Transition, WinnerPay,
};

/// Engine build id for future Protocol promotion (not the TS freeze oracle id).
pub const RUST_ENGINE_BUILD_ID: &str = "mozetto-nlhe-rust-sixmax-wp032";
