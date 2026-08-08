/**
 * Deterministic decision facts — the structured state handed to the strategist.
 *
 * Design rule: the LLM is a strategist, not a calculator. Everything a computer
 * can compute exactly (pot odds, SPR, position, effective stack, whether a size
 * is actually all-in) is computed here. Everything that is a *model* rather
 * than a fact (opponent range, equity against it) is computed here too, but is
 * labelled with an explicit confidence so the strategist can discount it.
 *
 * Nothing in this module is derived from opponent hole cards.
 */

import type { Card } from "@mozetto/shared-types";
import { computeEquityVsRange, personalHandLabel } from "./equity.js";
import { getLegalActions, type HoldemState, type LegalAction } from "./holdem.js";
import { chipsToNumber } from "./money.js";
import {
  describeRange,
  handClassOf,
  narrowRange,
  openingRangeFor,
  rangeWidth,
  type PositionLabel,
  type RangeDistribution,
  type RangeEvidence,
} from "./range.js";

/** Persistent, cross-hand stats for one opponent seat. Public evidence only. */
export type OpponentStats = {
  seat: number;
  handsObserved: number;
  /** Fraction of opportunities this seat opened with a raise. */
  openPct?: number | null;
  vpipPct?: number | null;
  threeBetPct?: number | null;
  foldToThreeBetPct?: number | null;
  avgPublicCadenceMs?: number | null;
};

/**
 * Stack-depth regime. Correct strategy differs radically between these — at
 * ULTRA_SHORT, No-Limit collapses toward shove/fold and postflop play barely
 * exists; at DEEP, implied odds and multi-street planning dominate. The
 * strategist must know which game it is playing.
 */
export type StackDepthRegime =
  | "ULTRA_SHORT"
  | "SHORT"
  | "MEDIUM"
  | "DEEP"
  | "VERY_DEEP";

export function stackDepthRegime(effectiveStackBb: number): StackDepthRegime {
  if (effectiveStackBb <= 10) return "ULTRA_SHORT";
  if (effectiveStackBb <= 25) return "SHORT";
  if (effectiveStackBb <= 60) return "MEDIUM";
  if (effectiveStackBb <= 150) return "DEEP";
  return "VERY_DEEP";
}

export type CandidateAction = {
  action: string;
  /** Chips added by this action (matches engine `amount` semantics). */
  amountChips: number;
  amountBb: number;
  /** True when `amountChips` commits the seat's entire remaining stack. */
  isAllIn: boolean;
  /** Pot after hero's chips go in, before any further action. */
  potAfterBb: number;
  /**
   * Break-even fold frequency for an aggressive line: risk / (risk + pot won
   * immediately). Null for fold/check/call, which risk nothing on a fold.
   */
  breakEvenFoldPct: number | null;
  /** Price the opponent would be laid if they call. Null when not a bet/raise. */
  priceOfferedPct: number | null;
};

export type DecisionFacts = {
  street: string;
  hero: {
    seat: number;
    cards: string[];
    handClass: string;
    handLabel: string;
    position: PositionLabel;
    stackBb: number;
    committedBb: number;
  };
  potBb: number;
  callBb: number;
  /** Break-even equity needed to call, 0..1. Exact arithmetic, not a model. */
  potOdds: number | null;
  /** Smallest effective stack across live opponents — the binding constraint. */
  effectiveStackBb: number;
  /**
   * Effective stack against EACH live opponent, keyed by seat.
   *
   * A 6-max spot with 100BB hero, a 14BB shorty and a 280BB deep stack is not
   * "a 100BB hand" — it is a 14BB hand against one seat and a 100BB hand
   * against another, and the correct line differs per opponent. Hero's own
   * stack alone is not enough to reason with.
   */
  effectiveStacksBbBySeat: Record<number, number>;
  /** Which stack-depth game this is, by the binding effective stack. */
  stackDepthRegime: StackDepthRegime;
  /** Effective stack / pot after calling. Null when nothing to call. */
  sprAfterCall: number | null;
  /**
   * Pot geometry the way poker is actually discussed. Dollars are not
   * strategically meaningful; BB, % of pot and SPR are.
   */
  geometry: {
    /** Price being laid, as a fraction of the pot. Null when nothing to call. */
    callPctPot: number | null;
    /** Effective stack / current pot. */
    spr: number | null;
    potBb: number;
    callBb: number;
  };
  villain: {
    seat: number;
    position: PositionLabel;
    /** Compact description of the modelled range. */
    rangeSummary: string;
    rangeWidthPct: number;
    rangeConfidence: number;
    /** The public actions that shaped this range, oldest first. */
    rangeEvidence: string[];
    handsObserved: number;
  } | null;
  /**
   * Hero equity against the modelled villain range. This is a MODEL output:
   * treat `confidence` as a first-class part of the number.
   */
  heroEquityVsRange: {
    value: number;
    confidence: number;
    method: string;
  } | null;
  legalActions: Array<{
    action: string;
    minChips?: number;
    maxChips?: number;
    /** True when maxChips equals hero's whole stack. */
    maxIsAllIn?: boolean;
  }>;
  candidates: CandidateAction[];
  bigBlind: number;
  /** Non-fatal notes about what could not be modelled. */
  caveats: string[];
};

