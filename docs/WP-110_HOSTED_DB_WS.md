# WP-110 — Hosted DB + WS cutover

**Authority:** Plan 19 (`19_DATABASE_SCHEMA_AND_API_MIGRATION_PLAN.md`), WP-110 in `16_AGENT_WORK_PACKETS.md`  
**Date:** 2026-08-07  
**Prior:** Plan 19 map (`docs/PLAN_19_DATABASE_API_MIGRATION.md`), WP-072/074 stores, WP-073 scheduler, WP-081 outbox, WP-107 live session

---

## Goal

Close hosted DB/WS cutover pieces that are code-completable:

1. Verify migrations applied; add per-service GRANT migration
2. Wire cognition/energy scheduler persist via Db stores when env selects `db`
3. WS v2 message cutover as far as safe (feature-flagged emit; dual accept)
4. Document + PROGRESS

---

## Migration status (verified 2026-08-07)

`pnpm db:migrate` against configured `DATABASE_URL` reports **`schema_migrations` count = 29** before WP-110, including:

| ID | File |
|---|---|
| 017–023 | Matchmaking audit → proof batch inclusion |
| 024 | Protocol versions / manifests |
| 025 | Session lifecycle V2 projection |
| 026 | Agent brain / energy |
| 027 | Identity clusters |
| 028 | Public verification packages |
| 029 | Randomness / deck batches |

**WP-110 adds `030_service_role_grants.sql`** (apply with `pnpm --filter @mozetto/database migrate`).

Roles present on hosted Supabase before 030: `anon`, `authenticated`, `service_role` (no `mozetto_*` yet).

---

## Per-service GRANTs (migration 030)

Creates **NOLOGIN** roles when missing:

| Role | Writer focus |
|---|---|
| `mozetto_api` | Matchmaking intents, admin/audit, verify status |
| `mozetto_game` | Canonical events, outbox, snapshots, hand events |
| `mozetto_agent` | AgentState, Energy, inference |
| `mozetto_dealer` | Dealer / deck commitments (no plaintext secrets) |
| `mozetto_indexer` | Chain / vault mirrors |
| `mozetto_worker` | Settlement + proof batches |
| `mozetto_verifier` | Read-heavy verify + status history writes |

- GRANTs are table-existence gated (`_wp110_grant_table` helper, dropped after run).
- Roles receive `BYPASSRLS` so deny-by-default RLS tables stay reachable without permissive anon policies.
- `service_role` receives broad table privileges when present (single-DSN hosted path).
- **Ops follow-up:** issue dedicated DSNs or `SET ROLE` — apps still use `DATABASE_URL` as postgres/service today.

---

## Scheduler persist hooks

| Piece | Behavior |
|---|---|
| `ContinuousCognitionScheduler` | Optional `energyStore`; `persistStores()` writes AgentState + Energy after mutations |
| `createCognitionScheduler` | Selects stores via `AGENT_STATE_STORE` / `ENERGY_LEDGER_STORE`; hydrates prior snapshots |
| `LiveSessionManager` (WP-107) | Passes `energyStore` into scheduler so db mode persists on every cognition tick |

Env (default `memory`):

```bash
AGENT_STATE_STORE=db
ENERGY_LEDGER_STORE=db
# requires DATABASE_URL + migration 026+
```

---

## WS v2 cutover plan

### Phase A (shipped — safe)

1. **Inbound dual-accept:** Plan 19 names normalize to legacy before validation  
   (`auth_v2` → `auth`, `subscribe_table_v2` → `subscribe_table`, `request_leave_v2` → `leave_table`, `request_replay_v1` → `replay_from`, …).
2. **Outbound default legacy:** existing web clients keep working (`hello`, `snapshot`, `event`, …).
3. **Feature flag emit:** `GAME_WS_EMIT_V2=1` (or `GAME_WS_PROTOCOL=v2`) maps outbound frames:

| Legacy | v2 |
|---|---|
| `hello` | `hello_v2` (+ `protocolVersion: 2`) |
| `snapshot` | `snapshot_v2` |
| `event` | `canonical_event_v1` |
| `private_state` | `private_state_v2` |
| `error` | `error_v2` |

### Phase B (client follow-up — not blocking WP-110)

1. Web table/live pages accept both legacy and v2 server types (or set emit flag after deploy).
2. Prefer v2 client sends from new clients; keep dual-accept indefinitely.
3. Additive frames (`session_lifecycle_v2`, `energy_summary_v1`, `verification_update_v1`) when product surfaces need them — AI runtime still does **not** speak browser WS.

### Artifacts

- `packages/shared-types/src/ws-protocol.ts`
- `services/game-server/src/ws-protocol.ts` (+ tests)

---

## Not claimed / deferred

- Dedicated per-service DSNs in Fly/Render secrets (ops)
- Full client UI switch to v2-only frames
- Spec mutations
- Destructive prod resets
- Tables still deferred from Plan 19 (`protocol_fee_sweeps`, `relayer_transactions`, `safe_proposals`)

---

## Acceptance evidence

```bash
# Migrations (incl. 030 when DATABASE_URL set)
pnpm --filter @mozetto/database migrate

pnpm --filter @mozetto/agent-runtime test
pnpm --filter @mozetto/agent-runtime typecheck
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/game-server typecheck
pnpm --filter @mozetto/shared-types typecheck
```

---

## Completion template

```
Work packet: WP-110
Status: DONE
Artifacts:
- packages/database/migrations/030_service_role_grants.sql
- services/agent-runtime/src/cognition/factory.ts (+ scheduler energyStore persist)
- services/agent-runtime/src/live/session-manager.ts (energyStore → scheduler)
- packages/shared-types/src/ws-protocol.ts
- services/game-server/src/ws-protocol.ts (+ tests)
- docs/WP-110_HOSTED_DB_WS.md
- mozetto_execution_plans/PROGRESS.md
Commands:
- pnpm --filter @mozetto/database migrate
- pnpm --filter @mozetto/agent-runtime test
- pnpm --filter @mozetto/game-server test
Spec clauses: none mutated; Plan 19 WS names + ownership matrix honored
Follow-up: dedicated DSNs / SET ROLE; web client dual-read for emit_v2; Phase B additive frames
```
