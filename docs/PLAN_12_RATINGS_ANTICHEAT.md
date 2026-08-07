# Plan 12 — Ratings, Anti-Cheat, and Collusion

**Authority:** `mozetto_execution_plans/12_RATINGS_ANTI_CHEAT_AND_COLLUSION.md`  
**Related packets:** WP-040 (ranked matchmaker), WP-043 (anti-pairing / identity), settlement-worker rating hook  
**Date:** 2026-08-07

---

## Exit gate (honest status)

| Requirement | Status | Notes |
|---|---|---|
| Account owns rating; agents are loadouts | **Met** | `account_ratings` keyed by `owner_id` + `pool_id`; agents update `agent_records` only |
| Separate pools (HU ≠ six-max ≠ Open AI) | **Met (Season 1 HU)** | Pools in migration `007`; six-max pool exists but Glicko updates gated off |
| HU Glicko-2 Arena Rating | **Met** | `@mozetto/ratings` (`1500` / `RD 350` / provisional 20) |
| Stake does not scale rating | **Met** | Stake stored on `rated_matches` only; never an input to `rateHeadsUpMatch` |
| Aggression descriptive only | **Met** | `computeAggression` — Bayesian shrink + confidence labels; not fed into Glicko |
| Ranked matchmaking integrity | **Met (core)** | WP-040/043: no table pick, self/linked/pair caps, random seat order |
| Repeated-opponent policy | **Met** | Avoidance + weight bands `1 → 0.5 → 0` |
| Rating update gate | **Met (library + wire)** | `evaluateRatingUpdateGate` + `settleRatedMatch({ gate })` |
| Abuse handling states | **Met (typed FSM)** | `abuse-states.ts` — no fund seizure authority |
| Collusion / identity clustering | **Scaffold** | Explainable `assessRiskSignals` — **not** a production ML detector |
| Information controls / coaching bans | **Partial / deferred** | Season 1 master policy + private AgentState elsewhere; live coaching queue UI deferred |
| Rating-band wait expansion | **Deferred** | Documented in WP-040 |

---

## Plan → code map

| Plan 12 topic | Code |
|---|---|
| Glicko-2 / Arena Rating | `packages/ratings/src/glicko2.ts` |
| Aggression score | `packages/ratings/src/aggression.ts` |
| Pair weight bands | `packages/ratings/src/pairing.ts` → `pairRatingWeight` in `ranked-matchmaker.ts` |
| Rating update gate | `packages/ratings/src/rating-update-gate.ts` |
| Abuse states | `packages/ratings/src/abuse-states.ts` |
| Risk / collusion *signals* (non-ML) | `packages/ratings/src/risk-signals.ts` |
| Persist / settle | `packages/database/src/ratings.ts` (`settleRatedMatch`, `repeatedOpponentWeight`) |
| Ranked integrity | `packages/database/src/ranked-matchmaker.ts`, `linked-accounts.ts` |
| On-chain post-settle rating | `services/settlement-worker/src/rating.ts` |
| Demo HU session-end rating | `services/game-server/src/table-runtime.ts` (`maybeSettleHeadsUpMatch`) |
| Schema | `packages/database/migrations/007_account_glicko_ratings.sql` |

---

## Rating owner & pools

- **Owner:** user account (`profiles.id`). Creating/deleting an agent never resets `account_ratings`.
- **Season 1 rated pool:** `hu_holdem_standard` (label: Arena Rating / Texas Hold’em).
- **Six-max:** `nlhe_6max_standard` remains for BB/100-style stats surfaces; `evaluateRatingUpdateGate` returns `sixmax_unrated_season1` so Glicko does not move.
- Future Open AI / season suffixes (`hu_holdem_standard_season_1`, `hu_holdem_open_ai_future`) stay separate pools — do not mix formats.

---

## Rating update gate

`evaluateRatingUpdateGate` allows a Glicko update only when:

1. `matchClass === ranked_public` (private / open_custom / demo_unranked → skip)
2. Format is HU (six-max unrated Season 1)
3. Settlement confirmed
4. Replay/event verification passed (or explicit demo soft path)
5. No provider-incident void
6. No integrity hold
7. Pair/identity OK
8. Repeated-opponent weight `> 0`
9. `sessionId` + settlement/proof root present (unless `allowMissingProofRoot` for legacy demo/backfill)

