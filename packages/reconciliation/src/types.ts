/** Atomic USDC amounts (6 decimals) as bigint. */

export type ChainBalances = {
  /** ArenaVault USDC.balanceOf(vault) / usdcBalance() */
  vaultUsdcBalance: bigint;
  /** ArenaVault.accruedProtocolFees */
  accruedProtocolFees: bigint;
  /** ProtocolFeeVault.usdcBalance(); null if fee vault not configured */
  feeVaultUsdcBalance: bigint | null;
  /** ProtocolFeeVault.accruedFees; null if fee vault not configured */
  feeVaultAccrued: bigint | null;
};

export type MirrorBalances = {
  /**
   * Sum of buy_in_raw for sessions still holding vault liability
   * (status in pending/opened/playing/settling).
   */
  openSessionLockedRaw: bigint;
  /** On-chain ledger mirror: sum of user_available (USDC decimal units). */
  mirrorAvailableUsdc: number;
  /** On-chain ledger mirror: sum of user_table_escrow (USDC decimal units). */
  mirrorEscrowUsdc: number;
};

export type CheckSeverity = "critical" | "warning" | "info";

export type AutomaticAction = "pause_new_sessions" | "none";

export type ReconciliationCheck = {
  id: string;
  ok: boolean;
  severity: CheckSeverity;
  automaticAction: AutomaticAction;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type ReconciliationReport = {
  ok: boolean;
  criticalFailure: boolean;
  checks: ReconciliationCheck[];
  /** vaultUsdcBalance - accruedProtocolFees */
  impliedLockedRaw: bigint;
  /** impliedLockedRaw - openSessionLockedRaw */
  lockedSkewRaw: bigint;
};

export type PauseSignal = {
  reason: "reconciliation_failed";
  /** Feature flags flipped to false */
  featureFlagKeys: string[];
  incidentTitle: string;
  incidentDetail: Record<string, unknown>;
  failedChecks: ReconciliationCheck[];
};

export type ReconcileRunOptions = {
  chainId: number;
  /** Absolute tolerance on raw USDC (default 0). */
  toleranceRaw?: bigint;
  /** Auto-pause on critical failure (caller decides by env). */
  autoPause?: boolean;
};
