/**
 * WP-055 — golden vectors 07/08 + expectedFailureMutations.
 * Independent of dealer service; consumes @mozetto/dealer-deck only.
 */
import { keccak256, toBytes, type Hex } from "viem";
import {
  assertValidDeck,
  buildDealerSecretRoot,
  buildSecretLeaves,
  cardLeaf,
  fixtureDealerSecret,
  handSeedV2,
  identityFixtureDeck,
  openCard,
  prepareHandDeck,
  proofForPosition,
  verifyMerkleProof,
} from "@mozetto/dealer-deck";
import { verifyCardOpening } from "./openings.js";
import type { CheckResult } from "./types.js";
import { asHex, check, loadJson, vectorPath } from "./util.js";

const VECTOR_07 = "07_card_leaf_merkle.json";
const VECTOR_08 = "08_dealer_secret_hand_seed.json";

export function verifyVector08(vectorsDir: string): CheckResult[] {
  const f = loadJson(vectorPath(vectorsDir, VECTOR_08));
  const sessionId = asHex(
    (f.humanReadableInput as { sessionId: string }).sessionId,
    "sessionId",
  );
  const vrfR = asHex(
    (f.humanReadableInput as { vrfR: string }).vrfR,
    "vrfR",
  );
  const S0 = fixtureDealerSecret(0);
  const S1 = fixtureDealerSecret(1);

  const leaves = buildSecretLeaves(sessionId, 0n, [S0, S1]);
  const root = buildDealerSecretRoot(leaves);
  const seed = handSeedV2({
    secret: S0,
    vrfR,
    sessionId,
    epoch: 0n,
    index: 0,
  });

  const expectedLeaf0 = asHex(f.keccak256, "vector08.keccak256");
  const expectedRoot = asHex(f.dealerSecretRoot, "dealerSecretRoot");
  const expectedSeed = asHex(f.handSeed0, "handSeed0");
  const secretLeaves = f.secretLeaves as string[];

  return [
    check(
      "08.secretLeaf0",
      leaves[0] === expectedLeaf0 && leaves[0] === asHex(secretLeaves[0], "secretLeaves[0]"),
      leaves[0] === expectedLeaf0
        ? `secretLeaf[0]=${leaves[0]}`
        : `secretLeaf[0] mismatch: got ${leaves[0]} want ${expectedLeaf0}`,
    ),
    check(
      "08.secretLeaf1",
      leaves[1] === asHex(secretLeaves[1], "secretLeaves[1]"),
      leaves[1] === asHex(secretLeaves[1], "secretLeaves[1]")
        ? `secretLeaf[1]=${leaves[1]}`
        : `secretLeaf[1] mismatch`,
    ),
    check(
      "08.dealerSecretRoot",
      root === expectedRoot,
      root === expectedRoot
        ? `dealerSecretRoot=${root}`
        : `dealerSecretRoot mismatch: got ${root} want ${expectedRoot}`,
    ),
    check(
      "08.handSeed0",
      seed === expectedSeed,
      seed === expectedSeed
        ? `handSeed[0]=${seed}`
        : `handSeed[0] mismatch: got ${seed} want ${expectedSeed}`,
    ),
  ];
}

export function verifyVector07(vectorsDir: string): CheckResult[] {
  const f = loadJson(vectorPath(vectorsDir, VECTOR_07));
  const handId = asHex(
    (f.humanReadableInput as { handId: string }).handId,
    "handId",
  );
  const prepared = identityFixtureDeck(handId);
  const expectedRoot = asHex(f.deckRoot, "deckRoot");
  const expectedLeaf0 = asHex(f.keccak256, "vector07.keccak256");
  const expectedSalt0 = asHex(
    (f.leaf0 as { cardSalt: string }).cardSalt,
    "leaf0.cardSalt",
  );
  const expectedProof = f.merkleProofPosition0 as {
    sibling: string;
    isLeft: boolean;
  }[];

  const proof = proofForPosition(prepared.cardLeaves, 0);
  const proofMatches =
    proof.length === expectedProof.length &&
    proof.every(
      (step, i) =>
        step.sibling === asHex(expectedProof[i]!.sibling, `proof[${i}].sibling`) &&
        step.isLeft === expectedProof[i]!.isLeft,
    );

  const openingOk = verifyMerkleProof(
    prepared.cardLeaves[0]!,
    proof,
    prepared.deckRoot,
  );

  // Public opening via library openCard path
  const opening = openCard(
    prepared.handId,
    prepared.deck,
    prepared.cardSalts,
    prepared.deckRoot,
    0,
  );
  const openingVerify = verifyCardOpening({
    handId: prepared.handId,
    deckRoot: prepared.deckRoot,
    position: opening.position,
    cardCode: opening.cardCode,
    cardSalt: opening.cardSalt,
    proof: opening.proof,
  });

  return [
    check(
      "07.deckRoot",
      prepared.deckRoot === expectedRoot,
      prepared.deckRoot === expectedRoot
        ? `deckRoot=${prepared.deckRoot}`
        : `deckRoot mismatch: got ${prepared.deckRoot} want ${expectedRoot}`,
    ),
    check(
      "07.cardLeaf0",
      prepared.cardLeaves[0] === expectedLeaf0,
      prepared.cardLeaves[0] === expectedLeaf0
        ? `cardLeaf[0]=${prepared.cardLeaves[0]}`
        : `cardLeaf[0] mismatch`,
    ),
    check(
      "07.cardSalt0",
      prepared.cardSalts[0] === expectedSalt0,
      prepared.cardSalts[0] === expectedSalt0
        ? `cardSalt[0]=${prepared.cardSalts[0]}`
        : `cardSalt[0] mismatch`,
    ),
    check(
      "07.merkleProofPosition0",
      proofMatches,
      proofMatches
        ? `proof length=${proof.length} matches golden`
        : `merkleProofPosition0 mismatch`,
    ),
    check(
      "07.proofVerifies",
      openingOk,
      openingOk
        ? "leaf0 + proof verifies under deckRoot"
        : "leaf0 + proof does NOT verify",
    ),
    check(
      "07.publicOpening",
      openingVerify.ok && opening.cardCode === 0,
      openingVerify.ok
        ? openingVerify.detail
        : openingVerify.detail,
    ),
  ];
}

