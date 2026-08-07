import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  concat,
  toBytes,
  type Hex,
  type Address,
} from "viem";
import { domainTag, DOMAIN_STRINGS } from "./domains.js";

export type HashResult = { canonicalBytesHex: Hex; hash: Hex };

/** ABI-encode then keccak256. `canonicalBytesHex` is the ABI preimage (already hex). */
export function hashEnc(types: string, values: readonly unknown[]): HashResult {
  const bytes = encodeAbiParameters(parseAbiParameters(types), values as never[]);
  return { canonicalBytesHex: bytes, hash: keccak256(bytes) };
}

export function enc(types: string, values: readonly unknown[]): Hex {
  return encodeAbiParameters(parseAbiParameters(types), values as never[]);
}

const D = {
  SESSION_V2: domainTag(DOMAIN_STRINGS.SESSION_V2),
  SESSION_ID_V1: domainTag(DOMAIN_STRINGS.SESSION_ID_V1),
  HAND_ID_V1: domainTag(DOMAIN_STRINGS.HAND_ID_V1),
  PARTICIPANT_LEAF_V1: domainTag(DOMAIN_STRINGS.PARTICIPANT_LEAF_V1),
  EVENT_V1: domainTag(DOMAIN_STRINGS.EVENT_V1),
  CARD_LEAF_V1: domainTag(DOMAIN_STRINGS.CARD_LEAF_V1),
  SECRET_LEAF_V1: domainTag(DOMAIN_STRINGS.SECRET_LEAF_V1),
  HAND_SEED_V1: domainTag(DOMAIN_STRINGS.HAND_SEED_V1),
  BALANCE_LEAF_V1: domainTag(DOMAIN_STRINGS.BALANCE_LEAF_V1),
  PROFILE_V1: domainTag(DOMAIN_STRINGS.PROFILE_V1),
  MODEL_POLICY_V1: domainTag(DOMAIN_STRINGS.MODEL_POLICY_V1),
  PROOF_BATCH_V1: domainTag(DOMAIN_STRINGS.PROOF_BATCH_V1),
  ENERGY_OP_V1: domainTag(DOMAIN_STRINGS.ENERGY_OP_V1),
  ENERGY_LEDGER_V1: domainTag(DOMAIN_STRINGS.ENERGY_LEDGER_V1),
  OPENING_BALANCE_LEAF_V1: domainTag(DOMAIN_STRINGS.OPENING_BALANCE_LEAF_V1),
  CONTROLLER_LEAF_V1: domainTag(DOMAIN_STRINGS.CONTROLLER_LEAF_V1),
  HAND_ROOT_V1: domainTag(DOMAIN_STRINGS.HAND_ROOT_V1),
};

export const DOMAINS = D;

export function participantLeaf(p: {
  owner: Address;
  arenaAccount: Address;
  seat: number;
  buyIn: bigint;
  controllerHash: Hex;
  profileHash: Hex;
  ratingPool: Hex;
  rated: boolean;
  seatTicketNonce: bigint;
}): HashResult {
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

export function openingBalanceLeaf(p: {
  sessionId: Hex;
  arenaAccount: Address;
  seat: number;
  openingBalance: bigint;
}): HashResult {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, address arenaAccount, uint8 seat, uint256 openingBalance",
    [D.OPENING_BALANCE_LEAF_V1, p.sessionId, p.arenaAccount, p.seat, p.openingBalance],
  );
}

export function controllerLeaf(p: { seat: number; controllerHash: Hex }): HashResult {
  return hashEnc("bytes32 domain, uint8 seat, bytes32 controllerHash", [
    D.CONTROLLER_LEAF_V1,
    p.seat,
    p.controllerHash,
  ]);
}

