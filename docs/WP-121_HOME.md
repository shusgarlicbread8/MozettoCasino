# WP-121 — Home (Play Now first)

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), packet `16_AGENT_WORK_PACKETS.md` WP-121, PROGRESS Wave 12, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Consumer home rebuild | `apps/web/src/app/(app)/home/page.tsx` |
| WP-120 tokens + `Button` / `LeagueChip` | same |
| This note | `docs/WP-121_HOME.md` |

No `/specs` mutations. No protocol field inventions.

---

## Goal

Rebuild authenticated `/home` as a mass-market hub that answers four questions first:

1. **How much can I play with?** — playable bankroll + at-tables
2. **What can I play?** — league strip with fixed buy-ins → Play / Find Match
3. **What is my AI?** — agent loadout card → `/my-ai`
4. **How am I performing?** — HU rating + today P&L (honest empty when unavailable)

Primary CTA: **Play Now** → `/poker`. Protocol / custody depth stays on Wallet & Verify.

---

## Layout

1. **Hero** — Play Now + Watch live; playable / at-tables / settling; Fund wallet when playable is low  
2. **League strip** — live `/v1/arena` leagues (`LeagueChip`, buy-in, tables/seated); Classic 6-max linked secondarily  
3. **Cards** — Your AI · Performance · Active session *or* live matches teaser  

Removed design-mock Netflix game browser, fake HOT pots/viewers, and mock tournament register.

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Playable / at tables | `useMozettoBalances` + `/v1/me` | `…` while loading |
| Settling | vault lock after leave | hidden when zero |
| Active session | `/v1/wallet` sessions | live matches teaser instead |
| Leagues + live counts | `/v1/arena` | lobby unavailable copy |
| Agent loadout | `/v1/me` agent + config | Set up your AI → `/my-ai` |
| HU rating | `/v1/profiles/:handle` arena | Unrated / play first match |
| Today P&L | `/v1/wallet/net-worth?range=1d` | `—` until ≥2 snapshots (on-chain only) |

---

## Out of scope

- Spec / protocol mutations
- Find Match overlay completeness (WP-122)
- Strategy sliders (WP-123)
- Wallet custody story rewrite (WP-124)
- Live table premium / spectator polish (WP-125+)

---

## Follow-up

- WP-122 Play / Find Match overlay  
- WP-123 Strategy setup on `/my-ai`  
- Migrate remaining legacy green/Geist app pages onto WP-120 tokens as those packets land  
