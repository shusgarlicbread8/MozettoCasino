/**
 * Plan 11 rake formula + conservation helpers.
 *
 * Season 1 user-visible fee is poker rake only (no AI / model / compute surcharge).
 * Rounding: integer floor toward zero on non-negative chip amounts.
 *
 * Engine state still carries `rakePct` for frozen fixture / state-hash compatibility;
 * convert via {@link rakePctToBps} before applying the bps formula.
 */

export const RAKE_BPS_DENOMINATOR = 10_000 as const;

/** Season 1 recommended cash policy (hypothesis until GameTemplate freeze). */
export const SEASON1_RAKE_ELIGIBILITY = {
  /** No rake when the hand ends before a flop is dealt (fold-win preflop). */
  noFlopNoDrop: true,
  /** Uncalled bets must not contribute to eligible pot (engine gap — see Plan 11 deferrals). */
  excludeUncalledBets: true,
  /** Rake only from settled eligible pots at hand resolution. */
  settledPotsOnly: true,
  /** Side-pot rake: proportional floor across layers; remainder on last layer. */
  sidePotMethod: "proportional_floor_remainder_last" as const,
  rounding: "floor" as const,
} as const;

export type ComputeRakeInput = {
  /** Chips eligible for rake (settled pot pool; ideally after uncalled-bet return). */
  eligiblePot: number;
  /** Basis points (10000 = 100%). */
  rakeBps: number;
  /** Absolute chip cap; null/undefined = uncapped. */
  rakeCap?: number | null;
  /** Non-folded seats with hole cards at resolution. ≤1 ⇒ no rake. */
  liveHands: number;
};

/**
 * Plan 11 formula:
 * `rake = min(floor(eligiblePot × rakeBps / 10_000), rakeCap)`.
 */
export function computeRake(input: ComputeRakeInput): number {
  const { eligiblePot, rakeBps, rakeCap = null, liveHands } = input;
  if (liveHands <= 1 || rakeBps <= 0 || eligiblePot <= 0) return 0;
  let rake = Math.floor((eligiblePot * rakeBps) / RAKE_BPS_DENOMINATOR);
  if (rakeCap != null) rake = Math.min(rake, rakeCap);
  if (rake < 0) return 0;
  return rake;
}

/** Convert fixture/engine `rakePct` (e.g. 0.05) to integer bps (500). */
export function rakePctToBps(rakePct: number): number {
  if (!Number.isFinite(rakePct) || rakePct <= 0) return 0;
  return Math.floor(rakePct * RAKE_BPS_DENOMINATOR + 0.5);
}

/** Inverse helper for display / schedule mapping. */
export function rakeBpsToPct(rakeBps: number): number {
  return rakeBps / RAKE_BPS_DENOMINATOR;
}

/** Convenience when config still uses `rakePct`. */
export function computeRakeFromPct(input: {
  eligiblePot: number;
  rakePct: number;
  rakeCap?: number | null;
  liveHands: number;
}): number {
  return computeRake({
    eligiblePot: input.eligiblePot,
    rakeBps: rakePctToBps(input.rakePct),
    rakeCap: input.rakeCap,
    liveHands: input.liveHands,
  });
}

export type PotLayerAmount = { amount: number };

/**
 * Allocate total hand rake across pot layers (frozen Season 1 method):
 * proportional floor by layer amount; any remainder taken from the last layer.
 * Returns per-layer rake chips (same length as `layers`).
 */
export function allocateSidePotRake(
  layers: readonly PotLayerAmount[],
  totalRake: number,
): number[] {
  if (layers.length === 0) return [];
  if (totalRake <= 0) return layers.map(() => 0);
  const potPool = layers.reduce((n, l) => n + l.amount, 0);
  if (potPool <= 0) return layers.map(() => 0);

  let rakeLeft = totalRake;
  return layers.map((layer, i) => {
    if (i === layers.length - 1) return rakeLeft;
    const lr = Math.floor((layer.amount * totalRake) / potPool);
    rakeLeft -= lr;
    return lr;
  });
}

/** Per-hand conservation: sum(before) == sum(after) + handRake. */
export function checkHandConservation(
  stacksBefore: readonly number[],
  stacksAfter: readonly number[],
  handRake: number,
): boolean {
  const before = stacksBefore.reduce((a, b) => a + b, 0);
  const after = stacksAfter.reduce((a, b) => a + b, 0);
  return before === after + handRake;
}

/** Per-session conservation: starting locked == final payouts + totalRake. */
export function checkSessionConservation(
  startingLocked: number | bigint,
  finalPlayerPayouts: number | bigint,
  totalRake: number | bigint,
): boolean {
  return BigInt(startingLocked) === BigInt(finalPlayerPayouts) + BigInt(totalRake);
}

/** Cap expressed as big-blind multiples → chip units. */
export function rakeCapFromBb(bigBlind: number, bbMultiple: number): number {
  return Math.floor(bigBlind * bbMultiple);
}