/** Position label from seat offset to the button, for the seats still in. */
export function positionOf(state: HoldemState, seatIndex: number): PositionLabel {
  const live = state.seats
    .filter((s) => s.playerId && !s.sitOut)
    .map((s) => s.seatIndex)
    .sort((a, b) => a - b);
  const n = live.length;
  if (n <= 1) return "BTN";

  const btnPos = live.indexOf(state.button);
  const myPos = live.indexOf(seatIndex);
  if (btnPos < 0 || myPos < 0) return "MP";
  // Seats after the button, wrapping: 0 = BTN, 1 = SB, 2 = BB, …
  const offset = (myPos - btnPos + n) % n;

  if (n === 2) return offset === 0 ? "BTN" : "BB";
  if (offset === 0) return "BTN";
  if (offset === 1) return "SB";
  if (offset === 2) return "BB";
  // Remaining seats run BB+1 … CO. Label the last one CO, the earliest EP.
  const fromEnd = n - offset;
  if (fromEnd === 1) return "CO";
  if (fromEnd <= 3) return "MP";
  return "EP";
}

/** Public preflop actions taken by a seat this hand, oldest first. */
export type SeatActionLog = Array<{
  seat: number;
  action: string;
  amountChips?: number;
  street: string;
}>;

/**
 * Rebuild an opponent's range from their public preflop line.
 * `actions` should contain this hand's actions in order.
 */
export function modelVillainRange(input: {
  villainSeat: number;
  villainPosition: PositionLabel;
  actions: SeatActionLog;
  stats?: OpponentStats | null;
}): RangeDistribution {
  const stats = input.stats ?? null;
  let range = openingRangeFor({
    position: input.villainPosition,
    observedOpenPct: stats?.openPct ?? null,
    handsObserved: stats?.handsObserved ?? 0,
  });

  const mine = input.actions.filter(
    (a) => a.seat === input.villainSeat && a.street === "preflop",
  );
  // Count aggression order so a call after our 3-bet narrows differently from
  // a call of a plain open.
  let raisesSeen = 0;
  for (const a of mine) {
    let ev: RangeEvidence | null = null;
    if (a.action === "raise" || a.action === "bet" || a.action === "all_in") {
      raisesSeen += 1;
      ev = raisesSeen === 1 ? { kind: "open_raise" } : raisesSeen === 2 ? { kind: "three_bet" } : { kind: "four_bet" };
    } else if (a.action === "call") {
      ev = raisesSeen >= 1 ? { kind: "call_vs_three_bet" } : { kind: "call_vs_raise" };
    } else if (a.action === "check") {
      ev = { kind: "check" };
    }
    if (ev) range = narrowRange(range, ev);
  }
  return range;
}

function toBb(chips: number, bb: number): number {
  return bb > 0 ? Math.round((chips / bb) * 100) / 100 : chips;
}

