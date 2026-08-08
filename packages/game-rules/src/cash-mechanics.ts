/**
 * Season 1 cash-table mechanics freeze.
 *
 * Unsupported rules are explicitly OFF — callers must not invent silent
 * defaults for straddles, antes, or run-it-twice.
 */

export const SEASON1_CASH_MECHANICS = {
  game: "NLHE",
  antes: false,
  straddles: false,
  runItTwice: false,
  bombPots: false,
  insurance: false,
  /** Buy-in band in big blinds. */
  minBuyInBb: 40,
  maxBuyInBb: 100,
  /**
   * Returning from sit-out: wait for the big blind before being dealt in again.
   * (Does not post missed blinds; does not get a free hand mid-orbit.)
   */
  sitOutReturnPolicy: "wait_for_big_blind" as const,
} as const;

export type Season1CashMechanics = typeof SEASON1_CASH_MECHANICS;

/** Reject requests for mechanics that are not offered in Season 1. */
export function assertSeason1MechanicAllowed(
  flag: keyof typeof SEASON1_CASH_MECHANICS,
): void {
  const value = SEASON1_CASH_MECHANICS[flag];
  if (value === false) {
    throw new Error(`Season 1 cash tables do not support ${String(flag)}`);
  }
}
