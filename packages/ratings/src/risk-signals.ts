/**
 * Plan 12 identity / collusion *signals* — explainable, sample-aware, non-punitive.
 *
 * This is NOT a production ML collusion detector. A single weak signal must not
 * confiscate funds. Callers may flag for review / seat exclusion only.
 */

export type RiskSignalId =
  | "same_funding_source"
  | "direct_wallet_transfer"
  | "circular_transfers"
  | "device_account_linkage"
  | "network_ip_linkage"
  | "shared_withdrawal_address"
  | "synchronized_queue_entry"
  | "repeated_private_table_history"
  | "abnormal_mutual_results"
  | "suspicious_large_pot_folds"
  | "chip_dumping_pattern"
  | "soft_play_pair"
  | "avoidance_of_aggression"
  | "coordinated_isolation_raises"
  | "abnormal_showdown_pattern"
  | "repeated_net_transfer_direction"
  | "timing_synchronization"
  | "correlated_profile_changes";

export type RiskSignal = {
  id: RiskSignalId;
  /** 0–1 contribution before sample / confidence scaling. */
  strength: number;
  /** Evidence sample size supporting this signal. */
  sampleSize: number;
  /** Human-readable evidence pointer (ids, not secrets). */
  evidenceRef?: string;
};

export type RiskAssessment = {
  /** Aggregate 0–100 risk score (descriptive). */
  score: number;
  /** Weak / developing / strong based on samples — never auto-punish alone. */
  confidence: "insufficient" | "weak" | "moderate" | "strong";
  /** Signals that contributed after shrinkage. */
  contributing: Array<{ id: RiskSignalId; contribution: number; sampleSize: number }>;
  /** Always true: model score alone must not confiscate or auto-suspend. */
  autoPunishForbidden: true;
  /** Suggested non-custodial actions only. */
  suggestedActions: Array<"flag_review" | "seat_exclusion" | "monitor" | "none">;
};

const MIN_SAMPLE_FOR_WEAK = 5;
const MIN_SAMPLE_FOR_MODERATE = 25;
const MIN_SAMPLE_FOR_STRONG = 100;

/** Bayesian-ish shrink: small samples contribute less. */
function sampleWeight(n: number): number {
  if (n <= 0) return 0;
  return n / (n + 20);
}

/**
 * Aggregate explainable risk signals. Does not transition abuse states
 * and never authorizes fund seizure.
 */
export function assessRiskSignals(signals: RiskSignal[]): RiskAssessment {
  const contributing: RiskAssessment["contributing"] = [];
  let raw = 0;
  let maxSample = 0;
  for (const s of signals) {
    const strength = Math.max(0, Math.min(1, s.strength));
    const w = sampleWeight(s.sampleSize);
    const contribution = strength * w;
    if (contribution <= 0) continue;
    contributing.push({ id: s.id, contribution, sampleSize: s.sampleSize });
    raw += contribution;
    maxSample = Math.max(maxSample, s.sampleSize);
  }
  // Soft cap — many weak signals should not explode past ~100.
  const score = Math.round(Math.min(100, (1 - Math.exp(-raw)) * 100) * 10) / 10;
  const confidence =
    maxSample < MIN_SAMPLE_FOR_WEAK
      ? "insufficient"
      : maxSample < MIN_SAMPLE_FOR_MODERATE
        ? "weak"
        : maxSample < MIN_SAMPLE_FOR_STRONG
          ? "moderate"
          : "strong";

  const suggestedActions: RiskAssessment["suggestedActions"] = [];
  if (score < 15 || confidence === "insufficient") {
    suggestedActions.push("none");
  } else if (score < 40) {
    suggestedActions.push("monitor");
  } else if (score < 70) {
    suggestedActions.push("flag_review", "monitor");
  } else {
    suggestedActions.push("flag_review", "seat_exclusion", "monitor");
  }

  return {
    score,
    confidence,
    contributing,
    autoPunishForbidden: true,
    suggestedActions,
  };
}
