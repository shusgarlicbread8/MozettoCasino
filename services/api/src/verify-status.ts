/**
 * WP-090 — Public Verify Game result categories.
 * Matches Plan 10 "Public result categories". Never greenwash pending data.
 */

export type PublicVerifyStatus =
  | "VERIFIED"
  | "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER"
  | "PENDING_BASE_ANCHOR"
  | "PENDING_SETTLEMENT"
  | "INCOMPLETE_PUBLIC_DATA"
  | "VERIFICATION_FAILED";

export type VerifyStatusInput = {
  sessionStatus: string;
  settlementTxHash: string | null;
  proposalStatus: string | null;
  attestorCount: number;
  checkpointCount: number;
  checkpointWithTxCount: number;
  handRootCount: number;
  vrfFulfilledCount: number;
  vrfRequestCount: number;
  dealerRoot: string | null;
  lastEventRoot: string | null;
  lastBalanceRoot: string | null;
  /** Explicit failure flag from offline/replay verify (optional). */
  verificationFailed?: boolean;
};

export type ComponentStatus = "ok" | "pending" | "missing" | "failed";

export type VerifyComponents = {
  session: ComponentStatus;
  dealerCommitment: ComponentStatus;
  vrf: ComponentStatus;
  eventRoots: ComponentStatus;
  handRoots: ComponentStatus;
  baseAnchor: ComponentStatus;
  settlement: ComponentStatus;
  attestors: ComponentStatus;
  /**
   * WP-090/085 follow-up — optional; missing proofs do NOT change Plan 10
   * public result categories (status derivation ignores this field).
   */
  proofBatchInclusion?: ComponentStatus;
};

export function deriveVerifyComponents(input: VerifyStatusInput): VerifyComponents {
  const settled =
    input.sessionStatus === "settled" || Boolean(input.settlementTxHash);
  const proposalOk =
    input.proposalStatus === "confirmed" ||
    input.proposalStatus === "submitted" ||
    input.proposalStatus === "attesting" ||
    input.proposalStatus === "proposed";

  return {
    session: input.sessionStatus ? "ok" : "missing",
    dealerCommitment: input.dealerRoot ? "ok" : "missing",
    vrf:
      input.vrfRequestCount === 0
        ? "missing"
        : input.vrfFulfilledCount >= input.vrfRequestCount
          ? "ok"
          : "pending",
    eventRoots: input.lastEventRoot || input.checkpointCount > 0 ? "ok" : "missing",
    handRoots: input.handRootCount > 0 ? "ok" : "missing",
    baseAnchor:
      input.checkpointWithTxCount > 0
        ? "ok"
        : input.checkpointCount > 0
          ? "pending"
          : "missing",
    settlement: settled
      ? "ok"
      : proposalOk || input.sessionStatus === "settling"
        ? "pending"
        : "missing",
    attestors: input.attestorCount >= 2 ? "ok" : input.attestorCount > 0 ? "pending" : "missing",
  };
}

export function derivePublicVerifyStatus(input: VerifyStatusInput): PublicVerifyStatus {
  if (input.verificationFailed) return "VERIFICATION_FAILED";

  const c = deriveVerifyComponents(input);
  const settled =
    input.sessionStatus === "settled" && Boolean(input.settlementTxHash);

  if (settled && c.baseAnchor === "ok" && c.eventRoots === "ok" && c.attestors === "ok") {
    // Private dealer secrets remain enclave-attested until public opening package exists.
    if (c.dealerCommitment === "ok" && c.vrf === "ok") {
      return "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER";
    }
    return "VERIFIED";
  }

  if (settled && c.baseAnchor === "ok") {
    return "VERIFIED";
  }

  if (
    input.sessionStatus === "settling" ||
    input.proposalStatus === "proposed" ||
    input.proposalStatus === "attesting" ||
    input.proposalStatus === "submitted"
  ) {
    return "PENDING_SETTLEMENT";
  }

  if (c.baseAnchor === "pending" || (c.eventRoots === "ok" && c.baseAnchor !== "ok")) {
    return "PENDING_BASE_ANCHOR";
  }

  return "INCOMPLETE_PUBLIC_DATA";
}

/** Legacy UI badge mapping (kept for older clients). */
export function toLegacyBadge(status: PublicVerifyStatus): "verified" | "incomplete" | "failed" {
  if (status === "VERIFIED" || status === "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER") return "verified";
  if (status === "VERIFICATION_FAILED") return "failed";
  return "incomplete";
}
