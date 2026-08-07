/**
 * Human-readable + JSON report formatting for WP-077.
 */

import type { EvalReport } from "./metrics.js";

export function formatEvalReportText(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`WP-077 Poker evaluation harness — mode=${report.mode} seed=${report.seed}`);
  lines.push(`Decisions: ${report.totalDecisions}`);
  lines.push(
    `Overall latency p50/p95/p99: ${report.overall.latency.p50.toFixed(1)} / ${report.overall.latency.p95.toFixed(1)} / ${report.overall.latency.p99.toFixed(1)} ms`,
  );
  lines.push(
    `Overall fallback rate: ${(report.overall.fallbackRate * 100).toFixed(2)}% | illegal-action rate: ${(report.overall.illegalActionRate * 100).toFixed(2)}%`,
  );
  lines.push(`Overall Energy spent: ${report.overall.energySpent}`);
  lines.push("");
  lines.push("Per-profile:");
  for (const p of report.profiles) {
    lines.push(
      `  ${p.profileKey.padEnd(10)} n=${p.decisions} vpip=${p.vpip.toFixed(3)} pfr=${p.pfr.toFixed(3)} agg=${p.aggressionFrequency.toFixed(3)} bb/100≈${p.bbPer100Stub.toFixed(2)} energy=${p.energySpent} fallback=${(p.fallbackRate * 100).toFixed(1)}%`,
    );
    const hist = Object.entries(p.actionHistogram)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    lines.push(`             actions: ${hist}`);
  }
  lines.push("");
  lines.push(
    `Profile separation: minL1=${report.separation.minPairwiseL1.toFixed(3)} maxL1=${report.separation.maxPairwiseL1.toFixed(3)} threshold=${report.separation.threshold} separated=${report.separation.separated}`,
  );
  for (const pair of report.separation.pairwiseActionL1) {
    lines.push(`  ${pair.a}↔${pair.b}: ${pair.distance.toFixed(3)}`);
  }
  if (report.notes.length) {
    lines.push("");
    lines.push("Notes:");
    for (const n of report.notes) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

export function formatEvalReportJson(report: EvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
