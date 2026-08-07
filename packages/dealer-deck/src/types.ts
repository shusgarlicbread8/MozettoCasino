import type { Hex } from "viem";

/** Merkle sibling path (Protocol V3 ordered Merkle). */
export type MerkleProofStep = {
  sibling: Hex;
  /** True when the sibling is the left child. */
  isLeft: boolean;
};

export type CardOpening = {
  position: number;
  cardCode: number;
  cardSalt: Hex;
  cardLeaf: Hex;
  proof: MerkleProofStep[];
};

export type PreparedHandDeck = {
  handId: Hex;
  handSeed: Hex;
  index: number;
  /** Permutation of codes 0..51 after Randomness V2 shuffle. */
  deck: number[];
  cardSalts: Hex[];
  cardLeaves: Hex[];
  deckRoot: Hex;
};

export type PreparedDeckBatch = {
  sessionId: Hex;
  randomnessEpoch: bigint;
  vrfR: Hex;
  secrets: Hex[];
  secretLeaves: Hex[];
  dealerSecretRoot: Hex;
  hands: PreparedHandDeck[];
  deckRoots: Hex[];
  deckBatchRoot: Hex;
  /** Optional DOMAIN_DECK_BATCH_V1 bind hash. */
  deckBatchBind: Hex;
};

export type SaltMode = "production" | "fixture";
