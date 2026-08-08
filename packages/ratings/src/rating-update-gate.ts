/**
 * Plan 12 rating update gate — pure eligibility checks before Glicko moves.
 *
 * Rating updates only after settlement + verification + integrity/pair rules.
 * Stake size never enters this decision (and never scales Glicko deltas).
 */

import { GLICKO_DEFAULTS } from "./glicko2.js";

export type RatingMatchClass =
  | "ranked_public"
  | "private"
  | "open_custom"
  | "demo_unranked"
  /** Public Casual league — real money, no Arena Rating. */
  | "casual_unranked";

export type RatingFormat = "hu" | "sixmax" | "other";

export type RatingUpdateSkipReason =
  | "private_or_custom_unranked"
  | "sixmax_unrated_season1"
  | "settlement_unconfirmed"
  | "verification_failed"
  | "provider_incident_void"
  | "integrity_hold"
  | "pair_or_identity_rejected"
  | "zero_pair_weight"
  | "missing_session_reference"
  | "unsupported_pool";

export type RatingUpdateGateInput = {
  /** Product class of the session (private/custom never update ranked Glicko). */
  matchClass: RatingMatchClass;
  /** HU vs six-max vs other. Six-max Season 1 is unrated (BB/100 stats only). */
  format: RatingFormat;
  /** Settlement confirmed on-chain or demo ledger close. */
  settlementConfirmed: boolean;
  /** Event/replay verification passed (or trusted demo root present). */
  replayOrEventVerified: boolean;
  /** Platform-wide provider incident voided the result. */
  providerIncidentVoid: boolean;
  /** Unresolved integrity / abuse hold. */
  integrityHold: boolean;
  /** Self / linked / explicit identity reject (matchmaking already preferred). */
  pairIdentityOk: boolean;
  /** Repeated-opponent weight in [0, 1]. */
  ratingWeight: number;
  /** Account rating pool id. */
  poolId: string;
  /** Every update must reference a session. */
  sessionId?: string | null;
  /** Proof / settlement / event-log root. */
  settlementOrProofRoot?: string | null;
  /**
   * When true, allow demo ranked paths without a chain proof root
   * (soft ledger). Default false for on-chain / production gates.
   */
  allowMissingProofRoot?: boolean;
};

export type RatingUpdateGateResult =
  | {
      allow: true;
      weight: number;
      poolId: string;
      references: { sessionId: string | null; settlementOrProofRoot: string | null };
    }
  | { allow: false; reason: RatingUpdateSkipReason; detail?: string };

/** Season 1 HU ranked pool (account-owned Arena Rating). */
export const HU_RANKED_POOL_SEASON1 = "hu_holdem_standard" as const;

/** Six-max cash is unrated in Season 1 — stats only. */
export const SIXMAX_STATS_POOL_SEASON1 = "nlhe_6max_standard" as const;

const RANKED_HU_POOLS = new Set<string>([
  HU_RANKED_POOL_SEASON1,
  "hu_holdem_standard_season_1",
]);

export function evaluateRatingUpdateGate(input: RatingUpdateGateInput): RatingUpdateGateResult {
  if (
    input.matchClass === "private" ||
    input.matchClass === "open_custom" ||
    input.matchClass === "demo_unranked" ||
    input.matchClass === "casual_unranked"
  ) {
    return { allow: false, reason: "private_or_custom_unranked", detail: `matchClass=${input.matchClass}` };
  }
  if (input.format === "sixmax" || input.poolId === SIXMAX_STATS_POOL_SEASON1) {
    return { allow: false, reason: "sixmax_unrated_season1", detail: `poolId=${input.poolId}` };
  }
  if (input.format !== "hu") {
    return { allow: false, reason: "unsupported_pool", detail: `format=${input.format}` };
  }
  if (!RANKED_HU_POOLS.has(input.poolId) && input.poolId !== HU_RANKED_POOL_SEASON1) {
    // Allow known HU pool; reject unknown / non-HU pools for Glicko updates.
    if (!input.poolId.startsWith("hu_")) {
      return { allow: false, reason: "unsupported_pool", detail: `poolId=${input.poolId}` };
    }
  }
  if (!input.settlementConfirmed) {
    return { allow: false, reason: "settlement_unconfirmed" };
  }
  if (input.providerIncidentVoid) {
    return { allow: false, reason: "provider_incident_void" };
  }
  if (input.integrityHold) {
    return { allow: false, reason: "integrity_hold" };
  }
  if (!input.pairIdentityOk) {
    return { allow: false, reason: "pair_or_identity_rejected" };
  }
  if (!input.replayOrEventVerified) {
    return { allow: false, reason: "verification_failed" };
  }
  const weight = Math.max(0, Math.min(1, input.ratingWeight));
  if (weight <= 0) {
    return { allow: false, reason: "zero_pair_weight" };
  }
  const sessionId = input.sessionId ?? null;
  const root = input.settlementOrProofRoot ?? null;
  if (!sessionId && !input.allowMissingProofRoot) {
    return { allow: false, reason: "missing_session_reference" };
  }
  if (!root && !input.allowMissingProofRoot) {
    return { allow: false, reason: "verification_failed", detail: "missing settlementOrProofRoot" };
  }

  return {
    allow: true,
    weight,
    poolId: input.poolId,
    references: { sessionId, settlementOrProofRoot: root },
  };
}

/** Stake must never scale Arena Rating — documented constant for callers/tests. */
export function stakeScalesRating(): false {
  return false;
}

/** Creating/deleting an agent never resets account rating (agents are loadouts). */
export function agentLoadoutResetsRating(): false {
  return false;
}

export function provisionalAfterMatches(matchesPlayed: number): boolean {
  return matchesPlayed < GLICKO_DEFAULTS.provisionalMatches;
}
