import { getAddress, type Address, type Hex } from "viem";
import type { FinalSettlementV3Message } from "./types.js";
import { AttestorKeyError } from "./keys.js";

/** JSON-safe FinalSettlementV3 payload for HTTP attestors (bigint → decimal string). */
export type FinalSettlementV3HttpJson = {
  sessionId: string;
  finalSequence: string;
  finalEventRoot: string;
  handRoot: string;
  balanceRoot: string;
  randomnessEpochId: string;
  openingTotal: string;
  endingPlayerTotal: string;
  totalRake: string;
  proofBatchSequence: string;
  modelPolicyHash: string;
  profileSetHash: string;
  gameTemplateId: string;
  engineHash: string;
  deadline: string;
  chainId: string;
  verifyingContract: string;
};

function asHex32(raw: unknown, field: string): Hex {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} must be a hex string`);
  }
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} is not hex`);
  }
  return (`0x${hex.padStart(64, "0").slice(-64).toLowerCase()}`) as Hex;
}

function asBigIntField(raw: unknown, field: string): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      return BigInt(raw);
    } catch {
      throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} is not a valid integer`);
    }
  }
  throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} is required`);
}

function asAddress(raw: unknown, field: string): Address {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} must be an address`);
  }
  try {
    return getAddress(raw);
  } catch {
    throw new AttestorKeyError("INVALID_HTTP_BODY", `${field} is not a valid address`);
  }
}

/** Encode FinalSettlementV3 for JSON POST bodies (worker → dealer/replay). */
export function serializeFinalSettlementV3ForHttp(
  s: FinalSettlementV3Message,
): FinalSettlementV3HttpJson {
  return {
    sessionId: s.sessionId,
    finalSequence: s.finalSequence.toString(),
    finalEventRoot: s.finalEventRoot,
    handRoot: s.handRoot,
    balanceRoot: s.balanceRoot,
    randomnessEpochId: s.randomnessEpochId,
    openingTotal: s.openingTotal.toString(),
    endingPlayerTotal: s.endingPlayerTotal.toString(),
    totalRake: s.totalRake.toString(),
    proofBatchSequence: s.proofBatchSequence.toString(),
    modelPolicyHash: s.modelPolicyHash,
    profileSetHash: s.profileSetHash,
    gameTemplateId: s.gameTemplateId,
    engineHash: s.engineHash,
    deadline: s.deadline.toString(),
    chainId: s.chainId.toString(),
    verifyingContract: s.verifyingContract,
  };
}

/**
 * Parse HTTP JSON into FinalSettlementV3Message.
 * Accepts decimal strings or numbers for bigint fields (settlement-worker wire format).
 */
export function parseFinalSettlementV3FromHttp(raw: unknown): FinalSettlementV3Message {
  if (!raw || typeof raw !== "object") {
    throw new AttestorKeyError("INVALID_HTTP_BODY", "body must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  return {
    sessionId: asHex32(o.sessionId, "sessionId"),
    finalSequence: asBigIntField(o.finalSequence, "finalSequence"),
    finalEventRoot: asHex32(o.finalEventRoot, "finalEventRoot"),
    handRoot: asHex32(o.handRoot, "handRoot"),
    balanceRoot: asHex32(o.balanceRoot, "balanceRoot"),
    randomnessEpochId: asHex32(o.randomnessEpochId, "randomnessEpochId"),
    openingTotal: asBigIntField(o.openingTotal, "openingTotal"),
    endingPlayerTotal: asBigIntField(o.endingPlayerTotal, "endingPlayerTotal"),
    totalRake: asBigIntField(o.totalRake, "totalRake"),
    proofBatchSequence: asBigIntField(o.proofBatchSequence, "proofBatchSequence"),
    modelPolicyHash: asHex32(o.modelPolicyHash, "modelPolicyHash"),
    profileSetHash: asHex32(o.profileSetHash, "profileSetHash"),
    gameTemplateId: asHex32(o.gameTemplateId, "gameTemplateId"),
    engineHash: asHex32(o.engineHash, "engineHash"),
    deadline: asBigIntField(o.deadline, "deadline"),
    chainId: asBigIntField(o.chainId, "chainId"),
    verifyingContract: asAddress(o.verifyingContract, "verifyingContract"),
  };
}