/**
 * Build the full structured decision state for the acting seat.
 *
 * `equitySamples` trades accuracy for latency; 2000 samples gives roughly
 * ±1% on preflop equity, which is well inside the confidence we report.
 */
export function buildDecisionFacts(input: {
  state: HoldemState;
  seatIndex: number;
  actions?: SeatActionLog;
  stats?: Record<number, OpponentStats>;
  equitySamples?: number;
  seed?: number;
}): DecisionFacts {
  const { state, seatIndex } = input;
  const seat = state.seats.find((s) => s.seatIndex === seatIndex);
  const bb = chipsToNumber(state.config.bigBlind) || 1;
  const caveats: string[] = [];

  const legal = getLegalActions(state);
  const hole = seat?.hole ?? [];
  const seatBet = seat ? chipsToNumber(seat.bet) : 0;
  const toCall = Math.max(0, chipsToNumber(state.currentBet) - seatBet);
  const pot = chipsToNumber(state.pot);
  const stack = seat ? chipsToNumber(seat.stack) : 0;

  const opponents = state.seats.filter(
    (s) => s.playerId && !s.folded && s.seatIndex !== seatIndex,
  );
  // Effective stack is per-opponent: what hero can actually win or lose
  // against that seat is capped by whichever of the two is shorter.
  const effectiveStacksBbBySeat: Record<number, number> = {};
  for (const o of opponents) {
    const oStack = chipsToNumber(o.stack) + chipsToNumber(o.bet);
    effectiveStacksBbBySeat[o.seatIndex] = toBb(Math.min(stack, oStack), bb);
  }
  // Scalar summary = the DEEPEST confrontation available, since that is what
  // bounds how much hero can actually lose and how much postflop room exists.
  // The shortest opponent only caps the main pot; use the per-seat map for
  // decisions that turn on a specific opponent's depth.
  const effectiveStack = opponents.length
    ? Math.min(
        stack,
        Math.max(...opponents.map((o) => chipsToNumber(o.stack) + chipsToNumber(o.bet))),
      )
    : stack;

  // Range modelling is only defined heads-up; multiway needs a joint model.
  let villainBlock: DecisionFacts["villain"] = null;
  let equityVsRange: DecisionFacts["heroEquityVsRange"] = null;

  if (opponents.length === 1 && hole.length === 2) {
    const villain = opponents[0]!;
    const villainPosition = positionOf(state, villain.seatIndex);
    const stats = input.stats?.[villain.seatIndex] ?? null;
    const range = modelVillainRange({
      villainSeat: villain.seatIndex,
      villainPosition,
      actions: input.actions ?? [],
      stats,
    });

    const eq = computeEquityVsRange(hole, state.board, range, {
      samples: input.equitySamples ?? 2_000,
      seed: input.seed,
    });

    villainBlock = {
      seat: villain.seatIndex,
      position: villainPosition,
      rangeSummary: describeRange(range),
      rangeWidthPct: Math.round(rangeWidth(range) * 1000) / 10,
      rangeConfidence: Math.round(range.confidence * 100) / 100,
      rangeEvidence: range.evidence,
      handsObserved: stats?.handsObserved ?? 0,
    };

    if (eq.combosConsidered > 0) {
      equityVsRange = {
        value: Math.round(eq.equityPct) / 100,
        confidence: Math.round(range.confidence * 100) / 100,
        method: eq.exact ? "exact_enumeration" : `monte_carlo_${eq.trials}`,
      };
    } else {
      caveats.push("range_empty_after_card_removal");
    }
    if (!input.actions?.length) {
      caveats.push("no_action_log_supplied_range_is_positional_prior_only");
    }
  } else if (opponents.length > 1) {
    caveats.push("multiway_range_model_not_available");
  } else if (hole.length !== 2) {
    caveats.push("hero_hole_cards_unavailable");
  }

  const candidates = buildCandidates({ legal, pot, toCall, stack, bb });

  return {
    street: String(state.street),
    hero: {
      seat: seatIndex,
      cards: hole.map((c) => `${c.rank}${c.suit}`),
      handClass: hole.length === 2 ? handClassOf(hole) : "",
      handLabel: hole.length === 2 ? personalHandLabel(hole, state.board) : "",
      position: positionOf(state, seatIndex),
      stackBb: toBb(stack, bb),
      committedBb: toBb(chipsToNumber(seat?.totalBet ?? 0n), bb),
    },
    potBb: toBb(pot, bb),
    callBb: toBb(toCall, bb),
    potOdds: toCall > 0 ? Math.round((toCall / (pot + toCall)) * 1000) / 1000 : null,
    effectiveStackBb: toBb(effectiveStack, bb),
    effectiveStacksBbBySeat,
    stackDepthRegime: stackDepthRegime(toBb(effectiveStack, bb)),
    sprAfterCall: toCall > 0 && pot + toCall > 0
      ? Math.round(((effectiveStack - toCall) / (pot + toCall)) * 100) / 100
      : null,
    geometry: {
      callPctPot: toCall > 0 && pot > 0 ? Math.round((toCall / pot) * 1000) / 1000 : null,
      spr: pot > 0 ? Math.round((effectiveStack / pot) * 100) / 100 : null,
      potBb: toBb(pot, bb),
      callBb: toBb(toCall, bb),
    },
    villain: villainBlock,
    heroEquityVsRange: equityVsRange,
    legalActions: legal.map((l) => ({
      action: l.action,
      minChips: l.minAmount != null ? chipsToNumber(l.minAmount) : undefined,
      maxChips: l.maxAmount != null ? chipsToNumber(l.maxAmount) : undefined,
      maxIsAllIn: l.maxAmount != null && l.maxAmount >= stack && stack > 0,
    })),
    candidates,
    bigBlind: bb,
    caveats,
  };
}

