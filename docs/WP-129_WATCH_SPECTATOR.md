# WP-129 — Watch / spectator

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A Spectator mode), Plan `07` spectator-delayed channel, packet `16_AGENT_WORK_PACKETS.md` WP-129, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Watch lobby (honest session list) | `apps/web/src/app/(app)/live/page.tsx` |
| Spectator table view | `apps/web/src/app/(app)/live/[tableId]/page.tsx` |
| Watch helpers + delay copy | `apps/web/src/lib/watch.ts` |
| This note | `docs/WP-129_WATCH_SPECTATOR.md` |

No `/specs` mutations. No protocol field inventions. No hole-card leaks on spectator surfaces.

---

## Goal

Delayed ranked viewing and featured matches — real public sessions after allocation, not a mock “HOT pot” casino strip with invented viewers.

---

## Product rules

- **Featured** = tables that already have seats filled (allocated), not joinable opponent picks.
- **Delay policy** noted on lobby + table: ~90 seconds behind live play (Plan 20 / Plan 07).
- **Privacy:** public board, pot, street, stacks, public actions only. Hole cards shown only after legal reveal / showdown. No private AI / CoT.
- **Honest empty:** when no occupied public tables exist, say so and point to Find Match / Play Now.

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Session list | `GET /v1/tables?variant=nlhe_hu` + `nlhe_6max` | “Nothing to watch” / “No featured matches” |
| League occupancy | `GET /v1/arena` · `GET /v1/arena/classic` | Hidden when all zeros |
| Table meta + seats | `GET /v1/tables/:id` | Name falls back to table id |
| Live public feed | Game WS `subscribe_table` `role: "spectator"` via `useTableFeed` + WP-125 felt (ignores `holeCards`) | Connecting… / waiting |
| Verify deep-link | `onchain_session_id` when present → `/verify/:sessionId` | Ghost Verify → `/verify` |

Client filters: seated ≥ 1; omit non-`public` when `privacy` is present. Featured requires seated ≥ 2.

---

## Delay policy (honest)

Product copy states ~90s ranked delay. Plan 07 defines `table:<id>:spectator-delayed`. The game-server delay buffer is not yet a separate delayed channel in this packet; the spectator UI **never** renders private hole cards or CoT (`useTableFeed` strips `holeCards` when `role: "spectator"`).

---

## Out of scope

- Spec / protocol mutations
- Server-side delay-buffer implementation (follow-up on Plan 07 channel)
- Live table premium polish (WP-125)
- AI cognition owner surfaces (WP-126)
- Fake viewer counts / prize pools

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
```

---

## Completion template

```
Work packet: WP-129
Status: DONE
Artifacts:
- apps/web/src/app/(app)/live/page.tsx
- apps/web/src/app/(app)/live/[tableId]/page.tsx
- apps/web/src/lib/watch.ts
- apps/web/src/lib/table/types.ts (onchain_session_id)
- docs/WP-129_WATCH_SPECTATOR.md
Commands:
- pnpm --filter @mozetto/web typecheck
Spec clauses: Plan 20A Spectator mode; WP-120 IA; Plan 07 delay policy noted; no /specs mutations; no hole-card leaks
Follow-up: server spectator-delayed buffer; WP-125 live table polish; WP-131 mobile watch flow
```
