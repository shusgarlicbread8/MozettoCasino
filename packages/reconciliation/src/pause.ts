import type { PauseSignal, ReconciliationCheck, ReconciliationReport } from "./types.js";

/** Feature flag that gates matchmaking / new on-chain sessions. */
export const PAUSE_FEATURE_FLAG = "onchain_matchmaking";

/**
 * Build a pause signal from a failed report.
 * Ops pause path: flip feature_flags.onchain_matchmaking → false and open a security_incident.
 * Manual resume: set enabled=true only after investigating evidence — never mint/patch balances.
 */
export function buildPauseSignal(
  report: ReconciliationReport,
  meta: { chainId: number; runId?: string },
): PauseSignal | null {
  if (!report.criticalFailure) return null;
  const failedChecks = report.checks.filter((c) => !c.ok && c.severity === "critical");
  return {
    reason: "reconciliation_failed",
    featureFlagKeys: [PAUSE_FEATURE_FLAG],
    incidentTitle: `Vault reconciliation failed (chain ${meta.chainId})`,
    incidentDetail: {
      reason: "reconciliation_failed",
      chainId: meta.chainId,
      runId: meta.runId ?? null,
      impliedLockedRaw: report.impliedLockedRaw.toString(),
      lockedSkewRaw: report.lockedSkewRaw.toString(),
      failedCheckIds: failedChecks.map((c) => c.id),
      checks: summarizeChecks(failedChecks),
      opsNote:
        "New sessions paused via feature_flags.onchain_matchmaking=false. Do not mint or manually patch balances. Investigate chain vs mirrors, then re-enable only after a clean reconcile run.",
    },
    failedChecks,
  };
}

export function summarizeChecks(checks: ReconciliationCheck[]): Array<{
  id: string;
  severity: string;
  message: string;
  evidence: ReconciliationCheck["evidence"];
}> {
  return checks.map((c) => ({
    id: c.id,
    severity: c.severity,
    message: c.message,
    evidence: c.evidence,
  }));
}

/** Whether auto-pause should fire for this chain env. */
export function shouldAutoPause(env: string, forceEnv?: string | boolean): boolean {
  if (forceEnv === true || forceEnv === "1" || forceEnv === "true") return true;
  if (forceEnv === false || forceEnv === "0" || forceEnv === "false") return false;
  const e = env.toLowerCase();
  return e === "base" || e === "base-sepolia" || e === "mainnet";
}
