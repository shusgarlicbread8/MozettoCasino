#!/usr/bin/env node
/**
 * Compute keccak256 golden hashes for specs/canonical-vectors/*.json
 * Encoding MUST match /specs/*.md (WP-010–014). Run:
 *   node scripts/compute-canonical-vectors.mjs
 */
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  concat,
  pad,
  toBytes,
  getAddress,
} from "viem";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../specs/canonical-vectors");

const domain = (s) => keccak256(toBytes(s));

const D = {
  SESSION_V2: domain("MOZETTO_SESSION_V2"),
  SESSION_ID_V1: domain("MOZETTO_SESSION_ID_V1"),
  HAND_ID_V1: domain("MOZETTO_HAND_ID_V1"),
  PARTICIPANT_LEAF_V1: domain("MOZETTO_PARTICIPANT_LEAF_V1"),
  EVENT_V1: domain("MOZETTO_EVENT_V1"),
  CARD_LEAF_V1: domain("MOZETTO_CARD_LEAF_V1"),
  DECK_ROOT_V1: domain("MOZETTO_DECK_ROOT_V1"),
  SECRET_LEAF_V1: domain("MOZETTO_SECRET_LEAF_V1"),
  HAND_SEED_V1: domain("MOZETTO_HAND_SEED_V1"),
  BALANCE_LEAF_V1: domain("MOZETTO_BALANCE_LEAF_V1"),
  PROFILE_V1: domain("MOZETTO_PROFILE_V1"),
  MODEL_POLICY_V1: domain("MOZETTO_MODEL_POLICY_V1"),
  PROOF_BATCH_V1: domain("MOZETTO_PROOF_BATCH_V1"),
  SETTLEMENT_V3: domain("MOZETTO_SETTLEMENT_V3"),
  ENERGY_OP_V1: domain("MOZETTO_ENERGY_OP_V1"),
  ENERGY_LEDGER_V1: domain("MOZETTO_ENERGY_LEDGER_V1"),
  GAME_TEMPLATE_V2: domain("MOZETTO_GAME_TEMPLATE_V2"),
  CONTROLLER_REQ_V1: domain("MOZETTO_CONTROLLER_REQUEST_V1"),
  CONTROLLER_RESP_V1: domain("MOZETTO_CONTROLLER_RESPONSE_V1"),
  OPENING_BALANCE_LEAF_V1: domain("MOZETTO_OPENING_BALANCE_LEAF_V1"),
  CONTROLLER_LEAF_V1: domain("MOZETTO_CONTROLLER_LEAF_V1"),
  DECK_BATCH_V1: domain("MOZETTO_DECK_BATCH_V1"),
  HAND_ROOT_V1: domain("MOZETTO_HAND_ROOT_V1"),
};

function enc(types, values) {
  return encodeAbiParameters(parseAbiParameters(types), values);
}

function hashEnc(types, values) {
  // encodeAbiParameters already returns Hex; do NOT wrap with toHex (that double-encodes ASCII).
  const bytes = enc(types, values);
  return { canonicalBytesHex: bytes, hash: keccak256(bytes) };
}

/** Ordered Merkle: pad with zeros to power-of-2; parent = keccak256(left || right) */
function merkleRoot(leaves) {
  if (leaves.length === 0) return { root: pad("0x00", { size: 32 }), layers: [[pad("0x00", { size: 32 })]] };
  let level = [...leaves];
  while (level.length & (level.length - 1)) level.push(pad("0x00", { size: 32 }));
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(keccak256(concat([level[i], level[i + 1]])));
    }
    level = next;
    layers.push(level);
  }
  return { root: level[0], layers };
}

function merkleProof(leaves, index) {
  const { layers } = merkleRoot(leaves);
  const proof = [];
  let idx = index;
  for (let d = 0; d < layers.length - 1; d++) {
    const sibling = idx ^ 1;
    proof.push({ sibling: layers[d][sibling], isLeft: sibling < idx });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

const ADDR = {
  alice: getAddress("0x1111111111111111111111111111111111111111"),
  bob: getAddress("0x2222222222222222222222222222222222222222"),
  carol: getAddress("0x3333333333333333333333333333333333333333"),
  dave: getAddress("0x4444444444444444444444444444444444444444"),
  eve: getAddress("0x5555555555555555555555555555555555555555"),
  frank: getAddress("0x6666666666666666666666666666666666666666"),
  arenaAlice: getAddress("0xa111111111111111111111111111111111111111"),
  arenaBob: getAddress("0xa222222222222222222222222222222222222222"),
  arenaCarol: getAddress("0xa333333333333333333333333333333333333333"),
  arenaDave: getAddress("0xa444444444444444444444444444444444444444"),
  arenaEve: getAddress("0xa555555555555555555555555555555555555555"),
  arenaFrank: getAddress("0xa666666666666666666666666666666666666666"),
  settlementHub: getAddress("0xbebebebebebebebebebebebebebebebebebebebe"),
};

const CHAIN_ANVIL = 31337n;
const PROTOCOL_V3 = 3;
const TEMPLATE_HU = keccak256(toBytes("NLHE_HU_STANDARD_V2"));
const TEMPLATE_6MAX = keccak256(toBytes("NLHE_SIXMAX_STANDARD_V2"));
const ENGINE_HASH = keccak256(toBytes("mozetto-nlhe-engine-v3-draft"));
const ZERO32 = pad("0x00", { size: 32 });
const FF32 = ("0x" + "ff".repeat(32));

function participantLeaf(p) {
  return hashEnc(
    "bytes32 domain, address owner, address arenaAccount, uint8 seat, uint256 buyIn, bytes32 controllerHash, bytes32 profileHash, bytes32 ratingPool, bool rated, uint256 seatTicketNonce",
    [
      D.PARTICIPANT_LEAF_V1,
      p.owner,
      p.arenaAccount,
      p.seat,
      p.buyIn,
      p.controllerHash,
      p.profileHash,
      p.ratingPool,
      p.rated,
      p.seatTicketNonce,
    ],
  );
}

function openingBalanceLeaf(p) {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, address arenaAccount, uint8 seat, uint256 openingBalance",
    [D.OPENING_BALANCE_LEAF_V1, p.sessionId, p.arenaAccount, p.seat, p.openingBalance],
  );
}

function controllerLeaf(p) {
  return hashEnc(
    "bytes32 domain, uint8 seat, bytes32 controllerHash",
    [D.CONTROLLER_LEAF_V1, p.seat, p.controllerHash],
  );
}

function profileHash(profile) {
  return hashEnc(
    "bytes32 domain, bytes32 profileId, uint16 profileVersion, bytes32 presetId, uint8 aggression, uint8 riskTolerance, uint8 deception, uint8 opponentAdaptation, uint8 trapPreference, uint8 tempo, uint8 variancePreference, uint8 energyConservation, uint32 allowedSchedulerWeights, uint64 createdAt, uint32 ownerCustomizationVersion",
    [
      D.PROFILE_V1,
      profile.profileId,
      profile.profileVersion,
      profile.presetId,
      profile.aggression,
      profile.riskTolerance,
      profile.deception,
      profile.opponentAdaptation,
      profile.trapPreference,
      profile.tempo,
      profile.variancePreference,
      profile.energyConservation,
      profile.allowedSchedulerWeights,
      profile.createdAt,
      profile.ownerCustomizationVersion,
    ],
  );
}

function modelPolicyHash(policy) {
  return hashEnc(
    "bytes32 domain, bytes32 policyId, uint16 policyVersion, bytes32 providerId, bytes32 modelId, bytes32 reasoningEffortPolicy, bytes32 outputMode, uint32 maxOutputTokens, uint32 temperatureMilli, bytes32 masterPolicyHash, bytes32 profileSetHash, bytes32 energyPolicyHash, bytes32 contextTruncationPolicy, bytes32 fallbackPolicyHash, bool toolsDisabled",
    [
      D.MODEL_POLICY_V1,
      policy.policyId,
      policy.policyVersion,
      policy.providerId,
      policy.modelId,
      policy.reasoningEffortPolicy,
      policy.outputMode,
      policy.maxOutputTokens,
      policy.temperatureMilli,
      policy.masterPolicyHash,
      policy.profileSetHash,
      policy.energyPolicyHash,
      policy.contextTruncationPolicy,
      policy.fallbackPolicyHash,
      policy.toolsDisabled,
    ],
  );
}

function eventHash(e) {
  return hashEnc(
    "bytes32 domain, uint16 protocolVersion, bytes32 sessionId, uint64 epoch, uint64 handNumber, uint64 sequence, uint16 eventType, bool hasActorSeat, uint8 actorSeat, bytes32 publicPayloadHash, bytes32 privatePayloadCommitment, uint64 elapsedMs, bytes32 previousEventHash, bytes32 engineHash",
    [
      D.EVENT_V1,
      e.protocolVersion,
      e.sessionId,
      e.epoch,
      e.handNumber,
      e.sequence,
      e.eventType,
      e.hasActorSeat,
      e.actorSeat,
      e.publicPayloadHash,
      e.privatePayloadCommitment,
      e.elapsedMs,
      e.previousEventHash,
      e.engineHash,
    ],
  );
}

function sessionDescriptorHash(s) {
  return hashEnc(
    "bytes32 domain, uint256 chainId, uint16 protocolVersion, bytes32 sessionId, bytes32 gameTemplateId, bytes32 participantRoot, bytes32 openingBalanceRoot, bytes32 controllerRoot, bytes32 profileRoot, bytes32 dealerSecretRoot, bytes32 randomnessPolicyId, bytes32 settlementPolicyId, uint64 createdAt, uint64 sealDeadline, bytes32 sessionNonce",
    [
      D.SESSION_V2,
      s.chainId,
      s.protocolVersion,
      s.sessionId,
      s.gameTemplateId,
      s.participantRoot,
      s.openingBalanceRoot,
      s.controllerRoot,
      s.profileRoot,
      s.dealerSecretRoot,
      s.randomnessPolicyId,
      s.settlementPolicyId,
      s.createdAt,
      s.sealDeadline,
      s.sessionNonce,
    ],
  );
}

function deriveSessionId(pre) {
  return hashEnc(
    "bytes32 domain, uint256 chainId, bytes32 gameTemplateId, bytes32 participantRoot, bytes32 sessionNonce, uint64 createdAt",
    [
      D.SESSION_ID_V1,
      pre.chainId,
      pre.gameTemplateId,
      pre.participantRoot,
      pre.sessionNonce,
      pre.createdAt,
    ],
  );
}

function deriveHandId(sessionId, epoch, handNumber) {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, uint64 epoch, uint64 handNumber",
    [D.HAND_ID_V1, sessionId, epoch, handNumber],
  );
}

