/**
 * WP-092 — pure helpers for admin ops dashboard (sessions / randomness / AI).
 * Read-only classification only — no settlement mutation.
 */

export type AiHealthStatus = "ok" | "degraded" | "critical" | "unknown";

export type AiHealthThresholds = {
  /** Fallback rate at/above this → degraded (default 5%). */
  degradedFallbackRate: number;
  /** Fallback rate at/above this → critical (default 25%). */
  criticalFallbackRate: number;
  /** p95 latency ms at/above this → at least degraded (default 8000). */
  degradedP95Ms: number;
  /** p95 latency ms at/above this → critical (default 20000). */
  criticalP95Ms: number;
};

export const DEFAULT_AI_HEALTH_THRESHOLDS: AiHealthThresholds = {
  degradedFallbackRate: 0.05,
  criticalFallbackRate: 0.25,
  degradedP95Ms: 8_000,
  criticalP95Ms: 20_000,
};

/** Nearest-rank percentile for a pre-sorted ascending numeric array. */
export function percentileSorted(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.ceil(clamped * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, idx)]!;
}

export function latencyPercentiles(latenciesMs: number[]): {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sampleSize: number;
} {
  const sorted = latenciesMs.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return {
    p50: percentileSorted(sorted, 0.5),
    p95: percentileSorted(sorted, 0.95),
    p99: percentileSorted(sorted, 0.99),
    sampleSize: sorted.length,
  };
}

export function classifyAiHealth(input: {
  invocationCount: number;
  fallbackRate: number;
  p95Ms: number | null;
  thresholds?: Partial<AiHealthThresholds>;
}): { status: AiHealthStatus; reasons: string[] } {
  const t = { ...DEFAULT_AI_HEALTH_THRESHOLDS, ...input.thresholds };
  if (input.invocationCount <= 0) {
    return { status: "unknown", reasons: ["no_invocations_in_window"] };
  }

  const reasons: string[] = [];
  let status: AiHealthStatus = "ok";

  if (input.fallbackRate >= t.criticalFallbackRate) {
    status = "critical";
    reasons.push(`fallback_rate>=${t.criticalFallbackRate}`);
  } else if (input.fallbackRate >= t.degradedFallbackRate) {
    status = "degraded";
    reasons.push(`fallback_rate>=${t.degradedFallbackRate}`);
  }

  if (input.p95Ms != null && input.p95Ms >= t.criticalP95Ms) {
    status = "critical";
    reasons.push(`p95_ms>=${t.criticalP95Ms}`);
  } else if (input.p95Ms != null && input.p95Ms >= t.degradedP95Ms) {
    if (status === "ok") status = "degraded";
    reasons.push(`p95_ms>=${t.degradedP95Ms}`);
  }

  if (!reasons.length) reasons.push("within_policy");
  return { status, reasons };
}

