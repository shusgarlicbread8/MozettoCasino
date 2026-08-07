# WP-032 — Rust Six-Max / Multiway Parity Status

| Field | Value |
|---|---|
| **Work packet** | WP-032 |
| **Status** | Six-max / multiway core fixture-gated; HU still green |
| **Crates** | `crates/poker-core`, `crates/poker-eval` |
| **Oracle** | `packages/game-rules/fixtures/{multi,sixmax}_*.json` (WP-030 freeze) |
| **Prerequisite** | WP-031 HU parity (`docs/WP-031_RUST_HU_PARITY.md`) |
| **Date** | 2026-08-07 |

## Scope

Pure NLHE transition engine for **2–6 seats**:

```text
CurrentState + LegalAction → NextState + EngineEvents
```

No DB / HTTP / WS / chain / AI / wall-clock. Chip math is integer (`i64`). Multiway rules covered:

- Non-HU blinds (SB/BB after button) and UTG first-to-act preflop
- Incomplete all-in raise (no reopen for players who already acted)
- Main + nested side pots; folded contributions stay in pot, not eligible
- Odd-chip to first winner after button
- Six-max fold-to-BB without showdown

## How to verify

```bash
cargo test -p poker-core -p poker-eval
cargo test -p protocol-vectors-rs   # WP-015 must remain green
```

## Multi / six-max fixture parity matrix

| Fixture | Outcomes (street/pot/stacks/winners/legal/layers) | `stateHash` | `legalActionsHash` |
|---|---|---|---|
| `multi_10_incomplete_allin_no_reopen` | PASS | PASS | PASS |
| `multi_11_three_way_side_pots` | PASS | PASS | — |
| `multi_12_nested_side_pots` | PASS | PASS | — |
| `multi_13_odd_chip_after_button` | PASS | PASS | — |
| `sixmax_14_blinds_utg` | PASS | PASS | PASS |
| `sixmax_15_fold_to_bb` | PASS | PASS | — |
| `multi_16_folded_chips_in_pot` | PASS | PASS | — |

**Summary:** **7 / 7** multi/six-max fixtures pass all asserted fields.

## HU regression

| Suite | Result |
|---|---|
| 12 HU WP-030 fixtures | PASS (unchanged from WP-031) |

## Alignment notes

| Topic | Status |
|---|---|
| Seat count | `create_table(..., 2..=6)` |
| Non-HU blinds | Button → SB → BB → UTG acts first preflop |
| HU blinds | Unchanged: button posts SB; BB acts second preflop |
| Incomplete raise | `lastRaiseComplete` gates reopen; covered by `multi_10` |
| Side pots | `buildPots` levels from `totalBet`; folded chips included |
| Odd chip | First tied winner in seats-after-button order |
| Fold win | Full pot to survivor (TS freeze gap: no uncalled-bet return) |
| State hash | Same TS freeze domain / build id as WP-031 oracle |
| Protocol V3 `engineHash` | Unchanged draft placeholder; Rust build id `mozetto-nlhe-rust-sixmax-wp032` not promoted |

## Deliberately not in this packet

- PokerKit differential harness (WP-034)
- WASM verifier (WP-035)
- Evaluator package polish beyond existing showdown (WP-033)
- Spec hash / Protocol V3 ABI changes
- Contracts / SeatTicket (Wave 2)

## Crate layout (Plan 06)

```text
crates/
  poker-core/     # table/hand state, legal actions, pots, showdown, HU+multi fixture replay
  poker-eval/     # cards + 7-card Hold'em evaluator
  protocol-vectors-rs/  # WP-015 (untouched behavior)
```
