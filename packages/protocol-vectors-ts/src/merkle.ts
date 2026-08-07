import { keccak256, concat, pad, type Hex } from "viem";

const ZERO32 = pad("0x00", { size: 32 }) as Hex;

/** Ordered Merkle: pad with zeros to power-of-2; parent = keccak256(left || right). */
export function merkleRoot(leaves: Hex[]): { root: Hex; layers: Hex[][] } {
  if (leaves.length === 0) {
    return { root: ZERO32, layers: [[ZERO32]] };
  }
  let level = [...leaves];
  while (level.length & (level.length - 1)) level.push(ZERO32);
  const layers = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak256(concat([level[i], level[i + 1]])));
    }
    level = next;
    layers.push(level);
  }
  return { root: level[0], layers };
}

export function merkleProof(
  leaves: Hex[],
  index: number,
): { sibling: Hex; isLeft: boolean }[] {
  const { layers } = merkleRoot(leaves);
  const proof: { sibling: Hex; isLeft: boolean }[] = [];
  let idx = index;
  for (let d = 0; d < layers.length - 1; d++) {
    const sibling = idx ^ 1;
    proof.push({ sibling: layers[d][sibling], isLeft: sibling < idx });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export { ZERO32 };
