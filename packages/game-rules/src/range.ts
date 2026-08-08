/**
 * Preflop range engine — deterministic opponent-range modelling.
 *
 * Purpose: the strategist (Groq) must never invent a range or an equity number.
 * This module produces an explicit weighted distribution over the 169 starting
 * hand classes, narrows it from observed public actions, and exposes enough
 * structure for `computeEquityVsRange` to sample from it with card removal.
 *
 * Everything here is public-evidence only: observed actions, positions, and
 * sizings. Opponent hole cards are never an input.
 */

import type { Card } from "@mozetto/shared-types";
import { cardKey, rankValue } from "./cards.js";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const SUITS = ["c", "d", "h", "s"] as const;

/** Canonical 169-class label, e.g. "AA", "AKs", "AKo". */
export type HandClass = string;

/**
 * Weighted distribution over hand classes. Weight is the fraction of that
 * class's combos the opponent is assumed to hold here (0..1).
 */
export type RangeDistribution = {
  /** Class label → weight in [0,1]. Classes at weight 0 are omitted. */
  weights: Record<HandClass, number>;
  /** Short human/audit label describing how this range was derived. */
  label: string;
  /**
   * How much to trust this range, 0..1. Falls as we stack more inference
   * on top of fewer observations. Never presented as a hard fact.
   */
  confidence: number;
  /** Ordered evidence trail — the actions that produced this range. */
  evidence: string[];
};

/** Combos per class before card removal: pairs 6, suited 4, offsuit 12. */
export function comboCount(hc: HandClass): number {
  if (hc.length === 2) return 6;
  return hc.endsWith("s") ? 4 : 12;
}

/** All 169 starting-hand classes, in no particular order. */
export function allHandClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let i = RANKS.length - 1; i >= 0; i--) {
    for (let j = RANKS.length - 1; j >= 0; j--) {
      const hi = RANKS[Math.max(i, j)]!;
      const lo = RANKS[Math.min(i, j)]!;
      if (i === j) {
        out.push(`${hi}${lo}`);
      } else if (i > j) {
        out.push(`${hi}${lo}s`);
      } else {
        out.push(`${hi}${lo}o`);
      }
    }
  }
  return out;
}

/** Class label for two concrete cards. */
export function handClassOf(hole: Card[]): HandClass {
  if (hole.length < 2) return "";
  const [a, b] = [...hole].sort((x, y) => rankValue(y.rank) - rankValue(x.rank));
  if (a!.rank === b!.rank) return `${a!.rank}${b!.rank}`;
  return `${a!.rank}${b!.rank}${a!.suit === b!.suit ? "s" : "o"}`;
}

/**
 * Chen formula strength score — a published, compact preflop ranking heuristic.
 * Used only to *order* classes when slicing a "top X%" opening range; it is
 * never reported as an equity or EV number.
 */
export function chenScore(hc: HandClass): number {
  const hiRank = hc[0] as Card["rank"];
  const loRank = hc[1] as Card["rank"];
  const hi = rankValue(hiRank);
  const lo = rankValue(loRank);
  const suited = hc.endsWith("s");
  const isPair = hc.length === 2;

  const highCardPoints = (r: number): number => {
    if (r === 14) return 10;
    if (r === 13) return 8;
    if (r === 12) return 7;
    if (r === 11) return 6;
    return r / 2;
  };

  let score: number;
  if (isPair) {
    score = Math.max(5, highCardPoints(hi) * 2);
  } else {
    score = highCardPoints(Math.max(hi, lo));
    if (suited) score += 2;
    const gap = Math.abs(hi - lo) - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    // Straight bonus: connected/one-gap and both below Q.
    if (gap <= 1 && hi < 12 && lo < 12) score += 1;
  }
  return Math.ceil(score * 2) / 2;
}

/** Classes ordered strongest → weakest, with deterministic tie-breaks. */
export function rankedHandClasses(): HandClass[] {
  return allHandClasses().sort((a, b) => {
    const d = chenScore(b) - chenScore(a);
    if (d !== 0) return d;
    // Tie-break: pairs first, then suited, then by high card, then low card.
    const pa = a.length === 2 ? 1 : 0;
    const pb = b.length === 2 ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const sa = a.endsWith("s") ? 1 : 0;
    const sb = b.endsWith("s") ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const ha = rankValue(a[0] as Card["rank"]);
    const hb = rankValue(b[0] as Card["rank"]);
    if (ha !== hb) return hb - ha;
    return rankValue(b[1] as Card["rank"]) - rankValue(a[1] as Card["rank"]);
  });
}

