import { proofBatchLeaf } from "@mozetto/protocol-vectors";
import type { Hex } from "viem";
import { merkleRoot } from "./merkle.js";
import type { ProofBatchInput, ProofBatchResult } from "./types.js";

/**
 * Ordered Merkle root over table checkpoint roots (MOZETTO_PROOF_BATCH_V1 §4).
 * Caller MUST supply leaves already sorted by (sessionId, checkpointId) ascending.
 */
export function buildGlobalProofBatchRoot(checkpointRoots: readonly Hex[]): Hex {
  return merkleRoot([...checkpointRoots]).root;
}

/** Encode ProofBatch object hash + globalRoot from ordered checkpoint leaves. */
export function buildProofBatch(input: ProofBatchInput): ProofBatchResult {
  const globalRoot = buildGlobalProofBatchRoot(input.checkpointRoots);
  const hashed = proofBatchLeaf({
    sequence: input.sequence,
    previousBatchRoot: input.previousBatchRoot,
    globalRoot,
    dataManifestHash: input.dataManifestHash,
    createdAt: input.createdAt,
  });
  return {
    sequence: input.sequence,
    previousBatchRoot: input.previousBatchRoot,
    globalRoot,
    dataManifestHash: input.dataManifestHash,
    createdAt: input.createdAt,
    canonicalBytesHex: hashed.canonicalBytesHex,
    proofBatchHash: hashed.hash,
  };
}
