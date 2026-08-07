/**
 * Event → scheduler mode selection (Plan 09 / ENERGY_V1 §6).
 *
 * Trusted Mozetto component — not an unrestricted LLM choice.
 * Weights / thresholds are Season 1 hypotheses (see weights.ts).
 */

import { EnergyOperationType } from "../energy/costs.js";
import { costOf } from "../energy/costs.js";
import { MANDATORY_RESERVE } from "../energy/costs.js";
import type { PublicTableEvent } from "../state/types.js";
import {
  MODE_BASE_PRIORITY,
  MODE_TO_OPERATION,
  OWN_TURN_PRIORITY_BOOST,
  SEASON1_SCHEDULER_AXIS_THRESHOLDS,
  UNUSUAL_CADENCE_MS,
  isModeAllowed,
} from "./weights.js";
import type { ModeSelection, SchedulerContext, SchedulerMode } from "./types.js";

const ACTION_RAISE = 13;
const ACTION_BET = 12;
const ACTION_ALL_IN = 15;
const ACTION_FOLD = 10;

export interface SelectModeInput {
  event: PublicTableEvent;
  ctx: SchedulerContext;
  /** Spendable background Energy (already reserve-aware). */
  spendableBackground: number;
  allowedSchedulerWeights?: number;
}

function withPriority(mode: SchedulerMode, ctx: SchedulerContext, reason: string): ModeSelection {
  if (mode === "IGNORE") {
    return {
      mode,
      priority: MODE_BASE_PRIORITY.IGNORE,
      operationType: EnergyOperationType.DETERMINISTIC_INGEST,
      reason,
      energyGated: false,
    };
  }
  const operationType = MODE_TO_OPERATION[mode];
  let priority = MODE_BASE_PRIORITY[mode];
  if (ctx.proximityToOwnTurn) priority += OWN_TURN_PRIORITY_BOOST;
  return { mode, priority, operationType, reason, energyGated: false };
}

function gateEnergy(
  selection: ModeSelection,
  spendableBackground: number,
): ModeSelection {
  if (selection.mode === "IGNORE" || selection.mode === "DETERMINISTIC_UPDATE") {
    return selection;
  }
  const cost = costOf(selection.operationType);
  if (cost > spendableBackground) {
    return {
      mode: "DETERMINISTIC_UPDATE",
      priority: MODE_BASE_PRIORITY.DETERMINISTIC_UPDATE,
      operationType: EnergyOperationType.DETERMINISTIC_INGEST,
      reason: `${selection.reason}; energy_gate→DETERMINISTIC (need ${cost}, spendable ${spendableBackground}, reserve ${MANDATORY_RESERVE})`,
      energyGated: true,
    };
  }
  return selection;
}

function maybeConserve(mode: SchedulerMode, ctx: SchedulerContext): SchedulerMode {
  const { energyConservation } = ctx.axes;
  if (energyConservation < SEASON1_SCHEDULER_AXIS_THRESHOLDS.energyConservationConserve) {
    return mode;
  }
  // High conservation: demote expensive background model work.
  if (mode === "DEEP_REEVALUATION") return "STREET_PLAN";
  if (mode === "STREET_PLAN") return "LIGHT_UPDATE";
  if (mode === "OPPONENT_UPDATE") return "LIGHT_UPDATE";
  return mode;
}

/**
 * Select scheduler output for a public table event.
 */
export function selectSchedulerMode(input: SelectModeInput): ModeSelection {
  const { event, ctx, spendableBackground } = input;
  const weights = input.allowedSchedulerWeights ?? 0x00_ff_00_ff;
  const uncertainty = ctx.uncertainty ?? 40;

  // Inactive seats: deterministic ingest only (no model spend).
  if (!ctx.seatActive) {
    return gateEnergy(
      withPriority("DETERMINISTIC_UPDATE", ctx, "seat_inactive"),
      spendableBackground,
    );
  }

  // Provider congestion: skip background model calls (ENERGY_V1 §12 / Plan 09).
  if (ctx.providerCongested) {
    return gateEnergy(
      withPriority("DETERMINISTIC_UPDATE", ctx, "provider_congested"),
      spendableBackground,
    );
  }

  let mode: SchedulerMode = "DETERMINISTIC_UPDATE";
  let reason = "default_deterministic";

  // Street / board materially changes ranges → street plan or deep reeval.
  if (event.kind === "street" || event.kind === "board") {
    if (uncertainty >= SEASON1_SCHEDULER_AXIS_THRESHOLDS.uncertaintyDeep) {
      mode = "DEEP_REEVALUATION";
      reason = "street_board_high_uncertainty";
    } else {
      mode = "STREET_PLAN";
      reason = "street_board_change";
    }
  } else if (event.kind === "action") {
    const actor = event.actorSeat;
    const isOther = actor != null && actor !== ctx.seat;
    const actionType = event.actionType ?? 0;

    if (isOther && actionType === ACTION_FOLD) {
      // Trivial fold by unrelated seat — deterministic, 0 Energy.
      mode = "DETERMINISTIC_UPDATE";
      reason = "other_seat_fold";
    } else if (
      isOther &&
      (actionType === ACTION_RAISE ||
        actionType === ACTION_BET ||
        actionType === ACTION_ALL_IN) &&
      ctx.axes.opponentAdaptation >=
        SEASON1_SCHEDULER_AXIS_THRESHOLDS.opponentAdaptationPrefer
    ) {
      mode = "OPPONENT_UPDATE";
      reason = "aggressive_opponent_action";
    } else if (
      isOther &&
      event.publicCadenceMs != null &&
      event.publicCadenceMs >= UNUSUAL_CADENCE_MS
    ) {
      mode = "LIGHT_UPDATE";
      reason = "unusual_public_cadence";
    } else if (isOther) {
      mode = "LIGHT_UPDATE";
      reason = "other_seat_action";
    } else {
      mode = "DETERMINISTIC_UPDATE";
      reason = "own_or_unknown_action";
    }
  } else if (event.kind === "showdown") {
    mode = "OPPONENT_UPDATE";
    reason = "showdown_evidence";
  } else if (event.kind === "hand_start") {
    mode =
      uncertainty >= SEASON1_SCHEDULER_AXIS_THRESHOLDS.uncertaintyStreetPlan
        ? "STREET_PLAN"
        : "LIGHT_UPDATE";
    reason = "hand_start";
  } else {
    mode = "DETERMINISTIC_UPDATE";
    reason = `kind_${event.kind}`;
  }

  mode = maybeConserve(mode, ctx);

  if (!isModeAllowed(mode, weights)) {
    mode = "DETERMINISTIC_UPDATE";
    reason = `${reason}; mode_not_allowed→DETERMINISTIC`;
  }

  // Near own turn: prefer keeping Energy for final — demote deep work.
  if (ctx.proximityToOwnTurn && (mode === "DEEP_REEVALUATION" || mode === "STREET_PLAN")) {
    if (spendableBackground < costOf(MODE_TO_OPERATION.STREET_PLAN) + 8) {
      mode = "LIGHT_UPDATE";
      reason = `${reason}; near_turn_conserve`;
    }
  }

  return gateEnergy(withPriority(mode, ctx, reason), spendableBackground);
}
