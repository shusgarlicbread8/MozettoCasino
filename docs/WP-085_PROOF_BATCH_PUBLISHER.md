# WP-085 — Proof-batch publisher

**Authority:** frozen `specs/MOZETTO_PROOF_BATCH_V1.md` (+ golden vector 13), WP-062 `ProofBatchRegistryV1`, `@mozetto/root-builder`  
**Plan:** `mozetto_execution_plans/10_EVENT_LOG_PROOF_BATCHING_SETTLEMENT_AND_VERIFICATION.md`  
**Date:** 2026-08-07

---

## Delivered

| Item | Location |
|---|---|
| Package `@mozetto/proof-batch-publisher` | `packages/proof-batch-publisher` |
| Aggregate + sort `(sessionId, checkpointId)` | `sortCheckpointLeaves` / `prepareProofBatch` |
| Continuity cursor (sequence +1, prior `globalRoot`) | `ContinuityState` / `advanceContinuity` |
| `dataManifestHash` builder | `buildDataManifestHash` |
| Checkpoint inclusion proofs under `globalRoot` | `buildInclusionProofs` / `verifyCheckpointInclusion` |
| Mock registry (unit tests) | `MockRegistryClient` |
| Viem `registerBatch` client | `createViemRegistryClient` |
| Publisher + interval loop | `ProofBatchPublisher` / `runPublisherLoop` |
| Optional local runner | `pnpm --filter @mozetto/proof-batch-publisher start` |
| Tests | `packages/proof-batch-publisher/src/publisher.test.ts` |
| This note | `docs/WP-085_PROOF_BATCH_PUBLISHER.md` |

Frozen `/specs` untouched. Registry contract unchanged (WP-062). Full settlement cutover remains WP-084.

---

## Flow

```text
pending CheckpointLeaf[]
  → sort by (sessionId, checkpointId) ascending
  → ordered Merkle globalRoot          (@mozetto/root-builder)
  → ProofBatch { sequence, previousBatchRoot, globalRoot, dataManifestHash, createdAt }
  → proofBatchHash = DOMAIN_PROOF_BATCH_V1 encode
  → ProofBatchRegistryV1.registerBatch
  → advance continuity (nextSequence += 1, previousBatchRoot = globalRoot)
```

Season-1 continuity (matches on-chain):

| Rule | Behavior |
|---|---|
| Sequence | `batch.sequence == nextSequence` (+1) |
| Genesis | `sequence == 0` ⇒ `previousBatchRoot == bytes32(0)` |
| Link | `sequence > 0` ⇒ `previousBatchRoot == prior.globalRoot` |
| Roots | non-zero; no duplicate `globalRoot` |

Target operational interval during testing: **2–5 seconds** (`PROOF_BATCH_INTERVAL_MS`, default 3000). Empty drains skip (no zero-root tx).

---

## API surface

```ts
import {
  ProofBatchPublisher,
  MockRegistryClient,
  MemoryCheckpointSource,
  createViemRegistryClient,
  prepareProofBatch,
  runPublisherLoop,
} from "@mozetto/proof-batch-publisher";

const registry = new MockRegistryClient(); // or createViemRegistryClient(...)
const publisher = new ProofBatchPublisher({ registry });
await publisher.syncFromRegistry();

const source = new MemoryCheckpointSource();
source.enqueue({ sessionId, checkpointId, checkpointRoot });

const result = await publisher.publishFromSource(source);
// result.prepared.batch.globalRoot / proofBatchHash
// result.prepared.inclusionProofs — Merkle path for each leaf
// result.register.txHash — when using viem client
```

### Checkpoint feeder

Production should implement `CheckpointSource.drainPending()` over table checkpoint roots produced by the game/settlement path. Until that feeder is wired, the optional runner idles on empty drains or publishes a demo batch with `PROOF_BATCH_DEMO_LEAVES=1`.

---

## Local Anvil

```bash
# Registry from DeployLocal / WP-062 stub:
export PROOF_BATCH_REGISTRY_ADDRESS=0x...
export PROOF_BATCH_PUBLISHER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export CHAIN_ID=31337
export RPC_URL=http://127.0.0.1:8545

PROOF_BATCH_DEMO_LEAVES=1 pnpm --filter @mozetto/proof-batch-publisher start

# Foundry one-shot (WP-062) still available:
pnpm e2e:proof-batch
```

Publisher key **MUST** be the authorized `ProofBatchRegistryV1.publisher` (DeployLocal: deployer / Anvil #0).

---

## Commands / evidence

```bash
pnpm --filter @mozetto/proof-batch-publisher test
pnpm --filter @mozetto/proof-batch-publisher typecheck
```

---

## Compatibility

| Path | Status |
|---|---|
| Frozen `/specs` | Untouched |
| WP-061 `@mozetto/root-builder` | Consumed for `globalRoot` / `proofBatchHash` |
| WP-062 registry | Unchanged; publisher is the off-chain submitter |
| WP-063 Hub `requireProofBatch` | Still off by default; settlements MAY reference accepted sequences |
| Persistent checkpoint store / CID upload | Deferred (manifest hash supports explicit CID digest) |
| Settlement worker V3 cutover | WP-084 |

---

## Follow-up

- Wire game-server / settlement-worker checkpoint emission into `CheckpointSource`
- Enable Hub `requireProofBatch` once publisher is continuous in staging

### WP-090/085 inclusion-proof follow-up (DONE)

Persisted public inclusion evidence after accepted `registerBatch`:

| Item | Location |
|---|---|
| `InclusionProofStore` + serialize helpers | `packages/proof-batch-publisher/src/persist.ts` |
| `PublisherOptions.inclusionStore` hook | `ProofBatchPublisher.publish` |
| Memory / JSON file / SQL (`createSqlInclusionProofStore`) | same module |
| Postgres tables | migration `023_proof_batch_inclusion.sql` |
| Verify Game surfacing | WP-090 follow-up note in `docs/WP-090_VERIFY_GAME.md` |

```ts
import {
  ProofBatchPublisher,
  MockRegistryClient,
  MemoryInclusionProofStore,
  createSqlInclusionProofStore,
} from "@mozetto/proof-batch-publisher";

const inclusionStore = new MemoryInclusionProofStore();
// or: createSqlInclusionProofStore((text, params) => query(text, params))
const publisher = new ProofBatchPublisher({ registry, inclusionStore });
```

Local runner writes JSON when `PROOF_BATCH_INCLUSION_DIR` is set.
