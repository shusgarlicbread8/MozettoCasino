/**
 * Plan 11 rake formula + conservation helpers.
 *
 * Season 1 user-visible fee is poker rake only (no AI / model / compute surcharge).
 * Rounding: integer floor toward zero on non-negative chip amounts.
 *
 * NLHE_ENGINE_RC1: stacks receive NET awards (gross − rake share) at hand settle.
 * Session rake accumulates separately; opening funds = stacks + sessionRake.
 */

import { asChips, type Chips } from "./money.js";

export const RAKE_BPS_DENOMINATOR = 10_000 as const;

/** Season 1 recommended cash policy (hypothesis until GameTemplate freeze). */
export const SEASON1_RAKE_ELIGIBILITY = {
  /** No rake when the hand ends before a flop is dealt (fold-win preflop). */
  noFlopNoDrop: true,
  /** Uncalled bets must not contribute to eligible pot (returned before rake). */
  excludeUncalledBets: true,
  /** Rake assessed from settled eligible pots at hand resolution. */
  settledPotsOnly: true,
  /**
   * Stacks are credited with net awards at hand resolution.
   * `grossAwards` / `netAwards` remain on HAND_SETTLED for replay.
   */
  netOnAward: true,
  /** Rake is removed from stacks at hand settle — not deferred to leave. */
  collectAtSessionSettle: false,
  /** Side-pot rake: proportional floor across layers; remainder on last layer. */
  sidePotMethod: "proportional_floor_remainder_last" as const,
  rounding: "floor" as const,
} as const;

export type ComputeRakeInput = {
  /** Chips eligible for rake (settled pot pool after uncalled-bet return). */
  eligiblePot: number | bigint;
  /** Basis points (10000 = 100%). */
  rakeBps: number;
  /** Absolute chip cap; null/undefined = uncapped. */
  rakeCap?: number | bigint | null;
  liveHands: number;
  endedBeforeFlop?: boolean;
};

/**
 * Plan 11 formula:
 * `rake = min(floor(eligiblePot × rakeBps / 10_000), rakeCap)`.
 */
export function computeRake(input: ComputeRakeInput): Chips {
  const eligiblePot = asChips(input.eligiblePot);
  const { rakeBps, liveHands, endedBeforeFlop } = input;
  if (rakeBps <= 0 || eligiblePot <= 0n) return 0n;
  if (endedBeforeFlop === true) return 0n;
  if (endedBeforeFlop !== false && liveHands <= 1) return 0n;
  let rake = (eligiblePot * BigInt(rakeBps)) / BigInt(RAKE_BPS_DENOMINATOR);
  if (input.rakeCap != null) {
    const cap = asChips(input.rakeCap);
    if (rake > cap) rake = cap;
  }
  if (rake < 0n) return 0n;
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
  eligiblePot: number | bigint;
  rakePct: number;
  rakeCap?: number | bigint | null;
  liveHands: number;
  endedBeforeFlop?: boolean;
}): Chips {
  return computeRake({
    eligiblePot: input.eligiblePot,
    rakeBps: rakePctToBps(input.rakePct),
    rakeCap: input.rakeCap,
    liveHands: input.liveHands,
    endedBeforeFlop: input.endedBeforeFlop,
  });
}

/**
 * Uncalled portion of the sole survivor's street bet (TDA / Plan 11).
 */
export function uncalledBetAmount(
  seats: readonly { seatIndex: number; bet: number | bigint; folded: boolean }[],
  winnerSeatIndex: number,
): Chips {
  const winner = seats.find((s) => s.seatIndex === winnerSeatIndex);
  if (!winner) return 0n;
  const winnerBet = asChips(winner.bet);
  if (winnerBet <= 0n) return 0n;
  let maxOther = 0n;
  for (const s of seats) {
    if (s.seatIndex === winnerSeatIndex) continue;
    const b = asChips(s.bet);
    if (b > maxOther) maxOther = b;
  }
  const excess = winnerBet - maxOther;
  return excess > 0n ? excess : 0n;
}

export type PotLayerAmount = { amount: number | bigint };

/**
 * Allocate total hand rake across pot layers:
 * proportional floor by layer amount; remainder from the last layer.
 */
