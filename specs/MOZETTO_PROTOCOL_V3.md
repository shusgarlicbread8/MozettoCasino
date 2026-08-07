# MOZETTO_PROTOCOL_V3

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_PROTOCOL_V3` |
| **Status** | `frozen` |
| **Work packet** | WP-010 |
| **Depends on** | Locked decisions in `mozetto_execution_plans/00_READ_ME_FIRST.md` |

## 1. Normative terms

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are to be interpreted as described in RFC 2119.

## 2. Scope

This document defines shared primitives used by all Protocol V3 consensus objects:

- integer money;
- card codes;
- seats and optionals;
- identifiers;
- time;
- domain separation;
- hashing and ABI encoding;
- ordered Merkle trees;
- version / upgrade rules.

Object-specific layouts live in sibling specs.

## 3. Hashing algorithm

Consensus digests MUST use **keccak256** (Ethereum / Solidity compatible).

For object hash `H`:

```text
canonicalBytes = abi.encode(DOMAIN_TAG, field0, field1, ...)
H = keccak256(canonicalBytes)
```

Where `DOMAIN_TAG` is `bytes32` equal to `keccak256(bytes(<DOMAIN_STRING>))`.

Implementations MUST NOT:

- hash raw JSON, YAML, or CBOR text for consensus digests;
- use SHA-256 / BLAKE2 for Protocol V3 consensus object hashes;
- omit domain tags;
- reorder ABI fields relative to the normative field list.

Human-readable JSON in APIs and golden vectors is a **projection**, not the hash preimage.

### ABI encoding rules

- Use standard Solidity ABI encoding (`abi.encode`), not `abi.encodePacked`, for typed object hashes unless a clause explicitly requires packed encoding (Merkle parent nodes use packed `left || right`).
- `address` is 20-byte left-padded to 32 in ABI encoding.
- `bool` is `uint8` 0/1 in ABI encoding.
- Dynamic types are forbidden in consensus object encodings in this draft unless a later version introduces them with explicit rules.

## 4. Domain separation table

| Constant name | Domain string | Role |
|---|---|---|
| `DOMAIN_SESSION_V2` | `MOZETTO_SESSION_V2` | Session descriptor hash |
| `DOMAIN_SESSION_ID_V1` | `MOZETTO_SESSION_ID_V1` | Derived sessionId |
| `DOMAIN_HAND_ID_V1` | `MOZETTO_HAND_ID_V1` | Derived handId |
| `DOMAIN_PARTICIPANT_LEAF_V1` | `MOZETTO_PARTICIPANT_LEAF_V1` | Participant Merkle leaf |
| `DOMAIN_OPENING_BALANCE_LEAF_V1` | `MOZETTO_OPENING_BALANCE_LEAF_V1` | Opening balance leaf |
| `DOMAIN_CONTROLLER_LEAF_V1` | `MOZETTO_CONTROLLER_LEAF_V1` | Controller Merkle leaf |
| `DOMAIN_EVENT_V1` | `MOZETTO_EVENT_V1` | Poker event hash |
| `DOMAIN_CARD_LEAF_V1` | `MOZETTO_CARD_LEAF_V1` | Per-card commitment |
| `DOMAIN_DECK_ROOT_V1` | `MOZETTO_DECK_ROOT_V1` | Deck root binding (when used as typed bind) |
| `DOMAIN_DECK_BATCH_V1` | `MOZETTO_DECK_BATCH_V1` | Deck batch root bind |
| `DOMAIN_SECRET_LEAF_V1` | `MOZETTO_SECRET_LEAF_V1` | Dealer secret leaf |
| `DOMAIN_HAND_SEED_V1` | `MOZETTO_HAND_SEED_V1` | Hand seed derivation |
| `DOMAIN_HAND_ROOT_V1` | `MOZETTO_HAND_ROOT_V1` | Hand root |
| `DOMAIN_BALANCE_LEAF_V1` | `MOZETTO_BALANCE_LEAF_V1` | Balance / emergency leaf |
| `DOMAIN_PROFILE_V1` | `MOZETTO_PROFILE_V1` | Strategy profile hash |
| `DOMAIN_MODEL_POLICY_V1` | `MOZETTO_MODEL_POLICY_V1` | Model policy hash |
| `DOMAIN_PROOF_BATCH_V1` | `MOZETTO_PROOF_BATCH_V1` | Proof batch object hash |
| `DOMAIN_SETTLEMENT_V3` | `MOZETTO_SETTLEMENT_V3` | Settlement bind (non-EIP-712 uses) |
| `DOMAIN_ENERGY_OP_V1` | `MOZETTO_ENERGY_OP_V1` | Energy operation |
| `DOMAIN_ENERGY_LEDGER_V1` | `MOZETTO_ENERGY_LEDGER_V1` | Energy ledger header |
| `DOMAIN_GAME_TEMPLATE_V2` | `MOZETTO_GAME_TEMPLATE_V2` | Game template hash |
| `DOMAIN_CONTROLLER_REQUEST_V1` | `MOZETTO_CONTROLLER_REQUEST_V1` | Controller request |
| `DOMAIN_CONTROLLER_RESPONSE_V1` | `MOZETTO_CONTROLLER_RESPONSE_V1` | Controller response |

A domain string MUST NOT be reused for two semantic roles. Digests for this draft are in `canonical-vectors/_domains.json`.

## 5. Monetary amounts

- All chip, pot, buy-in, rake, and settlement amounts MUST be unsigned integers in **USDC base units**.
- `1 USDC = 1_000_000` base units (6 decimals).
- Width in consensus structs: `uint256` unless a clause specifies otherwise.
- Implementations MUST NOT use IEEE-754 floating point for legality, pot math, or settlement.
- UI conversion to decimal USDC MUST occur only at display boundaries.

**Invalid examples:** `1.5` USDC as float; JavaScript `Number` for large pots; negative balances.

## 6. Cards

Canonical card code is `uint8` in range `0..51`.

```text
rankIndex: 0=2, 1=3, 2=4, 3=5, 4=6, 5=7, 6=8, 7=9, 8=T, 9=J, 10=Q, 11=K, 12=A
suitIndex: 0=clubs (c), 1=diamonds (d), 2=hearts (h), 3=spades (s)
cardCode  = suitIndex * 13 + rankIndex
```

Examples:

| Code | Card |
|---:|---|
| 0 | 2c |
| 12 | Ac |
| 13 | 2d |
| 25 | Ad |
| 26 | 2h |
| 38 | Ah |
| 39 | 2s |
| 51 | As |

### Migration from current TypeScript (`packages/game-rules`)

Current `fullDeck()` iterates suits `c,d,h,s` outer and ranks `2..A` inner, which is the same ordering as this mapping. The package currently stores `{rank,suit}` objects and does **not** yet expose stable `0..51` codes or bias-free shuffle.

- Protocol V3 MUST use the numeric mapping above.
- Existing object cards MUST convert via `cardCode = suitIndex * 13 + rankIndex`.
- Current HMAC shuffle with `next() % (i+1)` MUST NOT be used for V3 decks (modulo bias). See `MOZETTO_RANDOMNESS_V2.md`.

## 7. Seats

- Seat indices are `uint8`.
- Heads-up (HU): seats `0..1`.
- Six-max: seats `0..5`.
- An absent seat MUST NOT be encoded as a magic seat integer alone.
- Optional actor seat in events: pair `(bool hasActorSeat, uint8 actorSeat)`. When `hasActorSeat == false`, `actorSeat` MUST be `0`.

## 8. Identifiers

| Name | Type | Derivation |
|---|---|---|
| `sessionId` | `bytes32` | `keccak256(abi.encode(DOMAIN_SESSION_ID_V1, chainId, gameTemplateId, participantRoot, sessionNonce, createdAt))` |
| `handId` | `bytes32` | `keccak256(abi.encode(DOMAIN_HAND_ID_V1, sessionId, epoch, handNumber))` |
| `gameTemplateId` | `bytes32` | Registry identifier (typically `keccak256(bytes(name))` at registration) |
| `profileConfigHash` | `bytes32` | Profile encoding in Controller spec |
| `modelPolicyHash` | `bytes32` | Model policy encoding in Controller spec |

`sessionNonce` MUST be a fresh `bytes32` CSPRNG value (or VRF-derived uniqueness) chosen before seal.

## 9. Time

- On-chain expiry / deadlines: Unix seconds (`uint64` or `uint256` as specified).
- Poker legality timing: monotonic `elapsedMs` (`uint64`) relative to hand start.
- Wall-clock timestamps are metadata and MUST NOT affect poker legality.

## 10. Ordered Merkle trees

Unless a child spec overrides:

1. Leaves are `bytes32` already-hashed values.
2. Pad the leaf list with `bytes32(0)` until length is a power of two.
3. Parent node: `keccak256(bytes.concat(left, right))` i.e. `keccak256(left || right)` with **positional** order (not sorted-pair hashing).
4. Root is the single remaining node.
5. Empty leaf set root is `bytes32(0)`.

Proofs are sibling lists from leaf to root with positional direction.

## 11. Protocol version field

Consensus objects that include `protocolVersion` MUST use `uint16` with value `3` for this major.

## 12. Compatibility rules

- V2 ArenaAccount / ArenaVault / PokerSettlementHub EIP-712 domains remain valid for historical V2 sessions.
- Protocol V3 settlement uses EIP-712 name `MozettoPokerSettlement` version `"3"` (see Settlement spec).
- A verifier MUST select the encoding version from the session’s sealed protocol version, not from “latest code”.

## 13. Upgrade / migration rules

1. Additive non-consensus metadata MAY keep the same version.
2. Any change to encoded fields, hashing, poker legality, rake, randomness, or settlement MUST bump a versioned spec.
3. Active sessions MUST retain the version they opened with.
4. Old versions MUST remain verifiable after deactivation.
5. Registry deactivation MUST stop new sessions but MUST NOT invalidate historical proofs.
6. Active seasons MUST NOT be silently mutated (model policy, Energy table, card mapping, domain strings).

## 14. Example values

See golden vectors `01`–`14` and `_domains.json`.

**Invalid examples (shared):**

- Hashing `JSON.stringify(session)`.
- Using `DOMAIN_EVENT_V1` for a session descriptor.
- `cardCode = 52`.
- Seat `255` meaning “empty”.
- Floating pot split.

## 15. Acceptance hooks for WP-015

Encoders in TypeScript, Rust, and Solidity MUST produce identical:

- domain tag digests;
- leaf hashes;
- Merkle roots;
- EIP-712 digests for vector 12.
