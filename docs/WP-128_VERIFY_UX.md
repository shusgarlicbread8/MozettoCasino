# WP-128 — Verify UX

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A Verification UX), packet `16_AGENT_WORK_PACKETS.md` WP-128, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`, deep page WP-090  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Trust helpers (pills / BASE checklist / phase) | `apps/web/src/lib/verify/trust.ts` |
| In-session trust badge (expand → BASE VERIFIED) | `apps/web/src/components/verify/SessionTrustBadge.tsx` |
| Post-settlement ✓ GAME VERIFIED link | `apps/web/src/components/verify/GameVerifiedBadge.tsx` |
| Table header + rail wiring | `apps/web/src/app/(app)/table/[tableId]/page.tsx`, `TableSideRail.tsx` |
| Result / replay chip (`variant="result"`) | `MatchResultPanel`, `replays/[handId]` |
| `onchain_session_id` on table GET (read-only join) | `services/api/src/index.ts` |
| This note | `docs/WP-128_VERIFY_UX.md` |

No `/specs` mutations. No protocol field inventions. WP-090 `/verify/[sessionId]` contracts unchanged.

---

## Goal

During play, show elegant trust signals — **Funds secured / Players sealed / Cards committed** — that expand into **BASE VERIFIED** details. After public settlement verification, surface **✓ GAME VERIFIED** linking to the existing deep Verify Game page.

Avoid a generic “provably fair” green badge when components are still pending.

---

## Product states

```text
In play
  TRUST / BASE VERIFIED chip
  → Funds secured · Players sealed · Cards committed
  → expand: Funds locked on Base, Players sealed, VRF, Deck committed,
            Events anchored, Settlement pending/confirmed
  → Open Verify Game → /verify/{sessionId}

After public verify reports VERIFIED*
  ✓ GAME VERIFIED → /verify/{sessionId}
```

Hand-win overlays deep-link **VERIFY MATCH →** when a session id is known; they do **not** claim GAME VERIFIED until the public verify package says so.

---

## Data wiring

| Input | Source |
|---|---|
| `sessionId` | `GET /v1/tables/:id` → `table.onchain_session_id` (latest `onchain_sessions` row for table) |
| Component / result status | Existing `GET /v1/verify/session/:sessionId` (WP-090) |
| Deep link | `/verify/[sessionId]` (unchanged) |

When verify feed is unavailable, pills render as **pending** (honest incomplete — never fake-ok).

---

## Design

WP-120 tokens (`color`, `font`, `radius`): night-felt ink panels, accent lime for ok, warn amber for pending, danger for failed. Compact header chip + rail panel variant. Expand panel uses existing `ar-up` motion.

---

## Out of scope

- Spec / protocol mutations
- Changes to WP-090 Verify Game page layout or public API categories
- Full result / rematch surface (WP-127)
- Plan 20B 3D

---

## Commands / evidence

```bash
pnpm --filter @mozetto/web typecheck
pnpm --filter @mozetto/api typecheck
```

---

## Completion template

```
Work packet: WP-128
Status: DONE
Artifacts:
- apps/web/src/lib/verify/trust.ts
- apps/web/src/components/verify/SessionTrustBadge.tsx
- apps/web/src/components/verify/GameVerifiedBadge.tsx
- apps/web/src/app/(app)/table/[tableId]/page.tsx
- services/api/src/index.ts (onchain_session_id on table GET)
- docs/WP-128_VERIFY_UX.md
Commands:
- pnpm --filter @mozetto/web typecheck
Spec clauses: Plan 20A Verification UX; WP-120 IA; WP-090 deep link; no /specs mutations
Follow-up: WP-127 Result / replay can reuse GameVerifiedBadge
```
