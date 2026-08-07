# WP-073 — Continuous cognition scheduler

**Authority:** Plan 09 (`09_CONTINUOUS_COGNITION_ENERGY_MEMORY_AND_TIMING.md`), WP-073 in `16_AGENT_WORK_PACKETS.md`  
**Specs (frozen):** `specs/MOZETTO_ENERGY_V1.md` §§4–6, §12; `specs/MOZETTO_CONTROLLER_V1.md` §7  
**Prior:** WP-070 Groq `updateState`, WP-072 AgentState, WP-074 Energy ledger, WP-075 cadence, WP-076 fallback  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Scheduler modes + types (ENERGY_V1 §6) | `services/agent-runtime/src/cognition/types.ts` |
| Season 1 weights / hypotheses | `services/agent-runtime/src/cognition/weights.ts` |
| Event → mode policy | `services/agent-runtime/src/cognition/policy.ts` |
| Priority queue | `services/agent-runtime/src/cognition/queue.ts` |
| Structured patch apply (no CoT) | `services/agent-runtime/src/cognition/apply.ts` |
| `ContinuousCognitionScheduler` | `services/agent-runtime/src/cognition/scheduler.ts` |
| Groq `updateState` background path | `services/agent-runtime/src/provider/groq-gpt-oss-120b.ts` |
| Background JSON schema | `services/agent-runtime/src/provider/decision-schema.ts` |
| Unit tests (policy, queue, reserve, preempt, mock Groq) | `services/agent-runtime/src/cognition/cognition.test.ts` |
| Export | `@mozetto/agent-runtime/cognition` |

---

## Product rules

- Public table events trigger **private** background cognition; the system is event-driven (not a continuously running model process).
- Scheduler outputs: `IGNORE` | `DETERMINISTIC_UPDATE` | `LIGHT_UPDATE` | `OPPONENT_UPDATE` | `STREET_PLAN` | `DEEP_REEVALUATION`.
- Deterministic public ingest always runs first (**0 Energy**).
- Model background work debits Energy **only after successful execution**.
- Cancelled / preempted provider calls **MUST NOT** debit Energy.
- While the seat is active, background spend **MUST** leave ≥ **12** Energy (`MANDATORY_RESERVE`) for the final action.
- Final `runFinalAction` preempts queued + in-flight background jobs, then calls `decide` (deadline / `publicCadenceMs` via WP-075 at the table clock).
- AgentState stores **structured summaries only** — never raw chain-of-thought, free-text reasoning, or opponent private data.
- Profiles bias scheduler weights via axes; they **MUST NOT** change the Energy cost table.

---

## Call surface

```text
new ContinuousCognitionScheduler({ provider, store, sessionId, handId, seat, axes, … })
onPublicEvent(event)     → deterministic ingest + optional enqueue
drain()                  → process priority queue (updateState + Energy debit)
preemptForFinalAction()  → cancel queued/in-flight; no debit
runFinalAction(decideReq)→ preempt + decide + final Energy debit
```

Typical wire:

```text
canonical public event
  → onPublicEvent → drain (background updateState)
when seat must act
  → runFinalAction → decide
  → WP-075 schedulePublicCadence / wait
  → commit action before deadline
```

---

## Season 1 hypotheses (scheduler weights + Energy)

Exact mode thresholds, priority boosts, and Energy costs are **Season 1 initial defaults / hypotheses**, not proven optima. Recalibrate only via a new policy label / season — never silent mutation of an active season.

| Knob | Value | Notes |
|---|---|---|
| Policy label | `continuous-cognition-scheduler-season1-v1` | Recalibrate via new label |
| `OWN_TURN_PRIORITY_BOOST` | `100` | Near-turn jobs run first |
| `UNUSUAL_CADENCE_MS` | `11_000` | Timing-oriented light update |
| Axis: adaptation prefer | `≥ 60` | Prefer `OPPONENT_UPDATE` |
| Axis: conservation demote | `≥ 65` | Demote expensive background |
| `DEEP_REEVALUATION` Energy | STREET_PLAN (**6**) | No separate cost row in ENERGY_V1 |
| Energy costs | WP-074 table | LIGHT/TIMING=2, OPPONENT=4, STREET=6, finals 8/16/24 |

Energy cost table remains owned by WP-074 (`energy-policy-season1-100-v1`).

---

## Groq `updateState`

- Strict JSON Schema `background_state_patch_v1` — allowlisted patch fields only.
- Supports `AbortSignal` for preempt; returns `cancelled: true` → scheduler skips debit.
- `kind: "stub"` remains a no-op for backward-compatible callers.
- Tests mock HTTP; live Groq optional.

---

## Not in scope

- Spec / golden vector mutations
- `contracts/` changes (WP-025 / WP-050)
- Persisting cognition jobs to Supabase
- Changing Energy cost amounts (WP-074)
- Public broadcast of Energy / CoT / provider latency
