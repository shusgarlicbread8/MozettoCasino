import type { Address, Hex } from "viem";
import type { FinalSettlementV3Message } from "./types.js";

/** Frozen EIP-712 domain for MOZETTO_SETTLEMENT_V3 (vector 12). */
export const SETTLEMENT_EIP712_NAME = "MozettoPokerSettlement" as const;
export const SETTLEMENT_EIP712_VERSION = "3" as const;

/**
 * FinalSettlementV3 typed-data primary type — matches PokerSettlementHubV3 /
 * specs/canonical-vectors/12_final_settlement_eip712.json.
 */
export const FINAL_SETTLEMENT_V3_TYPES = {
  FinalSettlementV3: [
    { name: "sessionId", type: "bytes32" },
    { name: "finalSequence", type: "uint64" },
    { name: "finalEventRoot", type: "bytes32" },
    { name: "handRoot", type: "bytes32" },
    { name: "balanceRoot", type: "bytes32" },
    { name: "randomnessEpochId", type: "bytes32" },
    { name: "openingTotal", type: "uint256" },
    { name: "endingPlayerTotal", type: "uint256" },
    { name: "totalRake", type: "uint256" },
    { name: "proofBatchSequence", type: "uint64" },
    { name: "modelPolicyHash", type: "bytes32" },
    { name: "profileSetHash", type: "bytes32" },
    { name: "gameTemplateId", type: "bytes32" },
    { name: "engineHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function settlementEip712Domain(chainId: number | bigint, verifyingContract: Address) {
  return {
    name: SETTLEMENT_EIP712_NAME,
    version: SETTLEMENT_EIP712_VERSION,
    chainId: Number(chainId),
    verifyingContract,
  } as const;
}

/** Typed-data message body (excludes domain fields). */
export function toTypedDataMessage(s: FinalSettlementV3Message) {
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
  } as const;
}

export type TypedDataSignArgs = {
  domain: ReturnType<typeof settlementEip712Domain>;
  types: typeof FINAL_SETTLEMENT_V3_TYPES;
  primaryType: "FinalSettlementV3";
  message: ReturnType<typeof toTypedDataMessage>;
};

export function buildTypedDataSignArgs(s: FinalSettlementV3Message): TypedDataSignArgs {
  return {
    domain: settlementEip712Domain(s.chainId, s.verifyingContract),
    types: FINAL_SETTLEMENT_V3_TYPES,
    primaryType: "FinalSettlementV3",
    message: toTypedDataMessage(s),
  };
}

/** Type string used for TYPEHASH (must match hub / protocol-vectors). */
export const FINAL_SETTLEMENT_V3_TYPESTRING =
  "FinalSettlementV3(bytes32 sessionId,uint64 finalSequence,bytes32 finalEventRoot,bytes32 handRoot,bytes32 balanceRoot,bytes32 randomnessEpochId,uint256 openingTotal,uint256 endingPlayerTotal,uint256 totalRake,uint64 proofBatchSequence,bytes32 modelPolicyHash,bytes32 profileSetHash,bytes32 gameTemplateId,bytes32 engineHash,uint256 deadline)";

export type { Hex };
