/**
 * WP-055 — randomness verifier unit tests (golden + mutations + openings).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  identityFixtureDeck,
  openCard,
  prepareHandDeck,
} from "@mozetto/dealer-deck";
import { verifyCardOpening } from "./openings.js";
import {
  defaultVectorsDir,
  runRandomnessVerification,
} from "./verify.js";

describe("WP-055 randomness verifier", () => {
  it("golden suite 07/08 + mutations all pass", () => {
    const report = runRandomnessVerification({
      vectorsDir: defaultVectorsDir(),
    });
    assert.equal(report.ok, true, formatFails(report));
    assert.ok(report.passed >= 16, `expected ≥16 checks, got ${report.passed}`);
    assert.equal(report.failed, 0);
    assert.equal(report.policyId, "MOZETTO_RANDOMNESS_V2");
  });

  it("verifyCardOpening accepts honest opening", () => {
    const handId = keccak256(toBytes("wp055-open-hand")) as Hex;
    const prepared = prepareHandDeck({
      handId,
      handSeed: keccak256(toBytes("wp055-seed")) as Hex,
    });
    const opening = openCard(
      prepared.handId,
      prepared.deck,
      prepared.cardSalts,
      prepared.deckRoot,
      3,
    );
    const result = verifyCardOpening({
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      position: opening.position,
      cardCode: opening.cardCode,
      cardSalt: opening.cardSalt,
      proof: opening.proof,
    });
    assert.equal(result.ok, true);
    assert.equal(result.cardLeaf, opening.cardLeaf);
  });

  it("verifyCardOpening rejects mutated cardCode", () => {
    const handId = keccak256(toBytes("wp055-mut-hand")) as Hex;
    const prepared = identityFixtureDeck(handId);
    const opening = openCard(
      prepared.handId,
      prepared.deck,
      prepared.cardSalts,
      prepared.deckRoot,
      0,
    );
    const bad = verifyCardOpening({
      handId: prepared.handId,
      deckRoot: prepared.deckRoot,
      position: 0,
      cardCode: 1, // flipped
      cardSalt: opening.cardSalt,
      proof: opening.proof,
    });
    assert.equal(bad.ok, false);
  });
});

function formatFails(report: {
  checks: { id: string; ok: boolean; detail: string }[];
}): string {
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail}`)
    .join("\n");
}
