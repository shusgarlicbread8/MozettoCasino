import { rawToUsdcString } from "./compare.js";
import type {
  ChainBalances,
  MirrorBalances,
  ReconciliationCheck,
  ReconciliationReport,
} from "./types.js";

/** JSON-safe check (bigints → decimal strings). */
export function serializeCheck(check: ReconciliationCheck) {
  return {
    id: check.id,
    ok: check.ok,
    severity: check.severity,
    automaticAction: check.automaticAction,
    message: check.message,
    evidence: check.evidence,
  };
}

export function serializeReport(report: ReconciliationReport) {
  return {
    ok: report.ok,
    criticalFailure: report.criticalFailure,
    impliedLockedRaw: report.impliedLockedRaw.toString(),
    impliedLockedUsdc: rawToUsdcString(report.impliedLockedRaw),
    lockedSkewRaw: report.lockedSkewRaw.toString(),
    lockedSkewUsdc: rawToUsdcString(report.lockedSkewRaw),
    checks: report.checks.map(serializeCheck),
  };
}

export function serializeChainBalances(chain: ChainBalances) {
  return {
    vaultUsdcBalanceRaw: chain.vaultUsdcBalance.toString(),
    vaultUsdcBalanceUsdc: rawToUsdcString(chain.vaultUsdcBalance),
    accruedProtocolFeesRaw: chain.accruedProtocolFees.toString(),
    accruedProtocolFeesUsdc: rawToUsdcString(chain.accruedProtocolFees),
    feeVaultUsdcBalanceRaw: chain.feeVaultUsdcBalance?.toString() ?? null,
    feeVaultUsdcBalanceUsdc:
      chain.feeVaultUsdcBalance != null ? rawToUsdcString(chain.feeVaultUsdcBalance) : null,
    feeVaultAccruedRaw: chain.feeVaultAccrued?.toString() ?? null,
    feeVaultAccruedUsdc:
      chain.feeVaultAccrued != null ? rawToUsdcString(chain.feeVaultAccrued) : null,
  };
}

export function serializeMirrorBalances(mirror: MirrorBalances) {
  return {
    openSessionLockedRaw: mirror.openSessionLockedRaw.toString(),
    openSessionLockedUsdc: rawToUsdcString(mirror.openSessionLockedRaw),
    mirrorAvailableUsdc: mirror.mirrorAvailableUsdc,
    mirrorEscrowUsdc: mirror.mirrorEscrowUsdc,
    mirrorLedgerTotalUsdc: mirror.mirrorAvailableUsdc + mirror.mirrorEscrowUsdc,
  };
}

/**
 * Explicit solvency banner for ops UI (Plan 13).
 * Unavailable when live compare could not run; insolvent on critical failure.
 */
export function solvencyStatusLabel(input: {
  liveOk: boolean | null;
  criticalFailure: boolean;
  rpcError?: string | null;
}): "PROTOCOL SOLVENT" | "PROTOCOL INSOLVENT" | "UNAVAILABLE" {
  if (input.rpcError || input.liveOk === null) return "UNAVAILABLE";
  if (input.criticalFailure || input.liveOk === false) return "PROTOCOL INSOLVENT";
  return "PROTOCOL SOLVENT";
}
