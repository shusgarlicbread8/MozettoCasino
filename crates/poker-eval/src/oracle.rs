//! Hook for WP-034 differential oracle (PokerKit / multi-impl generators).
//! This crate stays pure and does not invoke external oracles.
//! Run: `pnpm test:engine-diff` / `pnpm test:engine-diff:full` (see docs/WP-034_DIFFERENTIAL_HARNESS.md).

/// Stable id for the PokerKit hand-eval reference used by tools/pokerkit-oracle.
pub const DIFFERENTIAL_ORACLE_ID: &str = "pokerkit_standard_high_hand";

/// Harness lives in `tools/engine-diff/`; PokerKit remains optional when deps missing.
pub const DIFFERENTIAL_ORACLE_STATUS: &str = "harness_wp034_pokerkit_optional";
