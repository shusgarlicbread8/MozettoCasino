import { keccak256, toBytes, type Hex } from "viem";
import {
  deriveHandId,
  handSeed as deriveHandSeedV2,
  merkleRoot,
  secretLeaf as encodeSecretLeaf,
  domainTag,
  DOMAIN_STRINGS,
  enc,
} from "@mozetto/protocol-vectors";
import { prepareHandDeck } from "./deck.js";
import type { PreparedDeckBatch, SaltMode } from "./types.js";

const DOMAIN_DECK_BATCH = domainTag(DOMAIN_STRINGS.DECK_BATCH_V1);

export function fixtureDealerSecret(index: number): Hex {
  return keccak256(toBytes(`dealer-secret-${index}`));
}

export function buildSecretLeaves(
  sessionId: Hex,
  randomnessEpoch: bigint,
  secrets: readonly Hex[],
): Hex[] {
  return secrets.map((secret, index) =>
    encodeSecretLeaf(sessionId, randomnessEpoch, index, secret).hash,
  );
}

export function buildDealerSecretRoot(secretLeaves: readonly Hex[]): Hex {
  return merkleRoot([...secretLeaves]).root;
}

export function handSeedV2(args: {
  secret: Hex;
  vrfR: Hex;
  sessionId: Hex;
  epoch: bigint;
  index: number;
}): Hex {
  return deriveHandSeedV2(args);
}

export function deckBatchBind(
  sessionId: Hex,
  randomnessEpoch: bigint,
  deckBatchRoot: Hex,
): Hex {
  return keccak256(
    enc("bytes32 domain, bytes32 sessionId, uint64 epoch, bytes32 deckBatchRoot", [
      DOMAIN_DECK_BATCH,
      sessionId,
      randomnessEpoch,
      deckBatchRoot,
    ]),
  );
}

export function buildDeckBatchRoot(deckRoots: readonly Hex[]): Hex {
  return merkleRoot([...deckRoots]).root;
}

/**
 * Full Season-1 batch: secrets → secret root → handSeeds → shuffled decks → deckBatchRoot.
 */
export function prepareDeckBatch(opts: {
  sessionId: Hex;
  randomnessEpoch: bigint;
  vrfR: Hex;
  secrets: readonly Hex[];
  /** Hand numbers for handId (default: index). */
  handNumbers?: readonly bigint[];
  saltMode?: SaltMode;
}): PreparedDeckBatch {
  const { sessionId, randomnessEpoch, vrfR, secrets } = opts;
  const saltMode = opts.saltMode ?? "production";
  const secretLeaves = buildSecretLeaves(sessionId, randomnessEpoch, secrets);
  const dealerSecretRoot = buildDealerSecretRoot(secretLeaves);

  const hands = secrets.map((secret, index) => {
    const seed = handSeedV2({
      secret,
      vrfR,
      sessionId,
      epoch: randomnessEpoch,
      index,
    });
    const handNumber = opts.handNumbers?.[index] ?? BigInt(index);
    const handId = deriveHandId(sessionId, randomnessEpoch, handNumber).hash;
    return prepareHandDeck({
      handId,
      handSeed: seed,
      index,
      saltMode,
    });
  });

  const deckRoots = hands.map((h) => h.deckRoot);
  const deckBatchRoot = buildDeckBatchRoot(deckRoots);

  return {
    sessionId,
    randomnessEpoch,
    vrfR,
    secrets: [...secrets],
    secretLeaves,
    dealerSecretRoot,
    hands,
    deckRoots,
    deckBatchRoot,
    deckBatchBind: deckBatchBind(sessionId, randomnessEpoch, deckBatchRoot),
  };
}

export { encodeSecretLeaf, deriveHandId };