Every successful update path records `event_log_root` / session reference on `rated_matches`.

`settleRatedMatch` applies the gate before mutating `account_ratings`. Skip reasons are persisted on `rated_matches.reason` (e.g. `private_or_custom_unranked`, `repeated_opponent_cap`, `provider_incident_void`).

---

## Repeated opponents

| Prior settled HU overlaps (24h) | Matchmaking (WP-043) | Rating weight |
|---|---|---|
| 0–4 | Allowed | `1.0` |
| ≥5 | Soft-avoid `pair_capped` | `0.5` through 9 |
| ≥10 | Soft-avoid | `0` (record only) |

Prefer avoidance; weight decay is the backstop.

---

## Aggression

Opportunity-adjusted rates (PFR, 3-bet, steal, postflop bet/raise, raise-vs-bet, sizing, all-in) shrunk toward league priors (`PRIOR_K = 500`). Display confidence: Provisional / Developing / Established / High confidence. **Never** an input to Arena Rating.

---

## Abuse handling

States: `CLEAR` → `MONITORED` → `MATCHMAKING_RESTRICTED` → `WITHDRAWAL_REVIEW` → `SUSPENDED` → `APPEAL` → `RESOLVED`.

- `blocksRankedMatchmaking` for restricted/suspended.
- `abuseStateAuthorizesFundSeizure` is always `false` — custody remains ArenaAccount / legal policy (Plan 13).

---

## Collusion / identity (honest deferral)

`assessRiskSignals` aggregates explainable behavioral/identity features with sample shrinkage. It:

- **does** return score, confidence, evidence refs, suggested `flag_review` / `seat_exclusion` / `monitor`;
- **does not** auto-punish, seize funds, or claim ML production readiness.

Linked-account exclusion uses `StubLinkedAccountStore` / injectable `LinkedAccountLookup` (WP-043). Persistent graph tables + `DbLinkedAccountStore` landed in Plan 19 migration `027`; admin review UI remains follow-up.

---

## Information controls & prompt cheating

| Control | Where | Plan 12 status |
|---|---|---|
| No arbitrary ranked system prompts | Agent runtime Season 1 master policy | Covered under Plans 08/09 |
| Private AgentState | `services/agent-runtime` state store | Covered |
| No live hole cards to multiway owner (collusion priority) | Product / UI policy | **Deferred** (default recommendation documented; not fully enforced in web) |
| Live coaching queued to next session | — | **Deferred** |
| Spectator delay | — | **Deferred** |

---

## Tests

```bash
pnpm --filter @mozetto/ratings test
pnpm --filter @mozetto/database test
```

Coverage includes:

- default Glicko priors + idle RD growth
- pair weight bands + zero-weight no-op
- stake does not scale deltas
- gate rejects private / six-max / void / hold / unverified / zero weight
- aggression shrinks at low sample
- abuse FSM + no fund seizure
- risk signals never set `autoPunishForbidden` false
- WP-043 matchmaking integrity (self / linked / pair cap)

---

## Intentionally deferred

| Topic | Why |
|---|---|
| Production ML collusion detector | No validated model; Plan 12 forbids auto-punish from one score |
| Admin review UI for identity clusters | Schema + `DbLinkedAccountStore` in Plan 19 `027`; ops UI follow-up |
| Rating-band expansion with wait time | Season 1 uses league/buy-in pools only |
| Fair six-max Bayesian/Plackett–Luce rating | Explicitly not declared until model + abuse resistance specified |
| Live coaching command queue + spectator delay UX | Product follow-up; Season 1 AI policy already blocks arbitrary prompts |
| Full wallet-cluster / device graph ingestion | Risk signal IDs reserved; ingestion not wired |

---

## Acceptance evidence

- Unit tests: `@mozetto/ratings` (Glicko, aggression, Plan 12 gate/pairing/abuse/risk)
- Unit tests: `@mozetto/database` matchmaking / WP-043 suite
- Docs: this file + `docs/WP-040_RANKED_RANDOM_MATCHMAKER.md` + `docs/WP-043_ANTI_PAIRING.md`
- No `/specs` mutations
