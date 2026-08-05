/**
 * Glicko-2 rating system (Glickman, 2013).
 * Display rating uses the standard Glicko scale (≈ Elo); internals use μ/φ/σ.
 *
 * Defaults for Mozetto Arena Rating:
 *   rating 1500, RD 350, volatility 0.06, τ = 0.5
 */

export type GlickoPlayer = {
  rating: number;
  rd: number;
  volatility: number;
};

export type GlickoOpponent = {
  rating: number;
  rd: number;
  /** 1 win, 0.5 draw, 0 loss from the player's perspective */
  score: number;
  /** 0–1 rating weight (repeated-opponent decay, private matches, …) */
  weight?: number;
};

export const GLICKO_DEFAULTS = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  tau: 0.5,
  /** Convert RD → confidence label thresholds (display RD). */
  establishedRd: 80,
  provisionalMatches: 20,
} as const;

const SCALE = 173.7178; // 400 / ln(10)

function toMu(rating: number) {
  return (rating - 1500) / SCALE;
}
function toPhi(rd: number) {
  return rd / SCALE;
}
function fromMu(mu: number) {
  return mu * SCALE + 1500;
}
function fromPhi(phi: number) {
  return phi * SCALE;
}

function g(phi: number) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Update one player against one or more opponents in a single rating period.
 * Weights scale the influence of each result (not part of classic Glicko-2;
 * applied by scaling the outcome contribution in v / delta).
 */
export function updateGlicko2(
  player: GlickoPlayer,
  opponents: GlickoOpponent[],
  opts: { tau?: number } = {},
): GlickoPlayer {
  if (!opponents.length) {
    // Idle period: RD increases (uncertainty grows).
    const phi = toPhi(player.rd);
    const phiStar = Math.sqrt(phi * phi + player.volatility * player.volatility);
    return {
      rating: player.rating,
      rd: Math.min(350, fromPhi(phiStar)),
      volatility: player.volatility,
    };
  }

  const tau = opts.tau ?? GLICKO_DEFAULTS.tau;
  const mu = toMu(player.rating);
  let phi = toPhi(player.rd);
  let sigma = player.volatility;

  let vInv = 0;
  let deltaSum = 0;
  for (const opp of opponents) {
    const w = Math.max(0, Math.min(1, opp.weight ?? 1));
    if (w <= 0) continue;
    const muJ = toMu(opp.rating);
    const phiJ = toPhi(opp.rd);
    const gPhi = g(phiJ);
    const e = E(mu, muJ, phiJ);
    vInv += w * gPhi * gPhi * e * (1 - e);
    deltaSum += w * gPhi * (opp.score - e);
  }
  if (vInv <= 0) {
    return { ...player };
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5 — new volatility via Illinois algorithm (Glickman).
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    B = a - k * tau;
    while (f(B) < 0) {
      k += 1;
      B = a - k * tau;
      if (k > 20) break;
    }
  }

  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 40 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  sigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi2 + sigma * sigma);
  phi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phi * phi * deltaSum;

  return {
    rating: Math.round(fromMu(muPrime) * 100) / 100,
    rd: Math.min(350, Math.round(fromPhi(phi) * 100) / 100),
    volatility: Math.max(0.015, Math.min(0.1, sigma)),
  };
}

/** Pairwise update for a completed HU match (both sides). */
export function rateHeadsUpMatch(
  a: GlickoPlayer,
  b: GlickoPlayer,
  scoreA: 0 | 0.5 | 1,
  weight = 1,
): { a: GlickoPlayer; b: GlickoPlayer } {
  const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
  return {
    a: updateGlicko2(a, [{ rating: b.rating, rd: b.rd, score: scoreA, weight }]),
    b: updateGlicko2(b, [{ rating: a.rating, rd: a.rd, score: scoreB, weight }]),
  };
}

export function confidenceLabel(rd: number, matches: number): "Provisional" | "Developing" | "Established" | "High" {
  if (matches < GLICKO_DEFAULTS.provisionalMatches || rd >= 200) return "Provisional";
  if (rd >= 110 || matches < 50) return "Developing";
  if (rd >= GLICKO_DEFAULTS.establishedRd) return "Established";
  return "High";
}

export function percentileLabel(rating: number, ranksAbove: number, poolSize: number): string {
  if (poolSize <= 1) return "Unranked";
  const pct = Math.max(0.1, Math.min(99.9, (1 - ranksAbove / poolSize) * 100));
  if (pct >= 50) return `Top ${(100 - pct).toFixed(1)}%`;
  return `Bottom ${pct.toFixed(1)}%`;
}

/** Slight RD bump after a major loadout change (model / policy). */
export function bumpRdAfterLoadoutChange(player: GlickoPlayer, bump = 33): GlickoPlayer {
  return {
    ...player,
    rd: Math.min(350, player.rd + bump),
  };
}

export function defaultPlayer(): GlickoPlayer {
  return {
    rating: GLICKO_DEFAULTS.rating,
    rd: GLICKO_DEFAULTS.rd,
    volatility: GLICKO_DEFAULTS.volatility,
  };
}
