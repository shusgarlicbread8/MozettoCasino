# WP-081 — Persist-before-broadcast outbox

**Authority:** `mozetto_execution_plans/07_REALTIME_BACKEND_SUPABASE_AND_INFRASTRUCTURE.md` (persistence rule)  
**Depends on:** WP-060 event-store + migration `019` (`schema_kind`, `event_persistence_outbox`)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Transactional outbox helpers | `packages/database/src/outbox.ts` + `withTransaction` |
| Migration (payload / channel / schema_kind) | `packages/database/migrations/020_broadcast_outbox_wp081.sql` |
| Pipeline: write → outbox → commit → broadcast → mark sent | `services/game-server/src/outbox/pipeline.ts` |
| Memory + Postgres stores | `outbox/memory-store.ts`, `outbox/postgres-store.ts` |
| Restart drain of undelivered rows | `outbox/recovery.ts` + `TableRuntime.load` |
| PokerEventV1 encoding bridge (opt-in) | `outbox/schema.ts` via `@mozetto/event-store` |
| TableRuntime wire | `services/game-server/src/table-runtime.ts` `persistEvent` |
| Tests | `services/game-server/src/outbox/outbox.test.ts` |
| This note | `docs/WP-081_PERSIST_OUTBOX.md` |

No SettlementHub edits. Specs untouched.

---

## Persistence rule

```text
BEGIN DB TRANSACTION
  insert hand_events
  [optional] insert canonical_game_events (+ public_event_payloads)
  append event_persistence_outbox (status=pending)
COMMIT
publish WebSocket frame
mark outbox published   -- or bump attempts, keep pending on WS failure
```

**Never** broadcast an authoritative event before durable persistence (+ outbox row) succeeds.

On process / actor restart, `recoverUndeliveredOutbox` republishes `status=pending` rows for the table before the actor loop accepts new writes.

---

## Schema kinds

| `schema_kind` | Meaning |
|---|---|
| `legacy_json` (default) | Existing `hand_events` sha256 + on-chain `mozetto-poker-v1` keccak (`buildCanonicalEvent`) |
| `poker_event_v1` | Opt-in via `CANONICAL_SCHEMA_KIND=poker_event_v1` when the string event type maps to a PokerEventV1 code; ABI hash via `@mozetto/event-store` |

Unmapped live events (`ACTION_CLOCK`, `JOIN_QUEUED`, …) always stay `legacy_json`.

---

## Env

| Variable | Default | Effect |
|---|---|---|
| `OUTBOX_STORE` | postgres | Set `memory` for in-process store (tests) |
| `CANONICAL_SCHEMA_KIND` | `legacy_json` | Set `poker_event_v1` to prefer event-store encodings when mappable |

Operator view: `broadcast_outbox` (synonym of `event_persistence_outbox`).

---

## Tests / evidence

```bash
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/game-server typecheck
pnpm --filter @mozetto/database typecheck
```

Covers: persist-before-broadcast ordering; write failure ⇒ no broadcast; publish failure ⇒ pending retained; restart drain; schema_kind flags + PokerEventV1 encode.

---

## Out of scope

- Full engine → PokerEventV1 cutover / replay verifier (WP-064)
- SettlementHubV3 / proof batching (WP-062/063)
- Spec / golden vector mutations
- Supabase Realtime as authoritative game loop
