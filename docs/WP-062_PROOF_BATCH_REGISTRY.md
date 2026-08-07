# WP-062 — ProofBatchRegistryV1

**Authority:** frozen `specs/MOZETTO_PROOF_BATCH_V1.md` (+ golden vector 13), Plan `10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`  
**Prior:** WP-013 proof-batch spec freeze; WP-060/061 event/root builders (parallel)  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| `ProofBatchRegistryV1` | `contracts/src/ProofBatchRegistryV1.sol` |
| Foundry suite | `contracts/test/ProofBatchRegistryV1.t.sol` (vector 13 digests + continuity mutations) |
| Anvil deploy | `DeployLocal.s.sol` — publisher = deployer, `minDelay=0` |
| Sepolia deploy | `DeploySepolia.s.sol` — default `PROOF_BATCH_REGISTRY_MIN_DELAY=1 days` |
| Publisher stub | `contracts/script/PublishProofBatchAnvil.s.sol` (+ `pnpm e2e:proof-batch`) |
| Manifest field | additive `proofBatchRegistry` (codegen + `getManifest`) |
| This note | `docs/WP-062_PROOF_BATCH_REGISTRY.md` |

`CheckpointRegistryV1` remains the per-session history anchor; ProofBatchRegistry is the **global** Season-1 batch chain on Base.

---

## Encoding (frozen)

```text
proofBatchHash = keccak256(abi.encode(
  DOMAIN_PROOF_BATCH_V1,   // keccak256("MOZETTO_PROOF_BATCH_V1")
  sequence,                // uint64
  previousBatchRoot,       // bytes32
  globalRoot,              // bytes32
  dataManifestHash,        // bytes32
  createdAt                // uint64
))
```

`globalRoot` is an ordered Merkle root over table checkpoint roots (pad to power-of-two with zero leaves). Vector 13 pins three checkpoint leaves → `globalRoot` + full `proofBatchHash`.

---

## Continuity rules (Season 1)

| Rule | Enforcement |
|---|---|
| Sequence +1 | `batch.sequence == nextSequence` (starts at 0) |
| Genesis previous | `sequence == 0` ⇒ `previousBatchRoot == bytes32(0)` |
| Prior link | `sequence > 0` ⇒ `previousBatchRoot == batches[sequence-1].globalRoot` |
| No duplicate root | `usedGlobalRoots[globalRoot]` rejects reuse |
| Zero root | `globalRoot == 0` rejected |
| Publisher role | only `publisher` may `registerBatch` |
| Publisher replace | owner schedules → timelock `minDelay` → execute |

Events: `ProofBatchRegistered` (public), plus publisher schedule/update/cancel.

---

## Anvil publisher stub

Full continuous publisher + settlement worker = **WP-084/085**. This packet ships a Foundry stub that registers one continuity-valid batch (fresh deploy or existing registry):

```bash
# Against a running Anvil with DeployLocal addresses:
PROOF_BATCH_REGISTRY_ADDRESS=0x... \
  forge script script/PublishProofBatchAnvil.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast

# Or via root helper (deploys registry if env unset):
pnpm e2e:proof-batch
```

---

## Compatibility

| Path | Status |
|---|---|
| Frozen `/specs` | Untouched |
| `CheckpointRegistryV1` | Unchanged; still deployed |
| SettlementHubV3 / VerifierRouter | WP-063 — uses `isSequenceAccepted` gate (optional) |
| Full proof-batch publisher worker | Out of scope (WP-085) |
| Emergency exit | Out of scope (WP-066) |

---

## Hub V3 / settlement coordination

`isSequenceAccepted(uint64)` is the WP-063 SettlementHubV3 gate. Deploy scripts wire the registry into Hub V3 with **`requireProofBatch=false`** by default so demos can settle without publishing batches. See [`docs/WP-063_SETTLEMENT_HUB_V3.md`](WP-063_SETTLEMENT_HUB_V3.md).

## Follow-up

- WP-084 Settlement worker V3  
- WP-085 Proof-batch publisher — **DONE** (`packages/proof-batch-publisher`, `docs/WP-085_PROOF_BATCH_PUBLISHER.md`)  
- WP-090 Public Verify Game page can read `ProofBatchRegistered` events  
