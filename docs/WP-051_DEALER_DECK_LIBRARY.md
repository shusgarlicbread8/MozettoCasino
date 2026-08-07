# WP-051 — Dealer deterministic deck library

**Authority:** frozen `specs/MOZETTO_RANDOMNESS_V2.md`, Plan `05_RANDOMNESS_CONFIDENTIAL_DEALER_AND_DECK_PROOFS.md`  
**Vectors:** `07_card_leaf_merkle.json`, `08_dealer_secret_hand_seed.json`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Hand seed (Season-1 keccak ABI) | `packages/dealer-deck` → `handSeedV2` / `@mozetto/protocol-vectors` |
| CSPRNG + rejection-sampled Fisher–Yates | `packages/dealer-deck/src/csprng.ts`, `shuffle.ts` |
| Card salts (production + fixture) | `packages/dealer-deck/src/salts.ts` |
| Card leaves, deckRoot, Merkle proofs | `packages/dealer-deck/src/deck.ts` |
| Secret leaves, dealerSecretRoot, deckBatchRoot | `packages/dealer-deck/src/batch.ts` |
| Golden + mutation tests | `packages/dealer-deck/src/dealer-deck.test.ts` |
| Dealer service wire | `services/dealer/src/secrets.ts`, `index.ts` |
| This note | `docs/WP-051_DEALER_DECK_LIBRARY.md` |

No edits to `RandomnessBeaconV2.sol` (WP-050). No Nitro Enclave (WP-054). Specs untouched.

---

## Constructions (Randomness V2)

```text
secretLeaf[i] = keccak256(abi.encode(DOMAIN_SECRET_LEAF_V1, sessionId, epoch, index, S[i]))
handSeed[i]   = keccak256(abi.encode(DOMAIN_HAND_SEED_V1, S[i], R, sessionId, epoch, index))

CSPRNG block  = keccak256(abi.encode(handSeed, uint64(blockCounter++)))
              → big-endian uint32 words; rejection sample j ∈ [0, i]

Fisher–Yates  i = 51 .. 1: swap(deck[i], deck[j])

cardSalt[pos] = keccak256(abi.encode(handSeed, uint8(pos), bytes32("MOZETTO_CARD_SALT_V1")))
                (fixture vector 07 uses keccak256(bytes("card-salt-{i}")) instead)

cardLeaf[pos] = keccak256(abi.encode(DOMAIN_CARD_LEAF_V1, handId, pos, cardCode, salt))
deckRoot      = MerkleRoot(cardLeaf[0..51])   // Protocol V3 ordered + zero-pad
deckBatchRoot = MerkleRoot(deckRoot[0..N-1])
```

Legacy HMAC shuffle in `packages/game-rules` remains for the live TS engine until a later cutover; it is **not** Randomness V2.

---

## API surface

```ts
import {
  handSeedV2,
  shuffleDeckV2,
  prepareHandDeck,
  prepareDeckBatch,
  openCard,
  verifyMerkleProof,
  identityFixtureDeck,
} from "@mozetto/dealer-deck";
```

Dealer HTTP (policy-tagged `MOZETTO_RANDOMNESS_V2`):

| Method | Path | Role |
|---|---|---|
| POST | `/v1/dealer/commit` | CSPRNG secrets → `dealerSecretRoot` |
| POST | `/v1/dealer/hand-seed` | Season-1 keccak `handSeed` |
| POST | `/v1/dealer/prepare-deck` | Shuffle + commit `deckRoot` (codes not returned) |
| POST | `/v1/dealer/open-public-card` | `(cardCode, salt, proof)` for one position |

---

## Tests / evidence

```bash
pnpm --filter @mozetto/dealer-deck test
pnpm --filter @mozetto/dealer-deck typecheck
```

Coverage:

- Vector 08: secret leaf, `handSeed0`, `dealerSecretRoot`
- Vector 07: leaf0, `deckRoot`, `merkleProofPosition0`
- Mutations: replaced secret, VRF-only seed, flipped cardCode, wrong position proof, duplicate codes
- Shuffle: determinism, avalanche, rejection redraw, public opening verify

---

## Out of scope / follow-up

| Item | Packet |
|---|---|
| `RandomnessBeaconV2` on-chain lifecycle | WP-050 |
| Mock / Chainlink VRF adapters | WP-052 / WP-053 |
| Nitro Enclave + KMS private delivery | WP-054 (**DONE** scaffold/mock; live Nitro ops follow-up) |
| Independent randomness verifier CLI | WP-055 |
| Rust twin of this library | optional for WP-055 |
| Engine cutover from HMAC shuffle | later (live engine still `game-rules`) |

**Security note:** Dealer secret preimages stay in process memory for local/dev. Production must move entropy into the attested enclave (WP-054); DB only stores `dealerSecretRoot`.