export function allocateSidePotRake(
  layers: readonly PotLayerAmount[],
  totalRake: number | bigint,
): Chips[] {
  if (layers.length === 0) return [];
  const rake = asChips(totalRake);
  if (rake <= 0n) return layers.map(() => 0n);
  const potPool = layers.reduce((n, l) => n + asChips(l.amount), 0n);
  if (potPool <= 0n) return layers.map(() => 0n);

  let rakeLeft = rake;
  return layers.map((layer, i) => {
    if (i === layers.length - 1) return rakeLeft;
    const lr = (asChips(layer.amount) * rake) / potPool;
    rakeLeft -= lr;
    return lr;
  });
}

/**
 * Allocate assessed hand rake across pot winners (equal split; odd chip
 * to first winner after the button).
 */
export function allocateRakeAmongWinners(
  winnerSeatIndexes: readonly number[],
  handRake: number | bigint,
  button: number,
  seatCount: number,
): { seatIndex: number; amount: Chips }[] {
  const rake = asChips(handRake);
  if (rake <= 0n || winnerSeatIndexes.length === 0 || seatCount <= 0) return [];
  const unique = [...new Set(winnerSeatIndexes)];
  const buttonOrder: number[] = [];
  for (let i = 1; i <= seatCount; i++) buttonOrder.push((button + i) % seatCount);
  unique.sort((a, b) => buttonOrder.indexOf(a) - buttonOrder.indexOf(b));
  const n = BigInt(unique.length);
  const share = rake / n;
  let rem = rake - share * n;
  return unique.map((seatIndex) => {
    const amount = share + (rem > 0n ? 1n : 0n);
    if (rem > 0n) rem -= 1n;
    return { seatIndex, amount };
  });
}

/**
 * Net-stack hand conservation:
 * `sum(before) == sum(afterNet) + handRake`.
 */
export function checkHandConservation(
  stacksBefore: readonly (number | bigint)[],
  stacksAfter: readonly (number | bigint)[],
  handRake: number | bigint,
): boolean {
  const before = stacksBefore.reduce<Chips>((a, b) => a + asChips(b), 0n);
  const after = stacksAfter.reduce<Chips>((a, b) => a + asChips(b), 0n);
  return before === after + asChips(handRake);
}

/** @deprecated Alias — net accounting makes clawback unnecessary. */
export const checkHandConservationAfterClawback = checkHandConservation;

/**
 * @deprecated Net-on-award: rake is already removed from stacks.
 * Kept for session result display when tabs were assessed historically.
 */
export function collectibleRakeFromProfit(
  _stack: number | bigint,
  _buyIn: number | bigint | null | undefined,
  _rakeOwed: number | bigint,
): Chips {
  return 0n;
}

/**
 * Fees to show on Match Result: under net stacks, platform fee for a seat
 * is the rake share already taken from their awards (session-level sum).
 */
export function platformFeesForSessionPlayer(input: {
  assessedTabs: number | bigint;
  buyIn: number | bigint;
  cashOut: number | bigint;
}): number {
  const assessed = Number(asChips(input.assessedTabs));
  const buyIn = Number(asChips(input.buyIn));
  const cashOut = Number(asChips(input.cashOut));
  if (!(assessed > 0) || !Number.isFinite(buyIn) || !Number.isFinite(cashOut)) return 0;
  if (cashOut <= buyIn) return 0;
  return assessed;
}

/** Per-session conservation: starting locked == final payouts + totalRake. */
export function checkSessionConservation(
  startingLocked: number | bigint,
  finalPlayerPayouts: number | bigint,
  totalRake: number | bigint,
): boolean {
  return asChips(startingLocked) === asChips(finalPlayerPayouts) + asChips(totalRake);
}

/**
 * Cap from milli-big-blinds (1500 = 1.5 BB). Pure integer — never floors via dollars.
 * Example: bb=50 chips ($0.50), milliBB=1500 → 75 chips.
 */
export function rakeCapFromMilliBb(bigBlindChips: number | bigint, milliBB: number): Chips {
  if (!Number.isFinite(milliBB) || milliBB <= 0) return 0n;
  return (asChips(bigBlindChips) * BigInt(Math.floor(milliBB))) / 1000n;
}

/**
 * Cap from BB multiple. Prefer {@link rakeCapFromMilliBb} for fractional multiples.
 * `bbMultiple` of 1.5 uses milliBB = 1500 under the hood.
 */
export function rakeCapFromBb(bigBlind: number | bigint, bbMultiple: number): Chips {
  if (!Number.isFinite(bbMultiple) || bbMultiple <= 0) return 0n;
  const milli = Math.round(bbMultiple * 1000);
  return rakeCapFromMilliBb(bigBlind, milli);
}
