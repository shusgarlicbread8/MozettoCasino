/**
 * Spot intelligence layer — board-relative hand strength, equity realization,
 * fold-equity estimates, and strategic intent candidates.
 *
 * Deterministic models (not solver EVs). Confidence is always first-class so
 * the strategist can discount when the read is soft.
 */

import type { Card } from "@mozetto/shared-types";
import { rankValue } from "./cards.js";
import { bestHand, type HandCategory } from "./hand-rank.js";
import type { PositionLabel } from "./range.js";

export type OddsClass = "POOR" | "FAIR" | "GOOD" | "EXCELLENT";

export type BoardTextureClass =
  | "DRY"
  | "SEMI_WET"
  | "WET"
  | "MONOTONE"
  | "CONNECTED"
  | "PAIRED"
  | "UNKNOWN";

export type HandRelativeStrength =
  | "AIR"
  | "WEAK_DRAW"
  | "STRONG_DRAW"
  | "BOTTOM_PAIR"
  | "MIDDLE_PAIR"
  | "TOP_PAIR_WEAK_KICKER"
  | "TOP_PAIR_GOOD_KICKER"
  | "OVERPAIR"
  | "TWO_PAIR"
  | "SET"
  | "STRAIGHT"
  | "FLUSH"
  | "FULL_HOUSE_PLUS"
  | "PREFLOP_STRONG"
  | "PREFLOP_MEDIUM"
  | "PREFLOP_WEAK"
  | "UNKNOWN";

export type ShowdownStrengthBand = "NONE" | "WEAK" | "MEDIUM" | "STRONG" | "NUTS_NEAR";

export type StrategicIntent =
  | "VALUE"
  | "THIN_VALUE"
  | "BLUFF"
  | "SEMI_BLUFF"
  | "BLUFF_CATCH"
  | "DENIAL"
  | "POT_CONTROL"
  | "TRAP"
  | "PROTECTION"
  | "REALIZE_EQUITY"
  | "FOLD_EQUITY"
  | "MARGINAL_CONTINUE";

export type BoardTexture = {
  class: BoardTextureClass;
  paired: boolean;
  flushPossible: boolean;
  straightPossible: boolean;
  highCardRank: number;
  summary: string;
};

export type HandRelative = {
  strength: HandRelativeStrength;
  showdownBand: ShowdownStrengthBand;
  /** User-facing label, e.g. "bottom pair". */
  label: string;
};

export type FoldEstimate = {
  /** Required immediate folds for a pure bluff, 0..100. */
  requiredFoldPct: number;
  /** Heuristic fold probability, 0..100. */
  estimatedFoldPct: number;
  confidence: number;
};

/** Coarse board texture for postflop planning. */
export function analyzeBoardTexture(board: Card[]): BoardTexture {
  if (board.length < 3) {
    return {
      class: "UNKNOWN",
      paired: false,
      flushPossible: false,
      straightPossible: false,
      highCardRank: 0,
      summary: "preflop",
    };
  }
  const ranks = board.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const suits = board.map((c) => c.suit);
  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  const paired = [...rankCounts.values()].some((n) => n >= 2);

  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
  const maxSuit = Math.max(...suitCounts.values());
  const flushPossible = maxSuit >= 3;
  const monotone = maxSuit >= 3 && board.length === 3 && maxSuit === 3;

  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < uniq.length; i++) gaps += uniq[i]! - uniq[i - 1]! - 1;
  const span = uniq[uniq.length - 1]! - uniq[0]!;
  const straightPossible = span <= 6 && uniq.length >= 3;

  let cls: BoardTextureClass = "DRY";
  if (monotone) cls = "MONOTONE";
  else if (paired && (flushPossible || straightPossible)) cls = "WET";
  else if (paired) cls = "PAIRED";
  else if (flushPossible && straightPossible) cls = "WET";
  else if (straightPossible && gaps <= 1) cls = "CONNECTED";
  else if (flushPossible || straightPossible) cls = "SEMI_WET";

  const parts = [cls.toLowerCase().replace("_", " ")];
  if (paired) parts.push("paired");
  if (flushPossible) parts.push("flush draws live");
  if (straightPossible) parts.push("straight draws live");

  return {
    class: cls,
    paired,
    flushPossible,
    straightPossible,
    highCardRank: ranks[0] ?? 0,
    summary: parts.join(" · "),
  };
}

