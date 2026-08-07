# WP-113 — Live chaos completeness

**Authority:** `mozetto_execution_plans/14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md` (Chaos matrix), `16_AGENT_WORK_PACKETS.md` WP-113  
**Prior:** WP-101 unit chaos (`docs/WP-101_CHAOS_SUITE.md`, `pnpm test:chaos`)  
**Depends on:** WP-086 hosted compose, WP-080/081/082/084 recovery properties  
**Date:** 2026-08-07

---

## Goal

Expand **multi-container** failure drills beyond WP-101’s four live recipes so Redis / RPC consumers / VRF / dealer / worker / settlement paths have scripted kill/stall/resume coverage with a documented expected-outcome matrix.

Live drills prove **process recovery + documented safety properties**. They do **not** fake green CI or claim production readiness.

---

## Hard gates

| Gate | Rule |
|---|---|
| `CHAOS_LIVE=1` | **Required** for every live script / `run-live.sh` |
| Never production | Refuses `MOZETTO_CHAIN_ENV` ∈ `{base, mainnet, base-mainnet, production, prod}` |
| Compose target | `docker-compose.hosted.yml` project `mozetto-hosted` (+ local `docker-compose.yml` for Redis/Postgres) |
| CI default | Unit only (`pnpm test:chaos`). Live is **opt-in** |

---

## Commands

```bash
# Local datastores (Redis/Postgres pause drills)
docker compose -f docker-compose.yml up -d

# Hosted app stack (WP-086) — staging/Anvil secrets only
docker compose -f docker-compose.hosted.yml --env-file .env.hosted up -d --build

# List scenarios
CHAOS_LIVE=1 bash scripts/chaos/run-live.sh list

# Full live suite
CHAOS_LIVE=1 pnpm test:chaos:live
# equivalent:
CHAOS_LIVE=1 bash scripts/chaos/run-live.sh all

# Unit + live
CHAOS_LIVE=1 pnpm test:chaos:all

# Single scenario
CHAOS_LIVE=1 bash scripts/chaos/run-live.sh dealer-kill

# Opt-in destructive DB pause
CHAOS_LIVE=1 CHAOS_DB_DISCONNECT=1 bash scripts/chaos/run-live.sh db-disconnect
```

Without `CHAOS_LIVE=1`, live entrypoints **fail closed**.

---

## Layout

```text
scripts/chaos/
  lib.sh                      # health helpers, CHAOS_LIVE + anti-prod gates
  run-unit.sh                 # CI (WP-101)
  run-live.sh                 # live orchestrator (WP-113)
  run-all.sh                  # unit; live iff CHAOS_LIVE=1
  live/
    EXPECTED_OUTCOMES.md      # canonical matrix
    game-kill.sh
    dealer-kill.sh
    indexer-restart.sh
    rpc-stall.sh
    worker-restart.sh
    settlement-stall.sh
    vrf-stall.sh
    redis-kill.sh
    db-disconnect.sh
```

---

## Expected-outcome matrix (summary)

Full table: [`scripts/chaos/live/EXPECTED_OUTCOMES.md`](../scripts/chaos/live/EXPECTED_OUTCOMES.md).

| Scenario | Inject | Safe recovery signal |
|---|---|---|
| `game-kill` | SIGKILL game | `:4001/health` + lease surface |
| `dealer-kill` | SIGKILL dealer | `:4003/health` + attest hint |
| `indexer-restart` | stop → lag window → start | `:4010/health` + cursor/lag fields |
| `rpc-stall` | stop indexer + worker | both healthy; idempotent catch-up |
| `worker-restart` | SIGKILL worker | `:4011/health`; no double-pay (unit/forge) |
| `settlement-stall` | SIGKILL verifier + worker | verifier then worker healthy |
| `vrf-stall` | SIGKILL worker on VRF path | worker healthy; single fulfill (manual Anvil) |
| `redis-kill` | pause `mozetto-redis` | unpause → PONG; game health; fencing fail-closed while down |
| `db-disconnect` | pause `mozetto-postgres` (opt-in) | unpause → ready; persist-before-broadcast (unit) |

