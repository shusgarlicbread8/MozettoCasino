/**
 * MC-033 — Mozetto Control alert thresholds for Command Center (Plan 04 §8).
 *
 * Critical examples (auto-incident in later waves):
 * - solvency difference != 0 after confirmation window
 * - settlement conservation failure
 *
 * High / degraded examples wired here:
 * - settlement oldest pending age
 * - indexer lag / cursor staleness
 * - VRF fulfillment stalled (stale pending randomness)
 * - agent timeout / fallback spike
 *
 * Env overrides keep staging tunable without code changes.
 */

import type { AiHealthThresholds } from "./admin-ops.js";
import { DEFAULT_AI_HEALTH_THRESHOLDS } from "./admin-ops.js";

/** Indexer cursor age before STALE (default 2m). */
export const INDEXER_STALE_MS = Number(process.env.ADMIN_INDEXER_STALE_MS ?? 120_000);

/** Block lag vs RPC head before DEGRADED (default 50 blocks). */
export const INDEXER_LAG_WARN_BLOCKS = Number(process.env.ADMIN_INDEXER_LAG_WARN_BLOCKS ?? 50);

/** Block lag before CRITICAL (default 200 blocks). */
export const INDEXER_LAG_CRITICAL_BLOCKS = Number(
  process.env.ADMIN_INDEXER_LAG_CRITICAL_BLOCKS ?? 200,
);

/** Pending settlement proposal age before DEGRADED (default 15m). */
export const SETTLEMENT_OLDEST_DEGRADED_MS = Number(
  process.env.ADMIN_SETTLEMENT_OLDEST_DEGRADED_MS ?? 900_000,
);

/** Pending settlement proposal age before CRITICAL (default 60m). */
export const SETTLEMENT_OLDEST_CRITICAL_MS = Number(
  process.env.ADMIN_SETTLEMENT_OLDEST_CRITICAL_MS ?? 3_600_000,
);

/** Open settlement proposals count before DEGRADED (default 8). */
export const SETTLEMENT_QUEUE_DEGRADED_COUNT = Number(
  process.env.ADMIN_SETTLEMENT_QUEUE_DEGRADED_COUNT ?? 8,
);

/** Stale VRF / randomness pending epochs before DEGRADED (default 5m). */
export const VRF_STALE_PENDING_SEC = Number(process.env.ADMIN_VRF_STALE_PENDING_SEC ?? 300);

/** Count of stale pending VRF epochs before CRITICAL (default 3). */
export const VRF_STALE_PENDING_CRITICAL_COUNT = Number(
  process.env.ADMIN_VRF_STALE_PENDING_CRITICAL_COUNT ?? 3,
);

/** Remote service /health probe timeout (default 2.5s). */
export const SERVICE_PROBE_TIMEOUT_MS = Number(
  process.env.ADMIN_SERVICE_PROBE_TIMEOUT_MS ?? 2_500,
);

export const OVERVIEW_AI_THRESHOLDS: AiHealthThresholds = {
  ...DEFAULT_AI_HEALTH_THRESHOLDS,
};

export type OverviewComponentStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "CRITICAL"
  | "STALE"
  | "UNAVAILABLE";

const STATUS_RANK: Record<OverviewComponentStatus, number> = {
  HEALTHY: 0,
  DEGRADED: 1,
  STALE: 2,
  CRITICAL: 3,
  UNAVAILABLE: 4,
};

export function worstComponentStatus(
  statuses: OverviewComponentStatus[],
): OverviewComponentStatus {
  if (!statuses.length) return "UNAVAILABLE";
  return statuses.reduce((worst, s) =>
    STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst,
  );
}

export function rollupOverviewStatus(
  components: Record<string, { status: OverviewComponentStatus }>,
): OverviewComponentStatus {
  const values = Object.values(components).map((c) => c.status);
  const worst = worstComponentStatus(values);
  if (worst === "HEALTHY") return "HEALTHY";
  if (worst === "UNAVAILABLE" && values.every((s) => s === "UNAVAILABLE")) {
    return "UNAVAILABLE";
  }
  if (worst === "CRITICAL") return "CRITICAL";
  return "DEGRADED";
}

