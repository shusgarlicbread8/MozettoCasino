export type {
  WatchtowerStatus,
  CheckResult,
  PublicProofBatch,
  PublicBatchSource,
  PublicCheckpointLeaf,
  PublicInclusionClaim,
  PublicBalanceLeaf,
  PublicVerifyPackage,
  WatchtowerReport,
} from "./types.js";

export { ZERO_ROOT, asHex, asBigInt, eqHex } from "./util.js";

export {
  MemoryBatchSource,
  createViemBatchSource,
  PROOF_BATCH_REGISTRY_READ_ABI,
} from "./sources.js";
export type { ViemPublicClientLike } from "./sources.js";

export {
  verifyProofBatchClaim,
  verifyInclusionClaim,
  verifyBatchContinuity,
  verifyAgainstBatchSource,
  toPublicProofBatch,
} from "./verify-batch.js";

export {
  verifyBalances,
  verifyBalanceInclusionClaim,
  verifySettlementConservation,
} from "./verify-balance.js";

export { verifyRandomnessSection } from "./verify-randomness.js";

export {
  summarizeChecks,
  resolveStatus,
  formatReportText,
  formatHealthLine,
} from "./report.js";
export type { PendingFlags } from "./report.js";

export { runWatchtower } from "./run.js";
export type { RunWatchtowerOptions } from "./run.js";

export {
  fixtureProofBatchPackage,
  fixtureProofBatchTampered,
  fixtureContinuityChain,
  fixtureContinuityBroken,
  fixtureBalancePackage,
  fixtureIncomplete,
  fixtureRegistryBatches,
  fixtureHealthSuite,
  defaultVectorsDir,
} from "./fixtures.js";
