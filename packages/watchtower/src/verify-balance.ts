/**
 * Balance-root and conservation checks from public package data.
 */
import {
  buildBalanceRoot,
  checkConservation,
  encodeBalanceLeaf,
  verifyBalanceInclusion,
  type BalanceLeafInput,
} from "@mozetto/root-builder";
import { getAddress, type Hex } from "viem";
import type { CheckResult, PublicBalanceLeaf, PublicVerifyPackage } from "./types.js";
import { asBigInt, asHex, eqHex } from "./util.js";

function toLeafInput(leaf: PublicBalanceLeaf): BalanceLeafInput {
  return {
    sessionId: asHex(leaf.sessionId, "sessionId"),
    epoch: asBigInt(leaf.epoch),
    arenaAccount: getAddress(leaf.arenaAccount),
    seat: Number(leaf.seat),
    openingBalance: asBigInt(leaf.openingBalance),
    currentBalance: asBigInt(leaf.currentBalance),
    cumulativeRake: asBigInt(leaf.cumulativeRake),
    lastSequence: asBigInt(leaf.lastSequence),
  };
}

export function verifyBalances(
  balances: NonNullable<PublicVerifyPackage["balances"]>,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const claimedRoot = asHex(balances.balanceRoot, "balanceRoot");
  try {
    const result = buildBalanceRoot(balances.leaves.map(toLeafInput));
    const ok = eqHex(result.balanceRoot, claimedRoot);
    checks.push({
      id: "balances.balanceRoot",
      ok,
      detail: ok
        ? `rebuilt balanceRoot matches (${claimedRoot.slice(0, 18)}…)`
        : `balanceRoot mismatch: rebuilt=${result.balanceRoot} claimed=${claimedRoot}`,
    });
  } catch (e) {
    checks.push({
      id: "balances.balanceRoot",
      ok: false,
      detail: `balance root rebuild failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return checks;
}

export function verifyBalanceInclusionClaim(
  claim: NonNullable<PublicVerifyPackage["balanceInclusion"]>,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const encoded = encodeBalanceLeaf(toLeafInput(claim.leaf));
  if (claim.leafHash) {
    const leafOk = eqHex(encoded.leafHash, asHex(claim.leafHash, "leafHash"));
    checks.push({
      id: "balanceInclusion.leafHash",
      ok: leafOk,
      detail: leafOk
        ? "encoded leafHash matches claim"
        : `leafHash mismatch: rebuilt=${encoded.leafHash} claimed=${claim.leafHash}`,
    });
  }
  const root = asHex(claim.balanceRoot, "balanceRoot");
  const ok = verifyBalanceInclusion(
    encoded.leafHash,
    claim.proof,
    root,
  );
  checks.push({
    id: "balanceInclusion.merkle",
    ok,
    detail: ok
      ? `leaf included under balanceRoot ${root.slice(0, 18)}…`
      : "balance leaf Merkle inclusion failed",
  });
  return checks;
}

export function verifySettlementConservation(
  settlement: NonNullable<PublicVerifyPackage["settlement"]>,
): CheckResult[] {
  const opening = asBigInt(settlement.openingTotal);
  const ending = asBigInt(settlement.endingPlayerTotal);
  const rake = asBigInt(settlement.totalRake);
  const ok = checkConservation(opening, ending, rake);
  return [
    {
      id: "settlement.conservation",
      ok,
      detail: ok
        ? `opening=${opening} == ending=${ending} + rake=${rake}`
        : `conservation broken: ${opening} != ${ending} + ${rake}`,
    },
  ];
}

/** Re-export Hex helper for tests that need typed roots. */
export type { Hex };
