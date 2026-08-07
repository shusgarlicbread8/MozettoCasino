export type {
  CheckpointLeaf,
  CheckpointSource,
  ContinuityState,
  DataManifestInput,
  PreparedProofBatch,
  CheckpointInclusionProof,
  RegisterBatchParams,
  RegisterBatchResult,
  RegistryClient,
  PublishResult,
  PublisherOptions,
  ViemRegistryConfig,
} from "./types.js";

export { ProofBatchPublisherError } from "./errors.js";

export {
  compareBytes32,
  sortCheckpointLeaves,
  orderedCheckpointRoots,
} from "./sort.js";

export { buildDataManifestHash } from "./manifest.js";

export {
  ZERO_ROOT,
  genesisContinuity,
  assertContinuityLink,
  advanceContinuity,
} from "./continuity.js";

export {
  buildInclusionProofs,
  verifyCheckpointInclusion,
} from "./inclusion.js";

export { prepareProofBatch } from "./aggregate.js";
export type { PrepareBatchOptions } from "./aggregate.js";

export {
  PROOF_BATCH_REGISTRY_ABI,
  MockRegistryClient,
  createViemRegistryClient,
  registryAddressFromEnv,
} from "./registry.js";

export { MemoryCheckpointSource } from "./source.js";

export { buildTableCheckpointRoot } from "./checkpoint-root.js";

export { SqlCheckpointSource } from "./sql-source.js";
export type { SqlCheckpointSourceOptions } from "./sql-source.js";

export { ProofBatchPublisher, runPublisherLoop } from "./publisher.js";

export {
  serializeInclusionProof,
  serializeAcceptedBatch,
  persistPublishResult,
  MemoryInclusionProofStore,
  JsonFileInclusionProofStore,
  createSqlInclusionProofStore,
  ensureInclusionArtifactDir,
} from "./persist.js";
export type {
  PublicMerkleStep,
  PublicInclusionProofRecord,
  PublicProofBatchArtifact,
  InclusionProofStore,
  SqlExec,
} from "./persist.js";
