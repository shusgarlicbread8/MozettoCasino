/**
 * Season 1 provisional rake schedule — **hypotheses for simulation**, not automatic
 * mainnet / GameTemplate values (Plan 11).
 *
 * Freeze the final schedule in each GameTemplate after unit-economic and market testing.
 * Activation requires Protocol Safe / timelock + public manifest publication.
 */

import { rakeCapFromBb, rakePctToBps } from "@mozetto/game-rules";

export const SEASON1_SCHEDULE_STATUS = "hypothesis" as const;

export type Season1LeagueId =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond";

export type Season1RakeRow = {
  league: Season1LeagueId;
  /** Basis points (300 = 3.0%). */
  rakeBps: number;
  /** Cap as multiples of big blind. */
  rakeCapBb: number;
  /** Explicit hypothesis label — never treat as production-frozen. */
  status: typeof SEASON1_SCHEDULE_STATUS;
};

/**
 * Plan 11 provisional table.
 * Diamond+ shares the Diamond row until a dedicated league template is published.
 */
export const SEASON1_RAKE_SCHEDULE: readonly Season1RakeRow[] = [
  { league: "bronze", rakeBps: 300, rakeCapBb: 2, status: "hypothesis" },
  { league: "silver", rakeBps: 275, rakeCapBb: 2, status: "hypothesis" },
  { league: "gold", rakeBps: 250, rakeCapBb: 1.5, status: "hypothesis" },
  { league: "platinum", rakeBps: 225, rakeCapBb: 1.25, status: "hypothesis" },
  { league: "diamond", rakeBps: 200, rakeCapBb: 1, status: "hypothesis" },
] as const;

export function season1Row(league: Season1LeagueId): Season1RakeRow {
  const row = SEASON1_RAKE_SCHEDULE.find((r) => r.league === league);
  if (!row) throw new Error(`unknown Season 1 league: ${league}`);
  return row;
}

/** Resolve hypothesis bps + chip cap for a league at a given big blind. */
export function season1RakeParams(
  league: Season1LeagueId,
  bigBlindChips: number,
): { rakeBps: number; rakeCap: number; status: typeof SEASON1_SCHEDULE_STATUS } {
  const row = season1Row(league);
  return {
    rakeBps: row.rakeBps,
    rakeCap: rakeCapFromBb(bigBlindChips, row.rakeCapBb),
    status: SEASON1_SCHEDULE_STATUS,
  };
}

/** Commitment label for docs / templates — not a frozen on-chain policy hash. */
export const RAKE_POLICY_LABEL_HYPOTHESIS = "rake-policy-season1-hypothesis-v1" as const;

/** Sanity: Plan 11 percentages map to the bps table. */
export function assertPlan11PercentTable(): void {
  const expected: Record<Season1LeagueId, number> = {
    bronze: rakePctToBps(0.03),
    silver: rakePctToBps(0.0275),
    gold: rakePctToBps(0.025),
    platinum: rakePctToBps(0.0225),
    diamond: rakePctToBps(0.02),
  };
  for (const row of SEASON1_RAKE_SCHEDULE) {
    if (row.rakeBps !== expected[row.league]) {
      throw new Error(
        `Season 1 hypothesis mismatch for ${row.league}: ${row.rakeBps} vs ${expected[row.league]}`,
      );
    }
  }
}
