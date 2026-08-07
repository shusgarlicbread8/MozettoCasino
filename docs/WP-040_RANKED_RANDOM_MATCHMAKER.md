# WP-040 — Ranked random matchmaker

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md` (ranked matchmaking policy)  
**Locked decision:** Ranked public games use random matchmaking; players do not select opponents or public ranked tables  
**Prior:** WP-023 session lifecycle (seal immutability); existing `findArenaMatch` / arena find-match API  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Pure allocation core | `packages/database/src/ranked-matchmaker.ts` |
| Evolved `findArenaMatch` | `packages/database/src/matchmaking.ts` — random within pool + audit |
| On-chain claim path | `packages/database/src/onchain-match.ts` — `ORDER BY random()`, seat permutation |
| Audit table | `packages/database/migrations/017_matchmaking_allocation_audit.sql` |
| Unit tests | `packages/database/src/matchmaking.test.ts` |
| This note | `docs/WP-040_RANKED_RANDOM_MATCHMAKER.md` |

API surface unchanged: `POST /v1/arena/find-match` and `POST /v1/arena/classic/find-match` still call `findArenaMatch` / on-chain handlers. Response may include optional `allocationId`, `seatOrder`, `poolKey`.

---

## Ranked policy (what users choose)

| User chooses | Matchmaker chooses |
|---|---|
| Game (HU vs Classic) | Exact table / room id |
| League / fixed buy-in | Opponent(s) |
| Strategy profile | Seat index |
| Arena mode (demo / on-chain) | Dealer button |

No public ranked table browser drives seating. Lobby “Find Match” is the only ranked entry.

---

## Allocation algorithm

```text
1. Close idle ranked tables
2. Enforce funds + one active session per format/mode
3. Query same-pool candidates only:
     privacy=public, league, buy-in, variant/seats, arena_mode, chain
4. Reject self-seat; for HU reject pair-capped opponents (≥5 overlaps / 24h)
5. Uniform random pick among eligible — NOT fullest-first
6. Else create a new ephemeral ranked table
7. Record seat_order permutation + decision row in matchmaking_allocation_log
```

Pool key (audit / queue grouping, not a user room id):

```text
ranked:{arenaMode}:{chain|demo}:{format}:{leagueId}:buyin={n}
```

---

## Audit trace

`matchmaking_allocation_log` stores:

- `decision`: `reuse_session` | `join_existing` | `create_table` | `rejected`
- `reason_code`: e.g. `random_within_pool`, `empty_pool`, `already_seated`, `onchain_random_within_pool`
- `candidate_count` / `eligible_count`
- `rejected` JSON (table id + reason codes — no anti-fraud secrets)
- `seat_order` — random permutation recorded for seal coordination (WP-041)
- `trace` JSON — product label, eligible ids, on-chain session id when applicable

Insert failures are non-fatal (logged) so older DBs without migration 017 still matchmake.

---

## Ranked vs open / private tables

| Class | Entry | Rating | Table selection |
|---|---|---|---|
| **Ranked public** | Find Match only | Yes (HU Glicko; Classic policy TBD) | **Forbidden** — random allocation |
| **Demo ranked** | Same Find Match (`arena_mode=demo`) | Soft / demo ledger | Same random allocator |
| **On-chain ranked** | Find Match → seat tickets + vault | On-chain custody | Random claim within pool |
| **Private / custom** | Invite / explicit table id | Unranked by default (Plan 04) | Allowed — separate product class |

Demo and on-chain paths share the same constraint + random core; they do not require WP-024 fee vault changes.

---

## Coordination with WP-023 / WP-041

- WP-023 sealed sessions: after seal, participants are immutable on-chain. Matchmaking must finish allocation **before** seal.
- `seat_order` in the audit log is the committed random permutation for future seal participant leaves; live join may still take the first free seat until WP-041 wires seat assignment from the allocation record.
- WP-043 deepens identity-cluster / linked-wallet exclusions on top of self-match + HU pair caps.

---

## Intentional deferrals

| Topic | Choice |
|---|---|
| Rating-band expansion with wait time | Deferred (Plan 12); pool is league/buy-in for Season 1 |
| Latency region / reliability gates | Deferred |
| Full `/v1/matchmaking/intents` API (Plan 19) | Prefer evolving find-match; intents later |
| Linked-account exclusions | WP-043 — **DONE** |
| Session seal coordinator | WP-041 — **DONE** |
| Spec / vector changes | Forbidden this packet |

---

## Acceptance evidence

- Unit tests: pool mismatch rejects, HU pair cap, Classic skips pair cap, random pick not fullest-first, seat permutation
- Commands: `pnpm --filter @mozetto/database test`
- Migration: `017_matchmaking_allocation_audit.sql`

---

## Follow-up

- WP-041 Session seal coordinator — **DONE** (`packages/session-seal`)
- WP-042 Epoch join/leave
- WP-043 Anti-pairing + identity clusters — **DONE** (`docs/WP-043_ANTI_PAIRING.md`)