function cardLeaf(handId, position, cardCode, cardSalt) {
  return hashEnc(
    "bytes32 domain, bytes32 handId, uint8 position, uint8 cardCode, bytes32 cardSalt",
    [D.CARD_LEAF_V1, handId, position, cardCode, cardSalt],
  );
}

function secretLeaf(sessionId, randomnessEpoch, i, S) {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, uint64 randomnessEpoch, uint16 index, bytes32 secret",
    [D.SECRET_LEAF_V1, sessionId, randomnessEpoch, i, S],
  );
}

function balanceLeaf(b) {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, uint64 epoch, address arenaAccount, uint8 seat, uint256 openingBalance, uint256 currentBalance, uint256 cumulativeRake, uint64 lastSequence",
    [
      D.BALANCE_LEAF_V1,
      b.sessionId,
      b.epoch,
      b.arenaAccount,
      b.seat,
      b.openingBalance,
      b.currentBalance,
      b.cumulativeRake,
      b.lastSequence,
    ],
  );
}

function energyOpHash(op) {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, bytes32 handId, uint8 seat, uint32 opIndex, uint16 operationType, uint16 energyDebit, uint16 remainingEnergy, bytes32 providerRequestId, bytes32 observationHash, bytes32 resultHash, bool fallbackFlag",
    [
      D.ENERGY_OP_V1,
      op.sessionId,
      op.handId,
      op.seat,
      op.opIndex,
      op.operationType,
      op.energyDebit,
      op.remainingEnergy,
      op.providerRequestId,
      op.observationHash,
      op.resultHash,
      op.fallbackFlag,
    ],
  );
}

function settlementStructHash(s) {
  // EIP-712 typehash for FinalSettlementV3
  const TYPEHASH = keccak256(
    toBytes(
      "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)",
    ),
  );
  const structHash = keccak256(
    enc(
      "bytes32 typehash, bytes32 sessionId, uint64 finalSequence, bytes32 finalEventRoot, bytes32 handRoot, bytes32 balanceRoot, bytes32 randomnessEpochId, uint256 openingTotal, uint256 endingPlayerTotal, uint256 totalRake, uint64 proofBatchSequence, bytes32 modelPolicyHash, bytes32 profileSetHash, bytes32 gameTemplateId, bytes32 engineHash, uint256 deadline",
      [
        TYPEHASH,
        s.sessionId,
        s.finalSequence,
        s.finalEventRoot,
        s.handRoot,
        s.balanceRoot,
        s.randomnessEpochId,
        s.openingTotal,
        s.endingPlayerTotal,
        s.totalRake,
        s.proofBatchSequence,
        s.modelPolicyHash,
        s.profileSetHash,
        s.gameTemplateId,
        s.engineHash,
        s.deadline,
      ],
    ),
  );
  const domainSeparator = keccak256(
    enc(
      "bytes32 typehash, bytes32 name, bytes32 version, uint256 chainId, address verifyingContract",
      [
        keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(toBytes("MozettoPokerSettlement")),
        keccak256(toBytes("3")),
        s.chainId,
        s.verifyingContract,
      ],
    ),
  );
  const digest = keccak256(concat(["0x1901", domainSeparator, structHash]));
  return { TYPEHASH, structHash, domainSeparator, digest, typeString: "FinalSettlementV3(...)" };
}

function proofBatchLeaf(b) {
  return hashEnc(
    "bytes32 domain, uint64 sequence, bytes32 previousBatchRoot, bytes32 globalRoot, bytes32 dataManifestHash, uint64 createdAt",
    [D.PROOF_BATCH_V1, b.sequence, b.previousBatchRoot, b.globalRoot, b.dataManifestHash, b.createdAt],
  );
}

// ========== Build fixtures ==========

