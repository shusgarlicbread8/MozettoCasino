# WP-122 — Play / Find Match

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-122, WP-120 design system, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Play / Find Match UI (Texas HU + Classic) | `apps/web/src/components/ArenaFindMatch.tsx` |
| Routes | `/poker`, `/poker/classic` |
| WP-120 primitives | `Button`, `LeagueChip`, design tokens |
| Journey strip | Game → League → Profile → Tune → Find Match |
| Match phases | idle / searching / sealing / seating / error |
| `profileConfigHash` at queue | API waiting/match responses + UI lock banner |
| This note | `docs/WP-122_PLAY_FIND_MATCH.md` |

No `/specs` mutations. No protocol field inventions.

---

## Goal

Consumer Play flow: select Hold'em league (Bronze→Platinum stakes), choose AI profile (preset here; trait tuning links to WP-123 `/my-ai`), Find Match with clear searching/sealing status. Lock `profileConfigHash` when the seat ticket enters the matchmaking queue.

---

## Product journey

```text
Play (/poker)
→ choose game (Texas HU or Classic 6-max)
→ choose league / buy-in (Bronze → Platinum)
→ choose AI profile preset (Shark / Fox / Professor / Machine)
→ optional Tune → /my-ai (WP-123)
→ Find Match
→ searching → sealing (on-chain) → seating → /table/:id
```

Players do **not** pick opponents or public ranked tables (WP-040 / Plan 04).

---

## APIs

| Action | Endpoint |
|---|---|
| Lobby leagues | `GET /v1/arena` · `GET /v1/arena/classic` |
| Find Match | `POST /v1/arena/find-match` · `POST /v1/arena/classic/find-match` |
| Body | `{ leagueId, profileKey }` |
| Seamless status | `GET /v1/arena/play-status` |

### Queue lock

On-chain Find Match mints/reuses a SeatTicket whose `agent_profile_hash` is the published preset hash (`getAgentProfileHash` → SeatTicket V3 `profileConfigHash`). While `status: "waiting"`, the API returns:

- `profileConfigHash` — locked hash from the queued ticket (authoritative)
- `profileKey` — requested preset key
- `ticketId` — queue row id

Changing the UI preset mid-search does **not** rewrite an existing queued ticket.

Demo mode persists the active agent config and returns the published preset hash for display; there is no on-chain ticket.

---

## UI states

| Phase | Meaning |
|---|---|
| idle | Ready to queue |
| searching | Waiting for opponent / open seat |
| sealing | Match found — on-chain open / seal in progress |
| seating | Redirecting to `/table/:id` |
| error | Funds, seamless play, or API failure |

Loading and error surfaces are explicit (status line, phase chips, `role="alert"`).

---

## Out of scope

- Full trait sliders / behavioral preview (WP-123)
- Wallet / ArenaAccount onboarding polish (WP-124)
- Live table premium polish (WP-125+)
- Spec / protocol mutations

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
pnpm --filter @mozetto/api typecheck
```

---

## Completion template

```
Work packet: WP-122
Status: DONE
Artifacts:
- apps/web/src/components/ArenaFindMatch.tsx
- apps/web/src/app/(app)/poker/page.tsx
- apps/web/src/app/(app)/poker/classic/page.tsx
- services/api/src/index.ts (profileConfigHash on find-match)
- services/api/src/arena-onchain.ts (waiting response hash)
- docs/WP-122_PLAY_FIND_MATCH.md
Commands:
- pnpm --filter @mozetto/web typecheck
- pnpm --filter @mozetto/api typecheck
Spec clauses: Plan 20A Find Match overlay; WP-120 IA; no /specs mutations
Follow-up: WP-123 Strategy setup; WP-124 Wallet onboarding
```
