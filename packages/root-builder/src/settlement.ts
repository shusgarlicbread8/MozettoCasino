import {
  settlementEip712Digest,
  randomnessEpochId as encodeRandomnessEpochId,
} from "@mozetto/protocol-vectors";
import type { Hex } from "viem";
import { RootBuilderError } from "./balance-root.js";
import type { FinalSettlementInput, FinalSettlementResult } from "./types.js";

/** openingTotal == endingPlayerTotal + totalRake (MOZETTO_SETTLEMENT_V3 §5). */
export function checkConservation(
  openingTotal: bigint,
  endingPlayerTotal: bigint,
  totalRake: bigint,
): boolean {
  return openingTotal === endingPlayerTotal + totalRake;
}

export function assertConservation(
  openingTotal: bigint,
  endingPlayerTotal: bigint,
  totalRake: bigint,
): void {
  if (!checkConservation(openingTotal, endingPlayerTotal, totalRake)) {
    throw new RootBuilderError(
      "CONSERVATION_BROKEN",
      `openingTotal ${openingTotal} != endingPlayerTotal ${endingPlayerTotal} + totalRake ${totalRake}`,
    );
  }
}

export function randomnessEpochId(sessionId: Hex, epoch: bigint): Hex {
  return encodeRandomnessEpochId(sessionId, epoch);
}

/**
 * Build FinalSettlementV3 EIP-712 digest.
 * When `requireConservation` is true (default), throws if conservation fails.
 */
export function buildFinalSettlementDigest(
  input: FinalSettlementInput,
  opts: { requireConservation?: boolean } = {},
): FinalSettlementResult {
  const conservationOk = checkConservation(
    input.openingTotal,
    input.endingPlayerTotal,
    input.totalRake,
  );
  if (opts.requireConservation !== false && !conservationOk) {
    assertConservation(input.openingTotal, input.endingPlayerTotal, input.totalRake);
  }
  const dig = settlementEip712Digest(input);
  return { ...dig, conservationOk };
}
