import { balanceLeaf } from "@mozetto/protocol-vectors";
import type { Hex } from "viem";
import { merkleRoot, proofForIndex, verifyMerkleProof } from "./merkle.js";
import type {
  BalanceLeafInput,
  BalanceRootResult,
  EncodedBalanceLeaf,
  MerkleProofStep,
} from "./types.js";

export class RootBuilderError extends Error {
  constructor(
    readonly code:
      | "DUPLICATE_SEAT"
      | "NEGATIVE_BALANCE"
      | "EMPTY_LEAVES"
      | "SEAT_NOT_FOUND"
      | "CONSERVATION_BROKEN"
      | "PROOF_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RootBuilderError";
  }
}

function encodeOne(fields: BalanceLeafInput): EncodedBalanceLeaf {
  if (fields.currentBalance < 0n || fields.openingBalance < 0n) {
    throw new RootBuilderError(
      "NEGATIVE_BALANCE",
      `seat ${fields.seat}: balances must be unsigned non-negative`,
    );
  }
  const hashed = balanceLeaf(fields);
  return {
    seat: fields.seat,
    arenaAccount: fields.arenaAccount,
    fields,
    canonicalBytesHex: hashed.canonicalBytesHex,
    leafHash: hashed.hash,
  };
}

/**
 * Build balance leaves + Merkle balanceRoot.
 * Leaves are sorted by ascending seat (MOZETTO_SETTLEMENT_V3 §3).
 */
export function buildBalanceRoot(inputs: readonly BalanceLeafInput[]): BalanceRootResult {
  if (inputs.length === 0) {
    throw new RootBuilderError("EMPTY_LEAVES", "balance root requires at least one leaf");
  }
  const seats = new Set<number>();
  for (const leaf of inputs) {
    if (seats.has(leaf.seat)) {
      throw new RootBuilderError("DUPLICATE_SEAT", `duplicate seat ${leaf.seat}`);
    }
    seats.add(leaf.seat);
  }
  const ordered = [...inputs].sort((a, b) => a.seat - b.seat);
  const leaves = ordered.map(encodeOne);
  const { root } = merkleRoot(leaves.map((l) => l.leafHash));
  return { leaves, balanceRoot: root };
}

/** Encode a single balance leaf (DOMAIN_BALANCE_LEAF_V1) without building a root. */
export function encodeBalanceLeaf(fields: BalanceLeafInput): EncodedBalanceLeaf {
  return encodeOne(fields);
}

export function balanceProofForSeat(
  result: BalanceRootResult,
  seat: number,
): { leaf: EncodedBalanceLeaf; index: number; proof: MerkleProofStep[] } {
  const index = result.leaves.findIndex((l) => l.seat === seat);
  if (index < 0) {
    throw new RootBuilderError("SEAT_NOT_FOUND", `no balance leaf for seat ${seat}`);
  }
  const leaf = result.leaves[index]!;
  const proof = proofForIndex(
    result.leaves.map((l) => l.leafHash),
    index,
  );
  return { leaf, index, proof };
}

export function verifyBalanceInclusion(
  leafHash: Hex,
  proof: readonly MerkleProofStep[],
  balanceRoot: Hex,
): boolean {
  return verifyMerkleProof(leafHash, proof, balanceRoot);
}
