# WP-050 — RandomnessBeaconV2 contract

**Authority:** frozen `specs/MOZETTO_RANDOMNESS_V2.md`, Plan `05_RANDOMNESS_CONFIDENTIAL_DEALER_AND_DECK_PROOFS.md`  
**Prior:** WP-012 randomness spec freeze; WP-023 SessionLifecycle `RANDOMNESS_PENDING` stubs  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `RandomnessBeaconV2` | `contracts/src/RandomnessBeaconV2.sol` |
| Foundry suite | `contracts/test/RandomnessBeaconV2.t.sol` |
| Anvil deploy | `DeployLocal.s.sol` — beacon with `mockVrfEnabled=true` |
| Sepolia deploy | `DeploySepolia.s.sol` — mock off unless `ENABLE_MOCK_VRF=1` |
| Manifest field | additive `randomnessBeacon` (codegen + `getManifest`) |
| This note | `docs/WP-050_RANDOMNESS_BEACON_V2.md` |

V1 `RandomnessCoordinatorV1` remains deployed for compatibility; Beacon V2 is additive.

---

## Lifecycle (on-chain)

```text
None
  → commitSecretRoot     (dealerSecretRoot + participantRoot + gameTemplateId)
  → requestVrf           (one request id; binding frozen)
  → fulfillMock | fulfillVrf   (one outcome; no shopping)
  → registerDeckBatch    (deckBatchRoot + dealerAttestationHash)
```

| Step | Enforced rule |
|---|---|
| Commit | Secret root unique globally; epoch starts at `SecretCommitted` only from `None` |
| Request | Exactly one VRF request per `(sessionId, randomnessEpoch)`; re-request reverts |
| Fulfill | Exactly one result; second fulfill / alternate mock outcome reverts |
| Deck batch | Only after fulfill; re-register / mutation reverts |
| Storage | No raw cards or dealer secrets — roots and attestation hash only |

`bindingHash = keccak256(abi.encode(sessionId, epoch, dealerSecretRoot, participantRoot, gameTemplateId))`.

`deckBatchBind = keccak256(abi.encode(DOMAIN_DECK_BATCH_V1, sessionId, epoch, deckBatchRoot))` with Protocol V3 domain tag `keccak256(bytes("MOZETTO_DECK_BATCH_V1"))`.

---

## No-reroll / no-shopping

Covered by Foundry mutation tests:

- Secret root replacement (re-commit) rejected  
- Secret root reuse across epochs rejected  
- VRF re-request rejected (before and after fulfill)  
- Double fulfill / second mock outcome rejected  
- Deck batch before fulfill rejected  
- Deck batch re-register rejected  
- Mock fulfill when `mockVrfEnabled=false` rejected  

Timestamps (`committedAt` ≤ `requestedAt` ≤ `fulfilledAt`) provide ordering evidence that secret commitment preceded VRF.

---

## Mock VRF (Anvil)

| Env | Default |
|---|---|
| Anvil `DeployLocal` | `mockVrfEnabled=true`; operator = deployer |
| Sepolia `DeploySepolia` | mock off; opt-in `ENABLE_MOCK_VRF=1` |

`fulfillMock(sessionId, epoch, result)` for local tests. `fulfillVrf(requestId, result)` for fulfiller/operator/owner. `bindExternalRequestId` remaps the local id to a Chainlink request id **once** while still `VrfRequested` (same binding — not a second entropy request). Full Chainlink consumer = WP-053. Deterministic Anvil path = **WP-052** (`docs/WP-052_MOCK_VRF_ANVIL.md`, `MockVrfAnvil.s.sol`, `pnpm e2e:mock-vrf`).

---

## SessionLifecycle coordination

WP-023 stubs remain:

- `SessionLifecycleV2.beginRandomness` / `markReady` store `vrfRequestId` / `deckBatchRoot` as events + fields only.

Integrators SHOULD treat Beacon V2 as the randomness source of truth and mirror roots into lifecycle after each beacon step. Direct lifecycle↔beacon calls are intentionally deferred (no coupling required for WP-050).

---

## Compatibility

| Path | Status |
|---|---|
| `RandomnessCoordinatorV1` | Unchanged; still deployed |
| Frozen `/specs` | Untouched |
| SessionLifecycleV2 | Untouched stubs |
| Nitro Enclave / dealer | Out of scope (WP-054) |
| Hand seed / shuffle / card leaves | Off-chain (WP-051) |

---

## Follow-up

- WP-051 dealer deterministic deck library (handSeed, Fisher–Yates, card leaves)  
- WP-052 Mock VRF Anvil integration — **DONE** (`docs/WP-052_MOCK_VRF_ANVIL.md`)  
- WP-053 Chainlink VRF adapter — **DONE** (`docs/WP-053_CHAINLINK_VRF.md`)  
- WP-054 Nitro Enclave dealer  
- Optional SessionLifecycle hooks to require beacon phase before `markReady`