/**
 * Mutation suite: each check PASSES when the mutation is correctly rejected
 * (i.e. the adversarial input fails verification / diverges from golden).
 */
export function verifyMutations(vectorsDir: string): CheckResult[] {
  const f08 = loadJson(vectorPath(vectorsDir, VECTOR_08));
  const f07 = loadJson(vectorPath(vectorsDir, VECTOR_07));
  const sessionId = asHex(
    (f08.humanReadableInput as { sessionId: string }).sessionId,
    "sessionId",
  );
  const vrfR = asHex(
    (f08.humanReadableInput as { vrfR: string }).vrfR,
    "vrfR",
  );
  const handId = asHex(
    (f07.humanReadableInput as { handId: string }).handId,
    "handId",
  );
  const honestRoot = asHex(f08.dealerSecretRoot, "dealerSecretRoot");
  const honestSeed = asHex(f08.handSeed0, "handSeed0");

  const S0 = fixtureDealerSecret(0);
  const S1 = fixtureDealerSecret(1);

  // Mutation: replace S[0] → dealerSecretRoot diverges
  const mutatedRoot = buildDealerSecretRoot(
    buildSecretLeaves(sessionId, 0n, [
      keccak256(toBytes("mutated-secret")) as Hex,
      S1,
    ]),
  );
  const replaceSecretOk =
    mutatedRoot !== honestRoot &&
    buildDealerSecretRoot(buildSecretLeaves(sessionId, 0n, [S0, S1])) ===
      honestRoot;

  // Mutation: handSeed = keccak256(R) only
  const vrfOnlySeed = keccak256(vrfR);
  const vrfOnlyRejected = vrfOnlySeed !== honestSeed;

  // Mutation: flip cardCode 0→1 with same salt → proof fails
  const prepared = identityFixtureDeck(handId);
  const salt0 = prepared.cardSalts[0]!;
  const badLeaf = cardLeaf(handId, 0, 1, salt0).hash;
  const proof0 = proofForPosition(prepared.cardLeaves, 0);
  const flipCodeRejected = !verifyMerkleProof(
    badLeaf,
    proof0,
    prepared.deckRoot,
  );

  // Mutation: wrong position proof
  const wrongProof = proofForPosition(prepared.cardLeaves, 1);
  const wrongPosRejected = !verifyMerkleProof(
    prepared.cardLeaves[0]!,
    wrongProof,
    prepared.deckRoot,
  );

  // Mutation: duplicate card codes
  let duplicateRejected = false;
  try {
    assertValidDeck(Array.from({ length: 52 }, (_, i) => (i === 51 ? 0 : i)));
  } catch {
    duplicateRejected = true;
  }

  // Mutation: wrong salt on production opening
  const handSeed = handSeedV2({
    secret: S0,
    vrfR,
    sessionId,
    epoch: 0n,
    index: 0,
  });
  const shuffled = prepareHandDeck({
    handId,
    handSeed,
    saltMode: "production",
  });
  const realOpening = openCard(
    shuffled.handId,
    shuffled.deck,
    shuffled.cardSalts,
    shuffled.deckRoot,
    0,
  );
  const wrongSaltOpening = verifyCardOpening({
    handId: shuffled.handId,
    deckRoot: shuffled.deckRoot,
    position: 0,
    cardCode: realOpening.cardCode,
    cardSalt: keccak256(toBytes("wrong-salt")) as Hex,
    proof: realOpening.proof,
  });
  const wrongSaltRejected = !wrongSaltOpening.ok;

  return [
    check(
      "mut.replaceSecret",
      replaceSecretOk,
      replaceSecretOk
        ? "replaced S[0] changes dealerSecretRoot (detected)"
        : "FAILED to detect S[0] replacement",
    ),
    check(
      "mut.vrfOnlyHandSeed",
      vrfOnlyRejected,
      vrfOnlyRejected
        ? "handSeed=keccak256(R) diverges from golden (detected)"
        : "FAILED: VRF-only seed matched golden",
    ),
    check(
      "mut.flipCardCode",
      flipCodeRejected,
      flipCodeRejected
        ? "flipped cardCode fails Merkle proof (detected)"
        : "FAILED: flipped cardCode still verified",
    ),
    check(
      "mut.wrongProofPosition",
      wrongPosRejected,
      wrongPosRejected
        ? "wrong-position proof fails root check (detected)"
        : "FAILED: wrong-position proof still verified",
    ),
    check(
      "mut.duplicateCodes",
      duplicateRejected,
      duplicateRejected
        ? "duplicate card codes rejected by assertValidDeck"
        : "FAILED: duplicate deck accepted",
    ),
    check(
      "mut.wrongSalt",
      wrongSaltRejected,
      wrongSaltRejected
        ? "wrong salt fails public opening verify (detected)"
        : "FAILED: wrong salt still verified",
    ),
  ];
}
