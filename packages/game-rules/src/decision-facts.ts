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
  estimateResponse,
  evaluateAggressiveEv,
  evaluateCallEv,
  rankByEv,
  type ActionEv,
} from "./action-ev.js";
import {
  describeRange,
  describeRangeShort,
  fullHoldingRange,
  handClassOf,
  narrowRange,
  openingRangeFor,
  rangeWidth,
  reweightForBoard,
  type PositionLabel,
  type RangeDistribution,
  type RangeEvidence,
} from "./range.js";
import {
  analyzeBoardTexture,
  classifyHandRelative,
  classifyImpliedOdds,
  continueQuality,
  estimateEquityRealization,
  estimateFoldToBet,
  intentForAction,
  type BoardTexture,
  type HandRelative,
  type OddsClass,
  type StrategicIntent,
} from "./spot-intelligence.js";

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
  /**
   * Explicit raise geometry, so a raise is never described as if it were a
   * bet. `amountChips` is chips ADDED (call included); the increment above the
   * call is the part that actually applies pressure.
   */
  callPortionChips: number;
  raiseIncrementChips: number;
  potBeforeChips: number;
  potAfterCallChips: number;
  potAfterActionChips: number;
  /** Increment as a fraction of the pot it contests (pot after hero calls). */
  sizingPctPot: number | null;
  /**
   * Whether this line is supported by its own numbers.
   *
   * "UNSUPPORTED" means the deterministic layer can already see that the
   * aggressive line loses on its own terms: it needs more folds than the model
   * expects, and hero's realized equity is poor. It is not illegal and not
   * forbidden — but the strategist must supply an explicit compensating reason
   * (blocker, barrel plan, observed over-folding) to choose it anyway.
   */
  /**
   * Estimated value of this line and the opponent response it assumes.
   * Compare candidates by `ev.tier` first — "can I continue?" is a weaker
   * question than "which action makes the most money?".
   */
  ev: ActionEv | null;
  viability: "SUPPORTED" | "THIN" | "UNSUPPORTED";
  /** Why, in one short allowlisted phrase. */
  viabilityReason: string | null;
  breakEvenFoldPct: number | null;
  /** Heuristic fold probability if hero takes this aggressive size. */
  estimatedFoldPct: number | null;
  /** Confidence in estimatedFoldPct, 0..1. */
  foldEstimateConfidence: number | null;
  /** Price the opponent would be laid if they call. Null when not a bet/raise. */
  priceOfferedPct: number | null;
  /** Primary strategic intent if this candidate is chosen. */
  intent: StrategicIntent | null;
};

/** What the equity / summary range represents. */
export type VillainRangeKind = "holding" | "action_conditioned";

