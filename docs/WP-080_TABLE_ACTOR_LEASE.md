# WP-080 — Table actor lease / recovery

**Authority:** `mozetto_execution_plans/07_REALTIME_BACKEND_SUPABASE_AND_INFRASTRUCTURE.md` (table actor + Redis leases + recovery)  
**Packet:** `16_AGENT_WORK_PACKETS.md` WP-080  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Versioned lease acquire / renew / release | `services/game-server/src/lease/` |
| In-memory backend (tests + single replica) | `lease/memory-store.ts` |
| Redis backend (multi-replica) | `lease/redis-store.ts` |
| Wait-for-expiry reclaim + heartbeat | `lease/manager.ts` |
| Durable event-tip replay / hash-chain check | `lease/recovery.ts` |
| Game-server wire (fence before act, unload on loss) | `services/game-server/src/index.ts`, `table-runtime.ts` |
| Contention / expiry / replay tests | `lease/lease.test.ts` |
| This note | `docs/WP-080_TABLE_ACTOR_LEASE.md` |

No `/specs` mutations. No SettlementHub edits. Persist-before-broadcast outbox remains WP-081.

---

## Goal

Exactly one logical writer per active table. On restart: reclaim or wait, then resume from the durable event tip. Never let two actors both continue (split-brain).

---

## Lease record

```text
tableId
actorInstanceId
leaseVersion
expiresAt
```

- **acquire** — `SET` when free or expired; same actor may refresh; foreign live holder → deny (optional wait until expiry).
- **renew** — requires matching `actorInstanceId` **and** `leaseVersion` (fencing token); bumps version + TTL.
- **release** — delete only if holder (+ optional version) matches.
- **heartbeat** — renew at ~TTL/3; on failure unload the in-memory actor and stop the loop.

### Backends

| Mode | When | Notes |
|---|---|---|
| `redis` | `REDIS_URL` set and reachable | Required for multi-replica |
| `memory` | no Redis | Single process only; two managers sharing one `MemoryLeaseBackend` still contend correctly in tests |
| Redis configured but down | startup throws `table_lease_redis_unavailable` | Refuses silent dual-writer |

Env: `TABLE_LEASE_TTL_SEC` (default 30), `TABLE_LEASE_WAIT_MS` (default = TTL), `TABLE_LEASE_ACTOR_ID` (optional stable instance id).

---

## Recovery

```text
acquire lease (wait ≤ TABLE_LEASE_WAIT_MS)
→ load seats / sessions snapshot from Postgres
→ replay hand_events tip (sequence + prevEventHash chain)
→ if chain broken: refuse actor loop
→ bind fencing token + start heartbeat
→ resume waiting-street loop (mid-hand engine rebuild stays seat/snapshot based)
```

`recoverActorTip` / `replayDurableEvents` detect:

- sequence gaps;
- `prevEventHash` breaks;
- missing hashes;
- illegal `prev` on sequence 1.

Broken chain → HTTP/WS error; table is not advanced. Client `replay_from` still serves public events after a healthy reclaim.

---

## Game-server surface

| Path | Lease behavior |
|---|---|
| `GET /health` | Reports `tableLease` mode, `actorInstanceId`, per-table `leaseVersion` |
| Mutating HTTP / WS | `assertHeld` after acquire/renew; `409 table_lease_conflict` on loss |
| SIGINT / SIGTERM | Release all held leases before exit |

---

## Library API

```ts
import {
  MemoryLeaseBackend,
  TableActorLeaseManager,
  recoverActorTip,
  replayDurableEvents,
} from "./lease/index.js";

const backend = new MemoryLeaseBackend();
const a = new TableActorLeaseManager({ backend, actorInstanceId: "a", ttlMs: 30_000 });
const lease = await a.acquire("table-1", { waitMs: 30_000 });
const tip = recoverActorTip(events); // { sequence, prevHash, chainOk }
a.assertHeld("table-1");
await a.release("table-1");
```

---

## Acceptance evidence

```bash
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/game-server typecheck
```

---

## Intentional deferrals

- Full mid-hand engine reconstruction from event payloads (Season-1 restarts between hands / waiting street after crash).
- Transactional outbox / persist-before-broadcast (WP-081).
- Redis queue rebuild from Postgres heartbeats beyond lease fencing.
- Spec / SettlementHub changes.
