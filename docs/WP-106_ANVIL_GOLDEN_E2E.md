# WP-106 — True full Anvil golden match lifecycle

**Authority:** Wave 11 in `mozetto_execution_plans/PROGRESS.md`, WP-106 in `16_AGENT_WORK_PACKETS.md`  
**Supersedes gaps from:** `docs/WP-100_ANVIL_E2E.md` (`PASS_WITH_GAPS`)  
**Date:** 2026-08-07  
**Status:** `DONE` (zero-GAP evidence below)

---

## Goal

One golden command with **FAIL=0 and GAP=0**. Allowed mocks only: Anvil mock VRF + MockUSDC.

```text
Web/API → Find Match → random allocation → SeatTicket V3 → sealAndFundSession
  → SessionLifecycle (vault hook) → dealer secret → VRF → deck
  → real game-server → (Groq/mock AI → WP-107) → events → roots (WP-108)
  → proof batch → replay → attestors → Hub V3 → FeeVault → ArenaAccounts
  → Verify Game → withdraw
```

---

## Delivered

| Item | Location |
|---|---|
| Golden orchestrator | `scripts/anvil-e2e-golden.mjs` |
| Anvil + stack ensure wrapper | `scripts/anvil-e2e-golden.sh` |
| pnpm entries | `pnpm e2e:golden` / `pnpm e2e:golden:redeploy` |
| Last-run report (gitignored) | `scripts/.anvil-e2e-golden-last.json` |
| Game-server settlement roots API | `GET /v1/tables/:id/settlement-roots` |
| Stale-session cleanup after redeploy | `clearStaleOnchainMatches` in golden script |
| API HU path: SeatTicketV3 + `sealAndFundSession` | `services/api/src/arena-onchain.ts` |
| This note | `docs/WP-106_ANVIL_GOLDEN_E2E.md` |

WP-100 (`e2e:protocol-v3`) remains available for the older compose path that still allows GAP stages.

---

## How to run

```bash
# Preferred (redeploy Hub V3 stack + sync .env.local + restart API/game):
pnpm e2e:golden:redeploy

# Re-use current Anvil deployment:
pnpm e2e:golden
```

The wrapper starts Anvil / api / game-server / agent-runtime when missing, and forces:

| Env | Value |
|---|---|
| `MOZETTO_GOLDEN` | `1` |
| `REQUIRE_REAL_ROOTS` | `1` |
| `CANONICAL_SCHEMA_KIND` | `poker_event_v1` |
| `HUMAN_PLAY` | `0` (autonomous AI seats) |
| `AGENT_RUNTIME_MODE` | `mock` (CI-safe; set `live` + `GROQ_API_KEY` for Groq) |

Exit **0** only when **overall = PASS** (`FAIL=0` and `GAP=0`). Golden mode never records `GAP` — missing required pieces are **FAIL**.

### Flags

| Flag | Behavior |
|---|---|
| `--redeploy` | `DeployLocal` with `SETTLEMENT_HUB_V3_AS_PRIMARY=1` + chain-manifest codegen + API/game restart |
| `--skip-api` | Debug only — **FAIL** in golden (API find-match required) |
| `--skip-hands` | Debug only — **FAIL** in golden (real game-server required) |
| `--skip-composed` | Debug only — **FAIL** in golden (mock VRF + proof-batch required) |

### Opt-out of V3 seal in API (not for golden)

```bash
LEGACY_OPEN_TOPUP=1   # restore openSession + topUpSession progressive fill
SEAL_AND_FUND_V3=0    # disable SeatTicketV3 / sealAndFund for HU
```

---

## Stages (golden)

| Stage | Assertion |
|---|---|
| preflight / deploy / manifest | Anvil 31337 + Hub V3 stack addresses |
| preflight_game | game-server `poker_event_v1` + `requireRealRoots` |
| mint → ArenaAccounts → fund → GamePermission | Custody ready |
| match_api | `POST /v1/arena/find-match` → on-chain `sessionSealedV3=true` |
| seal_v3_atomic | API path uses `SessionSealCoordinator` → `sealAndFundSession` |
| seal_lifecycle | Lifecycle **Sealed** via vault `_notifyLifecycleSealed` |
| vrf_deck | Mock VRF + dealer-deck batch (allowed mock) |
| hands | Real game-server join + at least one settled hand |
| proof_batch | ProofBatchRegistry `registerBatch` |
| replay | `poker-replay verify-events --golden 03` |
| roots | Real WP-108 roots via `GET /v1/tables/:id/settlement-roots` (stubs → FAIL) |
| settlement | Hub V3 attestor quorum → ArenaAccounts |
| rake | ProtocolFeeVault → treasury sweep (0 rake OK) |
| withdraw | Owner withdraw |
| verify | `GET /v1/verify/session/:id` |
| reconcile | locks + accrued fees = 0 |

---

## Acceptance evidence (2026-08-07)

```text
pnpm e2e:golden:redeploy
→ overall: PASS
→ PASS=24 FAIL=0 GAP=0 SKIP=0
→ scripts/.anvil-e2e-golden-last.json

Notable stage details:
- match_api: table=arena_4ec2862d onchainSealed=true
- hands: handSettled=true agent=up (AGENT_RUNTIME_MODE=mock)
- roots: source=game-server:rebuild (WP-108, no session-bound stubs)
- settlement: Hub V3 quorum attestors=2
- verify: session package ok
- reconcile: locks + accrued fees = 0
```

Allowed mocks used: Anvil mock VRF + MockUSDC only.

---

## Coordination

| Packet | Owns |
|---|---|
| **WP-106** | Match → SeatTicket V3 → `sealAndFundSession` → lifecycle → VRF/deck → game-server → real roots → settle → withdraw → verify; zero GAP orchestrator |
| **WP-107** | Live Groq seats + continuous cognition + Energy + cadence |
| **WP-108** | Real eventRoot / handRoot / balanceRoot (`REQUIRE_REAL_ROOTS=1`) |

---

## Completion template

```
Work packet: WP-106
Status: DONE
Artifacts:
- scripts/anvil-e2e-golden.{mjs,sh}
- package.json (e2e:golden / e2e:golden:redeploy)
- services/game-server/src/index.ts (settlement-roots + health flags)
- services/game-server/src/table-runtime.ts (getSettlementRootsForGolden)
- docs/WP-106_ANVIL_GOLDEN_E2E.md
- mozetto_execution_plans/PROGRESS.md
Commands:
- pnpm e2e:golden:redeploy   # PASS=24 FAIL=0 GAP=0
Spec clauses: none mutated
Follow-up: Sepolia Stage A gated on WP-106–112 (now green on Anvil RC path)
```
