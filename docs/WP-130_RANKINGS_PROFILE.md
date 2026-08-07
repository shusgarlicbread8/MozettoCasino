# WP-130 — Rankings / profile

**Authority:** Plan `20_PRODUCT_UI_AND_3D_PRESENTATION_PLAN.md` (Plan 20A), Plan `12_RATINGS_ANTI_CHEAT_AND_COLLUSION.md`, packet `16_AGENT_WORK_PACKETS.md` WP-130, design system `docs/WP-120_PRODUCT_IA_DESIGN.md`, PROGRESS Wave 12  
**Date:** 2026-08-07  
**Status:** DONE

---

## Delivered

| Item | Location |
|---|---|
| Rankings ladder (consumer) | `apps/web/src/app/(app)/rankings/page.tsx` |
| Public profile | `apps/web/src/app/(app)/profile/[handle]/page.tsx` |
| WP-120 tokens + `Button` / `LeagueChip` | same |
| This note | `docs/WP-130_RANKINGS_PROFILE.md` |

No `/specs` mutations. No protocol field inventions. No hardcoded rankings fallback.

---

## Goal

Consumer rankings + profile surfaces that answer:

1. **Who is ranked?** — live Glicko-2 ladder per format pool  
2. **What is my rating?** — user-owned Arena Rating (agents = loadouts)  
3. **How do I play?** — descriptive aggression (never feeds rating)  
4. **How am I doing?** — W/L record + bankroll results  

Feel = competitive autonomous gaming, not a crypto dashboard.

---

## Product rules (Plan 12)

- Rating belongs to the **user account**; agents/profiles are loadouts.  
- Creating or deleting an agent never resets rating.  
- Aggression is descriptive only — never an input to Arena Rating.  
- Production never falls back to hardcoded mock leaderboards.

---

## Layout

### `/rankings`

1. Header — ladder pitch + **My profile** / **Play ranked**  
2. Pool tabs — Texas Hold'em HU · Poker Classic · Omaha HU · House (unrated empty)  
3. Live table — Rank · Player · Loadout · Record · Hands · Rating  
4. Footnote — league buy-ins vs Arena Rating vs aggression/bankroll  

### `/profile/:handle`

1. Hero — identity, league chip, loadout, provisional/established, CTAs  
2. Stat strip — HU rating · Record · Win rate · Aggression · Bankroll · Hands  
3. Main — Arena Rating history (real samples only) · Recent matches/sessions · Loadouts  
4. Side — Bankroll results · Format ratings · Play style · Head-to-head  

Fake sine-wave rating charts removed; empty history until settled rated matches exist.

---

## Data wiring

| Surface | Source | Empty / loading |
|---|---|---|
| Ladder rows | `GET /v1/rankings?pool=` | Empty copy + Find Match; no mocks |
| Profile core | `GET /v1/profiles/:handle` | 404 / error state |
| Style note | `GET /v1/profiles/:id/style-metrics` | Optional; aggression already on profile |
| My profile CTA | `/v1/me` session handle | Hidden when signed out |
| Bankroll | `arena.profit`, else session stack − buy-in | `$0` / empty sessions |

### Ranking pools

| Tab | `pool` query |
|---|---|
| Texas Hold'em HU | `hu_holdem_standard` |
| Poker Classic | `nlhe_6max_standard` |
| Omaha HU | `hu_omaha_standard` |
| House games | none (unrated) |

Alias: `GET /v1/ratings/leaderboard` → same rankings payload (Plan 19).

---

## Out of scope

- Spec / protocol mutations  
- Six-max rating math beyond existing pool rows (Plan 12 deferral)  
- Mobile / performance polish (WP-131)  
- Wallet custody rewrite (WP-124)  
- Trophy / achievement system productization  

---

## Follow-up

- WP-131 Mobile / performance for ladder + profile density  
- Populate Classic / Omaha ladders as those pools settle rated matches  
- Home performance card already deep-links here (WP-121)  