function pairRelative(hole: Card[], board: Card[], pairRank: number): HandRelativeStrength {
  const boardRanks = [...new Set(board.map((c) => rankValue(c.rank)))].sort((a, b) => b - a);
  const top = boardRanks[0] ?? 0;
  const second = boardRanks[1] ?? 0;
  const holeRanks = hole.map((c) => rankValue(c.rank));
  const isPocket = holeRanks[0] === holeRanks[1];

  if (isPocket && pairRank > top) return "OVERPAIR";
  if (pairRank === top) {
    const kicker = holeRanks.find((r) => r !== pairRank) ?? 0;
    return kicker >= 12 ? "TOP_PAIR_GOOD_KICKER" : "TOP_PAIR_WEAK_KICKER";
  }
  if (pairRank === second || (boardRanks.length >= 2 && pairRank > (boardRanks[boardRanks.length - 1] ?? 0))) {
    return pairRank >= second ? "MIDDLE_PAIR" : "BOTTOM_PAIR";
  }
  return "BOTTOM_PAIR";
}

const REL_LABEL: Record<HandRelativeStrength, string> = {
  AIR: "air",
  WEAK_DRAW: "weak draw",
  STRONG_DRAW: "strong draw",
  BOTTOM_PAIR: "bottom pair",
  MIDDLE_PAIR: "middle pair",
  TOP_PAIR_WEAK_KICKER: "top pair, weak kicker",
  TOP_PAIR_GOOD_KICKER: "top pair, good kicker",
  OVERPAIR: "overpair",
  TWO_PAIR: "two pair",
  SET: "set",
  STRAIGHT: "straight",
  FLUSH: "flush",
  FULL_HOUSE_PLUS: "full house+",
  PREFLOP_STRONG: "strong preflop holding",
  PREFLOP_MEDIUM: "medium preflop holding",
  PREFLOP_WEAK: "weak preflop holding",
  UNKNOWN: "unknown holding",
};

function showdownBandFor(strength: HandRelativeStrength): ShowdownStrengthBand {
  switch (strength) {
    case "AIR":
    case "WEAK_DRAW":
    case "PREFLOP_WEAK":
      return "NONE";
    case "BOTTOM_PAIR":
    case "MIDDLE_PAIR":
    case "TOP_PAIR_WEAK_KICKER":
    case "STRONG_DRAW":
    case "PREFLOP_MEDIUM":
      return "WEAK";
    case "TOP_PAIR_GOOD_KICKER":
    case "OVERPAIR":
    case "TWO_PAIR":
    case "PREFLOP_STRONG":
      return "MEDIUM";
    case "SET":
    case "STRAIGHT":
    case "FLUSH":
      return "STRONG";
    case "FULL_HOUSE_PLUS":
      return "NUTS_NEAR";
    default:
      return "WEAK";
  }
}

/** Board-relative made-hand classification (postflop) or preflop bucket. */
export function classifyHandRelative(hole: Card[], board: Card[]): HandRelative {
  if (hole.length < 2) {
    return { strength: "UNKNOWN", showdownBand: "NONE", label: REL_LABEL.UNKNOWN };
  }

  if (board.length < 3) {
    const [a, b] = [...hole].map((c) => rankValue(c.rank)).sort((x, y) => y - x);
    const suited = hole[0]!.suit === hole[1]!.suit;
    const pair = a === b;
    let strength: HandRelativeStrength = "PREFLOP_WEAK";
    if (pair && a! >= 10) strength = "PREFLOP_STRONG";
    else if (pair || (a! >= 14 && b! >= 10) || (a! >= 13 && b! >= 12 && suited)) {
      strength = "PREFLOP_STRONG";
    } else if (a! >= 12 || (a! >= 11 && suited) || (a! >= 14 && b! >= 7)) {
      strength = "PREFLOP_MEDIUM";
    }
    return { strength, showdownBand: showdownBandFor(strength), label: REL_LABEL[strength] };
  }

  const made = bestHand(hole, board);
  const cat = made.category as HandCategory;
  let strength: HandRelativeStrength = "AIR";

  if (cat === "straight_flush" || cat === "four_kind" || cat === "full_house") {
    strength = "FULL_HOUSE_PLUS";
  } else if (cat === "flush") strength = "FLUSH";
  else if (cat === "straight") strength = "STRAIGHT";
  else if (cat === "three_kind") strength = "SET";
  else if (cat === "two_pair") strength = "TWO_PAIR";
  else if (cat === "pair") {
    const pairRank = made.score[1] ?? 0;
    strength = pairRelative(hole, board, pairRank);
  } else {
    // High card — check for obvious strong draws (flush/oesd-ish via texture).
    const texture = analyzeBoardTexture(board);
    const suitedHole = hole[0]!.suit === hole[1]!.suit;
    const suitOnBoard = board.filter((c) => c.suit === hole[0]!.suit).length;
    if (suitedHole && suitOnBoard >= 2) strength = "STRONG_DRAW";
    else if (texture.straightPossible || texture.flushPossible) strength = "WEAK_DRAW";
    else strength = "AIR";
  }

  return { strength, showdownBand: showdownBandFor(strength), label: REL_LABEL[strength] };
}

