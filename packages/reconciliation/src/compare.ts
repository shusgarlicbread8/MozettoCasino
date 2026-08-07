import type {
  ChainBalances,
  MirrorBalances,
  ReconciliationCheck,
  ReconciliationReport,
} from "./types.js";

const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;

/** Convert decimal USDC (ledger float) to atomic raw with floor. */
export function usdcToRaw(usdc: number): bigint {
  if (!Number.isFinite(usdc)) return 0n;
  // Avoid float drift for typical ledger magnitudes by fixed-point string path.
  const sign = usdc < 0 ? -1n : 1n;
  const abs = Math.abs(usdc);
  const [whole, frac = ""] = abs.toFixed(6).split(".");
  const fracPad = (frac + "000000").slice(0, 6);
  return sign * (BigInt(whole) * ONE_USDC + BigInt(fracPad));
}

export function rawToUsdcString(raw: bigint): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const whole = abs / ONE_USDC;
  const frac = (abs % ONE_USDC).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function withinTolerance(a: bigint, b: bigint, toleranceRaw: bigint): boolean {
  const d = a > b ? a - b : b - a;
  return d <= toleranceRaw;
}

/**
 * Plan 03 solvency + fee-vault coverage.
 * Never mutates balances — compare only.
 */
export function compareBalances(
  chain: ChainBalances,
  mirror: MirrorBalances,
  toleranceRaw: bigint = 0n,
): ReconciliationReport {
  const checks: ReconciliationCheck[] = [];
  const impliedLockedRaw = chain.vaultUsdcBalance - chain.accruedProtocolFees;
  const lockedSkewRaw = impliedLockedRaw - mirror.openSessionLockedRaw;

  // 1) Fees cannot exceed vault USDC.
  {
    const ok = chain.accruedProtocolFees <= chain.vaultUsdcBalance;
    checks.push({
      id: "vault_fees_covered",
      ok,
      severity: "critical",
      automaticAction: ok ? "none" : "pause_new_sessions",
      message: ok
        ? "accruedProtocolFees ≤ vault USDC balance"
        : "accruedProtocolFees exceeds vault USDC balance",
      evidence: {
        vaultUsdcBalance: chain.vaultUsdcBalance.toString(),
        accruedProtocolFees: chain.accruedProtocolFees.toString(),
        vaultUsdc: rawToUsdcString(chain.vaultUsdcBalance),
        accruedFeesUsdc: rawToUsdcString(chain.accruedProtocolFees),
      },
    });
  }

  // 2) Core equality: vault USDC == open session liabilities + accrued fees.
  {
    const expected = mirror.openSessionLockedRaw + chain.accruedProtocolFees;
    const ok = withinTolerance(chain.vaultUsdcBalance, expected, toleranceRaw);
    checks.push({
      id: "vault_vs_session_liabilities",
      ok,
      severity: "critical",
      automaticAction: ok ? "none" : "pause_new_sessions",
      message: ok
        ? "vault USDC == open-session locked + accruedProtocolFees"
        : "vault USDC diverges from open-session liabilities + accrued fees",
      evidence: {
        vaultUsdcBalance: chain.vaultUsdcBalance.toString(),
        openSessionLockedRaw: mirror.openSessionLockedRaw.toString(),
        accruedProtocolFees: chain.accruedProtocolFees.toString(),
        expectedRaw: expected.toString(),
        skewRaw: (chain.vaultUsdcBalance - expected).toString(),
        vaultUsdc: rawToUsdcString(chain.vaultUsdcBalance),
        openSessionLockedUsdc: rawToUsdcString(mirror.openSessionLockedRaw),
        expectedUsdc: rawToUsdcString(expected),
        skewUsdc: rawToUsdcString(chain.vaultUsdcBalance - expected),
        toleranceRaw: toleranceRaw.toString(),
      },
    });
  }

  // 3) Implied locked matches session projection (same as #2 rearranged).
  {
    const ok = withinTolerance(impliedLockedRaw, mirror.openSessionLockedRaw, toleranceRaw);
    checks.push({
      id: "implied_locked_vs_mirror",
      ok,
      severity: "critical",
      automaticAction: ok ? "none" : "pause_new_sessions",
      message: ok
        ? "implied locked (vault − fees) matches open-session buy-in sum"
        : "implied locked diverges from DB open-session buy-in sum",
      evidence: {
        impliedLockedRaw: impliedLockedRaw.toString(),
        openSessionLockedRaw: mirror.openSessionLockedRaw.toString(),
        lockedSkewRaw: lockedSkewRaw.toString(),
        impliedLockedUsdc: rawToUsdcString(impliedLockedRaw),
        openSessionLockedUsdc: rawToUsdcString(mirror.openSessionLockedRaw),
        lockedSkewUsdc: rawToUsdcString(lockedSkewRaw),
      },
    });
  }

  // 4) ProtocolFeeVault: accrued ≤ balance (critical when configured).
  if (chain.feeVaultUsdcBalance != null && chain.feeVaultAccrued != null) {
    const ok = chain.feeVaultAccrued <= chain.feeVaultUsdcBalance;
    checks.push({
      id: "fee_vault_accrued_le_balance",
      ok,
      severity: "critical",
      automaticAction: ok ? "none" : "pause_new_sessions",
      message: ok
        ? "ProtocolFeeVault accruedFees ≤ USDC balance"
        : "ProtocolFeeVault accruedFees exceeds USDC balance",
      evidence: {
        feeVaultAccrued: chain.feeVaultAccrued.toString(),
        feeVaultUsdcBalance: chain.feeVaultUsdcBalance.toString(),
        feeVaultAccruedUsdc: rawToUsdcString(chain.feeVaultAccrued),
        feeVaultUsdc: rawToUsdcString(chain.feeVaultUsdcBalance),
      },
    });

    // 5) Fee-only vault: prefer equality (donation → warning, not pause).
    const equal = chain.feeVaultAccrued === chain.feeVaultUsdcBalance;
    checks.push({
      id: "fee_vault_no_stray_principal",
      ok: equal,
      severity: "warning",
      automaticAction: "none",
      message: equal
        ? "ProtocolFeeVault accruedFees == USDC balance (fee-only)"
        : "ProtocolFeeVault USDC ≠ accruedFees (possible donation; investigate, do not mint/patch)",
      evidence: {
        feeVaultAccrued: chain.feeVaultAccrued.toString(),
        feeVaultUsdcBalance: chain.feeVaultUsdcBalance.toString(),
        strayRaw: (chain.feeVaultUsdcBalance - chain.feeVaultAccrued).toString(),
      },
    });
  } else {
    checks.push({
      id: "fee_vault_skipped",
      ok: true,
      severity: "info",
      automaticAction: "none",
      message: "ProtocolFeeVault not configured — fee-vault checks skipped",
      evidence: { feeVaultConfigured: false },
    });
  }

  // 6) Informational: ledger available/escrow mirrors (not vault solvency equality on V2).
  {
    const mirrorTotal = mirror.mirrorAvailableUsdc + mirror.mirrorEscrowUsdc;
    checks.push({
      id: "ledger_mirror_totals",
      ok: true,
      severity: "info",
      automaticAction: "none",
      message:
        "Indexer ledger mirrors recorded for ops (V2 idle funds live in ArenaAccounts; vault holds locks+fees only)",
      evidence: {
        mirrorAvailableUsdc: mirror.mirrorAvailableUsdc,
        mirrorEscrowUsdc: mirror.mirrorEscrowUsdc,
        mirrorTotalUsdc: mirrorTotal,
        mirrorAvailableRaw: usdcToRaw(mirror.mirrorAvailableUsdc).toString(),
        mirrorEscrowRaw: usdcToRaw(mirror.mirrorEscrowUsdc).toString(),
      },
    });
  }

  const criticalFailure = checks.some((c) => !c.ok && c.severity === "critical");
  const ok = !criticalFailure;

  return {
    ok,
    criticalFailure,
    checks,
    impliedLockedRaw,
    lockedSkewRaw,
  };
}
