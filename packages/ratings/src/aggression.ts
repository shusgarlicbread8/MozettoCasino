/**
 * Opportunity-adjusted aggression score (0–100).
 * Descriptive only — never feeds into Arena Rating / Glicko-2.
 */

export type AggressionCounts = {
  opportunitiesPreflop: number;
  raisesPreflop: number;
  opportunities3bet: number;
  threeBets: number;
  opportunitiesSteal: number;
  steals: number;
  opportunitiesPostflop: number;
  betsRaisesPostflop: number;
  opportunitiesVsBet: number;
  raisesVsBet: number;
  sizingSamples: number;
  sizingSum: number; // sum of (bet / pot)
  opportunitiesAllin: number;
  allins: number;
  hands: number;
};

export type LeagueMeans = {
  pfr: number;
  threeBet: number;
  steal: number;
  postflop: number;
  raiseVsCall: number;
  sizing: number;
  allin: number;
  /** Population stddevs for z-scores */
  sd: Partial<Record<keyof Omit<LeagueMeans, "sd">, number>>;
};

/** Conservative league priors until enough field data exists. */
export const DEFAULT_LEAGUE: LeagueMeans = {
  pfr: 0.18,
  threeBet: 0.07,
  steal: 0.28,
  postflop: 0.42,
  raiseVsCall: 0.12,
  sizing: 0.65,
  allin: 0.04,
  sd: {
    pfr: 0.08,
    threeBet: 0.04,
    steal: 0.12,
    postflop: 0.12,
    raiseVsCall: 0.06,
    sizing: 0.2,
    allin: 0.03,
  },
};

const PRIOR_K = 500;

function rate(num: number, den: number) {
  if (den <= 0) return null;
  return num / den;
}

/** Bayesian shrink toward league mean. */
export function shrink(observed: number | null, n: number, league: number, k = PRIOR_K) {
  if (observed == null || n <= 0) return league;
  return (n / (n + k)) * observed + (k / (n + k)) * league;
}

function z(value: number, mean: number, sd: number) {
  if (sd <= 0) return 0;
  return (value - mean) / sd;
}

