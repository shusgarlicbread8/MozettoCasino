# WP-060 — Canonical event store / hash chain

**Authority:** frozen `specs/MOZETTO_POKER_EVENT_V1.md`, Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`  
**Vectors:** `03_preflop_sequence.json`, `04_incomplete_allin_raise.json` (05–06 are pot/odd-chip rules, not event-store)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Append-only PokerEventV1 hash chain | `packages/event-store` → `EventHashChain` |
| ABI `eventHash` via protocol-vectors | `hashPokerEventV1` / `@mozetto/protocol-vectors` `eventHash` |
| Chain linkage (`previousEventHash`) | tip continuity + `verify()` |
| Payload helpers (action / blind / street) | `hashActionPayload`, `hashBlindPayload`, `hashStreetPayload` |
| Plan 19 DB stub (canonical bytes, state hash, companions) | `packages/database/migrations/019_canonical_poker_events_v1.sql` |
| Golden + integrity tests | `packages/event-store/src/event-store.test.ts` |
| This note | `docs/WP-060_EVENT_HASH_CHAIN.md` |

No SettlementHubV3 (WP-063). Specs untouched. No RandomnessBeacon / custody edits.

---

## Hash chain rule

```text
eventHash = keccak256(abi.encode(
  DOMAIN_EVENT_V1,           // keccak256("MOZETTO_EVENT_V1")
  protocolVersion,           // uint16 = 3
  sessionId, epoch, handNumber, sequence,
  eventType, hasActorSeat, actorSeat,
  publicPayloadHash, privatePayloadCommitment,
  elapsedMs, previousEventHash, engineHash
))
```

- Sequence `0`: `previousEventHash = bytes32(0)`.
- Sequence `n>0`: `previousEventHash` MUST equal `eventHash` of sequence `n-1`.
- JSON / human payloads are **projections only** — never the hash source.
- `resultingStateHash` is stored beside the event for replay/settlement; it is **not** inside `eventHash`.

---

## API surface

```ts
import {
  EventHashChain,
  EVENT_TYPE,
  hashActionPayload,
  hashBlindPayload,
  protocolV3EngineHash,
  ZERO_EVENT_HASH,
  verifyEventHashChain,
} from "@mozetto/event-store";

const chain = new EventHashChain(sessionId, 0n);
chain.append({
  sessionId,
  epoch: 0n,
  handNumber: 1n,
  eventType: EVENT_TYPE.HAND_START,
  hasActorSeat: false,
  actorSeat: 0,
  publicPayloadHash,
  elapsedMs: 0n,
  engineHash: protocolV3EngineHash(),
  resultingStateHash, // optional
});
const { ok, tip, issues } = chain.verify();
const rows = chain.toCanonicalRows(); // Plan 19 row projection
```

Rejects on append: unknown `eventType`, `hasActorSeat=false` with `actorSeat≠0`, sequence gaps, `previousEventHash` ≠ tip.

---

## Persistence

Migration `019` extends `canonical_game_events` (from `011`) with:

- `epoch`, `hand_number`, `protocol_version`, `event_type_code`
- `has_actor_seat`, `actor_seat`, `public_payload_hash`, `elapsed_ms`
- `canonical_bytes` (`bytea`), `resulting_state_hash`, `actor_identity`
- `schema_kind` ∈ `{legacy_json, poker_event_v1}`

Companion stubs: `public_event_payloads`, `private_payload_ciphertexts`, `event_persistence_outbox`.

**Cutover note:** game-server may still emit `legacy_json` until WP-081. WP-064 replay-verifier verifies **both** `poker_event_v1` (ABI) and `legacy_json` (GENESIS keccak) based on `schema_kind`.

---

## Tests / evidence

```bash
pnpm --filter @mozetto/event-store test
pnpm --filter @mozetto/event-store typecheck
```

Covers: vector 03 chain tip + per-event hashes/bytes; vector 04 incomplete all-in chain; PREV_BREAK / actor-seat / elapsedMs / reorder mutations; sequence skip; unknown type; `fromStored` + hash-tamper detect.

---

## Out of scope

- HandRoot / BalanceRoot builders (WP-061)
- ProofBatchRegistry (WP-062 DONE) / SettlementHubV3 (WP-063)
- Persist-before-broadcast outbox wiring (WP-081) — game-server emit path
- Replay verifier (WP-064) — DONE; see `docs/WP-064_REPLAY_VERIFIER.md`
- Spec / golden vector mutations
