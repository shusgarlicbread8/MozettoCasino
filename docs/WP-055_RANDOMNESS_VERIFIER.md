# WP-055 — Randomness verifier CLI

**Authority:** frozen `specs/MOZETTO_RANDOMNESS_V2.md`, vectors `07_card_leaf_merkle.json` / `08_dealer_secret_hand_seed.json`  
**Library:** consumes `@mozetto/dealer-deck` (WP-051) + `@mozetto/protocol-vectors`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/randomness-verifier` | `packages/randomness-verifier` |
| Golden verify 07/08 | `src/golden.ts` |
| Mutation failure suite | `src/golden.ts` → `verifyMutations` |
| Public card-opening check | `src/openings.ts` → `verifyCardOpening` |
| CLI | `src/cli.ts` (`pnpm verify:randomness`) |
| Unit tests | `src/randomness-verifier.test.ts` |
| This note | `docs/WP-055_RANDOMNESS_VERIFIER.md` |

No edits to `RandomnessBeaconV2.sol` / Chainlink (WP-053). No Nitro Enclave (WP-054). Specs untouched.

---

## What it verifies

Independent of the dealer HTTP service. Reconstructs and checks:

1. **Vector 08** — `secretLeaf[]`, `dealerSecretRoot`, Season-1 `handSeed[0]`
2. **Vector 07** — fixture salts, `cardLeaf[0]`, `deckRoot`, `merkleProofPosition0`, public opening at position 0
3. **Mutations must fail** (check passes only when rejection is detected):
   - replace `S[0]` → secret root diverges
   - `handSeed = keccak256(R)` only → diverges from golden
   - flip `cardCode` / wrong proof position / wrong salt → Merkle fails
   - duplicate card codes → `assertValidDeck` throws
4. **Ad-hoc openings** — `(handId, position, cardCode, salt, proof)` vs `deckRoot`

---

## Commands

```bash
# Full golden + mutation suite (CI-safe)
pnpm verify:randomness
# equivalent:
pnpm --filter @mozetto/randomness-verifier verify

# JSON report
pnpm verify:randomness -- --json /tmp/wp055.json

# Single public opening file
pnpm verify:randomness -- --opening /path/to/opening.json

# Package tests / typecheck
pnpm --filter @mozetto/randomness-verifier test
pnpm --filter @mozetto/randomness-verifier typecheck
```

### Opening JSON shape

```json
{
  "handId": "0x…",
  "deckRoot": "0x…",
  "position": 0,
  "cardCode": 0,
  "cardSalt": "0x…",
  "proof": [{ "sibling": "0x…", "isLeft": false }]
}
```

Exit code `0` = PASS, `1` = FAIL.

---

## Library API

```ts
import {
  runRandomnessVerification,
  verifyCardOpening,
  verifyVector07,
  verifyVector08,
  verifyMutations,
} from "@mozetto/randomness-verifier";
```

---

## Wave gate

Mutation tests fail (adversarial inputs rejected) and public card proofs pass — exercised by `pnpm verify:randomness`.

---

## Out of scope / follow-up

| Item | Packet |
|---|---|
| Chainlink VRF adapter | WP-053 |
| Nitro Enclave dealer | WP-054 (**DONE** mock scaffold) |
| On-chain beacon / contracts | WP-050 (done; not touched) |
| Public Verify Game page | WP-090 |
| Rust twin of verifier | optional |
