# WP-043 — Anti-pairing and identity hooks

**Authority:** `mozetto_execution_plans/04_GAME_REGISTRY_SESSION_LIFECYCLE_MATCHMAKING.md`, `12_RATINGS_ANTI_CHEAT_AND_COLLUSION.md`  
**Prior:** WP-040 ranked matchmaker (self + HU pair caps), WP-041 session seal (`seat_order` → immutable participant root)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Linked-account lookup interface + stub store | `packages/database/src/linked-accounts.ts` |
| Opponent integrity (self → linked → HU pair cap) | `packages/database/src/ranked-matchmaker.ts` |
| Pair rating weight bands (Plan 12) shared with ratings | `pairRatingWeight` → `ratings.repeatedOpponentWeight` |
| Demo allocator wiring | `findArenaMatch` in `matchmaking.ts` |
| On-chain claim filters | `claimTicketPair` / `claimOpenOnchainSession` in `onchain-match.ts` |
| Pre-seal participant integrity assert | `assertRankedParticipantIntegrity` |
| Unit tests | `packages/database/src/matchmaking.test.ts` |
| This note | `docs/WP-043_ANTI_PAIRING.md` |

No edits to `contracts/` (WP-025) or `services/agent-runtime` (WP-074/076). No collusion ML.

---

## Ranked integrity order

For each seated opponent on a same-pool candidate:

```text
1. self_seated     — same profile already at the table
2. linked_account  — beneficial-owner / linked cluster (WP-043)
3. pair_capped     — HU only: ≥ MAX_PAIR_MATCHES_PER_DAY overlaps in 24h
```

Prefer **avoiding** the pair via matchmaking; rating weight decay (full → 0.5 → 0) remains a backstop in `settleRatedMatch`.

Classic / six-max: self + linked apply; HU pair-frequency soft-avoidance does not (multiway frequency is a later policy).

---

## Linked-account interface

```ts
interface LinkedAccountLookup {
  getExcludedPeers(accountId: string): ReadonlySet<string> | Promise<ReadonlySet<string>>;
}
```

- **Default:** `StubLinkedAccountStore` with an empty graph (`createDefaultLinkedAccountLookup`).
- **Inject:** `setLinkedAccountLookup(store)` for tests or a future DB / risk service.
- Edges are undirected; exclusion uses presence (confidence is advisory only).

Production link sources (funding, device, wallet cluster, admin) plug into the same interface without changing the allocator.

---

## Seal coordination (wave gate)

| Phase | Rule |
|---|---|
| Matchmaking | Identity filters run **before** seal |
| Pre-seal | `assertRankedParticipantIntegrity(ownerIds, linkedPeersOf)` |
| Seal (WP-041 / WP-023) | `participantRoot` frozen; seats immutable |
| After seal | Participant mutation remains impossible on-chain |

Matchmaking cannot (and must not) rewrite sealed seats; linked / pair policy is an allocation-time gate only.

---

## Pair-cap policy (aligned)

| Prior settled HU overlaps (24h) | Matchmaking | Rating weight |
|---|---|---|
| 0–4 | Allowed | 1.0 |
| ≥5 (`MAX_PAIR_MATCHES_PER_DAY`) | Soft-avoid (`pair_capped`) | 0.5 through 9 |
| ≥10 (`PAIR_REDUCED_WEIGHT_UNTIL`) | Soft-avoid | 0 (record only) |

---

## Acceptance evidence

- Unit tests: self-match, linked exclusion (HU + Classic), pair cap, stub store → allocator, pre-seal assert
- Commands:
  ```bash
  pnpm --filter @mozetto/database test
  pnpm --filter @mozetto/database typecheck
  ```

---

## Out of scope

| Topic | Notes |
|---|---|
| Full collusion / ML detection | Plan 12 later |
| Persistent linked-account DB table | Interface ready; store deferred |
| Spec / vector mutations | Forbidden |
| Contract participant mutation | Owned by WP-023 / WP-025 |
| Agent-runtime identity | WP-074/076 |

---

## Follow-up

- Persist link edges + admin review UI (Plan 13)
- Rating-band wait expansion (Plan 12)
- WP-042 epoch join/leave continues separately
