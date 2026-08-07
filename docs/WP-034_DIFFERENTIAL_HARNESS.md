# WP-034 — Differential Oracle Harness

| Field | Value |
|---|---|
| **Work packet** | WP-034 |
| **Status** | DONE — TS ↔ Rust fixture + random stream parity green |
| **Harness** | `tools/engine-diff/` |
| **Command** | `pnpm test:engine-diff` |
| **Date** | 2026-08-07 |

## Purpose

Detect **unexplained** differential mismatches between:

1. TypeScript NLHE freeze (`packages/game-rules`, WP-030)
2. Rust `poker-core` (WP-031 / WP-032)
3. PokerKit reference oracle (`tools/pokerkit-oracle/`) — **optional**

Wave 3 exit gate (Plan 06 / WP packet list): zero unexplained TS↔Rust mismatches. PokerKit may remain skipped or document known policy gaps without blocking the harness.

## How to run

```bash
# Required acceptance: golden fixture TS ↔ Rust
pnpm test:engine-diff

# + deterministic random legal action streams
pnpm test:engine-diff:random

# + PokerKit curated scenarios (skipped cleanly if deps missing)
pnpm test:engine-diff:full
# equivalent: node tools/engine-diff/run.mjs --random --pokerkit
```

Low-level dumpers:

```bash
# TS traces
packages/game-rules/node_modules/.bin/tsx tools/engine-diff/dump-ts.mjs dump-fixtures

# Rust traces
cargo run -p poker-core --bin engine_diff -- dump-fixtures
```

Reports land in `tools/engine-diff/out/latest-report.json` (gitignored).

## What is compared

Per snapshot (after each mutating fixture step / expect, or after each random stream op):

| Field | Notes |
|---|---|
| `op` | Step label (`startHand`, `action`, `expect`, …) |
| `street`, `button`, `actingIndex` | Betting position |
| `pot`, `currentBet`, `minRaise`, `lastRaiseComplete` | Betting state |
| `stacks` | Seat-index order |
| `stateHash` | `MOZETTO_TS_ENGINE_STATE_V1` freeze oracle |
| `legalActionsHash` + `legalActions` | Sorted action set + bounds |
| `winners`, `rake`, `potLayers` | Settlement / side pots |

## Mismatch report format

```json
{
  "workPacket": "WP-034",
  "ok": false,
  "tsRustFixtures": {
    "summary": { "fixtureCount": 19, "matched": 18, "mismatched": 1, "mismatchCount": 2 },
    "mismatches": [
      {
        "id": "hu_02_sb_folds_to_bb",
        "stepIndex": 2,
        "op": "expect",
        "field": "stateHash",
        "kind": "field",
        "ts": "0x…",
        "rust": "0x…"
      }
    ]
  },
  "pokerkit": { "status": "skipped|ok|fail|available_not_run", "reason": "…" }
}
```

**Unexplained** = any `kind: field|length|missing_*` mismatch that is not listed under [Known / documented divergences](#known--documented-divergences) below.

## Acceptance evidence (this packet)

| Check | Result |
|---|---|
| WP-030 fixtures TS ↔ Rust | **19 / 19** matched |
| Random streams (`--random --seed 42 --count 25`) | **25 / 25** matched |
| PokerKit | **Optional / skipped** when `pokerkit` not installed (see below) |
| WP-015 protocol vectors | Unchanged — `cargo test -p protocol-vectors-rs` **15/15** |

## PokerKit status (optional)

| Item | Status |
|---|---|
| Location | `tools/pokerkit-oracle/` |
| Install | `python3 -m venv .venv && .venv/bin/pip install pokerkit` then `pnpm test:engine-diff:full` |
| Role | Curated settlement / hand-eval scenarios (`run_scenarios.py` ↔ `expected.json`) |
| Full fixture replay | **Out of scope** — PokerKit automation/policy ≠ Mozetto room rules |

When PokerKit is missing, the harness still **passes** with `pokerkit.status = skipped` (or `available_not_run` if importable but `--pokerkit` not passed). A live PokerKit **fail** against `expected.json` exits non-zero.

### PokerKit vs Mozetto policy gaps (documented, not unexplained)

These are **not** TS↔Rust failures:

1. **Uncalled-bet return** — Mozetto fold-win awards the full pot (WP-030 freeze gap); PokerKit chip-pulling may return uncalled chips.
2. **Rake** — Mozetto uses integer bps + cap; PokerKit oracle scenarios here are settlement/hand-eval focused without Mozetto rake.
3. **Scope** — Oracle covers curated stacks/hand-eval, not the full WP-030 fixture step language (`forceBettingState`, seed shuffle, etc.).

## Known / documented divergences

| Divergence | Engines | Status |
|---|---|---|
| *(none for TS ↔ Rust on WP-030 fixtures)* | TS / Rust | **None unexplained** as of 2026-08-07 |
| PokerKit policy gaps (above) | Mozetto vs PokerKit | Documented; optional oracle |

If a future mismatch appears, add a row here with fixture id, field, and rationale before claiming Wave 3 complete.

## Layout

```text
tools/engine-diff/
  run.mjs              # orchestrator (pnpm test:engine-diff)
  dump-ts.mjs          # TS dump + random stream generator
  compare.mjs          # bundle comparator / report shape
  pokerkit-check.mjs   # optional PokerKit probe
  out/                 # gitignored reports
crates/poker-core/src/bin/engine_diff.rs
crates/poker-core/src/fixture.rs   # dump_fixture_trace / dump_stream_trace
```

## Out of scope

- WASM verifier (WP-035)
- Spec / Protocol V3 encoding changes
- `contracts/` edits
- Claiming Wave 3 complete solely because PokerKit is skipped — Wave 3 gate is **TS↔Rust unexplained = 0**; PokerKit remains a documented optional third oracle
