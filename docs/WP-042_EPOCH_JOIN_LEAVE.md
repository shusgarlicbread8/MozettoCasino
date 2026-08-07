# WP-042 — Epoch join/leave rotation

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md` (continuous cash-table epochs)  
**Specs:** `MOZETTO_SESSION_V2` (frozen) — epoch rotation MUST NOT rewrite historical sealed descriptors  
**Prior:** WP-040 ranked matchmaker, WP-041 session seal coordinator  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Migration `table_epochs` + `queued_seat_changes` | `packages/database/migrations/018_epoch_join_leave.sql` |
| Pure rotation planner + immutability rules | `packages/database/src/epoch-rotation.ts` |
| DB enqueue / rotate helpers | `packages/database/src/epoch-store.ts` |
| Game-server queue + boundary flush | `services/game-server/src/table-runtime.ts` |
| Unit tests | `packages/database/src/epoch-rotation.test.ts` |
| This note | `docs/WP-042_EPOCH_JOIN_LEAVE.md` |

No ArenaVault / SessionLifecycle contract edits (avoid fights with WP-025). On-chain Epoch N+1 reseal is deferred.

---

## Rules

1. **No mid-hand participant mutation.** While a hand is live (`handId` set and street ∉ `{waiting, settlement}`), joins / leaves / top-ups are **queued**, not applied to seats.
2. **Leave mid-hand:** player remains exposed until the hand finishes (Plan 04). All-in players may queue leave but cannot vacate before resolution.
3. **Apply at epoch boundary:** after hand complete → `resetToWaiting` → flush queue → open next epoch → next hand.
4. **Apply order:** leaves → top-ups → joins (free seats before fills).

```text
Hand N ACTIVE
→ JOIN_QUEUED / LEAVE_QUEUED / TOP_UP_QUEUED
→ Hand N completes
→ close table_epochs N
→ apply queued_seat_changes
→ open table_epochs N+1 (participant_snapshot)
→ Hand N+1 starts
```

---

## Data model

### `table_epochs`

Per continuous table checkpoint. `participant_snapshot` is an **audit** JSON of owners/seats/stacks — not a Protocol V3 Merkle root (reseal deferred).

### `queued_seat_changes`

| Field | Notes |
|---|---|
| `change_type` | `join` \| `leave` \| `top_up` |
| `target_epoch` | Current epoch when between hands; `current+1` when queued mid-hand |
| `status` | `pending` → `applied` \| `rejected` \| `cancelled` |
| `idempotency_key` | Unique per `(table_id, key)` |

---

## Game-server surface

Existing endpoints unchanged in path:

| Call | Mid-hand | Between hands |
|---|---|---|
| `POST /v1/tables/:id/join` | `{ queued: true, targetEpoch }` | Immediate seat |
| `POST /v1/tables/:id/leave` | `{ queued: true }` — stays in hand | Immediate vacate + cash-out |
| `POST /v1/tables/:id/top-up` | `{ queued: true }` | Immediate stack add |

Events: `JOIN_QUEUED`, `LEAVE_QUEUED`, `TOP_UP_QUEUED`, `EPOCH_ROTATED`.

---

## Library API

```ts
import {
  handPhase,
  planEpochBoundary,
  enqueueSeatChange,
  rotateEpochAtBoundary,
} from "@mozetto/database";

assert.equal(handPhase({ handId: "h1", street: "flop" }), "hand_active");
const plan = planEpochBoundary({
  currentEpoch: 1,
  participants,
  pending,
  maxSeats: 6,
});
// plan.nextParticipants — seats after leaves/joins; input array unchanged
```

---

## Acceptance evidence

```bash
pnpm --filter @mozetto/database test
pnpm --filter @mozetto/database typecheck
pnpm --filter @mozetto/game-server typecheck
```

- Mid-hand mutation forbidden (`PARTICIPANTS_IMMUTABLE_MID_HAND`)
- Leaves before joins frees seats for queued joiners
- All-in leave rejected at boundary until `allIn` cleared
- Queue ignored for unrelated target epochs

---

## Out of scope

| Topic | Packet / note |
|---|---|
| On-chain Epoch N+1 `sealAndFundSession` / participantRoot rewrite | Follow-up after WP-025; WP-041 coordinator can dry-run roots |
| Spec / vector mutations | Forbidden |
| Continuous cognition | Forbidden |
| Anti-pairing / identity clusters | WP-043 |
| `POST /v1/sessions/:id/request-leave` alias | Existing `/leave` evolves; Plan 04 path optional later |

---

## Follow-up

- Wire on-chain epoch reseal via `@mozetto/session-seal` at boundary (new sessionId / epoch roots)
- Optional cancel-pending API
- WP-043 anti-pairing hooks on queued joins
