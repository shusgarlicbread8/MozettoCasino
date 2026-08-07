# MOZETTO_POKER_EVENT_V1

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_POKER_EVENT_V1` |
| **Status** | `frozen` |
| **Work packet** | WP-011 |
| **Domain** | `DOMAIN_EVENT_V1` = `keccak256("MOZETTO_EVENT_V1")` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

Every poker state transition emits a `PokerEventV1`. Events form a hash chain. Changing any historical event invalidates all later hashes and settlement roots that depend on them.

Persist **canonical ABI bytes** and hashes. JSON is a projection only.

## 3. Event type codes (`uint16`)

| Code | Name | Actor? |
|---:|---|---|
| 1 | `HAND_START` | no |
| 2 | `POST_BLIND` | yes |
| 3 | `DEAL_HOLE` | no |
| 10 | `ACTION_FOLD` | yes |
| 11 | `ACTION_CHECK` | yes |
| 12 | `ACTION_CALL` | yes |
| 13 | `ACTION_BET` | yes |
| 14 | `ACTION_RAISE` | yes |
| 15 | `ACTION_ALL_IN` | yes |
| 20 | `STREET_FLOP` | no |
| 21 | `STREET_TURN` | no |
| 22 | `STREET_RIVER` | no |
| 30 | `SHOWDOWN` | no |
| 40 | `HAND_END` | no |
| 50 | `HAND_ABORT` | no |

Unknown codes MUST be rejected by Season 1 engines.

## 4. Canonical structure

Field order (exact):

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | `protocolVersion` | `uint16` | `3` |
| 2 | `sessionId` | `bytes32` | |
| 3 | `epoch` | `uint64` | |
| 4 | `handNumber` | `uint64` | |
| 5 | `sequence` | `uint64` | Monotonic per session (or per hand — Season 1: per session global) |
| 6 | `eventType` | `uint16` | |
| 7 | `hasActorSeat` | `bool` | |
| 8 | `actorSeat` | `uint8` | `0` if `hasActorSeat=false` |
| 9 | `publicPayloadHash` | `bytes32` | Hash of canonical public payload |
| 10 | `privatePayloadCommitment` | `bytes32` | `bytes32(0)` if none |
| 11 | `elapsedMs` | `uint64` | Ms since hand start |
| 12 | `previousEventHash` | `bytes32` | `bytes32(0)` for first event of chain segment |
| 13 | `engineHash` | `bytes32` | Bound engine build |

```text
eventHash = keccak256(abi.encode(
  DOMAIN_EVENT_V1,
  protocolVersion,
  sessionId,
  epoch,
  handNumber,
  sequence,
  eventType,
  hasActorSeat,
  actorSeat,
  publicPayloadHash,
  privatePayloadCommitment,
  elapsedMs,
  previousEventHash,
  engineHash
))
```

Chain rule: for sequence `n>0`, `previousEventHash` MUST equal `eventHash` of sequence `n-1` within the same session chain.

## 5. Public payloads

Public payloads are ABI-encoded separately, then hashed:

```text
publicPayloadHash = keccak256(publicPayloadCanonicalBytes)
```

### Action payload (bet/raise/call/all-in/fold/check)

```text
abi.encode(uint8 seat, uint16 action, uint256 amount)
```

- `fold` / `check`: `amount` MUST be `0`.
- `call`: `amount` is the chips added this action (MAY be `0` if encoding “call remaining” as engine-resolved; Season 1 engines MUST document which — golden vector 04 uses `0` with engine-implied call size). Prefer explicit chips-added in production implementations; if implied, the engine state hash MUST uniquely determine the amount.
- `bet` / `raise` / `all-in`: `amount` is the **total wager on this street after the action** (standard NLHE total-bet encoding) OR chips-added — **Season 1 freeze:** amount is **chips moved into the pot by this action** (delta). Vector 03 uses delta raise/call.

### Blind payload

```text
abi.encode(uint8 seat, uint256 amount)
```

### Street payload

Board cards revealed publicly SHOULD use:

```text
abi.encode(uint8 nCards, uint8[] cardCodes)  // fixed: abi.encode(uint8 n, bytes32 cardCodesPacked)
```

Season 1 freeze for street public payload:

```text
publicPayloadHash = keccak256(abi.encode(uint8 nCards, bytes32 cardsWord))
```

where `cardsWord` packs up to 5 card codes in the least-significant bytes (byte0 = first card). Prefer explicit per-card openings via Randomness proofs; street event commits the public board codes.

## 6. Incomplete all-in / reopen rule

If a player faces a bet/raise and moves all-in for an amount that does **not** constitute a full minimum raise, action does **NOT** reopen for players who have already acted and are not facing a full raise.

Legal responses for a prior aggressor facing such a short all-in: **fold** or **call** only. Raise/bet MUST be rejected.

Golden vector: `04_incomplete_allin_raise.json`.

## 7. Side pots

Pots MUST be partitioned by contribution levels using integer USDC base units only.

Eligibility: a seat is eligible for a pot if it contributed to that pot layer and has not folded.

Golden vector: `05_three_way_side_pot.json`.

## 8. Split pot odd chip

When `N` winners split pot `P` base units:

```text
base = P / N   // integer division
rem  = P % N
```

Award `base` to each winner. Award remaining `rem` chips **one per winner** in clockwise order starting from the first winner seat **strictly after** `buttonSeat` (wrapping through `0..maxSeat`).

Golden vector: `06_split_pot_odd_chip.json` (HU pot `1000001`, button `0` → seat1 gets the odd chip).

## 9. Engine hash

`engineHash` MUST identify the deterministic engine build used for legality. Season 1 draft placeholder: `keccak256(bytes("mozetto-nlhe-engine-v3-draft"))` until Rust/TS freeze (WP-030+).

## 10. Example values

Vectors `03`, `04`, `05`, `06`.

## 11. Invalid examples

- Reordering events while keeping hashes.
- `hasActorSeat=false` with `actorSeat!=0`.
- Wall-clock timestamps inside legality.
- Floating odd-chip discard.
- Treating incomplete all-in as full reopen.
- Hashing JSON event objects.

## 12. Compatibility

- V1 settlement hubs that commit `eventRoot` remain for V2.
- V3 hand/event roots MUST use this encoding.

## 13. Upgrade / migration

- New event types require a versioned event spec if semantics change.
- Additive analytics fields outside the 13-field event hash MUST NOT alter `eventHash`.
