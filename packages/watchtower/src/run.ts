/**
 * WP-095 — orchestrate independent watchtower verification over a public package.
 */
import { formatHealthLine, formatReportText, summarizeChecks } from "./report.js";
import type {
  CheckResult,
  PublicBatchSource,
  PublicVerifyPackage,
  WatchtowerReport,
} from "./types.js";
import {
  toPublicProofBatch,
  verifyAgainstBatchSource,
  verifyBatchContinuity,
  verifyProofBatchClaim,
} from "./verify-batch.js";
import {
  verifyBalanceInclusionClaim,
  verifyBalances,
  verifySettlementConservation,
} from "./verify-balance.js";
import { verifyRandomnessSection } from "./verify-randomness.js";

export type RunWatchtowerOptions = {
  /** Public verification package (file / fixture / API artifact). */
  pkg: PublicVerifyPackage;
  /** Optional read-only ProofBatchRegistry source (mock or viem views). */
  batchSource?: PublicBatchSource;
  /**
   * When true (default for fixture-suite), run MOZETTO_RANDOMNESS_V2 golden
   * even if package.randomness is absent.
   */
  includeRandomnessGolden?: boolean;
  vectorsDir?: string;
};

export async function runWatchtower(
  opts: RunWatchtowerOptions,
): Promise<WatchtowerReport> {
  const { pkg } = opts;
  const checks: CheckResult[] = [];

  // --- Proof batch ---
  if (pkg.proofBatch) {
    checks.push(...verifyProofBatchClaim(pkg.proofBatch));
    if (opts.batchSource) {
      checks.push(
        ...(await verifyAgainstBatchSource(
          toPublicProofBatch(pkg.proofBatch),
          opts.batchSource,
        )),
      );
    }
  } else {
    checks.push({
      id: "proofBatch",
      ok: true,
      skipped: true,
      detail: "no proofBatch in public package",
    });
  }

  // --- Continuity chain ---
  if (pkg.batchChain && pkg.batchChain.length > 0) {
    const chain = pkg.batchChain.map(toPublicProofBatch);
    checks.push(...verifyBatchContinuity(chain));
    for (const entry of pkg.batchChain) {
      if (entry.checkpointRoots && entry.checkpointRoots.length > 0) {
        checks.push(
          ...verifyProofBatchClaim(
            {
              ...entry,
              checkpointRoots: entry.checkpointRoots,
            },
            `batchChain[${entry.sequence}]`,
          ),
        );
      }
    }
  }

  // --- Balances ---
  if (pkg.balances) {
    checks.push(...verifyBalances(pkg.balances));
  } else {
    checks.push({
      id: "balances",
      ok: true,
      skipped: true,
      detail: "no balances in public package",
    });
  }

  if (pkg.balanceInclusion) {
    checks.push(...verifyBalanceInclusionClaim(pkg.balanceInclusion));
  }

  // --- Settlement conservation ---
  if (pkg.settlement) {
    checks.push(...verifySettlementConservation(pkg.settlement));
  } else {
    checks.push({
      id: "settlement",
      ok: true,
      skipped: true,
      detail: "no settlement totals in public package",
    });
  }

  // --- Randomness ---
  const randomness = pkg.randomness ?? {};
  const runGolden =
    randomness.runGoldenSuite === true ||
    (opts.includeRandomnessGolden === true && randomness.runGoldenSuite !== false);

  if (runGolden || randomness.opening) {
    checks.push(
      ...verifyRandomnessSection({
        ...randomness,
        runGoldenSuite: runGolden,
        vectorsDir: randomness.vectorsDir ?? opts.vectorsDir,
      }),
    );
  } else {
    checks.push({
      id: "randomness",
      ok: true,
      skipped: true,
      detail: "randomness suite not requested",
    });
  }

  const pending = {
    baseAnchor: pkg.pending?.baseAnchor === true,
    settlement:
      pkg.pending?.settlement === true ||
      (pkg.settlement != null && pkg.settlement.anchoredOnChain === false),
    privateDealerAttested: pkg.pending?.privateDealerAttested === true,
  };

  return summarizeChecks(checks, {
    packageId: pkg.packageId,
    pending,
  });
}

export { formatHealthLine, formatReportText };
