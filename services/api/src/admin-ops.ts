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
