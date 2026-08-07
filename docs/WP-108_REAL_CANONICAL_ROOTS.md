# WP-108 — Real canonical roots

**Authority:** Plan 10 / Wave 11 WP-108 in `mozetto_execution_plans/16_AGENT_WORK_PACKETS.md`  
**Prior:** WP-060 `@mozetto/event-store`, WP-061 `@mozetto/root-builder`, WP-084 settlement worker V3, WP-107 live Groq table  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Session roots API (no stub seeds) | `packages/root-builder/src/session-roots.ts` → `buildCanonicalSettlementRoots` |
| Game-server HandRoot persistence | `services/game-server/src/roots/` + `TableRuntime.persistCanonicalRootsAfterHand` |
| Engine → PokerEventV1 mapping | `HAND_STARTED` / `HAND_SETTLED` / `PLAYER_ACTED` / `STREET_DEALT` in `outbox/schema.ts` |
| Settlement hard-fail stubs | `REQUIRE_REAL_ROOTS=1` / `MOZETTO_GOLDEN=1` via `resolveSettlementRoots` |
| Unit tests (fixture hand = event tip) | `root-builder` + `game-server` + `settlement-worker` |
| This note | `docs/WP-108_REAL_CANONICAL_ROOTS.md` |

Frozen `/specs` untouched.

---

## Production path

```text
game-server (CANONICAL_SCHEMA_KIND=poker_event_v1)
  → PokerEventV1 hash chain tip (canonical_game_events)
  → HandRoot via @mozetto/root-builder → hand_roots
  → BalanceRoot (seat-ordered Merkle) → balance_leaves + session_checkpoints
settlement-worker V3
  → resolveSettlementRoots (DB tip + hand_roots + Merkle / checkpoint)
  → buildV3Proposal → attestors → Hub V3
```

When `REQUIRE_REAL_ROOTS=1` (or `MOZETTO_GOLDEN=1`), missing tip / hand_root / balance leaves **hard-fail** — no `keccak(events:…)` / `keccak(hands:…)` / `keccak(balances:…)` stubs.

---

## API for WP-106 golden E2E

### Preferred (library)

```ts
import {
  buildCanonicalSettlementRoots,
  requireRealRoots,
} from "@mozetto/root-builder";
import { EventHashChain } from "@mozetto/event-store";

// After building / replaying a PokerEventV1 chain for the session:
const roots = buildCanonicalSettlementRoots({
  sessionId,
  chain,          // EventHashChain or { tip } / { eventHashes }
  events,         // for tipForHand + finalSequence
  hands: [{ handNumber, deckRoot, openingStateHash, endingStateHash, handRake }],
  balances: [/* BalanceLeafInput per seat */],
});
// roots.finalEventRoot === chain.tip
// roots.handRoot / roots.balanceRoot → FinalSettlementV3 fields
```

### Settlement worker (consume persisted gameplay)

```ts
import { resolveSettlementRoots } from "@mozetto/settlement-worker/…" // or services/.../v3/real-roots
// Env: REQUIRE_REAL_ROOTS=1
```

### Game-server helper (live tip → triple)

```ts
import { buildSettlementRootsFromTip } from "./roots/index.js"; // @mozetto/game-server
```

### Flags

| Flag | Effect |
|---|---|
| `CANONICAL_SCHEMA_KIND=poker_event_v1` | Game-server encodes mappable engine events as PokerEventV1 |
| `REQUIRE_REAL_ROOTS=1` | Settlement refuses stub root injection |
| `MOZETTO_GOLDEN=1` | Same gate as `REQUIRE_REAL_ROOTS` (alias for golden E2E) |

Anvil protocol E2E (`scripts/anvil-e2e-protocol-v3.mjs`) still uses synthetic roots unless WP-106 wires this API; set the flags above once live gameplay feeds `canonical_game_events` + `hand_roots`.

---

## Commands

```bash
pnpm --filter @mozetto/root-builder test
pnpm --filter @mozetto/game-server test
pnpm --filter @mozetto/settlement-worker test
pnpm --filter @mozetto/{root-builder,game-server,settlement-worker} typecheck
```

---

## Acceptance

- Fixture HandRoot `eventChainTip` equals WP-060 chain tip
- `balanceRoot` is seat-ordered Merkle (not `keccak(balances:…)`)
- `REQUIRE_REAL_ROOTS=1` throws `StubRootError` when tip/hand missing
- On-chain tables with `poker_event_v1` persist `hand_roots` after `HAND_SETTLED`

---

## Out of scope

| Topic | Packet |
|---|---|
| Full browser Anvil golden path | WP-106 |
| Live dealer Merkle `deckRoot` attach | WP-051 follow-up (seedReveal keccak used until attached) |
| Spec / golden vector mutations | Forbidden |

---

## Follow-up

- WP-106: call `buildCanonicalSettlementRoots` / consume DB roots under `REQUIRE_REAL_ROOTS=1`
- Attach real `@mozetto/dealer-deck` `deckRoot` into HandRoot when dealer path is live
- Enable `CANONICAL_SCHEMA_KIND=poker_event_v1` by default on hosted on-chain tables
