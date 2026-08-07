import type { CheckResult, WatchtowerReport, WatchtowerStatus } from "./types.js";

export type PendingFlags = {
  baseAnchor?: boolean;
  settlement?: boolean;
  privateDealerAttested?: boolean;
};

export function summarizeChecks(
  checks: readonly CheckResult[],
  opts?: { packageId?: string; pending?: PendingFlags },
): WatchtowerReport {
  const passed = checks.filter((c) => c.ok && !c.skipped).length;
  const failed = checks.filter((c) => !c.ok && !c.skipped).length;
  const skipped = checks.filter((c) => c.skipped).length;
  const status = resolveStatus(failed, checks, opts?.pending);
  const verified =
    status === "VERIFIED" || status === "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER";
  return {
    workPacket: "WP-095",
    packageId: opts?.packageId,
    ok: failed === 0 && verified,
    status,
    passed,
    failed,
    skipped,
    checks: [...checks],
  };
}

/**
 * Map check outcomes + pending flags → Plan 10 public result categories.
 * Hard failures always win; pending/incomplete never become VERIFIED.
 */
export function resolveStatus(
  failed: number,
  checks: readonly CheckResult[],
  pending?: PendingFlags,
): WatchtowerStatus {
  if (failed > 0) return "VERIFICATION_FAILED";
  if (pending?.baseAnchor) return "PENDING_BASE_ANCHOR";
  if (pending?.settlement) return "PENDING_SETTLEMENT";

  const substantive = checks.filter((c) => !c.skipped);
  if (substantive.length === 0) return "INCOMPLETE_PUBLIC_DATA";

  if (pending?.privateDealerAttested) {
    return "VERIFIED_WITH_ATTESTED_PRIVATE_DEALER";
  }
  return "VERIFIED";
}

export function formatReportText(report: WatchtowerReport): string {
  const lines: string[] = [
    `WP-095 Watchtower  status=${report.status}`,
  ];
  if (report.packageId) lines.push(`packageId=${report.packageId}`);
  lines.push(
    `result=${report.ok ? "PASS" : "FAIL"}  passed=${report.passed} failed=${report.failed} skipped=${report.skipped}`,
    "",
  );

  for (const c of report.checks) {
    const tag = c.skipped ? "skip" : c.ok ? "ok" : "FAIL";
    lines.push(`${tag}  ${c.id}  ${c.detail}`);
  }
  return lines.join("\n");
}

/** Health one-liner for CI / ops. */
export function formatHealthLine(report: WatchtowerReport): string {
  return report.ok
    ? `PASS status=${report.status} ${report.passed}/${report.passed + report.failed}`
    : `FAIL status=${report.status} failed=${report.failed} skipped=${report.skipped}`;
}
