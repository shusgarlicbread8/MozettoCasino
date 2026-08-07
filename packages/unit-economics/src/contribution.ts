/**
 * Internal contribution accounting (Plan 11).
 *
 *   rake revenue − AI COGS − chain COGS − infrastructure COGS
 *     = gross protocol contribution
 *
 * Season 1 has **no** player-facing AI / compute fee — COGS are internal only.
 */

export type CogsBreakdown = {
  /** Provider inference cost (USDC micro-units or accounting units). */
  aiCogs: bigint;
  /** Gas / VRF / proof / settlement amortization. */
  chainCogs: bigint;
  /** Game compute, dealer, DB, Redis, WS, storage, monitoring. */
  infrastructureCogs: bigint;
};

export type ContributionInput = CogsBreakdown & {
  /** Gross rake collected (before refunds/reversals). */
  rakeRevenue: bigint;
  /** Refunds / reversals reducing recognized rake (default 0). */
  rakeRefunds?: bigint;
};

export type ContributionResult = {
  grossRake: bigint;
  netRake: bigint;
  totalCogs: bigint;
  /** netRake − totalCogs (may be negative). */
  protocolContribution: bigint;
  cogs: CogsBreakdown;
};

export function netRake(grossRake: bigint, refunds: bigint = 0n): bigint {
  const n = grossRake - refunds;
  return n < 0n ? 0n : n;
}

export function totalCogs(cogs: CogsBreakdown): bigint {
  return cogs.aiCogs + cogs.chainCogs + cogs.infrastructureCogs;
}

/** Plan 11 contribution identity. */
export function computeContribution(input: ContributionInput): ContributionResult {
  const refunds = input.rakeRefunds ?? 0n;
  const gross = input.rakeRevenue < 0n ? 0n : input.rakeRevenue;
  const net = netRake(gross, refunds);
  const cogs: CogsBreakdown = {
    aiCogs: input.aiCogs,
    chainCogs: input.chainCogs,
    infrastructureCogs: input.infrastructureCogs,
  };
  const cogsSum = totalCogs(cogs);
  return {
    grossRake: gross,
    netRake: net,
    totalCogs: cogsSum,
    protocolContribution: net - cogsSum,
    cogs,
  };
}