const TOTAL_COMBOS = 1326;

/**
 * Top `pct` of all starting hands by Chen order, as a weighted distribution.
 * The boundary class gets a fractional weight so the range is exactly `pct`
 * wide rather than rounded to a class edge.
 */
export function topPercentRange(pct: number, label?: string): RangeDistribution {
  const target = Math.max(0, Math.min(1, pct)) * TOTAL_COMBOS;
  const weights: Record<HandClass, number> = {};
  let used = 0;
  for (const hc of rankedHandClasses()) {
    if (used >= target) break;
    const combos = comboCount(hc);
    const take = Math.min(combos, target - used);
    const w = take / combos;
    if (w > 0.0001) weights[hc] = Math.round(w * 1000) / 1000;
    used += take;
  }
  return {
    weights,
    label: label ?? `top ${(Math.max(0, Math.min(1, pct)) * 100).toFixed(0)}%`,
    confidence: 0.5,
    evidence: [],
  };
}

/** Fraction of all 1326 combos this distribution covers. */
export function rangeWidth(range: RangeDistribution): number {
  let combos = 0;
  for (const [hc, w] of Object.entries(range.weights)) combos += comboCount(hc) * w;
  return combos / TOTAL_COMBOS;
}

/**
 * Default opening frequency by seat position, as a fraction of all hands.
 * Season 1 baseline priors — replaced by observed frequencies as soon as an
 * opponent has enough hands (see `openingRangeFor`).
 */
export const DEFAULT_OPEN_PCT: Readonly<Record<PositionLabel, number>> = {
  BTN: 0.45,
  CO: 0.28,
  MP: 0.19,
  EP: 0.14,
  SB: 0.4,
  BB: 0.35,
};

export type PositionLabel = "BTN" | "CO" | "MP" | "EP" | "SB" | "BB";

/**
 * Opening range for a position, optionally overridden by an observed open
 * frequency. `observedOpenPct` should come from persistent opponent stats;
 * when it is present the range is widened/narrowed to match what this specific
 * opponent actually does, and confidence rises with sample size.
 */
export function openingRangeFor(input: {
  position: PositionLabel;
  observedOpenPct?: number | null;
  handsObserved?: number;
}): RangeDistribution {
  const prior = DEFAULT_OPEN_PCT[input.position];
  const observed =
    input.observedOpenPct != null && Number.isFinite(input.observedOpenPct)
      ? Math.max(0.02, Math.min(0.95, input.observedOpenPct))
      : null;
  const n = Math.max(0, input.handsObserved ?? 0);
  // Shrink observed frequency toward the positional prior until we have data.
  // 30 hands ≈ half weight on observation.
  const trust = observed == null ? 0 : n / (n + 30);
  const pct = observed == null ? prior : prior * (1 - trust) + observed * trust;

  const range = topPercentRange(pct, `${input.position} open ${(pct * 100).toFixed(0)}%`);
  range.confidence = observed == null ? 0.35 : Math.min(0.8, 0.35 + trust * 0.45);
  range.evidence = [
    observed == null
      ? `prior:${input.position}_open_${(prior * 100).toFixed(0)}pct`
      : `observed:${input.position}_open_${(observed * 100).toFixed(0)}pct_n${n}`,
  ];
  return range;
}

/** Structural features of a hand class used for action-based reweighting. */
function classFeatures(hc: HandClass) {
  const hi = rankValue(hc[0] as Card["rank"]);
  const lo = rankValue(hc[1] as Card["rank"]);
  const isPair = hc.length === 2;
  const suited = hc.endsWith("s");
  const gap = Math.abs(hi - lo) - 1;
  return {
    hi,
    lo,
    isPair,
    suited,
    gap,
    premiumPair: isPair && hi >= 12,
    mediumPair: isPair && hi >= 7 && hi < 12,
    smallPair: isPair && hi < 7,
    bigBroadway: !isPair && hi >= 13 && lo >= 11,
    broadway: !isPair && hi >= 11 && lo >= 10,
    suitedConnector: suited && !isPair && gap <= 1 && hi <= 12,
    weakAce: !isPair && hi === 14 && lo <= 9,
    weakOffsuit: !isPair && !suited && lo <= 9 && hi <= 13,
  };
}

