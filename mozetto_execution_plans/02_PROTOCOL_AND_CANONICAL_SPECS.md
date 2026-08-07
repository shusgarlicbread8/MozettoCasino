# 02 — Protocol and Canonical Specifications

**Entry gate:** Phase 0 baseline is reproducible.  
**Exit gate:** TypeScript, Rust, and Solidity agree on every canonical test vector.

## Why this plan comes first

The most dangerous protocol bugs arise when multiple services encode the same concept differently. A session ID, card, amount, controller hash, settlement, or event cannot mean one thing in TypeScript and another in Solidity. Freeze the vocabulary and binary encodings before implementing V3.

## Specifications to create

Create a `/specs` directory at repository root:

```text
/specs
  MOZETTO_PROTOCOL_V3.md
  MOZETTO_GAME_TEMPLATE_V2.md
  MOZETTO_SESSION_V2.md
  MOZETTO_POKER_EVENT_V1.md
  MOZETTO_RANDOMNESS_V2.md
  MOZETTO_CONTROLLER_V1.md
  MOZETTO_ENERGY_V1.md
  MOZETTO_SETTLEMENT_V3.md
  MOZETTO_PROOF_BATCH_V1.md
  canonical-vectors/
```

Each specification must include:

- version string;
- status (`draft`, `frozen`, `deprecated`);
- normative terms (`MUST`, `MUST NOT`, `SHOULD`);
- exact field ordering and integer widths;
- domain-separation strings;
- hashing algorithm;
- example values;
- invalid examples;
- compatibility rules;
- upgrade/migration rules.

## Canonical primitive rules

### Monetary amounts

- Use unsigned integer USDC base units everywhere.
- One USDC = `1_000_000` units.
- Never use JavaScript floating point for chips, pots, balances, rake, or settlement.
- UI conversion occurs only at display boundaries.

### Cards

Define a canonical card code from `0..51`.

Recommended mapping:

```text
rank index: 0=2, 1=3, ... 8=T, 9=J, 10=Q, 11=K, 12=A
suit index: 0=clubs, 1=diamonds, 2=hearts, 3=spades
card = suitIndex * 13 + rankIndex
```

The exact mapping is less important than freezing it and testing it in all implementations.

### Seats

- Seat indices are `uint8`.
- HU uses seats `0..1`.
- Six-max uses `0..5`.
- An absent seat is not represented by a magic integer; use an explicit optional value.

### Identifiers

- `sessionId`: `bytes32` generated from a canonical session-opening preimage.
- `handId`: `bytes32`, derived from `sessionId + epoch + handNumber`.
- `gameTemplateId`: `bytes32` registry identifier.
- `profileConfigHash`: `bytes32` hash of canonical profile JSON/CBOR.
- `modelPolicyHash`: `bytes32` hash of model, provider, prompt policy, output schema, and reasoning configuration.

### Time

- On-chain expiry uses Unix seconds.
- Game event timing uses monotonic elapsed milliseconds relative to hand start, not wall-clock time, for deterministic replay.
- Wall-clock timestamps are metadata and never affect poker legality.

## Domain separation

Every hash needs a fixed domain string. Examples:

```text
MOZETTO_SESSION_V2
MOZETTO_EVENT_V1
MOZETTO_CARD_LEAF_V1
MOZETTO_DECK_ROOT_V1
MOZETTO_HAND_SEED_V1
MOZETTO_BALANCE_LEAF_V1
MOZETTO_PROFILE_V1
MOZETTO_MODEL_POLICY_V1
MOZETTO_PROOF_BATCH_V1
```

Never reuse a raw hash in two semantic roles.

## Session canonical structure

```text
SessionDescriptorV2
- chainId
- protocolVersion
- sessionId
- gameTemplateId
- participantRoot
- openingBalanceRoot
- controllerRoot
- profileRoot
- dealerSecretRoot
- randomnessPolicyId
- settlementPolicyId
- createdAt
- sealDeadline
- sessionNonce
```

The participant root leaves include:

```text
owner address
ArenaAccount address
seat index
buy-in
controller hash
profile hash
rating pool
rated flag
SeatTicket nonce
```

