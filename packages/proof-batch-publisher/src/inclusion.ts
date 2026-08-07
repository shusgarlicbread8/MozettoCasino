import {
  proofForIndex,
  verifyMerkleProof,
  type MerkleProofStep,
} from "@mozetto/root-builder";
import type { Hex } from "viem";
import { sortCheckpointLeaves } from "./sort.js";
import type { CheckpointInclusionProof, CheckpointLeaf } from "./types.js";

/** Build Merkle inclusion proofs for every checkpoint leaf under globalRoot. */
export function buildInclusionProofs(
  checkpoints: readonly CheckpointLeaf[],
  globalRoot: Hex,
): CheckpointInclusionProof[] {
  const ordered = sortCheckpointLeaves(checkpoints);
  const roots = ordered.map((c) => c.checkpointRoot);
  return ordered.map((c, leafIndex) => ({
    sessionId: c.sessionId,
    checkpointId: c.checkpointId,
    checkpointRoot: c.checkpointRoot,
    leafIndex,
    proof: proofForIndex(roots, leafIndex),
    globalRoot,
  }));
}

export function verifyCheckpointInclusion(
  checkpointRoot: Hex,
  proof: readonly MerkleProofStep[],
  globalRoot: Hex,
): boolean {
  return verifyMerkleProof(checkpointRoot, proof, globalRoot);
}