const ratingPoolHu = keccak256(toBytes("RATING_POOL_HU_SEASON1"));
const controllerHashAi = keccak256(toBytes("CONTROLLER_GROQ_SEASON1"));
const sharkPreset = keccak256(toBytes("PRESET_SHARK"));
const foxPreset = keccak256(toBytes("PRESET_FOX"));
const machinePreset = keccak256(toBytes("PRESET_MACHINE"));
const professorPreset = keccak256(toBytes("PRESET_PROFESSOR"));
const randomnessPolicy = keccak256(toBytes("RANDOMNESS_POLICY_V2_SEASON1"));
const settlementPolicy = keccak256(toBytes("SETTLEMENT_POLICY_V3_SEASON1"));

const sharkProfile = {
  profileId: keccak256(toBytes("profile-alice-shark-1")),
  profileVersion: 1,
  presetId: sharkPreset,
  aggression: 82,
  riskTolerance: 70,
  deception: 55,
  opponentAdaptation: 48,
  trapPreference: 40,
  tempo: 75,
  variancePreference: 68,
  energyConservation: 35,
  allowedSchedulerWeights: 0x00ff00ff,
  createdAt: 1723000000n,
  ownerCustomizationVersion: 1,
};
const bobProfile = {
  ...sharkProfile,
  profileId: keccak256(toBytes("profile-bob-machine-1")),
  presetId: machinePreset,
  aggression: 50,
  riskTolerance: 50,
  deception: 50,
  opponentAdaptation: 50,
  trapPreference: 50,
  tempo: 50,
  variancePreference: 50,
  energyConservation: 50,
};

const alicePh = profileHash(sharkProfile);
const bobPh = profileHash(bobProfile);

const participantsHu = [
  {
    owner: ADDR.alice,
    arenaAccount: ADDR.arenaAlice,
    seat: 0,
    buyIn: 100_000_000n, // 100 USDC
    controllerHash: controllerHashAi,
    profileHash: alicePh.hash,
    ratingPool: ratingPoolHu,
    rated: true,
    seatTicketNonce: 1n,
  },
  {
    owner: ADDR.bob,
    arenaAccount: ADDR.arenaBob,
    seat: 1,
    buyIn: 100_000_000n,
    controllerHash: controllerHashAi,
    profileHash: bobPh.hash,
    ratingPool: ratingPoolHu,
    rated: true,
    seatTicketNonce: 2n,
  },
];

const pLeavesHu = participantsHu.map((p) => participantLeaf(p).hash);
const participantRootHu = merkleRoot(pLeavesHu).root;

const sessionNonceHu = keccak256(toBytes("session-nonce-hu-001"));
const createdAtHu = 1723001000n;
const sessionIdHuPre = deriveSessionId({
  chainId: CHAIN_ANVIL,
  gameTemplateId: TEMPLATE_HU,
  participantRoot: participantRootHu,
  sessionNonce: sessionNonceHu,
  createdAt: createdAtHu,
});
const sessionIdHu = sessionIdHuPre.hash;

const openingLeavesHu = participantsHu.map((p) =>
  openingBalanceLeaf({
    sessionId: sessionIdHu,
    arenaAccount: p.arenaAccount,
    seat: p.seat,
    openingBalance: p.buyIn,
  }).hash,
);
const openingBalanceRootHu = merkleRoot(openingLeavesHu).root;
const controllerRootHu = merkleRoot(
  participantsHu.map((p) => controllerLeaf({ seat: p.seat, controllerHash: p.controllerHash }).hash),
).root;
const profileRootHu = merkleRoot([alicePh.hash, bobPh.hash]).root;

// Dealer secrets (2 for fixture brevity; Season 1 default N=256)
const secrets = [
  keccak256(toBytes("dealer-secret-0")),
  keccak256(toBytes("dealer-secret-1")),
];
const randomnessEpoch = 0n;
const secretLeaves = secrets.map((S, i) => secretLeaf(sessionIdHu, randomnessEpoch, i, S).hash);
const dealerSecretRoot = merkleRoot(secretLeaves).root;

const sessionHu = {
  chainId: CHAIN_ANVIL,
  protocolVersion: PROTOCOL_V3,
  sessionId: sessionIdHu,
  gameTemplateId: TEMPLATE_HU,
  participantRoot: participantRootHu,
  openingBalanceRoot: openingBalanceRootHu,
  controllerRoot: controllerRootHu,
  profileRoot: profileRootHu,
  dealerSecretRoot,
  randomnessPolicyId: randomnessPolicy,
  settlementPolicyId: settlementPolicy,
  createdAt: createdAtHu,
  sealDeadline: createdAtHu + 600n,
  sessionNonce: sessionNonceHu,
};
const sessionHuHash = sessionDescriptorHash(sessionHu);

// Six-max
const sixOwners = [
  [ADDR.alice, ADDR.arenaAlice],
  [ADDR.bob, ADDR.arenaBob],
  [ADDR.carol, ADDR.arenaCarol],
  [ADDR.dave, ADDR.arenaDave],
  [ADDR.eve, ADDR.arenaEve],
  [ADDR.frank, ADDR.arenaFrank],
];
const participants6 = sixOwners.map(([owner, arena], seat) => {
  const ph = profileHash({
    ...bobProfile,
    profileId: keccak256(toBytes(`profile-seat-${seat}`)),
    presetId: [sharkPreset, machinePreset, foxPreset, professorPreset, sharkPreset, machinePreset][seat],
    aggression: [80, 50, 45, 30, 70, 55][seat],
  });
  return {
    owner,
    arenaAccount: arena,
    seat,
    buyIn: 50_000_000n,
    controllerHash: controllerHashAi,
    profileHash: ph.hash,
    ratingPool: keccak256(toBytes("RATING_POOL_SIXMAX_SEASON1")),
    rated: true,
    seatTicketNonce: BigInt(seat + 10),
    _ph: ph,
  };
});
const pLeaves6 = participants6.map((p) => participantLeaf(p).hash);
const participantRoot6 = merkleRoot(pLeaves6).root;
const sessionNonce6 = keccak256(toBytes("session-nonce-6max-001"));
const createdAt6 = 1723002000n;
const sessionId6 = deriveSessionId({
  chainId: CHAIN_ANVIL,
  gameTemplateId: TEMPLATE_6MAX,
  participantRoot: participantRoot6,
  sessionNonce: sessionNonce6,
  createdAt: createdAt6,
}).hash;
const openingRoot6 = merkleRoot(
  participants6.map((p) =>
    openingBalanceLeaf({
      sessionId: sessionId6,
      arenaAccount: p.arenaAccount,
      seat: p.seat,
      openingBalance: p.buyIn,
    }).hash,
  ),
).root;
const controllerRoot6 = merkleRoot(
  participants6.map((p) => controllerLeaf({ seat: p.seat, controllerHash: p.controllerHash }).hash),
).root;
const profileRoot6 = merkleRoot(participants6.map((p) => p.profileHash)).root;
const dealerSecretRoot6 = dealerSecretRoot; // reuse structure for fixture
const session6 = {
  chainId: CHAIN_ANVIL,
  protocolVersion: PROTOCOL_V3,
  sessionId: sessionId6,
  gameTemplateId: TEMPLATE_6MAX,
  participantRoot: participantRoot6,
  openingBalanceRoot: openingRoot6,
  controllerRoot: controllerRoot6,
  profileRoot: profileRoot6,
  dealerSecretRoot: dealerSecretRoot6,
  randomnessPolicyId: randomnessPolicy,
  settlementPolicyId: settlementPolicy,
  createdAt: createdAt6,
  sealDeadline: createdAt6 + 600n,
  sessionNonce: sessionNonce6,
};
const session6Hash = sessionDescriptorHash(session6);

