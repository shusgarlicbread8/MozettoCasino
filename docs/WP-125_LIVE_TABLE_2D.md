# WP-125 — Live table 2D premium

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-125, WP-120 design system, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Premium felt (board / pot / stacks / seats / clock / action FX) | `apps/web/src/components/table/LiveTableFelt.tsx` |
| Side rail (public action log + cognition hook + trust) | `apps/web/src/components/table/TableSideRail.tsx` |
| Table WS feed (legacy + v2 dual-accept) | `apps/web/src/lib/table/use-table-feed.ts`, `ws-client.ts` |
| Cards / action format / cognition placeholders | `apps/web/src/lib/table/{cards,format,cognition,types}.ts` |
| Owner / seated table | `/table/[tableId]` → `TableClient.tsx` (lazy via WP-131) |
| Spectator table | `/live/[tableId]` (same felt, `role: "spectator"`) |
| Watch lobby (real tables) | `/live` via `lib/watch.ts` |
| This note | `docs/WP-125_LIVE_TABLE_2D.md` |

No `/specs` mutations. No protocol field inventions. Opponent hole cards never rendered (backs until legal showdown reveal).

---

## Goal

Rebuild the live table as **premium animated autonomous poker** on WP-120 tokens — not a crypto debug view. Wire real game-server WS; animate public actions; leave cognition presentation hooks for WP-126 (no CoT).

---

## Public information (shown)

- Community board (flop / turn / river) with deal animation
- Pot + street + action clock
- Stacks, bets, dealer button, seat occupancy
- Public actions (FOLD / CHECK / CALL / BET / RAISE / ALL-IN) with seat bubbles + action log
- Showdown / fold-win overlays when the engine reveals them
- Trust badge → Verify (WP-128) when `onchain_session_id` exists

## Owner information

- Own hole cards (owner view only)
- Own legal actions when seated and to act
- Public-safe cognition phase derived from clock (`observing` / `analysing` / `decision_ready` / `acting`) — **placeholder until WP-126 frames**
- Owner Energy % only if `energy_summary` arrives (WP-126); opponents never get Energy details

## Never shown

- Opponent hole cards (until showdown / runout reveal)
- Chain-of-thought / free-text reasoning
- Private AgentState / opponent Energy
- Coaching note editors that invite CoT

---

## WebSocket

| Direction | Behavior |
|---|---|
| Client send | Prefers v2 aliases (`auth_v2`, `subscribe_table_v2`, `player_action_v2`) — server dual-accepts (WP-110) |
| Client recv | Normalizes `hello_v2` / `snapshot_v2` / `canonical_event_v1` / `error_v2` / `energy_summary_v1` → legacy handlers |
| Roles | `player` on `/table/:id`; `spectator` on `/live/:id` (hole cards forced empty) |
| REST seed | `GET /v1/tables/:id` before WS snapshot |

Events driving animation: `PLAYER_ACTED`, `STREET_DEALT`, `SHOWDOWN_REVEALED`, `HAND_SETTLED`, `ACTION_CLOCK`, etc. (existing engine event types — no new encodings).

---

## WP-126 coordination

`lib/table/cognition.ts` + rail `data-cognition-phase` expose presentation phases without private reasoning. When WP-126 emits `energy_summary_v1` / public cadence frames, map them in `useTableFeed` → `ownerEnergyPct` / seat labels. Until then, phases are derived from acting seat + clock only.

---

## Out of scope

- Spec / protocol mutations
- Plan 20B cinematic 3D art (WP-132 adapter may consume `avatarState` on action FX)
- Full cognition Energy UI (WP-126)
- Ranked spectator delay enforcement server-side (WP-129 residual — see `docs/WP-129_WATCH_SPECTATOR.md`)

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
```

---

## Completion template

```
Work packet: WP-125
Status: DONE
Artifacts:
- apps/web/src/components/table/LiveTableFelt.tsx
- apps/web/src/components/table/TableSideRail.tsx
- apps/web/src/lib/table/*
- apps/web/src/app/(app)/table/[tableId]/TableClient.tsx
- apps/web/src/app/(app)/live/[tableId]/page.tsx
- apps/web/src/app/(app)/live/page.tsx
- docs/WP-125_LIVE_TABLE_2D.md
Commands:
- pnpm --filter @mozetto/web typecheck
Spec clauses: Plan 20A Live table public/owner/opponent info rules; WP-120 tokens; WP-110 WS dual-accept; no /specs mutations
Follow-up: WP-126 cognition frames; WP-129 delay enforcement; WP-132 3D adapter
```