/** Public action observations that reshape a range. */
export type RangeEvidence =
  | { kind: "open_raise"; sizeInBb?: number }
  | { kind: "three_bet" }
  | { kind: "four_bet" }
  | { kind: "call_vs_raise" }
  | { kind: "call_vs_three_bet" }
  | { kind: "check" }
  | { kind: "limp" }
  | { kind: "postflop_aggression" }
  | { kind: "postflop_call" }
  | { kind: "postflop_check" };

/**
 * Apply a multiplier per hand class and renormalize nothing — weights stay as
 * "fraction of this class still in range", which is what the equity sampler
 * needs. Confidence decays with each inference layer, because every step is a
 * model, not an observation.
 */
export function narrowRange(
  range: RangeDistribution,
  evidence: RangeEvidence,
): RangeDistribution {
  const weights: Record<HandClass, number> = {};
  for (const [hc, w] of Object.entries(range.weights)) {
    const f = classFeatures(hc);
    let m = 1;
    switch (evidence.kind) {
      case "open_raise":
        // Opening itself is already priced into the opening range.
        m = 1;
        break;
      case "three_bet":
        m = f.premiumPair ? 1 : f.bigBroadway ? 0.85 : f.mediumPair ? 0.45 : f.suitedConnector ? 0.3 : 0.1;
        break;
      case "four_bet":
        m = f.premiumPair ? 1 : f.bigBroadway ? 0.5 : 0.05;
        break;
      case "call_vs_three_bet":
        // Folds out the air and the weak offsuit holdings; keeps hands with
        // playability and the traps that declined to 4-bet.
        m = f.premiumPair
          ? 0.55
          : f.bigBroadway
            ? 0.9
            : f.mediumPair
              ? 0.85
              : f.smallPair
                ? 0.5
                : f.suitedConnector
                  ? 0.6
                  : f.broadway
                    ? 0.7
                    : f.weakAce
                      ? 0.25
                      : f.weakOffsuit
                        ? 0.08
                        : 0.3;
        break;
      case "call_vs_raise":
        m = f.premiumPair ? 0.3 : f.bigBroadway ? 0.7 : f.mediumPair ? 1 : f.suitedConnector ? 1 : 0.6;
        break;
      case "check":
        m = f.premiumPair ? 0.6 : 1;
        break;
      case "limp":
        m = f.premiumPair ? 0.2 : f.smallPair ? 1.2 : f.suited ? 1.1 : 0.9;
        break;
      case "postflop_aggression":
        m = f.premiumPair
          ? 1
          : f.bigBroadway
            ? 0.9
            : f.mediumPair
              ? 0.85
              : f.suitedConnector
                ? 0.75
                : f.broadway
                  ? 0.55
                  : 0.25;
        break;
      case "postflop_call":
        m = f.premiumPair
          ? 0.7
          : f.mediumPair
            ? 1
            : f.suitedConnector
              ? 0.95
              : f.bigBroadway
                ? 0.8
                : f.weakOffsuit
                  ? 0.2
                  : 0.55;
        break;
      case "postflop_check":
        m = f.premiumPair ? 0.45 : f.weakOffsuit ? 1.15 : 1;
        break;
    }
    const next = Math.max(0, w * m);
    if (next > 0) weights[hc] = next;
  }

  // RENORMALISE. Weights are conditional probabilities — "given this line, how
  // much of this class is still here" — so the most consistent class must sit
  // at 1.0 after conditioning. Without this the multipliers compound: every
  // action scales the whole range down, so width decayed geometrically with
  // the NUMBER OF ACTIONS rather than with information, and a routine
  // open→call→call→raise line collapsed to ~2-3% of hands. That fake-narrow
  // width then fed the fold-equity model and pinned every estimate near its
  // floor. Rescaling preserves the relative shape (which is what equity
  // sampling actually uses) while making the reported width mean what it says.
  const peak = Math.max(0, ...Object.values(weights));
  const normalized: Record<HandClass, number> = {};
  if (peak > 0) {
    for (const [hc, w] of Object.entries(weights)) {
      const scaled = Math.min(1, w / peak);
      // Drop only genuine noise, not the legitimate tail.
      if (scaled > 0.005) normalized[hc] = Math.round(scaled * 1000) / 1000;
    }
  }

  return {
    weights: normalized,
    label: `${range.label} → ${evidence.kind}`,
    // Each inference layer costs confidence; never let it read as certainty.
    confidence: Math.max(0.15, range.confidence * 0.85),
    evidence: [...range.evidence, evidence.kind],
  };
}

