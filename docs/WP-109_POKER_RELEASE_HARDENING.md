# WP-109 — Poker release hardening

**Authority:** Plan 06 / Plan 11; WP-109 in `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-030–035 engine freeze / Rust parity / differential harness; Plan 11 rake deferrals  
**Date:** 2026-08-07  
**Frozen `/specs`:** untouched

---

## Exit condition

> Uncalled bets, deep 6-max, sit-out/timeout; PokerKit mandatory oracle; large generated differential set; promote Rust binary hash into GameTemplate.

---

## Delivered

| Item | Location |
|---|---|
| Uncalled-bet return on fold-win | TS `foldWin` + Rust `fold_win`; `uncalledBetAmount` / `uncalled_bet_amount` |
| Rake excludes uncalled; postflop fold-win rakes eligible pot | `computeRake({ endedBeforeFlop })`; Plan 11 `noFlopNoDrop` unchanged preflop |
| Sit-out API | `setSitOut` / `set_sit_out` (mid-hand folds; blinds skip sit-out) |
| Timeout fallback | `timeoutFallbackAction` / `timeout_fallback_action` (fold → check → first legal) |
| Deeper 6-max tree fixture | `sixmax_20_deep_raise_fold` |
| PokerKit mandatory path | `pnpm test:engine-diff:full` (`--require-pokerkit`); CI job installs venv |
| Nightly large set scaffolding | `pnpm test:engine-diff:nightly` (~400 streams × 60 actions → thousands of states) |
| GameTemplate engine hash | `mozetto-nlhe-rust-wp109` in DeployLocal/DeploySepolia + `gameTemplateEngineHash()` |
| TS build id bump | `mozetto-nlhe-ts-wp109` (regenerated fixtures) |

---

## Uncalled bets + rake (Plan 11)

```text
uncalled = max(0, winner.streetBet − max(other.streetBet))
eligiblePot = pot − uncalled
return uncalled to winner
if board empty → rake = 0          # noFlopNoDrop
else → rake = computeRake(eligiblePot, …, endedBeforeFlop=false)
award = eligiblePot − rake
```

Winner `amount` is the **eligible award** (not including returned uncalled). Stacks still conserve: `before == after + rake`.

---

## PokerKit (mandatory in CI)

```bash
cd tools/pokerkit-oracle
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

pnpm test:engine-diff:full      # fixtures + 25 random + required PokerKit
pnpm test:engine-diff:nightly   # large set + required PokerKit
```

CI job `engine-diff` fails if PokerKit is missing or scenarios diverge from `expected.json`.  
Nightly job runs on cron / `workflow_dispatch` with `run_nightly=true`.

Full fixture replay through PokerKit remains out of scope (room policy ≠ PokerKit automation).

---

## GameTemplate vs Protocol draft

| Hash | Id | Used for |
|---|---|---|
| GameTemplate.engineHash | `keccak256("mozetto-nlhe-rust-wp109")` | Local/Sepolia template registration |
| Protocol V3 event `engineHash` | `keccak256("mozetto-nlhe-engine-v3-draft")` | Frozen vectors / specs (unchanged) |
| TS state oracle buildId | `mozetto-nlhe-ts-wp109` | Fixture state hashes |

`/specs` not mutated — Protocol draft string remains the vector baseline until a dedicated protocol freeze packet.

---

## Commands / evidence

```bash
pnpm --filter @mozetto/game-rules test
cargo test -p poker-core -p poker-eval
pnpm test:engine-diff:full          # requires PokerKit venv
pnpm test:poker-replay
```

---

## Out of scope / intentional gaps

- `/specs` mutations
- Full PokerKit fixture-language replay
- Silent Season 1 rake schedule freeze (still hypotheses)
- Replacing Protocol V3 event draft hash in conformance vectors

## Follow-up

- Protocol freeze packet to align event `engineHash` with Rust WP-109 id
- Hosted nightly metrics on snapshot counts
- Wire game-server clock expiry to `timeoutFallbackAction` (controller already fold-first)
