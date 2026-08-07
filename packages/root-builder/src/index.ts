export type {
  BalanceLeafInput,
  BalanceRootResult,
  EncodedBalanceLeaf,
  EventChainTipSource,
  EventHashLike,
  FinalSettlementInput,
  FinalSettlementResult,
  HandRootInput,
  HandRootResult,
  MerkleProofStep,
  ProofBatchInput,
  ProofBatchResult,
} from "./types.js";

export {
  RootBuilderError,
  buildBalanceRoot,
  encodeBalanceLeaf,
  balanceProofForSeat,
  verifyBalanceInclusion,
} from "./balance-root.js";

export {
  resolveEventChainTip,
  tipForHand,
  buildHandRoot,
  buildHandRootFromEvents,
} from "./hand-root.js";

export { buildGlobalProofBatchRoot, buildProofBatch } from "./proof-batch.js";

export {
  checkConservation,
  assertConservation,
  randomnessEpochId,
  buildFinalSettlementDigest,
} from "./settlement.js";

export {
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  proofForIndex,
  ZERO32,
} from "./merkle.js";

/** WP-108 — session settlement roots (no stub seeds). */
export {
  buildCanonicalSettlementRoots,
  requireRealRoots,
  assertRealRoot,
  StubRootError,
  type HandRootBuildInput,
  type BuildCanonicalSettlementRootsInput,
  type CanonicalSettlementRoots,
} from "./session-roots.js";

/** Re-export frozen encoders used by root builders. */
export {
  balanceLeaf,
  handRoot,
  proofBatchLeaf,
  settlementEip712Digest,
  deriveHandId,
} from "@mozetto/protocol-vectors";
