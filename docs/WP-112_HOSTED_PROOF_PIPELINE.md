# WP-112 — Hosted proof pipeline

**Authority:** WP-085 proof-batch publisher, WP-090 Verify Game (+ inclusion follow-up), frozen `specs/MOZETTO_PROOF_BATCH_V1.md`  
**Prior residual:** Continuous `CheckpointSource` feeder from game-server / settlement  
**Date:** 2026-08-07

---

## Goal

Wire **continuous** checkpoint emission → proof-batch publisher → SQL inclusion store → Verify API/UI for hosted / Anvil ops.

```text
game-server (hand settle) / settlement-worker (tip poll)
  → session_checkpoints (+ checkpoint_root)
  → SqlCheckpointSource.drainPending (claim)
  → ProofBatchPublisher → ProofBatchRegistryV1.registerBatch
  → createSqlInclusionProofStore → proof_batches + proof_batch_inclusion_proofs
  → GET /v1/verify/sessions/:id → Verify page (proofBatchInclusion)
```

No fake on-chain registry addresses — set `PROOF_BATCH_REGISTRY_ADDRESS` from DeployLocal / chain manifest.

---

## Delivered

| Item | Location |
|---|---|
| Migration claim/ack columns | `packages/database/migrations/031_session_checkpoint_proof_batch.sql` |
| Season-1 `buildTableCheckpointRoot` | `packages/proof-batch-publisher/src/checkpoint-root.ts` |
| `SqlCheckpointSource` | `packages/proof-batch-publisher/src/sql-source.ts` |
| Continuous runner (SQL source + SQL inclusion) | `packages/proof-batch-publisher/src/run.ts` |
| Optional publisher image | `Dockerfile.publisher` |
| Settlement tip emitter + CheckpointRegistryV1 anchor | `services/settlement-worker/src/checkpoints.ts` |
| Game-server hand-settle checkpoints (when WP-108 roots path active) | `persistSessionCheckpoint` → `session_checkpoints.checkpoint_root` |
| Verify path (unchanged surface) | WP-090 `services/api/src/verify.ts` + web verify page |
| This note | `docs/WP-112_HOSTED_PROOF_PIPELINE.md` |

Frozen `/specs` untouched. Registry contract unchanged.

---

## Season-1 TableCheckpointRoot

Typed `DOMAIN_TABLE_CHECKPOINT` is not frozen (WP-061 deferral). Operational binding:

```text
checkpointRoot = keccak256(abi.encode(eventRoot, balanceRoot))
```

Stored on `session_checkpoints.checkpoint_root` and used as the Merkle leaf under `globalRoot`.

---

## Continuous publisher (hosted / Anvil)

```bash
# Apply claim columns + existing inclusion tables
pnpm --filter @mozetto/database migrate   # includes 023 + 031

export PROOF_BATCH_REGISTRY_ADDRESS=0x…   # from DeployLocal / manifest — never invent
export PROOF_BATCH_PUBLISHER_PRIVATE_KEY=0x…  # must be registry.publisher (Anvil #0 locally)
export RPC_URL=http://127.0.0.1:8545
export CHAIN_ID=31337
export DATABASE_URL=postgres://…

# Continuous loop: SqlCheckpointSource + SQL inclusion persist
pnpm --filter @mozetto/proof-batch-publisher start

# One-shot demo (memory leaves; still writes SQL inclusion when DATABASE_URL set)
PROOF_BATCH_DEMO_LEAVES=1 pnpm --filter @mozetto/proof-batch-publisher start
```

| Env | Role |
|---|---|
| `DATABASE_URL` | Enables `SqlCheckpointSource` + `createSqlInclusionProofStore` |
| `PROOF_BATCH_INTERVAL_MS` | Loop interval (default `3000`) |
| `PROOF_BATCH_DRAIN_LIMIT` | Max leaves per tick (default `64`) |
| `PROOF_BATCH_CLAIM_TTL_SECONDS` | Stale claim reclaim (default `300`) |
| `PROOF_BATCH_INCLUSION_DIR` | JSON fallback when no `DATABASE_URL` |
| `PROOF_BATCH_DEMO_LEAVES=1` | One-shot demo batch (exits) |

Docker: `Dockerfile.publisher` — same env surface as the local `start` script.

Settlement-worker continues to emit SQL checkpoints on its poll loop (and optionally anchors `CheckpointRegistryV1` when `CHECKPOINT_REGISTRY_ADDRESS` is set). Game-server writes checkpoints at hand settle when WP-108 real roots path is active.

---

## Verify path

When inclusion rows exist for a session:

1. API `proofBatchInclusion.status = ok` and `proofs[]` populated  
2. Web `/verify/[sessionId]` shows Merkle inclusion section  
3. Missing proofs remain `missing` — Plan 10 categories unchanged (WP-090 rule)

```bash
# After a published batch including session S:
curl -s "$API_URL/v1/verify/sessions/$S" | jq '.proofBatchInclusion'
```

---

## Commands / evidence

```bash
pnpm --filter @mozetto/proof-batch-publisher test
pnpm --filter @mozetto/proof-batch-publisher typecheck
pnpm --filter @mozetto/settlement-worker test
pnpm --filter @mozetto/settlement-worker typecheck
```

---

## Compatibility

| Path | Status |
|---|---|
| Frozen `/specs` | Untouched |
| WP-085 publisher library | Extended (`SqlCheckpointSource`, ack on loop) |
| WP-090 Verify | Consumes SQL inclusion rows; no category changes |
| WP-062 registry | Unchanged submitter surface |
| Hub `requireProofBatch` | Still off by default until staging continuous ops proven |

---

## Completion template

```
Work packet: WP-112
Status: DONE
Artifacts:
- packages/database/migrations/031_session_checkpoint_proof_batch.sql
- packages/proof-batch-publisher/src/{checkpoint-root,sql-source,run}.ts
- services/settlement-worker/src/checkpoints.ts
- services/game-server/src/roots/canonical-roots.ts (checkpoint_root)
- Dockerfile.publisher
- docs/WP-112_HOSTED_PROOF_PIPELINE.md
- mozetto_execution_plans/PROGRESS.md
Commands:
- pnpm --filter @mozetto/proof-batch-publisher test
- pnpm --filter @mozetto/proof-batch-publisher typecheck
- pnpm --filter @mozetto/settlement-worker test
Spec clauses: none mutated; MOZETTO_PROOF_BATCH_V1 Season-1 operational binding for TableCheckpointRoot
Follow-up: enable Hub requireProofBatch in staging; optional CID dataManifestHash upload
```
