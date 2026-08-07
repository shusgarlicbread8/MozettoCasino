# MOZETTO_PROOF_BATCH_V1

| Field | Value |
|---|---|
| **Version string** | `MOZETTO_PROOF_BATCH_V1` |
| **Status** | `frozen` |
| **Work packet** | WP-013 |
| **Domain** | `DOMAIN_PROOF_BATCH_V1` = `keccak256("MOZETTO_PROOF_BATCH_V1")` |

## 1. Normative terms

RFC 2119 **MUST** / **MUST NOT** / **SHOULD** / **MAY**.

## 2. Purpose

Aggregate table checkpoints into a global root anchored on Base via `ProofBatchRegistryV1`, enabling public verification without trusting the Mozetto API.

## 3. Merkle hierarchy

```text
Event hashes
  → HandRoot
  → TableCheckpointRoot
  → GlobalProofBatchRoot
  → Base ProofBatchRegistry
```

## 4. ProofBatch object

| Field | Type |
|---|---|
| `sequence` | `uint64` |
| `previousBatchRoot` | `bytes32` |
| `globalRoot` | `bytes32` |
| `dataManifestHash` | `bytes32` |
| `createdAt` | `uint64` |

```text
proofBatchHash = keccak256(abi.encode(
  DOMAIN_PROOF_BATCH_V1,
  sequence,
  previousBatchRoot,
  globalRoot,
  dataManifestHash,
  createdAt
))
```

On-chain registry SHOULD store the struct fields and MAY store `proofBatchHash`.

### Continuity

- `sequence` MUST be strictly increasing by 1 (or policy-defined monotonic rule; Season 1: +1).
- For `sequence > 0`, `previousBatchRoot` MUST equal the prior batch’s `globalRoot` **or** the prior batch’s `proofBatchHash` — **Season 1 freeze:** `previousBatchRoot` equals the previous entry’s `globalRoot`.
- Duplicate `(sequence)` or duplicate accepted `globalRoot` under reuse policy MUST be rejected.

### `dataManifestHash`

Content-addressed commitment to the off-chain package (transcripts/proofs) needed for independent verification (e.g. CID hash).

### `globalRoot`

Ordered Merkle root over table checkpoint roots included in the batch (stable sort by `(sessionId, checkpointId)` ascending before hashing leaves). Fixture vector 13 uses an explicit ordered leaf list.

## 5. Checkpoint policy

**Initial defaults / hypotheses** (versioned; not proven optima):

| League risk | Checkpoint policy |
|---|---|
| low | every 20 hands or 2 minutes |
| medium | every 10 hands or 1 minute |
| high | every 5 hands |
| very high | every hand |

Proof-batch anchoring MAY be more frequent than balance checkpoints. Testing target interval **2–5 seconds** is an operational hypothesis.

## 6. Registry requirements

`ProofBatchRegistryV1` MUST:

- enforce sequence continuity;
- emit public events;
- restrict publishers initially via authorized role;
- allow publisher replacement through governance/timelock;
- support future watchtower validation.

## 7. Example values

Golden vector `13_proof_batch_root.json`.

## 8. Invalid examples

- Sequence gap or regression.
- Previous root discontinuity.
- Permuting checkpoint leaf order silently.
- Anchoring without increasing sequence.

## 9. Compatibility / upgrade

- New batch fields require `MOZETTO_PROOF_BATCH_V2` and new domain string.
- Historical batches remain verifiable under V1 encoding.
