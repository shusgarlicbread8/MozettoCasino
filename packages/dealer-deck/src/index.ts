export type {
  CardOpening,
  MerkleProofStep,
  PreparedHandDeck,
  PreparedDeckBatch,
  SaltMode,
} from "./types.js";

export { HandSeedCsprng } from "./csprng.js";
export {
  shuffleDeckV2,
  shuffleDeckBiasedModulo,
  assertValidDeck,
  DECK_SIZE,
} from "./shuffle.js";
export {
  CARD_SALT_DOMAIN,
  productionCardSalt,
  fixtureCardSalt,
  cardSaltsForDeck,
} from "./salts.js";
export {
  buildCardLeaves,
  buildDeckRoot,
  proofForPosition,
  verifyMerkleProof,
  openCard,
  prepareHandDeck,
  identityFixtureDeck,
  encodeCardLeaf,
} from "./deck.js";
export {
  fixtureDealerSecret,
  buildSecretLeaves,
  buildDealerSecretRoot,
  handSeedV2,
  deckBatchBind,
  buildDeckBatchRoot,
  prepareDeckBatch,
  encodeSecretLeaf,
  deriveHandId,
} from "./batch.js";

/** Re-export Protocol V3 primitives used by dealers/verifiers. */
export {
  handSeed,
  secretLeaf,
  cardLeaf,
  merkleRoot,
  merkleProof,
  deriveHandId as protocolDeriveHandId,
  DOMAIN_STRINGS,
  domainTag,
} from "@mozetto/protocol-vectors";
