import { keccak256, concat, type Hex } from "viem";
import { merkleRoot, merkleProof, ZERO32 } from "@mozetto/protocol-vectors";
import type { MerkleProofStep } from "./types.js";

export { merkleRoot, merkleProof, ZERO32 };

export function verifyMerkleProof(
  leaf: Hex,
  proof: readonly MerkleProofStep[],
  expectedRoot: Hex,
): boolean {
  let h = leaf.toLowerCase() as Hex;
  for (const step of proof) {
    const sibling = step.sibling.toLowerCase() as Hex;
    h = (
      step.isLeft
        ? keccak256(concat([sibling, h]))
        : keccak256(concat([h, sibling]))
    ).toLowerCase() as Hex;
  }
  return h === expectedRoot.toLowerCase();
}

export function proofForIndex(
  leaves: readonly Hex[],
  index: number,
): MerkleProofStep[] {
  return merkleProof([...leaves], index);
}