export function checkpointAgeSeconds(createdAt: string | Date | null | undefined, now = Date.now()): number | null {
  if (!createdAt) return null;
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

export type RandomnessEpochHealth = "healthy" | "pending" | "stale" | "failed";

export function classifyRandomnessEpoch(input: {
  status: string;
  createdAt: string | Date;
  fulfilledAt?: string | Date | null;
  /** Seconds without fulfillment before stale (default 300). */
  staleAfterSec?: number;
  now?: number;
}): RandomnessEpochHealth {
  if (input.status === "failed") return "failed";
  if (input.status === "fulfilled") return "healthy";
  const now = input.now ?? Date.now();
  const created =
    typeof input.createdAt === "string" ? Date.parse(input.createdAt) : input.createdAt.getTime();
  const ageSec = Number.isFinite(created) ? (now - created) / 1000 : 0;
  const staleAfter = input.staleAfterSec ?? 300;
  if (ageSec >= staleAfter) return "stale";
  return "pending";
}

export type RandomnessLifecycleStage =
  | "COMMITTED"
  | "VRF_PENDING"
  | "VRF_FULFILLED"
  | "DECK_BATCH_REGISTERED"
  | "DEGRADED"
  | "FAILED";

/** MC-082 — map DB + deck-batch signals to operator lifecycle labels. */
export function mapRandomnessLifecycle(input: {
  status: string;
  health: RandomnessEpochHealth;
  hasDeckBatch: boolean;
  deckBatchRegisteredOnChain: boolean;
}): RandomnessLifecycleStage {
  if (input.status === "failed" || input.health === "failed") return "FAILED";
  if (input.health === "stale") return "DEGRADED";
  if (input.hasDeckBatch || input.deckBatchRegisteredOnChain) return "DECK_BATCH_REGISTERED";
  if (input.status === "fulfilled") return "VRF_FULFILLED";
  if (input.status === "requested") return "VRF_PENDING";
  return "COMMITTED";
}

export type SolvencyControlHealth = "HEALTHY" | "CRITICAL" | "UNAVAILABLE" | "STALE" | "DEGRADED";

export function mapSolvencyControlHealth(input: {
  status: "PROTOCOL SOLVENT" | "PROTOCOL INSOLVENT" | "UNAVAILABLE";
  indexerStale?: boolean;
  indexerLagWarn?: boolean;
}): SolvencyControlHealth {
  if (input.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (input.status === "PROTOCOL INSOLVENT") return "CRITICAL";
  if (input.indexerStale) return "STALE";
  if (input.indexerLagWarn) return "DEGRADED";
  return "HEALTHY";
}

export type SettlementQueueStage =
  | "READY_TO_SETTLE"
  | "WAITING_ATTESTORS"
  | "SUBMISSION_PENDING"
  | "CONFIRMING"
  | "SETTLED"
  | "RETRY"
  | "FAILED"
  | "EMERGENCY_ELIGIBLE";

const DEFAULT_ATTESTOR_QUORUM = Number(process.env.ATTESTOR_MIN_SIGNATURES ?? 3);

/** MC-084 — map proposal + tx rows to operator queue labels. */
export function mapSettlementQueueStage(input: {
  proposalStatus: string;
  attestationCount: number;
  requiredQuorum?: number;
  txStatus: string | null;
  txHash: string | null;
  txError: string | null;
  emergencyEligible?: boolean;
}): SettlementQueueStage {
  if (input.emergencyEligible) return "EMERGENCY_ELIGIBLE";
  const quorum = input.requiredQuorum ?? DEFAULT_ATTESTOR_QUORUM;
  const status = input.proposalStatus;
  if (status === "confirmed") return "SETTLED";
  if (status === "rejected" || status === "blocked") return "FAILED";
  if (input.txError && status === "submitted") return "RETRY";
  if (status === "submitted") {
    if (input.txHash && input.txStatus === "pending") return "CONFIRMING";
    return "SUBMISSION_PENDING";
  }
  if (status === "attesting" || (status === "proposed" && input.attestationCount > 0 && input.attestationCount < quorum)) {
    return "WAITING_ATTESTORS";
  }
  if (status === "proposed") return "READY_TO_SETTLE";
  return "READY_TO_SETTLE";
}

export type ProofContinuityStatus = "CONTINUOUS" | "GAP_DETECTED" | "UNAVAILABLE";

/** MC-083 — detect missing proof-batch sequence numbers (sorted ascending). */
export function detectProofBatchGaps(sequences: number[]): {
  status: ProofContinuityStatus;
  gaps: Array<{ after: number; missing: number }>;
} {
  if (!sequences.length) {
    return { status: "UNAVAILABLE", gaps: [] };
  }
  const sorted = [...sequences].sort((a, b) => a - b);
  const gaps: Array<{ after: number; missing: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur - prev > 1) {
      for (let missing = prev + 1; missing < cur; missing++) {
        gaps.push({ after: prev, missing });
      }
    }
  }
  return { status: gaps.length ? "GAP_DETECTED" : "CONTINUOUS", gaps };
}

export type WatchtowerVerificationSignal =
  | "OPERATOR_VERIFIED"
  | "WATCHTOWER_VERIFIED"
  | "BOTH_VERIFIED"
  | "MISMATCH"
  | "PENDING";

export function classifyWatchtowerSignal(input: {
  operatorOk: boolean | null;
  watchtowerStatus: string | null;
}): WatchtowerVerificationSignal {
  const wtOk = input.watchtowerStatus === "VERIFIED";
  const wtFailed = input.watchtowerStatus === "FAILED" || input.watchtowerStatus === "ERROR";
  if (input.operatorOk === null && !input.watchtowerStatus) return "PENDING";
  if (input.operatorOk === true && wtOk) return "BOTH_VERIFIED";
  if (input.operatorOk === true && !input.watchtowerStatus) return "OPERATOR_VERIFIED";
  if (wtOk && input.operatorOk !== true) return "WATCHTOWER_VERIFIED";
  if (input.operatorOk === false || wtFailed) return "MISMATCH";
  return "PENDING";
}
