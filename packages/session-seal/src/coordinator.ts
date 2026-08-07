import { encodeFunctionData, type Address, type Hex } from "viem";
import { SEAL_AND_FUND_SESSION_ABI } from "./abi.js";
import { buildSessionCommitments } from "./commitments.js";
import type {
  SealCalldata,
  SealMode,
  SealPrepareInput,
  SealResult,
  SessionCommitments,
  VaultSealClient,
} from "./types.js";

export function encodeSealAndFundCalldata(
  vault: Address,
  commitments: SessionCommitments,
): SealCalldata {
  const data = encodeFunctionData({
    abi: SEAL_AND_FUND_SESSION_ABI,
    functionName: "sealAndFundSession",
    args: [commitments.descriptor, commitments.orderedTickets, commitments.orderedSignatures],
  });
  return {
    to: vault,
    data,
    descriptor: commitments.descriptor,
    tickets: commitments.orderedTickets,
    signatures: commitments.orderedSignatures,
  };
}

/**
 * Session seal coordinator (WP-041).
 *
 * Pure off-chain builder + atomic funding trigger. Prefer dry-run in tests;
 * submit via a mocked or Anvil VaultSealClient (does not edit ArenaVaultV2.sol).
 */
export class SessionSealCoordinator {
  constructor(private readonly vault: VaultSealClient) {}

  prepare(input: SealPrepareInput): SessionCommitments {
    if (input.createdAt > input.sealDeadline) {
      throw new Error("createdAt must be <= sealDeadline");
    }
    return buildSessionCommitments(input);
  }

  async seal(input: SealPrepareInput, mode: SealMode = "dry-run"): Promise<SealResult> {
    let commitments: SessionCommitments;
    try {
      commitments = this.prepare(input);
    } catch (err) {
      return {
        mode,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const calldata = encodeSealAndFundCalldata(this.vault.vaultAddress, commitments);

    if (mode === "dry-run") {
      return { mode: "dry-run", ok: true, commitments, calldata };
    }

    try {
      const txHash = await this.vault.sealAndFundSession({
        descriptor: commitments.descriptor,
        tickets: commitments.orderedTickets,
        signatures: commitments.orderedSignatures,
      });
      return { mode: "submit", ok: true, commitments, txHash };
    } catch (err) {
      return {
        mode: "submit",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        commitments,
      };
    }
  }
}

/** Convenience: dry-run seal without a live vault client. */
export function dryRunSeal(
  input: SealPrepareInput,
  vaultAddress: Address = "0x0000000000000000000000000000000000000001",
): SealResult {
  const coordinator = new SessionSealCoordinator({
    vaultAddress,
    sealAndFundSession: async () => {
      throw new Error("dry-run vault does not submit");
    },
  });
  // sync path via prepare + encode
  try {
    const commitments = coordinator.prepare(input);
    const calldata = encodeSealAndFundCalldata(vaultAddress, commitments);
    return { mode: "dry-run", ok: true, commitments, calldata };
  } catch (err) {
    return {
      mode: "dry-run",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type { Hex };
