# WP-035 — WASM Replay Verifier

| Field | Value |
|---|---|
| **Work packet** | WP-035 |
| **Status** | DONE — WASM + native CLI verify WP-030 fixtures |
| **Crates** | `crates/poker-wasm`, `crates/poker-replay` (+ `run_fixture_json` in `poker-core`) |
| **Date** | 2026-08-07 |

## Purpose

Public replay verification of frozen NLHE action streams **without private dealer TEE data**.

A WP-030 fixture already carries:

- table config + stacks
- committed deck openings (`serverSeed` + `handId`)
- action / runout / showdown steps
- expected stacks, winners, and consensus `stateHash`

The verifier replays those steps in the Rust canonical engine and checks finals + embedded expects.

## Artifacts

| Path | Role |
|---|---|
| `crates/poker-wasm` | `wasm-bindgen` module: `verify_fixture` / `verify_fixtures` |
| `crates/poker-replay` | Native CLI (same reports; no WASM toolchain required) |
| `scripts/build-poker-wasm.sh` | Release build → `tools/poker-wasm/pkg/` |
| `tools/poker-wasm/verify-fixtures.mjs` | Node loader that runs WASM over fixture dir |

## Prerequisites

```bash
# Rust pin (repo root)
rustup show   # rust-toolchain.toml → 1.85.0

# WASM target + bindgen CLI (must match crate pin =0.2.100)
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
```

## Build WASM

```bash
./scripts/build-poker-wasm.sh
# or
pnpm build:poker-wasm
```

Output (gitignored):

```text
tools/poker-wasm/pkg/
  poker_wasm.js
  poker_wasm_bg.wasm
  poker_wasm.d.ts
```

Debug build: `WASM_PROFILE=debug ./scripts/build-poker-wasm.sh`

## Verify fixtures

### Via WASM (Node)

```bash
pnpm build:poker-wasm   # once
pnpm test:poker-wasm
# equivalent:
node tools/poker-wasm/verify-fixtures.mjs
node tools/poker-wasm/verify-fixtures.mjs --subset hu
```

Expected: `ok: true`, **19 / 19** fixtures (`hu_*` + `multi_*` + `sixmax_*`).

### Via native CLI (no WASM)

```bash
pnpm test:poker-replay
# equivalent:
cargo run -p poker-replay -- verify packages/game-rules/fixtures
cargo run -p poker-replay -- verify packages/game-rules/fixtures/hu_02_sb_folds_to_bb.json
```

### Library API (Rust)

```rust
use poker_core::verify_fixture_json;

let report = verify_fixture_json(&fixture_json_string);
assert!(report.ok);
// report.final_stacks, report.final_state_hash
```

### WASM exports

| Export | Input | Output |
|---|---|---|
| `verify_fixture(json)` | single fixture JSON string | `FixtureReport` JSON |
| `verify_fixtures(arrayJson)` | JSON array of fixtures | batch summary JSON |
| `engine_build_id()` | — | `mozetto-nlhe-rust-wp109` (WP-109) |
| `verifier_build_id()` | — | `mozetto-poker-wasm-wp035` |

Report fields (camelCase): `id`, `ok`, `checks[]`, `error?`, `finalStacks?`, `finalStateHash?`.

## Acceptance evidence (2026-08-07)

```text
pnpm build:poker-wasm && pnpm test:poker-wasm
  → ok: true, fixtureCount: 19, passed: 19, failed: 0

pnpm test:poker-replay
  → ok: true, 19/19

cargo test -p poker-core -p poker-eval -p poker-wasm -p protocol-vectors-rs
  → HU / six-max / WP-015 green

pnpm test:engine-diff
  → WP-034 PASS (19/19 TS ↔ Rust)
```

## Scope notes

- **In:** public fixture / transcript replay → stacks + state hashes
- **Out:** continuous Groq, dealer TEE, randomness beacon, `contracts/` (WP-023), Protocol V3 spec hash mutations
- Fixtures that use `forceBettingState` / `injectShowdown` are still verifiable (deterministic setup ops, not private dealer material)

## Related

- WP-030 fixtures: `packages/game-rules/fixtures/`
- WP-031 / WP-032: `docs/WP-031_RUST_HU_PARITY.md`, `docs/WP-032_RUST_SIXMAX_PARITY.md`
- WP-034 differential: `docs/WP-034_DIFFERENTIAL_HARNESS.md`
- Plan 06: `mozetto_execution_plans/06_POKER_ENGINE_RULES_AND_RUST_CANONICAL_CORE.md`
