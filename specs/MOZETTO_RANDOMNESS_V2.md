# MOZETTO_RANDOMNESS_V2

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_RANDOMNESS_V2` |
| **Status** | `frozen` |
| **Work packet** | WP-012 |
| **Primary domains** | `SECRET_LEAF`, `HAND_SEED`, `CARD_LEAF`, `DECK_BATCH` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Security objective

No party MUST be able to choose a favorable deck after learning participants or the public VRF result.

```text
private dealer entropy committed first
+ public Chainlink VRF entropy later
= unique deterministic hand seeds
```

VRF alone MUST NOT be the deck seed (public seed would reveal all cards).

## 3. Lifecycle

### Step 1 — Dealer secret batch

Inside the confidential dealer, generate `N` independent 32-byte secrets `S[0]..S[N-1]`.

**Season 1 initial default / hypothesis:** `N = 256` (fixtures MAY use smaller `N` for test vectors).

```text
secretLeaf[i] = keccak256(abi.encode(
  DOMAIN_SECRET_LEAF_V1,
  bytes32 sessionId,
  uint64  randomnessEpoch,
  uint16  index,
  bytes32 S[i]
))
```

`dealerSecretRoot = MerkleRoot(secretLeaf[0..N-1])` (Protocol V3 Merkle).

Commit `dealerSecretRoot` **before** VRF request.

### Step 2 — VRF request binding

Bind one VRF request to:

```text
sessionId, randomnessEpoch, dealerSecretRoot, participantRoot, gameTemplateId
```

The system MUST NOT cancel/re-request for the same epoch to shop for favorable entropy.

### Step 3 — Hand seed (Season 1 keccak construction)

After VRF fulfillment value `R` (treated as `bytes32`):

```text
handSeed[i] = keccak256(abi.encode(
  DOMAIN_HAND_SEED_V1,
  bytes32 S[i],
  bytes32 R,
  bytes32 sessionId,
  uint64  randomnessEpoch,
  uint16  index
))
```

**Note:** Plan 05 also describes HKDF-SHA256. Season 1 draft freezes the **keccak ABI construction above** for cross-language simplicity. A future policy MAY switch to HKDF only under a new `randomnessPolicyId` after cryptographic review. Implementations MUST NOT mix constructions within one epoch.

### Step 4 — Deterministic shuffle

1. Start with cards `0..51` in ascending code order.
2. Derive a CSPRNG stream from `handSeed` (below).
3. Fisher–Yates for `i = 51 down to 1`:
   - draw unbiased `j` in `0..i` via **rejection sampling**;
   - swap `deck[i]` and `deck[j]`.
4. Result MUST be a permutation of 52 unique codes.

#### CSPRNG stream

```text
blockCounter starts at 0
block = keccak256(abi.encode(handSeed, uint64(blockCounter++)))
// consume as big-endian uint32 words from block; when exhausted, next block
```

#### Rejection sampling

To sample uniform `j ∈ [0, i]`:

```text
bound = i + 1
limit = floor(2^32 / bound) * bound
repeat:
  x = nextUint32()
  if x < limit: return x % bound
```

Implementations MUST NOT use raw `x % bound` without rejection (legacy `packages/game-rules` shuffle is non-conformant for V3).

### Step 5 — Per-card commitments

```text
cardSalt[position] = keccak256(abi.encode(handSeed, uint8(position), bytes32("MOZETTO_CARD_SALT_V1")))
```

Production dealers MUST use CSPRNG salts; the formula above is the **normative deterministic salt** for verifiers that reconstruct from `handSeed` in fully-revealed test mode. Confidential production MAY use independent salts if committed consistently; Season 1 attested dealer MUST document which. Golden vector 07 uses `keccak256(bytes("card-salt-{i}"))` as **fixture-only** salts — verifiers of that vector MUST use the fixture salts, not the production formula.

```text
cardLeaf[position] = keccak256(abi.encode(
  DOMAIN_CARD_LEAF_V1,
  bytes32 handId,
  uint8   position,
  uint8   cardCode,
  bytes32 cardSalt[position]
))
```

`deckRoot = MerkleRoot(cardLeaf[0..51])`.

### Step 6 — Deck batch

```text
deckBatchRoot = MerkleRoot(deckRoot[0] .. deckRoot[N-1])
```

Optionally bind:

```text
keccak256(abi.encode(DOMAIN_DECK_BATCH_V1, sessionId, randomnessEpoch, deckBatchRoot))
```

Anchor `deckBatchRoot` on Base. Each hand proves membership of its `deckRoot`.

## 4. No-reroll rules

The system MUST NOT:

- cancel VRF because of an unfavorable result;
- request multiple random values and select one;
- replace `dealerSecretRoot` after request;
- accept new participants after randomness inputs are bound;
- reuse a consumed hand index after abort.

Aborted hands after deck assignment MUST record a public reason and consume the index.

## 5. Reveal policy

- Board / showdown cards: reveal `(cardCode, salt, position)` + Merkle proof to `deckRoot` (+ batch proof).
- Folded hole cards: remain committed; MUST NOT reveal by default.
- Ranked multiway: human owners SHOULD NOT receive live opponent hole cards.

## 6. Attestation (non-hash, normative interface)

Launch security uses an attested dealer binary. A Merkle root proves immutability, not deck validity. Dealer attestation binds:

```text
sessionId, epoch, dealerSecretRoot, vrfId/resultHash, deckBatchRoot,
randomnessPolicyHash, enclaveMeasurement, createdAt, signature
```

ZK deck proofs and MPC dealers are future versions with stable public interfaces.

## 7. Example values

Golden vectors `07_card_leaf_merkle.json`, `08_dealer_secret_hand_seed.json`.

## 8. Invalid examples

- `handSeed = keccak256(R)` without `S[i]`.
- Modulo-biased shuffle.
- Duplicate card codes.
- Secret root replacement post-VRF.
- Predicting cards from public VRF alone.

## 9. Compatibility

- Legacy HMAC shuffle in `packages/game-rules` is **not** Randomness V2.
- Card code mapping matches Protocol V3 / current suit-major deck order.

## 10. Upgrade / migration

- Changing seed derivation, salt scheme, Merkle padding, or shuffle requires a new randomness policy / version.
- Active epochs MUST keep their sealed policy id.
