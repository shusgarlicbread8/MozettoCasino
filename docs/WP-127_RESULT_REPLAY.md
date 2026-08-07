# WP-127 — Result / replay

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-127, WP-120 design system, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Session result panel | `apps/web/src/components/result/MatchResultPanel.tsx` |
| Hand timeline | `apps/web/src/components/result/HandTimeline.tsx` |
| Trust badge (WP-128) | `SessionTrustBadge variant="result"` → `GameVerifiedBadge` when verified |
| Result route | `/result/[sessionId]` · `apps/web/src/app/(app)/result/[sessionId]/page.tsx` |
| Replay list + hand detail | `/replays`, `/replays/[handId]` |
| Leave → result | `apps/web/src/app/(app)/table/[tableId]/TableClient.tsx` |
| Sessions → result | `apps/web/src/app/(app)/sessions/page.tsx` |
| This note | `docs/WP-127_RESULT_REPLAY.md` |

No `/specs` mutations. No protocol field inventions.

---

## Goal

Post-match consumer UX after leave (or from Replays / Sessions):

1. **P&L** — stack − buy-in when a `table_sessions` row exists  
2. **Rating Δ** — last two `rating_history` points only when a `rated_matches` row links to this table  
3. **Aggression** — descriptive style metrics when hands &gt; 0 (never invents skill)  
4. **Hand timeline** — public `hand_events` / `agent_decisions` from `/v1/replays/:handId`  
5. **CTAs** — Rematch (`/poker`) · Verify · Home  

Trust chip uses WP-128 `SessionTrustBadge` with `variant="result"` (shows `GameVerifiedBadge` when public verify reports VERIFIED*) → deep `/verify/:sessionId` or `/verify/hand/:handId`.

---

## Product journey

```text
Live table → Leave
→ /result/:tableId
→ P&L / rating Δ / aggression / hand chips
→ Rematch | Verify | Home

Replays → pick hand → /replays/:handId → Match result / Verify
Sessions → Result → /result/:tableId
```

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Session / table title | `GET /v1/sessions/:id/public` + `/v1/sessions` | session id fallback |
| P&L | own `table_sessions` buy_in / stack | `—` until seat posts |
| Rated outcome | `/v1/profiles/:handle` `recentMatches` by `table_id` | “Session” label |
| Rating Δ | profile `history` when match.table_id matches | `—` if &lt;2 points or unmatched |
| Aggression | profile `aggression` when `hands &gt; 0` | `—` + style note |
| Hand list | `GET /v1/replays` filtered by `table_id` | empty timeline hint |
| Timeline | `GET /v1/replays/:handId` events → decisions fallback | honest empty copy |
| Trust badge | `GET /v1/verify/session/:id` via `fetchVerifySession` | “Verify unavailable” |

---

## Out of scope

- Spec / protocol mutations  
- Fake EV / CoT / brilliant-move mock (removed from `/replays`)  
- Live table cognition polish (WP-125 / WP-126)  
- Full WP-128 Verify UX rewrite (badge + deep page link only)

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
```

---

## Completion template

```
Work packet: WP-127
Status: DONE
Artifacts:
- apps/web/src/components/result/MatchResultPanel.tsx
- apps/web/src/components/result/HandTimeline.tsx
- apps/web/src/app/(app)/result/[sessionId]/page.tsx

- apps/web/src/app/(app)/replays/page.tsx
- apps/web/src/app/(app)/replays/[handId]/page.tsx
- apps/web/src/app/(app)/sessions/page.tsx
- apps/web/src/app/(app)/table/[tableId]/TableClient.tsx (leave → result)
- docs/WP-127_RESULT_REPLAY.md
Commands:
- pnpm --filter @mozetto/web typecheck
Spec clauses: Plan 20A result/replay; WP-120 IA; WP-128 trust badge link; no /specs mutations
Follow-up: WP-128 Verify UX depth; WP-125 live table polish
```