export type DecisionFacts = {
  street: string;
  hero: {
    seat: number;
    cards: string[];
    handClass: string;
    handLabel: string;
    /** Board-relative classification (BOTTOM_PAIR, OVERPAIR, …). */
    handRelativeStrength: string;
    showdownStrength: string;
    handRelativeLabel: string;
    position: PositionLabel;
    stackBb: number;
    committedBb: number;
  };
  boardTexture: BoardTexture;
  /**
   * Raw equity vs modelled range (same as heroEquityVsRange.value when present).
   * Prefer realizedEquity / continueQuality for call decisions.
   */
  rawEquity: number | null;
  equityRealization: {
    factor: number;
    class: OddsClass;
    summary: string;
  } | null;
  realizedEquity: number | null;
  impliedOddsClass: OddsClass | null;
  reverseImpliedOddsClass: OddsClass | null;
  /**
   * Call-spot quality using realized equity + implied/reverse odds — not raw
   * equity ≥ potOdds alone.
   */
  continueQuality: {
    realizedEquity: number;
    edge: number;
    band: "FOLD" | "MARGINAL" | "CONTINUE" | "CLEAR_CONTINUE";
    summary: string;
  } | null;
  /** Likely strategic intents among legal candidates. */
  strategicIntentCandidates: StrategicIntent[];
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
    /**
     * `holding` = cards that could physically have been dealt (≈100% before
     * voluntary action). `action_conditioned` = narrowed by observed line.
     */
    rangeKind: VillainRangeKind;
    /** Compact description of the range used for equity. */
    rangeSummary: string;
    /** Developer detail with top classes — not for default player copy. */
    rangeDetail: string;
    rangeWidthPct: number;
    /**
     * How informative THIS hand's betting line has been. Rises with each
     * observed action, independent of how well we know the player.
     */
    rangeConfidence: number;
    /**
     * How well we know this opponent across hands. Stays low until we have
     * real sample size. Previously these were one number, so a river spot
     * after three villain bets still read LOW because the opponent was new —
     * which understated a read the hand itself had genuinely earned.
     */
    opponentModelConfidence: number;
    /** Predicted continue/open width when equity still uses holding range. */
    predictedContinueSummary: string | null;
    predictedContinueWidthPct: number | null;
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

function villainActionsFromLog(actions: SeatActionLog, villainSeat: number): SeatActionLog {
  return actions.filter((a) => a.seat === villainSeat);
}

function hasVoluntaryAction(actions: SeatActionLog): boolean {
  return actions.some(
    (a) =>
      a.action === "raise" ||
      a.action === "bet" ||
      a.action === "call" ||
      a.action === "all_in" ||
      a.action === "fold" ||
      // Preflop check (BB option) and any postflop check are voluntary.
      a.action === "check",
  );
}

/**
 * When the action log is missing, infer whether villain has already entered
 * the pot voluntarily from public table state (bet size / aggressor).
 */
function inferVillainActedFromState(state: HoldemState, villainSeat: number): boolean {
  const v = state.seats.find((s) => s.seatIndex === villainSeat);
  if (!v) return false;
  if (state.lastAggressor === villainSeat) return true;
  const bb = chipsToNumber(state.config.bigBlind);
  const total = chipsToNumber(v.totalBet);
  // More than a big blind committed ⇒ opened / raised / called an open.
  if (total > bb + 0.001) return true;
  // Postflop with chips already matched beyond blinds is covered above; a
  // postflop street with lastAggressor null and equal bets may still mean
  // checked — treat as acted once board is out and they are in the hand.
  if (state.board.length >= 3 && !v.folded && chipsToNumber(v.bet) >= 0) {
    // Don't invent a raise; just mark that we're past deal — holding is no
    // longer uniform once any postflop action exists. Without a log we stay
    // conservative and only flip when aggressor/bet evidence exists.
  }
  return false;
}

/**
 * Rebuild an opponent's action-conditioned range from their public line.
 * Starts from a positional open prior, then narrows with preflop + postflop
 * evidence and a coarse board reweight.
 */
export function modelVillainRange(input: {
  villainSeat: number;
  villainPosition: PositionLabel;
  actions: SeatActionLog;
  stats?: OpponentStats | null;
  board?: Card[];
}): RangeDistribution {
  const stats = input.stats ?? null;
  let range = openingRangeFor({
    position: input.villainPosition,
    observedOpenPct: stats?.openPct ?? null,
    handsObserved: stats?.handsObserved ?? 0,
  });

  const mine = villainActionsFromLog(input.actions, input.villainSeat);
  // Count aggression order so a call after our 3-bet narrows differently from
  // a call of a plain open.
  let raisesSeen = 0;
  for (const a of mine.filter((x) => x.street === "preflop")) {
    let ev: RangeEvidence | null = null;
    if (a.action === "raise" || a.action === "bet" || a.action === "all_in") {
      raisesSeen += 1;
      ev =
        raisesSeen === 1
          ? { kind: "open_raise" }
          : raisesSeen === 2
            ? { kind: "three_bet" }
            : { kind: "four_bet" };
    } else if (a.action === "call") {
      ev = raisesSeen >= 1 ? { kind: "call_vs_three_bet" } : { kind: "call_vs_raise" };
    } else if (a.action === "check") {
      ev = { kind: "check" };
    }
    if (ev) range = narrowRange(range, ev);
  }

  for (const a of mine.filter((x) => x.street !== "preflop")) {
    let ev: RangeEvidence | null = null;
    if (a.action === "raise" || a.action === "bet" || a.action === "all_in") {
      ev = { kind: "postflop_aggression" };
    } else if (a.action === "call") {
      ev = { kind: "postflop_call" };
    } else if (a.action === "check") {
      ev = { kind: "postflop_check" };
    }
    if (ev) range = narrowRange(range, ev);
  }

  if (input.board && input.board.length >= 3) {
    range = reweightForBoard(range, input.board);
  }
  return range;
}

/**
 * Resolve holding vs predicted-continue vs equity range.
 *
 * Before the opponent has taken a voluntary action, equity must be measured
 * against ~100% dealt holdings. Historical VPIP/open% is a *predicted continue*
 * model, not their current hole cards.
 */
/**
 * Confidence in the CURRENT hand's range read.
 *
 * Each voluntary villain action in this hand is real evidence about this hand,
 * so the read strengthens as the line develops even against a total stranger.
 * Capped below certainty — it is still a model.
 */
export function handReadConfidence(
  range: RangeDistribution,
  actions: SeatActionLog,
  villainSeat: number,
): number {
  const voluntary = actions.filter(
    (a) => a.seat === villainSeat && a.action !== "fold" && a.action !== "check",
  ).length;
  // Start from the range's own confidence, then add for observed aggression.
  const base = range.confidence;
  const evidence = Math.min(0.45, voluntary * 0.11);
  return Math.max(0.15, Math.min(0.85, base + evidence));
}

export function resolveOpponentRanges(input: {
  state: HoldemState;
  villainSeat: number;
  villainPosition: PositionLabel;
  actions: SeatActionLog;
  stats?: OpponentStats | null;
}): {
  holdingRange: RangeDistribution;
  predictedContinueRange: RangeDistribution;
  equityRange: RangeDistribution;
  rangeKind: VillainRangeKind;
  inferredFromState: boolean;
} {
  const holdingRange = fullHoldingRange();
  const predictedContinueRange = openingRangeFor({
    position: input.villainPosition,
    observedOpenPct: input.stats?.openPct ?? null,
    handsObserved: input.stats?.handsObserved ?? 0,
  });

  const logged = villainActionsFromLog(input.actions, input.villainSeat);
  const actedInLog = hasVoluntaryAction(logged);
  const inferredFromState =
    !actedInLog && inferVillainActedFromState(input.state, input.villainSeat);

  if (!actedInLog && !inferredFromState) {
    return {
      holdingRange,
      predictedContinueRange,
      equityRange: holdingRange,
      rangeKind: "holding",
      inferredFromState: false,
    };
  }

  const equityRange = modelVillainRange({
    villainSeat: input.villainSeat,
    villainPosition: input.villainPosition,
    actions: actedInLog
      ? input.actions
      : [
          // Minimal synthetic open so the positional prior is used when the
          // table state shows aggression but the log was not supplied.
          {
            seat: input.villainSeat,
            action: "raise",
            street: "preflop",
          },
          ...input.actions,
        ],
    stats: input.stats,
    board: input.state.board,
  });

  return {
    holdingRange,
    predictedContinueRange,
    equityRange,
    rangeKind: "action_conditioned",
    inferredFromState,
  };
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
    const actions = input.actions ?? [];
    const resolved = resolveOpponentRanges({
      state,
      villainSeat: villain.seatIndex,
      villainPosition,
      actions,
      stats,
    });

    const eq = computeEquityVsRange(hole, state.board, resolved.equityRange, {
      samples: input.equitySamples ?? 2_000,
      seed: input.seed,
    });

    const predictedContinueSummary =
      resolved.rangeKind === "holding"
        ? `predicted continue ${describeRangeShort(resolved.predictedContinueRange)} (${villainPosition} prior)`
        : null;

    villainBlock = {
      seat: villain.seatIndex,
      position: villainPosition,
      rangeKind: resolved.rangeKind,
      rangeSummary:
        resolved.rangeKind === "holding"
          ? `holding ≈${describeRangeShort(resolved.holdingRange)}`
          : describeRangeShort(resolved.equityRange),
      rangeDetail: describeRange(resolved.equityRange),
      rangeWidthPct: Math.round(rangeWidth(resolved.equityRange) * 1000) / 10,
      rangeConfidence: Math.round(handReadConfidence(resolved.equityRange, actions, villain.seatIndex) * 100) / 100,
      opponentModelConfidence:
        Math.round(Math.min(0.9, (stats?.handsObserved ?? 0) / ((stats?.handsObserved ?? 0) + 40)) * 100) / 100,
      predictedContinueSummary,
      predictedContinueWidthPct:
        resolved.rangeKind === "holding"
          ? Math.round(rangeWidth(resolved.predictedContinueRange) * 1000) / 10
          : null,
      rangeEvidence: resolved.equityRange.evidence,
      handsObserved: stats?.handsObserved ?? 0,
    };

    if (eq.combosConsidered > 0) {
      equityVsRange = {
        value: Math.round(eq.equityPct) / 100,
        confidence: Math.round(resolved.equityRange.confidence * 100) / 100,
        method: eq.exact ? "exact_enumeration" : `monte_carlo_${eq.trials}`,
      };
    } else {
      caveats.push("range_empty_after_card_removal");
    }
    if (!actions.length) {
      caveats.push(
        resolved.inferredFromState
          ? "no_action_log_supplied_range_inferred_from_table_state"
          : "no_action_log_supplied_using_holding_range",
      );
    }
    if (resolved.rangeKind === "holding") {
      caveats.push("equity_vs_dealt_holding_not_predicted_continue");
    }
    if (state.board.length >= 3 && resolved.rangeKind === "action_conditioned") {
      caveats.push("postflop_range_uses_coarse_board_reweight");
    }
  } else if (opponents.length > 1) {
    caveats.push("multiway_range_model_not_available");
  } else if (hole.length !== 2) {
    caveats.push("hero_hole_cards_unavailable");
  }

  const boardTexture = analyzeBoardTexture(state.board);
  const handRelative: HandRelative =
    hole.length === 2
      ? classifyHandRelative(hole, state.board)
      : { strength: "UNKNOWN", showdownBand: "NONE", label: "unknown holding" };
  const heroPosition = positionOf(state, seatIndex);
  const spr = pot > 0 ? Math.round((effectiveStack / pot) * 100) / 100 : null;
  const sprAfterCall =
    toCall > 0 && pot + toCall > 0
      ? Math.round(((effectiveStack - toCall) / (pot + toCall)) * 100) / 100
      : null;
  const potOdds = toCall > 0 ? Math.round((toCall / (pot + toCall)) * 1000) / 1000 : null;
  const rawEquity = equityVsRange?.value ?? null;

  const realization =
    rawEquity != null
      ? estimateEquityRealization({
          position: heroPosition,
          street: String(state.street),
          spr,
          board: boardTexture,
          hand: handRelative,
          rangeConfidence: equityVsRange?.confidence ?? 0.5,
        })
      : null;
  const oddsClasses = classifyImpliedOdds({
    sprAfterCall,
    hand: handRelative,
    board: boardTexture,
    street: String(state.street),
  });
  const continueQ =
    rawEquity != null && potOdds != null && realization
      ? continueQuality({
          rawEquity,
          realizationFactor: realization.factor,
          potOdds,
          implied: oddsClasses.implied,
          reverse: oddsClasses.reverse,
        })
      : null;

  const candidates = buildCandidates({
    legal,
    pot,
    toCall,
    stack,
    bb,
    rangeWidthPct: villainBlock?.rangeWidthPct ?? 50,
    rangeConfidence: villainBlock?.rangeConfidence ?? 0.5,
    board: boardTexture,
    street: String(state.street),
    hand: handRelative,
    rawEquity,
    realizedEquityPct: continueQ?.realizedEquity ?? null,
    continueBand: continueQ?.band ?? null,
  });

  const strategicIntentCandidates = [
    ...new Set(
      candidates
        .map((c) => c.intent)
        .filter((x): x is StrategicIntent => Boolean(x)),
    ),
  ];

  return {
    street: String(state.street),
    hero: {
      seat: seatIndex,
      cards: hole.map((c) => `${c.rank}${c.suit}`),
      handClass: hole.length === 2 ? handClassOf(hole) : "",
      handLabel: hole.length === 2 ? personalHandLabel(hole, state.board) : "",
      handRelativeStrength: handRelative.strength,
      showdownStrength: handRelative.showdownBand,
      handRelativeLabel: handRelative.label,
      position: heroPosition,
      stackBb: toBb(stack, bb),
      committedBb: toBb(chipsToNumber(seat?.totalBet ?? 0n), bb),
    },
    boardTexture,
    rawEquity,
    equityRealization: realization,
    realizedEquity: continueQ?.realizedEquity ?? (rawEquity != null && realization
      ? Math.round(rawEquity * realization.factor * 1000) / 1000
      : null),
    impliedOddsClass: rawEquity != null ? oddsClasses.implied : null,
    reverseImpliedOddsClass: rawEquity != null ? oddsClasses.reverse : null,
    continueQuality: continueQ,
    strategicIntentCandidates,
    potBb: toBb(pot, bb),
    callBb: toBb(toCall, bb),
    potOdds,
    effectiveStackBb: toBb(effectiveStack, bb),
    effectiveStacksBbBySeat,
    stackDepthRegime: stackDepthRegime(toBb(effectiveStack, bb)),
    sprAfterCall,
    geometry: {
      callPctPot: toCall > 0 && pot > 0 ? Math.round((toCall / pot) * 1000) / 1000 : null,
      spr,
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
/**
 * Pot-fraction sizings worth considering, by street.
 *
 * Real rooms allow any legal size; a strategist should still choose from sizes
 * that mean something. Rivers get the widest grid (polarised overbets are real
 * there); preflop is tightest because raise sizing is far more standardised.
 */
/**
 * Guardrail against strategically inconsistent aggression.
 *
 * The failure this exists to stop: the model computing "needs 35% folds,
 * estimated 21%, realized equity 13%, confidence low" and then raising anyway.
 * Nothing here forbids the line — bluffs with blockers or a barrel plan are
 * real — but the spot is labelled so the strategist has to justify it rather
 * than drift into it.
 */
export function classifyViability(input: {
  aggressive: boolean;
  amount: number;
  requiredFoldPct: number | null;
  estimatedFoldPct: number | null;
  foldConfidence: number | null;
  realizedEquityPct: number | null;
}): { viability: "SUPPORTED" | "THIN" | "UNSUPPORTED"; viabilityReason: string | null } {
  if (!input.aggressive || input.amount <= 0) {
    return { viability: "SUPPORTED", viabilityReason: null };
  }
  const required = input.requiredFoldPct;
  const estimated = input.estimatedFoldPct;
  if (required == null || estimated == null) {
    return { viability: "SUPPORTED", viabilityReason: null };
  }

  const shortfall = required - estimated;
  const poorEquity = (input.realizedEquityPct ?? 100) < 20;
  const lowConfidence = (input.foldConfidence ?? 1) < 0.45;

  if (shortfall > 0 && poorEquity) {
    return {
      viability: "UNSUPPORTED",
      viabilityReason: lowConfidence
        ? "needs_more_folds_than_expected_poor_equity_low_confidence"
        : "needs_more_folds_than_expected_poor_equity",
    };
  }
  if (shortfall > 0) {
    return { viability: "THIN", viabilityReason: "needs_more_folds_than_expected" };
  }
  if (shortfall > -5) {
    return { viability: "THIN", viabilityReason: "fold_equity_barely_covers_price" };
  }
  return { viability: "SUPPORTED", viabilityReason: null };
}

export function sizingGridFor(street: string): number[] {
  switch (String(street).toLowerCase()) {
    case "preflop":
      return [0.5, 0.75, 1];
    case "flop":
      return [0.25, 0.33, 0.5, 0.66, 0.75, 1];
    case "turn":
      return [0.33, 0.5, 0.66, 0.75, 1, 1.25];
    case "river":
      return [0.25, 0.5, 0.66, 0.75, 1, 1.25, 1.5];
    default:
      return [0.33, 0.5, 0.75, 1];
  }
}

export function buildCandidates(input: {
  legal: LegalAction[];
  pot: number;
  toCall: number;
  stack: number;
  bb: number;
  rangeWidthPct?: number;
  rangeConfidence?: number;
  board?: BoardTexture;
  street?: string;
  hand?: HandRelative;
  rawEquity?: number | null;
  realizedEquityPct?: number | null;
  observedFoldTendency?: number | null;
  handsObserved?: number;
  continueBand?: string | null;
}): CandidateAction[] {
  const { legal, pot, toCall, stack, bb } = input;
  const board = input.board ?? analyzeBoardTexture([]);
  const hand =
    input.hand ?? ({ strength: "UNKNOWN", showdownBand: "WEAK", label: "unknown" } as HandRelative);
  const out: CandidateAction[] = [];

  const push = (action: string, chips: number) => {
    const amount = Math.max(0, Math.min(stack, Math.round(chips)));
    if (out.some((c) => c.action === action && c.amountChips === amount)) return;
    // A max-sized raise IS the all-in; offering both as separate candidates
    // gives the strategist two identical lines with different labels.
    const aggressiveDup =
      (action === "raise" || action === "bet" || action === "all_in") &&
      out.some(
        (c) =>
          c.amountChips === amount &&
          (c.action === "all_in" || c.action === "raise" || c.action === "bet"),
      );
    if (aggressiveDup) return;
    const aggressive = action === "bet" || action === "raise" || action === "all_in";
    const potAfter = pot + amount;
    const foldEst =
      aggressive && amount > 0
        ? estimateFoldToBet({
            pot,
            risk: amount,
            toCall,
            rangeWidthPct: input.rangeWidthPct ?? 50,
            rangeConfidence: input.rangeConfidence ?? 0.5,
            board,
            street: input.street ?? "flop",
          })
        : null;
    const intent = intentForAction({
      action,
      hand,
      rawEquity: input.rawEquity ?? null,
      continueBand: input.continueBand ?? null,
      foldEst,
    });
    const callPortion = aggressive ? Math.min(amount, toCall) : action === "call" ? amount : 0;
    const increment = aggressive ? Math.max(0, amount - toCall) : 0;
    const potAfterCall = pot + toCall;
    out.push({
      action,
      amountChips: amount,
      amountBb: toBb(amount, bb),
      isAllIn: amount >= stack && stack > 0,
      potAfterBb: toBb(potAfter, bb),
      callPortionChips: callPortion,
      raiseIncrementChips: increment,
      potBeforeChips: pot,
      potAfterCallChips: potAfterCall,
      potAfterActionChips: potAfter,
      // Measured against the pot the increment actually contests, not the pot
      // before hero's call — that is what made a min-raise read as "8% pot".
      sizingPctPot:
        aggressive && increment > 0 && potAfterCall > 0
          ? Math.round((increment / potAfterCall) * 1000) / 10
          : null,
      ev: (() => {
        if (action === "fold" || action === "check") return null;
        const conf = Math.min(
          input.rangeConfidence ?? 0.5,
          foldEst?.confidence ?? (input.rangeConfidence ?? 0.5),
        );
        if (action === "call") {
          return evaluateCallEv({
            pot,
            toCall,
            realizedEquity: (input.realizedEquityPct ?? 0) / 100,
            confidence: conf,
            bb,
          });
        }
        const response = estimateResponse({
          pot,
          risk: amount,
          toCall,
          rangeWidthPct: input.rangeWidthPct ?? 50,
          observedFoldTendency: input.observedFoldTendency ?? null,
          handsObserved: input.handsObserved ?? 0,
          street: input.street ?? "flop",
          wetBoard:
            input.board?.class === "WET" || input.board?.class === "MONOTONE",
        });
        return evaluateAggressiveEv({
          pot,
          risk: amount,
          toCall,
          // Villain's continuing range is stronger than their whole range, so
          // hero's equity when called is below raw equity vs the full range.
          equityWhenCalled: Math.max(
            0,
            Math.min(1, ((input.rawEquity ?? 50) / 100) * 0.88),
          ),
          response,
          confidence: conf,
          bb,
        });
      })(),
      ...classifyViability({
        aggressive,
        amount,
        requiredFoldPct:
          aggressive && amount > 0 ? (amount / (amount + pot)) * 100 : null,
        estimatedFoldPct: foldEst?.estimatedFoldPct ?? null,
        foldConfidence: foldEst?.confidence ?? null,
        realizedEquityPct: input.realizedEquityPct ?? null,
      }),
      breakEvenFoldPct:
        aggressive && amount > 0 ? Math.round((amount / (amount + pot)) * 1000) / 10 : null,
      estimatedFoldPct: foldEst?.estimatedFoldPct ?? null,
      foldEstimateConfidence: foldEst?.confidence ?? null,
      // Price the villain is laid when they face this size.
      priceOfferedPct:
        aggressive && amount > toCall
          ? Math.round(((amount - toCall) / (potAfter + (amount - toCall))) * 1000) / 10
          : null,
      intent,
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
      // Strategic sizing grid. A legal minimum is not automatically a sensible
      // candidate: a $0.50 bet into $32.50 is legal but is not a bluff, and
      // offering it as one produced "needs 2% folds" lines that no opponent
      // would ever fold to. Sizes are expressed as a fraction of the pot AFTER
      // hero calls, which is the pot the bet is actually contesting.
      const potAfterCall = pot + toCall;
      for (const frac of sizingGridFor(input.street ?? "flop")) {
        const target = toCall + potAfterCall * frac;
        const clamped = Math.max(min, Math.min(max, Math.round(target)));
        // Skip a "grid" size that the legal floor has dragged far away from
        // its intended shape — it is really just the minimum in disguise.
        if (clamped <= min && frac > 0.3) continue;
        push(l.action, clamped);
      }
      // Always keep the legal extremes available, clearly labelled by intent.
      push(l.action, min);
      push(l.action, max);
    }
  }
  // "BEST" must mean best in THIS spot, not merely above a threshold.
  return rankByEv(out);
}
