# WP-131 — Mobile / performance

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-131, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Bottom tab bar (primary IA) | `apps/web/src/components/MobileTabBar.tsx` |
| Desktop sidebar hide ≤900px | `Nav.tsx` + `globals.css` (`.mz-desktop-nav`) |
| Compact topbar / touch targets | `Topbar.tsx`, `Button.tsx`, `.mz-touch` / `.mz-btn` |
| Responsive Home / Play / Wallet | `mz-page`, `mz-play-grid`, league/profile grids |
| Table stack + collapsible status | `mz-table-layout`, `TableSideRail` `<details>`, seat scale |
| Lazy-load live table client | `table/[tableId]/page.tsx` → dynamic `TableClient` + `JoinTableSheet` |
| Breakpoint token | `design-tokens.ts` `breakpoint.mobileMax` (900) |
| This note | `docs/WP-131_MOBILE_PERFORMANCE.md` |

No `/specs` mutations. No protocol field inventions.

---

## Goal

True mobile play/watch flow: one-handed Find Match, readable balances, table prioritizing board/pot/actions, Energy/status collapsible, and performance hygiene so Home/Play/Wallet first paint does not pull the heavy table bundle.

---

## Layout rules (≤900px)

1. **Shell** — Sidebar off; fixed bottom tabs (Home · Play · AI · Wallet · Ranks · Watch). Tabs hidden on `/table/*` so felt owns the viewport. Safe-area padding under tabs.
2. **Topbar** — Tagline, account chip, Sign out, and Play Now CTA hidden; LIVE + Available/Locked + notifications remain.
3. **Pages** — `mz-page` tightens padding; Play grids stack to one column; leagues 2×2.
4. **Table** — Felt above, rail below (`mz-table-layout`); seat chips scaled; meta line condensed; action bar wraps; cognition note starts collapsed (tap summary to expand). Fairness toggle unchanged (WP-128).

---

## Performance notes

| Practice | Why |
|---|---|
| Route-level `dynamic()` for `TableClient` (`ssr: false`) | Home/Play/Wallet navigation does not download felt/WS/join UI until `/table/:id` |
| `JoinTableSheet` dynamic inside table client | Join overlay code splits from seated view |
| CSS-first breakpoints | No JS media-query flash on shell chrome |
| Reduced motion already in `globals.css` | Plan 20A mobile + reduced-motion path |

**Not in this packet:** Removing root `Web3Provider` / framer-motion from AppShell (larger split; follow-up if Lighthouse budget tightens). Plan 20B 3D quality tiers remain deferred.

---

## Out of scope

- Spec / protocol mutations  
- Plan 20B cinematic 3D / mobile quality tiers for avatars  
- Full Lighthouse CI gate  
- Rewriting Watch/Rankings visual language (WP-129/130)

---

## Follow-up

- WP-125/126 table polish can keep using `mz-table-*` classes  
- Optional: code-split `PageFade` / `SplitFlapNumber` (framer-motion) from first paint  
- Optional: viewport Lighthouse budget in CI after Anvil RC  
