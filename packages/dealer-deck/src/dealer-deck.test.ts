/**
 * WP-051: Randomness V2 dealer deck library vs golden vectors 07/08 + mutations.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { keccak256, toBytes, type Hex } from "viem";
import {
  assertValidDeck,
  buildCardLeaves,
  buildDealerSecretRoot,
  buildDeckRoot,
  buildSecretLeaves,
  fixtureCardSalt,
  fixtureDealerSecret,
  handSeedV2,
  HandSeedCsprng,
  identityFixtureDeck,
  openCard,
  prepareDeckBatch,
  prepareHandDeck,
  proofForPosition,
  shuffleDeckBiasedModulo,
  shuffleDeckV2,
  verifyMerkleProof,
  cardLeaf,
  merkleProof,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "../../../specs/canonical-vectors");

function loadJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(VECTORS, name), "utf8"));
}

function asHex(v: unknown): Hex {
  assert.ok(typeof v === "string" && v.startsWith("0x"), `expected hex, got ${v}`);
  return v as Hex;
}

describe("vector 08 — dealer secret + handSeed", () => {
  it("matches golden secret leaf, handSeed0, dealerSecretRoot", () => {
    const f = loadJson("08_dealer_secret_hand_seed.json");
    const sessionId = asHex((f.humanReadableInput as { sessionId: string }).sessionId);
    const vrfR = asHex((f.humanReadableInput as { vrfR: string }).vrfR);
    const S0 = fixtureDealerSecret(0);
    const S1 = fixtureDealerSecret(1);

    const leaves = buildSecretLeaves(sessionId, 0n, [S0, S1]);
    assert.equal(leaves[0], asHex(f.keccak256));
    assert.equal(leaves[0], asHex((f.secretLeaves as string[])[0]!));
    assert.equal(leaves[1], asHex((f.secretLeaves as string[])[1]!));

    const root = buildDealerSecretRoot(leaves);
    assert.equal(root, asHex(f.dealerSecretRoot));

    const seed = handSeedV2({ secret: S0, vrfR, sessionId, epoch: 0n, index: 0 });
    assert.equal(seed, asHex(f.handSeed0));
  });

  it("mutation: replace S[0] changes dealerSecretRoot", () => {
    const f = loadJson("08_dealer_secret_hand_seed.json");
    const sessionId = asHex((f.humanReadableInput as { sessionId: string }).sessionId);
    const S0 = fixtureDealerSecret(0);
    const S1 = fixtureDealerSecret(1);
    const honest = buildDealerSecretRoot(buildSecretLeaves(sessionId, 0n, [S0, S1]));
    const mutated = buildDealerSecretRoot(
      buildSecretLeaves(sessionId, 0n, [keccak256(toBytes("mutated-secret")), S1]),
    );
    assert.notEqual(mutated, honest);
    assert.equal(honest, asHex(f.dealerSecretRoot));
  });

  it("mutation: handSeed = keccak256(R) only fails golden", () => {
    const f = loadJson("08_dealer_secret_hand_seed.json");
    const vrfR = asHex((f.humanReadableInput as { vrfR: string }).vrfR);
    const bad = keccak256(vrfR);
    assert.notEqual(bad, asHex(f.handSeed0));
  });
});

describe("vector 07 — card leaf + deckRoot + proof", () => {
  it("matches golden leaf0, deckRoot, merkleProofPosition0", () => {
    const f = loadJson("07_card_leaf_merkle.json");
    const handId = asHex((f.humanReadableInput as { handId: string }).handId);
    const prepared = identityFixtureDeck(handId);

    assert.equal(prepared.deckRoot, asHex(f.deckRoot));
    assert.equal(prepared.cardLeaves[0], asHex(f.keccak256));
    assert.equal(prepared.cardSalts[0], asHex((f.leaf0 as { cardSalt: string }).cardSalt));

    const proof = proofForPosition(prepared.cardLeaves, 0);
    const expected = f.merkleProofPosition0 as { sibling: string; isLeft: boolean }[];
    assert.equal(proof.length, expected.length);
    for (let i = 0; i < proof.length; i++) {
      assert.equal(proof[i]!.sibling, asHex(expected[i]!.sibling));
      assert.equal(proof[i]!.isLeft, expected[i]!.isLeft);
    }

    assert.equal(
      verifyMerkleProof(prepared.cardLeaves[0]!, proof, prepared.deckRoot),
      true,
    );
  });

  it("mutation: flip cardCode 0→1 with same salt fails proof", () => {
    const f = loadJson("07_card_leaf_merkle.json");
    const handId = asHex((f.humanReadableInput as { handId: string }).handId);
    const prepared = identityFixtureDeck(handId);
    const salt = prepared.cardSalts[0]!;
    const badLeaf = cardLeaf(handId, 0, 1, salt).hash;
    const proof = proofForPosition(prepared.cardLeaves, 0);
    assert.equal(verifyMerkleProof(badLeaf, proof, prepared.deckRoot), false);
  });

  it("mutation: wrong position proof fails root check", () => {
    const f = loadJson("07_card_leaf_merkle.json");
    const handId = asHex((f.humanReadableInput as { handId: string }).handId);
    const prepared = identityFixtureDeck(handId);
    const wrongProof = proofForPosition(prepared.cardLeaves, 1);
    assert.equal(
      verifyMerkleProof(prepared.cardLeaves[0]!, wrongProof, prepared.deckRoot),
      false,
    );
  });

  it("mutation: duplicate card codes fail validity", () => {
    const bad = Array.from({ length: 52 }, (_, i) => (i === 51 ? 0 : i));
    assert.throws(() => assertValidDeck(bad), /duplicate/);
  });
});

describe("Randomness V2 shuffle", () => {
  const seedA = keccak256(toBytes("hand-seed-a")) as Hex;
  const seedB = (() => {
    const bytes = toBytes(seedA);
    bytes[31] = bytes[31]! ^ 1;
    return keccak256(bytes) as Hex; // one-bit-ish input change → unrelated seed
  })();

  it("is deterministic and a valid 52-card permutation", () => {
    const a = shuffleDeckV2(seedA);
    const b = shuffleDeckV2(seedA);
    assert.deepEqual(a, b);
    assertValidDeck(a);
  });

  it("one-bit handSeed change yields unrelated deck", () => {
    const a = shuffleDeckV2(seedA);
    const b = shuffleDeckV2(seedB);
    assert.notDeepEqual(a, b);
    // At least half the positions differ for a strong avalanche check.
    let diffs = 0;
    for (let i = 0; i < 52; i++) if (a[i] !== b[i]) diffs++;
    assert.ok(diffs >= 26, `expected ≥26 position diffs, got ${diffs}`);
  });

  it("rejection sampling redraws when x >= limit", () => {
    const rng = new HandSeedCsprng(seedA);
    // bound=52 → limit = floor(2^32/52)*52 = 4294967248
    rng.forceUint32Sequence([4294967248, 100]);
    assert.equal(rng.uniformBelow(52), 100 % 52);
    assert.equal(rng.draws, 2);

    // bound=3 → limit = 4294967295; only 0xffffffff rejects
    const rng2 = new HandSeedCsprng(seedA);
    rng2.forceUint32Sequence([0xffffffff, 5]);
    assert.equal(rng2.uniformBelow(3), 5 % 3);
    assert.equal(rng2.draws, 2);
  });

  it("biased modulo helper remains available for contrast only", () => {
    assert.equal(typeof shuffleDeckBiasedModulo, "function");
    assert.equal(typeof shuffleDeckV2, "function");
  });

  it("prepareHandDeck + openCard verifies public openings", () => {
    const handId = keccak256(toBytes("hand-id-open")) as Hex;
    const prepared = prepareHandDeck({ handId, handSeed: seedA });
    assertValidDeck(prepared.deck);
    const opening = openCard(
      prepared.handId,
      prepared.deck,
      prepared.cardSalts,
      prepared.deckRoot,
      0,
    );
    assert.equal(opening.cardCode, prepared.deck[0]);
    assert.equal(verifyMerkleProof(opening.cardLeaf, opening.proof, prepared.deckRoot), true);

    // Wrong salt fails.
    const wrongSalt = fixtureCardSalt(99);
    const fakeLeaf = cardLeaf(handId, 0, opening.cardCode, wrongSalt).hash;
    assert.equal(verifyMerkleProof(fakeLeaf, opening.proof, prepared.deckRoot), false);
  });

  it("prepareDeckBatch builds secret root + deck batch", () => {
    const f = loadJson("08_dealer_secret_hand_seed.json");
    const sessionId = asHex((f.humanReadableInput as { sessionId: string }).sessionId);
    const vrfR = asHex((f.humanReadableInput as { vrfR: string }).vrfR);
    const batch = prepareDeckBatch({
      sessionId,
      randomnessEpoch: 0n,
      vrfR,
      secrets: [fixtureDealerSecret(0), fixtureDealerSecret(1)],
    });
    assert.equal(batch.dealerSecretRoot, asHex(f.dealerSecretRoot));
    assert.equal(batch.hands[0]!.handSeed, asHex(f.handSeed0));
    assert.equal(batch.hands.length, 2);
    assertValidDeck(batch.hands[0]!.deck);
    assertValidDeck(batch.hands[1]!.deck);
    assert.notEqual(batch.hands[0]!.deckRoot, batch.hands[1]!.deckRoot);
    assert.ok(batch.deckBatchRoot.startsWith("0x"));
    assert.ok(batch.deckBatchBind.startsWith("0x"));
  });
});

describe("merkleProof parity with protocol-vectors", () => {
  it("deck helper proof matches protocol-vectors merkleProof", () => {
    const handId = keccak256(toBytes("parity-hand")) as Hex;
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const salts = deck.map((_, i) => fixtureCardSalt(i));
    const leaves = buildCardLeaves(handId, deck, salts);
    assert.deepEqual(proofForPosition(leaves, 0), merkleProof(leaves, 0));
    assert.equal(buildDeckRoot(leaves), identityFixtureDeck(handId).deckRoot);
  });
});
