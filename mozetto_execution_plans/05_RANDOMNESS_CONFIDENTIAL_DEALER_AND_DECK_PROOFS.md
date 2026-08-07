# 05 — Randomness, Confidential Dealer, and Deck Proofs

**Entry gate:** Session sealing and canonical card/deck encodings are frozen.  
**Exit gate:** A changed, rerolled, duplicated, or predicted deck fails verification while unrevealed cards remain private.

## Security objective

No single party should be able to choose the deck after learning the participants or public VRF result.

The launch protocol combines:

```text
private dealer entropy committed first
+
public Chainlink VRF entropy generated later
=
unique deterministic hand seeds
```

VRF alone cannot be the deck seed because a public seed reveals all future cards.

## Randomness lifecycle

### Step 1 — Dealer secret batch

Inside the confidential dealer environment, generate `N` independent 32-byte secrets:

```text
S[0] ... S[N-1]
```

For Season 1, use `N = 256` unless testing justifies another batch size.

Create leaves:

```text
secretLeaf[i] = keccak256(
  DOMAIN_SECRET_LEAF,
  sessionId,
  randomnessEpoch,
  i,
  S[i]
)
```

Create `dealerSecretRoot` and commit it before VRF request.

### Step 2 — VRF request

Bind one Chainlink VRF request to:

```text
sessionId
randomnessEpoch
dealerSecretRoot
participantRoot
gameTemplateId
```

Store request ID and prevent cancellation/re-request for the same epoch.

### Step 3 — Hand seed

After fulfillment `R`:

```text
handSeed[i] = HKDF-SHA256(
  inputKeyMaterial = S[i],
  salt = bytes32(R),
  info = DOMAIN_HAND_SEED || sessionId || epoch || i
)
```

If using keccak instead of HKDF, freeze the exact construction and conduct cryptographic review.

### Step 4 — Deterministic shuffle

- Start with canonical cards `0..51`.
- Use a specified CSPRNG stream derived from `handSeed`.
- Apply Fisher–Yates from index 51 down to 1.
- Use rejection sampling to remove modulo bias.
- Produce one unique 52-card permutation.

### Step 5 — Per-card commitments

For each position:

```text
cardLeaf[position] = keccak256(
  DOMAIN_CARD_LEAF,
  handId,
  position,
  cardCode,
  cardSalt[position]
)
```

Create `deckRoot`.

### Step 6 — Batch commitment

Create:

```text
deckBatchRoot = MerkleRoot(
  deckRoot[0], deckRoot[1], ... deckRoot[N-1]
)
```

Anchor one batch root on Base. Each hand includes a proof that its deck root is part of the batch.

## Why the dealer still needs attestation

A Merkle root proves immutability, not that the committed values form a valid 52-card deck. Launch security therefore uses an attested dealer binary that:

- constructs the canonical deck;
- applies the frozen shuffle;
- guarantees uniqueness;
- generates salts and roots;
- encrypts cards;
- publishes an attestation tied to the approved binary measurement.

## Confidential dealer V1

Recommended deployment: AWS Nitro Enclaves or an equivalent confidential-compute environment.

### Boundary

The enclave receives:

- sealed session descriptor;
- VRF fulfillment;
- encrypted seed material;
- approved engine/randomness policy.

The parent host must not receive:

- raw hand secrets;
- full deck;
- other players' hole cards;
- private card encryption keys.

### KMS policy

- Dealer secret decryption keys are released only to an enclave with approved PCR measurements.
- Build measurements are published.
- The deployment pipeline produces reproducible enclave images where feasible.
- Key access is logged.

### Dealer output

```text
DealerBatchAttestation
- sessionId
- epoch
- dealerSecretRoot
- VRF request ID/result hash
- deckBatchRoot
- randomnessPolicyHash
- enclave measurement
- createdAt
- signature
```

## Private card delivery

Each seat controller has a per-session encryption identity.

- Hole cards are encrypted only for that seat's controller.
- Human owners of ranked multiway sessions should not receive live hole cards by default.
- Board cards are revealed publicly with card, salt, position, and Merkle proof.
- Showdown cards are opened with proofs.
- Folded cards remain committed but unrevealed.

## Public verification

For a revealed card, anyone verifies:

1. card leaf from card/salt/position;
2. membership in `deckRoot`;
3. deck-root membership in `deckBatchRoot`;
4. deck-batch root anchored to the session/epoch;
5. session references the correct VRF and dealer secret commitment.

## No-reroll rules

The system MUST NOT:

- cancel a VRF request because of an unfavorable result;
- request multiple random values and choose one;
- replace the dealer secret root after request;
- accept new participants after the randomness inputs are bound;
- skip a committed hand index without a public reason and policy.

If a hand is aborted after deck assignment, record the reason and mark that hand index consumed. Never reuse it.

## Dealer service API

Internal only:

```text
POST /internal/dealer/commit-batch
POST /internal/dealer/bind-vrf
POST /internal/dealer/prepare-decks
POST /internal/dealer/open-public-card
POST /internal/dealer/deliver-private-cards
GET  /internal/dealer/attestation/:session/:epoch
```

Every call uses mutual authentication and session/sequence replay protection.

## Randomness contract evolution

### `RandomnessBeaconV2`

Responsibilities:

- register dealer secret root;
- create VRF request;
- bind request ID;
- store fulfillment;
- register deck-batch root and dealer attestation hash;
- prevent reroll/reuse;
- emit public events.

It should not store raw cards or secrets.

## Future V2: zero-knowledge deck proof

Design the launch interfaces so a future proof can demonstrate:

- 52 unique canonical cards;
- correct deterministic shuffle from committed inputs;
- correct deck root;
- correct public card openings;
- no revelation of hidden cards.

The verifier router can accept a ZK proof instead of or in addition to dealer attestation.

## Future V3: threshold/MPC dealer

Replace the single attested dealer with a committee that jointly shuffles encrypted cards and threshold-decrypts only required cards. Maintain the same public session, deck-root, and settlement interfaces.

## Tests

### Determinism

- same secret + VRF + session + index yields identical deck in TS/Rust/verifier;
- one-bit input change yields unrelated deck;
- replay produces identical card roots.

### Validity

- exactly 52 unique cards;
- no modulo bias in shuffle implementation;
- every public proof validates;
- false card or salt fails;
- wrong hand index fails;
- wrong batch proof fails.

### Adversarial

- VRF re-request rejected;
- secret root replacement rejected;
- duplicate hand index rejected;
- consumed aborted deck cannot be reused;
- parent host cannot decrypt KMS-protected secrets without valid attestation;
- two dealer instances cannot issue conflicting accepted roots for one epoch.

## Exit evidence

- Independent CLI reconstructs complete decks in a special fully revealed Anvil test mode.
- Normal mode verifies public/showdown cards without revealing folds.
- Base/Anvil contract state proves secret commitment preceded VRF.
- Operator cannot select among multiple VRF outcomes.