---

## CI vs live gaps (honest)

| Capability | In default CI? | Notes |
|---|---|---|
| Unit property suite (`pnpm test:chaos`) | **Yes** | No Docker; WP-101 |
| Full multi-container kill/stall suite | **No** | Needs Docker + `.env.hosted` + running stack |
| Redis pause with ≥2 game replicas | **No** | Script pauses Redis; dual-replica fencing is staging manual |
| Dual RPC URL failover | **No** | `rpc-stall` stops consumers only; configure fallback RPC in ops |
| Seeded Anvil VRF fulfill race | **No** | `vrf-stall` recovers worker; full race needs live session + `ENABLE_MOCK_VRF=1` |
| Nitro dealer enclave / vsock | **No** | Hosted dealer parent only |
| Proof publisher container | **No** | `Dockerfile.publisher` exists; not default hosted compose service |
| Groq / relayer kill | **No** | Deferred; agent has mock fallback for readiness |
| Mid-hand engine rebuild fidelity | **Partial** | Lease + outbox + tip covered in unit; full seat/snapshot still WP-080 deferral |

Default CI remains:

```yaml
# .github/workflows/ci.yml
- run: pnpm test:chaos
```

Do **not** wire `CHAOS_LIVE=1` into GitHub Actions until a dedicated staging runner owns the hosted stack.

---

## Safety

- Live scripts may `SIGKILL` containers and `docker pause` Redis/Postgres — **staging / local only**.
- Anti-prod gate refuses mainnet-like `MOZETTO_CHAIN_ENV`.
- Do not commit `.env.hosted` secrets.
- Chaos asserts **safety**, not availability SLOs.
- `CHAOS_ALLOW_PROD` is explicitly unsupported and fails.

---

## Acceptance evidence

```bash
pnpm test:chaos
# WP-101 unit chaos: all scenarios passed
```

Live (staging operator):

```bash
CHAOS_LIVE=1 bash scripts/chaos/run-live.sh all
# … PASS game-kill / dealer-kill / indexer-restart / rpc-stall /
#     worker-restart / settlement-stall / vrf-stall / [redis-kill]
```

Related (not replaced):

```bash
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/chain-indexer test
cd contracts && forge test --match-contract PokerSettlementHubV3 -vv
```

---

## Delivered

| Item | Path |
|---|---|
| Expanded live drills | `scripts/chaos/live/{dealer,rpc,vrf,settlement,redis}-*.sh` |
| Expected-outcome matrix | `scripts/chaos/live/EXPECTED_OUTCOMES.md` |
| Live gate (`CHAOS_LIVE=1` + anti-prod) | `scripts/chaos/lib.sh`, `run-live.sh` |
| This note | `docs/WP-113_LIVE_CHAOS.md` |
| PROGRESS | `mozetto_execution_plans/PROGRESS.md` |

**Out of scope:** Spec mutations; faking live CI green; production incident tooling; Nitro enclave chaos; dual-RPC automatic cutover.

---

## Completion template

```
Work packet: WP-113
Status: DONE
Artifacts:
- scripts/chaos/live/{dealer-kill,rpc-stall,vrf-stall,settlement-stall,redis-kill}.sh
- scripts/chaos/live/EXPECTED_OUTCOMES.md
- scripts/chaos/{lib,run-live,run-all}.sh (CHAOS_LIVE=1 + anti-prod gates)
- docs/WP-113_LIVE_CHAOS.md
- mozetto_execution_plans/PROGRESS.md
Commands:
- pnpm test:chaos
- CHAOS_LIVE=1 pnpm test:chaos:live   # requires hosted stack; not default CI
Spec clauses: none mutated; Plan 14 chaos matrix extended honestly
Follow-up: staging dual-replica Redis fencing; Anvil seeded VRF fulfill race; optional publisher compose service
```
