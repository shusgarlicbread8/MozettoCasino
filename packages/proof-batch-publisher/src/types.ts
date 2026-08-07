import type { Hex, Address } from "viem";
import type { MerkleProofStep, ProofBatchResult } from "@mozetto/root-builder";

/** Table checkpoint leaf pending inclusion in a global proof batch. */
export type CheckpointLeaf = {
  /** Session / table id (bytes32). */
  sessionId: Hex;
  /** Checkpoint id within the session (uint64-compatible). */
  checkpointId: bigint;
  /** TableCheckpointRoot (or equivalent Season-1 checkpoint root). */
  checkpointRoot: Hex;
};

/** Season-1 continuity cursor for ProofBatchRegistryV1. */
export type ContinuityState = {
  /** Next sequence that MUST be registered (starts at 0). */
  nextSequence: bigint;
  /**
   * `previousBatchRoot` for the next batch:
   * - sequence 0 → bytes32(0)
   * - otherwise → prior batch's `globalRoot`
   */
  previousBatchRoot: Hex;
  /** True once at least one batch has been accepted. */
  hasBatches: boolean;
};

/** Off-chain package commitment inputs (MOZETTO_PROOF_BATCH_V1 §4 dataManifestHash). */
export type DataManifestInput = {
  /** Optional content id / package bytes already hashed. */
  packageCidHash?: Hex;
  /** Extra opaque commitment (transcripts bundle hash, etc.). */
  packageDigest?: Hex;
  /** When set, used verbatim as dataManifestHash (tests / precomputed). */
  dataManifestHash?: Hex;
};

export type PreparedProofBatch = {
  continuity: ContinuityState;
  checkpoints: CheckpointLeaf[];
  orderedRoots: Hex[];
  dataManifestHash: Hex;
  createdAt: bigint;
  batch: ProofBatchResult;
  inclusionProofs: CheckpointInclusionProof[];
};

export type CheckpointInclusionProof = {
  sessionId: Hex;
  checkpointId: bigint;
  checkpointRoot: Hex;
  leafIndex: number;
  proof: MerkleProofStep[];
  globalRoot: Hex;
};

export type RegisterBatchParams = {
  sequence: bigint;
  previousBatchRoot: Hex;
  globalRoot: Hex;
  dataManifestHash: Hex;
  createdAt: bigint;
};

export type RegisterBatchResult = {
  proofBatchHash: Hex;
  txHash?: Hex;
};

/** Chain / mock surface for ProofBatchRegistryV1. */
export type RegistryClient = {
  readContinuity(): Promise<ContinuityState>;
  getBatch?(sequence: bigint): Promise<RegisterBatchParams | null>;
  registerBatch(batch: RegisterBatchParams): Promise<RegisterBatchResult>;
};

/** Source of unpublished checkpoint roots. */
export type CheckpointSource = {
  /** Return (and typically dequeue) pending leaves for the next batch. */
  drainPending(): Promise<CheckpointLeaf[]> | CheckpointLeaf[];
};

export type PublishResult = {
  skipped: boolean;
  reason?: string;
  prepared?: PreparedProofBatch;
  register?: RegisterBatchResult;
  continuityAfter?: ContinuityState;
};

/** Persist public inclusion evidence after a batch is accepted (WP-090/085). */
export type InclusionProofStorePort = {
  saveAccepted(artifact: unknown): Promise<void> | void;
};

export type PublisherOptions = {
  registry: RegistryClient;
  /** Default interval hint (ms); used by run loop only. */
  intervalMs?: number;
  /** Clock for createdAt (unix seconds). */
  nowSeconds?: () => bigint;
  /**
   * When true, empty drain results skip publish (default).
   * When false, empty batches are still rejected (zero globalRoot).
   */
  skipEmpty?: boolean;
  /**
   * When set, successful publishes write public inclusion proofs
   * (memory / JSON file / SQL — see `persist.ts`).
   */
  inclusionStore?: InclusionProofStorePort;
};

/** Minimal viem surface — accepts real PublicClient / WalletClient at call sites. */
export type ViemRegistryConfig = {
  address: Address;
  /** Wallet client that can write as the authorized publisher. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: { account: { address: Address }; writeContract: (...args: any[]) => Promise<Hex> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: {
    readContract: (...args: any[]) => Promise<unknown>;
    waitForTransactionReceipt?: (...args: any[]) => Promise<unknown>;
  };
  chain?: unknown;
};