// Events — event types
const ET = {
  HAND_START: 1,
  POST_BLIND: 2,
  DEAL_HOLE: 3,
  ACTION_FOLD: 10,
  ACTION_CHECK: 11,
  ACTION_CALL: 12,
  ACTION_BET: 13,
  ACTION_RAISE: 14,
  ACTION_ALL_IN: 15,
  STREET_FLOP: 20,
  STREET_TURN: 21,
  STREET_RIVER: 22,
  SHOWDOWN: 30,
  HAND_END: 40,
};

const handId0 = deriveHandId(sessionIdHu, 0n, 1n).hash;
let prev = ZERO32;
const preflopEvents = [];
function pushEvent(partial) {
  const e = {
    protocolVersion: PROTOCOL_V3,
    sessionId: sessionIdHu,
    epoch: 0n,
    handNumber: 1n,
    sequence: BigInt(preflopEvents.length),
    privatePayloadCommitment: ZERO32,
    engineHash: ENGINE_HASH,
    previousEventHash: prev,
    ...partial,
  };
  const h = eventHash(e);
  preflopEvents.push({ ...e, ...h, eventHash: h.hash });
  prev = h.hash;
}

pushEvent({
  eventType: ET.HAND_START,
  hasActorSeat: false,
  actorSeat: 0,
  publicPayloadHash: keccak256(toBytes("hand-start-1")),
  elapsedMs: 0n,
});
pushEvent({
  eventType: ET.POST_BLIND,
  hasActorSeat: true,
  actorSeat: 0,
  publicPayloadHash: keccak256(enc("uint8 seat, uint256 amount", [0, 500_000n])),
  elapsedMs: 10n,
});
pushEvent({
  eventType: ET.POST_BLIND,
  hasActorSeat: true,
  actorSeat: 1,
  publicPayloadHash: keccak256(enc("uint8 seat, uint256 amount", [1, 1_000_000n])),
  elapsedMs: 20n,
});
pushEvent({
  eventType: ET.DEAL_HOLE,
  hasActorSeat: false,
  actorSeat: 0,
  publicPayloadHash: keccak256(toBytes("hole-dealt-committed")),
  privatePayloadCommitment: keccak256(toBytes("private-hole-commitment")),
  elapsedMs: 50n,
});
pushEvent({
  eventType: ET.ACTION_RAISE,
  hasActorSeat: true,
  actorSeat: 0,
  publicPayloadHash: keccak256(enc("uint8 seat, uint16 action, uint256 amount", [0, ET.ACTION_RAISE, 3_000_000n])),
  elapsedMs: 4200n,
});
pushEvent({
  eventType: ET.ACTION_CALL,
  hasActorSeat: true,
  actorSeat: 1,
  publicPayloadHash: keccak256(enc("uint8 seat, uint16 action, uint256 amount", [1, ET.ACTION_CALL, 2_000_000n])),
  elapsedMs: 8100n,
});

// Card leaves for hand
const deckOrder = Array.from({ length: 52 }, (_, i) => i); // identity for vector
const cardSalts = deckOrder.map((i) => keccak256(toBytes(`card-salt-${i}`)));
const cardLeaves = deckOrder.map((code, pos) => cardLeaf(handId0, pos, code, cardSalts[pos]).hash);
const deckMerkle = merkleRoot(cardLeaves);
const cardProof0 = merkleProof(cardLeaves, 0);

// Hand seed: document keccak construction (Season 1 uses keccak alternative to HKDF)
const vrfR = keccak256(toBytes("vrf-fulfillment-R-demo"));
const handSeed0 = keccak256(
  enc(
    "bytes32 domain, bytes32 secret, bytes32 vrfR, bytes32 sessionId, uint64 epoch, uint16 index",
    [D.HAND_SEED_V1, secrets[0], vrfR, sessionIdHu, randomnessEpoch, 0],
  ),
);

// Model policy
const modelPolicy = {
  policyId: keccak256(toBytes("MOZETTO_AI_ENGINE_SEASON_1")),
  policyVersion: 1,
  providerId: keccak256(toBytes("groq")),
  modelId: keccak256(toBytes("openai/gpt-oss-120b")),
  reasoningEffortPolicy: keccak256(toBytes("reasoning-by-cognitive-mode-v1")),
  outputMode: keccak256(toBytes("strict-json-schema-v1")),
  maxOutputTokens: 256,
  temperatureMilli: 0, // frozen default hypothesis
  masterPolicyHash: keccak256(toBytes("master-poker-policy-season1-v1")),
  profileSetHash: keccak256(toBytes("profile-set-season1-v1")),
  energyPolicyHash: keccak256(toBytes("energy-policy-season1-100-v1")),
  contextTruncationPolicy: keccak256(toBytes("context-truncation-v1")),
  fallbackPolicyHash: keccak256(toBytes("deterministic-fallback-v1")),
  toolsDisabled: true,
};
const modelPh = modelPolicyHash(modelPolicy);

// Energy ledger
const energyOps = [];
let energy = 100;
const energySequence = [
  { operationType: 1, debit: 0, name: "DETERMINISTIC_INGEST" },
  { operationType: 4, debit: 4, name: "OPPONENT_UPDATE" },
  { operationType: 5, debit: 6, name: "STREET_PLAN" },
  { operationType: 7, debit: 8, name: "STANDARD_FINAL_DECISION" },
];
energySequence.forEach((op, i) => {
  energy -= op.debit;
  const rec = {
    sessionId: sessionIdHu,
    handId: handId0,
    seat: 0,
    opIndex: i,
    operationType: op.operationType,
    energyDebit: op.debit,
    remainingEnergy: energy,
    providerRequestId: op.debit === 0 ? ZERO32 : keccak256(toBytes(`groq-req-${i}`)),
    observationHash: keccak256(toBytes(`obs-${i}`)),
    resultHash: keccak256(toBytes(`result-${i}`)),
    fallbackFlag: false,
    name: op.name,
  };
  const h = energyOpHash(rec);
  energyOps.push({ ...rec, ...h, opHash: h.hash });
});
const energyLedgerRoot = merkleRoot(energyOps.map((o) => o.opHash)).root;
const energyLedgerHash = hashEnc(
  "bytes32 domain, bytes32 sessionId, bytes32 handId, uint8 seat, uint16 startingEnergy, bytes32 opsRoot, uint16 endingEnergy",
  [D.ENERGY_LEDGER_V1, sessionIdHu, handId0, 0, 100, energyLedgerRoot, energy],
);

