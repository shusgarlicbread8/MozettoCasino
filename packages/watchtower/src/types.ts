import type { Address, Hex } from "viem";
import type { MerkleProofStep } from "@mozetto/root-builder";

/**
 * Public result categories (Plan 10 — Public Verify Game).
 * Never promote to VERIFIED when a required component is pending/missing.
 */
export type WatchtowerStatus =
  | "VERIFIED"
  | "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER"
  | "PENDING_BASE_ANCHOR"
  | "PENDING_SETTLEMENT"
  | "INCOMPLETE_PUBLIC_DATA"
  | "VERIFICATION_FAILED";

export type CheckResult = {
  id: string;
  ok: boolean;
  /** Skipped when public data for this check is absent. */
  skipped?: boolean;
  detail: string;
};

/** On-chain / mock ProofBatchRegistryV1 batch view (read-only). */
export type PublicProofBatch = {
  sequence: bigint;
  previousBatchRoot: Hex;
  globalRoot: Hex;
  dataManifestHash: Hex;
  createdAt: bigint;
  /** Optional on-chain proofBatchHashes(sequence); verified when present. */
  proofBatchHash?: Hex;
};

/** Read-only batch source — never requires a publisher / operator key. */
export type PublicBatchSource = {
  getBatch(sequence: bigint): Promise<PublicProofBatch | null> | PublicProofBatch | null;
  latestSequence(): Promise<bigint | null> | bigint | null;
};

/** Checkpoint leaf claimed under a proof batch (public package). */
export type PublicCheckpointLeaf = {
  sessionId: Hex;
  checkpointId: bigint | string | number;
  checkpointRoot: Hex;
};

/** Optional Merkle inclusion proof for a checkpoint under globalRoot. */
export type PublicInclusionClaim = {
  checkpointRoot: Hex;
  proof: MerkleProofStep[];
  globalRoot: Hex;
};

/** Balance leaf fields for public balance-root reconstruction. */
export type PublicBalanceLeaf = {
  sessionId: Hex;
  epoch: bigint | string | number;
  arenaAccount: Address;
  seat: number;
  openingBalance: bigint | string | number;
  currentBalance: bigint | string | number;
  cumulativeRake: bigint | string | number;
  lastSequence: bigint | string | number;
};

/**
 * Content-addressed public verification package.
 * All fields optional except those needed for the checks you request;
 * missing sections → INCOMPLETE_PUBLIC_DATA (not a hard fail unless required).
 */
export type PublicVerifyPackage = {
  /** Optional human / content id. */
  packageId?: string;
  chainId?: number | string;
  contracts?: {
    proofBatchRegistry?: Address;
    settlementHub?: Address;
    randomnessBeacon?: Address;
  };
  /** Claimed proof batch + ordered checkpoint roots (rebuild + compare). */
  proofBatch?: {
    sequence: bigint | string | number;
    previousBatchRoot: Hex;
    globalRoot: Hex;
    dataManifestHash: Hex;
    createdAt: bigint | string | number;
    proofBatchHash?: Hex;
    checkpointRoots?: Hex[];
    checkpoints?: PublicCheckpointLeaf[];
    inclusionProofs?: PublicInclusionClaim[];
  };
  /** Chain of batches for continuity walk (optional; else single proofBatch). */
  batchChain?: Array<{
    sequence: bigint | string | number;
    previousBatchRoot: Hex;
    globalRoot: Hex;
    dataManifestHash: Hex;
    createdAt: bigint | string | number;
    proofBatchHash?: Hex;
    checkpointRoots?: Hex[];
  }>;
  /** Balance leaves + claimed balanceRoot. */
  balances?: {
    balanceRoot: Hex;
    leaves: PublicBalanceLeaf[];
  };
  /** Single emergency-exit style leaf + Merkle proof. */
  balanceInclusion?: {
    leaf: PublicBalanceLeaf;
    leafHash?: Hex;
    balanceRoot: Hex;
    proof: MerkleProofStep[];
  };
  /**
   * Settlement conservation totals (opening = ending + rake).
   * Does not require attestor keys — arithmetic only.
   */
  settlement?: {
    openingTotal: bigint | string | number;
    endingPlayerTotal: bigint | string | number;
    totalRake: bigint | string | number;
    /** When false/absent, settlement checks are informational skip if missing. */
    anchoredOnChain?: boolean;
  };
  /**
   * Randomness: run golden MOZETTO_RANDOMNESS_V2 suite when `runGoldenSuite`,
   * and/or verify an ad-hoc card opening.
   */
  randomness?: {
    runGoldenSuite?: boolean;
    vectorsDir?: string;
    opening?: {
      handId: Hex;
      deckRoot: Hex;
      position: number;
      cardCode: number;
      cardSalt: Hex;
      proof: MerkleProofStep[];
    };
  };
  /** Explicit flags for pending protocol stages. */
  pending?: {
    baseAnchor?: boolean;
    settlement?: boolean;
    privateDealerAttested?: boolean;
  };
};

export type WatchtowerReport = {
  workPacket: "WP-095";
  packageId?: string;
  ok: boolean;
  status: WatchtowerStatus;
  passed: number;
  failed: number;
  skipped: number;
  checks: CheckResult[];
};