## Poker event canonical structure

```text
PokerEventV1
- protocolVersion
- sessionId
- epoch
- handNumber
- sequence
- eventType
- actorSeat optional
- publicPayloadHash
- privatePayloadCommitment optional
- elapsedMs
- previousEventHash
- engineHash
```

Hash:

```text
eventHash = keccak256(
  abi.encode(
    DOMAIN_EVENT_V1,
    protocolVersion,
    sessionId,
    epoch,
    handNumber,
    sequence,
    eventType,
    actorSeat,
    publicPayloadHash,
    privatePayloadCommitment,
    elapsedMs,
    previousEventHash,
    engineHash
  )
)
```

Do not hash arbitrary JSON text. Canonicalize payloads through ABI encoding, deterministic CBOR, or another formally defined encoding.

## Controller specification

The poker core asks a controller for an action. It does not know whether the controller is AI, human test input, replay, or fallback.

```text
ControllerRequestV1
- observationHash
- private observation
- public state
- legal actions
- energy state
- action deadline
- controller policy version
```

```text
ControllerResponseV1
- action type
- amount, if applicable
- requested public cadence
- policy reason code
- response nonce
```

The engine ignores any field outside the schema.

## Strategy profile canonical form

Use bounded integer axes, preferably `0..100`:

```text
aggression
riskTolerance
deception
opponentAdaptation
trapPreference
tempo
variancePreference
energyConservation
```

Profiles include:

```text
profileId
profileVersion
presetId
axis values
allowed scheduler weights
createdAt
owner customization version
```

No arbitrary free text is part of ranked Season 1 profile hashing.

## Randomness specification

Freeze:

- private seed generation requirements;
- secret-leaf hashing;
- Merkle tree ordering;
- VRF request binding;
- HKDF or keccak derivation;
- deterministic PRNG;
- Fisher–Yates rejection sampling;
- per-card salt generation;
- deck-root construction;
- proof formats;
- reveal policy.

Avoid modulo bias. Document exact rejection behavior so every verifier derives the same deck.

## Settlement specification

A final settlement contains:

```text
sessionId
finalSequence
finalEventRoot
handRoot
balanceRoot
randomnessEpochId
openingTotal
endingPlayerTotal
totalRake
proofBatchSequence
modelPolicyHash
profileSetHash
deadline
```

Required invariant:

```text
openingTotal == endingPlayerTotal + totalRake
```

Season 1 has no separate AI performance fee or compute fee charged to players.

## Golden vectors

Create at least these fixtures:

1. Two-player session descriptor.
2. Six-player session descriptor.
3. One full preflop action sequence.
4. Incomplete all-in raise.
5. Three-way side pot.
6. Split pot with odd chip.
7. Card leaf and Merkle proof.
8. Dealer secret root and hand seed.
9. Profile hash.
10. Model policy hash for Groq GPT-OSS 120B.
11. Energy ledger for a complete hand.
12. Final settlement and EIP-712 digest.
13. Global proof batch root.
14. Emergency exit balance leaf.

For each vector, store:

```text
human-readable input
canonical bytes hex
keccak256 hash
expected decoded structure
expected failure mutations
```

## Cross-language conformance package

Create:

```text
packages/protocol-vectors-ts
crates/protocol-vectors-rs
contracts/test/ProtocolVectors.t.sol
```

CI must fail if any language disagrees.

## Version change rules

- Additive non-consensus metadata may retain the same version.
- Any change to encoded fields, hashing, poker legality, rake, randomness, or settlement requires a new version.
- Active sessions retain the version they opened with.
- Old versions remain verifiable after deactivation.
- Registry deactivation stops new sessions but never invalidates historical proofs.

## Acceptance checklist

- [ ] Every canonical object has a normative spec.
- [ ] No service hashes raw JSON.
- [ ] Monetary values are integer base units.
- [ ] Domain separation exists for every hash role.
- [x] TS/Rust/Solidity golden vectors match.
- [ ] Invalid vectors fail consistently.
- [ ] Version migration policy is documented.
