import { query } from "@mozetto/database";
import { PAUSE_FEATURE_FLAG } from "./pause.js";
import type { PauseSignal, ReconciliationReport } from "./types.js";
import { rawToUsdcString } from "./compare.js";

export type PersistPort = {
  beginRun: (chainId: number) => Promise<string>;
  finishRun: (
    runId: string,
    ok: boolean,
    detail: Record<string, unknown>,
  ) => Promise<void>;
  writeSnapshot: (args: {
    chainId: number;
    tokenBalanceRaw: string;
    mirrorAvailableSum: number;
    mirrorEscrowSum: number;
    differenceUsdc: number;
    ok: boolean;
  }) => Promise<void>;
  writeDifferences: (
    runId: string,
    chainId: number,
    report: ReconciliationReport,
  ) => Promise<void>;
  applyPause: (signal: PauseSignal) => Promise<void>;
};

export function createDbPersistPort(): PersistPort {
  return {
    async beginRun(chainId) {
      const run = await query<{ id: string }>(
        `insert into reconciliation_runs (chain_id, started_at) values ($1, now()) returning id::text`,
        [chainId],
      );
      const id = run.rows[0]?.id;
      if (!id) throw new Error("failed to insert reconciliation_runs");
      return id;
    },

    async finishRun(runId, ok, detail) {
      await query(
        `update reconciliation_runs set finished_at = now(), ok = $2, detail = $3::jsonb where id = $1`,
        [runId, ok, JSON.stringify(detail)],
      );
    },

    async writeSnapshot(args) {
      await query(
        `insert into vault_balance_snapshots
           (chain_id, token_balance_raw, mirror_available_sum, mirror_escrow_sum, difference_usdc, ok)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          args.chainId,
          args.tokenBalanceRaw,
          args.mirrorAvailableSum,
          args.mirrorEscrowSum,
          args.differenceUsdc,
          args.ok,
        ],
      );
    },

    async writeDifferences(runId, chainId, report) {
      for (const c of report.checks) {
        if (c.ok && c.severity === "info") continue;
        if (c.ok && c.id === "fee_vault_skipped") continue;
        // Persist failures and warnings only.
        if (c.ok && c.severity !== "warning") continue;
        await query(
          `insert into reconciliation_differences
             (run_id, chain_id, check_id, severity, automatic_action, ok, message, evidence, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'open')`,
          [
            runId,
            chainId,
            c.id,
            c.severity,
            c.automaticAction,
            c.ok,
            c.message,
            JSON.stringify(c.evidence),
          ],
        );
      }
    },

    async applyPause(signal) {
      for (const key of signal.featureFlagKeys) {
        await query(
          `update feature_flags
           set enabled = false,
               updated_at = now(),
               meta = coalesce(meta, '{}'::jsonb) || $2::jsonb
           where key = $1`,
          [
            key,
            JSON.stringify({
              reason: signal.reason,
              pausedAt: new Date().toISOString(),
              incidentTitle: signal.incidentTitle,
            }),
          ],
        );
      }
      // Ensure flag row exists even if seed missing.
      await query(
        `insert into feature_flags (key, enabled, meta)
         values ($1, false, $2::jsonb)
         on conflict (key) do update set
           enabled = false,
           updated_at = now(),
           meta = feature_flags.meta || excluded.meta`,
        [
          PAUSE_FEATURE_FLAG,
          JSON.stringify({
            reason: signal.reason,
            note: "disabled automatically on reconciliation failure",
          }),
        ],
      );
      await query(
        `insert into security_incidents (severity, title, detail, status)
         values ('critical', $1, $2::jsonb, 'open')`,
        [signal.incidentTitle, JSON.stringify(signal.incidentDetail)],
      );
    },
  };
}

export function snapshotArgsFromReport(
  chainId: number,
  vaultUsdcBalance: bigint,
  mirrorAvailableUsdc: number,
  mirrorEscrowUsdc: number,
  report: ReconciliationReport,
) {
  const differenceUsdc = Number(rawToUsdcString(report.lockedSkewRaw));
  return {
    chainId,
    tokenBalanceRaw: vaultUsdcBalance.toString(),
    mirrorAvailableSum: mirrorAvailableUsdc,
    mirrorEscrowSum: mirrorEscrowUsdc,
    differenceUsdc,
    ok: report.ok,
  };
}
