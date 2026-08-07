import { compareBalances, rawToUsdcString } from "./compare.js";
import { fetchChainBalances, type ChainReader } from "./chain.js";
import { fetchMirrorBalances, type MirrorReader } from "./mirrors.js";
import { buildPauseSignal, summarizeChecks } from "./pause.js";
import {
  createDbPersistPort,
  snapshotArgsFromReport,
  type PersistPort,
} from "./persist.js";
import type { ReconciliationReport, ReconcileRunOptions } from "./types.js";

export type ReconcileResult = {
  runId: string;
  report: ReconciliationReport;
  paused: boolean;
};

export async function runReconciliation(opts: {
  chainId: number;
  chain: ChainReader;
  mirrors: MirrorReader;
  persist?: PersistPort;
  toleranceRaw?: bigint;
  autoPause?: boolean;
}): Promise<ReconcileResult> {
  const persist = opts.persist ?? createDbPersistPort();
  const toleranceRaw = opts.toleranceRaw ?? 0n;
  const autoPause = opts.autoPause ?? false;

  const runId = await persist.beginRun(opts.chainId);
  try {
    const [chainBal, mirrorBal] = await Promise.all([
      fetchChainBalances(opts.chain),
      fetchMirrorBalances(opts.mirrors, opts.chainId),
    ]);

    const report = compareBalances(chainBal, mirrorBal, toleranceRaw);

    await persist.writeSnapshot(
      snapshotArgsFromReport(
        opts.chainId,
        chainBal.vaultUsdcBalance,
        mirrorBal.mirrorAvailableUsdc,
        mirrorBal.mirrorEscrowUsdc,
        report,
      ),
    );
    await persist.writeDifferences(runId, opts.chainId, report);

    let paused = false;
    const signal = buildPauseSignal(report, { chainId: opts.chainId, runId });
    if (signal && autoPause) {
      await persist.applyPause(signal);
      paused = true;
      console.error(
        `[reconciliation] PAUSE chain=${opts.chainId} run=${runId} ` +
          `skewUsdc=${rawToUsdcString(report.lockedSkewRaw)} ` +
          `failed=${signal.failedChecks.map((c) => c.id).join(",")}`,
      );
    } else if (signal) {
      console.warn(
        `[reconciliation] critical skew (auto-pause off) chain=${opts.chainId} ` +
          `skewUsdc=${rawToUsdcString(report.lockedSkewRaw)} ` +
          `failed=${signal.failedChecks.map((c) => c.id).join(",")}`,
      );
    }

    await persist.finishRun(runId, report.ok, {
      ok: report.ok,
      criticalFailure: report.criticalFailure,
      paused,
      autoPause,
      impliedLockedRaw: report.impliedLockedRaw.toString(),
      lockedSkewRaw: report.lockedSkewRaw.toString(),
      impliedLockedUsdc: rawToUsdcString(report.impliedLockedRaw),
      lockedSkewUsdc: rawToUsdcString(report.lockedSkewRaw),
      vaultUsdcBalance: chainBal.vaultUsdcBalance.toString(),
      accruedProtocolFees: chainBal.accruedProtocolFees.toString(),
      openSessionLockedRaw: mirrorBal.openSessionLockedRaw.toString(),
      feeVaultUsdcBalance: chainBal.feeVaultUsdcBalance?.toString() ?? null,
      feeVaultAccrued: chainBal.feeVaultAccrued?.toString() ?? null,
      mirrorAvailableUsdc: mirrorBal.mirrorAvailableUsdc,
      mirrorEscrowUsdc: mirrorBal.mirrorEscrowUsdc,
      checks: summarizeChecks(report.checks),
    });

    return { runId, report, paused };
  } catch (err) {
    try {
      await persist.finishRun(runId, false, { error: String(err) });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export type { ReconcileRunOptions };