/** A concrete two-card combo drawn from a range, with its weight. */
export type WeightedCombo = { hole: [Card, Card]; weight: number };

/**
 * Expand a class distribution to concrete combos, removing any combo that uses
 * a blocked card (hero's hole cards and the board). This is what makes the
 * resulting equity a real "vs range" number rather than "vs random".
 */
export function expandRange(range: RangeDistribution, blocked: Card[]): WeightedCombo[] {
  const dead = new Set(blocked.map(cardKey));
  const out: WeightedCombo[] = [];

  for (const [hc, weight] of Object.entries(range.weights)) {
    if (weight <= 0) continue;
    const hiRank = hc[0] as Card["rank"];
    const loRank = hc[1] as Card["rank"];
    const isPair = hc.length === 2;
    const suited = hc.endsWith("s");

    if (isPair) {
      for (let i = 0; i < SUITS.length; i++) {
        for (let j = i + 1; j < SUITS.length; j++) {
          const a: Card = { rank: hiRank, suit: SUITS[i]! };
          const b: Card = { rank: loRank, suit: SUITS[j]! };
          if (dead.has(cardKey(a)) || dead.has(cardKey(b))) continue;
          out.push({ hole: [a, b], weight });
        }
      }
    } else if (suited) {
      for (const s of SUITS) {
        const a: Card = { rank: hiRank, suit: s };
        const b: Card = { rank: loRank, suit: s };
        if (dead.has(cardKey(a)) || dead.has(cardKey(b))) continue;
        out.push({ hole: [a, b], weight });
      }
    } else {
      for (const sa of SUITS) {
        for (const sb of SUITS) {
          if (sa === sb) continue;
          const a: Card = { rank: hiRank, suit: sa };
          const b: Card = { rank: loRank, suit: sb };
          if (dead.has(cardKey(a)) || dead.has(cardKey(b))) continue;
          out.push({ hole: [a, b], weight });
        }
      }
    }
  }
  return out;
}

/** Width-only label — safe for player-facing AI Activity copy. */
export function describeRangeShort(range: RangeDistribution): string {
  return `${(rangeWidth(range) * 100).toFixed(1)}% of hands`;
}

/** Top-N classes by weight — for compact, auditable / developer range summaries. */
export function describeRange(range: RangeDistribution, limit = 8): string {
  const entries = Object.entries(range.weights)
    .sort((a, b) => b[1] - a[1] || chenScore(b[0]) - chenScore(a[0]))
    .slice(0, limit);
  const parts = entries.map(([hc, w]) => (w >= 0.999 ? hc : `${hc}@${Math.round(w * 100)}%`));
  const width = rangeWidth(range);
  return `${(width * 100).toFixed(1)}% of hands (${parts.join(", ")}${
    Object.keys(range.weights).length > limit ? ", …" : ""
  })`;
}

/** Uniform dealt holding — every legal starting class equally possible. */
export function fullHoldingRange(): RangeDistribution {
  const weights: Record<HandClass, number> = {};
  for (const hc of allHandClasses()) weights[hc] = 1;
  return {
    weights,
    label: "dealt holding ~100%",
    confidence: 0.95,
    evidence: ["uniform_deal"],
  };
}

/**
 * Coarse board reweight: classes that connect with board ranks stay heavier.
 * Not a solver — confidence must stay low and copy must not overclaim.
 */
export function reweightForBoard(range: RangeDistribution, board: Card[]): RangeDistribution {
  if (board.length < 3) return range;
  const boardRanks = new Set(board.map((c) => c.rank));
  const weights: Record<HandClass, number> = {};
  for (const [hc, w] of Object.entries(range.weights)) {
    const hi = hc[0] as Card["rank"];
    const lo = hc[1] as Card["rank"];
    const isPair = hc.length === 2;
    let m = 1;
    const pairedBoard = boardRanks.has(hi) || boardRanks.has(lo);
    if (pairedBoard) m *= 1.4;
    if (isPair && boardRanks.has(hi)) m *= 1.55;
    const next = Math.max(0, Math.min(1, w * m));
    if (next > 0.005) weights[hc] = Math.round(next * 1000) / 1000;
  }
  return {
    weights,
    label: `${range.label} → board`,
    confidence: Math.max(0.12, range.confidence * 0.75),
    evidence: [...range.evidence, `board_reweight_${board.length}`],
  };
}
