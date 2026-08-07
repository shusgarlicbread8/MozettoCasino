# WP-126 — AI cognition presentation

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-126, WP-120 design system, WP-125 live table  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Public phase mapping (no CoT) | `services/agent-runtime/src/live/public-cognition.ts` |
| Observe → per-seat public status | `services/agent-runtime/src/live/session-manager.ts` |
| HTTP snapshot | `GET /v1/public-cognition/:sessionId/:handId/:seat` |
| Owner WS frames | `ai_cognition` / `ai_cognition_v1` from game-server |
| Game-server decide path phases | `services/game-server/src/table-runtime.ts` |
| Energy bar + state machine UI | `apps/web/src/components/cognition/` |
| Types + parse / infer helpers | `apps/web/src/lib/ai-cognition.ts` |
| Table feed wiring | `apps/web/src/lib/table/use-table-feed.ts` |
| WP-125 rail integration | `TableSideRail` + `TableClient` |
| This note | `docs/WP-126_AI_COGNITION_UI.md` |

No `/specs` mutations. No protocol field inventions. Never exposes chain-of-thought or private AgentState.

---

## Goal

Show the owner's AI **Energy** and public cognition states during live play:

```text
OBSERVING
ANALYSING
UPDATING OPPONENT MODEL
DECISION READY
ACTING
```

Driven by real cognition / cadence / Energy signals when available. Honest fallback from public table events when signals are missing. Opponent Energy and private reasoning stay hidden.

---

## Signal sources (honest labeling)

| Source | Meaning |
|---|---|
| `cognition` | agent-runtime observe/act mapped phase + ledger Energy |
| `cadence` | Public cadence wait / ACTION_CLOCK path |
| `energy` | Hand-begin grant or Energy ledger snapshot |
| `inferred` | Derived from public `ACTION_CLOCK` / `PLAYER_ACTED` only |
| `unavailable` | No signal yet — Energy bar shows "—" |

UI never invents a CoT narrative. When Energy is unknown, the meter shows unavailable rather than a fake number.

---

## Wire path

```text
Public table event
  → game-server notifyAgentRuntimeObserve
  → agent-runtime /v1/observe (scheduler mode + Energy)
  → owner-only WS `ai_cognition` { phase, energyRemaining, signalSource }

AI seat to-act
  → ANALYSING (cadence) → /v1/act → DECISION_READY (Energy) → ACTING (cadence wait) → OBSERVING
```

Owner-only delivery: `TableRuntime.sendOwnerAiCognition` sends frames only to clients whose `userId` owns the seat (or bound `seatIndex`).

---

## UI surfaces

- **Energy bar** — Season 1 100 Energy / hand; low threshold tint; unavailable hatch
- **State machine** — five public phases with live pulse on ANALYSING / UPDATING / ACTING
- **Table rail** — collapsible WP-125 status section hosts `AiCognitionPanel`
- **Felt seats** — owner Energy % chip when frames present; opponents never get Energy

---

## Acceptance evidence

- `pnpm --filter @mozetto/agent-runtime test` — includes WP-126 mapping tests
- `pnpm --filter @mozetto/agent-runtime typecheck`
- Owner WS frames contain only public fields (`phase`, `energyRemaining`, `signalSource`, …)
- Table rail renders phases without CoT / opponent Energy

---

## Out of scope

- Spec / golden vector mutations
- Exposing provider latency as a tell
- Opponent Energy or private AgentState
- Plan 20B 3D avatar animation (WP-132)

---

## Follow-up

- WP-125 polish for felt chip timing
- WP-127 result / replay Energy summary (analysis view)
- WP-129 spectator must not receive owner `ai_cognition` frames