/**
 * Fraction of raw equity hero is expected to realize (0.45..1.05).
 * OOP + wet boards + weak made hands realize less; IP + strong hands realize more.
 */
export function estimateEquityRealization(input: {
  position: PositionLabel;
  street: string;
  spr: number | null;
  board: BoardTexture;
  hand: HandRelative;
  rangeConfidence: number;
}): { factor: number; class: OddsClass; summary: string } {
  const ip = input.position === "BTN" || input.position === "CO";
  let factor = ip ? 0.92 : 0.78;

  if (input.street === "river") factor = 1;
  else if (input.street === "turn") factor += 0.04;

  switch (input.hand.showdownBand) {
    case "NONE":
      factor -= 0.12;
      break;
    case "WEAK":
      factor -= 0.06;
      break;
    case "STRONG":
    case "NUTS_NEAR":
      factor += 0.08;
      break;
    default:
      break;
  }

  if (input.board.class === "WET" || input.board.class === "MONOTONE") factor -= 0.08;
  else if (input.board.class === "SEMI_WET" || input.board.class === "CONNECTED") factor -= 0.04;
  else if (input.board.class === "DRY") factor += 0.03;

  if (input.spr != null) {
    if (input.spr < 2) factor += 0.05;
    else if (input.spr > 12) factor -= ip ? 0.02 : 0.06;
  }

  if (input.rangeConfidence < 0.4) factor -= 0.03;

  factor = Math.max(0.45, Math.min(1.05, Math.round(factor * 100) / 100));
  const cls: OddsClass =
    factor >= 0.95 ? "EXCELLENT" : factor >= 0.85 ? "GOOD" : factor >= 0.7 ? "FAIR" : "POOR";
  return {
    factor,
    class: cls,
    summary: `${ip ? "IP" : "OOP"} · ${cls.toLowerCase()} realization (~${Math.round(factor * 100)}%)`,
  };
}

export function classifyImpliedOdds(input: {
  sprAfterCall: number | null;
  hand: HandRelative;
  board: BoardTexture;
  street: string;
}): { implied: OddsClass; reverse: OddsClass } {
  if (input.street === "river" || input.sprAfterCall == null) {
    return { implied: "FAIR", reverse: "FAIR" };
  }
  const deep = input.sprAfterCall >= 8;
  const draw =
    input.hand.strength === "STRONG_DRAW" || input.hand.strength === "WEAK_DRAW";
  const weakMade =
    input.hand.showdownBand === "NONE" || input.hand.showdownBand === "WEAK";

  let implied: OddsClass = "FAIR";
  if (draw && deep && (input.board.class === "WET" || input.board.class === "SEMI_WET")) {
    implied = "EXCELLENT";
  } else if (draw && deep) implied = "GOOD";
  else if (!deep) implied = "POOR";

  let reverse: OddsClass = "FAIR";
  if (weakMade && deep && (input.board.class === "WET" || input.board.class === "MONOTONE")) {
    reverse = "EXCELLENT"; // bad for hero — high reverse implied
  } else if (weakMade && deep) reverse = "GOOD";
  else if (input.hand.showdownBand === "STRONG" || input.hand.showdownBand === "NUTS_NEAR") {
    reverse = "POOR";
  }

  return { implied, reverse };
}

/**
 * Heuristic fold% if hero bets `risk` into `pot` vs a range of width `rangeWidthPct`.
 */
export function estimateFoldToBet(input: {
  pot: number;
  risk: number;
  rangeWidthPct: number;
  rangeConfidence: number;
  board: BoardTexture;
  street: string;
}): FoldEstimate {
  const required =
    input.risk > 0 && input.pot >= 0
      ? Math.round((input.risk / (input.risk + input.pot)) * 1000) / 10
      : 0;

  // Wider ranges fold more; wet boards call more; late streets fold less to small bets.
  const width = Math.max(5, Math.min(100, input.rangeWidthPct));
  let est = 18 + width * 0.55;
  const potFrac = input.pot > 0 ? input.risk / input.pot : 1;
  if (potFrac >= 1) est += 8;
  else if (potFrac >= 0.66) est += 4;
  else if (potFrac <= 0.33) est -= 4;

  if (input.board.class === "DRY" || input.board.class === "PAIRED") est += 6;
  if (input.board.class === "WET" || input.board.class === "MONOTONE") est -= 8;
  if (input.street === "river") est -= 4;
  if (input.street === "preflop") est += 2;

  est = Math.max(8, Math.min(72, Math.round(est * 10) / 10));
  const confidence = Math.max(0.25, Math.min(0.75, input.rangeConfidence * 0.85));
  return { requiredFoldPct: required, estimatedFoldPct: est, confidence };
}

