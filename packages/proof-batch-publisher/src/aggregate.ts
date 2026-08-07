import { buildProofBatch } from "@mozetto/root-builder";
import type { Hex } from "viem";
import { assertContinuityLink } from "./continuity.js";
import { ProofBatchPublisherError } from "./errors.js";
import { buildInclusionProofs } from "./inclusion.js";
import { buildDataManifestHash } from "./manifest.js";
import { orderedCheckpointRoots, sortCheckpointLeaves } from "./sort.js";
import type {
  ContinuityState,
  DataManifestInput,
  PreparedProofBatch,
  CheckpointLeaf,
} from "./types.js";

export type PrepareBatchOptions = {
  continuity: ContinuityState;
  checkpoints: readonly CheckpointLeaf[];
  createdAt: bigint;
  manifest?: DataManifestInput;
};

/**
 * Aggregate ordered checkpoint roots → globalRoot → proofBatchHash.
 * Does not submit on-chain; caller registers via RegistryClient.
 */
export function prepareProofBatch(opts: PrepareBatchOptions): PreparedProofBatch {
  const { continuity, createdAt } = opts;
  if (opts.checkpoints.length === 0) {
    throw new ProofBatchPublisherError(
      "EMPTY_BATCH",
      "Cannot prepare a proof batch with zero checkpoint leaves",
    );
  }

  const checkpoints = sortCheckpointLeaves(opts.checkpoints);
  const orderedRoots = orderedCheckpointRoots(checkpoints);
  const dataManifestHash = buildDataManifestHash(checkpoints, opts.manifest ?? {});
  const previousBatchRoot = continuity.previousBatchRoot;

  assertContinuityLink(continuity, continuity.nextSequence, previousBatchRoot);

  const batch = buildProofBatch({
    sequence: continuity.nextSequence,
    previousBatchRoot,
    checkpointRoots: orderedRoots,
    dataManifestHash,
    createdAt,
  });

  if (batch.globalRoot.toLowerCase() ===
    "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new ProofBatchPublisherError(
      "ZERO_GLOBAL_ROOT",
      "globalRoot must be non-zero",
    );
  }

  const inclusionProofs = buildInclusionProofs(checkpoints, batch.globalRoot);

  return {
    continuity,
    checkpoints,
    orderedRoots: orderedRoots.map((r) => r.toLowerCase() as Hex),
    dataManifestHash: dataManifestHash.toLowerCase() as Hex,
    createdAt,
    batch,
    inclusionProofs,
  };
}
