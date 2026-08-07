# WP-075 — Public cadence controller

**Authority:** Plan 09 (`Public timing versus provider latency`), WP-075 in `16_AGENT_WORK_PACKETS.md`  
**Specs (frozen):** `specs/MOZETTO_CONTROLLER_V1.md` §6 (`publicCadenceMs`)  
**Prior:** WP-070/076 Groq + fallback; WP-074 Energy ledger  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Season 1 bounds + clamp / deadline fit | `services/agent-runtime/src/cadence/bounds.ts` |
| Schedule / wait / Decision helper | `services/agent-runtime/src/cadence/controller.ts` |
| Types | `services/agent-runtime/src/cadence/types.ts` |
| Unit tests (clamp, delay vs decide latency) | `services/agent-runtime/src/cadence/cadence.test.ts` |
| Export | `@mozetto/agent-runtime/cadence` |

---

## Product rules

- Separate **private** `providerCompletionMs` (decide / Groq RTT) from **public** `publicCadenceMs` (strategic table-clock delay).
- Raw provider completion time **MUST NOT** be copied into `publicCadenceMs` or otherwise exposed as a public tell.
- The action may be ready early; the runtime **MAY** wait so the visible commit aligns with the clamped strategic cadence.
- If decide latency already meets or exceeds the strategic cadence, **commit immediately** (`waitMs = 0`) — do not invent extra delay past the request.
- Scheduled wait **MUST** fit the remaining action deadline minus a commit safety pad.
- Scope is **final / public action** cadence only — **no** continuous cognition scheduler loops (WP-073).

---

## Season 1 timing defaults (hypotheses)

Exact timing knobs are **Season 1 initial defaults / hypotheses**, not proven optima. Recalibrate only via a new cadence-policy / season label (`public-cadence-season1-v1`) — never silent mutation of an active season.

| Knob | Value | Notes |
|---|---:|---|
| `PUBLIC_CADENCE_MIN_MS` | `0` | Schema-aligned floor; may rise later to hide sub-RTT tells |
| `PUBLIC_CADENCE_MAX_MS` | `15_000` | Matches ControllerResponse schema max |
| `SEASON1_ACTION_DEADLINE_MS` | `15_000` | Locked final-action clock (Plan 09 / decision #9) |
| `SEASON1_COMMIT_SAFETY_MS` | `250` | Last-mile pad before hard deadline |
| `SEASON1_CADENCE_SOFT_MAX_MS` | `12_000` | Soft guidance only (Plan 09 cadence window) |

Profile tempo (Shark faster / Professor longer / Fox varied / Machine stable) influences the **model’s requested** `publicCadenceMs`; this controller only clamps and schedules.

---

## Call surface

```text
clampPublicCadenceMs(requested)     → [min, max]
fitCadenceToDeadline(cadence, rem)  → deadline-safe value
schedulePublicCadence({ requestedPublicCadenceMs, providerCompletionMs, … })
waitForPublicCadence(...)           → sleep waitMs then resolve
applyPublicCadenceToDecision(decision, opts)
new PublicCadenceController({ now, sleep }).schedule | .wait
```

Typical wire after `decide()`:

```text
providerCompletionMs = private RTT
schedule = schedulePublicCadence({ requested: decision.publicCadenceMs, providerCompletionMs, … })
decision.publicCadenceMs = schedule.publicCadenceMs   // clamped + deadline-fit
await sleep(schedule.waitMs)                          // table clock — not model RTT
broadcast / commit action
```

---

## Not in scope

- WP-073 continuous cognition / background loops / priority queue
- Spec / golden vector mutations
- Changing Energy costs (WP-074)
- UI animation of cadence (Plan 20)
- Recalibrating profile→cadence mapping inside the model prompt beyond existing master-policy wording