/**
 * Concrete sizing options with their arithmetic worked out, so the strategist
 * compares real alternatives instead of inventing a number.
 *
 * These are NOT solver EVs. They are exact price/geometry facts: what a size
 * risks, what pot it builds, how often it must fold the opponent out to break
 * even as a pure bluff, and what price it lays.
 */
export function buildCandidates(input: {
  legal: LegalAction[];
  pot: number;
  toCall: number;
  stack: number;
  bb: number;
}): CandidateAction[] {
  const { legal, pot, toCall, stack, bb } = input;
  const out: CandidateAction[] = [];

  const push = (action: string, chips: number) => {
    const amount = Math.max(0, Math.min(stack, Math.round(chips)));
    if (out.some((c) => c.action === action && c.amountChips === amount)) return;
    const aggressive = action === "bet" || action === "raise" || action === "all_in";
    const potAfter = pot + amount;
    out.push({
      action,
      amountChips: amount,
      amountBb: toBb(amount, bb),
      isAllIn: amount >= stack && stack > 0,
      potAfterBb: toBb(potAfter, bb),
      breakEvenFoldPct: aggressive && amount > 0 ? Math.round((amount / (amount + pot)) * 1000) / 10 : null,
      // Price the villain is laid when they face this size.
      priceOfferedPct:
        aggressive && amount > toCall
          ? Math.round(((amount - toCall) / (potAfter + (amount - toCall))) * 1000) / 10
          : null,
    });
  };

  for (const l of legal) {
    if (l.action === "fold" || l.action === "check") {
      push(l.action, 0);
    } else if (l.action === "call") {
      push("call", l.minAmount != null ? chipsToNumber(l.minAmount) : toCall);
    } else if (l.action === "all_in") {
      push("all_in", stack);
    } else if (l.action === "bet" || l.action === "raise") {
      const min = l.minAmount != null ? chipsToNumber(l.minAmount) : 0;
      const max = l.maxAmount != null ? chipsToNumber(l.maxAmount) : stack;
      // Min, ~1/2 pot, ~3/4 pot, ~pot, and max — clamped into the legal band
      // and deduplicated. Gives the strategist a real menu, not a free-for-all.
      for (const target of [min, toCall + pot * 0.5, toCall + pot * 0.75, toCall + pot, max]) {
        const clamped = Math.max(min, Math.min(max, Math.round(target)));
        push(l.action, clamped);
      }
    }
  }
  return out;
}
