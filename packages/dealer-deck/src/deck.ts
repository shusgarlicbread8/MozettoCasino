import { concat, keccak256, type Hex } from "viem";
import {
  cardLeaf as encodeCardLeaf,
  merkleProof,
  merkleRoot,
  ZERO32,
} from "@mozetto/protocol-vectors";
import { assertValidDeck, DECK_SIZE, shuffleDeckV2 } from "./shuffle.js";
import { cardSaltsForDeck, fixtureCardSalt, productionCardSalt } from "./salts.js";
import type { CardOpening, MerkleProofStep, PreparedHandDeck, SaltMode } from "./types.js";

export function buildCardLeaves(
  handId: Hex,
  deck: readonly number[],
  salts: readonly Hex[],
): Hex[] {
  if (deck.length !== salts.length) {
    throw new Error("deck and salts length mismatch");
  }
  return deck.map((cardCode, position) => encodeCardLeaf(handId, position, cardCode, salts[position]!).hash);
}

export function buildDeckRoot(cardLeaves: readonly Hex[]): Hex {
  return merkleRoot([...cardLeaves]).root;
}

export function proofForPosition(cardLeaves: readonly Hex[], position: number): MerkleProofStep[] {
  return merkleProof([...cardLeaves], position);
}

/** Verify leaf membership under Protocol V3 ordered Merkle. */
export function verifyMerkleProof(
  leaf: Hex,
  proof: readonly MerkleProofStep[],
  expectedRoot: Hex,
): boolean {
  let h = leaf;
  for (const step of proof) {
    h = step.isLeft
      ? keccak256(concat([step.sibling, h]))
      : keccak256(concat([h, step.sibling]));
  }
  return h.toLowerCase() === expectedRoot.toLowerCase();
}

export function openCard(
  handId: Hex,
  deck: readonly number[],
  salts: readonly Hex[],
  deckRoot: Hex,
  position: number,
): CardOpening {
  if (position < 0 || position >= deck.length) {
    throw new Error(`position out of range: ${position}`);
  }
  const cardCode = deck[position]!;
  const cardSalt = salts[position]!;
  const leaf = encodeCardLeaf(handId, position, cardCode, cardSalt).hash;
  const leaves = buildCardLeaves(handId, deck, salts);
  const proof = proofForPosition(leaves, position);
  if (!verifyMerkleProof(leaf, proof, deckRoot)) {
    throw new Error("internal: opening proof does not verify");
  }
  return { position, cardCode, cardSalt, cardLeaf: leaf, proof };
}

/**
 * Build a committed hand deck from `handSeed`.
 * - `saltMode: "production"` — normative salts from handSeed
 * - `saltMode: "fixture"` — vector-07 salts; typically paired with identity deck
 */
export function prepareHandDeck(opts: {
  handId: Hex;
  handSeed: Hex;
  index?: number;
  /** Override shuffle (e.g. identity deck for vector 07). */
  deck?: number[];
  saltMode?: SaltMode;
}): PreparedHandDeck {
  const saltMode = opts.saltMode ?? "production";
  const deck = opts.deck ?? shuffleDeckV2(opts.handSeed);
  assertValidDeck(deck);
  const cardSalts = cardSaltsForDeck(saltMode, {
    handSeed: opts.handSeed,
    count: deck.length,
  });
  const cardLeaves = buildCardLeaves(opts.handId, deck, cardSalts);
  if (cardLeaves.length !== DECK_SIZE && opts.deck === undefined) {
    throw new Error("expected 52-card deck");
  }
  const deckRoot = buildDeckRoot(cardLeaves);
  return {
    handId: opts.handId,
    handSeed: opts.handSeed,
    index: opts.index ?? 0,
    deck: [...deck],
    cardSalts,
    cardLeaves,
    deckRoot,
  };
}

/** Identity deck 0..51 with fixture salts — golden vector 07 shape. */
export function identityFixtureDeck(handId: Hex): PreparedHandDeck {
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
  const cardSalts = deck.map((_, i) => fixtureCardSalt(i));
  const cardLeaves = buildCardLeaves(handId, deck, cardSalts);
  return {
    handId,
    handSeed: ZERO32,
    index: 0,
    deck,
    cardSalts,
    cardLeaves,
    deckRoot: buildDeckRoot(cardLeaves),
  };
}

export { productionCardSalt, fixtureCardSalt, encodeCardLeaf };
