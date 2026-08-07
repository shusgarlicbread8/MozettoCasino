/**
 * Plan 12 repeated-opponent rating weight bands.
 * Prefer avoiding the pair in matchmaking (WP-043); weight decay is the backstop.
 *
 * first 5 matches in 24h: full weight
 * matches 6–10: reduced (0.5)
 * beyond: zero (record only, no rating effect)
 */

/** Soft-avoid / full-weight band upper bound (prior settled count before this update). */
export const MAX_PAIR_MATCHES_PER_DAY = 5;

/** Reduced-weight band ends at this prior count (exclusive of zero-weight). */
export const PAIR_REDUCED_WEIGHT_UNTIL = 10;

/**
 * @param priorSettledCount24h Number of settled HU overlaps for the pair in the last 24h
 *   *before* the match currently being rated.
 */
export function repeatedOpponentRatingWeight(priorSettledCount24h: number): number {
  const n = Math.max(0, Math.floor(priorSettledCount24h));
  if (n < MAX_PAIR_MATCHES_PER_DAY) return 1;
  if (n < PAIR_REDUCED_WEIGHT_UNTIL) return 0.5;
  return 0;
}

/** True when matchmaking should soft-avoid this pair (at or past the daily cap). */
export function isPairFrequencyCapped(
  priorSettledCount24h: number,
  cap: number = MAX_PAIR_MATCHES_PER_DAY,
): boolean {
  return Math.max(0, Math.floor(priorSettledCount24h)) >= cap;
}
