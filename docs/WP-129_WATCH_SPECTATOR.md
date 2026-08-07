# WP-129 — Watch / spectator

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A Spectator mode), Plan `07` spectator-delayed channel, packet `16_AGENT_WORK_PACKETS.md` WP-129, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`  
**Date:** 2026-08-07  
**Status:** DONE (including server delay residual)

---

## Delivered

| Item | Location |
|---|---|
| Watch lobby (honest session list) | `apps/web/src/app/(app)/live/page.tsx` |
| Spectator table view | `apps/web/src/app/(app)/live/[tableId]/page.tsx` |
| Watch helpers + delay copy | `apps/web/src/lib/watch.ts` |
| Server spectator delay buffer | `services/game-server/src/spectator-delay.ts` + `table-runtime.ts` |
| Env flag | `SPECTATOR_DELAY_MS` (default `90000`) in `.env.example` |
| Deterministic harness | `services/game-server/src/spectator-delay.test.ts` |
| This note | `docs/WP-129_WATCH_SPECTATOR.md` |

No `/specs` mutations. No protocol field inventions. No hole-card leaks on spectator surfaces.

---

## Goal

Delayed ranked viewing and featured matches — real public sessions after allocation, not a mock “HOT pot” casino strip with invented viewers. Fairness: spectator WS must not leak live hole-card timing edges.

---

## Product rules

- **Featured** = tables that already have seats filled (allocated), not joinable opponent picks.
- **Delay policy** ~90 seconds behind live play (Plan 20 / Plan 07), enforced on game-server for `role: "spectator"`.
- **Privacy:** public board, pot, street, stacks, public actions only. Hole cards shown only after legal reveal / showdown (and still delayed). No private AI / CoT.
- **Honest empty:** when no occupied public tables exist, say so and point to Find Match / Play Now.

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Session list | `GET /v1/tables?variant=nlhe_hu` + `nlhe_6max` | “Nothing to watch” / “No featured matches” |
| League occupancy | `GET /v1/arena` · `GET /v1/arena/classic` | Hidden when all zeros |
| Table meta + seats | `GET /v1/tables/:id` | Name falls back to table id |
| Live public feed | Game WS `subscribe_table` `role: "spectator"` via delayed buffer + WP-125 felt | Connecting… / waiting for delay fill |
| Verify deep-link | `onchain_session_id` when present → `/verify/:sessionId` | Ghost Verify → `/verify` |

Client filters: seated ≥ 1; omit non-`public` when `privacy` is present. Featured requires seated ≥ 2.

---

## Server delay enforcement (WP-129 residual)

| Concern | Behavior |
|---|---|
| Env | `SPECTATOR_DELAY_MS` — default `90000`; `0` disables delay (debug only) |
| Channel | In-process buffer approximating Plan 07 `table:<id>:spectator-delayed` |
| Players / owners | Unaffected — immediate `event` / `snapshot` / `private_state` / `ai_cognition` |
| Spectators | Public `event` + public `snapshot` enqueued; flushed after delay |
| Subscribe | Never sends live tip; optional `spectator_delay` status frame; catch-up = latest **due** snapshot only |
| Hole cards | `owner_private` (`HOLE_CARDS_PRIVATE`) never enqueued; `private_state` requires `role: "player"`; spectator view forces `holeCards: []` |
| `replay_from` | Rejected while subscribed as spectator (`spectator_replay_forbidden`) |

On subscribe, clients receive:

```json
{ "type": "spectator_delay", "workPacket": "WP-129", "delayMs": 90000, "channel": "table:<id>:spectator-delayed" }
```

Then, once the buffer has aged past the delay, delayed `snapshot` / `event` frames.

---

## Honest bypass / residual surfaces

These are **not** covered by the WS delay buffer (document for fairness reviews):

| Surface | Risk | Notes |
|---|---|---|
| `GET /v1/tables/:id` (game-server / API) | Live public board, pot, street, stacks | Lobby/meta; no hole cards |
| API public list endpoints | Live seated / blinds metadata | No hole cards |
| Legal showdown / all-in `runoutRevealed` | Hole cards after legal reveal | Still delayed on spectator WS |
| Client clock / UI copy | Informational only | Enforcement is server-side |

Players connecting with `role: "player"` and a seated identity still receive immediate private views (correct).

---

## Out of scope

- Spec / protocol mutations
- Separate Redis/Supabase `spectator-delayed` fan-out topic (in-process buffer is the Season 1 enforcement)
- Live table premium polish (WP-125)
- Fake viewer counts / prize pools

---

## Commands / evidence

```bash
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/game-server typecheck
pnpm --filter @mozetto/web typecheck
```

---

## Completion template

```
Work packet: WP-129 (server delay residual)
Status: DONE
Artifacts:
- services/game-server/src/spectator-delay.ts
- services/game-server/src/spectator-delay.test.ts
- services/game-server/src/table-runtime.ts (spectator buffer wiring)
- services/game-server/src/index.ts (spectator replay gate)
- .env.example (SPECTATOR_DELAY_MS)
- docs/WP-129_WATCH_SPECTATOR.md
Commands:
- pnpm --filter @mozetto/game-server test
- pnpm --filter @mozetto/game-server typecheck
Spec clauses: Plan 07 spectator-delayed; Plan 20A Spectator mode; no /specs mutations; no hole-card leaks on spectator channel
Follow-up: optional delay on HTTP public table tip; WP-125 felt polish; WP-131 mobile watch flow
```
