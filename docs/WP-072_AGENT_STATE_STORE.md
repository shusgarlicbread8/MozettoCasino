# WP-072 — AgentState store

**Authority:** `mozetto_execution_plans/08_GROQ_GPT_OSS_120B_AI_RUNTIME.md`, `09_CONTINUOUS_COGNITION_ENERGY_MEMORY_AND_TIMING.md`, WP-072 in `16_AGENT_WORK_PACKETS.md`  
**Specs (frozen):** `specs/MOZETTO_CONTROLLER_V1.md` §7, `specs/MOZETTO_ENERGY_V1.md` §10 (corruption → reconstruct)  
**Prior:** WP-070 provider, WP-071 policy/profiles  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `AgentStateV1` + nested structured types | `services/agent-runtime/src/state/types.ts` |
| Season 1 memory bounds + `schemaVersion=1` | `services/agent-runtime/src/state/bounds.ts` |
| Deterministic prune / eviction | `services/agent-runtime/src/state/prune.ts` |
| Factory, public-event ingest, mutators | `services/agent-runtime/src/state/create.ts` |
| Reconstruction from checkpoint + public events | `services/agent-runtime/src/state/reconstruct.ts` |
| In-memory `AgentStateStore` | `services/agent-runtime/src/state/memory-store.ts` |
| Postgres `DbAgentStateStore` (migration 026) | `services/agent-runtime/src/state/db-store.ts` |
| Env factory `createAgentStateStore` | `services/agent-runtime/src/state/factory.ts` |
| SQL schema doc + legacy throw stub | `services/agent-runtime/src/state/db-stub.ts` |
| Unit tests (bounds, eviction, round-trip, reconstruct, mocked DB) | `services/agent-runtime/src/state/state.test.ts`, `db-store.test.ts` |
| Export | `@mozetto/agent-runtime/state` |

---

## Product rules (Season 1)

- Store **structured summaries + event refs only** — never raw chain-of-thought as consensus/private state.
- Private: own seat AgentState. Public events may update table image / opponent aggregates.
- **MUST NOT** ingest opponent hole cards, opponent profiles/policies, or opponent private memory.
- `memoryVersion` bumps on every mutating write; `publicEventCursor` is monotonic.
- Corruption path: reconstruct from last checkpoint + public events; on failure set `reviewFlag` for fallback (WP-076) + hand review (ENERGY_V1 §10).
- Continuous cognition **scheduler loops are not started** (WP-073). Store APIs are what the scheduler will call later.

---

## Season 1 bounds (hypotheses)

| Cap | Value | Notes |
|---|---:|---|
| `AGENT_STATE_SCHEMA_VERSION` | `1` | Bump on semantic change |
| `MAX_OPPONENT_MODELS` | `5` | Six-max minus self |
| `MAX_RANGE_HYPOTHESES` | `8` | Cross-opponent |
| `MAX_TIMING_MODELS` | `5` | Per-opponent cadence |
| `MAX_RECENT_OBSERVATIONS` | `32` | Hand-tier ring |
| `MAX_ACTION_FREQ_KEYS` | `16` | Per opponent model |
| `MAX_SHOWDOWN_EVIDENCE` | `8` | Event refs |
| `MAX_SOURCE_EVENT_REFS` | `4` | Per summary |
| Street / self / table notes | 64–128 chars | Truncated |

Eviction order: **recency → confidence → seat** (deterministic).

---

## Persistence

1. **In-memory** (`InMemoryAgentStateStore`) — tests and local runtime (**default** via `AGENT_STATE_STORE=memory`).
2. **Postgres** (`DbAgentStateStore`) — upserts `agent_session_states` / inserts `agent_state_checkpoints` when `AGENT_STATE_STORE=db` and `DATABASE_URL` is set (or inject `createAgentStateStore({ exec })` in tests).
3. **Schema** — `packages/database/migrations/026_agent_brain_energy.sql` (documented in `AGENT_STATE_SCHEMA_SQL_STUB`).

| Env | Default | Notes |
|---|---|---|
| `AGENT_STATE_STORE` | `memory` | `db` / `postgres` / `pg` selects Postgres writer |
| `DATABASE_URL` | — | Required for `db` mode unless `exec` is injected |

Does **not** claim hosted migrations have been applied — operators must run `pnpm --filter @mozetto/database migrate` against the target DB.

Checkpoints are versioned (`schemaVersion`, `memoryVersion`, `publicEventCursor`) for reconstruction.

---

## Scheduler call surface (WP-073 later)

```text
createEmptyAgentState → put / saveCheckpoint
applyPublicEventDeterministic (0 Energy ingest)
upsertOpponentModel / upsertRangeHypothesis / setStreetPlan / …
reconstructAgentState(checkpoint, publicEvents) on corruption
```

No event-driven background loops in this packet. Energy charging lives in WP-074 (`@mozetto/agent-runtime/energy`). Public cadence is WP-075 (`@mozetto/agent-runtime/cadence`).

---

## Not in scope

- WP-073 continuous cognition scheduler
- WP-074 Energy ledger debiting (see `docs/WP-074_ENERGY_LEDGER.md`)
- WP-075 public cadence (see `docs/WP-075_PUBLIC_CADENCE_CONTROLLER.md`)
- Spec / golden vector mutations
- `contracts/` changes
- Hosted `DATABASE_URL` migrate apply (operator responsibility)
