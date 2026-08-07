/**
 * @deprecated Legacy sorted-pair merkle — Randomness V2 uses Protocol V3 ordered
 * Merkle from `@mozetto/dealer-deck` / `@mozetto/protocol-vectors`.
 * Kept only so older imports do not break during migration.
 */
import { concat, keccak256, type Hex } from "viem";

/** Sorted-pair keccak merkle root (legacy PokerSettlementHub helper). */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${"0".repeat(64)}` as Hex;
  let level = [...leaves].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        next.push(level[i]!);
        continue;
      }
      next.push(pairHash(level[i]!, level[i + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

export function pairHash(a: Hex, b: Hex): Hex {
  const [left, right] = a < b ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

/** @deprecated Use DOMAIN_SECRET_LEAF encoding via @mozetto/dealer-deck. */
export function secretLeaf(secret: Hex): Hex {
  return keccak256(secret);
}
