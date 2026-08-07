import { getAddress, type Address, type Hex } from "viem";
import {
  participantLeaf,
  openingBalanceLeaf,
  controllerLeaf,
  deriveSessionId,
  sessionDescriptorHash,
  merkleRoot,
} from "@mozetto/protocol-vectors";
import { applySeatOrder, assertHomogeneousTickets } from "./seat-order.js";
import type {
  SealPrepareInput,
  SeatTicketV3Wire,
  SessionCommitments,
  SessionDescriptorV2Wire,
} from "./types.js";

function asBigInt(v: bigint | number | string): bigint {
  if (typeof v === "bigint") return v;
  return BigInt(v);
}

function normalizeTicket(ticket: SealPrepareInput["participants"][number]["ticket"]): SeatTicketV3Wire {
  return {
    arenaAccount: getAddress(ticket.arenaAccount),
    gameTemplateId: ticket.gameTemplateId,
    matchmakingPool: ticket.matchmakingPool,
    buyIn: asBigInt(ticket.buyIn),
    controllerHash: ticket.controllerHash,
    profileConfigHash: ticket.profileConfigHash,
    modelPolicyHash: ticket.modelPolicyHash,
    leagueBit: ticket.leagueBit,
    rated: ticket.rated,
    expiresAt: asBigInt(ticket.expiresAt),
    nonce: asBigInt(ticket.nonce),
  };
}

/**
 * Build SESSION_V2 participant / opening / controller / profile roots and descriptor.
 *
 * Order matches ArenaVaultV2.sealAndFundSession:
 * 1. participant leaves → participantRoot
 * 2. sessionId from (chainId, template, participantRoot, sessionNonce, createdAt)
 * 3. opening leaves use that sessionId (openingBalance = buyIn)
 * 4. controller leaves; profile leaves = raw profileConfigHash
 */
export function buildSessionCommitments(input: SealPrepareInput): SessionCommitments {
  const seated = applySeatOrder(input.participants, input.seatOrder);
  assertHomogeneousTickets(seated, input.gameTemplateId);

  const orderedTickets = seated.map((p) => normalizeTicket(p.ticket));

  const participantLeaves = seated.map((p, i) => {
    const ticket = orderedTickets[i]!;
    return participantLeaf({
      owner: getAddress(p.owner),
      arenaAccount: ticket.arenaAccount,
      seat: p.seat,
      buyIn: ticket.buyIn,
      controllerHash: ticket.controllerHash,
      profileHash: ticket.profileConfigHash,
      ratingPool: ticket.matchmakingPool,
      rated: ticket.rated,
      seatTicketNonce: ticket.nonce,
    }).hash;
  });
  const participantRoot = merkleRoot(participantLeaves).root;

  const sessionId = deriveSessionId({
    chainId: input.chainId,
    gameTemplateId: input.gameTemplateId,
    participantRoot,
    sessionNonce: input.sessionNonce,
    createdAt: input.createdAt,
  }).hash;

  const openingBalanceLeaves = orderedTickets.map((ticket, i) =>
    openingBalanceLeaf({
      sessionId,
      arenaAccount: ticket.arenaAccount,
      seat: i,
      openingBalance: ticket.buyIn,
    }).hash,
  );
  const openingBalanceRoot = merkleRoot(openingBalanceLeaves).root;

  const controllerLeaves = orderedTickets.map((ticket, i) =>
    controllerLeaf({ seat: i, controllerHash: ticket.controllerHash }).hash,
  );
  const controllerRoot = merkleRoot(controllerLeaves).root;

  const profileLeaves = orderedTickets.map((ticket) => ticket.profileConfigHash as Hex);
  const profileRoot = merkleRoot(profileLeaves).root;

  const descriptor: SessionDescriptorV2Wire = {
    chainId: input.chainId,
    protocolVersion: 3,
    sessionId,
    gameTemplateId: input.gameTemplateId,
    participantRoot,
    openingBalanceRoot,
    controllerRoot,
    profileRoot,
    dealerSecretRoot: input.policy.dealerSecretRoot,
    randomnessPolicyId: input.policy.randomnessPolicyId,
    settlementPolicyId: input.policy.settlementPolicyId,
    createdAt: input.createdAt,
    sealDeadline: input.sealDeadline,
    sessionNonce: input.sessionNonce,
  };

  const descriptorHash = sessionDescriptorHash(descriptor).hash;

  return {
    descriptor,
    sessionDescriptorHash: descriptorHash,
    participantLeaves,
    openingBalanceLeaves,
    controllerLeaves,
    profileLeaves,
    orderedTickets,
    orderedSignatures: seated.map((p) => p.signature),
    orderedOwners: seated.map((p) => getAddress(p.owner) as Address),
  };
}
