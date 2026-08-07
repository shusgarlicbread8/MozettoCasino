/**
 * Revenue transparency reporting hooks (Plan 11).
 *
 * Distinguishes rake revenue from locked player funds. COGS fields may be null
 * until instrumentation is wired from Anvil → Sepolia → mainnet.
 */

import { computeContribution, type CogsBreakdown, type ContributionResult } from "./contribution.js";

export type RevenueTransparencyInput = {
  /** Sum of settled / accepted hand+session rake (gross). */
  grossRake: bigint;
  /** Refunds / reversals against rake. */
  rakeRefunds?: bigint;
  /** ProtocolFeeVault accrued (awaiting sweep) — USDC raw. */
  feeVaultAccrued?: bigint | null;
  /** Cumulative swept to Treasury Safe (if tracked). */
  treasurySwept?: bigint | null;
  /** Open-session locked player USDC — NOT revenue. */
  lockedPlayerFunds: bigint;
  /** Optional internal COGS; omit / null when not instrumented. */
  cogs?: Partial<CogsBreakdown> | null;
  /** Scope labels for dashboards. */
  scope?: {
    periodRoot?: string | null;
    sessionRange?: string | null;
    league?: string | null;
  };
};

export type RevenueTransparencyReport = {
  readOnly: true;
  /** Explicit guardrail for UI copy. */
  lockedPlayerFundsAreNotRevenue: true;
  season1FeePolicy: "poker_rake_only";
  scheduleStatus: "hypothesis";
  grossRake: bigint;
  netRakeAfterRefunds: bigint;
  aiCogs: bigint | null;
  chainCogs: bigint | null;
  infrastructureCogs: bigint | null;
  protocolContribution: bigint | null;
  feeVaultAccrued: bigint | null;
  treasurySweep: bigint | null;
  lockedPlayerFunds: bigint;
  contribution: ContributionResult | null;
  scope: NonNullable<RevenueTransparencyInput["scope"]>;
  notes: string[];
};

function optBig(v: bigint | null | undefined): bigint | null {
  return v === undefined ? null : v;
}

/**
 * Build a Plan 11 revenue transparency snapshot.
 * Does not invent fee types; poker rake is the only user-visible fee line.
 */
export function buildRevenueTransparencyReport(
  input: RevenueTransparencyInput,
): RevenueTransparencyReport {
  const refunds = input.rakeRefunds ?? 0n;
  const notes: string[] = [
    "Season 1 charges poker rake only — no model, AI performance, token, or compute invoice to players.",
    "Locked player funds are custody liabilities, not platform volume/revenue.",
    "Provisional league rake schedule is hypothesis until GameTemplate + Safe/timelock freeze.",
  ];

  const cogsPartial = input.cogs ?? null;
  const cogsInstrumented =
    cogsPartial != null &&
    cogsPartial.aiCogs != null &&
    cogsPartial.chainCogs != null &&
    cogsPartial.infrastructureCogs != null;

  let contribution: ContributionResult | null = null;
  if (cogsInstrumented) {
    contribution = computeContribution({
      rakeRevenue: input.grossRake,
      rakeRefunds: refunds,
      aiCogs: cogsPartial!.aiCogs!,
      chainCogs: cogsPartial!.chainCogs!,
      infrastructureCogs: cogsPartial!.infrastructureCogs!,
    });
  } else {
    notes.push("COGS not fully instrumented — protocolContribution left null.");
  }

  const net = contribution?.netRake ?? (input.grossRake - refunds < 0n ? 0n : input.grossRake - refunds);

  return {
    readOnly: true,
    lockedPlayerFundsAreNotRevenue: true,
    season1FeePolicy: "poker_rake_only",
    scheduleStatus: "hypothesis",
    grossRake: input.grossRake,
    netRakeAfterRefunds: net,
    aiCogs: contribution?.cogs.aiCogs ?? optBig(cogsPartial?.aiCogs),
    chainCogs: contribution?.cogs.chainCogs ?? optBig(cogsPartial?.chainCogs),
    infrastructureCogs:
      contribution?.cogs.infrastructureCogs ?? optBig(cogsPartial?.infrastructureCogs),
    protocolContribution: contribution?.protocolContribution ?? null,
    feeVaultAccrued: optBig(input.feeVaultAccrued),
    treasurySweep: optBig(input.treasurySwept),
    lockedPlayerFunds: input.lockedPlayerFunds,
    contribution,
    scope: input.scope ?? {},
    notes,
  };
}

/** JSON-safe serialization for admin API responses. */
export function serializeRevenueReport(report: RevenueTransparencyReport) {
  return {
    ...report,
    grossRake: report.grossRake.toString(),
    netRakeAfterRefunds: report.netRakeAfterRefunds.toString(),
    aiCogs: report.aiCogs?.toString() ?? null,
    chainCogs: report.chainCogs?.toString() ?? null,
    infrastructureCogs: report.infrastructureCogs?.toString() ?? null,
    protocolContribution: report.protocolContribution?.toString() ?? null,
    feeVaultAccrued: report.feeVaultAccrued?.toString() ?? null,
    treasurySweep: report.treasurySweep?.toString() ?? null,
    lockedPlayerFunds: report.lockedPlayerFunds.toString(),
    contribution: report.contribution
      ? {
          grossRake: report.contribution.grossRake.toString(),
          netRake: report.contribution.netRake.toString(),
          totalCogs: report.contribution.totalCogs.toString(),
          protocolContribution: report.contribution.protocolContribution.toString(),
          cogs: {
            aiCogs: report.contribution.cogs.aiCogs.toString(),
            chainCogs: report.contribution.cogs.chainCogs.toString(),
            infrastructureCogs: report.contribution.cogs.infrastructureCogs.toString(),
          },
        }
      : null,
  };
}