export function mapSolvencyBanner(
  banner: "PROTOCOL SOLVENT" | "PROTOCOL INSOLVENT" | "UNAVAILABLE",
): OverviewComponentStatus {
  if (banner === "PROTOCOL SOLVENT") return "HEALTHY";
  if (banner === "PROTOCOL INSOLVENT") return "CRITICAL";
  return "UNAVAILABLE";
}

export function mapAiOpsStatus(
  status: "ok" | "degraded" | "critical" | "unknown",
): OverviewComponentStatus {
  if (status === "ok") return "HEALTHY";
  if (status === "degraded") return "DEGRADED";
  if (status === "critical") return "CRITICAL";
  return "DEGRADED";
}

export function classifyIndexerHealth(input: {
  stale: boolean;
  lagBlocks: number | null;
}): { status: OverviewComponentStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (input.stale) reasons.push(`cursor_stale>${INDEXER_STALE_MS}ms`);
  if (input.lagBlocks != null && input.lagBlocks >= INDEXER_LAG_CRITICAL_BLOCKS) {
    reasons.push(`lag_blocks>=${INDEXER_LAG_CRITICAL_BLOCKS}`);
    return { status: "CRITICAL", reasons };
  }
  if (input.stale) return { status: "STALE", reasons };
  if (input.lagBlocks != null && input.lagBlocks >= INDEXER_LAG_WARN_BLOCKS) {
    reasons.push(`lag_blocks>=${INDEXER_LAG_WARN_BLOCKS}`);
    return { status: "DEGRADED", reasons };
  }
  if (!reasons.length) reasons.push("within_policy");
  return { status: "HEALTHY", reasons };
}

export function classifySettlementHealth(input: {
  pendingCount: number;
  oldestPendingAgeMs: number | null;
  failedCount: number;
}): { status: OverviewComponentStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (input.failedCount > 0) {
    reasons.push(`failed_or_rejected=${input.failedCount}`);
  }
  if (
    input.oldestPendingAgeMs != null &&
    input.oldestPendingAgeMs >= SETTLEMENT_OLDEST_CRITICAL_MS
  ) {
    reasons.push(`oldest_pending>=${SETTLEMENT_OLDEST_CRITICAL_MS}ms`);
    return { status: "CRITICAL", reasons };
  }
  if (
    input.pendingCount >= SETTLEMENT_QUEUE_DEGRADED_COUNT ||
    (input.oldestPendingAgeMs != null &&
      input.oldestPendingAgeMs >= SETTLEMENT_OLDEST_DEGRADED_MS)
  ) {
    if (input.pendingCount >= SETTLEMENT_QUEUE_DEGRADED_COUNT) {
      reasons.push(`pending_count>=${SETTLEMENT_QUEUE_DEGRADED_COUNT}`);
    }
    if (
      input.oldestPendingAgeMs != null &&
      input.oldestPendingAgeMs >= SETTLEMENT_OLDEST_DEGRADED_MS
    ) {
      reasons.push(`oldest_pending>=${SETTLEMENT_OLDEST_DEGRADED_MS}ms`);
    }
    return { status: "DEGRADED", reasons };
  }
  if (input.failedCount > 0) return { status: "DEGRADED", reasons };
  if (!reasons.length) reasons.push("within_policy");
  return { status: "HEALTHY", reasons };
}

export function classifyRandomnessHealth(stalePendingCount: number): {
  status: OverviewComponentStatus;
  reasons: string[];
} {
  if (stalePendingCount >= VRF_STALE_PENDING_CRITICAL_COUNT) {
    return {
      status: "CRITICAL",
      reasons: [`stale_vrf_pending>=${VRF_STALE_PENDING_CRITICAL_COUNT}`],
    };
  }
  if (stalePendingCount > 0) {
    return {
      status: "DEGRADED",
      reasons: [`stale_vrf_pending=${stalePendingCount}`],
    };
  }
  return { status: "HEALTHY", reasons: ["within_policy"] };
}
