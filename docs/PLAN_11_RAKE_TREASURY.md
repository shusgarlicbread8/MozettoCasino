# Plan 11 — Rake, unit economics, and treasury

**Authority:** `mozetto_execution_plans/11_RAKE_UNIT_ECONOMICS_AND_TREASURY.md`  
**Prior packets:** WP-024 ProtocolFeeVault, WP-061/063 settlement conservation, WP-074 Energy, WP-091 solvency  
**Date:** 2026-08-07  
**Frozen `/specs`:** untouched

---

## Exit gate (Plan 11)

> Every hand and session has transparent, capped fees and measurable positive/negative contribution without hidden player charges.

Season 1 user-visible fee: **poker rake only**. Mozetto pays AI inference, relayer gas, VRF, proof anchoring, dealer, database, and infrastructure from rake revenue.

---

## Clause → code map

| Plan 11 clause | Implementation | Notes |
|---|---|---|
| Rake formula `min(eligiblePot × rakeBps / 10_000, rakeCap)` | `packages/game-rules/src/rake.ts` `computeRake`; Rust `TableConfig::compute_rake`; TS engine via `computeRakeFromPct` in `holdem.ts` | Rounding: **floor** on non-negative chips |
| Engine emits rake; settlement does not invent | `HAND_SETTLED.rake` / state `rake`; Hub V3 `totalRake` from proposals (`root-builder`, attestors) | Settlement conservation rejects broken totals |
| `noFlopNoDrop` | Fold-win path hard-codes `rake: 0`; `liveHands ≤ 1` ⇒ 0 in `computeRake` | Documented in `SEASON1_RAKE_ELIGIBILITY` |
| No rake from uncalled bets | **DONE (WP-109)** — `foldWin` returns uncalled street bet; rake uses eligible pot only | Preflop still noFlopNoDrop (rake 0) |
| Side-pot rake method | `allocateSidePotRake` — proportional floor, remainder last layer | Matches prior TS/Rust engine behavior |
| Provisional league schedule | `@mozetto/unit-economics` `SEASON1_RAKE_SCHEDULE` | Status **`hypothesis`** — not auto-mainnet |
| Hand conservation (net stacks) | `checkHandConservation` | `sum(before) == sum(afterNet) + handRake` |
| Session conservation | `checkSessionConservation`; `root-builder` `checkConservation`; attestors refuse broken digests | `opening == payouts + totalRake` |
| Collect at hand settle | Net-on-award in `holdem.ts`; `sessionRake` accumulates; `applyRakeClawback` is a no-op | Stacks always equal money belonging to the seat |
| No AI fee in conservation | Settlement identity has only `totalRake` | Energy is compute budget, not USDC |
| Internal COGS / contribution | `computeContribution` / `buildRevenueTransparencyReport` + WP-111 ledger | Live Groq tokens + placeholders; see `docs/WP-111_ECONOMICS_INSTRUMENTATION.md` |
| 100 Energy cost guard | Energy ledger WP-074 + `SEASON1_AI_COST_BANDS_USD_MICRO` | Hypotheses; never silent mid-season Energy cut |
| Context optimization | AgentState store WP-072, cognition WP-073, cadence WP-075 | Structured deltas / bounds — not a fee |
| ProtocolFeeVault accrues only rake | `contracts/src/ProtocolFeeVault.sol` + WP-024 | Authorized depositors only |
| Treasury Safe sweeps | `ProtocolFeeVault.sweep` → `treasurySafe`; timelocked treasury updates | Guardian cannot sweep |
| Relayer / VRF wallets | Ops separation (WP-093 / deploy docs) | Relayer: ETH only; no player USDC authority |
| HouseBankrollVault | **Absent** by design until house games | Never mix with poker rake |
| Fee sweep failure ≠ block settle | ArenaVault accrues rake; `withdrawProtocolFees` separate; Hub settle independent | Settlement worker deposits fees best-effort after settle |
| Revenue reporting | `GET /v1/admin/treasury` + solvency fee vault panels | Locked funds explicitly not revenue |
| Refund / abort policies | Pre-ACTIVE unlock (session lifecycle); emergency exit WP-066 | Unresolved hand: no invented rake |
| High-stakes gate / unit-econ league report | **DEFERRED** (ops + measured Sepolia/mainnet traces) | Required before large buy-ins / fee freeze |
| Final fee schedule activation | Protocol Safe/timelock + public manifest | Hypotheses until then |

---

## Season 1 rake schedule (hypotheses)

| League | Rake | Cap |
|---|---:|---:|
| Bronze | 3.0% (300 bps) | 2 BB |
| Silver | 2.75% (275 bps) | 2 BB |
| Gold | 2.5% (250 bps) | 1.5 BB |
| Platinum | 2.25% (225 bps) | 1.25 BB |
| Diamond+ | 2.0% (200 bps) | 1 BB |

Source: `packages/unit-economics/src/schedule.ts` — every row carries `status: "hypothesis"`.

Deploy scripts may use placeholder `rakeBps` / `rakePolicyHash` on templates; those are **not** a silent production freeze of this table.

---

## Money path

```text
Engine HAND_SETTLED.rake
  → session totalRake (proposal / roots)
  → Hub V3 settle → ArenaVault.accruedProtocolFees
  → withdrawProtocolFees → ProtocolFeeVault.depositFees
  → ProtocolFeeVault.sweep → Treasury Safe
```

Player payouts always go to sealed ArenaAccounts. Fee-path failure cannot revert player settlement.

---

## Packages / surfaces

| Artifact | Role |
|---|---|
| `packages/game-rules/src/rake.ts` | Formula, eligibility constants, side-pot alloc, conservation |
| `packages/unit-economics/` | Season 1 schedule hypotheses, contribution, revenue report, AI cost bands |
| `services/api/src/admin-treasury.ts` | Admin treasury snapshot |
| `GET /v1/admin/treasury` | Revenue transparency hook |
| `contracts/src/ProtocolFeeVault.sol` | On-chain fee accumulator + sweep |
| `docs/WP-024_PROTOCOL_FEE_VAULT.md` | Fee vault detail |
| Energy: `services/agent-runtime/src/energy/` | 100 Energy policy (hypotheses) |

---

## Deferred (honest)

1. **Uncalled-bet return** before rake eligibility (engine gap).
2. **Calibrated COGS** from Anvil→Sepolia invoices/traces (WP-111 hooks exist; rates still hypotheses).
3. **Worker auto-`ProtocolFeeVault.sweep`** (owner/Safe ops; deposit hop exists).
4. **Per-league unit-economic acceptance report** (hands/hour, contribution margin, break-even concurrency) before mainnet fee freeze.
5. **High-stakes gate** evidence pack (p99 latency, attestors, insurance/exposure).
6. **Safe/timelock production ownership** values (WP-093 scaffold exists).

---

## Acceptance commands

```bash
pnpm install   # link @mozetto/unit-economics
pnpm --filter @mozetto/game-rules test
pnpm --filter @mozetto/unit-economics test
pnpm --filter @mozetto/root-builder test
cd contracts && forge test --match-contract ProtocolFeeVault
cargo test -p poker-core rake_tests
```
