# WP-106 — True full Anvil golden match lifecycle

**Authority:** Wave 11 in `mozetto_execution_plans/PROGRESS.md`, WP-106 in `16_AGENT_WORK_PACKETS.md`  
**Supersedes gaps from:** `docs/WP-100_ANVIL_E2E.md` (`PASS_WITH_GAPS`)  
**Date:** 2026-08-07

---

## Goal

One golden command with **FAIL=0 and GAP=0**. Allowed mocks only: Anvil mock VRF + MockUSDC.

```text
Web/API → Find Match → random allocation → SeatTicket V3 → sealAndFundSession
  → SessionLifecycle (vault hook) → dealer secret → VRF → deck
  → real game-server → (Groq → WP-107) → events → roots (rebuild → WP-108)
  → proof batch → replay → attestors → Hub V3 → FeeVault → ArenaAccounts
  → Verify Game → withdraw
```

---

## Delivered

| Item | Location |
|---|---|
| Golden orchestrator | `scripts/anvil-e2e-golden.mjs` |
| Anvil ensure + wrapper | `scripts/anvil-e2e-golden.sh` |
| pnpm entries | `pnpm e2e:golden` / `pnpm e2e:golden:redeploy` |
| Last-run report (gitignored) | `scripts/.anvil-e2e-golden-last.json` |
| API HU path: SeatTicketV3 + `sealAndFundSession` | `services/api/src/arena-onchain.ts` |
| Session seal coordinator (submit) | `@mozetto/session-seal` |
| This note | `docs/WP-106_ANVIL_GOLDEN_E2E.md` |

WP-100 (`e2e:protocol-v3`) remains available for the older compose path that still allows GAP stages.

---

## How to run

```bash
# Stack (host processes — docker-compose.yml is Postgres/Redis only):
#   anvil, migrated DATABASE_URL, api, game-server, agent-runtime (bots / WP-076 fallback)
#   optional: dealer, settlement-worker, indexer for verify richness

pnpm e2e:golden:redeploy
```

Exit **0** only when **overall = PASS** (`FAIL=0` and `GAP=0`). Golden mode never records `GAP` — missing required pieces are **FAIL**.

### Flags

| Flag | Behavior |
|---|---|
| `--redeploy` | `DeployLocal` with `SETTLEMENT_HUB_V3_AS_PRIMARY=1` + chain-manifest codegen |
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
| mint → ArenaAccounts → fund → GamePermission | Custody ready |
| match_api | `POST /v1/arena/find-match` pairs → `sessionSealedV3=true` |
| seal_v3_atomic | API path uses `SessionSealCoordinator` → `sealAndFundSession` (not openSession) |
| seal_lifecycle | Lifecycle **Sealed** via vault `_notifyLifecycleSealed` |
| vrf_deck | Mock VRF + dealer-deck batch (allowed mock) |
| hands | Real game-server join + actions (Groq continuous cognition → **WP-107**) |
| proof_batch | ProofBatchRegistry `registerBatch` |
| replay | `poker-replay verify-events --golden 03` |
| roots | Bound for Hub settle; full gameplay rebuild → **WP-108** |
| settlement | Hub V3 attestor quorum → ArenaAccounts |
| rake | ProtocolFeeVault → treasury sweep |
| withdraw | Owner withdraw |
| verify | `GET /v1/verify/session/:id` / resolve live |
| reconcile | locks + accrued fees = 0 |

---

## Coordination

| Packet | Owns |
|---|---|
| **WP-106** | Match → SeatTicket V3 → `sealAndFundSession` → lifecycle → VRF/deck → game-server smoke → settle → withdraw → verify; zero GAP orchestrator |
| **WP-107** | Live Groq seats + continuous cognition + Energy + cadence for complete sessions |
| **WP-108** | Real eventRoot / handRoot / balanceRoot from gameplay (no session-bound stand-ins) |

---

## Acceptance evidence

```text
# Stack: Anvil + API + game-server (MOZETTO_GOLDEN=1 REQUIRE_REAL_ROOTS=1
# CANONICAL_SCHEMA_KIND=poker_event_v1 HUMAN_PLAY=0) + agent-runtime (mock OK)

bash ./scripts/anvil-e2e-golden.sh
→ overall: PASS
→ PASS=23 FAIL=0 GAP=0 SKIP=1
→ scripts/.anvil-e2e-golden-last.json
```

Evidence run (2026-08-07): `overall: PASS`, `FAIL=0`, `GAP=0` — find-match sealed V3, lifecycle Sealed, mock VRF+deck, real roots via game-server, Hub V3 settle, FeeVault sweep, withdraw, Verify Game.

If API or game-server is down, overall is **FAIL** (not `PASS_WITH_GAPS`).