function sigmoid01(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export function computeAggression(
  counts: AggressionCounts,
  league: LeagueMeans = DEFAULT_LEAGUE,
): {
  aggression: number;
  preflopPressure: number;
  postflopPressure: number;
  betSizingIntensity: number;
  volatilityScore: number;
  sampleLabel: "Provisional" | "Developing" | "Established" | "High confidence";
} {
  const pfr = shrink(rate(counts.raisesPreflop, counts.opportunitiesPreflop), counts.opportunitiesPreflop, league.pfr);
  const three = shrink(rate(counts.threeBets, counts.opportunities3bet), counts.opportunities3bet, league.threeBet);
  const steal = shrink(rate(counts.steals, counts.opportunitiesSteal), counts.opportunitiesSteal, league.steal);
  const post = shrink(
    rate(counts.betsRaisesPostflop, counts.opportunitiesPostflop),
    counts.opportunitiesPostflop,
    league.postflop,
  );
  const rvc = shrink(rate(counts.raisesVsBet, counts.opportunitiesVsBet), counts.opportunitiesVsBet, league.raiseVsCall);
  const sizing = shrink(
    counts.sizingSamples > 0 ? counts.sizingSum / counts.sizingSamples : null,
    counts.sizingSamples,
    league.sizing,
  );
  const allin = shrink(rate(counts.allins, counts.opportunitiesAllin), counts.opportunitiesAllin, league.allin);

  const raw =
    0.2 * z(pfr, league.pfr, league.sd.pfr ?? 0.08) +
    0.15 * z(three, league.threeBet, league.sd.threeBet ?? 0.04) +
    0.1 * z(steal, league.steal, league.sd.steal ?? 0.12) +
    0.25 * z(post, league.postflop, league.sd.postflop ?? 0.12) +
    0.15 * z(rvc, league.raiseVsCall, league.sd.raiseVsCall ?? 0.06) +
    0.1 * z(sizing, league.sizing, league.sd.sizing ?? 0.2) +
    0.05 * z(allin, league.allin, league.sd.allin ?? 0.03);

  const aggression = Math.round(100 * sigmoid01(raw) * 10) / 10;
  const preflopPressure = Math.round(100 * sigmoid01(0.55 * z(pfr, league.pfr, league.sd.pfr ?? 0.08) + 0.45 * z(three, league.threeBet, league.sd.threeBet ?? 0.04)) * 10) / 10;
  const postflopPressure = Math.round(100 * sigmoid01(z(post, league.postflop, league.sd.postflop ?? 0.12)) * 10) / 10;
  const betSizingIntensity = Math.round(100 * sigmoid01(z(sizing, league.sizing, league.sd.sizing ?? 0.2)) * 10) / 10;
  // Volatility proxy: mix of all-in rate + sizing extremity.
  const volatilityScore =
    Math.round(100 * sigmoid01(0.6 * z(allin, league.allin, league.sd.allin ?? 0.03) + 0.4 * z(sizing, league.sizing, league.sd.sizing ?? 0.2)) * 10) / 10;

  const hands = counts.hands;
  const sampleLabel =
    hands < 200 ? "Provisional" : hands < 2000 ? "Developing" : hands < 10000 ? "Established" : "High confidence";

  return { aggression, preflopPressure, postflopPressure, betSizingIntensity, volatilityScore, sampleLabel };
}

/** Map active AI profile key → baseline flavour when sample is thin. */
export function profileKeyBaseline(profileKey: string | null | undefined): Partial<AggressionCounts> {
  switch ((profileKey || "machine").toLowerCase()) {
    case "shark":
      return { raisesPreflop: 28, opportunitiesPreflop: 100, betsRaisesPostflop: 55, opportunitiesPostflop: 100, threeBets: 12, opportunities3bet: 80 };
    case "fox":
      return { raisesPreflop: 22, opportunitiesPreflop: 100, betsRaisesPostflop: 48, opportunitiesPostflop: 100, threeBets: 9, opportunities3bet: 80 };
    case "professor":
      return { raisesPreflop: 16, opportunitiesPreflop: 100, betsRaisesPostflop: 35, opportunitiesPostflop: 100, threeBets: 6, opportunities3bet: 80 };
    case "machine":
    default:
      return { raisesPreflop: 18, opportunitiesPreflop: 100, betsRaisesPostflop: 40, opportunitiesPostflop: 100, threeBets: 7, opportunities3bet: 80 };
  }
}

export function emptyCounts(): AggressionCounts {
  return {
    opportunitiesPreflop: 0,
    raisesPreflop: 0,
    opportunities3bet: 0,
    threeBets: 0,
    opportunitiesSteal: 0,
    steals: 0,
    opportunitiesPostflop: 0,
    betsRaisesPostflop: 0,
    opportunitiesVsBet: 0,
    raisesVsBet: 0,
    sizingSamples: 0,
    sizingSum: 0,
    opportunitiesAllin: 0,
    allins: 0,
    hands: 0,
  };
}

export function mergeCounts(a: AggressionCounts, b: Partial<AggressionCounts>): AggressionCounts {
  return {
    opportunitiesPreflop: a.opportunitiesPreflop + (b.opportunitiesPreflop ?? 0),
    raisesPreflop: a.raisesPreflop + (b.raisesPreflop ?? 0),
    opportunities3bet: a.opportunities3bet + (b.opportunities3bet ?? 0),
    threeBets: a.threeBets + (b.threeBets ?? 0),
    opportunitiesSteal: a.opportunitiesSteal + (b.opportunitiesSteal ?? 0),
    steals: a.steals + (b.steals ?? 0),
    opportunitiesPostflop: a.opportunitiesPostflop + (b.opportunitiesPostflop ?? 0),
    betsRaisesPostflop: a.betsRaisesPostflop + (b.betsRaisesPostflop ?? 0),
    opportunitiesVsBet: a.opportunitiesVsBet + (b.opportunitiesVsBet ?? 0),
    raisesVsBet: a.raisesVsBet + (b.raisesVsBet ?? 0),
    sizingSamples: a.sizingSamples + (b.sizingSamples ?? 0),
    sizingSum: a.sizingSum + (b.sizingSum ?? 0),
    opportunitiesAllin: a.opportunitiesAllin + (b.opportunitiesAllin ?? 0),
    allins: a.allins + (b.allins ?? 0),
    hands: a.hands + (b.hands ?? 0),
  };
}
