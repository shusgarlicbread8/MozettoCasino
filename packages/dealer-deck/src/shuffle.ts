import type { Hex } from "viem";
import { HandSeedCsprng } from "./csprng.js";

const DECK_SIZE = 52;

/**
 * Randomness V2 Fisher–Yates: start `0..51`, for `i = 51..1` swap with
 * rejection-sampled `j ∈ [0, i]`.
 */
export function shuffleDeckV2(handSeed: Hex): number[] {
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
  const rng = new HandSeedCsprng(handSeed);
  for (let i = DECK_SIZE - 1; i >= 1; i--) {
    const j = rng.uniformBelow(i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

/** Assert permutation of 0..51. */
export function assertValidDeck(deck: readonly number[]): void {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`deck length ${deck.length} !== ${DECK_SIZE}`);
  }
  const seen = new Uint8Array(DECK_SIZE);
  for (const c of deck) {
    if (!Number.isInteger(c) || c < 0 || c >= DECK_SIZE) {
      throw new Error(`invalid card code ${c}`);
    }
    if (seen[c]) throw new Error(`duplicate card code ${c}`);
    seen[c] = 1;
  }
}

/**
 * Biased legacy-style shuffle (raw modulo) — for mutation tests only.
 * MUST NOT be used in production Randomness V2 paths.
 */
export function shuffleDeckBiasedModulo(handSeed: Hex): number[] {
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
  const rng = new HandSeedCsprng(handSeed);
  for (let i = DECK_SIZE - 1; i >= 1; i--) {
    const j = rng.nextUint32() % (i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export { DECK_SIZE };