// Settlement
const balLeaves = [
  balanceLeaf({
    sessionId: sessionIdHu,
    epoch: 0n,
    arenaAccount: ADDR.arenaAlice,
    seat: 0,
    openingBalance: 100_000_000n,
    currentBalance: 102_450_000n,
    cumulativeRake: 550_000n,
    lastSequence: 42n,
  }).hash,
  balanceLeaf({
    sessionId: sessionIdHu,
    epoch: 0n,
    arenaAccount: ADDR.arenaBob,
    seat: 1,
    openingBalance: 100_000_000n,
    currentBalance: 96_450_000n,
    cumulativeRake: 550_000n,
    lastSequence: 42n,
  }).hash,
];
const balanceRoot = merkleRoot(balLeaves).root;
const finalEventRoot = prev; // last preflop chain tip used as stand-in
const handRoot = keccak256(
  enc(
    "bytes32 domain, bytes32 handId, bytes32 eventChainTip, bytes32 deckRoot, bytes32 openingStateHash, bytes32 endingStateHash, uint256 handRake, bytes32 energyLedgerRoot",
    [
      domain("MOZETTO_HAND_ROOT_V1"),
      handId0,
      finalEventRoot,
      deckMerkle.root,
      keccak256(toBytes("opening-state")),
      keccak256(toBytes("ending-state")),
      550_000n,
      energyLedgerHash.hash,
    ],
  ),
);

const settlement = {
  sessionId: sessionIdHu,
  finalSequence: 42n,
  finalEventRoot,
  handRoot,
  balanceRoot,
  randomnessEpochId: keccak256(
    enc("bytes32 sessionId, uint64 epoch", [sessionIdHu, randomnessEpoch]),
  ),
  openingTotal: 200_000_000n,
  endingPlayerTotal: 198_900_000n,
  totalRake: 1_100_000n,
  proofBatchSequence: 7n,
  modelPolicyHash: modelPh.hash,
  profileSetHash: modelPolicy.profileSetHash,
  gameTemplateId: TEMPLATE_HU,
  engineHash: ENGINE_HASH,
  deadline: 1723010000n,
  chainId: CHAIN_ANVIL,
  verifyingContract: ADDR.settlementHub,
};
const settleHashes = settlementStructHash(settlement);

// Proof batch
const checkpointRoots = [
  keccak256(toBytes("checkpoint-table-a")),
  keccak256(toBytes("checkpoint-table-b")),
  keccak256(toBytes("checkpoint-table-c")),
];
const globalRoot = merkleRoot(checkpointRoots).root;
const proofBatch = {
  sequence: 7n,
  previousBatchRoot: keccak256(toBytes("proof-batch-6")),
  globalRoot,
  dataManifestHash: keccak256(toBytes("manifest-cid-demo")),
  createdAt: 1723005000n,
};
const proofBatchH = proofBatchLeaf(proofBatch);

// Emergency exit leaf (same encoding as balance leaf at checkpoint)
const emergencyLeaf = balanceLeaf({
  sessionId: sessionIdHu,
  epoch: 0n,
  arenaAccount: ADDR.arenaAlice,
  seat: 0,
  openingBalance: 100_000_000n,
  currentBalance: 101_000_000n,
  cumulativeRake: 200_000n,
  lastSequence: 20n,
});
const emergencyLeaves = [
  emergencyLeaf.hash,
  balanceLeaf({
    sessionId: sessionIdHu,
    epoch: 0n,
    arenaAccount: ADDR.arenaBob,
    seat: 1,
    openingBalance: 100_000_000n,
    currentBalance: 98_800_000n,
    cumulativeRake: 200_000n,
    lastSequence: 20n,
  }).hash,
];
const emergencyRoot = merkleRoot(emergencyLeaves).root;
const emergencyProof = merkleProof(emergencyLeaves, 0);

