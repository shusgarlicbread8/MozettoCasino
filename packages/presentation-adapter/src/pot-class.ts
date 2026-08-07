import type { PotClass } from "./types";

/**
 * Classify pot relative to big blind for presentation sizing.
 * Does not affect rake or settlement.
 */
export function classifyPotClass(opts: {
  pot?: number;
  bigBlind?: number;
  amount?: number;
  /** Force all-in presentation class. */
  isAllIn?: boolean;
}): PotClass {
  if (opts.isAllIn) return "all_in";
  const bb = Number(opts.bigBlind);
  const pot = Number(opts.pot);
  if (!Number.isFinite(bb) || bb <= 0 || !Number.isFinite(pot) || pot < 0) {
    // Fall back to absolute amount tiers when BB unknown.
    const amt = Number(opts.amount);
    if (Number.isFinite(amt) && amt > 0) {
      if (amt < 20) return "micro";
      if (amt < 100) return "small";
      if (amt < 500) return "medium";
      return "large";
    }
    return "small";
  }
  const bbPot = pot / bb;
  if (bbPot < 3) return "micro";
  if (bbPot < 12) return "small";
  if (bbPot < 40) return "medium";
  if (bbPot < 100) return "large";
  return "all_in";
}