export function profileHash(profile: {
  profileId: Hex;
  profileVersion: number;
  presetId: Hex;
  aggression: number;
  riskTolerance: number;
  deception: number;
  opponentAdaptation: number;
  trapPreference: number;
  tempo: number;
  variancePreference: number;
  energyConservation: number;
  allowedSchedulerWeights: number;
  createdAt: bigint;
  ownerCustomizationVersion: number;
}): HashResult {
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

export function modelPolicyHash(policy: {
  policyId: Hex;
  policyVersion: number;
  providerId: Hex;
  modelId: Hex;
  reasoningEffortPolicy: Hex;
  outputMode: Hex;
  maxOutputTokens: number;
  temperatureMilli: number;
  masterPolicyHash: Hex;
  profileSetHash: Hex;
  energyPolicyHash: Hex;
  contextTruncationPolicy: Hex;
  fallbackPolicyHash: Hex;
  toolsDisabled: boolean;
}): HashResult {
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

export function eventHash(e: {
  protocolVersion: number;
  sessionId: Hex;
  epoch: bigint;
  handNumber: bigint;
  sequence: bigint;
  eventType: number;
  hasActorSeat: boolean;
  actorSeat: number;
  publicPayloadHash: Hex;
  privatePayloadCommitment: Hex;
  elapsedMs: bigint;
  previousEventHash: Hex;
  engineHash: Hex;
}): HashResult {
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

export function sessionDescriptorHash(s: {
  chainId: bigint;
  protocolVersion: number;
  sessionId: Hex;
  gameTemplateId: Hex;
  participantRoot: Hex;
  openingBalanceRoot: Hex;
  controllerRoot: Hex;
  profileRoot: Hex;
  dealerSecretRoot: Hex;
  randomnessPolicyId: Hex;
  settlementPolicyId: Hex;
  createdAt: bigint;
  sealDeadline: bigint;
  sessionNonce: Hex;
}): HashResult {
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

export function deriveSessionId(pre: {
  chainId: bigint;
  gameTemplateId: Hex;
  participantRoot: Hex;
  sessionNonce: Hex;
  createdAt: bigint;
}): HashResult {
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

export function deriveHandId(sessionId: Hex, epoch: bigint, handNumber: bigint): HashResult {
  return hashEnc("bytes32 domain, bytes32 sessionId, uint64 epoch, uint64 handNumber", [
    D.HAND_ID_V1,
    sessionId,
    epoch,
    handNumber,
  ]);
}

export function cardLeaf(
  handId: Hex,
  position: number,
  cardCode: number,
  cardSalt: Hex,
): HashResult {
  return hashEnc(
    "bytes32 domain, bytes32 handId, uint8 position, uint8 cardCode, bytes32 cardSalt",
    [D.CARD_LEAF_V1, handId, position, cardCode, cardSalt],
  );
}

export function secretLeaf(
  sessionId: Hex,
  randomnessEpoch: bigint,
  index: number,
  secret: Hex,
): HashResult {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, uint64 randomnessEpoch, uint16 index, bytes32 secret",
    [D.SECRET_LEAF_V1, sessionId, randomnessEpoch, index, secret],
  );
}

export function handSeed(args: {
  secret: Hex;
  vrfR: Hex;
  sessionId: Hex;
  epoch: bigint;
  index: number;
}): Hex {
  return keccak256(
    enc(
      "bytes32 domain, bytes32 secret, bytes32 vrfR, bytes32 sessionId, uint64 epoch, uint16 index",
      [D.HAND_SEED_V1, args.secret, args.vrfR, args.sessionId, args.epoch, args.index],
    ),
  );
}

export function balanceLeaf(b: {
  sessionId: Hex;
  epoch: bigint;
  arenaAccount: Address;
  seat: number;
  openingBalance: bigint;
  currentBalance: bigint;
  cumulativeRake: bigint;
  lastSequence: bigint;
}): HashResult {
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

/** MOZETTO_SETTLEMENT_V3 §4 — HandRoot binding. */
export function handRoot(h: {
  handId: Hex;
  eventChainTip: Hex;
  deckRoot: Hex;
  openingStateHash: Hex;
  endingStateHash: Hex;
  handRake: bigint;
  energyLedgerRoot: Hex;
}): HashResult {
  return hashEnc(
    "bytes32 domain, bytes32 handId, bytes32 eventChainTip, bytes32 deckRoot, bytes32 openingStateHash, bytes32 endingStateHash, uint256 handRake, bytes32 energyLedgerRoot",
    [
      D.HAND_ROOT_V1,
      h.handId,
      h.eventChainTip,
      h.deckRoot,
      h.openingStateHash,
      h.endingStateHash,
      h.handRake,
      h.energyLedgerRoot,
    ],
  );
}

/**
 * MOZETTO_SETTLEMENT_V3 §5 — randomnessEpochId = keccak256(abi.encode(sessionId, uint64(epoch))).
 * No domain tag (normative as written).
 */
export function randomnessEpochId(sessionId: Hex, epoch: bigint): Hex {
  return keccak256(enc("bytes32 sessionId, uint64 epoch", [sessionId, epoch]));
}

export function energyOpHash(op: {
  sessionId: Hex;
  handId: Hex;
  seat: number;
  opIndex: number;
  operationType: number;
  energyDebit: number;
  remainingEnergy: number;
  providerRequestId: Hex;
  observationHash: Hex;
  resultHash: Hex;
  fallbackFlag: boolean;
}): HashResult {
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

export function energyLedgerHash(args: {
  sessionId: Hex;
  handId: Hex;
  seat: number;
  startingEnergy: number;
  opsRoot: Hex;
  endingEnergy: number;
}): HashResult {
  return hashEnc(
    "bytes32 domain, bytes32 sessionId, bytes32 handId, uint8 seat, uint16 startingEnergy, bytes32 opsRoot, uint16 endingEnergy",
    [
      D.ENERGY_LEDGER_V1,
      args.sessionId,
      args.handId,
      args.seat,
      args.startingEnergy,
      args.opsRoot,
      args.endingEnergy,
    ],
  );
}

export function proofBatchLeaf(b: {
  sequence: bigint;
  previousBatchRoot: Hex;
  globalRoot: Hex;
  dataManifestHash: Hex;
  createdAt: bigint;
}): HashResult {
  return hashEnc(
    "bytes32 domain, uint64 sequence, bytes32 previousBatchRoot, bytes32 globalRoot, bytes32 dataManifestHash, uint64 createdAt",
    [D.PROOF_BATCH_V1, b.sequence, b.previousBatchRoot, b.globalRoot, b.dataManifestHash, b.createdAt],
  );
}

const FINAL_SETTLEMENT_TYPESTRING =
  "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)";

export function settlementEip712Digest(s: {
  sessionId: Hex;
  finalSequence: bigint;
  finalEventRoot: Hex;
  handRoot: Hex;
  balanceRoot: Hex;
  randomnessEpochId: Hex;
  openingTotal: bigint;
  endingPlayerTotal: bigint;
  totalRake: bigint;
  proofBatchSequence: bigint;
  modelPolicyHash: Hex;
  profileSetHash: Hex;
  gameTemplateId: Hex;
  engineHash: Hex;
  deadline: bigint;
  chainId: bigint;
  verifyingContract: Address;
}): { TYPEHASH: Hex; structHash: Hex; domainSeparator: Hex; digest: Hex } {
  const TYPEHASH = keccak256(toBytes(FINAL_SETTLEMENT_TYPESTRING));
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
  return { TYPEHASH, structHash, domainSeparator, digest };
}

export function oddChipSplitHash(args: {
  pot: bigint;
  button: number;
  w0: number;
  w1: number;
  a0: bigint;
  a1: bigint;
}): HashResult {
  return hashEnc("uint256 pot, uint8 button, uint8 w0, uint8 w1, uint256 a0, uint256 a1", [
    args.pot,
    args.button,
    args.w0,
    args.w1,
    args.a0,
    args.a1,
  ]);
}
