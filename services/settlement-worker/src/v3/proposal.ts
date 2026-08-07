import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  NLHE_HU_STANDARD_V1_TEMPLATE_ID,
  POKER_ENGINE_HASH,
  PROFILE_SET_HASH,
} from "@mozetto/shared-types";
import {
  assertConservation,
  buildBalanceRoot,
  buildFinalSettlementDigest,
  randomnessEpochId,
  ZERO32,
  type BalanceLeafInput,
  type FinalSettlementInput,
  type FinalSettlementResult,
} from "@mozetto/root-builder";
import type { FinalSettlementV3Message } from "@mozetto/attestors";
import { sessionIdToBytes32, toBytes32 } from "../chain.js";
import type { FinalSettlementV3Arg, SettlementPlayerArg } from "./abi.js";

export type PlayerStackInput = {
  /** ArenaAccount (or vault participant) address. */
  user: Address;
  seat: number;
  startLocked: bigint;
  endBalance: bigint;
  cumulativeRake?: bigint;
};

export type BuildV3ProposalInput = {
  sessionId: string;
  finalSequence: bigint;
  finalEventRoot: Hex;
  handRoot: Hex;
  players: readonly PlayerStackInput[];
  /** Randomness epoch counter for randomnessEpochId(sessionId, epoch). Default 0. */
  randomnessEpoch?: bigint;
  proofBatchSequence?: bigint;
  modelPolicyHash?: Hex;
  profileSetHash?: Hex;
  gameTemplateId?: Hex;
  engineHash?: Hex;
  /** Unix seconds. Default now+86400. */
  deadline?: bigint;
  chainId: bigint;
  verifyingContract: Address;
  /** Optional precomputed balance root (skips leaf Merkle). */
  balanceRoot?: Hex;
  epochForBalanceLeaf?: bigint;
};

export type V3Proposal = {
  settlement: FinalSettlementV3Message;
  players: SettlementPlayerArg[];
  digests: FinalSettlementResult;
  /** Chip-unit map for rating (end balances / 1e6). */
  balancesChip: Record<string, number>;
  openingTotal: bigint;
  endingPlayerTotal: bigint;
  totalRake: bigint;
};

function hexEnv(name: string, fallback: Hex): Hex {
  const v = process.env[name];
  if (v && /^0x[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase() as Hex;
  return fallback;
}

/**
 * Build FinalSettlementV3 + conservation-checked EIP-712 digests via `@mozetto/root-builder`.
 * Balance root uses seat-ordered Merkle when not supplied.
 */
export function buildV3Proposal(input: BuildV3ProposalInput): V3Proposal {
  const sessionId = sessionIdToBytes32(input.sessionId);
  if (input.players.length === 0) {
    throw new Error("V3 proposal requires at least one player");
  }

  let openingTotal = 0n;
  let endingPlayerTotal = 0n;
  const players: SettlementPlayerArg[] = [];
  const balancesChip: Record<string, number> = {};
  const leaves: BalanceLeafInput[] = [];
  const epoch = input.epochForBalanceLeaf ?? input.randomnessEpoch ?? 0n;

  for (const p of input.players) {
    openingTotal += p.startLocked;
    endingPlayerTotal += p.endBalance;
    players.push({
      user: p.user,
      startLocked: p.startLocked,
      endBalance: p.endBalance,
    });
    balancesChip[p.user.toLowerCase()] = Number(p.endBalance) / 1e6;
    leaves.push({
      sessionId,
      epoch,
      arenaAccount: p.user,
      seat: p.seat,
      openingBalance: p.startLocked,
      currentBalance: p.endBalance,
      cumulativeRake: p.cumulativeRake ?? 0n,
      lastSequence: input.finalSequence,
    });
  }

  const totalRake = openingTotal - endingPlayerTotal;
  if (totalRake < 0n) {
    throw new Error(`negative rake: opening ${openingTotal} < ending ${endingPlayerTotal}`);
  }
  assertConservation(openingTotal, endingPlayerTotal, totalRake);

  const balanceRoot =
    input.balanceRoot ?? buildBalanceRoot(leaves).balanceRoot;

  const deadline =
    input.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86_400);

  const settlement: FinalSettlementV3Message = {
    sessionId,
    finalSequence: input.finalSequence,
    finalEventRoot: input.finalEventRoot,
    handRoot: input.handRoot,
    balanceRoot,
    randomnessEpochId: randomnessEpochId(sessionId, input.randomnessEpoch ?? 0n),
    openingTotal,
    endingPlayerTotal,
    totalRake,
    proofBatchSequence: input.proofBatchSequence ?? 0n,
    modelPolicyHash:
      input.modelPolicyHash ?? hexEnv("SETTLEMENT_MODEL_POLICY_HASH", ZERO32),
    profileSetHash:
      input.profileSetHash ??
      hexEnv("SETTLEMENT_PROFILE_SET_HASH", PROFILE_SET_HASH as Hex),
    gameTemplateId:
      input.gameTemplateId ??
      hexEnv("SETTLEMENT_GAME_TEMPLATE_ID", NLHE_HU_STANDARD_V1_TEMPLATE_ID as Hex),
    engineHash:
      input.engineHash ?? hexEnv("SETTLEMENT_ENGINE_HASH", POKER_ENGINE_HASH as Hex),
    deadline,
    chainId: input.chainId,
    verifyingContract: input.verifyingContract,
  };

  const digests = buildFinalSettlementDigest(settlement);

  return {
    settlement,
    players,
    digests,
    balancesChip,
    openingTotal,
    endingPlayerTotal,
    totalRake,
  };
}

/** Map on-chain / DB roots into typed Hex fields. */
export function normalizeRoot(raw: string | undefined, fallbackSeed: string): Hex {
  if (raw) return toBytes32(raw);
  return keccak256(toBytes(fallbackSeed));
}

/** Convert proposal settlement to hub calldata tuple (excludes domain fields). */
export function toHubSettlementArg(s: FinalSettlementInput): FinalSettlementV3Arg {
  return {
    sessionId: s.sessionId,
    finalSequence: s.finalSequence,
    finalEventRoot: s.finalEventRoot,
    handRoot: s.handRoot,
    balanceRoot: s.balanceRoot,
    randomnessEpochId: s.randomnessEpochId,
    openingTotal: s.openingTotal,
    endingPlayerTotal: s.endingPlayerTotal,
    totalRake: s.totalRake,
    proofBatchSequence: s.proofBatchSequence,
    modelPolicyHash: s.modelPolicyHash,
    profileSetHash: s.profileSetHash,
    gameTemplateId: s.gameTemplateId,
    engineHash: s.engineHash,
    deadline: s.deadline,
  };
}
