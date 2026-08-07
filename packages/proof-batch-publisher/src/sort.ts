import type { Hex } from "viem";
import type { CheckpointLeaf } from "./types.js";

/** Lexicographic compare of 0x-prefixed 32-byte hex (case-insensitive). */
export function compareBytes32(a: Hex, b: Hex): number {
  const aa = a.toLowerCase();
  const bb = b.toLowerCase();
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

/**
 * Stable sort by (sessionId, checkpointId) ascending — MOZETTO_PROOF_BATCH_V1 §4.
 * Does not mutate the input array.
 */
export function sortCheckpointLeaves(
  leaves: readonly CheckpointLeaf[],
): CheckpointLeaf[] {
  return [...leaves].sort((x, y) => {
    const bySession = compareBytes32(x.sessionId, y.sessionId);
    if (bySession !== 0) return bySession;
    if (x.checkpointId < y.checkpointId) return -1;
    if (x.checkpointId > y.checkpointId) return 1;
    return 0;
  });
}

/** Extract ordered checkpoint roots after normative sort. */
export function orderedCheckpointRoots(
  leaves: readonly CheckpointLeaf[],
): Hex[] {
  return sortCheckpointLeaves(leaves).map((l) => l.checkpointRoot);
}