/**
 * Continue quality vs pot odds using realized equity (not raw equity alone).
 * Positive = good continue; near 0 = marginal; negative = poor.
 */
export function continueQuality(input: {
  rawEquity: number;
  realizationFactor: number;
  potOdds: number;
  implied: OddsClass;
  reverse: OddsClass;
  rakeHaircut?: number;
}): {
  realizedEquity: number;
  edge: number;
  band: "FOLD" | "MARGINAL" | "CONTINUE" | "CLEAR_CONTINUE";
  summary: string;
} {
  let realized = input.rawEquity * input.realizationFactor;
  if (input.implied === "EXCELLENT") realized += 0.03;
  else if (input.implied === "GOOD") realized += 0.015;
  else if (input.implied === "POOR") realized -= 0.01;

  if (input.reverse === "EXCELLENT") realized -= 0.04;
  else if (input.reverse === "GOOD") realized -= 0.02;

  const rake = input.rakeHaircut ?? 0.01;
  const edge = Math.round((realized - input.potOdds - rake) * 1000) / 1000;
  const band =
    edge >= 0.08
      ? "CLEAR_CONTINUE"
      : edge >= 0.02
        ? "CONTINUE"
        : edge >= -0.03
          ? "MARGINAL"
          : "FOLD";
  return {
    realizedEquity: Math.round(realized * 1000) / 1000,
    edge,
    band,
    summary: `realized ~${Math.round(realized * 100)}% vs ${Math.round(input.potOdds * 100)}% price · ${band.toLowerCase().replace("_", " ")}`,
  };
}

export function intentForAction(input: {
  action: string;
  hand: HandRelative;
  rawEquity: number | null;
  continueBand?: string | null;
  foldEst?: FoldEstimate | null;
}): StrategicIntent {
  const a = input.action.toLowerCase();
  if (a === "fold") return "FOLD_EQUITY";
  if (a === "check") {
    if (input.hand.showdownBand === "STRONG" || input.hand.showdownBand === "NUTS_NEAR") {
      return "TRAP";
    }
    if (input.hand.showdownBand === "NONE") return "POT_CONTROL";
    return "REALIZE_EQUITY";
  }
  if (a === "call") {
    if (input.continueBand === "MARGINAL") return "MARGINAL_CONTINUE";
    if (input.hand.showdownBand === "NONE" || input.hand.strength.includes("DRAW")) {
      return "SEMI_BLUFF";
    }
    if ((input.rawEquity ?? 0) < 0.4) return "BLUFF_CATCH";
    return "REALIZE_EQUITY";
  }
  if (a === "bet" || a === "raise" || a === "all_in") {
    if (input.hand.showdownBand === "STRONG" || input.hand.showdownBand === "NUTS_NEAR") {
      return "VALUE";
    }
    if (input.hand.showdownBand === "MEDIUM") return "THIN_VALUE";
    if (input.hand.strength === "STRONG_DRAW" || input.hand.strength === "WEAK_DRAW") {
      return "SEMI_BLUFF";
    }
    if (
      input.foldEst &&
      input.foldEst.estimatedFoldPct + 3 >= input.foldEst.requiredFoldPct
    ) {
      return "BLUFF";
    }
    return "DENIAL";
  }
  return "POT_CONTROL";
}

/** Short public hint for how an opponent action reshapes range. */
export function rangeUpdateHint(action: string, street: string): string {
  const a = action.toLowerCase();
  const post = street !== "preflop";
  if (a === "bet" || a === "raise" || a === "all_in") {
    return post
      ? "Range shifts toward strong made hands and strong draws"
      : "Range narrows toward opening / 3-bet strength";
  }
  if (a === "call") {
    return post
      ? "Range narrowed toward made hands and draws"
      : "Range widens into calling hands; air drops out";
  }
  if (a === "check") {
    return post
      ? "Weak and medium-strength holdings gain weight"
      : "Range stays wide; no aggression shown";
  }
  if (a === "fold") return "That combo class leaves the range";
  return "Range updated from public action";
}
