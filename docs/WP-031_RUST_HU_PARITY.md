# WP-031 — Rust HU Core Parity Status

| Field | Value |
|---|---|
| **Work packet** | WP-031 |
| **Status** | HU core implemented; HU fixture parity vs WP-030 |
| **Crates** | `crates/poker-core`, `crates/poker-eval` |
| **Oracle** | `packages/game-rules/fixtures/hu_*.json` (WP-030 freeze) |
| **Date** | 2026-08-07 |

## Scope

Pure heads-up NLHE transition engine:

```text
CurrentState + LegalAction → NextState + EngineEvents
```

No DB / HTTP / WS / chain / AI / wall-clock. Chip math is integer (`i64`). Rake uses basis points (`rake_bps`); fixture JSON `rakePct` is converted only at the fixture boundary.

## How to verify

```bash
cargo test -p poker-core -p poker-eval
cargo test -p protocol-vectors-rs   # WP-015 must remain green
```

## HU fixture parity matrix

| Fixture | Outcomes (street/pot/stacks/winners/legal) | `stateHash` | `legalActionsHash` |
|---|---|---|---|
| `hu_01_blinds_button_preflop` | PASS | PASS | PASS |
| `hu_02_sb_folds_to_bb` | PASS | PASS | — |
| `hu_03_limp_checkdown_chop` | PASS | PASS | PASS |
| `hu_04_short_stack_blind_allin` | PASS | PASS | — |
| `hu_05_both_allin_preflop` | PASS | PASS | PASS |
| `hu_06_raise_to_3bb_call` | PASS | PASS | PASS |
| `hu_07_showdown_tie_even` | PASS | PASS | — |
| `hu_08_rake_showdown` | PASS | PASS | — |
| `hu_09_rake_cap` | PASS | PASS | — |
| `hu_17_exact_call_allin` | PASS | PASS | PASS |
| `hu_18_min_raise_bounds` | PASS | PASS | PASS |
| `hu_19_button_rotates` | PASS | PASS | PASS |

**Summary:** 12 / 12 HU fixtures pass all asserted fields (including TS freeze `stateHash` / `legalActionsHash` where present).

Multi / six-max fixtures (`multi_*`, `sixmax_*`) were **out of scope** for WP-031 → see `docs/WP-032_RUST_SIXMAX_PARITY.md`.

## Alignment notes

| Topic | Status |
|---|---|
| Amount convention | Chips-added (matches TS freeze; not Protocol V3 raise-to yet) |
| HU blinds / button | Button posts SB; BB acts second preflop; BB first postflop |
| Incomplete all-in reopen | Ported (`lastRaiseComplete`) — covered indirectly via shared legal-action code; multi fixture deferred |
| Fold win | Full pot to survivor; no uncalled-bet return (TS freeze gap preserved) |
| Showdown / side pots | `buildPots` + odd-chip after button |
| Rake | `floor(pot * rake_bps / 10000)` + cap; HU single-layer fixtures match TS |
| State hash | Reuses TS domain `MOZETTO_TS_ENGINE_STATE_V1` + build id `mozetto-nlhe-ts-freeze-wp030` for differential oracle |
| Shuffle / seed commit | HMAC-SHA256 Fisher–Yates + SHA-256 commit matching Node `cards.ts` |
| Protocol V3 `engineHash` | Unchanged draft placeholder; Rust build id `mozetto-nlhe-rust-hu-wp031` not promoted |

## Deliberately not in this packet

- Six-max / multi (WP-032)
- Independent evaluator package expansion beyond minimal HU showdown (WP-033 polish)
- PokerKit differential harness (WP-034)
- WASM verifier (WP-035)
- Protocol V3 ABI event encoding in the engine runtime (`poker-events` crate still future)
- Contracts / SeatTicket (WP-021)

## Crate layout (Plan 06)

```text
crates/
  poker-core/     # table/hand state, legal actions, pots, showdown, fixture replay
  poker-eval/     # cards + 7-card Hold'em evaluator
  protocol-vectors-rs/  # WP-015 (untouched behavior)
  # future: poker-events, poker-replay, poker-wasm, poker-test-vectors
```
