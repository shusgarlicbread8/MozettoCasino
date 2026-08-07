/**
 * WP-055 — run full Randomness V2 independent verification suite.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyMutations,
  verifyVector07,
  verifyVector08,
} from "./golden.js";
import type { VerifyReport } from "./types.js";

const PKG_SRC = dirname(fileURLToPath(import.meta.url));

export function defaultVectorsDir(repoRoot?: string): string {
  // packages/randomness-verifier/src → repo root
  const root = repoRoot ?? resolve(PKG_SRC, "../../..");
  return resolve(root, "specs/canonical-vectors");
}

export function runRandomnessVerification(opts?: {
  vectorsDir?: string;
}): VerifyReport {
  const vectorsDir = resolve(opts?.vectorsDir ?? defaultVectorsDir());
  const checks = [
    ...verifyVector08(vectorsDir),
    ...verifyVector07(vectorsDir),
    ...verifyMutations(vectorsDir),
  ];
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  return {
    workPacket: "WP-055",
    policyId: "MOZETTO_RANDOMNESS_V2",
    vectorsDir,
    ok: failed === 0,
    passed,
    failed,
    checks,
  };
}

export function formatReportText(report: VerifyReport): string {
  const lines: string[] = [
    `WP-055 Randomness verifier  policy=${report.policyId}`,
    `vectorsDir=${report.vectorsDir}`,
    `result=${report.ok ? "PASS" : "FAIL"}  ${report.passed}/${report.passed + report.failed} checks`,
    "",
  ];
  for (const c of report.checks) {
    lines.push(`${c.ok ? "ok" : "FAIL"}  ${c.id}  ${c.detail}`);
  }
  return lines.join("\n");
}
