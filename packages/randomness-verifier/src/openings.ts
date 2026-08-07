/**
 * WP-055 — verify a public card opening against a committed deckRoot.
 * Consumes @mozetto/dealer-deck (cardLeaf + Merkle verify).
 */
import {
  cardLeaf,
  verifyMerkleProof,
  type MerkleProofStep,
} from "@mozetto/dealer-deck";
import type { CardOpeningInput, OpeningVerifyResult } from "./types.js";

export function verifyCardOpening(input: CardOpeningInput): OpeningVerifyResult {
  const { handId, deckRoot, position, cardCode, cardSalt, proof } = input;

  if (position < 0 || position > 255) {
    return { ok: false, cardLeaf: "0x", detail: `invalid position ${position}` };
  }
  if (cardCode < 0 || cardCode > 51) {
    return {
      ok: false,
      cardLeaf: "0x",
      detail: `cardCode out of range: ${cardCode}`,
    };
  }

  const leaf = cardLeaf(handId, position, cardCode, cardSalt).hash;
  const steps = proof as MerkleProofStep[];
  const ok = verifyMerkleProof(leaf, steps, deckRoot);
  return {
    ok,
    cardLeaf: leaf,
    detail: ok
      ? `opening position=${position} cardCode=${cardCode} verifies under deckRoot`
      : `opening position=${position} cardCode=${cardCode} fails Merkle check vs deckRoot`,
  };
}
