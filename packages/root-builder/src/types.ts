import type { Address, Hex } from "viem";

export type MerkleProofStep = {
  sibling: Hex;
  /** True when `sibling` is the left child (so leaf/node is right). */
  isLeft: boolean;
};

/** Balance leaf fields — MOZETTO_SETTLEMENT_V3 §3. */
export type BalanceLeafInput = {
  sessionId: Hex;
  epoch: bigint;
  arenaAccount: Address;
  seat: number;
  openingBalance: bigint;
  currentBalance: bigint;
  cumulativeRake: bigint;
  lastSequence: bigint;
};

export type EncodedBalanceLeaf = {
  seat: number;
  arenaAccount: Address;
  fields: BalanceLeafInput;
  canonicalBytesHex: Hex;
  leafHash: Hex;
};

export type BalanceRootResult = {
  /** Leaves ordered by ascending seat (normative). */
  leaves: EncodedBalanceLeaf[];
  /** Ordered Merkle root over leaf hashes. */
  balanceRoot: Hex;
};

export type HandRootInput = {
  handId: Hex;
  eventChainTip: Hex;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  /** Season 1 MAY be bytes32(0) when Energy audits disabled. */
  energyLedgerRoot?: Hex;
};

export type HandRootResult = {
  handId: Hex;
  eventChainTip: Hex;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  energyLedgerRoot: Hex;
  canonicalBytesHex: Hex;
  handRoot: Hex;
};

export type ProofBatchInput = {
  sequence: bigint;
  previousBatchRoot: Hex;
  /** Ordered checkpoint roots (already sorted by (sessionId, checkpointId)). */
  checkpointRoots: readonly Hex[];
  dataManifestHash: Hex;
  createdAt: bigint;
};

export type ProofBatchResult = {
  sequence: bigint;
  previousBatchRoot: Hex;
  globalRoot: Hex;
  dataManifestHash: Hex;
  createdAt: bigint;
  canonicalBytesHex: Hex;
  proofBatchHash: Hex;
};

export type FinalSettlementInput = {
  sessionId: Hex;
  finalSequence: bigint;
  finalEventRoot: Hex;
  handRoot: Hex;
  balanceRoot: Hex;
  randomnessEpochId: Hex;
  openingTotal: bigint;
  endingPlayerTotal: bigint;
  totalRake: bigint;
  proofBatchSequence: bigint;
  modelPolicyHash: Hex;
  profileSetHash: Hex;
  gameTemplateId: Hex;
  engineHash: Hex;
  deadline: bigint;
  chainId: bigint;
  verifyingContract: Address;
};

export type FinalSettlementResult = {
  TYPEHASH: Hex;
  structHash: Hex;
  domainSeparator: Hex;
  digest: Hex;
  conservationOk: boolean;
};

/** Minimal event surface for tip / hand filtering (WP-060 store or plain arrays). */
export type EventHashLike = {
  eventHash: Hex;
  handNumber?: bigint;
  sequence?: bigint;
};

export type EventChainTipSource =
  | { tip: Hex }
  | { events: readonly EventHashLike[] }
  | { eventHashes: readonly Hex[] };
