# WP-120 — Product IA / design system

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-120, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| CSS design tokens + atmosphere | `apps/web/src/app/globals.css` |
| Typed token mirror + nav IA | `apps/web/src/lib/design-tokens.ts` |
| Typography (Syne / DM Sans / IBM Plex Mono) | `apps/web/src/app/layout.tsx` |
| App shell atmosphere | `apps/web/src/components/AppShell.tsx` |
| Primary / secondary nav IA | `apps/web/src/components/Nav.tsx` |
| Slimmer topbar (play + balances) | `apps/web/src/components/Topbar.tsx` |
| Primitives: Button, LeagueChip, BrandMark | `apps/web/src/components/ui/` |
| Brand-first landing first viewport | `apps/web/src/app/page.tsx` |
| Marketing data aligned to tokens | `apps/web/src/lib/design-data.ts` |
| This note | `docs/WP-120_PRODUCT_IA_DESIGN.md` |

No `/specs` mutations. No protocol field inventions. Verify routes (`/verify/**`) unchanged in structure and API contracts (WP-090).

---

## Goal

Establish consumer product information architecture and a mass-market visual language so Mozetto reads as **competitive autonomous AI poker**, not a crypto trading dashboard. Foundation for WP-121–132.

---

## Navigation IA

### Primary (Play group)

| Label | Route | Role |
|---|---|---|
| Home | `/home` | Hub — Play Now first (WP-121 owns content) |
| Play | `/poker` | Find Match / league entry |
| AI / Strategy | `/my-ai` | Profiles + tuning (WP-123) |
| Wallet | `/wallet` | ArenaAccount balances / custody story |
| Rankings | `/rankings` | Competitive ladder / profile |
| Watch | `/live` | Spectator / featured tables |

Primary CTA everywhere: **Play Now** → `/poker`.

### Secondary (More)

| Label | Route | Role |
|---|---|---|
| Verify | `/verify` | Deep trust / WP-090 Verify Game |
| Replays | `/replays` | Hand / session replay |
| Settings | `/settings` | Account prefs |

Casino / Shop / Tournaments remain reachable by URL where implemented but are **not** primary nav (avoid marketplace-first IA).

---

## Visual language

**Direction:** night felt — deep ink greens, felt midtones, lime accent, warm league metals. Expressive display type (Syne), readable UI sans (DM Sans), tabular mono (IBM Plex Mono).

**Not:** purple-on-white SaaS, cream/terracotta editorial, broadsheet density, neon crypto ticker walls, card-stacked heroes.

### Token groups (`:root` / `design-tokens.ts`)

- Surfaces: `--mz-ink`, `--mz-ink-elevated`, `--mz-ink-panel`, `--mz-felt*`
- Accent: `--mz-accent` (`#3DDC8A`)
- Text / lines / status
- League colors (Bronze → Sovereign)
- Profile colors (Shark / Fox / Professor / Machine) — for WP-123

Legacy aliases `--bg`, `--panel`, `--accent`, `--text` map to the new tokens so older inline pages degrade gracefully.

---

## Shared primitives

Lean set for Home / Play:

- `Button` — primary / secondary / ghost / danger
- `LeagueChip` — league identity chip
- `BrandMark` — logo + wordmark (hero-scale supported)

---

## Landing first viewport

Composition: **Mozetto** (hero brand) → one headline → one supporting line → Play Now / Watch live → full-bleed felt atmosphere (CSS, not 3D production art). No stat strips, contract fields, or card grids in the first viewport.

---

## Out of scope

- Spec / protocol mutations
- Plan 20B cinematic 3D art
- Full Home content rewrite (WP-121)
- Find Match overlay completeness (WP-122)
- Strategy sliders (WP-123 — see `docs/WP-123_STRATEGY_SETUP.md`)
- Live table premium polish (WP-125+)

---

## Follow-up

- **WP-121** Home — Play Now first with real bankroll / session / leagues
- **WP-122** Play / Find Match overlay using Button + LeagueChip
- **WP-128** in-session trust badge → Verify (keep WP-090 deep page) — DONE (`docs/WP-128_VERIFY_UX.md`)
- Migrate remaining `#00E676` / Geist references on app pages onto tokens as those packets land