function writeJson(name, obj) {
  writeFileSync(join(OUT, name), JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  console.log("wrote", name);
}

mkdirSync(OUT, { recursive: true });

// Export domain table
writeJson("_domains.json", Object.fromEntries(Object.entries(D).map(([k, v]) => [k, v])));

writeJson("01_session_hu.json", {
  vectorId: "01_session_hu",
  specRefs: ["MOZETTO_PROTOCOL_V3.md", "MOZETTO_SESSION_V2.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Two-player HU session descriptor on Anvil with sealed participants",
    chainId: Number(CHAIN_ANVIL),
    protocolVersion: PROTOCOL_V3,
    seats: participantsHu.map((p) => ({
      owner: p.owner,
      arenaAccount: p.arenaAccount,
      seat: p.seat,
      buyInUsdcBaseUnits: p.buyIn.toString(),
      rated: p.rated,
    })),
    blinds: { smallBlind: "500000", bigBlind: "1000000" },
  },
  encodingRecipe: {
    participantLeaf:
      "keccak256(abi.encode(DOMAIN_PARTICIPANT_LEAF_V1, owner, arenaAccount, seat, buyIn, controllerHash, profileHash, ratingPool, rated, seatTicketNonce))",
    sessionId:
      "keccak256(abi.encode(DOMAIN_SESSION_ID_V1, chainId, gameTemplateId, participantRoot, sessionNonce, createdAt))",
    sessionDescriptor:
      "keccak256(abi.encode(DOMAIN_SESSION_V2, chainId, protocolVersion, sessionId, gameTemplateId, participantRoot, openingBalanceRoot, controllerRoot, profileRoot, dealerSecretRoot, randomnessPolicyId, settlementPolicyId, createdAt, sealDeadline, sessionNonce))",
    merkle: "pad to power-of-2 with bytes32(0); parent = keccak256(left || right) positional",
  },
  intermediate: {
    domains: { PARTICIPANT_LEAF_V1: D.PARTICIPANT_LEAF_V1, SESSION_V2: D.SESSION_V2, SESSION_ID_V1: D.SESSION_ID_V1 },
    participantLeaves: pLeavesHu,
    participantRoot: participantRootHu,
    openingBalanceRoot: openingBalanceRootHu,
    controllerRoot: controllerRootHu,
    profileRoot: profileRootHu,
    dealerSecretRoot,
    sessionIdPreimage: sessionIdHuPre,
  },
  canonicalBytesHex: sessionHuHash.canonicalBytesHex,
  keccak256: sessionHuHash.hash,
  expectedDecodedStructure: sessionHu,
  expectedFailureMutations: [
    { mutation: "swap seat indices of participants then recompute root", expect: "sessionId and descriptor hash change" },
    { mutation: "change buyIn of seat 0 by 1", expect: "participant leaf and roots diverge" },
    { mutation: "reuse DOMAIN_EVENT_V1 instead of DOMAIN_SESSION_V2", expect: "hash mismatch vs golden" },
    { mutation: "hash JSON.stringify(session)", expect: "MUST fail conformance — JSON not consensus" },
  ],
});

writeJson("02_session_sixmax.json", {
  vectorId: "02_session_sixmax",
  specRefs: ["MOZETTO_PROTOCOL_V3.md", "MOZETTO_SESSION_V2.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Six-max session with seats 0..5, 50 USDC buy-in each",
    chainId: Number(CHAIN_ANVIL),
    seatCount: 6,
    buyInUsdcBaseUnits: "50000000",
  },
  encodingRecipe: { sameAs: "01_session_hu.json with TEMPLATE_SIXMAX and 6 leaves" },
  intermediate: {
    participantLeaves: pLeaves6,
    participantRoot: participantRoot6,
    sessionId: sessionId6,
  },
  canonicalBytesHex: session6Hash.canonicalBytesHex,
  keccak256: session6Hash.hash,
  expectedDecodedStructure: session6,
  expectedFailureMutations: [
    { mutation: "omit seat 3 leaf", expect: "root and sessionId change" },
    { mutation: "use HU template id", expect: "descriptor hash changes" },
    { mutation: "seat index 6", expect: "invalid — seat MUST be 0..5 for six-max" },
  ],
});

writeJson("03_preflop_sequence.json", {
  vectorId: "03_preflop_sequence",
  specRefs: ["MOZETTO_POKER_EVENT_V1.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "HU preflop: blinds, deal hole, BTN raise to 3bb, BB call",
    sessionId: sessionIdHu,
    handId: handId0,
    actions: ["SB 0.5", "BB 1.0", "deal", "seat0 raise 3.0", "seat1 call"],
  },
  encodingRecipe: {
    eventHash:
      "keccak256(abi.encode(DOMAIN_EVENT_V1, protocolVersion, sessionId, epoch, handNumber, sequence, eventType, hasActorSeat, actorSeat, publicPayloadHash, privatePayloadCommitment, elapsedMs, previousEventHash, engineHash))",
  },
  canonicalBytesHex: preflopEvents[preflopEvents.length - 1].canonicalBytesHex,
  keccak256: preflopEvents[preflopEvents.length - 1].hash,
  expectedDecodedStructure: {
    events: preflopEvents.map((e) => ({
      sequence: e.sequence.toString(),
      eventType: e.eventType,
      hasActorSeat: e.hasActorSeat,
      actorSeat: e.actorSeat,
      elapsedMs: e.elapsedMs.toString(),
      previousEventHash: e.previousEventHash,
      eventHash: e.eventHash,
      canonicalBytesHex: e.canonicalBytesHex,
    })),
    chainTip: prev,
  },
  expectedFailureMutations: [
    { mutation: "reorder raise and call", expect: "hash chain breaks from first divergent sequence" },
    { mutation: "alter elapsedMs on call", expect: "event hash and all successors change" },
    { mutation: "set previousEventHash to zero on sequence 1", expect: "chain invalid" },
    { mutation: "hasActorSeat=false but actorSeat=1", expect: "invalid encoding — actorSeat MUST be 0 when absent" },
  ],
});

const incompleteAllInEvents = (() => {
  let p = ZERO32;
  const evs = [];
  const mk = (partial) => {
    const e = {
      protocolVersion: PROTOCOL_V3,
      sessionId: sessionIdHu,
      epoch: 0n,
      handNumber: 2n,
      sequence: BigInt(evs.length),
      privatePayloadCommitment: ZERO32,
      engineHash: ENGINE_HASH,
      previousEventHash: p,
      hasActorSeat: true,
      ...partial,
    };
    const h = eventHash(e);
    evs.push({ ...e, eventHash: h.hash, canonicalBytesHex: h.canonicalBytesHex });
    p = h.hash;
  };
  mk({
    eventType: ET.ACTION_RAISE,
    actorSeat: 0,
    publicPayloadHash: keccak256(enc("uint8,uint16,uint256", [0, ET.ACTION_RAISE, 3_000_000n])),
    elapsedMs: 3000n,
  });
  mk({
    eventType: ET.ACTION_ALL_IN,
    actorSeat: 1,
    publicPayloadHash: keccak256(enc("uint8,uint16,uint256", [1, ET.ACTION_ALL_IN, 2_500_000n])),
    elapsedMs: 5500n,
  });
  mk({
    eventType: ET.ACTION_CALL,
    actorSeat: 0,
    publicPayloadHash: keccak256(enc("uint8,uint16,uint256", [0, ET.ACTION_CALL, 0n])),
    elapsedMs: 7000n,
  });
  return evs;
})();

writeJson("04_incomplete_allin_raise.json", {
  vectorId: "04_incomplete_allin_raise",
  specRefs: ["MOZETTO_POKER_EVENT_V1.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description:
      "Seat 0 open-raises; seat 1 shoves all-in for less than a full raise (incomplete raise). Seat 0 may only fold/call — not re-raise — when facing an incomplete all-in that does not reopen.",
    ruleNote: "Legal reopen requires full min-raise; short all-in does not reopen action for prior aggressor.",
    stacksUsdc: { seat0: "100000000", seat1: "2500000" },
    blinds: { sb: "500000", bb: "1000000" },
    line: ["seat0 raise to 3000000", "seat1 all-in 2500000 (covers call of 2000000 + 500000 extra < min-raise)", "seat0 may fold or call only"],
  },
  events: incompleteAllInEvents.map((e) => ({
    sequence: e.sequence.toString(),
    eventType: e.eventType,
    actorSeat: e.actorSeat,
    eventHash: e.eventHash,
    canonicalBytesHex: e.canonicalBytesHex,
    elapsedMs: e.elapsedMs.toString(),
    previousEventHash: e.previousEventHash,
  })),
  expectedDecodedStructure: {
    reopenAllowed: false,
    legalActionsForSeat0AfterShortAllIn: ["fold", "call"],
    illegalActions: ["raise", "bet"],
  },
  keccak256: incompleteAllInEvents[incompleteAllInEvents.length - 1].eventHash,
  canonicalBytesHex: incompleteAllInEvents[incompleteAllInEvents.length - 1].canonicalBytesHex,
  note: "Per-event hashes listed in events[]; chain tip keccak256 is last eventHash",
  expectedFailureMutations: [
    { mutation: "encode seat0 re-raise after incomplete all-in as legal", expect: "engine MUST reject; vector failure" },
    { mutation: "treat short all-in as full raise", expect: "side-pot / action legality diverge from oracle" },
  ],
});

const sidePotBalance = (() => {
  const sid = sessionId6;
  const leaves = [
    { seat: 0, arena: ADDR.arenaAlice, open: 100_000_000n, end: 140_000_000n },
    { seat: 1, arena: ADDR.arenaBob, open: 100_000_000n, end: 50_000_000n },
    { seat: 2, arena: ADDR.arenaCarol, open: 100_000_000n, end: 110_000_000n },
  ].map((x) => {
    const h = balanceLeaf({
      sessionId: sid,
      epoch: 0n,
      arenaAccount: x.arena,
      seat: x.seat,
      openingBalance: x.open,
      currentBalance: x.end,
      cumulativeRake: 0n,
      lastSequence: 100n,
    });
    return { seat: x.seat, canonicalBytesHex: h.canonicalBytesHex, leafHash: h.hash };
  });
  const root = merkleRoot(leaves.map((l) => l.leafHash)).root;
  return { leaves, balanceRoot: root };
})();

writeJson("05_three_way_side_pot.json", {
  vectorId: "05_three_way_side_pot",
  specRefs: ["MOZETTO_POKER_EVENT_V1.md", "MOZETTO_SETTLEMENT_V3.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...)) for balance leaves; pot math is integer USDC base units",
  humanReadableInput: {
    description: "Three-way pot: seat0 all-in 20 USDC, seat1 all-in 50 USDC, seat2 covers 100 USDC. Main pot 60; side pot 60 between seat1/seat2.",
    contributionsUsdcBaseUnits: { seat0: "20000000", seat1: "50000000", seat2: "50000000" },
    showdown: {
      winners: {
        mainPot: "seat0",
        sidePot: "seat2",
      },
      mainPot: "60000000",
      sidePot: "60000000",
      rakeMain: "0",
      rakeSide: "0",
      note: "Rake application is template-policy; this vector isolates side-pot partitioning before rake",
    },
  },
  expectedDecodedStructure: {
    pots: [
      { potIndex: 0, amount: "60000000", eligibleSeats: [0, 1, 2], winnerSeats: [0] },
      { potIndex: 1, amount: "60000000", eligibleSeats: [1, 2], winnerSeats: [2] },
    ],
    endingStacksDelta: { seat0: "+40000000", seat1: "-50000000", seat2: "+10000000" },
  },
  balanceLeaves: sidePotBalance,
  canonicalBytesHex: sidePotBalance.leaves[0].canonicalBytesHex,
  keccak256: sidePotBalance.balanceRoot,
  note: "Primary commitment is balanceLeaves.balanceRoot; leaf0 canonical bytes included for encoder checks",
  expectedFailureMutations: [
    { mutation: "award side pot to seat0", expect: "ineligible — MUST fail" },
    { mutation: "merge pots into single 120 without eligibility", expect: "conservation may hold but legality fails" },
    { mutation: "floating-point division of pot", expect: "MUST NOT — integer only" },
  ],
});

writeJson("06_split_pot_odd_chip.json", {
  vectorId: "06_split_pot_odd_chip",
  specRefs: ["MOZETTO_POKER_EVENT_V1.md"],
  hashStatus: "computed_rule",
  hashingAlgorithm: "integer split; odd chip to earliest seat clockwise from button (canonical)",
  humanReadableInput: {
    description: "HU split pot of 1_000_001 base units (odd chip). Button is seat 0; odd chip goes to seat 1 (left of button).",
    pot: "1000001",
    winners: [0, 1],
    buttonSeat: 0,
    oddChipRule: "Among tied winners, odd residual base units are awarded one-at-a-time to the winner with the lowest seat index strictly greater than buttonSeat (wrapping), until residual is 0.",
  },
  expectedDecodedStructure: {
    awards: { seat0: "500000", seat1: "500001" },
    oddChipRecipient: 1,
  },
  canonicalBytesHex: enc("uint256 pot, uint8 button, uint8 w0, uint8 w1, uint256 a0, uint256 a1", [
    1_000_001n,
    0,
    0,
    1,
    500_000n,
    500_001n,
  ]),
  keccak256: keccak256(
    enc("uint256 pot, uint8 button, uint8 w0, uint8 w1, uint256 a0, uint256 a1", [
      1_000_001n,
      0,
      0,
      1,
      500_000n,
      500_001n,
    ]),
  ),
  expectedFailureMutations: [
    { mutation: "give odd chip to button seat 0", expect: "fails odd-chip rule" },
    { mutation: "discard odd chip", expect: "breaks conservation" },
    { mutation: "split as 500000.5", expect: "forbidden float" },
  ],
});

writeJson("07_card_leaf_merkle.json", {
  vectorId: "07_card_leaf_merkle",
  specRefs: ["MOZETTO_RANDOMNESS_V2.md", "MOZETTO_PROTOCOL_V3.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...)); Merkle positional",
  humanReadableInput: {
    description: "Identity deck 0..51 with deterministic salts; prove position 0 cardCode=0 (2c)",
    handId: handId0,
    cardMapping: "card = suitIndex*13 + rankIndex; 0=2c ... 51=As",
    position0: { cardCode: 0, label: "2c" },
  },
  encodingRecipe: {
    cardLeaf: "keccak256(abi.encode(DOMAIN_CARD_LEAF_V1, handId, position, cardCode, cardSalt))",
  },
  leaf0: {
    canonicalBytesHex: cardLeaf(handId0, 0, 0, cardSalts[0]).canonicalBytesHex,
    keccak256: cardLeaves[0],
    cardSalt: cardSalts[0],
  },
  deckRoot: deckMerkle.root,
  merkleProofPosition0: cardProof0,
  canonicalBytesHex: cardLeaf(handId0, 0, 0, cardSalts[0]).canonicalBytesHex,
  keccak256: cardLeaves[0],
  expectedDecodedStructure: {
    deckRoot: deckMerkle.root,
    leafCount: 52,
    paddedLeafCount: 64,
  },
  expectedFailureMutations: [
    { mutation: "flip cardCode 0→1 with same salt", expect: "leaf and proof fail" },
    { mutation: "wrong position in proof", expect: "root mismatch" },
    { mutation: "duplicate card codes in deck", expect: "deck validity MUST fail" },
  ],
});

writeJson("08_dealer_secret_hand_seed.json", {
  vectorId: "08_dealer_secret_hand_seed",
  specRefs: ["MOZETTO_RANDOMNESS_V2.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...)) for leaves and Season-1 handSeed (keccak construction; HKDF-SHA256 allowed as alternate only with new policy version)",
  humanReadableInput: {
    description: "Two dealer secrets, VRF R, handSeed[0] derivation",
    sessionId: sessionIdHu,
    randomnessEpoch: "0",
    N_season1_default: 256,
    N_this_fixture: 2,
    vrfR,
  },
  secretLeaves,
  dealerSecretRoot,
  handSeedConstruction:
    "handSeed[i] = keccak256(abi.encode(DOMAIN_HAND_SEED_V1, S[i], bytes32(R), sessionId, epoch, uint16(i)))",
  handSeed0,
  secret0PreimageNote: "S[0]=keccak256(bytes('dealer-secret-0')) — test only; production secrets MUST be CSPRNG 32 bytes",
  canonicalBytesHex: secretLeaf(sessionIdHu, randomnessEpoch, 0, secrets[0]).canonicalBytesHex,
  keccak256: secretLeaves[0],
  expectedDecodedStructure: {
    dealerSecretRoot,
    handSeed0,
    vrfR,
  },
  expectedFailureMutations: [
    { mutation: "replace S[0] after VRF request", expect: "root mismatch vs on-chain commitment" },
    { mutation: "re-request VRF and pick favorable R", expect: "MUST NOT — epoch bound" },
    { mutation: "handSeed = keccak256(R) only", expect: "fails — private secret required" },
  ],
});

writeJson("09_profile_hash.json", {
  vectorId: "09_profile_hash",
  specRefs: ["MOZETTO_CONTROLLER_V1.md", "MOZETTO_PROTOCOL_V3.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Shark preset profile for Alice — axes 0..100, no free text",
    profile: {
      ...Object.fromEntries(
        Object.entries(sharkProfile).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
      ),
    },
  },
  encodingRecipe:
    "keccak256(abi.encode(DOMAIN_PROFILE_V1, profileId, profileVersion, presetId, 8x uint8 axes, allowedSchedulerWeights, createdAt, ownerCustomizationVersion))",
  canonicalBytesHex: alicePh.canonicalBytesHex,
  keccak256: alicePh.hash,
  expectedDecodedStructure: sharkProfile,
  expectedFailureMutations: [
    { mutation: "include free-text prompt in hash preimage", expect: "MUST NOT — ranked Season 1 forbids" },
    { mutation: "aggression 101", expect: "invalid axis" },
    { mutation: "change tempo only", expect: "profile hash changes" },
  ],
});

writeJson("10_model_policy_groq.json", {
  vectorId: "10_model_policy_groq",
  specRefs: ["MOZETTO_CONTROLLER_V1.md", "MOZETTO_PROTOCOL_V3.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Season 1 Groq openai/gpt-oss-120b model policy",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    toolsDisabled: true,
    temperatureMilli_initialDefault: 0,
    maxOutputTokens_initialDefault: 256,
    note: "temperatureMilli and maxOutputTokens are initial defaults / hypotheses — recalibrate only via new policy version",
  },
  encodingRecipe:
    "keccak256(abi.encode(DOMAIN_MODEL_POLICY_V1, policyId, policyVersion, providerId, modelId, reasoningEffortPolicy, outputMode, maxOutputTokens, temperatureMilli, masterPolicyHash, profileSetHash, energyPolicyHash, contextTruncationPolicy, fallbackPolicyHash, toolsDisabled))",
  fieldHashes: {
    providerId: modelPolicy.providerId,
    modelId: modelPolicy.modelId,
  },
  canonicalBytesHex: modelPh.canonicalBytesHex,
  keccak256: modelPh.hash,
  expectedDecodedStructure: modelPolicy,
  expectedFailureMutations: [
    { mutation: "swap model to another id silently", expect: "hash change required; active season MUST NOT mutate" },
    { mutation: "toolsDisabled=false", expect: "hash change; Season 1 MUST keep tools disabled" },
    { mutation: "hash raw JSON policy", expect: "non-conformant" },
  ],
});

writeJson("11_energy_ledger_hand.json", {
  vectorId: "11_energy_ledger_hand",
  specRefs: ["MOZETTO_ENERGY_V1.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Seat 0 Energy ledger for one hand: start 100; ops debit 0+4+6+8; end 82; reserve 12 never breached",
    startingEnergy: 100,
    endingEnergy: energy,
    mandatoryReserve: 12,
    costTable_initialDefaults: {
      DETERMINISTIC_INGEST: 0,
      LIGHT_UPDATE: 2,
      OPPONENT_UPDATE: 4,
      TIMING_UPDATE: 2,
      STREET_PLAN: 6,
      MEMORY_RETRIEVAL: 3,
      STANDARD_FINAL_DECISION: 8,
      DEEP_FINAL_DECISION: 16,
      MAXIMUM_FINAL_DECISION: 24,
    },
    note: "Energy cost table values are Season 1 initial defaults / hypotheses",
  },
  operations: energyOps.map((o) => ({
    name: o.name,
    opIndex: o.opIndex,
    operationType: o.operationType,
    energyDebit: o.energyDebit,
    remainingEnergy: o.remainingEnergy,
    opHash: o.opHash,
    canonicalBytesHex: o.canonicalBytesHex,
  })),
  energyLedgerRoot,
  canonicalBytesHex: energyLedgerHash.canonicalBytesHex,
  keccak256: energyLedgerHash.hash,
  expectedDecodedStructure: {
    startingEnergy: 100,
    endingEnergy: energy,
    opsRoot: energyLedgerRoot,
  },
  expectedFailureMutations: [
    { mutation: "background spend leaving remainingEnergy < 12 before fold/all-in", expect: "MUST fail reserve rule" },
    { mutation: "startingEnergy 120", expect: "MUST fail — Season 1 reset is exactly 100" },
    { mutation: "carry unused Energy to next hand", expect: "MUST fail — expires" },
    { mutation: "charge Energy for cancelled provider call", expect: "MUST fail — no charge if never executed" },
  ],
});

writeJson("12_final_settlement_eip712.json", {
  vectorId: "12_final_settlement_eip712",
  specRefs: ["MOZETTO_SETTLEMENT_V3.md"],
  hashStatus: "computed",
  hashingAlgorithm: "EIP-712 typed data keccak256; domain MozettoPokerSettlement v3",
  humanReadableInput: {
    description: "FinalSettlementV3 for HU session with conservation openingTotal == endingPlayerTotal + totalRake",
    conservation: {
      openingTotal: settlement.openingTotal.toString(),
      endingPlayerTotal: settlement.endingPlayerTotal.toString(),
      totalRake: settlement.totalRake.toString(),
      check: "200000000 == 198900000 + 1100000",
    },
    eip712: {
      name: "MozettoPokerSettlement",
      version: "3",
      chainId: Number(CHAIN_ANVIL),
      verifyingContract: ADDR.settlementHub,
    },
  },
  typehash: settleHashes.TYPEHASH,
  structHash: settleHashes.structHash,
  domainSeparator: settleHashes.domainSeparator,
  canonicalBytesHex: settleHashes.digest,
  keccak256: settleHashes.digest,
  eip712Digest: settleHashes.digest,
  expectedDecodedStructure: settlement,
  expectedFailureMutations: [
    { mutation: "endingPlayerTotal + totalRake != openingTotal", expect: "conservation MUST fail" },
    { mutation: "EIP-712 version '2'", expect: "digest mismatch vs V3" },
    { mutation: "wrong chainId", expect: "domain separator changes" },
    { mutation: "duplicate settlement same roots", expect: "root reuse rejected" },
  ],
});

writeJson("13_proof_batch_root.json", {
  vectorId: "13_proof_batch_root",
  specRefs: ["MOZETTO_PROOF_BATCH_V1.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...))",
  humanReadableInput: {
    description: "Global proof batch sequence 7 linking three table checkpoint roots",
    checkpointFrequency_initialDefault: "every 2–5 seconds during testing — hypothesis, versioned policy",
    sequence: 7,
  },
  checkpointRoots,
  globalRoot,
  previousBatchRoot: proofBatch.previousBatchRoot,
  canonicalBytesHex: proofBatchH.canonicalBytesHex,
  keccak256: proofBatchH.hash,
  expectedDecodedStructure: proofBatch,
  expectedFailureMutations: [
    { mutation: "sequence 7 with previousBatchRoot of sequence 5", expect: "continuity MUST fail" },
    { mutation: "duplicate sequence", expect: "rejected" },
    { mutation: "permute checkpoint leaf order", expect: "globalRoot changes" },
  ],
});

writeJson("14_emergency_exit_balance_leaf.json", {
  vectorId: "14_emergency_exit_balance_leaf",
  specRefs: ["MOZETTO_SETTLEMENT_V3.md", "MOZETTO_PROOF_BATCH_V1.md"],
  hashStatus: "computed",
  hashingAlgorithm: "keccak256(abi.encode(...)); same DOMAIN_BALANCE_LEAF_V1",
  humanReadableInput: {
    description: "Emergency exit claim for Alice at checkpoint sequence 20 with Merkle proof against balance root",
    sessionId: sessionIdHu,
    claimant: ADDR.arenaAlice,
    lastSequence: 20,
  },
  leaf: {
    canonicalBytesHex: emergencyLeaf.canonicalBytesHex,
    keccak256: emergencyLeaf.hash,
    fields: {
      sessionId: sessionIdHu,
      epoch: "0",
      arenaAccount: ADDR.arenaAlice,
      seat: 0,
      openingBalance: "100000000",
      currentBalance: "101000000",
      cumulativeRake: "200000",
      lastSequence: "20",
    },
  },
  balanceRoot: emergencyRoot,
  merkleProof: emergencyProof,
  canonicalBytesHex: emergencyLeaf.canonicalBytesHex,
  keccak256: emergencyLeaf.hash,
  expectedDecodedStructure: {
    oneClaimPerSessionAccount: true,
    laterSettlementExcludesClaimedLiability: true,
  },
  expectedFailureMutations: [
    { mutation: "replay claim", expect: "MUST fail — one claim per session/account" },
    { mutation: "claim with unaccepted checkpoint", expect: "MUST fail" },
    { mutation: "inflate currentBalance", expect: "Merkle proof fails" },
  ],
});

console.log("\nDomain tags:");
for (const [k, v] of Object.entries(D)) console.log(k, v);
console.log("\nDone.");
