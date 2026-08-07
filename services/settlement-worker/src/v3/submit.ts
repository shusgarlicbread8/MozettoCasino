import type { Hex } from "viem";
import { chainClients } from "../chain.js";
import {
  DEFAULT_VERIFIER_POLICY_ID,
  SETTLEMENT_HUB_V3_ABI,
  type FinalSettlementV3Arg,
  type SettlementPlayerArg,
} from "./abi.js";

export type SubmitV3Result = {
  txHash: Hex;
  confirmed: boolean;
};

/**
 * Submit FinalSettlementV3 to PokerSettlementHubV3 and wait for confirmation.
 * Submitter key is SETTLEMENT_PRIVATE_KEY (not an attestor role).
 */
export async function submitHubSettlementV3(opts: {
  hub: Hex;
  submitterPk: Hex;
  settlement: FinalSettlementV3Arg;
  players: SettlementPlayerArg[];
  signatures: Hex[];
  /** Min signatures required before submit (Anvil default 2). */
  minSignatures?: number;
  verifierPolicyId?: Hex;
  waitForReceipt?: boolean;
}): Promise<SubmitV3Result | null> {
  const min = opts.minSignatures ?? Number(process.env.SETTLEMENT_MIN_SIGNATURES || 2);
  if (opts.signatures.length < min) {
    console.log(
      "[settlement-worker:v3] quorum incomplete",
      opts.settlement.sessionId,
      `${opts.signatures.length}/${min} signatures`,
    );
    return null;
  }

  const { wallet, publicClient } = chainClients(opts.submitterPk);
  const policy = opts.verifierPolicyId ?? DEFAULT_VERIFIER_POLICY_ID;

  const hash = await wallet.writeContract({
    address: opts.hub,
    abi: SETTLEMENT_HUB_V3_ABI,
    functionName: "settle",
    args: [
      opts.settlement,
      opts.players,
      opts.signatures.slice(0, 5),
      policy,
    ],
  });

  let confirmed = false;
  if (opts.waitForReceipt !== false) {
    await publicClient.waitForTransactionReceipt({ hash });
    confirmed = true;
  }

  return { txHash: hash, confirmed };
}

/** Pure encode helper for tests — mirrors settle args without chain I/O. */
export function encodeSettleV3CallArgs(opts: {
  settlement: FinalSettlementV3Arg;
  players: SettlementPlayerArg[];
  signatures: Hex[];
  verifierPolicyId?: Hex;
}) {
  return {
    settlement: opts.settlement,
    players: opts.players,
    signatures: opts.signatures,
    verifierPolicyId: opts.verifierPolicyId ?? DEFAULT_VERIFIER_POLICY_ID,
  };
}
