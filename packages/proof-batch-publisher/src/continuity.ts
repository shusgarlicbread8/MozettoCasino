import type { Hex } from "viem";
import { ProofBatchPublisherError } from "./errors.js";
import type { ContinuityState } from "./types.js";

export const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Genesis continuity (no batches accepted yet). */
export function genesisContinuity(): ContinuityState {
  return {
    nextSequence: 0n,
    previousBatchRoot: ZERO_ROOT,
    hasBatches: false,
  };
}

/**
 * Validate that a candidate batch links correctly to the local continuity cursor.
 * Season 1: sequence +1; previousBatchRoot == prior globalRoot (or 0 at genesis).
 */
export function assertContinuityLink(
  state: ContinuityState,
  sequence: bigint,
  previousBatchRoot: Hex,
): void {
  if (sequence !== state.nextSequence) {
    throw new ProofBatchPublisherError(
      "SEQUENCE_GAP",
      `Expected sequence ${state.nextSequence}, got ${sequence}`,
    );
  }
  const expectedPrev = state.previousBatchRoot.toLowerCase();
  const gotPrev = previousBatchRoot.toLowerCase();
  if (expectedPrev !== gotPrev) {
    throw new ProofBatchPublisherError(
      "CONTINUITY_BROKEN",
      `previousBatchRoot mismatch: expected ${expectedPrev}, got ${gotPrev}`,
    );
  }
  if (sequence === 0n && gotPrev !== ZERO_ROOT) {
    throw new ProofBatchPublisherError(
      "CONTINUITY_BROKEN",
      "sequence 0 requires previousBatchRoot == bytes32(0)",
    );
  }
}

/** Advance continuity after a successful on-chain registration. */
export function advanceContinuity(
  state: ContinuityState,
  published: { sequence: bigint; globalRoot: Hex },
): ContinuityState {
  if (published.sequence !== state.nextSequence) {
    throw new ProofBatchPublisherError(
      "SEQUENCE_GAP",
      `Cannot advance: published sequence ${published.sequence} != next ${state.nextSequence}`,
    );
  }
  if (published.globalRoot.toLowerCase() === ZERO_ROOT) {
    throw new ProofBatchPublisherError(
      "ZERO_GLOBAL_ROOT",
      "globalRoot must be non-zero",
    );
  }
  return {
    nextSequence: published.sequence + 1n,
    previousBatchRoot: published.globalRoot.toLowerCase() as Hex,
    hasBatches: true,
  };
}
