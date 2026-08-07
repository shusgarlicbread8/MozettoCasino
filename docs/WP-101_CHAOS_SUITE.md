# WP-101 — Chaos suite

**Authority:** `mozetto_execution_plans/14_ANVIL_SEPOLIA_MAINNET_TEST_AND_AUDIT_PLAN.md` (Chaos matrix), `16_AGENT_WORK_PACKETS.md` WP-101  
**Depends on:** WP-080 table leases, WP-081 outbox, WP-082 indexer, WP-084/063 settlement, WP-086 hosted compose  
**Date:** 2026-08-07

---

## Goal

Scripted kill / lag / disconnect / restart drills with **documented safe recovery properties**:

| Property | Meaning |
|---|---|
| **No double-pay** | Worker restart never credits a session twice; Hub `AlreadySettled` is a safe no-op |
| **Lease recovery** | After game kill, exactly one writer reclaim (fencing / `leaseVersion` bump) |
| **Outbox catch-up** | Pending `event_persistence_outbox` rows drain before new authoritative writes |
| **Indexer catch-up** | Restart/rebuild resumes cursor; money upserts stay idempotent (no invented credits) |
| **DB disconnect safety** | Persist-before-broadcast: write failure ⇒ no WS broadcast |

---

## Layout

```text
scripts/chaos/
  lib.sh                 # shared docker/health helpers
  run-unit.sh            # CI-safe property suite (default)
  run-live.sh            # docker-compose.hosted live drills
  run-all.sh             # unit + live when CHAOS_LIVE=1
  unit/
    run.mjs              # orchestrator
    game-kill.mjs
    indexer-lag.mjs
    worker-restart.mjs
    db-disconnect.mjs
    assert.mjs
  live/
    game-kill.sh
    indexer-restart.sh
    worker-restart.sh
    db-disconnect.sh
```

---

## Commands

```bash
# CI-safe (no Docker) — always runnable after pnpm install
pnpm test:chaos
# equivalent:
bash scripts/chaos/run-unit.sh

# Single unit scenario
bash scripts/chaos/run-unit.sh game-kill

# Live (requires hosted stack — WP-086)
docker compose -f docker-compose.hosted.yml --env-file .env.hosted up -d --build
CHAOS_LIVE=1 bash scripts/chaos/run-all.sh
# or:
bash scripts/chaos/run-live.sh all
bash scripts/chaos/run-live.sh game-kill

# DB pause is opt-in (local docker-compose.yml postgres)
CHAOS_DB_DISCONNECT=1 bash scripts/chaos/run-live.sh db-disconnect
```

---

## Expected outcomes (matrix)

### 1. Game-server kill

| Layer | Expected |
|---|---|
| **Unit** | Foreign actor denied while lease live; after TTL, reclaim with bumped `leaseVersion`; stale renew fails; pending outbox drained; durable tip `chainOk` |
| **Live** | `docker compose kill game` → health down → restart policy / `start` → `GET :4001/health` ok with `tableLease` + `actorInstanceId` |

Manual mid-hand follow-up (staging): tip `sequence` / `durableChainOk` matches Postgres `hand_events`; clients reconnect via `replay_from`.

### 2. Indexer lag / restart

| Layer | Expected |
|---|---|
| **Unit** | `lagBlocks = safeHead − cursor`; rebuild/reorg counters explicit; catch-up reduces lag to 0; no money invent in metrics model |
| **Live** | `stop indexer` → sleep → `start` → `:4010/health` ok; lag/cursor fields present |

On-chain money path remains **idempotent upsert** (WP-082). Rebuild (`INDEXER_REBUILD=1`) resets cursor only — does not invent vault credits.

### 3. Settlement worker restart

| Layer | Expected |
|---|---|
| **Unit** | Second attempt skipped when `sessionStatus=settled` or proposal in-flight; chain `AlreadySettled` ⇒ noop without second credit |
| **Live** | Kill/restart worker → `:4011/health` ok |

Contract backstop: `PokerSettlementHubV3.AlreadySettled` / vault `AlreadySettled` (forge tests). Full settle-race with seeded session remains a staging drill.

### 4. DB disconnect

| Layer | Expected |
|---|---|
| **Unit** | Write refusal ⇒ zero broadcasts / zero outbox rows; post-commit publish fail ⇒ pending retained; reconnect drain republishes without inventing events |
| **Live** | `docker pause mozetto-postgres` → hold → `unpause`; game `/health` may stay up (memory); mutating paths must fail closed |

---

## CI vs live gaps (honest)

| Capability | In default CI? | Notes |
|---|---|---|
| Unit property suite (`pnpm test:chaos`) | **Yes** (when wired) | No Docker; imports WP-080/081/082 libraries |
| Full multi-container kill/restart | **No** | Needs `docker-compose.hosted.yml` + `DATABASE_URL` / secrets |
| Mid-hand engine replay after kill | **Partial** | Lease + outbox + tip covered; full engine rebuild still seat/snapshot based (WP-080 deferral) |
| Live double-settle race with real Hub | **No** | Unit + forge `AlreadySettled`; seeded Anvil session is WP-100 adjacent |
| Redis multi-replica lease chaos | **No** | Unit uses `MemoryLeaseBackend`; Redis dual-replica needs `REDIS_URL` + ≥2 game replicas |
| Plan 14 full matrix (VRF, dealer enclave, Groq, RPC failover, …) | **Not yet** | Extensible under `scripts/chaos/`; stubs documented below |

### Plan 14 matrix — covered vs deferred

| Fault | Status |
|---|---|
| Game actor kill | Covered (unit + live recipe) |
| Postgres disconnect | Covered (unit + optional live pause) |
| Indexer stop/lag | Covered (unit + live recipe) |
| Settlement submitter restart | Covered (unit guards + live health) |
| WebSocket gateway alone | Deferred (same process as game today) |
| Redis kill | Deferred (multi-replica staging) |
| Primary/fallback RPC | Deferred (WP-100 / ops) |
| Proof publisher | Deferred (WP-085 runner optional) |
| Dealer / VRF / Groq / attestor | Deferred (separate packets) |

---

## Acceptance evidence

```bash
pnpm test:chaos
# WP-101 unit chaos: all scenarios passed
```

Live (optional):

```bash
CHAOS_LIVE=1 bash scripts/chaos/run-all.sh
```

Related package tests (not replaced by this suite):

```bash
pnpm --filter @mozetto/game-server test          # WP-080 / WP-081
pnpm --filter @mozetto/chain-indexer test        # WP-082
cd contracts && forge test --match-contract PokerSettlementHubV3 -vv
```

---

## Security notes

- Live scripts may SIGKILL containers and pause Postgres — **never** point at production.
- Do not commit `.env.hosted` secrets.
- Chaos asserts **safety**, not availability SLOs.

---

## Delivered

| Item | Path |
|---|---|
| Unit chaos scenarios | `scripts/chaos/unit/` |
| Live compose drills | `scripts/chaos/live/` |
| Entrypoints | `scripts/chaos/run-{unit,live,all}.sh` |
| Root script | `pnpm test:chaos` |
| This note | `docs/WP-101_CHAOS_SUITE.md` |

**Out of scope:** Spec mutations; faking green live CI; full Plan 14 matrix automation; production incident tooling.
